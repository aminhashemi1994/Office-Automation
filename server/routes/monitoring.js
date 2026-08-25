// ============================================================================
//  مانیتورینگ — گزارشِ عملکرد در طول زمان
//  «پیشرفت ماهانهٔ من در پروژهٔ خرید و تدارکات در سه ماه/یک سال اخیر چطور بوده؟»
//  هر کاربر عملکرد خودش را می‌بیند؛ مدیرِ واحد، اعضای واحدش؛ مدیر سامانه، همه را.
//  همهٔ بازه‌ها بر مبنای ماهِ شمسی بسته‌بندی می‌شوند تا گزارش با تقویمِ کاربر بخواند.
// ============================================================================
import { Router } from 'express';
import db from '../db.js';
import { canAccessEverywhere, getManagedDeptIds, canManageUser } from '../acl.js';

const r = Router();

// «۱۴۰۵/۰۵» برای یک زمانِ ذخیره‌شده در دیتابیس
const jf = new Intl.DateTimeFormat('en-u-ca-persian-nu-latn', { year: 'numeric', month: '2-digit' });
function jMonth(sqlTime) {
  if (!sqlTime) return null;
  const s = String(sqlTime);
  const iso = /[TZ]/.test(s) ? s : s.replace(' ', 'T') + 'Z';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const parts = jf.formatToParts(d);
  const get = (t) => String(parts.find(p => p.type === t)?.value || '').replace(/\D/g, '');
  return `${get('year')}/${get('month').padStart(2, '0')}`;
}
// فهرست ماه‌های شمسیِ n ماه گذشته تا امروز، به‌ترتیب.
// عمداً روی خودِ تقویم شمسی عقب می‌رود: قدم‌زدن روی ماه‌های میلادی، ماهِ جاریِ شمسی
// را جا می‌اندازد (مثلاً وسطِ اوت هنوز مرداد است، نه شهریور).
function lastJalaliMonths(n) {
  const nowKey = jMonth(new Date().toISOString());
  if (!nowKey) return [];
  let [y, m] = nowKey.split('/').map(Number);
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push(`${y}/${String(m).padStart(2, '0')}`);
    m -= 1;
    if (m === 0) { m = 12; y -= 1; }
  }
  return out.reverse();
}

// چه کسانی را این کاربر می‌تواند ببیند
function visibleUsers(user) {
  if (canAccessEverywhere(user)) {
    return db.prepare('SELECT id, full_name, department_id FROM users WHERE is_active = 1 ORDER BY full_name').all();
  }
  const depts = getManagedDeptIds(user);
  if (!depts.length) return db.prepare('SELECT id, full_name, department_id FROM users WHERE id = ?').all(user.id);
  const ph = depts.map(() => '?').join(',');
  return db.prepare(`SELECT id, full_name, department_id FROM users
    WHERE is_active = 1 AND (department_id IN (${ph}) OR id = ?) ORDER BY full_name`).all(...depts, user.id);
}

