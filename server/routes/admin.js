import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import db from '../db.js';
import { requirePerm, hasPerm } from '../auth.js';
import { AVATARS_DIR, SIGNATURES_DIR, SOUNDS_DIR } from '../config.js';

const r = Router();

const AVATAR_COLORS = ['#2563eb', '#7c3aed', '#db2777', '#dc2626', '#ea580c', '#16a34a', '#0d9488', '#4f46e5'];

const avatarUpload = multer({
  storage: multer.diskStorage({
    destination: AVATARS_DIR,
    filename: (req, file, cb) => cb(null, crypto.randomBytes(12).toString('hex') + (path.extname(file.originalname) || '.jpg')),
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, /^image\//.test(file.mimetype)),
});

const signatureUpload = multer({
  storage: multer.diskStorage({
    destination: SIGNATURES_DIR,
    filename: (req, file, cb) => cb(null, 'sig_' + crypto.randomBytes(16).toString('hex') + (path.extname(file.originalname) || '.png')),
  }),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, /^image\//.test(file.mimetype)),
});

const soundUpload = multer({
  storage: multer.diskStorage({
    destination: SOUNDS_DIR,
    filename: (req, file, cb) => cb(null, 'snd_' + crypto.randomBytes(14).toString('hex') + (path.extname(file.originalname) || '.mp3')),
  }),
  limits: { fileSize: 3 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, /audio\/|\.mp3$/i.test(file.mimetype) || /\.mp3$/i.test(file.originalname)),
});

// آپلود صدای دلخواه (زنگ تماس یا اعلان) — فقط برای خودِ کاربر
// kind: 'ringtone' | 'notif'
function soundColumn(kind) { return kind === 'ringtone' ? 'ringtone_path' : 'notif_sound_path'; }
r.post('/users/:id/sound/:kind', soundUpload.single('sound'), (req, res) => {
  const targetId = Number(req.params.id);
  const kind = req.params.kind === 'ringtone' ? 'ringtone' : 'notif';
  if (req.user.id !== targetId) {
    if (req.file) { try { fs.unlinkSync(req.file.path); } catch {} }
    return res.status(403).json({ error: 'هر کاربر فقط می‌تواند صدای خودش را تنظیم کند' });
  }
  if (!req.file) return res.status(400).json({ error: 'فایل صوتی معتبر (mp3) ارسال نشده است' });
  const col = soundColumn(kind);
  const prev = db.prepare(`SELECT ${col} AS p FROM users WHERE id = ?`).get(targetId)?.p;
  if (prev) { try { fs.unlinkSync(path.join(SOUNDS_DIR, prev)); } catch {} }
  db.prepare(`UPDATE users SET ${col} = ? WHERE id = ?`).run(req.file.filename, targetId);
  res.json({ ok: true, path: req.file.filename });
});

r.delete('/users/:id/sound/:kind', (req, res) => {
  const targetId = Number(req.params.id);
  const kind = req.params.kind === 'ringtone' ? 'ringtone' : 'notif';
  if (req.user.id !== targetId && !hasPerm(req.user, 'users.manage')) {
    return res.status(403).json({ error: 'دسترسی غیرمجاز' });
  }
  const col = soundColumn(kind);
  const prev = db.prepare(`SELECT ${col} AS p FROM users WHERE id = ?`).get(targetId)?.p;
  if (prev) { try { fs.unlinkSync(path.join(SOUNDS_DIR, prev)); } catch {} }
  db.prepare(`UPDATE users SET ${col} = '' WHERE id = ?`).run(targetId);
  res.json({ ok: true });
});

// ---------- users ----------
r.get('/users', (req, res) => {
  const users = db.prepare(`
    SELECT u.id, u.username, u.full_name, u.role, u.department_id, u.position, u.phone, u.email,
           u.avatar_color, u.avatar_path, u.is_active, u.permissions, d.name AS department_name,
           (u.signature_path IS NOT NULL AND u.signature_path != '') AS has_signature
    FROM users u LEFT JOIN departments d ON d.id = u.department_id
    ORDER BY u.full_name`).all();
  // واحدهایی که هر کاربر مدیرشان است (جدول چندمدیره)
  const mgr = db.prepare('SELECT department_id FROM department_managers WHERE user_id = ?');
  for (const u of users) u.managed_dept_ids = mgr.all(u.id).map(r => r.department_id);
  res.json({ users });
});

// آپلود امضای تصویری — فقط و فقط خودِ کاربر می‌تواند امضای خودش را بگذارد.
// حتی مدیر سامانه هم نمی‌تواند امضای فردِ دیگری را آپلود کند (ضدجعل).
r.post('/users/:id/signature', signatureUpload.single('signature'), (req, res) => {
  const targetId = Number(req.params.id);
  if (req.user.id !== targetId) {
    // فایل آپلودشده را دور بریز
    if (req.file) { try { fs.unlinkSync(req.file.path); } catch {} }
    return res.status(403).json({ error: 'هر کاربر فقط می‌تواند امضای خودش را ثبت کند' });
  }
  if (!req.file) return res.status(400).json({ error: 'تصویری ارسال نشده است (فرمت باید عکس باشد)' });
  const u = db.prepare('SELECT signature_path FROM users WHERE id = ?').get(targetId);
  if (u?.signature_path) { try { fs.unlinkSync(path.join(SIGNATURES_DIR, u.signature_path)); } catch {} }
  db.prepare('UPDATE users SET signature_path = ? WHERE id = ?').run(req.file.filename, targetId);
  res.json({ ok: true, has_signature: true });
});

// پیش‌نمایش امضای خودِ کاربر — فقط خودش (برای نمایش در پروفایل)
r.get('/users/:id/signature', (req, res) => {
  const targetId = Number(req.params.id);
  if (req.user.id !== targetId) return res.status(403).json({ error: 'دسترسی غیرمجاز' });
  const u = db.prepare('SELECT signature_path FROM users WHERE id = ?').get(targetId);
  if (!u?.signature_path) return res.status(404).json({ error: 'امضایی ثبت نشده است' });
  const p = path.join(SIGNATURES_DIR, u.signature_path);
  if (!fs.existsSync(p)) return res.status(404).json({ error: 'فایل امضا یافت نشد' });
  res.setHeader('Cache-Control', 'private, no-store');
  res.sendFile(p);
});

// حذف امضا — خودِ کاربر یا مدیر سامانه (مدیر فقط می‌تواند «باطل» کند، نه جایگزین)
r.delete('/users/:id/signature', (req, res) => {
  const targetId = Number(req.params.id);
  if (req.user.id !== targetId && !hasPerm(req.user, 'users.manage')) {
    return res.status(403).json({ error: 'دسترسی غیرمجاز' });
  }
  const u = db.prepare('SELECT signature_path FROM users WHERE id = ?').get(targetId);
  if (u?.signature_path) { try { fs.unlinkSync(path.join(SIGNATURES_DIR, u.signature_path)); } catch {} }
  db.prepare("UPDATE users SET signature_path = '' WHERE id = ?").run(targetId);
  res.json({ ok: true });
});

// آپلود عکس پروفایل — خود کاربر یا مدیر کاربران
r.post('/users/:id/avatar', avatarUpload.single('avatar'), (req, res) => {
  const targetId = Number(req.params.id);
  if (req.user.id !== targetId && !hasPerm(req.user, 'users.manage')) {
    return res.status(403).json({ error: 'دسترسی غیرمجاز' });
  }
  if (!req.file) return res.status(400).json({ error: 'تصویری ارسال نشده است (فرمت باید عکس باشد)' });
  const u = db.prepare('SELECT avatar_path FROM users WHERE id = ?').get(targetId);
  if (!u) return res.status(404).json({ error: 'کاربر یافت نشد' });
  // حذف عکس قبلی
  if (u.avatar_path) { try { fs.unlinkSync(path.join(AVATARS_DIR, u.avatar_path)); } catch {} }
  db.prepare('UPDATE users SET avatar_path = ? WHERE id = ?').run(req.file.filename, targetId);
  res.json({ avatar_path: req.file.filename });
});

// حذف عکس پروفایل
r.delete('/users/:id/avatar', (req, res) => {
  const targetId = Number(req.params.id);
  if (req.user.id !== targetId && !hasPerm(req.user, 'users.manage')) {
    return res.status(403).json({ error: 'دسترسی غیرمجاز' });
  }
  const u = db.prepare('SELECT avatar_path FROM users WHERE id = ?').get(targetId);
  if (u?.avatar_path) { try { fs.unlinkSync(path.join(AVATARS_DIR, u.avatar_path)); } catch {} }
  db.prepare("UPDATE users SET avatar_path = '' WHERE id = ?").run(targetId);
  res.json({ ok: true });
});

// همگام‌سازی واحدهایی که این کاربر مدیرشان است (جدول چندمدیره)
function syncManagedDepts(userId, deptIds) {
  if (!Array.isArray(deptIds)) return;
  db.prepare('DELETE FROM department_managers WHERE user_id = ?').run(userId);
  const ins = db.prepare('INSERT OR IGNORE INTO department_managers (department_id, user_id) VALUES (?, ?)');
  for (const did of deptIds) { const n = Number(did); if (n) ins.run(n, userId); }
}

r.post('/users', requirePerm('users.manage'), (req, res) => {
  const { username, password, full_name, role = 'employee', department_id = null, position = '', phone = '', email = '', permissions = [], managed_dept_ids } = req.body || {};
  if (!username || !password || !full_name) return res.status(400).json({ error: 'نام کاربری، رمز عبور و نام کامل الزامی است' });
  if (db.prepare('SELECT id FROM users WHERE username = ?').get(username)) {
    return res.status(400).json({ error: 'این نام کاربری قبلاً ثبت شده است' });
  }
  const color = AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];
  const result = db.prepare(`INSERT INTO users (username, password_hash, full_name, role, department_id, position, phone, email, avatar_color, permissions)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    String(username).trim(), bcrypt.hashSync(String(password), 10), full_name, role,
    department_id || null, position, phone, email, color, JSON.stringify(permissions));
  syncManagedDepts(result.lastInsertRowid, managed_dept_ids);
  res.json({ id: result.lastInsertRowid });
});

// حذف کامل کاربر — فقط مدیر سامانه؛ همه داده‌های وابسته پاک می‌شود
r.delete('/users/:id', requirePerm('users.manage'), (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!u) return res.status(404).json({ error: 'کاربر یافت نشد' });
  if (u.id === req.user.id) return res.status(400).json({ error: 'نمی‌توانید حساب خودتان را حذف کنید' });
  if (u.role === 'admin') {
    const admins = db.prepare("SELECT COUNT(*) c FROM users WHERE role = 'admin' AND is_active = 1").get().c;
    if (admins <= 1) return res.status(400).json({ error: 'آخرین مدیر سامانه قابل حذف نیست' });
  }
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM messages WHERE sender_id = ?').run(u.id);
    db.prepare('UPDATE files SET uploader_id = NULL WHERE uploader_id = ?').run(u.id);
    db.prepare('DELETE FROM tasks WHERE assigner_id = ? OR assignee_id = ?').run(u.id, u.id);
    db.prepare('DELETE FROM workflow_requests WHERE requester_id = ?').run(u.id);
    db.prepare('DELETE FROM workflow_actions WHERE actor_id = ?').run(u.id);
    db.prepare('UPDATE departments SET manager_id = NULL WHERE manager_id = ?').run(u.id);
    db.prepare('UPDATE conversations SET created_by = NULL WHERE created_by = ?').run(u.id);
    db.prepare('UPDATE workflow_templates SET created_by = NULL WHERE created_by = ?').run(u.id);
    db.prepare('DELETE FROM users WHERE id = ?').run(u.id); // notifications و عضویت گفتگوها cascade می‌شوند
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  res.json({ ok: true });
});

r.put('/users/:id', requirePerm('users.manage'), (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!u) return res.status(404).json({ error: 'کاربر یافت نشد' });
  const { full_name, role, department_id, position, phone, email, is_active, password, permissions, managed_dept_ids } = req.body || {};
  db.prepare(`UPDATE users SET full_name = ?, role = ?, department_id = ?, position = ?, phone = ?, email = ?, is_active = ?, permissions = ? WHERE id = ?`)
    .run(full_name ?? u.full_name, role ?? u.role, department_id !== undefined ? department_id : u.department_id,
      position ?? u.position, phone ?? u.phone, email ?? u.email,
      is_active !== undefined ? (is_active ? 1 : 0) : u.is_active,
      permissions !== undefined ? JSON.stringify(permissions) : u.permissions, u.id);
  if (password) db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(String(password), 10), u.id);
  if (managed_dept_ids !== undefined) syncManagedDepts(u.id, managed_dept_ids);
  res.json({ ok: true });
});

// ---------- departments ----------
r.get('/departments', (req, res) => {
  const departments = db.prepare(`
    SELECT d.*, m.full_name AS manager_name,
      (SELECT COUNT(*) FROM users u WHERE u.department_id = d.id AND u.is_active = 1) AS member_count
    FROM departments d LEFT JOIN users m ON m.id = d.manager_id
    ORDER BY d.id`).all();
  // فهرست کاملِ مدیرانِ هر واحد (چندمدیره)
  const mgrs = db.prepare(`SELECT dm.user_id AS id, u.full_name FROM department_managers dm
    JOIN users u ON u.id = dm.user_id WHERE dm.department_id = ? AND u.is_active = 1`);
  for (const d of departments) d.managers = mgrs.all(d.id);
  res.json({ departments });
});

r.post('/departments', requirePerm('departments.manage'), (req, res) => {
  const { name, description = '', manager_id = null, is_management = false } = req.body || {};
  if (!name) return res.status(400).json({ error: 'نام واحد الزامی است' });
  try {
    const result = db.prepare('INSERT INTO departments (name, description, manager_id, is_management) VALUES (?, ?, ?, ?)')
      .run(name, description, manager_id || null, is_management ? 1 : 0);
    if (manager_id) db.prepare('INSERT OR IGNORE INTO department_managers (department_id, user_id) VALUES (?, ?)').run(result.lastInsertRowid, manager_id);
    res.json({ id: result.lastInsertRowid });
  } catch {
    res.status(400).json({ error: 'واحدی با این نام وجود دارد' });
  }
});

r.put('/departments/:id', requirePerm('departments.manage'), (req, res) => {
  const d = db.prepare('SELECT * FROM departments WHERE id = ?').get(req.params.id);
  if (!d) return res.status(404).json({ error: 'واحد یافت نشد' });
  const { name, description, manager_id, is_management } = req.body || {};
  db.prepare('UPDATE departments SET name = ?, description = ?, manager_id = ?, is_management = ? WHERE id = ?')
    .run(name ?? d.name, description ?? d.description,
      manager_id !== undefined ? (manager_id || null) : d.manager_id,
      is_management !== undefined ? (is_management ? 1 : 0) : d.is_management, d.id);
  // مدیر اصلیِ جدید را به جدول چندمدیره هم اضافه کن
  if (manager_id) db.prepare('INSERT OR IGNORE INTO department_managers (department_id, user_id) VALUES (?, ?)').run(d.id, manager_id);
  res.json({ ok: true });
});

r.delete('/departments/:id', requirePerm('departments.manage'), (req, res) => {
  db.prepare('DELETE FROM departments WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

export default r;
