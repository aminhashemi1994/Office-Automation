// ============================================================================
//  کسر خودکار مرخصی از روی گردش‌کار
//  یک فرآیند را در صفحهٔ «فرآیندها» به‌عنوان «فرآیند مرخصی» علامت می‌زنید و
//  فیلدهای فرمش را به مفاهیم مرخصی نگاشت می‌کنید (leave_map):
//    { type_field, day_field, hour_field, range_field, from_field, to_field,
//      default_type, type_values: { "<مقدارِ فیلد>": "entitled|unpaid|sick" } }
//  با «تایید نهایی» درخواست، مقدار مرخصی به ساعت تبدیل و از ماندهٔ کاربر کم می‌شود.
//  برای هر درخواست فقط یک بار ثبت می‌شود (idx_leave_ledger_request یکتاست).
// ============================================================================
import db from './db.js';
import { notifyUsers } from './notify.js';
import { LEAVE_TYPES, workdayHours, currentJalaliYear, balanceOf } from './routes/leaves.js';

function parseJson(s, fallback) {
  try { return JSON.parse(s); } catch { return fallback; }
}

// عددِ فارسی/عربی را هم می‌خوانیم — کاربران معمولاً با صفحه‌کلید فارسی تایپ می‌کنند
function toNumber(v) {
  if (v === undefined || v === null || v === '') return 0;
  const s = String(v)
    .replace(/[۰-۹]/g, d => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))   // ارقام فارسی
    .replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))   // ارقام عربی
    .replace(/[^0-9.\-]/g, '');
  return Number(s) || 0;
}

// "HH:MM" → دقیقه
function hhmmToMinutes(v) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(v || '').trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

// نوعِ مرخصی را از مقدارِ فیلدِ فرم تشخیص می‌دهد
function resolveLeaveType(map, formData) {
  const raw = map.type_field ? formData?.[map.type_field] : null;
  const text = String(raw ?? '').trim();
  if (text) {
    // نگاشتِ صریحِ تعریف‌شده در تنظیمات فرآیند
    const explicit = map.type_values?.[text];
    if (explicit && LEAVE_TYPES[explicit]) return explicit;
    if (LEAVE_TYPES[text]) return text; // خودِ کلید انگلیسی
    // تشخیص از روی متن فارسی
    if (/استعلاج|بیمار|پزشک/.test(text)) return 'sick';
    if (/بدون\s*حقوق|بی\s*حقوق|بدون‌حقوق/.test(text)) return 'unpaid';
    if (/استحقاق|سالانه|عادی/.test(text)) return 'entitled';
  }
  return LEAVE_TYPES[map.default_type] ? map.default_type : 'entitled';
}

// مقدارِ مرخصی را به ساعت برمی‌گرداند (به‌همراه یک برچسبِ خوانا برای نمایش)
function resolveAmountHours(map, formData) {
  const wd = workdayHours();
  // ۱) بازهٔ ساعتی (فیلد time_range) → اختلافِ شروع و پایان
  if (map.range_field) {
    const v = formData?.[map.range_field];
    const s = hhmmToMinutes(v?.start);
    const e = hhmmToMinutes(v?.end);
    if (s !== null && e !== null && e > s) {
      const hours = (e - s) / 60;
      return { hours, unit: 'hour', label: `${hours.toLocaleString('fa-IR')} ساعت` };
    }
  }
  // ۲) تعداد ساعت
  if (map.hour_field) {
    const h = toNumber(formData?.[map.hour_field]);
    if (h > 0) return { hours: h, unit: 'hour', label: `${h.toLocaleString('fa-IR')} ساعت` };
  }
  // ۳) تعداد روز
  if (map.day_field) {
    const d = toNumber(formData?.[map.day_field]);
    if (d > 0) return { hours: d * wd, unit: 'day', label: `${d.toLocaleString('fa-IR')} روز` };
  }
  return null;
}

// درخواستِ تاییدشده را در صورت «مرخصی بودن» از ماندهٔ کاربر کم می‌کند.
// خطاها بلعیده می‌شوند تا مشکلِ محاسبهٔ مرخصی هرگز گردش‌کار را متوقف نکند.
export function applyLeaveDeduction(rq, tpl) {
  try {
    if (!tpl?.leave_enabled) return null;
    // قبلاً برای همین درخواست ثبت شده؟
    if (db.prepare('SELECT 1 FROM leave_ledger WHERE request_id = ?').get(rq.id)) return null;

    const map = parseJson(tpl.leave_map || '{}', {});
    const formData = parseJson(rq.form_data || '{}', {});
    const amount = resolveAmountHours(map, formData);
    if (!amount || amount.hours <= 0) return null;

    const type = resolveLeaveType(map, formData);
    const year = currentJalaliYear();
    const from = map.from_field ? String(formData?.[map.from_field] ?? '') : '';
    const to = map.to_field ? String(formData?.[map.to_field] ?? '') : '';

    db.prepare(`INSERT INTO leave_ledger
      (user_id, year, leave_type, unit, hours, amount_label, request_id, from_date, to_date, note, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(rq.requester_id, year, type, amount.unit, -Math.abs(amount.hours), amount.label,
        rq.id, from, to, `از درخواست «${rq.title}»`, rq.requester_id);

    const bal = balanceOf(rq.requester_id, year);
    const wd = workdayHours();
    const remainDays = (bal.remaining_hours / wd);
    notifyUsers([rq.requester_id], {
      type: 'workflow',
      title: `مرخصی ثبت شد: ${amount.label} (${LEAVE_TYPES[type]})`,
      body: `ماندهٔ مرخصی شما در سال ${year.toLocaleString('fa-IR', { useGrouping: false })}: `
        + `${remainDays.toLocaleString('fa-IR', { maximumFractionDigits: 2 })} روز`
        + ` (${bal.remaining_hours.toLocaleString('fa-IR', { maximumFractionDigits: 1 })} ساعت)`,
      link: `/leaves`,
    });
    return { type, hours: amount.hours, balance: bal };
  } catch (e) {
    console.error('leave deduction failed:', e.message);
    return null;
  }
}