r.get('/overview', (req, res) => {
  const months = Math.min(24, Math.max(1, Number(req.query.months) || 6));
  const targetId = Number(req.query.user_id) || req.user.id;
  if (targetId !== req.user.id && !canManageUser(req.user, targetId)) {
    return res.status(403).json({ error: 'به گزارش عملکرد این کاربر دسترسی ندارید' });
  }
  const projectId = Number(req.query.project_id) || null;
  const uid = targetId;
  const since = `-${months} months`;
  // node:sqlite پارامترِ نام‌دارِ استفاده‌نشده را رد می‌کند، پس شرط همیشه در SQL می‌ماند
  // و با NULL بودنِ @pid خنثی می‌شود.
  const pf = 'AND (@pid IS NULL OR t.project_id = @pid)';
  const args = { uid, pid: projectId, since };
  // این دو کوئری @since ندارند، پس نباید آن را هم بگیرند
  const argsNoSince = { uid, pid: projectId };

  // --- وظایف ---
  const doneRows = db.prepare(`
    SELECT t.completed_at AS at, t.deadline, t.project_id FROM tasks t
    WHERE t.assignee_id = @uid AND t.status = 'done' AND t.completed_at IS NOT NULL
      AND t.completed_at >= datetime('now', @since) ${pf}`).all(args);
  const createdRows = db.prepare(`
    SELECT t.created_at AS at FROM tasks t
    WHERE t.assignee_id = @uid AND t.created_at >= datetime('now', @since) ${pf}`).all(args);
  const stepRows = db.prepare(`
    SELECT s.done_at AS at FROM task_steps s JOIN tasks t ON t.id = s.task_id
    WHERE s.done = 1 AND s.done_by = @uid AND s.done_at >= datetime('now', @since) ${pf}`).all(args);

  const keys = lastJalaliMonths(months);
  const empty = () => Object.fromEntries(keys.map(k => [k, 0]));
  const doneBy = empty(), createdBy = empty(), lateBy = empty(), stepsBy = empty();
  for (const x of doneRows) {
    const k = jMonth(x.at); if (!(k in doneBy)) continue;
    doneBy[k]++;
    if (x.deadline && String(x.at) > String(x.deadline)) lateBy[k]++;
  }
  for (const x of createdRows) { const k = jMonth(x.at); if (k in createdBy) createdBy[k]++; }
  for (const x of stepRows) { const k = jMonth(x.at); if (k in stepsBy) stepsBy[k]++; }
  const monthly = keys.map(k => ({
    key: k, done: doneBy[k], created: createdBy[k], late: lateBy[k], steps: stepsBy[k],
    on_time: doneBy[k] ? Math.round(((doneBy[k] - lateBy[k]) / doneBy[k]) * 1000) / 10 : null,
  }));

  const openCount = db.prepare(`SELECT COUNT(*) c FROM tasks t
    WHERE t.assignee_id = @uid AND t.status != 'done' ${pf}`).get(argsNoSince).c;
  const overdueCount = db.prepare(`SELECT COUNT(*) c FROM tasks t
    WHERE t.assignee_id = @uid AND t.status != 'done' AND t.deadline IS NOT NULL AND datetime(t.deadline) < datetime('now') ${pf}`).get(argsNoSince).c;
  const totalDone = doneRows.length;
  const totalLate = doneRows.filter(x => x.deadline && String(x.at) > String(x.deadline)).length;
  // میانگین روزهای طول‌کشیده تا اتمام
  const avgDays = db.prepare(`SELECT AVG(julianday(t.completed_at) - julianday(t.created_at)) d FROM tasks t
    WHERE t.assignee_id = @uid AND t.status = 'done' AND t.completed_at IS NOT NULL
      AND t.completed_at >= datetime('now', @since) ${pf}`).get(args).d;

  // --- پروژه‌ها ---
  const byProject = db.prepare(`
    SELECT p.id, p.name, p.color,
      COUNT(t.id) AS total,
      SUM(CASE WHEN t.status = 'done' THEN 1 ELSE 0 END) AS done,
      SUM(CASE WHEN t.status != 'done' AND datetime(t.deadline) < datetime('now') THEN 1 ELSE 0 END) AS overdue
    FROM projects p JOIN tasks t ON t.project_id = p.id
    WHERE t.assignee_id = @uid
    GROUP BY p.id ORDER BY total DESC`).all({ uid });

  // --- نامه‌ها (درخواست‌های گردش‌کار) ---
  const letters = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM workflow_requests w WHERE w.requester_id = @uid AND w.created_at >= datetime('now', @since)) AS sent,
      (SELECT COUNT(*) FROM workflow_requests w WHERE w.requester_id = @uid AND w.status = 'approved' AND w.created_at >= datetime('now', @since)) AS approved,
      (SELECT COUNT(*) FROM workflow_requests w WHERE w.requester_id = @uid AND w.status = 'rejected' AND w.created_at >= datetime('now', @since)) AS rejected,
      (SELECT COUNT(*) FROM workflow_actions a WHERE a.actor_id = @uid AND a.created_at >= datetime('now', @since)) AS actions`)
    .get({ uid, since });
  const lettersByMonth = empty();
  for (const x of db.prepare(`SELECT created_at AS at FROM workflow_requests
      WHERE requester_id = @uid AND created_at >= datetime('now', @since)`).all({ uid, since })) {
    const k = jMonth(x.at); if (k in lettersByMonth) lettersByMonth[k]++;
  }

  // --- پیگیری‌ها: کاری که به دیگران سپرده‌ام و گزارش‌هایی که نوشته‌ام ---
  const follow = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM tasks WHERE assigner_id = @uid AND assignee_id != @uid) AS assigned_total,
      (SELECT COUNT(*) FROM tasks WHERE assigner_id = @uid AND assignee_id != @uid AND status != 'done') AS assigned_open,
      (SELECT COUNT(*) FROM tasks WHERE assigner_id = @uid AND assignee_id != @uid AND status != 'done'
         AND deadline IS NOT NULL AND datetime(deadline) < datetime('now')) AS assigned_overdue,
      (SELECT COUNT(*) FROM task_comments WHERE user_id = @uid AND created_at >= datetime('now', @since)) AS reports_written`)
    .get({ uid, since });

  res.json({
    user_id: uid,
    months,
    monthly,
    summary: {
      done: totalDone,
      late: totalLate,
      on_time_rate: totalDone ? Math.round(((totalDone - totalLate) / totalDone) * 1000) / 10 : null,
      open: openCount,
      overdue: overdueCount,
      steps_done: stepRows.length,
      avg_days: avgDays == null ? null : Math.round(avgDays * 10) / 10,
    },
    by_project: byProject.map(p => ({
      ...p,
      progress: p.total ? Math.round((p.done / p.total) * 1000) / 10 : 0,
    })),
    letters: { ...letters, monthly: keys.map(k => ({ key: k, count: lettersByMonth[k] })) },
    follow_ups: follow,
  });
});

