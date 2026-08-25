import { Router } from 'express';
import db from '../db.js';
import { hasPerm } from '../auth.js';
import { notifyUser, notifyUsers, getIO } from '../notify.js';
import { canSeeProject } from './projects.js';

const r = Router();

// یک وظیفه با همهٔ چیزهایی که فهرست لازم دارد: مسئول، واگذارکننده، دسته‌بندی،
// شمارِ کامنت‌های خوانده‌نشده و پیشرفتِ چک‌لیست.
const TASK_SELECT = `
  SELECT t.*, a.full_name AS assigner_name, b.full_name AS assignee_name, b.avatar_color AS assignee_color,
    p.name AS project_name, p.color AS project_color,
    (SELECT COUNT(*) FROM task_steps s WHERE s.task_id = t.id) AS step_count,
    (SELECT COUNT(*) FROM task_steps s WHERE s.task_id = t.id AND s.done = 1) AS step_done,
    (SELECT COUNT(*) FROM task_comments c WHERE c.task_id = t.id) AS comment_count,
    (SELECT COUNT(*) FROM task_comments c
       WHERE c.task_id = t.id AND c.user_id != @uid
         AND c.id > COALESCE((SELECT last_read_comment_id FROM task_comment_reads WHERE task_id = t.id AND user_id = @uid), 0)
    ) AS unread_comments
  FROM tasks t JOIN users a ON a.id = t.assigner_id JOIN users b ON b.id = t.assignee_id
  LEFT JOIN projects p ON p.id = t.project_id`;

// ثبت اینکه کاربر همهٔ کامنت‌های این تسک را تا این لحظه دیده است
function markCommentsRead(taskId, userId) {
  const max = db.prepare('SELECT MAX(id) AS m FROM task_comments WHERE task_id = ?').get(taskId)?.m || 0;
  db.prepare(`
    INSERT INTO task_comment_reads (task_id, user_id, last_read_comment_id) VALUES (?, ?, ?)
    ON CONFLICT(task_id, user_id) DO UPDATE SET last_read_comment_id = excluded.last_read_comment_id
      WHERE excluded.last_read_comment_id > task_comment_reads.last_read_comment_id`).run(taskId, userId, max);
  // اعلان‌های مربوط به کامنت این تسک برای این کاربر خوانده‌شده می‌شوند تا از شمارنده حذف شوند
  db.prepare(`UPDATE notifications SET is_read = 1
    WHERE user_id = ? AND is_read = 0 AND type = 'task' AND link = ?`).run(userId, `/tasks?task=${taskId}`);
}

function participantsOf(taskId) {
  return db.prepare(`
    SELECT u.id, u.full_name, u.avatar_color, u.avatar_path
    FROM task_participants tp JOIN users u ON u.id = tp.user_id
    WHERE tp.task_id = ? ORDER BY u.full_name`).all(taskId);
}
function participantIds(taskId) {
  return db.prepare('SELECT user_id FROM task_participants WHERE task_id = ?').all(taskId).map(x => x.user_id);
}
function stepsOf(taskId) {
  return db.prepare(`SELECT s.*, u.full_name AS done_by_name FROM task_steps s
    LEFT JOIN users u ON u.id = s.done_by
    WHERE s.task_id = ? ORDER BY s.sort_order, s.id`).all(taskId);
}
function withDetails(t) {
  return { ...t, participants: participantsOf(t.id) };
}
// چه کسانی می‌توانند تسک را ببینند/در آن مشارکت کنند
function canSeeTask(user, t) {
  return t.assigner_id === user.id || t.assignee_id === user.id || user.role === 'admin'
    || participantIds(t.id).includes(user.id);
}
// چه کسی می‌تواند مشارکت‌کننده اضافه/کم کند: واگذارکننده، مدیر سامانه، یا سرگروه/مدیرِ واحد
function canManageParticipants(user, t) {
  if (t.assigner_id === user.id || user.role === 'admin') return true;
  if (user.role === 'manager' || db.prepare('SELECT 1 FROM departments WHERE manager_id = ?').get(user.id)) return true;
  return false;
}
// دسته‌بندی معتبر است و کاربر به آن دسترسی دارد؟ (null یعنی بی‌دسته)
function resolveProject(user, projectId) {
  if (projectId === undefined) return { ok: true, value: undefined };
  if (projectId === null || projectId === '' || Number(projectId) === 0) {
    if (db.prepare("SELECT value FROM app_settings WHERE key = 'tasks_require_project'").get()?.value === '1') {
      return { ok: false, error: 'انتخاب دسته‌بندی برای هر وظیفه الزامی است' };
    }
    return { ok: true, value: null };
  }
  const p = db.prepare('SELECT * FROM projects WHERE id = ?').get(Number(projectId));
  if (!p) return { ok: false, error: 'دسته‌بندی یافت نشد' };
  if (!canSeeProject(user, p)) return { ok: false, error: 'به این دسته‌بندی دسترسی ندارید' };
  return { ok: true, value: p.id };
}

