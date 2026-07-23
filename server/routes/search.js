import { Router } from 'express';
import db from '../db.js';
import { hasPerm } from '../auth.js';
import { resolveApprovers } from './workflows.js';

const r = Router();

r.get('/', (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.json({ users: [], messages: [], requests: [], tasks: [], departments: [], files: [] });
  const like = `%${q}%`;
  const me = req.user;

  // کاربران
  const users = db.prepare(`
    SELECT u.id, u.full_name, u.username, u.position, u.avatar_color, u.avatar_path, d.name AS department_name
    FROM users u LEFT JOIN departments d ON d.id = u.department_id
    WHERE u.is_active = 1 AND (u.full_name LIKE ? OR u.username LIKE ? OR u.position LIKE ?)
    LIMIT 8`).all(like, like, like);

  // پیام‌ها — فقط در گفتگوهایی که کاربر عضو آنهاست
  const messages = db.prepare(`
    SELECT m.id, m.conversation_id, m.content, m.created_at, u.full_name AS sender_name,
           c.type AS conv_type, c.name AS conv_name
    FROM messages m
    JOIN conversation_members cm ON cm.conversation_id = m.conversation_id AND cm.user_id = ?
    JOIN users u ON u.id = m.sender_id
    JOIN conversations c ON c.id = m.conversation_id
    WHERE m.deleted = 0 AND m.content LIKE ?
    ORDER BY m.id DESC LIMIT 10`).all(me.id, like);

  // فایل‌ها — در گفتگوهای کاربر یا آپلودشده توسط خودش
  const files = db.prepare(`
    SELECT DISTINCT f.id, f.original_name, f.size, f.created_at, u.full_name AS uploader_name
    FROM files f
    JOIN users u ON u.id = f.uploader_id
    LEFT JOIN messages m ON m.file_id = f.id
    LEFT JOIN conversation_members cm ON cm.conversation_id = m.conversation_id AND cm.user_id = ?
    WHERE f.original_name LIKE ? AND (f.uploader_id = ? OR cm.user_id IS NOT NULL)
    ORDER BY f.id DESC LIMIT 8`).all(me.id, like, me.id);

  // درخواست‌های کارتابل — فقط موارد قابل مشاهده برای کاربر
  const canManage = hasPerm(me, 'workflows.manage');
  const reqRows = db.prepare(`
    SELECT r.*, t.name AS template_name, u.full_name AS requester_name
    FROM workflow_requests r
    JOIN workflow_templates t ON t.id = r.template_id
    JOIN users u ON u.id = r.requester_id
    WHERE r.title LIKE ? OR t.name LIKE ? OR u.full_name LIKE ?
    ORDER BY r.id DESC LIMIT 40`).all(like, like, like);
  const requests = reqRows.filter(rq => {
    if (canManage || rq.requester_id === me.id) return true;
    const acted = db.prepare('SELECT 1 FROM workflow_actions WHERE request_id = ? AND actor_id = ?').get(rq.id, me.id);
    if (acted) return true;
    if (rq.status === 'in_progress') {
      const step = db.prepare('SELECT * FROM workflow_steps WHERE template_id = ? AND step_order = ?')
        .get(rq.template_id, rq.current_step);
      if (step && resolveApprovers(step, rq.requester_id).includes(me.id)) return true;
    }
    return false;
  }).slice(0, 8);

  // تسک‌ها — مربوط به خود کاربر (مدیر سامانه: همه)
  const tasks = me.role === 'admin'
    ? db.prepare(`
        SELECT t.*, a.full_name AS assigner_name, b.full_name AS assignee_name
        FROM tasks t JOIN users a ON a.id = t.assigner_id JOIN users b ON b.id = t.assignee_id
        WHERE t.title LIKE ? OR t.description LIKE ?
        ORDER BY t.id DESC LIMIT 8`).all(like, like)
    : db.prepare(`
        SELECT t.*, a.full_name AS assigner_name, b.full_name AS assignee_name
        FROM tasks t JOIN users a ON a.id = t.assigner_id JOIN users b ON b.id = t.assignee_id
        WHERE (t.assigner_id = ? OR t.assignee_id = ?) AND (t.title LIKE ? OR t.description LIKE ?)
        ORDER BY t.id DESC LIMIT 8`).all(me.id, me.id, like, like);

  // واحدها
  const departments = db.prepare(`
    SELECT d.id, d.name, d.description, m.full_name AS manager_name
    FROM departments d LEFT JOIN users m ON m.id = d.manager_id
    WHERE d.name LIKE ? OR d.description LIKE ? LIMIT 6`).all(like, like);

  res.json({ users, messages, requests, tasks, departments, files });
});

export default r;
