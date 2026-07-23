import { Router } from 'express';
import db from '../db.js';

const r = Router();

// همهٔ یادداشت‌های خودِ کاربر — سنجاق‌شده‌ها اول، سپس جدیدترین
r.get('/', (req, res) => {
  const notes = db.prepare(
    'SELECT * FROM notes WHERE user_id = ? ORDER BY pinned DESC, done ASC, id DESC'
  ).all(req.user.id);
  res.json({ notes });
});

function clean(body) {
  const title = String(body.title ?? '').slice(0, 200);
  // فرانت‌اند متن را با کلید text می‌فرستد؛ سازگاری با body هم حفظ می‌شود
  const text = String(body.text ?? body.body ?? '').slice(0, 5000);
  const color = /^#[0-9a-fA-F]{6}$/.test(body.color || '') ? body.color : '#fde68a';
  const remind_at = body.remind_at ? String(body.remind_at) : null;
  return { title, text, color, remind_at };
}

r.post('/', (req, res) => {
  const b = req.body || {};
  const { title, text, color, remind_at } = clean(b);
  if (!title && !text) return res.status(400).json({ error: 'عنوان یا متن یادداشت را وارد کنید' });
  const result = db.prepare(
    'INSERT INTO notes (user_id, title, body, color, pinned, remind_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(req.user.id, title, text, color, b.pinned ? 1 : 0, remind_at);
  const note = db.prepare('SELECT * FROM notes WHERE id = ?').get(result.lastInsertRowid);
  res.json({ note });
});

r.put('/:id', (req, res) => {
  const note = db.prepare('SELECT * FROM notes WHERE id = ?').get(req.params.id);
  if (!note || note.user_id !== req.user.id) return res.status(404).json({ error: 'یادداشت یافت نشد' });
  const b = req.body || {};
  const { title, text, color, remind_at } = clean({ ...note, ...b });
  const pinned = b.pinned !== undefined ? (b.pinned ? 1 : 0) : note.pinned;
  const done = b.done !== undefined ? (b.done ? 1 : 0) : note.done;
  // اگر زمان یادآوری تغییر کرد، پرچمِ «یادآوری‌شده» ریست می‌شود تا دوباره اعلام شود
  const reminded = (remind_at !== note.remind_at) ? 0 : note.reminded;
  db.prepare(`UPDATE notes SET title = ?, body = ?, color = ?, pinned = ?, done = ?,
    remind_at = ?, reminded = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(title, text, color, pinned, done, remind_at, reminded, note.id);
  res.json({ note: db.prepare('SELECT * FROM notes WHERE id = ?').get(note.id) });
});

r.delete('/:id', (req, res) => {
  const note = db.prepare('SELECT * FROM notes WHERE id = ?').get(req.params.id);
  if (!note || note.user_id !== req.user.id) return res.status(404).json({ error: 'یادداشت یافت نشد' });
  db.prepare('DELETE FROM notes WHERE id = ?').run(note.id);
  res.json({ ok: true });
});

export default r;
