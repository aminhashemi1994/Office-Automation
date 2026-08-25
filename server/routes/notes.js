// ============================================================================
//  یادداشت‌ها
//  هر یادداشت مالِ سازندهٔ آن است و می‌تواند با هر تعداد همکار به اشتراک گذاشته
//  شود — یا فقط برای خواندن، یا با اجازهٔ ویرایش. ترتیبِ نمایش هم دستیِ کاربر است.
// ============================================================================
import { Router } from 'express';
import db from '../db.js';
import { notifyUsers } from '../notify.js';

const r = Router();

const NOTE_SELECT = `
  SELECT n.*, u.full_name AS owner_name, u.avatar_color AS owner_color,
    (SELECT COUNT(*) FROM note_shares s WHERE s.note_id = n.id) AS share_count
  FROM notes n LEFT JOIN users u ON u.id = n.user_id`;

function sharesOf(noteId) {
  return db.prepare(`SELECT s.user_id, s.can_edit, u.full_name, u.avatar_color
    FROM note_shares s JOIN users u ON u.id = s.user_id
    WHERE s.note_id = ? ORDER BY u.full_name`).all(noteId);
}

// یادداشت را برمی‌گرداند به‌همراه اینکه این کاربر چه اجازه‌ای روی آن دارد
function access(noteId, userId) {
  const n = db.prepare('SELECT * FROM notes WHERE id = ?').get(noteId);
  if (!n) return null;
  if (n.user_id === userId) return { note: n, owner: true, canEdit: true };
  const sh = db.prepare('SELECT * FROM note_shares WHERE note_id = ? AND user_id = ?').get(noteId, userId);
  if (!sh) return null;
  return { note: n, owner: false, canEdit: sh.can_edit === 1 };
}

// یادداشت‌های خودم + آنچه همکاران با من به اشتراک گذاشته‌اند
r.get('/', (req, res) => {
  const own = db.prepare(`${NOTE_SELECT} WHERE n.user_id = ?
    ORDER BY n.pinned DESC, n.done ASC, n.sort_order, n.id DESC`).all(req.user.id)
    .map(n => ({ ...n, is_owner: 1, can_edit: 1, shares: sharesOf(n.id) }));
  const shared = db.prepare(`${NOTE_SELECT}
    JOIN note_shares s ON s.note_id = n.id AND s.user_id = ?
    ORDER BY n.pinned DESC, n.done ASC, n.id DESC`).all(req.user.id)
    .map(n => ({ ...n, is_owner: 0, can_edit: db.prepare('SELECT can_edit FROM note_shares WHERE note_id = ? AND user_id = ?')
      .get(n.id, req.user.id)?.can_edit || 0, shares: [] }));
  res.json({ notes: [...own, ...shared], own_count: own.length, shared_count: shared.length });
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
  const min = db.prepare('SELECT COALESCE(MIN(sort_order), 0) m FROM notes WHERE user_id = ?').get(req.user.id).m;
  const result = db.prepare(
    'INSERT INTO notes (user_id, title, body, color, pinned, remind_at, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(req.user.id, title, text, color, b.pinned ? 1 : 0, remind_at, min - 1);
  const note = db.prepare('SELECT * FROM notes WHERE id = ?').get(result.lastInsertRowid);
  res.json({ note });
});

r.put('/:id', (req, res) => {
  const a = access(Number(req.params.id), req.user.id);
  if (!a) return res.status(404).json({ error: 'یادداشت یافت نشد' });
  if (!a.canEdit) return res.status(403).json({ error: 'این یادداشت فقط برای خواندن با شما به اشتراک گذاشته شده است' });
  const note = a.note;
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
  const a = access(Number(req.params.id), req.user.id);
  if (!a) return res.status(404).json({ error: 'یادداشت یافت نشد' });
  // گیرندهٔ اشتراک با «حذف»، فقط اشتراکِ خودش را برمی‌دارد و اصلِ یادداشت می‌ماند
  if (!a.owner) {
    db.prepare('DELETE FROM note_shares WHERE note_id = ? AND user_id = ?').run(a.note.id, req.user.id);
    return res.json({ ok: true, unshared: true });
  }
  db.prepare('DELETE FROM notes WHERE id = ?').run(a.note.id);
  res.json({ ok: true });
});

// جابه‌جایی ترتیبِ یادداشت‌های خودم
r.post('/reorder', (req, res) => {
  const ids = (req.body?.ids || []).map(Number).filter(Boolean);
  const upd = db.prepare('UPDATE notes SET sort_order = ? WHERE id = ? AND user_id = ?');
  ids.forEach((id, i) => upd.run(i + 1, id, req.user.id));
  res.json({ ok: true });
});

// ---------- اشتراک‌گذاری ----------
r.get('/:id/shares', (req, res) => {
  const a = access(Number(req.params.id), req.user.id);
  if (!a) return res.status(404).json({ error: 'یادداشت یافت نشد' });
  res.json({ shares: sharesOf(a.note.id) });
});

// فهرست کاملِ گیرندگان را جایگزین می‌کند: هر که در فهرست نباشد، اشتراکش برداشته می‌شود
r.post('/:id/shares', (req, res) => {
  const a = access(Number(req.params.id), req.user.id);
  if (!a) return res.status(404).json({ error: 'یادداشت یافت نشد' });
  if (!a.owner) return res.status(403).json({ error: 'فقط سازندهٔ یادداشت می‌تواند آن را به اشتراک بگذارد' });
  const list = Array.isArray(req.body?.shares) ? req.body.shares : [];
  const clean = list
    .map(s => ({ user_id: Number(s.user_id), can_edit: s.can_edit ? 1 : 0 }))
    .filter(s => s.user_id && s.user_id !== req.user.id);
  const before = sharesOf(a.note.id).map(s => s.user_id);
  db.prepare('DELETE FROM note_shares WHERE note_id = ?').run(a.note.id);
  const ins = db.prepare('INSERT OR REPLACE INTO note_shares (note_id, user_id, can_edit) VALUES (?, ?, ?)');
  for (const s of clean) {
    if (!db.prepare('SELECT 1 FROM users WHERE id = ? AND is_active = 1').get(s.user_id)) continue;
    ins.run(a.note.id, s.user_id, s.can_edit);
  }
  const added = clean.map(s => s.user_id).filter(id => !before.includes(id));
  notifyUsers(added, {
    type: 'info',
    title: 'یادداشت مشترک',
    body: `${req.user.full_name} یادداشت «${a.note.title || 'بدون عنوان'}» را با شما به اشتراک گذاشت`,
    link: '/notes',
  });
  res.json({ shares: sharesOf(a.note.id) });
});

export default r;
