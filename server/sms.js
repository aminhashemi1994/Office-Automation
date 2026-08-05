// ============================================================================
//  پیامک — لایهٔ ارسال
//
//  ⚠️ این ماژول عمداً «جا‌نمایی» است: تا وقتی درگاهی در تنظیمات سازمان ثبت نشده
//  باشد، هیچ درخواستِ بیرونی فرستاده نمی‌شود و پیام‌ها با وضعیت «شبیه‌سازی»
//  ثبت می‌شوند. این‌طور می‌توانید کل جریانِ کار را روی شبکهٔ داخلی تست کنید.
//
//  برای اتصال به درگاه واقعی فقط همین فایل عوض می‌شود:
//   ۱. در «تنظیمات سازمان ← پیامک» درگاه، آدرس، کلید و شمارهٔ فرستنده را وارد کنید
//   ۲. تابع deliver() را برای درگاه خودتان تکمیل کنید (نمونهٔ کاوه‌نگار پایین هست)
//   ۳. sms_enabled را روشن کنید
//  بقیهٔ سامانه هیچ تغییری لازم ندارد.
// ============================================================================
import db from './db.js';

const setting = (k, f = '') => db.prepare('SELECT value FROM app_settings WHERE key = ?').get(k)?.value ?? f;

export function smsConfig() {
  return {
    enabled: setting('sms_enabled', '0') === '1',
    provider: setting('sms_provider', ''),
    apiUrl: setting('sms_api_url', ''),
    apiKey: setting('sms_api_key', ''),
    sender: setting('sms_sender', ''),
  };
}

// شمارهٔ موبایل ایران را به شکل استاندارد درمی‌آورد (۰۹xxxxxxxxx)
export function normalizePhone(raw) {
  const digits = String(raw || '')
    .replace(/[۰-۹]/g, d => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/\D/g, '');
  if (/^98\d{10}$/.test(digits)) return '0' + digits.slice(2);
  if (/^0\d{10}$/.test(digits)) return digits;
  if (/^9\d{9}$/.test(digits)) return '0' + digits;
  return digits;
}

export function isMobile(phone) {
  return /^09\d{9}$/.test(normalizePhone(phone));
}

// جایگزینی متغیرهای قالب: {نام}، {شرکت}، {مبلغ} و …
export function renderTemplate(body, vars = {}) {
  return String(body || '').replace(/\{([^}]+)\}/g, (m, key) => {
    const v = vars[String(key).trim()];
    return v === undefined || v === null ? m : String(v);
  });
}

// ارسال واقعی به درگاه — امروز عمداً پیاده‌سازی نشده است.
// نمونهٔ کاوه‌نگار (بعد از تنظیم درگاه، این بلوک را از حالت توضیح خارج کنید):
//
//   const url = `${cfg.apiUrl}/${cfg.apiKey}/sms/send.json`;
//   const res = await fetch(url, {
//     method: 'POST',
//     headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
//     body: new URLSearchParams({ receptor: phone, sender: cfg.sender, message: body }),
//   });
//   const data = await res.json();
//   if (!res.ok) throw new Error(data?.return?.message || 'خطای درگاه پیامک');
//   return { providerMsgId: String(data?.entries?.[0]?.messageid || '') };
async function deliver(_phone, _body, _cfg) {
  throw new Error('درگاه پیامک هنوز پیاده‌سازی نشده است');
}

// یک پیام را از صف برمی‌دارد و می‌فرستد (یا شبیه‌سازی می‌کند)
export async function sendOne(row) {
  const cfg = smsConfig();
  const phone = normalizePhone(row.phone);
  if (!isMobile(phone)) {
    db.prepare("UPDATE crm_sms SET status = 'failed', error = ? WHERE id = ?")
      .run('شمارهٔ موبایل نامعتبر است', row.id);
    return { ok: false, error: 'شمارهٔ موبایل نامعتبر است' };
  }
  // درگاه تنظیم نشده → ثبت به‌عنوان «شبیه‌سازی‌شده» (بدون هیچ تماس بیرونی)
  if (!cfg.enabled || !cfg.apiUrl || !cfg.apiKey) {
    db.prepare("UPDATE crm_sms SET status = 'simulated', sent_at = datetime('now'), provider = ? WHERE id = ?")
      .run(cfg.provider || 'simulation', row.id);
    return { ok: true, simulated: true };
  }
  try {
    const { providerMsgId } = await deliver(phone, row.body, cfg);
    db.prepare(`UPDATE crm_sms SET status = 'sent', sent_at = datetime('now'),
      provider = ?, provider_msg_id = ?, error = '' WHERE id = ?`)
      .run(cfg.provider, providerMsgId || '', row.id);
    return { ok: true };
  } catch (e) {
    db.prepare("UPDATE crm_sms SET status = 'failed', error = ? WHERE id = ?").run(e.message, row.id);
    return { ok: false, error: e.message };
  }
}

// صفِ پیامک‌های زمان‌بندی‌شده که وقتشان رسیده
export async function flushQueue() {
  const due = db.prepare(`SELECT * FROM crm_sms WHERE status = 'queued'
    AND (scheduled_at IS NULL OR scheduled_at <= datetime('now')) LIMIT 50`).all();
  for (const row of due) await sendOne(row);
  return due.length;
}
