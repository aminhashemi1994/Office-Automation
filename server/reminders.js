import db from './db.js';
import { notifyUser, notifyUsers } from './notify.js';
import { resolveApprovers } from './routes/workflows.js';
import { flushQueue } from './sms.js';

const HOUR = 3600 * 1000;

function checkWorkflowDeadlines() {
  const now = Date.now();
  const open = db.prepare(`
    SELECT r.*, t.name AS template_name FROM workflow_requests r
    JOIN workflow_templates t ON t.id = r.template_id
    WHERE r.status = 'in_progress' AND r.step_due_at IS NOT NULL`).all();
  for (const rq of open) {
    const due = new Date(rq.step_due_at).getTime();
    const lastReminded = rq.last_reminded_at ? new Date(rq.last_reminded_at).getTime() : 0;
    // یادآوری: ۴ ساعت مانده به مهلت، و بعد از عبور از مهلت هر ۱۲ ساعت
    const nearDeadline = due - now < 4 * HOUR && due > now;
    const overdue = now > due;
    if ((nearDeadline || overdue) && now - lastReminded > 12 * HOUR) {
      const step = db.prepare('SELECT * FROM workflow_steps WHERE template_id = ? AND step_order = ?')
        .get(rq.template_id, rq.current_step);
      if (!step) continue;
      if (step.notify_approver === 0) { // [مورد ۴] اعلان این مرحله خاموش است
        db.prepare("UPDATE workflow_requests SET last_reminded_at = datetime('now') WHERE id = ?").run(rq.id);
        continue;
      }
      const approvers = resolveApprovers(step, rq.requester_id);
      notifyUsers(approvers, {
        type: 'reminder',
        title: overdue ? `⏰ مهلت گذشته: ${rq.template_name}` : `⏰ یادآوری مهلت: ${rq.template_name}`,
        body: `«${rq.title}» در مرحله «${step.title}» ${overdue ? 'از مهلت مقرر گذشته است' : 'به مهلت خود نزدیک می‌شود'}`,
        link: `/cartable/${rq.id}`,
      });
      db.prepare("UPDATE workflow_requests SET last_reminded_at = datetime('now') WHERE id = ?").run(rq.id);
    }
  }
}

function checkTaskDeadlines() {
  const now = Date.now();
  const open = db.prepare("SELECT * FROM tasks WHERE status != 'done' AND deadline IS NOT NULL").all();
  for (const t of open) {
    const due = new Date(t.deadline).getTime();
    if (isNaN(due)) continue;
    const lastReminded = t.last_reminded_at ? new Date(t.last_reminded_at).getTime() : 0;
    const nearDeadline = due - now < 24 * HOUR && due > now;
    const overdue = now > due;
    if ((nearDeadline || overdue) && now - lastReminded > 12 * HOUR) {
      notifyUser(t.assignee_id, {
        type: 'reminder',
        title: overdue ? '⏰ مهلت تسک گذشته است' : '⏰ یادآوری مهلت تسک',
        body: `«${t.title}» ${overdue ? 'از مهلت مقرر گذشته است' : 'به مهلت خود نزدیک می‌شود'}`,
        link: `/tasks?task=${t.id}`,
      });
      if (overdue && t.assigner_id !== t.assignee_id) {
        notifyUser(t.assigner_id, {
          type: 'reminder',
          title: '⏰ تسک واگذارشده از مهلت گذشت',
          body: `«${t.title}» هنوز انجام نشده و از مهلت گذشته است`,
          link: `/tasks?task=${t.id}`,
        });
      }
      db.prepare("UPDATE tasks SET last_reminded_at = datetime('now') WHERE id = ?").run(t.id);
    }
  }
}

// یادآوری‌های شخصیِ کاربران (یادداشت‌های دارای زمان یادآوری)
function checkNoteReminders() {
  const nowIso = new Date().toISOString();
  const due = db.prepare(
    "SELECT * FROM notes WHERE remind_at IS NOT NULL AND reminded = 0 AND done = 0 AND remind_at <= ?"
  ).all(nowIso);
  for (const n of due) {
    notifyUser(n.user_id, {
      type: 'reminder',
      title: `🔔 یادآوری: ${n.title || 'یادداشت'}`,
      body: (n.body || '').slice(0, 160),
      link: '/notes',
    });
    db.prepare('UPDATE notes SET reminded = 1 WHERE id = ?').run(n.id);
  }
}

