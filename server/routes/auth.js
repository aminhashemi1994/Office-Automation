import { Router } from 'express';
import bcrypt from 'bcryptjs';
import db from '../db.js';
import { signToken, authMiddleware, userPerms } from '../auth.js';

const r = Router();

function publicUser(u) {
  const { password_hash, permissions, signature_path, ...rest } = u;
  return {
    ...rest,
    permissions: userPerms(u),
    has_signature: !!(signature_path && signature_path.length),
    ringtone_path: u.ringtone_path || '',
    notif_sound_path: u.notif_sound_path || '',
  };
}

r.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(String(username || '').trim());
  if (!user || !user.is_active || !bcrypt.compareSync(String(password || ''), user.password_hash)) {
    return res.status(401).json({ error: 'نام کاربری یا رمز عبور اشتباه است' });
  }
  res.json({ token: signToken(user), user: publicUser(user) });
});

r.get('/me', authMiddleware, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

r.post('/change-password', authMiddleware, (req, res) => {
  const { current, next } = req.body || {};
  if (!bcrypt.compareSync(String(current || ''), req.user.password_hash)) {
    return res.status(400).json({ error: 'رمز عبور فعلی اشتباه است' });
  }
  if (!next || String(next).length < 6) return res.status(400).json({ error: 'رمز جدید باید حداقل ۶ کاراکتر باشد' });
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(String(next), 10), req.user.id);
  res.json({ ok: true });
});

export default r;