// مقایسهٔ اعضای تیم — فقط برای مدیرِ واحد و مدیر سامانه
r.get('/team', (req, res) => {
  const months = Math.min(24, Math.max(1, Number(req.query.months) || 3));
  const people = visibleUsers(req.user);
  if (people.length <= 1 && !canAccessEverywhere(req.user)) {
    return res.json({ rows: [], months, is_manager: false });
  }
  const since = `-${months} months`;
  const rows = people.map(u => {
    const s = db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM tasks WHERE assignee_id = @uid AND status = 'done'
           AND completed_at >= datetime('now', @since)) AS done,
        (SELECT COUNT(*) FROM tasks WHERE assignee_id = @uid AND status = 'done'
           AND completed_at >= datetime('now', @since) AND deadline IS NOT NULL AND completed_at > datetime(deadline)) AS late,
        (SELECT COUNT(*) FROM tasks WHERE assignee_id = @uid AND status != 'done') AS open,
        (SELECT COUNT(*) FROM tasks WHERE assignee_id = @uid AND status != 'done'
           AND deadline IS NOT NULL AND datetime(deadline) < datetime('now')) AS overdue,
        (SELECT COUNT(*) FROM workflow_requests WHERE requester_id = @uid AND created_at >= datetime('now', @since)) AS letters,
        (SELECT COUNT(*) FROM task_comments WHERE user_id = @uid AND created_at >= datetime('now', @since)) AS reports`)
      .get({ uid: u.id, since });
    return {
      user_id: u.id, full_name: u.full_name, department_id: u.department_id,
      ...s,
      on_time_rate: s.done ? Math.round(((s.done - s.late) / s.done) * 1000) / 10 : null,
    };
  });
  res.json({ rows, months, is_manager: true });
});

export default r;