// ============================================================================
//  یادآوری‌های CRM
//  سه چیز در فروش، فراموش‌شدنی و پرهزینه‌اند: پیگیریِ سررسیدشده، مهلتِ ارسال
//  پیشنهاد مناقصه، و سررسیدِ ضمانت‌نامه‌ای که هنوز آزاد نشده.
// ============================================================================
// جلوگیری از اعلانِ تکراری در یک روز — کلیدِ «نوع:شناسه:تاریخ»
const crmSent = new Set();
function onceToday(key) {
  const stamp = `${key}:${new Date().toISOString().slice(0, 10)}`;
  if (crmSent.has(stamp)) return false;
  crmSent.add(stamp);
  // جلوگیری از رشد بی‌نهایتِ حافظه
  if (crmSent.size > 5000) crmSent.clear();
  return true;
}

function checkCrmFollowUps() {
  const due = db.prepare(`
    SELECT a.id, a.user_id, a.subject, a.body, a.follow_up_at, c.name AS customer_name
    FROM crm_activities a
    JOIN crm_customers c ON c.id = a.customer_id
    WHERE a.follow_up_done = 0 AND a.follow_up_at IS NOT NULL AND a.follow_up_at != ''
      AND a.follow_up_at <= datetime('now') AND a.user_id IS NOT NULL`).all();
  for (const a of due) {
    if (!onceToday(`crm-follow:${a.id}`)) continue;
    notifyUser(a.user_id, {
      type: 'reminder',
      title: `🔔 پیگیری مشتری: ${a.customer_name}`,
      body: (a.subject || a.body || 'پیگیری سررسید شده است').slice(0, 160),
      link: '/crm',
    });
  }
}

function checkTenderDeadlines() {
  // چند روز مانده به مهلت یادآوری شود — از تنظیمات سازمان
  const days = String(db.prepare("SELECT value FROM app_settings WHERE key = 'crm_tender_reminder_days'").get()?.value || '7،3،1')
    .split(/[،,]/).map(x => Number(String(x).trim())).filter(n => n > 0);
  const openTenders = db.prepare(`
    SELECT t.*, c.name AS customer_name FROM crm_tenders t
    LEFT JOIN crm_customers c ON c.id = t.customer_id
    WHERE t.status NOT IN ('won','lost','cancelled','withdrawn')`).all();
  const now = Date.now();
  const daysLeft = (d) => {
    if (!d) return null;
    const dt = new Date(String(d).length <= 10 ? `${d}T23:59:59` : d);
    return Number.isNaN(dt.getTime()) ? null : Math.ceil((dt.getTime() - now) / (24 * HOUR));
  };

  for (const t of openTenders) {
    const targets = [t.owner_id, t.created_by].filter(Boolean);
    if (!targets.length) continue;
    const left = daysLeft(t.submit_deadline);
    if (left === null) continue;

    // مهلت گذشته و هنوز پیشنهادی ارسال نشده
    if (left < 0 && t.status !== 'submitted' && onceToday(`tender-over:${t.id}`)) {
      notifyUsers(targets, {
        type: 'reminder',
        title: `⏰ مهلت مناقصه گذشت: ${t.title}`,
        body: `مهلت ارسال پیشنهاد «${t.title}» گذشته و وضعیت هنوز «ارسال‌شده» نیست`,
        link: '/crm',
      });
      continue;
    }
    if (left < 0 || !days.includes(left)) continue;
    if (!onceToday(`tender:${t.id}:${left}`)) continue;

    // مدارکِ ناقصِ پاکات را در همان اعلان یادآوری می‌کنیم
    const missing = db.prepare(`SELECT COUNT(*) c FROM crm_tender_checklist
      WHERE tender_id = ? AND required = 1 AND done = 0`).get(t.id).c;
    notifyUsers(targets, {
      type: 'reminder',
      title: `⏰ ${left.toLocaleString('fa-IR')} روز تا مهلت مناقصه: ${t.title}`,
      body: `${t.customer_name || t.organization || ''}`
        + (missing ? ` — ${missing.toLocaleString('fa-IR')} مدرک از پاکات هنوز آماده نیست` : ' — مدارک پاکات کامل است'),
      link: '/crm',
    });
  }

  // ضمانت‌نامه‌هایی که سررسیدشان نزدیک است و هنوز آزاد نشده‌اند
  const guarantees = db.prepare(`
    SELECT t.* FROM crm_tenders t
    WHERE t.guarantee_released = 0 AND t.guarantee_expires_at IS NOT NULL AND t.guarantee_expires_at != ''`).all();
  for (const t of guarantees) {
    const left = daysLeft(t.guarantee_expires_at);
    if (left === null || left < 0 || ![30, 15, 7, 3, 1].includes(left)) continue;
    if (!onceToday(`guar:${t.id}:${left}`)) continue;
    const targets = [t.owner_id, t.created_by].filter(Boolean);
    if (!targets.length) continue;
    notifyUsers(targets, {
      type: 'reminder',
      title: `⏰ ${left.toLocaleString('fa-IR')} روز تا سررسید ضمانت‌نامه`,
      body: `ضمانت‌نامهٔ مناقصه «${t.title}»${t.guarantee_no ? ` (شماره ${t.guarantee_no})` : ''}`
        + ' باید تمدید یا آزاد شود',
      link: '/crm',
    });
  }
}

