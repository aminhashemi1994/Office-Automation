import { Router } from 'express';
import db from '../db.js';

const r = Router();

r.get('/', (req, res) => {
  const notifications = db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 100').all(req.user.id);
  const unread = db.prepare('SELECT COUNT(*) c FROM notifications WHERE user_id = ? AND is_read = 0').get(req.user.id).c;
  res.json({ notifications, unread });
});

r.post('/read-all', (req, res) => {
  db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').run(req.user.id);
  res.json({ ok: true });
});

r.post('/:id/read', (req, res) => {
  db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  res.json({ ok: true });
});

// حذف چندتایی: { ids: [...] } — فقط اعلان‌های خود کاربر
r.post('/delete', (req, res) => {
  const ids = (req.body?.ids || []).map(Number).filter(Number.isInteger);
  if (!ids.length) return res.status(400).json({ error: 'شناسه‌ای ارسال نشده است' });
  const ph = ids.map(() => '?').join(',');
  const result = db.prepare(`DELETE FROM notifications WHERE user_id = ? AND id IN (${ph})`).run(req.user.id, ...ids);
  res.json({ ok: true, deleted: result.changes });
});

// حذف همه اعلان‌های کاربر
r.post('/delete-all', (req, res) => {
  const result = db.prepare('DELETE FROM notifications WHERE user_id = ?').run(req.user.id);
  res.json({ ok: true, deleted: result.changes });
});

// حذف تکی
r.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM notifications WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  res.json({ ok: true });
});

export default r;
