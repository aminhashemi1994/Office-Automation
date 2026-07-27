import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import db from '../db.js';
import { requirePerm } from '../auth.js';
import { BRANDING_DIR } from '../config.js';

const r = Router();

const EDITABLE_KEYS = ['company_name', 'company_subtitle', 'letterhead_address', 'letterhead_footer'];
// کلیدهای دو‌حالته ('1'/'0') — [پیوست‌ها] کلید سراسریِ اجازهٔ پیوست فایل در فرآیندها
const BOOL_KEYS = ['attachments_enabled'];

const logoUpload = multer({
  storage: multer.diskStorage({
    destination: BRANDING_DIR,
    filename: (req, file, cb) => cb(null, 'logo_' + crypto.randomBytes(8).toString('hex') + (path.extname(file.originalname) || '.png')),
  }),
  limits: { fileSize: 3 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, /^image\//.test(file.mimetype)),
});

function readSettings() {
  const rows = db.prepare('SELECT key, value FROM app_settings').all();
  const out = {};
  for (const row of rows) out[row.key] = row.value;
  return out;
}

// خواندن تنظیمات — همه کاربران واردشده (برای نمایش سربرگ در چاپ)
r.get('/', (req, res) => {
  res.json({ settings: readSettings() });
});

// ویرایش متن‌های سربرگ — فقط مدیر سامانه
r.put('/', requirePerm('settings.manage'), (req, res) => {
  const body = req.body || {};
  const upd = db.prepare('UPDATE app_settings SET value = ? WHERE key = ?');
  for (const k of EDITABLE_KEYS) {
    if (body[k] !== undefined) upd.run(String(body[k]).slice(0, 2000), k);
  }
  const ins = db.prepare('INSERT OR IGNORE INTO app_settings (key, value) VALUES (?, ?)');
  for (const k of BOOL_KEYS) {
    if (body[k] === undefined) continue;
    const v = (body[k] === true || body[k] === 1 || body[k] === '1') ? '1' : '0';
    ins.run(k, v);
    upd.run(v, k);
  }
  res.json({ ok: true, settings: readSettings() });
});

// آپلود لوگو — فقط مدیر سامانه
r.post('/logo', requirePerm('settings.manage'), logoUpload.single('logo'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'تصویری ارسال نشده است (فرمت باید عکس باشد)' });
  const prev = db.prepare("SELECT value FROM app_settings WHERE key = 'logo_path'").get()?.value;
  if (prev) { try { fs.unlinkSync(path.join(BRANDING_DIR, prev)); } catch {} }
  db.prepare("UPDATE app_settings SET value = ? WHERE key = 'logo_path'").run(req.file.filename);
  res.json({ ok: true, logo_path: req.file.filename });
});

r.delete('/logo', requirePerm('settings.manage'), (req, res) => {
  const prev = db.prepare("SELECT value FROM app_settings WHERE key = 'logo_path'").get()?.value;
  if (prev) { try { fs.unlinkSync(path.join(BRANDING_DIR, prev)); } catch {} }
  db.prepare("UPDATE app_settings SET value = '' WHERE key = 'logo_path'").run();
  res.json({ ok: true });
});

export default r;