r.get('/', (req, res) => {
  // تسک‌های من: واگذارشده به من یا موردِ مشارکت من
  const mine = db.prepare(`${TASK_SELECT}
    WHERE t.assignee_id = @uid OR t.id IN (SELECT task_id FROM task_participants WHERE user_id = @uid)
    ORDER BY t.status = 'done', t.deadline IS NULL, t.deadline`).all({ uid: req.user.id }).map(withDetails);
  const assigned = db.prepare(`${TASK_SELECT}
    WHERE t.assigner_id = @uid AND t.assignee_id != @uid ORDER BY t.id DESC`).all({ uid: req.user.id }).map(withDetails);
  res.json({ mine, assigned });
});

// ----------------------------------------------------------------------------
// «برنامهٔ من» — چیزی که منوی یادآوریِ بالای صفحه و داشبورد نشان می‌دهند:
// کارهای امروز، کارهای دارای تأخیر، و یادآوری‌های پیشِ‌رو (وظیفه، مرحله، یادداشت)
// ----------------------------------------------------------------------------
r.get('/agenda', (req, res) => {
  const uid = req.user.id;
  const mine = `(t.assignee_id = @uid OR t.id IN (SELECT task_id FROM task_participants WHERE user_id = @uid))`;
  const today = db.prepare(`${TASK_SELECT}
    WHERE ${mine} AND t.status != 'done' AND t.deadline IS NOT NULL
      AND date(t.deadline, 'localtime') = date('now', 'localtime')
    ORDER BY t.deadline`).all({ uid });
  // «دارای تأخیر» یعنی لحظهٔ مهلت گذشته است — کاری که ساعت ۱۰ صبحِ امروز مهلت داشته
  // و الان ظهر است هم عقب‌افتاده حساب می‌شود (و طبیعتاً در «امروز» هم دیده می‌شود).
  const overdue = db.prepare(`${TASK_SELECT}
    WHERE ${mine} AND t.status != 'done' AND t.deadline IS NOT NULL AND datetime(t.deadline) < datetime('now')
    ORDER BY t.deadline`).all({ uid });
  const starting = db.prepare(`${TASK_SELECT}
    WHERE ${mine} AND t.status = 'todo' AND t.start_at IS NOT NULL
      AND date(t.start_at, 'localtime') = date('now', 'localtime')
    ORDER BY t.start_at`).all({ uid });
  // یادآوری‌ها: خودِ وظیفه، مراحلِ وظیفه، و یادداشت‌های زمان‌دار
  const taskReminders = db.prepare(`
    SELECT t.id, t.title, t.remind_at AS at, 'task' AS kind, NULL AS parent_title
    FROM tasks t WHERE ${mine} AND t.remind_at IS NOT NULL AND t.status != 'done'`).all({ uid });
  const stepReminders = db.prepare(`
    SELECT s.id, s.title, s.remind_at AS at, 'step' AS kind, t.title AS parent_title, t.id AS task_id
    FROM task_steps s JOIN tasks t ON t.id = s.task_id
    WHERE ${mine} AND s.remind_at IS NOT NULL AND s.done = 0`).all({ uid });
  const noteReminders = db.prepare(`
    SELECT n.id, n.title, n.remind_at AS at, 'note' AS kind, NULL AS parent_title
    FROM notes n WHERE n.user_id = @uid AND n.remind_at IS NOT NULL AND n.done = 0`).all({ uid });
  const reminders = [...taskReminders, ...stepReminders, ...noteReminders]
    .sort((a, b) => String(a.at).localeCompare(String(b.at)));
  res.json({ today, overdue, starting, reminders });
});

