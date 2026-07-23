import { Router } from 'express';
import db from '../db.js';
import { notifyUser } from '../notify.js';

const r = Router();

const SELECT = `
  SELECT dg.*, f.full_name AS from_name, f.avatar_color AS from_color, f.avatar_path AS from_avatar,
         t.full_name AS to_name, t.avatar_color AS to_color, t.avatar_path AS to_avatar
  FROM delegations dg
  JOIN users f ON f.id = dg.from_user
  JOIN users t ON t.id = dg.to_user`;

// آیا این نیابت هم‌اکنون فعال است؟ (با درنظرگرفتن بازهٔ زمانی)
export function delegationActiveNow(dg, now = Date.now()) {
  if (!dg.is_active) return false;
  if (dg.starts_at && new Date(dg.starts_at).getTime() > now) return false;
  if (dg.ends_at && new Date(dg.ends_at).getTime() < now) return false;
  return true;
}

// همهٔ کاربرانی که هم‌اکنون به‌نیابت از userId می‌توانند اقدام کنند
export function activeDeputiesOf(userId, now = Date.now()) {
  const rows = db.prepare('SELECT * FROM delegations WHERE from_user = ? AND is_active = 1').all(userId);
  return rows.filter(d => delegationActiveNow(d, now)).map(d => d.to_user);
}

// نیابت‌هایی که من ساخته‌ام (from = من) + نیابت‌هایی که من نایبِ آن هستم (to = من)
r.get('/', (req, res) => {
  const mine = db.prepare(`${SELECT} WHERE dg.from_user = ? ORDER BY dg.id DESC`).all(req.user.id);
  const toMe = db.prepare(`${SELECT} WHERE dg.to_user = ? ORDER BY dg.id DESC`).all(req.user.id);
  const now = Date.now();
  const stamp = (l) => l.map(d => ({ ...d, active_now: delegationActiveNow(d, now) }));
  res.json({ mine: stamp(mine), toMe: stamp(toMe) });
});

r.post('/', (req, res) => {
  const b = req.body || {};
  const isAdmin = req.user.role === 'admin';
  // کاربر عادی فقط برای خودش نیابت تعریف می‌کند؛ مدیر سامانه برای هر کسی
  const fromUser = isAdmin && b.from_user ? Number(b.from_user) : req.user.id;
  const toUser = Number(b.to_user);
  if (!toUser) return res.status(400).json({ error: 'جانشین را انتخاب کنید' });
  if (toUser === fromUser) return res.status(400).json({ error: 'جانشین نمی‌تواند خودِ فرد باشد' });
  const to = db.prepare('SELECT id FROM users WHERE id = ? AND is_active = 1').get(toUser);
  if (!to) return res.status(400).json({ error: 'کاربرِ جانشین معتبر نیست' });
  const result = db.prepare(`INSERT INTO delegations (from_user, to_user, reason, starts_at, ends_at, created_by)
    VALUES (?, ?, ?, ?, ?, ?)`).run(
    fromUser, toUser, String(b.reason || '').slice(0, 300),
    b.starts_at || null, b.ends_at || null, req.user.id);
  const from = db.prepare('SELECT full_name FROM users WHERE id = ?').get(fromUser);
  notifyUser(toUser, {
    type: 'workflow',
    title: 'شما جانشینِ تاییدها شدید',
    body: `از این پس درخواست‌های در انتظار «${from?.full_name || 'یک کاربر'}» در کارتابل شما نیز نمایش داده می‌شود`,
    link: '/cartable',
  });
  res.json({ id: result.lastInsertRowid });
});

r.put('/:id', (req, res) => {
  const dg = db.prepare('SELECT * FROM delegations WHERE id = ?').get(req.params.id);
  if (!dg) return res.status(404).json({ error: 'نیابت یافت نشد' });
  if (dg.from_user !== req.user.id && dg.created_by !== req.user.id && req.user.role !== 'admin')
    return res.status(403).json({ error: 'دسترسی غیرمجاز' });
  const b = req.body || {};
  db.prepare('UPDATE delegations SET is_active = ?, reason = ?, starts_at = ?, ends_at = ? WHERE id = ?').run(
    b.is_active !== undefined ? (b.is_active ? 1 : 0) : dg.is_active,
    b.reason !== undefined ? String(b.reason).slice(0, 300) : dg.reason,
    b.starts_at !== undefined ? (b.starts_at || null) : dg.starts_at,
    b.ends_at !== undefined ? (b.ends_at || null) : dg.ends_at,
    dg.id);
  res.json({ ok: true });
});

r.delete('/:id', (req, res) => {
  const dg = db.prepare('SELECT * FROM delegations WHERE id = ?').get(req.params.id);
  if (!dg) return res.status(404).json({ error: 'نیابت یافت نشد' });
  if (dg.from_user !== req.user.id && dg.created_by !== req.user.id && req.user.role !== 'admin')
    return res.status(403).json({ error: 'دسترسی غیرمجاز' });
  db.prepare('DELETE FROM delegations WHERE id = ?').run(dg.id);
  res.json({ ok: true });
});

export default r;
