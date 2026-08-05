import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import db from '../db.js';
import { AccessToken } from 'livekit-server-sdk';
import { getIO, notifyUsers } from '../notify.js';
import { UPLOADS_DIR as UPLOAD_DIR, SHARED_FILES_DIR, RECORDINGS_DIR, config } from '../config.js';

// فایل‌های ارسالی کاربران در پوشه sharedfiles ذخیره می‌شوند
const upload = multer({
  storage: multer.diskStorage({
    destination: SHARED_FILES_DIR,
    filename: (req, file, cb) => cb(null, crypto.randomBytes(16).toString('hex') + path.extname(file.originalname)),
  }),
  limits: { fileSize: 100 * 1024 * 1024 },
});

// تاریخ محلی برای نام‌گذاری فایل ضبط — مثل 1403-04-27_14-30-05
function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

// ضبط جلسات/تماس‌ها در پوشه recordings با نامی که تاریخ می‌خورد
const recordUpload = multer({
  storage: multer.diskStorage({
    destination: RECORDINGS_DIR,
    filename: (req, file, cb) => {
      const ext = file.mimetype && file.mimetype.includes('mp4') ? '.mp4' : '.webm';
      cb(null, `record-${stamp()}-${crypto.randomBytes(6).toString('hex')}${ext}`);
    },
  }),
  limits: { fileSize: 500 * 1024 * 1024 },
});

const r = Router();

// ---------- LiveKit: صدور توکن اتصال به اتاق تماس/کنفرانس ----------
// کلاینت پیش از پیوستن به یک تماس، از اینجا توکن می‌گیرد و با آن به سرور LiveKit وصل می‌شود.
// احراز هویت از قبل توسط authMiddleware انجام شده (req.user موجود است).
r.post('/livekit-token', async (req, res) => {
  const room = String(req.body?.room || '').trim();
  if (!room) return res.status(400).json({ error: 'اتاق مشخص نشده است' });
  const u = req.user;
  const at = new AccessToken(config.livekit.apiKey, config.livekit.apiSecret, {
    identity: `user-${u.id}`,
    name: u.full_name,
    // اطلاعات نمایشی (نام و رنگ آواتار) در metadata تا سایر اعضا آن را ببینند
    metadata: JSON.stringify({ user_id: u.id, name: u.full_name, color: u.avatar_color || '#4f46e5' }),
    ttl: '4h',
  });
  at.addGrant({
    room,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
  });
  const token = await at.toJwt();
  res.json({ url: config.livekit.url, token, identity: `user-${u.id}` });
});

function isMember(convId, userId) {
  return !!db.prepare('SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?').get(convId, userId);
}

// آیا a کاربر b را مسدود کرده؟
function hasBlocked(a, b) {
  return !!db.prepare('SELECT 1 FROM blocked_users WHERE blocker_id = ? AND blocked_id = ?').get(a, b);
}
// مسدودسازی در هر جهت بین دو نفر
function blockedBetween(a, b) {
  return !!db.prepare('SELECT 1 FROM blocked_users WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)').get(a, b, b, a);
}

function convWithMeta(c, userId) {
  const members = db.prepare(`
    SELECT u.id, u.full_name, u.avatar_color, u.avatar_path, u.role, cm.is_admin
    FROM conversation_members cm JOIN users u ON u.id = cm.user_id
    WHERE cm.conversation_id = ?`).all(c.id);
  const me = db.prepare('SELECT last_read_message_id, cleared_before FROM conversation_members WHERE conversation_id = ? AND user_id = ?').get(c.id, userId);
  const clearedBefore = me?.cleared_before || 0; // پیام‌های پاک‌شدهٔ من نمایش داده نمی‌شوند
  const last = db.prepare(`
    SELECT m.*, u.full_name AS sender_name FROM messages m JOIN users u ON u.id = m.sender_id
    WHERE m.conversation_id = ? AND m.id > ? AND m.deleted = 0 ORDER BY m.id DESC LIMIT 1`).get(c.id, clearedBefore);
  const unread = db.prepare(`
    SELECT COUNT(*) c FROM messages WHERE conversation_id = ? AND id > ? AND sender_id != ? AND deleted = 0`)
    .get(c.id, Math.max(me?.last_read_message_id || 0, clearedBefore), userId).c;
  let display_name = c.name;
  let other_id = null;
  let is_blocked = false;
  if (c.type === 'dm') {
    const other = members.find(m => m.id !== userId);
    display_name = other ? other.full_name : 'گفتگو';
    other_id = other?.id || null;
    if (other_id) is_blocked = hasBlocked(userId, other_id);
  }
  const meMember = members.find(m => m.id === userId);
  const my_is_admin = !!meMember?.is_admin;
  return { ...c, display_name, other_id, is_blocked, my_is_admin, members, last_message: last || null, unread };
}

