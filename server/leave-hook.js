// ============================================================================
//  کسر خودکار مرخصی از روی گردش‌کار
//  یک فرآیند را در صفحهٔ «فرآیندها» به‌عنوان «فرآیند مرخصی» علامت می‌زنید و
//  فیلدهای فرمش را به مفاهیم مرخصی نگاشت می‌کنید (leave_map):
//    { type_field, day_field, hour_field, range_field, from_field, to_field,
//      mode_field, date_field,
//      default_type, type_values: { "<مقدارِ فیلد>": "entitled|unpaid|sick" } }
//  mode_field («ساعتی» / «روزانه») مشخص می‌کند کدام گروه از فیلدها خوانده شود؛
//  date_field تاریخِ مرخصیِ ساعتی است (از/تا هر دو همان روز).
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

// «ساعتی» / «روزانه» از فیلدِ حالت — بدون این فیلد null (یعنی همهٔ فیلدها بررسی شوند)
export function resolveLeaveMode(map, formData) {
  if (!map.mode_field) return null;
  const v = String(formData?.[map.mode_field] ?? '').trim();
  if (/ساعت|hour/i.test(v)) return 'hour';
  if (/روز|day/i.test(v)) return 'day';
  return null;
}

// مقدارِ مرخصی را به ساعت برمی‌گرداند (به‌همراه یک برچسبِ خوانا برای نمایش)
function resolveAmountHours(map, formData) {
  const wd = workdayHours();
  const mode = resolveLeaveMode(map, formData);
  // ۱) بازهٔ ساعتی (فیلد time_range) → اختلافِ شروع و پایان
  if (map.range_field && mode !== 'day') {
    const v = formData?.[map.range_field];
    const s = hhmmToMinutes(v?.start);
    const e = hhmmToMinutes(v?.end);
    if (s !== null && e !== null && e > s) {
      const hours = (e - s) / 60;
      return { hours, unit: 'hour', label: `${hours.toLocaleString('fa-IR')} ساعت` };
    }
  }
  // ۲) تعداد ساعت
  if (map.hour_field && mode !== 'day') {
    const h = toNumber(formData?.[map.hour_field]);
    if (h > 0) return { hours: h, unit: 'hour', label: `${h.toLocaleString('fa-IR')} ساعت` };
  }
  // ۳) تعداد روز
  if (map.day_field && mode !== 'hour') {
    const d = toNumber(formData?.[map.day_field]);
    if (d > 0) return { hours: d * wd, unit: 'day', label: `${d.toLocaleString('fa-IR')} روز` };
  }
  return null;
}

// بازهٔ تاریخِ مرخصی — در حالت ساعتی، شروع و پایان همان «تاریخ مرخصی» است
export function resolveLeaveDates(map, formData) {
  const val = (k) => (k ? String(formData?.[k] ?? '').trim() : '');
  if (resolveLeaveMode(map, formData) === 'hour' && val(map.date_field)) {
    return { from: val(map.date_field), to: val(map.date_field) };
  }
  return { from: val(map.from_field) || val(map.date_field), to: val(map.to_field) || val(map.from_field) };
}

// خلاصهٔ مرخصیِ یک فرم (برای نمایشِ درخواست‌هایی که هنوز تایید نشده‌اند)
export function leaveSummary(map, formData) {
  if (map.legacy_map && !resolveAmountHours(map, formData)) map = map.legacy_map;
  return {
    mode: resolveLeaveMode(map, formData),
    type: resolveLeaveType(map, formData),
    amount: resolveAmountHours(map, formData),
    ...resolveLeaveDates(map, formData),
  };
}

