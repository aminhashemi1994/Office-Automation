import { Router } from 'express';
import bcrypt from 'bcryptjs';
import db from '../db.js';
import { signToken, authMiddleware, userPerms } from '../auth.js';
import { notifyUsers } from '../notify.js';
import { normalizePhone, isMobile, smsConfig, sendOne } from '../sms.js';

const r = Router();

// مهلت اعتبار کد یک‌بارمصرف و سقف تلاش
const CODE_TTL_MIN = 15;
const MAX_CODE_ATTEMPTS = 5;

// شمارهٔ موبایل را برای نمایش می‌پوشاند: ۰۹۱۲***۴۵۶۷
function maskPhone(p) {
  const s = normalizePhone(p);
  return s.length === 11 ? `${s.slice(0, 4)}***${s.slice(7)}` : '';
}

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

// ============================================================================
//  فراموشی رمز عبور
// ============================================================================
// پاسخ همیشه یکسان است تا از بیرون نشود فهمید چه نام‌کاربری‌هایی وجود دارند.
r.post('/forgot', async (req, res) => {
  const username = String(req.body?.username || '').trim();
  const generic = { ok: true, message: 'اگر این نام کاربری در سامانه باشد، درخواست بازنشانی ثبت شد.' };
  if (!username) return res.status(400).json({ error: 'نام کاربری را وارد کنید' });

  const user = db.prepare('SELECT * FROM users WHERE username = ? AND is_active = 1').get(username);
  const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim();

  if (!user) {
    // برای اینکه زمانِ پاسخ هم چیزی لو ندهد، تلاش را ثبت می‌کنیم و همان پاسخ عمومی می‌دهیم
    db.prepare(`INSERT INTO password_resets (user_id, username_tried, method, status, ip)
      VALUES (NULL, ?, 'admin', 'rejected', ?)`).run(username, ip);
    return res.json(generic);
  }

  // جلوگیری از سیل درخواست: حداکثر ۳ درخواست در یک ساعت برای هر کاربر
  const recent = db.prepare(`SELECT COUNT(*) c FROM password_resets
    WHERE user_id = ? AND created_at >= datetime('now', '-1 hour')`).get(user.id).c;
  if (recent >= 3) {
    return res.status(429).json({ error: 'درخواست‌های زیادی ثبت شده است؛ کمی بعد دوباره تلاش کنید.' });
  }

  const cfg = smsConfig();
  const phone = normalizePhone(user.phone);
  const canSms = cfg.enabled && cfg.apiUrl && cfg.apiKey && isMobile(phone);

  if (canSms) {
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const info = db.prepare(`INSERT INTO password_resets
      (user_id, username_tried, method, code_hash, code_expires_at, status, ip)
      VALUES (?, ?, 'sms', ?, datetime('now', '+${CODE_TTL_MIN} minutes'), 'pending', ?)`)
      .run(user.id, username, bcrypt.hashSync(code, 10), ip);
    const smsRow = db.prepare(`INSERT INTO crm_sms (phone, body, status, user_id)
      VALUES (?, ?, 'queued', ?)`).run(phone,
      `کد بازنشانی رمز عبور سامانه اتوماسیون: ${code}\nاعتبار ${CODE_TTL_MIN} دقیقه`, user.id);
    try { await sendOne(db.prepare('SELECT * FROM crm_sms WHERE id = ?').get(smsRow.lastInsertRowid)); } catch {}
    return res.json({ ...generic, reset_id: info.lastInsertRowid, sms: true, phone_masked: maskPhone(phone) });
  }

  // مسیر پیش‌فرض: مدیر سامانه رمز را بازنشانی می‌کند
  db.prepare(`INSERT INTO password_resets (user_id, username_tried, method, status, ip)
    VALUES (?, ?, 'admin', 'pending', ?)`).run(user.id, username, ip);
  const admins = db.prepare("SELECT id FROM users WHERE role = 'admin' AND is_active = 1").all().map(u => u.id);
  if (admins.length) {
    notifyUsers(admins, {
      type: 'info',
      title: `🔑 درخواست بازنشانی رمز عبور: ${user.full_name}`,
      body: `کاربر «${user.username}» رمز عبورش را فراموش کرده است. از صفحهٔ کاربران رمز تازه‌ای برایش تعیین کنید.`,
      link: '/users',
    });
  }
  res.json({ ...generic, sms: false });
});

// بازنشانی با کد پیامکی
r.post('/reset', (req, res) => {
  const { username, code, password } = req.body || {};
  const bad = { error: 'کد وارد‌شده نادرست یا منقضی شده است' };
  if (!password || String(password).length < 6) {
    return res.status(400).json({ error: 'رمز جدید باید حداقل ۶ کاراکتر باشد' });
  }
  const user = db.prepare('SELECT * FROM users WHERE username = ? AND is_active = 1').get(String(username || '').trim());
  if (!user) return res.status(400).json(bad);

  const row = db.prepare(`SELECT * FROM password_resets
    WHERE user_id = ? AND method = 'sms' AND status = 'pending'
      AND code_expires_at > datetime('now')
    ORDER BY id DESC LIMIT 1`).get(user.id);
  if (!row) return res.status(400).json(bad);

  if (row.attempts >= MAX_CODE_ATTEMPTS) {
    db.prepare("UPDATE password_resets SET status = 'expired' WHERE id = ?").run(row.id);
    return res.status(429).json({ error: 'تعداد تلاش‌ها بیش از حد مجاز است؛ دوباره درخواست بدهید.' });
  }
  if (!bcrypt.compareSync(String(code || ''), row.code_hash)) {
    db.prepare('UPDATE password_resets SET attempts = attempts + 1 WHERE id = ?').run(row.id);
    return res.status(400).json(bad);
  }

  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?')
    .run(bcrypt.hashSync(String(password), 10), user.id);
  db.prepare(`UPDATE password_resets SET status = 'done', handled_by = ?, handled_at = datetime('now'), code_hash = ''
    WHERE id = ?`).run(user.id, row.id);
  // درخواست‌های بازِ دیگرِ همین کاربر هم بی‌اثر می‌شوند
  db.prepare("UPDATE password_resets SET status = 'expired' WHERE user_id = ? AND status = 'pending'").run(user.id);
  res.json({ ok: true });
});

export default r;