// شمارِ کلِ پیام‌های نخواندهٔ کاربر در همهٔ گفتگوها — برای نشانِ کنارِ «گفتگوها» در سایدبار.
// پیام‌های خودِ کاربر و پیام‌هایی که تاریخچه‌شان را پاک کرده شمرده نمی‌شوند.
r.get('/unread-count', (req, res) => {
  const row = db.prepare(`
    SELECT COALESCE(SUM(
      (SELECT COUNT(*) FROM messages m
        WHERE m.conversation_id = cm.conversation_id
          AND m.id > MAX(cm.last_read_message_id, cm.cleared_before)
          AND m.sender_id != cm.user_id AND m.deleted = 0)
    ), 0) AS total
    FROM conversation_members cm
    WHERE cm.user_id = ? AND cm.hidden = 0`).get(req.user.id);
  res.json({ unread: Number(row?.total || 0) });
});

r.get('/conversations', (req, res) => {
  const convs = db.prepare(`
    SELECT c.* FROM conversations c
    JOIN conversation_members cm ON cm.conversation_id = c.id
    WHERE cm.user_id = ? AND cm.hidden = 0
    ORDER BY (SELECT MAX(m.id) FROM messages m WHERE m.conversation_id = c.id) DESC NULLS LAST`).all(req.user.id);
  res.json({ conversations: convs.map(c => convWithMeta(c, req.user.id)) });
});

r.post('/conversations', (req, res) => {
  const { type = 'dm', name = '', member_ids = [] } = req.body || {};
  const memberSet = new Set([req.user.id, ...member_ids.map(Number)]);
  if (type === 'dm') {
    if (memberSet.size !== 2) return res.status(400).json({ error: 'گفتگوی دو نفره باید دقیقاً یک مخاطب داشته باشد' });
    const otherId = [...memberSet].find(id => id !== req.user.id);
    if (blockedBetween(req.user.id, otherId)) return res.status(403).json({ error: 'امکان شروع گفتگو با این کاربر وجود ندارد (مسدود شده)' });
    const existing = db.prepare(`
      SELECT c.id FROM conversations c
      JOIN conversation_members a ON a.conversation_id = c.id AND a.user_id = ?
      JOIN conversation_members b ON b.conversation_id = c.id AND b.user_id = ?
      WHERE c.type = 'dm'`).get(req.user.id, otherId);
    if (existing) {
      // اگر قبلاً پنهان شده بود، دوباره نمایش داده شود
      db.prepare('UPDATE conversation_members SET hidden = 0 WHERE conversation_id = ? AND user_id = ?').run(existing.id, req.user.id);
      const c = db.prepare('SELECT * FROM conversations WHERE id = ?').get(existing.id);
      return res.json({ conversation: convWithMeta(c, req.user.id) });
    }
  } else if (type === 'group' || type === 'channel') {
    if (!name) return res.status(400).json({ error: type === 'channel' ? 'نام کانال الزامی است' : 'نام گروه الزامی است' });
  } else {
    return res.status(400).json({ error: 'نوع گفتگو نامعتبر است' });
  }
  const result = db.prepare('INSERT INTO conversations (type, name, created_by) VALUES (?, ?, ?)').run(type, name, req.user.id);
  const insMember = db.prepare('INSERT INTO conversation_members (conversation_id, user_id, is_admin) VALUES (?, ?, ?)');
  for (const id of memberSet) insMember.run(result.lastInsertRowid, id, id === req.user.id ? 1 : 0);
  const c = db.prepare('SELECT * FROM conversations WHERE id = ?').get(result.lastInsertRowid);
  const io = getIO();
  if (io) for (const id of memberSet) io.to(`user:${id}`).emit('conversation:new', convWithMeta(c, id));
  res.json({ conversation: convWithMeta(c, req.user.id) });
});

