import db from './db.js';
import { notifyUser, notifyUsers } from './notify.js';
import { resolveApprovers } from './routes/workflows.js';

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

export function startReminderEngine() {
  const tick = () => {
    try { checkWorkflowDeadlines(); checkTaskDeadlines(); checkNoteReminders(); }
    catch (e) { console.error('reminder engine error:', e); }
  };
  setTimeout(tick, 10 * 1000);
  setInterval(tick, 5 * 60 * 1000);
}
