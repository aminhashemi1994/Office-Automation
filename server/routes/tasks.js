import { Router } from 'express';
import db from '../db.js';
import { hasPerm } from '../auth.js';
import { notifyUser, notifyUsers, getIO } from '../notify.js';

const r = Router();

const TASK_SELECT = `
  SELECT t.*, a.full_name AS assigner_name, b.full_name AS assignee_name, b.avatar_color AS assignee_color,
    (SELECT COUNT(*) FROM task_comments c WHERE c.task_id = t.id) AS comment_count,
    (SELECT COUNT(*) FROM task_comments c
       WHERE c.task_id = t.id AND c.user_id != @uid
         AND c.id > COALESCE((SELECT last_read_comment_id FROM task_comment_reads WHERE task_id = t.id AND user_id = @uid), 0)
    ) AS unread_comments
  FROM tasks t JOIN users a ON a.id = t.assigner_id JOIN users b ON b.id = t.assignee_id`;

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
function withParticipants(t) {
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

r.get('/', (req, res) => {
  // تسک‌های من: واگذارشده به من یا موردِ مشارکت من
  const mine = db.prepare(`${TASK_SELECT}
    WHERE t.assignee_id = @uid OR t.id IN (SELECT task_id FROM task_participants WHERE user_id = @uid)
    ORDER BY t.status = 'done', t.deadline IS NULL, t.deadline`).all({ uid: req.user.id }).map(withParticipants);
  const assigned = db.prepare(`${TASK_SELECT}
    WHERE t.assigner_id = @uid AND t.assignee_id != @uid ORDER BY t.id DESC`).all({ uid: req.user.id }).map(withParticipants);
  res.json({ mine, assigned });
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

r.post('/', (req, res) => {
  const { title, description = '', assignee_id, priority = 'normal', deadline = null, start_at = null, participant_ids = [] } = req.body || {};
  if (!title || !assignee_id) return res.status(400).json({ error: 'عنوان و مسئول انجام الزامی است' });
  const assigneeId = Number(assignee_id);
  if (!canAssignTo(req.user, assigneeId)) {
    return res.status(403).json({ error: 'شما مجاز به واگذاری تسک به این کاربر نیستید' });
  }
  const result = db.prepare('INSERT INTO tasks (title, description, assigner_id, assignee_id, priority, deadline, start_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(title, description, req.user.id, assigneeId, priority, deadline, start_at);
  const taskId = result.lastInsertRowid;
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
  const { title, description, status, priority, deadline, start_at, participant_ids } = req.body || {};
  const newStatus = status ?? t.status;
  db.prepare(`UPDATE tasks SET title = ?, description = ?, status = ?, priority = ?, deadline = ?, start_at = ?,
    completed_at = CASE WHEN ? = 'done' AND status != 'done' THEN datetime('now') WHEN ? != 'done' THEN NULL ELSE completed_at END
    WHERE id = ?`)
    .run(title ?? t.title, description ?? t.description, newStatus, priority ?? t.priority,
      deadline !== undefined ? deadline : t.deadline,
      start_at !== undefined ? start_at : t.start_at, newStatus, newStatus, t.id);
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

// ---------- کامنت‌ها و پیگیری ----------
r.get('/:id/comments', (req, res) => {
  const t = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!t) return res.status(404).json({ error: 'تسک یافت نشد' });
  if (!canSeeTask(req.user, t)) return res.status(403).json({ error: 'دسترسی غیرمجاز' });
  const comments = db.prepare(`
    SELECT c.*, u.full_name AS author_name, u.avatar_color AS author_color, u.avatar_path AS author_avatar
    FROM task_comments c LEFT JOIN users u ON u.id = c.user_id
    WHERE c.task_id = ? ORDER BY c.id`).all(t.id);
  // با باز کردن گفتگوی تسک، همهٔ کامنت‌ها برای این کاربر «خوانده‌شده» می‌شوند
  markCommentsRead(t.id, req.user.id);
  res.json({ comments });
});

r.post('/:id/comments', (req, res) => {
  const t = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!t) return res.status(404).json({ error: 'تسک یافت نشد' });
  if (!canSeeTask(req.user, t)) return res.status(403).json({ error: 'دسترسی غیرمجاز' });
  const body = String(req.body?.body || '').trim();
  if (!body) return res.status(400).json({ error: 'متن کامنت خالی است' });
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
    title: `کامنت جدید در تسک: ${t.title}`,
    body: `${req.user.full_name}: ${body.slice(0, 80)}`,
    link: `/tasks?task=${t.id}`,
  });
  res.json({ comment });
});

export default r;