r.post('/conversations/:id/members', (req, res) => {
  const convId = Number(req.params.id);
  const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(convId);
  if (!conv || (conv.type !== 'group' && conv.type !== 'channel')) return res.status(404).json({ error: 'گفتگو یافت نشد' });
  const me = db.prepare('SELECT * FROM conversation_members WHERE conversation_id = ? AND user_id = ?').get(convId, req.user.id);
  if (!me || (!me.is_admin && req.user.role !== 'admin')) return res.status(403).json({ error: 'فقط مدیر می‌تواند عضو اضافه کند' });
  const { member_ids = [] } = req.body || {};
  const ins = db.prepare('INSERT OR IGNORE INTO conversation_members (conversation_id, user_id) VALUES (?, ?)');
  for (const id of member_ids) ins.run(convId, Number(id));
  const io = getIO();
  if (io) for (const id of member_ids) io.to(`user:${id}`).emit('conversation:new', convWithMeta(conv, Number(id)));
  res.json({ ok: true });
});

// حذف عضو از گروه/کانال — فقط مدیرِ گفتگو یا مدیر سامانه
r.delete('/conversations/:id/members/:userId', (req, res) => {
  const convId = Number(req.params.id);
  const targetId = Number(req.params.userId);
  const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(convId);
  if (!conv || (conv.type !== 'group' && conv.type !== 'channel')) return res.status(404).json({ error: 'گفتگو یافت نشد' });
  const me = db.prepare('SELECT * FROM conversation_members WHERE conversation_id = ? AND user_id = ?').get(convId, req.user.id);
  if (!me || (!me.is_admin && req.user.role !== 'admin')) return res.status(403).json({ error: 'فقط مدیر می‌تواند عضو را حذف کند' });
  if (targetId === req.user.id) return res.status(400).json({ error: 'برای خروج از گزینهٔ «ترک گروه» استفاده کنید' });
  db.prepare('DELETE FROM conversation_members WHERE conversation_id = ? AND user_id = ?').run(convId, targetId);
  const io = getIO();
  if (io) io.to(`user:${targetId}`).emit('conversation:removed', { id: convId });
  res.json({ ok: true });
});

r.get('/conversations/:id/messages', (req, res) => {
  const convId = Number(req.params.id);
  if (!isMember(convId, req.user.id)) return res.status(403).json({ error: 'دسترسی غیرمجاز' });
  const before = Number(req.query.before) || Number.MAX_SAFE_INTEGER;
  // پیام‌هایی که کاربر تاریخچه‌شان را پاک کرده، برای او نمایش داده نمی‌شوند
  const clearedBefore = db.prepare('SELECT cleared_before FROM conversation_members WHERE conversation_id = ? AND user_id = ?')
    .get(convId, req.user.id)?.cleared_before || 0;
  const messages = db.prepare(`
    SELECT m.*, u.full_name AS sender_name, u.avatar_color AS sender_color,
           f.original_name AS file_name, f.size AS file_size, f.mime AS file_mime
    FROM messages m
    JOIN users u ON u.id = m.sender_id
    LEFT JOIN files f ON f.id = m.file_id
    WHERE m.conversation_id = ? AND m.id < ? AND m.id > ? AND m.deleted = 0
    ORDER BY m.id DESC LIMIT 50`).all(convId, before, clearedBefore).reverse();
  res.json({ messages });
});