// انجام‌شده‌های یک روز (پیش‌فرض: امروز) — برای تب «انجام‌شده‌های روزانه»
r.get('/done-log', (req, res) => {
  const day = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.day || '')) ? req.query.day : null;
  const uid = req.user.id;
  const tasks = db.prepare(`${TASK_SELECT}
    WHERE (t.assignee_id = @uid OR t.assigner_id = @uid
           OR t.id IN (SELECT task_id FROM task_participants WHERE user_id = @uid))
      AND t.status = 'done' AND t.completed_at IS NOT NULL
      AND date(t.completed_at, 'localtime') = COALESCE(@day, date('now', 'localtime'))
    ORDER BY t.completed_at DESC`).all({ uid, day });
  // مراحلی که همان روز تیک خورده‌اند هم بخشی از کارِ انجام‌شدهٔ آن روز است
  const steps = db.prepare(`
    SELECT s.id, s.title, s.done_at, t.id AS task_id, t.title AS task_title, p.name AS project_name
    FROM task_steps s JOIN tasks t ON t.id = s.task_id
    LEFT JOIN projects p ON p.id = t.project_id
    WHERE s.done = 1 AND s.done_by = @uid AND s.done_at IS NOT NULL
      AND date(s.done_at, 'localtime') = COALESCE(@day, date('now', 'localtime'))
    ORDER BY s.done_at DESC`).all({ uid, day });
  res.json({ tasks, steps, day: day || null });
});

// نمای تقویم: هر چیزی که در بازهٔ خواسته‌شده تاریخ دارد
r.get('/calendar', (req, res) => {
  const from = String(req.query.from || '').slice(0, 10);
  const to = String(req.query.to || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return res.status(400).json({ error: 'بازهٔ تاریخ نامعتبر است' });
  }
  const uid = req.user.id;
  const inRange = (col) => `date(${col}, 'localtime') BETWEEN @from AND @to`;
  const mine = `(t.assignee_id = @uid OR t.assigner_id = @uid
    OR t.id IN (SELECT task_id FROM task_participants WHERE user_id = @uid))`;
  const rows = db.prepare(`
    SELECT t.id, t.title, t.status, t.priority, t.deadline, t.start_at, t.assignee_id, t.assigner_id,
      p.name AS project_name, p.color AS project_color, b.full_name AS assignee_name
    FROM tasks t LEFT JOIN projects p ON p.id = t.project_id JOIN users b ON b.id = t.assignee_id
    WHERE ${mine} AND (${inRange('t.deadline')} OR ${inRange('t.start_at')})`).all({ uid, from, to });
  const steps = db.prepare(`
    SELECT s.id, s.title, s.remind_at, s.done, t.id AS task_id, t.title AS task_title
    FROM task_steps s JOIN tasks t ON t.id = s.task_id
    WHERE ${mine} AND s.remind_at IS NOT NULL AND ${inRange('s.remind_at')}`).all({ uid, from, to });
  res.json({ tasks: rows, steps });
});

