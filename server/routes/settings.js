import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import db from '../db.js';
import { requirePerm } from '../auth.js';
import { BRANDING_DIR } from '../config.js';

const r = Router();

const EDITABLE_KEYS = ['company_name', 'company_subtitle', 'letterhead_address', 'letterhead_footer',
  'crm_lost_reasons', 'crm_tender_checklist', 'crm_stale_customer_days',
  'sms_provider', 'sms_api_url', 'sms_api_key', 'sms_sender',
  // [پشتیبانی هوشمند] آدرس سرویس، مدل و کلید — کلید هرگز به کلاینت برنمی‌گردد
  'ai_base_url', 'ai_model', 'ai_api_key', 'ai_temperature'];
// کلیدهای محرمانه: مقدارشان به هیچ کاربری (حتی مدیر سامانه) برگردانده نمی‌شود؛
// فقط «تنظیم‌شده/نشده» بودنشان اعلام می‌شود. اگر مقدار خالی فرستاده شود، مقدار
// قبلی دست‌نخورده می‌ماند تا ذخیرهٔ فرم، کلید را پاک نکند.
const SECRET_KEYS = ['sms_api_key', 'ai_api_key'];
// کلیدهای دو‌حالته ('1'/'0') — [پیوست‌ها] کلید سراسریِ اجازهٔ پیوست فایل، [CRM] فعال‌بودن ماژول
const BOOL_KEYS = ['attachments_enabled', 'crm_enabled', 'sms_enabled', 'ai_enabled', 'tasks_require_project'];
// کلیدهایی که مقدارشان آرایهٔ JSON از id است — [CRM] واحدهای مجاز به کار با CRM
const ID_LIST_KEYS = ['crm_dept_ids', 'crm_full_dept_ids'];

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
  // کلیدهای محرمانه با یک پرچمِ «تنظیم شده» جایگزین می‌شوند
  for (const k of SECRET_KEYS) {
    out[`${k}_set`] = out[k] ? '1' : '0';
    delete out[k];
  }
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
    if (body[k] === undefined) continue;
    // فرستادنِ مقدار خالی برای یک کلید محرمانه یعنی «دست نزن»، نه «پاک کن».
    // برای پاک‌کردن عمدی، مقدار ویژهٔ '--' فرستاده می‌شود.
    if (SECRET_KEYS.includes(k)) {
      const v = String(body[k]);
      if (!v.trim()) continue;
      db.prepare('INSERT OR IGNORE INTO app_settings (key, value) VALUES (?, ?)').run(k, '');
      upd.run(v.trim() === '--' ? '' : v.trim().slice(0, 2000), k);
      continue;
    }
    upd.run(String(body[k]).slice(0, 2000), k);
  }
  const ins = db.prepare('INSERT OR IGNORE INTO app_settings (key, value) VALUES (?, ?)');
  for (const k of BOOL_KEYS) {
    if (body[k] === undefined) continue;
    const v = (body[k] === true || body[k] === 1 || body[k] === '1') ? '1' : '0';
    ins.run(k, v);
    upd.run(v, k);
  }
  for (const k of ID_LIST_KEYS) {
    if (body[k] === undefined) continue;
    const v = JSON.stringify((Array.isArray(body[k]) ? body[k] : []).map(Number).filter(Boolean));
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