r.post('/conversations/:id/messages', (req, res) => {
  const convId = Number(req.params.id);
  if (!isMember(convId, req.user.id)) return res.status(403).json({ error: 'دسترسی غیرمجاز' });
  const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(convId);
  // کانال: فقط مدیران کانال می‌توانند پیام بفرستند (broadcast)
  if (conv?.type === 'channel') {
    const me = db.prepare('SELECT is_admin FROM conversation_members WHERE conversation_id = ? AND user_id = ?').get(convId, req.user.id);
    if (!me?.is_admin && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'فقط مدیر کانال می‌تواند پیام ارسال کند' });
    }
  }
  // گفتگوی دو نفره: اگر مسدودسازی وجود دارد، اجازه نده
  if (conv?.type === 'dm') {
    const other = db.prepare('SELECT user_id FROM conversation_members WHERE conversation_id = ? AND user_id != ?').get(convId, req.user.id);
    if (other && blockedBetween(req.user.id, other.user_id)) {
      return res.status(403).json({ error: 'امکان ارسال پیام به این کاربر وجود ندارد (مسدود شده)' });
    }
  }
  const { content = '', file_id = null } = req.body || {};
  if (!content.trim() && !file_id) return res.status(400).json({ error: 'پیام خالی است' });
  const result = db.prepare('INSERT INTO messages (conversation_id, sender_id, content, file_id) VALUES (?, ?, ?, ?)')
    .run(convId, req.user.id, content.trim(), file_id);
  // با پیام جدید، گفتگوی پنهان‌شده دوباره برای همه نمایش داده شود
  db.prepare('UPDATE conversation_members SET hidden = 0 WHERE conversation_id = ?').run(convId);
  const msg = db.prepare(`
    SELECT m.*, u.full_name AS sender_name, u.avatar_color AS sender_color,
           f.original_name AS file_name, f.size AS file_size, f.mime AS file_mime
    FROM messages m JOIN users u ON u.id = m.sender_id LEFT JOIN files f ON f.id = m.file_id
    WHERE m.id = ?`).get(result.lastInsertRowid);
  db.prepare('UPDATE conversation_members SET last_read_message_id = ? WHERE conversation_id = ? AND user_id = ?')
    .run(msg.id, convId, req.user.id);
  const io = getIO();
  if (io) {
    const members = db.prepare('SELECT user_id FROM conversation_members WHERE conversation_id = ?').all(convId);
    for (const m of members) io.to(`user:${m.user_id}`).emit('message:new', { conversation_id: convId, message: msg });
  }
  res.json({ message: msg });
});

r.post('/conversations/:id/read', (req, res) => {
  const convId = Number(req.params.id);
  if (!isMember(convId, req.user.id)) return res.status(403).json({ error: 'دسترسی غیرمجاز' });
  const maxId = db.prepare('SELECT MAX(id) m FROM messages WHERE conversation_id = ?').get(convId).m || 0;
  db.prepare('UPDATE conversation_members SET last_read_message_id = ? WHERE conversation_id = ? AND user_id = ?')
    .run(maxId, convId, req.user.id);
  res.json({ ok: true });
});

// حذف گفتگو برای خودم: از فهرست پنهان می‌شود و تاریخچهٔ فعلی هم برای من پاک می‌شود
// (اگر بعداً پیام جدیدی رد و بدل شود، فقط پیام‌های جدید نمایش داده می‌شوند)
r.post('/conversations/:id/remove', (req, res) => {
  const convId = Number(req.params.id);
  if (!isMember(convId, req.user.id)) return res.status(403).json({ error: 'دسترسی غیرمجاز' });
  const maxId = db.prepare('SELECT MAX(id) m FROM messages WHERE conversation_id = ?').get(convId).m || 0;
  db.prepare('UPDATE conversation_members SET hidden = 1, cleared_before = ? WHERE conversation_id = ? AND user_id = ?')
    .run(maxId, convId, req.user.id);
  res.json({ ok: true });
});

// ترک گروه یا کانال
r.post('/conversations/:id/leave', (req, res) => {
  const convId = Number(req.params.id);
  const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(convId);
  if (!conv) return res.status(404).json({ error: 'گفتگو یافت نشد' });
  if (conv.type === 'dm') return res.status(400).json({ error: 'برای گفتگوی دو نفره از حذف گفتگو استفاده کنید' });
  if (!isMember(convId, req.user.id)) return res.status(403).json({ error: 'شما عضو این گفتگو نیستید' });
  db.prepare('DELETE FROM conversation_members WHERE conversation_id = ? AND user_id = ?').run(convId, req.user.id);
  const io = getIO();
  if (io) io.to(`user:${req.user.id}`).emit('conversation:left', { conversation_id: convId });
  res.json({ ok: true });
});