// قوانین واگذاری تسک (بدون تغییر)
export function canAssignTo(assigner, assigneeId) {
  if (assigneeId === assigner.id) return true;
  if (assigner.role === 'admin') return true;
  const myDept = assigner.department_id
    ? db.prepare('SELECT * FROM departments WHERE id = ?').get(assigner.department_id) : null;
  if (myDept?.is_management) return true;
  const assignee = db.prepare('SELECT * FROM users WHERE id = ? AND is_active = 1').get(assigneeId);
  if (!assignee || assignee.department_id == null) return false;
  const allowed = new Set(db.prepare('SELECT id FROM departments WHERE manager_id = ?').all(assigner.id).map(d => d.id));
  if ((assigner.role === 'manager' || allowed.size || hasPerm(assigner, 'tasks.assign')) && assigner.department_id) {
    allowed.add(assigner.department_id);
  }
  return allowed.has(assignee.department_id);
}

function setParticipants(taskId, ids, excludeIds = []) {
  const clean = [...new Set((ids || []).map(Number))].filter(id => id && !excludeIds.includes(id));
  db.prepare('DELETE FROM task_participants WHERE task_id = ?').run(taskId);
  const ins = db.prepare('INSERT OR IGNORE INTO task_participants (task_id, user_id) VALUES (?, ?)');
  for (const id of clean) ins.run(taskId, id);
  return clean;
}

// فهرست id فایل‌های پیوست — همان قالبی که فرم‌های گردش‌کار استفاده می‌کنند
function cleanAttachments(v) {
  if (v === undefined) return undefined;
  const ids = (Array.isArray(v) ? v : []).map(Number).filter(Boolean).slice(0, 30);
  return JSON.stringify([...new Set(ids)]);
}