// تیکت‌های پشتیبانی که از تعهد زمانی‌شان گذشته است
function checkTicketDeadlines() {
  const overdue = db.prepare(`
    SELECT t.*, c.name AS customer_name FROM crm_tickets t
    LEFT JOIN crm_customers c ON c.id = t.customer_id
    WHERE t.status IN ('new','in_progress','waiting_customer')
      AND t.due_at IS NOT NULL AND t.due_at != '' AND t.due_at <= datetime('now')`).all();
  for (const t of overdue) {
    if (!t.assignee_id || !onceToday(`ticket:${t.id}`)) continue;
    notifyUser(t.assignee_id, {
      type: 'reminder',
      title: `⏰ تیکت پشتیبانی از مهلت گذشت: ${t.subject}`,
      body: `${t.customer_name || ''} — ${t.severity === 'critical' ? 'اولویت بحرانی' : 'رسیدگی کنید'}`,
      link: '/crm',
    });
  }
  // تیکت بحرانیِ بی‌پاسخ بعد از ۴ ساعت → اطلاع به مدیران
  const unanswered = db.prepare(`
    SELECT t.*, c.name AS customer_name FROM crm_tickets t
    LEFT JOIN crm_customers c ON c.id = t.customer_id
    WHERE t.severity = 'critical' AND t.first_response_at IS NULL
      AND t.status IN ('new','in_progress')
      AND t.created_at <= datetime('now', '-4 hours')`).all();
  if (unanswered.length) {
    const admins = db.prepare("SELECT id FROM users WHERE role = 'admin' AND is_active = 1").all().map(u => u.id);
    for (const t of unanswered) {
      if (!onceToday(`ticket-crit:${t.id}`)) continue;
      notifyUsers([...new Set([...admins, t.assignee_id].filter(Boolean))], {
        type: 'reminder',
        title: `🚨 تیکت بحرانی بی‌پاسخ: ${t.subject}`,
        body: `${t.customer_name || ''} — بیش از ۴ ساعت است که پاسخی داده نشده`,
        link: '/crm',
      });
    }
  }
}

export function startReminderEngine() {
  const tick = () => {
    try { checkWorkflowDeadlines(); checkTaskDeadlines(); checkNoteReminders(); }
    catch (e) { console.error('reminder engine error:', e); }
    // خطای CRM نباید یادآوری‌های اصلی سامانه را متوقف کند
    try { checkCrmFollowUps(); checkTenderDeadlines(); checkTicketDeadlines(); }
    catch (e) { console.error('crm reminder error:', e); }
    // صفِ پیامک‌های زمان‌بندی‌شده (تا وقتی درگاه تنظیم نشده، شبیه‌سازی می‌شوند)
    flushQueue().catch(e => console.error('sms queue error:', e.message));
  };
  setTimeout(tick, 10 * 1000);
  setInterval(tick, 5 * 60 * 1000);
}