// ---------- block / report ----------
r.get('/blocks', (req, res) => {
  const blocks = db.prepare(`
    SELECT b.blocked_id AS id, u.full_name FROM blocked_users b
    JOIN users u ON u.id = b.blocked_id WHERE b.blocker_id = ?`).all(req.user.id);
  res.json({ blocks });
});

r.post('/block/:userId', (req, res) => {
  const target = Number(req.params.userId);
  if (target === req.user.id) return res.status(400).json({ error: 'نمی‌توانید خودتان را مسدود کنید' });
  const u = db.prepare('SELECT id FROM users WHERE id = ?').get(target);
  if (!u) return res.status(404).json({ error: 'کاربر یافت نشد' });
  db.prepare('INSERT OR IGNORE INTO blocked_users (blocker_id, blocked_id) VALUES (?, ?)').run(req.user.id, target);
  res.json({ ok: true });
});

r.delete('/block/:userId', (req, res) => {
  const target = Number(req.params.userId);
  db.prepare('DELETE FROM blocked_users WHERE blocker_id = ? AND blocked_id = ?').run(req.user.id, target);
  res.json({ ok: true });
});

r.post('/report', (req, res) => {
  const { user_id, reason = '', conversation_id = null } = req.body || {};
  const target = Number(user_id);
  if (!target || target === req.user.id) return res.status(400).json({ error: 'کاربر نامعتبر' });
  const u = db.prepare('SELECT full_name FROM users WHERE id = ?').get(target);
  if (!u) return res.status(404).json({ error: 'کاربر یافت نشد' });
  db.prepare('INSERT INTO user_reports (reporter_id, reported_id, conversation_id, reason) VALUES (?, ?, ?, ?)')
    .run(req.user.id, target, conversation_id ? Number(conversation_id) : null, String(reason).slice(0, 1000));
  // اطلاع به مدیران سامانه
  const admins = db.prepare("SELECT id FROM users WHERE role = 'admin' AND is_active = 1").all().map(a => a.id);
  notifyUsers(admins, {
    type: 'info', title: 'گزارش تخلف کاربر',
    body: `${req.user.full_name} کاربر «${u.full_name}» را گزارش کرد${reason ? ' — ' + reason : ''}`,
  });
  res.json({ ok: true });
});

// ---------- files ----------
r.post('/files', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'فایلی ارسال نشده است' });
  const original = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
  const result = db.prepare('INSERT INTO files (stored_name, original_name, mime, size, uploader_id) VALUES (?, ?, ?, ?, ?)')
    .run(req.file.filename, original, req.file.mimetype, req.file.size, req.user.id);
  res.json({ file: { id: result.lastInsertRowid, original_name: original, size: req.file.size, mime: req.file.mimetype } });
});

r.get('/files/:id', (req, res) => {
  const f = db.prepare('SELECT * FROM files WHERE id = ?').get(req.params.id);
  if (!f) return res.status(404).json({ error: 'فایل یافت نشد' });
  // فایل‌های جدید در sharedfiles، فایل‌های قدیمی در uploads
  let p = path.join(SHARED_FILES_DIR, f.stored_name);
  if (!fs.existsSync(p)) p = path.join(UPLOAD_DIR, f.stored_name);
  if (!fs.existsSync(p)) return res.status(404).json({ error: 'فایل یافت نشد' });
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(f.original_name)}`);
  res.setHeader('Content-Type', f.mime || 'application/octet-stream');
  fs.createReadStream(p).pipe(res);
});

// ---------- recordings (ضبط جلسات و تماس‌ها) ----------
r.post('/recordings', recordUpload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'فایل ضبط ارسال نشده است' });
  const { title = '', room = '', conversation_id = null, kind = 'audio', duration = 0 } = req.body || {};
  const convId = conversation_id ? Number(conversation_id) : null;
  if (convId && !isMember(convId, req.user.id)) return res.status(403).json({ error: 'دسترسی غیرمجاز' });
  const result = db.prepare(`
    INSERT INTO recordings (stored_name, title, room, conversation_id, kind, mime, size, duration, recorded_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(req.file.filename, String(title), String(room), convId, kind === 'video' ? 'video' : 'audio',
      req.file.mimetype, req.file.size, Number(duration) || 0, req.user.id);
  const rec = db.prepare('SELECT * FROM recordings WHERE id = ?').get(result.lastInsertRowid);
  res.json({ recording: rec });
});