r.post('/', (req, res) => {
  const { title, description = '', assignee_id, priority = 'normal', deadline = null, start_at = null,
    participant_ids = [], project_id, remind_at = null, attachments, steps = [] } = req.body || {};
  if (!title || !assignee_id) return res.status(400).json({ error: 'عنوان و مسئول انجام الزامی است' });
  const assigneeId = Number(assignee_id);
  if (!canAssignTo(req.user, assigneeId)) {
    return res.status(403).json({ error: 'شما مجاز به واگذاری تسک به این کاربر نیستید' });
  }
  const proj = resolveProject(req.user, project_id === undefined ? null : project_id);
  if (!proj.ok) return res.status(400).json({ error: proj.error });
  const result = db.prepare(`INSERT INTO tasks
    (title, description, assigner_id, assignee_id, priority, deadline, start_at, project_id, remind_at, attachments)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(title, description, req.user.id, assigneeId, priority, deadline, start_at,
      proj.value ?? null, remind_at, cleanAttachments(attachments) ?? '[]');
  const taskId = Number(result.lastInsertRowid);
  // مراحلِ اولیه (چک‌لیست) اگر همان اول تعریف شده باشند
  const insStep = db.prepare('INSERT INTO task_steps (task_id, title, sort_order) VALUES (?, ?, ?)');
  (Array.isArray(steps) ? steps : []).slice(0, 60).forEach((s, i) => {
    const t = String(s?.title ?? s ?? '').trim();
    if (t) insStep.run(taskId, t.slice(0, 200), i + 1);
  });
  // مشارکت‌کنندگان (به‌جز واگذارکننده و مسئول که خودشان دسترسی دارند)
  let added = [];
  if (participant_ids.length) added = setParticipants(taskId, participant_ids, [assigneeId, req.user.id]);
  if (assigneeId !== req.user.id) {
    notifyUser(assigneeId, { type: 'task', title: 'تسک جدید', body: `«${title}» توسط ${req.user.full_name} به شما واگذار شد`, link: `/tasks?task=${taskId}` });
  }
  notifyUsers(added, { type: 'task', title: 'مشارکت در تسک', body: `شما به تسک «${title}» اضافه شدید`, link: `/tasks?task=${taskId}` });
  res.json({ id: taskId });
});

r.put('/:id', (req, res) => {
  const t = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!t) return res.status(404).json({ error: 'تسک یافت نشد' });
  // مشارکت‌کننده هم می‌تواند وضعیت را تغییر دهد (همکاری)؛ ویرایش کاملِ فیلدها با واگذارکننده/مسئول/مدیر
  const isParticipant = participantIds(t.id).includes(req.user.id);
  const isOwner = t.assigner_id === req.user.id || t.assignee_id === req.user.id || req.user.role === 'admin';
  if (!isOwner && !isParticipant) return res.status(403).json({ error: 'دسترسی غیرمجاز' });
  const { title, description, status, priority, deadline, start_at, participant_ids,
    project_id, remind_at, attachments } = req.body || {};
  const newStatus = status ?? t.status;
  const proj = resolveProject(req.user, project_id);
  if (!proj.ok) return res.status(400).json({ error: proj.error });
  const att = cleanAttachments(attachments);
  // تغییرِ زمان یادآوری، پرچمِ «یادآوری‌شده» را ریست می‌کند تا دوباره اعلام شود
  const newRemind = remind_at !== undefined ? remind_at : t.remind_at;
  db.prepare(`UPDATE tasks SET title = ?, description = ?, status = ?, priority = ?, deadline = ?, start_at = ?,
    project_id = ?, remind_at = ?, reminded = ?, attachments = ?, updated_at = datetime('now'),
    completed_at = CASE WHEN ? = 'done' AND status != 'done' THEN datetime('now') WHEN ? != 'done' THEN NULL ELSE completed_at END
    WHERE id = ?`)
    .run(title ?? t.title, description ?? t.description, newStatus, priority ?? t.priority,
      deadline !== undefined ? deadline : t.deadline,
      start_at !== undefined ? start_at : t.start_at,
      proj.value === undefined ? t.project_id : proj.value,
      newRemind, newRemind === t.remind_at ? t.reminded : 0,
      att === undefined ? t.attachments : att,
      newStatus, newStatus, t.id);
  // تغییر مشارکت‌کنندگان فقط توسط مجازها
  if (participant_ids !== undefined && canManageParticipants(req.user, t)) {
    const before = participantIds(t.id);
    const after = setParticipants(t.id, participant_ids, [t.assignee_id, t.assigner_id]);
    const newly = after.filter(id => !before.includes(id));
    notifyUsers(newly, { type: 'task', title: 'مشارکت در تسک', body: `شما به تسک «${t.title}» اضافه شدید`, link: `/tasks?task=${t.id}` });
  }
  if (newStatus === 'done' && t.status !== 'done' && t.assigner_id !== req.user.id) {
    notifyUser(t.assigner_id, { type: 'task', title: 'تسک انجام شد', body: `«${t.title}» توسط ${req.user.full_name} تکمیل شد`, link: `/tasks?task=${t.id}` });
  }
  res.json({ ok: true });
});

r.delete('/:id', (req, res) => {
  const t = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!t) return res.status(404).json({ error: 'تسک یافت نشد' });
  if (t.assigner_id !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'دسترسی غیرمجاز' });
  db.prepare('DELETE FROM tasks WHERE id = ?').run(t.id);
  res.json({ ok: true });
});

// ---------- مراحلِ وظیفه (چک‌لیست) ----------
// هر وظیفه می‌تواند مراحلِ دلخواه داشته باشد؛ مثلاً «خرید ۱۰ تن مس»:
// پیش‌فاکتور → تایید مدیریت → تسویه → تولید → بارگیری → فاکتور.
function loadTaskFor(req, res) {
  const t = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!t) { res.status(404).json({ error: 'تسک یافت نشد' }); return null; }
  if (!canSeeTask(req.user, t)) { res.status(403).json({ error: 'دسترسی غیرمجاز' }); return null; }
  return t;
}

r.get('/:id/steps', (req, res) => {
  const t = loadTaskFor(req, res); if (!t) return;
  res.json({ steps: stepsOf(t.id) });
});

r.post('/:id/steps', (req, res) => {
  const t = loadTaskFor(req, res); if (!t) return;
  const title = String(req.body?.title || '').trim();
  if (!title) return res.status(400).json({ error: 'عنوان مرحله الزامی است' });
  const max = db.prepare('SELECT COALESCE(MAX(sort_order), 0) m FROM task_steps WHERE task_id = ?').get(t.id).m;
  const info = db.prepare('INSERT INTO task_steps (task_id, title, sort_order, remind_at) VALUES (?, ?, ?, ?)')
    .run(t.id, title.slice(0, 200), max + 1, req.body?.remind_at || null);
  res.json({ step: db.prepare('SELECT * FROM task_steps WHERE id = ?').get(info.lastInsertRowid) });
});

r.put('/:id/steps/:sid', (req, res) => {
  const t = loadTaskFor(req, res); if (!t) return;
  const s = db.prepare('SELECT * FROM task_steps WHERE id = ? AND task_id = ?').get(req.params.sid, t.id);
  if (!s) return res.status(404).json({ error: 'مرحله یافت نشد' });
  const b = req.body || {};
  const done = b.done !== undefined ? (b.done ? 1 : 0) : s.done;
  const remind = b.remind_at !== undefined ? b.remind_at : s.remind_at;
  db.prepare(`UPDATE task_steps SET title = ?, done = ?, remind_at = ?, reminded = ?,
      done_at = CASE WHEN ? = 1 AND done = 0 THEN datetime('now') WHEN ? = 0 THEN NULL ELSE done_at END,
      done_by = CASE WHEN ? = 1 AND done = 0 THEN ? WHEN ? = 0 THEN NULL ELSE done_by END
    WHERE id = ?`)
    .run(String(b.title ?? s.title).trim().slice(0, 200) || s.title, done, remind,
      remind === s.remind_at ? s.reminded : 0, done, done, done, req.user.id, done, s.id);
  // با تکمیل شدن همهٔ مراحل، خودِ وظیفه پیشنهادِ «انجام‌شده» می‌گیرد (اما خودکار بسته نمی‌شود)
  const all = stepsOf(t.id);
  res.json({ step: db.prepare('SELECT * FROM task_steps WHERE id = ?').get(s.id),
    all_done: all.length > 0 && all.every(x => x.done) });
});

r.delete('/:id/steps/:sid', (req, res) => {
  const t = loadTaskFor(req, res); if (!t) return;
  db.prepare('DELETE FROM task_steps WHERE id = ? AND task_id = ?').run(req.params.sid, t.id);
  res.json({ ok: true });
});

// تغییر چیدمانِ مراحل — همان‌طور که کاربر خواسته، ترتیب قابل ویرایش است
r.post('/:id/steps/reorder', (req, res) => {
  const t = loadTaskFor(req, res); if (!t) return;
  const ids = (req.body?.ids || []).map(Number).filter(Boolean);
  const upd = db.prepare('UPDATE task_steps SET sort_order = ? WHERE id = ? AND task_id = ?');
  ids.forEach((id, i) => upd.run(i + 1, id, t.id));
  res.json({ steps: stepsOf(t.id) });
});

// ---------- گزارش‌ها و کامنت‌ها ----------
r.get('/:id/comments', (req, res) => {
  const t = loadTaskFor(req, res); if (!t) return;
  const comments = db.prepare(`
    SELECT c.*, u.full_name AS author_name, u.avatar_color AS author_color, u.avatar_path AS author_avatar
    FROM task_comments c LEFT JOIN users u ON u.id = c.user_id
    WHERE c.task_id = ? ORDER BY c.id`).all(t.id);
  // با باز کردن گفتگوی تسک، همهٔ کامنت‌ها برای این کاربر «خوانده‌شده» می‌شوند
  markCommentsRead(t.id, req.user.id);
  res.json({ comments });
});

r.post('/:id/comments', (req, res) => {
  const t = loadTaskFor(req, res); if (!t) return;
  const body = String(req.body?.body || '').trim();
  if (!body) return res.status(400).json({ error: 'متن گزارش خالی است' });
  const result = db.prepare('INSERT INTO task_comments (task_id, user_id, body) VALUES (?, ?, ?)').run(t.id, req.user.id, body);
  const comment = db.prepare(`
    SELECT c.*, u.full_name AS author_name, u.avatar_color AS author_color, u.avatar_path AS author_avatar
    FROM task_comments c LEFT JOIN users u ON u.id = c.user_id WHERE c.id = ?`).get(result.lastInsertRowid);
  // نویسندهٔ کامنت، آن را دیده تلقی می‌شود تا برای خودش خوانده‌نشده شمرده نشود
  markCommentsRead(t.id, req.user.id);
  // انتشار زندهٔ کامنت به همهٔ افراد درگیر تسک (شامل نویسنده، برای هماهنگی چند تب)
  const audience = new Set([t.assigner_id, t.assignee_id, ...participantIds(t.id)]);
  const io = getIO();
  if (io) for (const uid of audience) io.to(`user:${uid}`).emit('task:comment', { task_id: t.id, comment });

  // اطلاع به همهٔ افراد درگیر تسک (به‌جز خودِ نویسنده)
  const recipients = new Set([t.assigner_id, t.assignee_id, ...participantIds(t.id)]);
  recipients.delete(req.user.id);
  notifyUsers([...recipients], {
    type: 'task',
    title: `گزارش جدید در تسک: ${t.title}`,
    body: `${req.user.full_name}: ${body.slice(0, 80)}`,
    link: `/tasks?task=${t.id}`,
  });
  res.json({ comment });
});

// ویرایش گزارش — فقط نویسنده؛ تاریخ ویرایش جدا نگه داشته می‌شود تا
// معلوم باشد متن بعداً اصلاح شده و تاریخِ ثبتِ اولیه هم از دست نرود.
r.put('/:id/comments/:cid', (req, res) => {
  const t = loadTaskFor(req, res); if (!t) return;
  const c = db.prepare('SELECT * FROM task_comments WHERE id = ? AND task_id = ?').get(req.params.cid, t.id);
  if (!c) return res.status(404).json({ error: 'گزارش یافت نشد' });
  if (c.user_id !== req.user.id) return res.status(403).json({ error: 'فقط نویسندهٔ گزارش می‌تواند آن را ویرایش کند' });
  const body = String(req.body?.body || '').trim();
  if (!body) return res.status(400).json({ error: 'متن گزارش خالی است' });
  db.prepare("UPDATE task_comments SET body = ?, edited_at = datetime('now') WHERE id = ?").run(body, c.id);
  res.json({ comment: db.prepare(`
    SELECT c.*, u.full_name AS author_name, u.avatar_color AS author_color, u.avatar_path AS author_avatar
    FROM task_comments c LEFT JOIN users u ON u.id = c.user_id WHERE c.id = ?`).get(c.id) });
});

r.delete('/:id/comments/:cid', (req, res) => {
  const t = loadTaskFor(req, res); if (!t) return;
  const c = db.prepare('SELECT * FROM task_comments WHERE id = ? AND task_id = ?').get(req.params.cid, t.id);
  if (!c) return res.status(404).json({ error: 'گزارش یافت نشد' });
  if (c.user_id !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'دسترسی غیرمجاز' });
  db.prepare('DELETE FROM task_comments WHERE id = ?').run(c.id);
  res.json({ ok: true });
});

export default r;