// درخواستِ تاییدشده را در صورت «مرخصی بودن» از ماندهٔ کاربر کم می‌کند.
// خطاها بلعیده می‌شوند تا مشکلِ محاسبهٔ مرخصی هرگز گردش‌کار را متوقف نکند.
export function applyLeaveDeduction(rq, tpl) {
  try {
    if (!tpl?.leave_enabled) return null;
    // قبلاً برای همین درخواست ثبت شده؟
    if (db.prepare('SELECT 1 FROM leave_ledger WHERE request_id = ?').get(rq.id)) return null;

    let map = parseJson(tpl.leave_map || '{}', {});
    const formData = parseJson(rq.form_data || '{}', {});
    let amount = resolveAmountHours(map, formData);
    // درخواستی که قبل از ارتقای فرآیند ثبت شده، با نگاشتِ قدیمی خوانده می‌شود
    if (!amount && map.legacy_map) {
      map = map.legacy_map;
      amount = resolveAmountHours(map, formData);
    }
    if (!amount || amount.hours <= 0) return null;

    const type = resolveLeaveType(map, formData);
    const year = currentJalaliYear();
    const { from, to } = resolveLeaveDates(map, formData);

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

// ============================================================================
//  ارتقای خودکارِ فرآیندهای مرخصیِ قدیمی به فرم ساده
//  کاربر نباید خودش فیلد نگاشت کند: هر فرآیندِ مرخصی که فیلدِ «ساعتی/روزانه»
//  ندارد، فیلدهای استاندارد را می‌گیرد. فیلدهای قبلیِ مرخصی legacy می‌شوند
//  (در فرم ثبت دیده نمی‌شوند ولی درخواست‌های قدیمی همچنان نمایش داده می‌شوند)
//  و نگاشت قبلی در legacy_map می‌ماند تا درخواست‌های در جریان درست کسر شوند.
//  این فهرست باید با LEAVE_SCHEMA در client/src/components/LeaveForm.jsx یکی باشد.
// ============================================================================
export const LEAVE_SCHEMA = [
  { key: 'leave_desc', label: 'توضیح مرخصی', type: 'textarea' },
  { key: 'leave_mode', label: 'نوع مرخصی', type: 'select', options: ['ساعتی', 'روزانه'], required: true },
  { key: 'leave_kind', label: 'عنوان مرخصی', type: 'select', options: ['استحقاقی', 'استعلاجی', 'بدون حقوق'] },
  { key: 'leave_date', label: 'تاریخ مرخصی ساعتی', type: 'date' },
  { key: 'leave_time', label: 'ساعت شروع و پایان', type: 'time_range' },
  { key: 'leave_hours', label: 'تعداد ساعت', type: 'number' },
  { key: 'leave_from', label: 'از تاریخ', type: 'date' },
  { key: 'leave_to', label: 'تا تاریخ', type: 'date' },
  { key: 'leave_days', label: 'تعداد روز', type: 'number' },
];
export const LEAVE_MAP = {
  mode_field: 'leave_mode', type_field: 'leave_kind', desc_field: 'leave_desc',
  date_field: 'leave_date', range_field: 'leave_time', hour_field: 'leave_hours',
  from_field: 'leave_from', to_field: 'leave_to', day_field: 'leave_days',
};
const MAP_KEYS = ['type_field', 'day_field', 'hour_field', 'range_field', 'from_field', 'to_field', 'date_field', 'desc_field'];

// فیلدهایی که شبیهِ فیلدِ مرخصی‌اند (حتی اگر نگاشت نشده باشند) — مثلاً «تعداد روز» یا «ساعت شروع»
const LOOKS_LIKE_LEAVE = /مرخصی|تعداد\s*(روز|ساعت)|ساعت\s*(شروع|پایان)|از\s*(تاریخ|ساعت)|تا\s*(تاریخ|ساعت)|تاریخ\s*(شروع|پایان)/;

export function upgradeLeaveTemplates() {
  try {
    const rows = db.prepare('SELECT id, form_schema, leave_map FROM workflow_templates WHERE leave_enabled = 1').all();
    const upd = db.prepare('UPDATE workflow_templates SET form_schema = ?, leave_map = ? WHERE id = ?');
    for (const t of rows) {
      const map = parseJson(t.leave_map || '{}', {});
      if (map.mode_field) continue;
      const schema = parseJson(t.form_schema || '[]', []);
      const mapped = new Set(MAP_KEYS.map(k => map[k]).filter(Boolean));
      const keep = (Array.isArray(schema) ? schema : [])
        .filter(f => !LEAVE_SCHEMA.some(x => x.key === f.key))
        .map(f => (mapped.has(f.key) || LOOKS_LIKE_LEAVE.test(f.label || ''))
          ? { ...f, legacy: true, required: false } : f);
      const legacy = {};
      for (const k of [...MAP_KEYS, 'default_type', 'type_values']) if (map[k]) legacy[k] = map[k];
      const next = { ...LEAVE_MAP, default_type: map.default_type || 'entitled',
        ...(map.type_values ? { type_values: map.type_values } : {}),
        ...(Object.keys(legacy).length ? { legacy_map: legacy } : {}) };
      upd.run(JSON.stringify([...LEAVE_SCHEMA, ...keep]), JSON.stringify(next), t.id);
      console.log(`[leave] فرآیند مرخصی #${t.id} به فرم ساده ارتقا یافت`);
    }
  } catch (e) {
    console.error('leave template upgrade failed:', e.message);
  }
}