// دسترسی به بخش ضبط‌ها: فقط مدیر سامانه و سرگروه‌ها/مدیران واحدها
function canViewRecordings(user) {
  if (user.role === 'admin' || user.role === 'manager') return true;
  return !!db.prepare('SELECT 1 FROM departments WHERE manager_id = ?').get(user.id);
}

r.get('/recordings', (req, res) => {
  if (!canViewRecordings(req.user)) return res.status(403).json({ error: 'دسترسی غیرمجاز' });
  // مدیر و سرگروه‌ها همه ضبط‌ها را می‌بینند
  const recs = db.prepare(`
    SELECT rec.*, u.full_name AS recorder_name, c.name AS conv_name, c.type AS conv_type
    FROM recordings rec
    LEFT JOIN users u ON u.id = rec.recorded_by
    LEFT JOIN conversations c ON c.id = rec.conversation_id
    ORDER BY rec.id DESC LIMIT 500`).all();
  res.json({ recordings: recs });
});

// پخش با پشتیبانی از Range (برای seek در ویدیو/صوت) — نمایش inline
r.get('/recordings/:id/stream', (req, res) => {
  const rec = db.prepare('SELECT * FROM recordings WHERE id = ?').get(req.params.id);
  if (!rec) return res.status(404).json({ error: 'ضبط یافت نشد' });
  if (!canViewRecordings(req.user)) return res.status(403).json({ error: 'دسترسی غیرمجاز' });
  const p = path.join(RECORDINGS_DIR, rec.stored_name);
  if (!fs.existsSync(p)) return res.status(404).json({ error: 'فایل ضبط یافت نشد' });
  const stat = fs.statSync(p);
  const type = rec.mime || (rec.kind === 'video' ? 'video/webm' : 'audio/webm');
  const range = req.headers.range;
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    const start = m && m[1] ? parseInt(m[1], 10) : 0;
    const end = m && m[2] ? parseInt(m[2], 10) : stat.size - 1;
    if (start >= stat.size || end >= stat.size) {
      res.status(416).setHeader('Content-Range', `bytes */${stat.size}`);
      return res.end();
    }
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${stat.size}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': end - start + 1,
      'Content-Type': type,
    });
    return fs.createReadStream(p, { start, end }).pipe(res);
  }
  res.writeHead(200, { 'Content-Length': stat.size, 'Content-Type': type, 'Accept-Ranges': 'bytes' });
  fs.createReadStream(p).pipe(res);
});

r.get('/recordings/:id', (req, res) => {
  const rec = db.prepare('SELECT * FROM recordings WHERE id = ?').get(req.params.id);
  if (!rec) return res.status(404).json({ error: 'ضبط یافت نشد' });
  if (!canViewRecordings(req.user)) return res.status(403).json({ error: 'دسترسی غیرمجاز' });
  const p = path.join(RECORDINGS_DIR, rec.stored_name);
  if (!fs.existsSync(p)) return res.status(404).json({ error: 'فایل ضبط یافت نشد' });
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(rec.stored_name)}`);
  res.setHeader('Content-Type', rec.mime || 'application/octet-stream');
  fs.createReadStream(p).pipe(res);
});

// حذف ضبط — فقط مدیر سامانه
r.delete('/recordings/:id', (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'فقط مدیر سامانه می‌تواند ضبط را حذف کند' });
  const rec = db.prepare('SELECT * FROM recordings WHERE id = ?').get(req.params.id);
  if (!rec) return res.status(404).json({ error: 'ضبط یافت نشد' });
  const p = path.join(RECORDINGS_DIR, rec.stored_name);
  try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch {}
  db.prepare('DELETE FROM recordings WHERE id = ?').run(rec.id);
  res.json({ ok: true });
});

export default r;
