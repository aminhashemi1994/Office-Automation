// ============================================================================
//  ابزارهای دستیار هوشمند
//  دستیار از طریق همین ابزارها اطلاعات می‌خواند و کار انجام می‌دهد.
//
//  دو قاعدهٔ اصلی:
//  ۱) هر ابزار، API خودِ سامانه را «به‌جای همین کاربر» صدا می‌زند (با یک توکنِ
//     کوتاه‌عمر). پس دسترسی‌ها، اعتبارسنجی، اعلان‌ها و رویدادهای زنده دقیقاً
//     مثل وقتی است که کاربر خودش در رابط کاربری کلیک کرده باشد — دستیار هیچ
//     راهِ میان‌بُری به دیتابیس برای «نوشتن» ندارد.
//  ۲) ابزارهای «نوشتنی» هرگز مستقیم اجرا نمی‌شوند. اول ورودی را کامل بررسی
//     می‌کنند؛ اگر چیزی کم یا نادرست بود، به مدل برمی‌گردانند تا از کاربر بپرسد.
//     اگر کامل بود، یک «کارت تأیید» می‌سازند و فقط با کلیکِ خودِ کاربر اجرا می‌شوند.
//
//  برای افزودنِ امکان تازه: یک ورودی به READ_TOOLS یا WRITE_TOOLS اضافه کنید.
// ============================================================================
import jwt from 'jsonwebtoken';
import db from './db.js';
import { JWT_SECRET } from './auth.js';
import { config } from './config.js';
import { deptHeads, deptDirectors } from './acl.js';
import { canBuildWorkflows } from './routes/workflows.js';
import { canUseCrm } from './routes/crm.js';
import { toGregorian, toJalaali, formatJalali, parseJalali } from '../client/src/jalali.js';

export class ToolError extends Error {
  constructor(message, extra = {}) { super(message); Object.assign(this, extra); }
}

// ---------------------------------------------------------------------------
//  فراخوانیِ API سامانه به‌جای کاربر
// ---------------------------------------------------------------------------
const LOOPBACK = ['0.0.0.0', '::', ''].includes(config.host) ? '127.0.0.1' : config.host;

async function api(user, method, path, body) {
  const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '2m' });
  let resp;
  try {
    resp = await fetch(`http://${LOOPBACK}:${config.port}/api${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ToolError('ارتباط داخلی با سرور برقرار نشد');
  }
  const data = await resp.json().catch(() => null);
  if (!resp.ok) throw new ToolError(data?.error || `خطای سرور (${resp.status})`);
  return data;
}

// ---------------------------------------------------------------------------
//  کمکی‌ها: متن فارسی، تاریخ شمسی، خلاصه‌سازی
// ---------------------------------------------------------------------------
const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹', AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';
export const enDigits = (s) => String(s ?? '')
  .replace(/[۰-۹]/g, d => FA_DIGITS.indexOf(d)).replace(/[٠-٩]/g, d => AR_DIGITS.indexOf(d));
// یکسان‌سازی برای جست‌وجو: ي/ك عربی، نیم‌فاصله، فاصله‌های اضافه
export const norm = (s) => enDigits(s).replace(/ي/g, 'ی').replace(/ك/g, 'ک').replace(/[‌‏]/g, ' ')
  .replace(/\s+/g, ' ').trim().toLowerCase();
const str = (v, max = 500) => String(v ?? '').trim().slice(0, max);

// ایران از ۱۴۰۱ ساعت تابستانی ندارد؛ اختلاف ثابت +۰۳:۳۰ است
const TEHRAN_OFFSET = '+03:30';

function tehranParts(d = new Date()) {
  return Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(d).map(p => [p.type, p.value]));
}

// تاریخِ امروز (تهران) به شمسی
export function tehranTodayJalali(offsetDays = 0) {
  const p = tehranParts(new Date(Date.now() + offsetDays * 86400000));
  return toJalaali(+p.year, +p.month, +p.day);
}

// ورودیِ تاریخ را به «1405/07/17» تبدیل می‌کند؛ میلادیِ ‎2026-10-09‎ را هم می‌پذیرد
export function normalizeJalali(input) {
  const s = enDigits(input).trim().replace(/[-.]/g, '/');
  const m = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(s);
  if (!m) return null;
  let [y, mo, d] = [+m[1], +m[2], +m[3]];
  if (y > 1900) ({ jy: y, jm: mo, jd: d } = toJalaali(y, mo, d));
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || (mo > 6 && d > 30)) return null;
  return formatJalali(y, mo, d);
}

// عبارت‌های نسبی را خودِ سرور به تاریخ تبدیل می‌کند تا محاسبهٔ تقویم به مدل سپرده نشود:
// «امروز»، «فردا»، «پس‌فردا»، «پنجشنبه»، «شنبهٔ هفتهٔ بعد»، «۳ روز دیگر»، «هفتهٔ بعد»
const WEEK_FA = ['شنبه', 'یکشنبه', 'دوشنبه', 'سه شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه']; // شروع هفته: شنبه
const NUM_WORDS = { یک: 1, دو: 2, سه: 3, چهار: 4, پنج: 5, شش: 6, هفت: 7, هشت: 8, نه: 9, ده: 10 };
function tehranWeekIndex() {   // شنبه=۰ … جمعه=۶
  const wd = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Tehran', weekday: 'short' }).format(new Date());
  return ['Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri'].indexOf(wd);
}
export function resolveDate(input) {
  const direct = normalizeJalali(input);
  if (direct) return direct;
  const s = norm(input).replace(/[ءأ]/g, '').replace(/ٔ/g, '').replace(/\s*‌\s*/g, ' ');
  if (!s) return null;
  const at = (o) => { const j = tehranTodayJalali(o); return formatJalali(j.jy, j.jm, j.jd); };
  if (/^(امروز|today)$/.test(s)) return at(0);
  if (/^(فردا|tomorrow)$/.test(s)) return at(1);
  if (/^پس ?فردا$/.test(s)) return at(2);
  if (/^دیروز$/.test(s)) return at(-1);
  const rel = /^(\d+|[آا-ی]+) (روز|هفته|ماه) (دیگر|بعد|آینده|later)$/.exec(s);
  if (rel) {
    const n = Number(rel[1]) || NUM_WORDS[rel[1]];
    if (n) return at(n * (rel[2] === 'روز' ? 1 : rel[2] === 'هفته' ? 7 : 30));
  }
  if (/^(هفته|هفته ی) (بعد|آینده)$/.test(s)) return at(7);
  // روزِ هفته؛ «سه شنبه» قبل از «شنبه» بررسی می‌شود
  const day = [...WEEK_FA.keys()].sort((a, b) => WEEK_FA[b].length - WEEK_FA[a].length)
    .find(i => s.includes(WEEK_FA[i]) || s.includes(WEEK_FA[i].replace(' ', '')));
  if (day === undefined) return null;
  const today = tehranWeekIndex();
  const nextWeek = /(هفته|هفته ی) ?(بعد|آینده|دیگر)|بعدی/.test(s);
  const offset = nextWeek ? (7 - today) + day : (day - today + 7) % 7;
  return at(offset);
}

// عبارت‌های تاریخِ نسبی در متنِ کاربر — برای اصلاحِ تاریخی که مدل اشتباه حساب کرده
const DATE_EXPR = new RegExp([
  '(?:سه ?\u200c?شنبه|چهارشنبه|پنج ?\u200c?شنبه|یک ?\u200c?شنبه|دو ?\u200c?شنبه|جمعه|شنبه)'
    + '(?:[ٔ\u200c ]*(?:ی )?(?:همین هفته|این هفته|هفته ?\u200c?(?:ی )?(?:بعد|آینده|دیگر)|بعدی))?',
  'پس ?\u200c?فردا', 'فردا', 'امروز',
  '(?:\\d+|[۰-۹]+|یک|دو|سه|چهار|پنج|شش|هفت|هشت|نه|ده) (?:روز|هفته) (?:دیگر|بعد|آینده)',
].join('|'), 'g');
export function datesInText(text) {
  const found = new Set();
  for (const m of String(text || '').matchAll(DATE_EXPR)) {
    const d = resolveDate(m[0].replace(/\u200c/g, ' '));
    if (d) found.add(d);
  }
  return [...found];
}

export function normalizeTime(input) {
  let t = enDigits(input).trim().replace(/^ساعت\s*/, '');
  const pm = /(بعد ?از ?ظهر|عصر|شب|pm)/i.test(t);
  t = t.replace(/\s*(صبح|ظهر|بعد ?از ?ظهر|عصر|شب|am|pm)\s*/gi, '');
  if (/^\d{1,2}$/.test(t)) t += ':00';
  if (pm) t = t.replace(/^(\d{1,2})/, (h) => (+h < 12 ? +h + 12 : +h));
  const m = /^(\d{1,2}):(\d{2})$/.exec(t);
  if (!m || +m[1] > 23 || +m[2] > 59) return null;
  return `${m[1].padStart(2, '0')}:${m[2]}`;
}

// تاریخ شمسی + ساعت (به وقت تهران) ← ISO؛ همان قراردادی که فرم‌های سامانه ذخیره می‌کنند
function jalaliToIso(date, time, defaultTime = '09:00', label = 'تاریخ') {
  if (!date) return null;
  const j = parseJalali(resolveDate(date) || '');
  if (!j) throw new ToolError(`${label} نامعتبر است؛ قالب درست: 1405/07/20`);
  const t = time ? normalizeTime(time) : defaultTime;
  if (!t) throw new ToolError(`ساعتِ ${label} نامعتبر است؛ قالب درست: 14:30`);
  const g = toGregorian(j.jy, j.jm, j.jd);
  const p2 = (n) => String(n).padStart(2, '0');
  return new Date(`${g.gy}-${p2(g.gm)}-${p2(g.gd)}T${t}:00${TEHRAN_OFFSET}`).toISOString();
}

// ISO ← «1405/07/17 14:30» به وقت تهران — برای خواناییِ خروجیِ ابزارها
export function isoToFa(iso) {
  if (!iso) return null;
  const d = new Date(String(iso).includes('T') || String(iso).endsWith('Z') ? iso : String(iso).replace(' ', 'T') + 'Z');
  if (isNaN(d)) return iso;
  const p = tehranParts(d);
  const j = toJalaali(+p.year, +p.month, +p.day);
  return `${formatJalali(j.jy, j.jm, j.jd)} ${p.hour}:${p.minute}`;
}

// برای کارت تأیید: «پنجشنبه 1405/07/16 ساعت 10:00» — روزِ هفته جلوی اشتباهِ تاریخ را می‌گیرد
const WEEKDAY_FA = { Sat: 'شنبه', Sun: 'یکشنبه', Mon: 'دوشنبه', Tue: 'سه‌شنبه', Wed: 'چهارشنبه', Thu: 'پنجشنبه', Fri: 'جمعه' };
function whenFa(iso) {
  const wd = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Tehran', weekday: 'short' }).format(new Date(iso));
  const [d, t] = isoToFa(iso).split(' ');
  return `${WEEKDAY_FA[wd]} ${d} ساعت ${t}`;
}
function jalaliWithWeekday(jdate) {
  const j = parseJalali(jdate);
  const g = toGregorian(j.jy, j.jm, j.jd);
  const wd = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short' }).format(Date.UTC(g.gy, g.gm - 1, g.gd));
  return `${WEEKDAY_FA[wd]} ${jdate}`;
}

// خروجی ابزار باید کوتاه و بی‌حاشیه باشد: کلیدهای نمایشی حذف، رشته‌ها و آرایه‌ها کوتاه
const DROP_KEYS = /(^avatar|_color$|^color$|signature|password|token|^sort_order$|_path$|^hidden$|^reminded$)/;
const DATE_KEYS = /(_at$|^deadline$|^start_at$|^remind_at$)/;
function compact(v, depth = 0) {
  if (v == null) return v;
  if (Array.isArray(v)) return v.slice(0, 40).map(x => compact(x, depth + 1));
  if (typeof v === 'object') {
    if (depth > 4) return '…';
    const out = {};
    for (const [k, x] of Object.entries(v)) {
      if (DROP_KEYS.test(k) || x === null || x === '' || (Array.isArray(x) && !x.length)) continue;
      if (typeof x === 'string' && /^[[{]/.test(x)) {   // ستون‌های JSON ذخیره‌شده
        try { out[k] = compact(JSON.parse(x), depth + 1); continue; } catch {}
      }
      out[k] = DATE_KEYS.test(k) && typeof x === 'string' ? isoToFa(x) : compact(x, depth + 1);
    }
    return out;
  }
  if (typeof v === 'string' && v.length > 600) return v.slice(0, 600) + '…';
  return v;
}

const userName = (id) => id ? db.prepare('SELECT full_name FROM users WHERE id = ?').get(id)?.full_name : null;
const deptName = (id) => id ? db.prepare('SELECT name FROM departments WHERE id = ?').get(id)?.name : null;
const activeUser = (id) => db.prepare('SELECT id, full_name FROM users WHERE id = ? AND is_active = 1').get(Number(id));

function requireUser(id, label) {
  const u = activeUser(id);
  if (!u) throw new ToolError(`${label} (شناسهٔ ${id}) یافت نشد؛ اول با find_people شناسهٔ درست را پیدا کن`);
  return u;
}

const STATUS_FA = {
  in_progress: 'در جریان', awaiting_requester: 'منتظر تایید نهایی درخواست‌دهنده', returned: 'برگشت برای اصلاح',
  approved: 'تایید شده', rejected: 'رد شده', cancelled: 'لغو شده',
  todo: 'انجام‌نشده', doing: 'در حال انجام', done: 'انجام‌شده',
};
const PRIORITY_FA = { low: 'کم', normal: 'عادی', high: 'زیاد', urgent: 'فوری' };
const FIELD_TYPES_FA = {
  text: 'متن', number: 'عدد', textarea: 'متن بلند', date: 'تاریخ شمسی', time: 'ساعت',
  time_range: 'بازهٔ ساعت', select: 'انتخابی', image: 'تصویر', file: 'فایل',
};
const APPROVER_FA = {
  requester_head: 'سرگروهِ واحدِ درخواست‌دهنده', requester_director: 'مدیرِ واحدِ درخواست‌دهنده',
  requester_manager: 'سرگروه یا مدیرِ واحدِ درخواست‌دهنده', dept_head: 'سرگروهِ واحد',
  dept_director: 'مدیرِ واحد', dept_manager: 'سرگروه یا مدیرِ واحد', dept_member: 'یکی از اعضای واحد',
  user: 'کاربر مشخص', role: 'همهٔ کاربران با نقش',
};
const DATE_DESC = "Jalali date (1405/07/20) OR the user's relative words verbatim (امروز، فردا، پس\u200cفردا، پنجشنبه، پنجشنبه هفته بعد، ۳ روز دیگر) — the server resolves them; never compute weekdays yourself";
const NEEDS_DEPT = new Set(['dept_head', 'dept_director', 'dept_manager', 'dept_member']);

// ---------------------------------------------------------------------------
//  فرآیندها (قالب‌های گردش‌کار)
// ---------------------------------------------------------------------------
async function templatesFor(user) {
  return (await api(user, 'GET', '/workflows/templates')).templates || [];
}

async function templateFor(user, id) {
  const t = (await templatesFor(user)).find(x => x.id === Number(id));
  if (!t) throw new ToolError(`فرآیند ${id} یافت نشد یا برای شما در دسترس نیست؛ با list_processes فهرست را ببین`);
  return t;
}

const schemaOf = (t) => { try { const s = JSON.parse(t.form_schema || '[]'); return Array.isArray(s) ? s : []; } catch { return []; } };

function describeField(f) {
  return {
    key: f.key, label: f.label, type: f.type, type_fa: FIELD_TYPES_FA[f.type] || f.type,
    required: !!f.required,
    ...(f.options?.length ? { options: f.options } : {}),
    ...(f.placeholder ? { hint: f.placeholder } : {}),
    ...((f.type === 'file' || f.type === 'image') ? { note: 'پیوست فایل فقط از فرمِ کارتابل ممکن است' } : {}),
  };
}

// مقدارِ یک فیلد را بر اساس نوعش بررسی و یکسان می‌کند؛ اگر نادرست بود پیامِ خطا برمی‌گرداند
function coerceField(f, raw) {
  if (f.type === 'time_range') {
    const v = typeof raw === 'string' ? (() => { const [a, b] = enDigits(raw).split(/\s*(?:-|تا|to)\s*/); return { start: a, end: b }; })() : raw || {};
    const start = normalizeTime(v.start || ''), end = normalizeTime(v.end || '');
    if (!start || !end) return { error: `«${f.label}» باید بازهٔ ساعت باشد، مثلاً 08:00 تا 12:30` };
    if (end <= start) return { error: `در «${f.label}» ساعتِ پایان باید بعد از شروع باشد` };
    return { value: { start, end }, show: `${start} تا ${end}` };
  }
  const s = str(typeof raw === 'object' ? JSON.stringify(raw) : raw, 5000);
  if (f.type === 'number') {
    const n = Number(enDigits(s).replace(/[,٬،\s]/g, ''));
    if (!Number.isFinite(n)) return { error: `«${f.label}» باید عدد باشد` };
    return { value: String(n), show: n.toLocaleString('fa-IR') };
  }
  if (f.type === 'date') {
    const d = resolveDate(s);
    if (!d) return { error: `«${f.label}» باید تاریخ شمسی باشد، مثلاً 1405/07/20` };
    return { value: d, show: jalaliWithWeekday(d) };
  }
  if (f.type === 'time') {
    const t = normalizeTime(s);
    if (!t) return { error: `«${f.label}» باید ساعت باشد، مثلاً 14:30` };
    return { value: t, show: t };
  }
  if (f.type === 'select') {
    const opts = (f.options || []).map(String);
    const hit = opts.find(o => norm(o) === norm(s)) || opts.find(o => norm(o).includes(norm(s)) && norm(s).length > 1);
    if (!hit) return { error: `«${f.label}» باید یکی از این گزینه‌ها باشد: ${opts.join('، ')}` };
    return { value: hit, show: hit };
  }
  return { value: s, show: s.length > 160 ? s.slice(0, 160) + '…' : s };
}

// ورودیِ مدل برای فیلدهای فرم را به form_data تبدیل می‌کند (کلید یا عنوانِ فیلد هر دو پذیرفته است)
function buildFormData(schema, fields, existing = {}) {
  const given = new Map(Object.entries(fields || {}).map(([k, v]) => [norm(k), v]));
  const data = { ...existing }, lines = [], missing = [], errors = [];
  for (const f of schema) {
    if (!f?.key) continue;
    const isFile = f.type === 'file' || f.type === 'image';
    const raw = given.has(norm(f.key)) ? given.get(norm(f.key)) : given.get(norm(f.label));
    const empty = raw === undefined || raw === null || (typeof raw === 'string' && !raw.trim());
    if (isFile) {
      if (f.required && !(Array.isArray(data[f.key]) && data[f.key].length)) {
        errors.push(`فیلدِ «${f.label}» پیوستِ فایلِ اجباری است و از گفتگو قابل ارسال نیست`);
      }
      continue;
    }
    if (empty) {
      if (data[f.key] !== undefined && data[f.key] !== '') continue;   // ویرایش: مقدارِ قبلی بماند
      if (f.required) missing.push(describeField(f));
      continue;
    }
    const c = coerceField(f, raw);
    if (c.error) { errors.push(c.error); continue; }
    data[f.key] = c.value;
    lines.push([f.label, c.show]);
  }
  const known = new Set(schema.flatMap(f => [norm(f.key), norm(f.label)]));
  const unknown = [...given.keys()].filter(k => !known.has(k));
  return { data, lines, missing, errors, unknown };
}

function stepSpec(s, i) {
  const type = s.approver_type;
  if (!APPROVER_FA[type]) {
    throw new ToolError(`نوعِ تاییدکنندهٔ مرحلهٔ ${i + 1} نامعتبر است؛ یکی از: ${Object.keys(APPROVER_FA).join(', ')}`);
  }
  const spec = {
    title: str(s.title, 120) || `مرحلهٔ ${i + 1}`, approver_type: type,
    deadline_hours: Math.max(0, Number(s.deadline_hours) || 0), is_optional: s.is_optional ? 1 : 0,
    requires_signature: s.requires_signature === false ? 0 : 1,
  };
  let who = APPROVER_FA[type];
  if (NEEDS_DEPT.has(type)) {
    const name = deptName(Number(s.department_id));
    if (!name) throw new ToolError(`برای مرحلهٔ «${spec.title}» واحد (department_id) لازم است؛ با list_departments پیدا کن`);
    spec.approver_id = Number(s.department_id); who += ` «${name}»`;
  } else if (type === 'user') {
    const u = requireUser(s.user_id, `تاییدکنندهٔ مرحلهٔ «${spec.title}»`);
    spec.approver_id = u.id; who = u.full_name;
  } else if (type === 'role') {
    if (!['admin', 'manager', 'employee'].includes(s.role)) throw new ToolError(`برای مرحلهٔ «${spec.title}» نقش (admin/manager/employee) لازم است`);
    spec.approver_role = s.role; who += ` ${s.role}`;
  }
  return { spec, line: [`مرحلهٔ ${i + 1}: ${spec.title}`, who + (spec.deadline_hours ? ` — مهلت ${spec.deadline_hours} ساعت` : '') + (spec.is_optional ? ' (اختیاری)' : '')] };
}

function fieldSpecs(fields) {
  const used = new Set();
  return (Array.isArray(fields) ? fields : []).map((f, i) => {
    const label = str(f.label, 120);
    if (!label) throw new ToolError(`فیلدِ شمارهٔ ${i + 1} عنوان ندارد`);
    const type = FIELD_TYPES_FA[f.type] ? f.type : 'text';
    let key = str(f.key, 40).replace(/[^a-zA-Z0-9_]/g, '') || `f${i + 1}`;
    while (used.has(key)) key += '_';
    used.add(key);
    const out = { key, label, type, required: !!f.required };
    if (type === 'select') {
      out.options = (Array.isArray(f.options) ? f.options : String(f.options || '').split(/[،,\n]/)).map(o => str(o, 100)).filter(Boolean);
      if (out.options.length < 2) throw new ToolError(`فیلدِ انتخابیِ «${label}» حداقل دو گزینه لازم دارد`);
    }
    if (f.placeholder) out.placeholder = str(f.placeholder, 120);
    return out;
  });
}

// ---------------------------------------------------------------------------
//  ابزارهای خواندنی — بی‌درنگ اجرا می‌شوند
// ---------------------------------------------------------------------------
const READ_TOOLS = {
  get_my_overview: {
    description: 'Snapshot of the current user: cartable items waiting for their action, their open requests, open/overdue tasks. Use for "what do I have to do", "my status", greetings with intent, etc.',
    parameters: { type: 'object', properties: {} },
    label: 'مرور کارهای شما',
    async run(user) {
      const [inbox, mine, tasks] = await Promise.all([
        api(user, 'GET', '/workflows/requests/inbox'), api(user, 'GET', '/workflows/requests/mine'), api(user, 'GET', '/tasks'),
      ]);
      const now = Date.now();
      const open = tasks.mine.filter(t => t.status !== 'done');
      return {
        cartable_waiting_for_me: inbox.requests.slice(0, 15).map(r => ({
          id: r.id, title: r.title, process: r.template_name, requester: r.requester_name, step: r.step_title,
          status: STATUS_FA[r.status], since: isoToFa(r.created_at), link: `/cartable/${r.id}`,
        })),
        my_open_requests: mine.requests.filter(r => ['in_progress', 'awaiting_requester', 'returned'].includes(r.status))
          .slice(0, 15).map(r => ({ id: r.id, title: r.title, process: r.template_name, status: STATUS_FA[r.status], step: r.step_title, link: `/cartable/${r.id}` })),
        open_tasks: open.length,
        overdue_tasks: open.filter(t => t.deadline && new Date(t.deadline) < now)
          .slice(0, 10).map(t => ({ id: t.id, title: t.title, deadline: isoToFa(t.deadline), link: `/tasks?task=${t.id}` })),
        next_tasks: open.filter(t => t.deadline && new Date(t.deadline) >= now).slice(0, 8)
          .map(t => ({ id: t.id, title: t.title, deadline: isoToFa(t.deadline), priority: PRIORITY_FA[t.priority] })),
      };
    },
  },

  list_processes: {
    description: 'List the workflow processes (فرآیند / نوع درخواست) this user can submit requests for, e.g. leave, purchase, warehouse. Optionally filter by a search phrase. Call before submit_request to find the process id.',
    parameters: { type: 'object', properties: { query: { type: 'string', description: 'optional search phrase, e.g. "مرخصی"' } } },
    label: 'جست‌وجوی فرآیندها',
    async run(user, { query }) {
      let list = (await templatesFor(user)).filter(t => t.is_active);
      if (query && norm(query).length > 1) {
        const words = norm(query).split(' ').filter(w => w.length > 1);
        const scored = list.map(t => {
          const hay = norm(`${t.name} ${t.description || ''}`);
          return { t, score: words.filter(w => hay.includes(w)).length };
        }).filter(x => x.score > 0).sort((a, b) => b.score - a.score);
        if (scored.length) list = scored.map(x => x.t);
      }
      return {
        processes: list.slice(0, 40).map(t => ({
          id: t.id, name: t.name, description: str(t.description, 200) || undefined, owner_department: t.owner_dept_name || undefined,
          fields: schemaOf(t).map(f => f.label + (f.required ? '*' : '')).join('، '), steps: t.steps.length,
          can_manage: t.can_manage || undefined,
        })),
        can_create_processes: canBuildWorkflows(user),
      };
    },
  },

  get_process: {
    description: 'Full definition of one process: every form field (key, label, type, required, options), the approval chain with the actual people for this user, and rules. Always call this before submit_request so you know which fields to ask the user for.',
    parameters: { type: 'object', properties: { process_id: { type: 'integer' } }, required: ['process_id'] },
    label: 'خواندن تعریف فرآیند',
    async run(user, { process_id }) {
      const t = await templateFor(user, process_id);
      const preview = await api(user, 'GET', `/workflows/templates/${t.id}/preview`).catch(() => ({ steps: t.steps }));
      return {
        id: t.id, name: t.name, description: t.description || undefined, active: !!t.is_active,
        title_hint: t.title_placeholder || undefined,
        fields: schemaOf(t).map(describeField),
        approval_chain: preview.steps.map(s => ({
          step: s.step_order, title: s.title, approver: s.approver_label,
          people: (s.approver_people || []).map(p => p.full_name).slice(0, 6),
          deadline_hours: s.deadline_hours || undefined, optional: s.is_optional ? true : undefined,
          approver_type: s.approver_type, department_id: NEEDS_DEPT.has(s.approver_type) ? s.approver_id : undefined,
          user_id: s.approver_type === 'user' ? s.approver_id : undefined, role: s.approver_role || undefined,
        })),
        allows_backdating_days: t.past_days_limit || 0,
        allows_on_behalf: !!t.allow_on_behalf, allows_cc: !!t.cc_mode, allows_attachments: !!t.allow_attachments,
        is_leave_process: !!t.leave_enabled,
        can_manage: !!t.can_manage,
      };
    },
  },

  list_cartable: {
    description: 'List cartable requests. box: "inbox" = waiting for my action, "mine" = requests I submitted, "following" = processes I am responsible to follow up, "all" = everything I am allowed to see (managers).',
    parameters: {
      type: 'object',
      properties: {
        box: { type: 'string', enum: ['inbox', 'mine', 'following', 'all'] },
        status: { type: 'string', enum: ['open', 'approved', 'rejected', 'any'], description: 'default any' },
        query: { type: 'string', description: 'optional filter on title/process/requester' },
      },
      required: ['box'],
    },
    label: 'خواندن کارتابل',
    async run(user, { box, status = 'any', query }) {
      const data = await api(user, 'GET', `/workflows/requests/${box}`);
      let rows = data.requests || [];
      if (status === 'open') rows = rows.filter(r => ['in_progress', 'awaiting_requester', 'returned'].includes(r.status));
      else if (status !== 'any') rows = rows.filter(r => r.status === status);
      if (query) rows = rows.filter(r => norm(`${r.title} ${r.template_name} ${r.requester_name || ''}`).includes(norm(query)));
      return {
        total: rows.length,
        requests: rows.slice(0, 25).map(r => ({
          id: r.id, title: r.title, process: r.template_name, requester: r.requester_name, status: STATUS_FA[r.status] || r.status,
          step: r.step_title, created: isoToFa(r.created_at), can_quick_approve: r.can_quick_approve || undefined,
          link: `/cartable/${r.id}`,
        })),
      };
    },
  },

  get_request: {
    description: 'Full detail of one cartable request: form values, approval steps with who is responsible, history of actions and comments.',
    parameters: { type: 'object', properties: { request_id: { type: 'integer' } }, required: ['request_id'] },
    label: 'خواندن درخواست',
    async run(user, { request_id }) {
      const { request: r } = await api(user, 'GET', `/workflows/requests/${Number(request_id)}`);
      const out = compact(r);
      out.status_fa = STATUS_FA[r.status];
      out.link = `/cartable/${r.id}`;
      return out;
    },
  },

  find_people: {
    description: 'Find colleagues by (part of) name, username, position or department. Returns user ids needed by other tools (assignee, approver, cc, message recipient).',
    parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    label: 'جست‌وجوی همکاران',
    async run(user, { query }) {
      const words = norm(query).split(' ').filter(Boolean);
      if (!words.length) throw new ToolError('نامِ شخص را بده');
      const all = db.prepare(`SELECT u.id, u.full_name, u.username, u.position, u.role, u.department_id, d.name AS department
        FROM users u LEFT JOIN departments d ON d.id = u.department_id WHERE u.is_active = 1`).all();
      const hits = all.map(u => {
        const hay = norm(`${u.full_name} ${u.username} ${u.position || ''} ${u.department || ''}`);
        return { u, score: words.filter(w => hay.includes(w)).length + (norm(u.full_name) === norm(query) ? 5 : 0) };
      }).filter(x => x.score > 0).sort((a, b) => b.score - a.score).slice(0, 12);
      return { people: hits.map(({ u }) => ({ id: u.id, name: u.full_name, position: u.position || undefined, department: u.department || undefined, is_me: u.id === user.id || undefined })) };
    },
  },

  list_departments: {
    description: 'All departments (واحدها) with ids, heads (سرگروه) and directors (مدیر). Needed when a process step is approved by a department.',
    parameters: { type: 'object', properties: {} },
    label: 'خواندن واحدها',
    async run() {
      const rows = db.prepare('SELECT id, name, description FROM departments ORDER BY name').all();
      const names = (ids) => ids.map(id => userName(typeof id === 'object' ? id.id ?? id.user_id : id)).filter(Boolean);
      return {
        departments: rows.map(d => ({
          id: d.id, name: d.name, description: d.description || undefined,
          heads: names(deptHeads(d.id)), directors: names(deptDirectors(d.id)),
          members: db.prepare('SELECT COUNT(*) c FROM users WHERE department_id = ? AND is_active = 1').get(d.id).c,
        })),
      };
    },
  },

  list_my_tasks: {
    description: 'Tasks of the user. scope "mine" = assigned to me or I participate, "assigned_by_me" = tasks I gave to others.',
    parameters: {
      type: 'object',
      properties: {
        scope: { type: 'string', enum: ['mine', 'assigned_by_me'] },
        status: { type: 'string', enum: ['open', 'done', 'overdue', 'all'], description: 'default open' },
        query: { type: 'string' },
      },
      required: ['scope'],
    },
    label: 'خواندن وظایف',
    async run(user, { scope, status = 'open', query }) {
      const data = await api(user, 'GET', '/tasks');
      let rows = scope === 'assigned_by_me' ? data.assigned : data.mine;
      const now = Date.now();
      if (status === 'open') rows = rows.filter(t => t.status !== 'done');
      else if (status === 'done') rows = rows.filter(t => t.status === 'done');
      else if (status === 'overdue') rows = rows.filter(t => t.status !== 'done' && t.deadline && new Date(t.deadline) < now);
      if (query) rows = rows.filter(t => norm(`${t.title} ${t.description || ''} ${t.project_name || ''}`).includes(norm(query)));
      return {
        total: rows.length,
        tasks: rows.slice(0, 30).map(t => ({
          id: t.id, title: t.title, status: STATUS_FA[t.status], priority: PRIORITY_FA[t.priority],
          deadline: isoToFa(t.deadline) || undefined, assignee: t.assignee_name, assigner: t.assigner_name,
          project: t.project_name || undefined, checklist: t.step_count ? `${t.step_done}/${t.step_count}` : undefined,
          link: `/tasks?task=${t.id}`,
        })),
      };
    },
  },

  list_projects: {
    description: 'Task categories / projects (پروژه / دسته‌بندی) the user can file tasks under, with ids.',
    parameters: { type: 'object', properties: {} },
    label: 'خواندن پروژه‌ها',
    async run(user) {
      const data = await api(user, 'GET', '/projects');
      const list = data.projects || data;
      return { projects: (Array.isArray(list) ? list : []).slice(0, 60).map(p => ({ id: p.id, name: p.name, scope: p.scope, progress: p.progress })) };
    },
  },

  get_leave_balance: {
    description: 'Leave (مرخصی) balance of the current user for this Jalali year.',
    parameters: { type: 'object', properties: {} },
    label: 'ماندهٔ مرخصی',
    async run(user) {
      const data = await api(user, 'GET', '/leaves/balances');
      const me = data.balances.find(b => b.user_id === user.id);
      return { year: data.year, workday_hours: data.workday_hours, balance: compact(me), link: '/leaves' };
    },
  },

  search_system: {
    description: 'Global search across people, messages, requests, tasks, files, customers, tenders the user can see.',
    parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    label: 'جست‌وجو در سامانه',
    async run(user, { query }) {
      return compact(await api(user, 'GET', `/search?q=${encodeURIComponent(str(query, 100))}`));
    },
  },

  list_notes: {
    description: 'The user\'s notes (یادداشت‌ها), including ones shared with them.',
    parameters: { type: 'object', properties: { query: { type: 'string' } } },
    label: 'خواندن یادداشت‌ها',
    async run(user, { query }) {
      const data = await api(user, 'GET', '/notes');
      let notes = data.notes || [];
      if (query) notes = notes.filter(n => norm(`${n.title} ${n.body}`).includes(norm(query)));
      return { notes: notes.slice(0, 30).map(n => compact({ id: n.id, title: n.title, body: n.body, pinned: n.pinned, remind_at: n.remind_at, owner: n.owner_name })) };
    },
  },
};

// ---------------------------------------------------------------------------
//  ابزارهای نوشتنی — prepare ورودی را می‌سنجد و کارت تأیید می‌سازد؛
//  execute فقط پس از کلیکِ کاربر روی «تأیید» اجرا می‌شود.
//  prepare → { title, lines:[[label, value]], payload }
//  execute(user, payload) → { message, link }
// ---------------------------------------------------------------------------
const WRITE_TOOLS = {
  submit_request: {
    description: 'Submit a new cartable request for a process (e.g. leave, purchase). First call get_process, collect EVERY required field from the user (ask for what is missing, never invent values), then call this. Field values may be keyed by field key or label. Date fields: Jalali like 1405/07/20 or the user\'s relative words verbatim (فردا، شنبه هفته بعد) — the server resolves them. Times like 14:30, time_range as {"start","end"}.',
    parameters: {
      type: 'object',
      properties: {
        process_id: { type: 'integer' },
        title: { type: 'string', description: 'short descriptive title you compose from the content, e.g. "خرید ۵ مانیتور ۲۷ اینچ برای طراحی"' },
        fields: { type: 'object', description: 'form values: { field_key_or_label: value }', additionalProperties: true },
        cc_user_ids: { type: 'array', items: { type: 'integer' }, description: 'people to keep informed (only if the process allows cc)' },
        on_behalf_user_id: { type: 'integer', description: 'submit on behalf of this colleague (only if process allows)' },
      },
      required: ['process_id', 'fields'],
    },
    label: 'ثبت درخواست در کارتابل',
    async prepare(user, a) {
      const t = await templateFor(user, a.process_id);
      if (!t.is_active) throw new ToolError(`فرآیند «${t.name}» غیرفعال است`);
      const schema = schemaOf(t);
      const f = buildFormData(schema, a.fields);
      if (f.missing.length || f.errors.length) {
        throw new ToolError('اطلاعات درخواست کامل نیست', {
          missing_fields: f.missing, invalid: f.errors.length ? f.errors : undefined,
          hint: 'از کاربر فقط همین موارد را بپرس و دوباره submit_request را صدا بزن',
          ...(f.errors.some(e => e.includes('پیوست')) ? { open_form: '/cartable' } : {}),
        });
      }
      // عنوانِ پیش‌فرض از محتوای فرم ساخته می‌شود تا در کارتابل قابل تشخیص باشد
      const firstText = schema.find(x => ['select', 'text'].includes(x.type) && f.data[x.key]);
      const title = str(a.title, 200) || (firstText ? `${t.name} — ${str(f.data[firstText.key], 60)}` : t.name);
      const payload = { template_id: t.id, title, form_data: f.data };
      const lines = [['فرآیند', t.name], ['عنوان', title], ...f.lines];
      if (a.cc_user_ids?.length) {
        if (!t.cc_mode) throw new ToolError('این فرآیند رونوشت (cc) را نمی‌پذیرد');
        const people = a.cc_user_ids.map(id => requireUser(id, 'گیرندهٔ رونوشت'));
        payload.cc = people.map(p => p.id);
        lines.push(['رونوشت', people.map(p => p.full_name).join('، ')]);
      }
      if (a.on_behalf_user_id) {
        if (!t.allow_on_behalf) throw new ToolError('در این فرآیند ثبت به نمایندگی مجاز نیست');
        const u = requireUser(a.on_behalf_user_id, 'شخص');
        payload.on_behalf_id = u.id;
        lines.push(['از طرفِ', u.full_name]);
      }
      const preview = await api(user, 'GET', `/workflows/templates/${t.id}/preview`).catch(() => null);
      if (preview?.steps?.length) {
        lines.push(['مسیر تایید', preview.steps.map(s => `${s.title} (${(s.approver_people || []).map(p => p.full_name).slice(0, 2).join('/') || s.approver_label})`).join(' ← ')]);
      }
      return { title: 'ثبت درخواست جدید', lines, payload, ...(f.unknown.length ? { note: `این موارد در فرم نبودند و نادیده گرفته شدند: ${f.unknown.join('، ')}` } : {}) };
    },
    async execute(user, p) {
      const r = await api(user, 'POST', '/workflows/requests', p);
      return { message: `درخواست «${p.title}» با شمارهٔ ${r.id} ثبت شد${r.warning ? ` — ⚠️ ${r.warning}` : ''}`, link: `/cartable/${r.id}`, id: r.id };
    },
  },

  act_on_request: {
    description: 'Take an action on a cartable request where the user is the current approver (or the requester at final approval): approve, reject, return (send back; to_step 0 = back to requester for correction), or skip an optional step. Ask for a comment when rejecting or returning.',
    parameters: {
      type: 'object',
      properties: {
        request_id: { type: 'integer' },
        action: { type: 'string', enum: ['approve', 'reject', 'return', 'skip'] },
        comment: { type: 'string' },
        to_step: { type: 'integer', description: 'for return: step number to send back to; 0 = requester' },
      },
      required: ['request_id', 'action'],
    },
    label: 'اقدام روی درخواست',
    async prepare(user, a) {
      const { request: r } = await api(user, 'GET', `/workflows/requests/${Number(a.request_id)}`);
      if (!['in_progress', 'awaiting_requester'].includes(r.status)) throw new ToolError(`این درخواست «${STATUS_FA[r.status]}» است و اقدامی روی آن ممکن نیست`);
      if (['reject', 'return'].includes(a.action) && !str(a.comment)) {
        throw new ToolError('برای رد یا برگشت، دلیل (comment) لازم است', { hint: 'دلیل را از کاربر بپرس' });
      }
      const fa = { approve: 'تایید', reject: 'رد', return: 'برگشت', skip: 'عبور از مرحلهٔ اختیاری' }[a.action];
      const lines = [['درخواست', `#${r.id} — ${r.title}`], ['فرآیند', r.template_name], ['درخواست‌دهنده', r.requester_name], ['اقدام', fa]];
      if (a.action === 'return') lines.push(['برگشت به', Number(a.to_step) ? `مرحلهٔ ${a.to_step}` : 'درخواست‌دهنده (اصلاح)']);
      if (str(a.comment)) lines.push(['توضیح', str(a.comment, 1000)]);
      return {
        title: `${fa} درخواست`, lines, danger: a.action === 'reject',
        payload: { id: r.id, title: r.title, body: { action: a.action, comment: str(a.comment, 2000), ...(a.action === 'return' ? { to_step: Number(a.to_step) || 0 } : {}) } },
      };
    },
    async execute(user, p) {
      await api(user, 'POST', `/workflows/requests/${p.id}/action`, p.body);
      const fa = { approve: 'تایید شد', reject: 'رد شد', return: 'برگشت داده شد', skip: 'از این مرحله عبور کرد' }[p.body.action];
      return { message: `درخواست «${p.title}» ${fa}`, link: `/cartable/${p.id}` };
    },
  },

  comment_on_request: {
    description: 'Add a comment (یادداشت/نظر) to a cartable request without approving or rejecting it.',
    parameters: { type: 'object', properties: { request_id: { type: 'integer' }, comment: { type: 'string' } }, required: ['request_id', 'comment'] },
    label: 'ثبت نظر روی درخواست',
    async prepare(user, a) {
      if (!str(a.comment)) throw new ToolError('متنِ نظر خالی است');
      const { request: r } = await api(user, 'GET', `/workflows/requests/${Number(a.request_id)}`);
      return { title: 'ثبت نظر', lines: [['درخواست', `#${r.id} — ${r.title}`], ['نظر', str(a.comment, 1000)]], payload: { id: r.id, title: r.title, comment: str(a.comment, 2000) } };
    },
    async execute(user, p) {
      await api(user, 'POST', `/workflows/requests/${p.id}/comment`, { comment: p.comment });
      return { message: `نظر روی «${p.title}» ثبت شد`, link: `/cartable/${p.id}` };
    },
  },

  create_process: {
    description: 'Define a NEW workflow process (فرآیند): its form fields and approval steps. Only for users allowed to build processes. Gather from the user: name, what the form must contain, and who approves each step (look up departments/people for ids). Propose sensible defaults when the user is vague, but confirm the approval chain with them.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        description: { type: 'string' },
        title_hint: { type: 'string', description: 'placeholder shown for the request title' },
        fields: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              label: { type: 'string' }, type: { type: 'string', enum: Object.keys(FIELD_TYPES_FA) },
              required: { type: 'boolean' }, options: { type: 'array', items: { type: 'string' } }, placeholder: { type: 'string' },
            },
            required: ['label', 'type'],
          },
        },
        steps: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              approver_type: { type: 'string', enum: Object.keys(APPROVER_FA), description: Object.entries(APPROVER_FA).map(([k, v]) => `${k}=${v}`).join('; ') },
              department_id: { type: 'integer', description: 'for dept_* types' },
              user_id: { type: 'integer', description: 'for type user' },
              role: { type: 'string', enum: ['admin', 'manager', 'employee'], description: 'for type role' },
              deadline_hours: { type: 'integer' }, is_optional: { type: 'boolean' },
            },
            required: ['title', 'approver_type'],
          },
        },
        visible_to_department_ids: { type: 'array', items: { type: 'integer' }, description: 'limit who can submit; empty = everyone' },
        allow_attachments: { type: 'boolean' },
      },
      required: ['name', 'fields', 'steps'],
    },
    label: 'تعریف فرآیند جدید',
    async prepare(user, a) {
      if (!canBuildWorkflows(user)) throw new ToolError('شما مجاز به تعریف فرآیند نیستید؛ از مدیر سامانه یا مدیر واحد بخواهید');
      const name = str(a.name, 120);
      if (!name) throw new ToolError('نامِ فرآیند لازم است');
      if (!Array.isArray(a.steps) || !a.steps.length) throw new ToolError('حداقل یک مرحلهٔ تایید لازم است', { hint: 'بپرس چه کسی/کدام واحد تایید می‌کند' });
      const fields = fieldSpecs(a.fields);
      const steps = a.steps.map(stepSpec);
      const scope = (a.visible_to_department_ids || []).map(Number).filter(id => deptName(id));
      const lines = [
        ['نام', name], ...(a.description ? [['شرح', str(a.description, 300)]] : []),
        ['فیلدهای فرم', fields.map(f => `${f.label} (${FIELD_TYPES_FA[f.type]}${f.required ? '، اجباری' : ''}${f.options ? `: ${f.options.join('/')}` : ''})`).join('\n') || '—'],
        ...steps.map(s => s.line),
        ['قابل استفاده برای', scope.length ? scope.map(deptName).join('، ') : 'همهٔ واحدها'],
      ];
      return {
        title: 'تعریف فرآیند جدید', lines,
        payload: {
          name, description: str(a.description, 2000), title_placeholder: str(a.title_hint, 200),
          form_schema: fields, steps: steps.map(s => s.spec), scope_dept_ids: scope,
          allow_attachments: a.allow_attachments === false ? 0 : 1,
        },
      };
    },
    async execute(user, p) {
      const r = await api(user, 'POST', '/workflows/templates', p);
      return { message: `فرآیند «${p.name}» ساخته شد و از همین حالا در فرم «درخواست جدید» کارتابل در دسترس است`, link: '/workflows', id: r.id };
    },
  },

  update_process: {
    description: 'Edit an existing process the user can manage: rename, change description, activate/deactivate, or REPLACE its fields/steps (send the complete new list — call get_process first and keep unchanged items). Step changes are refused while the process has open requests.',
    parameters: {
      type: 'object',
      properties: {
        process_id: { type: 'integer' }, name: { type: 'string' }, description: { type: 'string' }, active: { type: 'boolean' },
        fields: { $ref: '#/fields' }, steps: { $ref: '#/steps' },
      },
      required: ['process_id'],
    },
    label: 'ویرایش فرآیند',
    async prepare(user, a) {
      const t = await templateFor(user, a.process_id);
      if (!t.can_manage) throw new ToolError(`شما اجازهٔ ویرایش فرآیند «${t.name}» را ندارید`);
      const payload = {}, lines = [['فرآیند', t.name]];
      if (str(a.name)) { payload.name = str(a.name, 120); lines.push(['نام جدید', payload.name]); }
      if (a.description !== undefined) { payload.description = str(a.description, 2000); lines.push(['شرح', payload.description || '—']); }
      if (a.active !== undefined) { payload.is_active = a.active ? 1 : 0; lines.push(['وضعیت', a.active ? 'فعال' : 'غیرفعال']); }
      if (Array.isArray(a.fields)) {
        // کلیدِ فیلدهای همنام حفظ می‌شود تا داده‌های درخواست‌های قبلی گم نشوند
        const old = new Map(schemaOf(t).map(f => [norm(f.label), f.key]));
        payload.form_schema = fieldSpecs(a.fields.map(f => ({ ...f, key: f.key || old.get(norm(f.label)) })));
        lines.push(['فیلدهای فرم', payload.form_schema.map(f => `${f.label} (${FIELD_TYPES_FA[f.type]}${f.required ? '، اجباری' : ''})`).join('\n')]);
      }
      if (Array.isArray(a.steps)) {
        if (!a.steps.length) throw new ToolError('حداقل یک مرحله لازم است');
        const steps = a.steps.map(stepSpec);
        payload.steps = steps.map(s => s.spec);
        lines.push(...steps.map(s => s.line));
      }
      if (Object.keys(payload).length === 0) throw new ToolError('هیچ تغییری مشخص نشده است');
      return { title: 'ویرایش فرآیند', lines, payload: { id: t.id, name: t.name, body: payload } };
    },
    async execute(user, p) {
      await api(user, 'PUT', `/workflows/templates/${p.id}`, p.body);
      return { message: `فرآیند «${p.body.name || p.name}» به‌روزرسانی شد`, link: '/workflows' };
    },
  },

  create_task: {
    description: 'Create a task (وظیفه/تسک), for the user or assigned to a colleague. Call it directly with what the user said: do NOT look up projects/tasks first and do NOT ask about optional things (project, description, start, reminder) — set project_id only if the user named a project (then find it with list_projects). If a project is mandatory the tool will tell you.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string' }, description: { type: 'string' },
        assignee_user_id: { type: 'integer', description: 'default: the user themself' },
        priority: { type: 'string', enum: ['low', 'normal', 'high', 'urgent'] },
        deadline_date: { type: 'string', description: DATE_DESC }, deadline_time: { type: 'string' },
        start_date: { type: 'string', description: DATE_DESC }, start_time: { type: 'string' },
        remind_date: { type: 'string', description: DATE_DESC }, remind_time: { type: 'string' },
        project_id: { type: 'integer' },
        checklist: { type: 'array', items: { type: 'string' } },
        participant_user_ids: { type: 'array', items: { type: 'integer' } },
      },
      required: ['title'],
    },
    label: 'ساخت وظیفه',
    async prepare(user, a) {
      const title = str(a.title, 200);
      if (!title) throw new ToolError('عنوانِ وظیفه لازم است');
      const assignee = a.assignee_user_id ? requireUser(a.assignee_user_id, 'مسئول انجام') : { id: user.id, full_name: user.full_name };
      const payload = {
        title, description: str(a.description, 5000), assignee_id: assignee.id, priority: PRIORITY_FA[a.priority] ? a.priority : 'normal',
        deadline: jalaliToIso(a.deadline_date, a.deadline_time, '17:00', 'مهلت'),
        start_at: jalaliToIso(a.start_date, a.start_time, '08:00', 'زمان شروع'),
        remind_at: jalaliToIso(a.remind_date, a.remind_time, '09:00', 'یادآوری'),
        steps: (a.checklist || []).map(s => str(s, 200)).filter(Boolean),
        participant_ids: (a.participant_user_ids || []).map(id => requireUser(id, 'همکار').id),
      };
      if (a.project_id) payload.project_id = Number(a.project_id);
      else if (db.prepare("SELECT value FROM app_settings WHERE key = 'tasks_require_project'").get()?.value === '1') {
        const projects = (await api(user, 'GET', '/projects')).projects || [];
        throw new ToolError('در این سازمان انتخابِ پروژه برای هر وظیفه اجباری است', {
          missing_fields: [{ key: 'project_id', label: 'پروژه', options: projects.slice(0, 30).map(p => `${p.id}: ${p.name}`) }],
        });
      }
      const lines = [['عنوان', title], ['مسئول', assignee.id === user.id ? 'خودتان' : assignee.full_name], ['اولویت', PRIORITY_FA[payload.priority]]];
      if (payload.description) lines.push(['شرح', payload.description.slice(0, 300)]);
      if (payload.start_at) lines.push(['شروع', whenFa(payload.start_at)]);
      if (payload.deadline) lines.push(['مهلت', whenFa(payload.deadline)]);
      if (payload.remind_at) lines.push(['یادآوری', whenFa(payload.remind_at)]);
      if (payload.steps.length) lines.push(['چک‌لیست', payload.steps.join('\n')]);
      if (payload.participant_ids.length) lines.push(['همکاران', payload.participant_ids.map(userName).join('، ')]);
      if (payload.project_id) {
        const proj = db.prepare('SELECT name FROM projects WHERE id = ?').get(payload.project_id);
        if (!proj) throw new ToolError('پروژه یافت نشد؛ با list_projects شناسه را پیدا کن');
        lines.push(['پروژه', proj.name]);
      }
      return { title: 'ساخت وظیفهٔ جدید', lines, payload };
    },
    async execute(user, p) {
      const r = await api(user, 'POST', '/tasks', p);
      return { message: `وظیفهٔ «${p.title}» ساخته شد`, link: `/tasks?task=${r.id}`, id: r.id };
    },
  },

  update_task: {
    description: 'Change an existing task: status (todo/doing/done), priority, deadline, title or description.',
    parameters: {
      type: 'object',
      properties: {
        task_id: { type: 'integer' }, status: { type: 'string', enum: ['todo', 'doing', 'done'] },
        priority: { type: 'string', enum: ['low', 'normal', 'high', 'urgent'] },
        deadline_date: { type: 'string', description: DATE_DESC }, deadline_time: { type: 'string' }, title: { type: 'string' }, description: { type: 'string' },
      },
      required: ['task_id'],
    },
    label: 'ویرایش وظیفه',
    async prepare(user, a) {
      const t = db.prepare('SELECT id, title FROM tasks WHERE id = ?').get(Number(a.task_id));
      if (!t) throw new ToolError('وظیفه یافت نشد؛ با list_my_tasks شناسه را پیدا کن');
      const body = {}, lines = [['وظیفه', t.title]];
      if (a.status) { body.status = a.status; lines.push(['وضعیت', STATUS_FA[a.status]]); }
      if (a.priority) { body.priority = a.priority; lines.push(['اولویت', PRIORITY_FA[a.priority]]); }
      if (a.deadline_date) { body.deadline = jalaliToIso(a.deadline_date, a.deadline_time, '17:00', 'مهلت'); lines.push(['مهلت', whenFa(body.deadline)]); }
      if (str(a.title)) { body.title = str(a.title, 200); lines.push(['عنوان جدید', body.title]); }
      if (a.description !== undefined) { body.description = str(a.description, 5000); lines.push(['شرح', body.description.slice(0, 300) || '—']); }
      if (Object.keys(body).length === 0) throw new ToolError('هیچ تغییری مشخص نشده است');
      return { title: 'ویرایش وظیفه', lines, payload: { id: t.id, title: t.title, body } };
    },
    async execute(user, p) {
      await api(user, 'PUT', `/tasks/${p.id}`, p.body);
      return { message: `وظیفهٔ «${p.title}» به‌روزرسانی شد`, link: `/tasks?task=${p.id}` };
    },
  },

  create_note: {
    description: 'Create a personal note (یادداشت), optionally with a timed reminder.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string' }, text: { type: 'string' }, pinned: { type: 'boolean' },
        remind_date: { type: 'string', description: DATE_DESC }, remind_time: { type: 'string' },
      },
    },
    label: 'ساخت یادداشت',
    async prepare(user, a) {
      const title = str(a.title, 200), text = str(a.text, 10000);
      if (!title && !text) throw new ToolError('عنوان یا متنِ یادداشت لازم است');
      const remind_at = jalaliToIso(a.remind_date, a.remind_time, '09:00', 'یادآوری');
      const lines = [['عنوان', title || '—'], ['متن', text.slice(0, 400) || '—']];
      if (remind_at) lines.push(['یادآوری', whenFa(remind_at)]);
      if (a.pinned) lines.push(['سنجاق', 'بله']);
      return { title: 'یادداشت جدید', lines, payload: { title, text, remind_at, pinned: !!a.pinned } };
    },
    async execute(user, p) {
      await api(user, 'POST', '/notes', p);
      return { message: `یادداشت «${p.title || p.text.slice(0, 30)}» ذخیره شد`, link: '/notes' };
    },
  },

  create_project: {
    description: 'Create a task category / project (دسته‌بندی کارها). scope: private (only me), department (my unit), org (admins only).',
    parameters: {
      type: 'object',
      properties: { name: { type: 'string' }, description: { type: 'string' }, scope: { type: 'string', enum: ['private', 'department', 'org'] } },
      required: ['name'],
    },
    label: 'ساخت پروژه',
    async prepare(user, a) {
      const name = str(a.name, 120);
      if (!name) throw new ToolError('نامِ پروژه لازم است');
      const scope = ['private', 'department', 'org'].includes(a.scope) ? a.scope : 'private';
      if (scope === 'org' && user.role !== 'admin') throw new ToolError('پروژهٔ سازمانی فقط توسط مدیر سامانه ساخته می‌شود');
      const fa = { private: 'شخصی', department: `واحد ${deptName(user.department_id) || ''}`, org: 'سازمانی' }[scope];
      return { title: 'پروژهٔ جدید', lines: [['نام', name], ['دامنه', fa], ...(a.description ? [['شرح', str(a.description, 300)]] : [])], payload: { name, description: str(a.description, 1000), scope } };
    },
    async execute(user, p) {
      await api(user, 'POST', '/projects', p);
      return { message: `پروژهٔ «${p.name}» ساخته شد`, link: '/projects' };
    },
  },

  send_message: {
    description: 'Send a direct chat message to a colleague on behalf of the user. Show the exact text you will send.',
    parameters: { type: 'object', properties: { user_id: { type: 'integer' }, text: { type: 'string' } }, required: ['user_id', 'text'] },
    label: 'ارسال پیام',
    async prepare(user, a) {
      const to = requireUser(a.user_id, 'گیرنده');
      if (to.id === user.id) throw new ToolError('نمی‌توان به خودتان پیام داد');
      const text = str(a.text, 4000);
      if (!text) throw new ToolError('متنِ پیام خالی است');
      return { title: 'ارسال پیام', lines: [['به', to.full_name], ['متن', text]], payload: { to: to.id, name: to.full_name, text } };
    },
    async execute(user, p) {
      const { conversation } = await api(user, 'POST', '/chat/conversations', { type: 'dm', member_ids: [p.to] });
      await api(user, 'POST', `/chat/conversations/${conversation.id}/messages`, { content: p.text });
      return { message: `پیام برای ${p.name} فرستاده شد`, link: `/chat?c=${conversation.id}` };
    },
  },
};

// ---------------------------------------------------------------------------
//  CRM — مشتریان، معاملات، پیگیری‌ها، تیکت‌ها و مناقصات
//  همهٔ ابزارها از /api/crm می‌گذرند، پس همان دسترسیِ واحدیِ CRM و محدودیتِ
//  «فقط رکوردهای خودم» برای کارشناسِ غیرمدیر رعایت می‌شود. این ابزارها فقط به
//  کاربرانی نشان داده می‌شوند که به CRM دسترسی دارند (toolDefsFor).
//  تاریخ‌های CRM میلادیِ «YYYY-MM-DD» ذخیره می‌شوند (همان قالبِ فرم‌های CRM).
// ---------------------------------------------------------------------------
const CUSTOMER_STATUS_FA = { lead: 'سرنخ', active: 'مشتری فعال', inactive: 'غیرفعال' };
const DEAL_STAGE_FA = { new: 'جدید', quoted: 'پیش‌فاکتور', negotiation: 'مذاکره', won: 'برنده', lost: 'بازنده' };
const ACTIVITY_TYPE_FA = { call: 'تماس تلفنی', meeting: 'جلسه', email: 'ایمیل', visit: 'بازدید حضوری', note: 'یادداشت' };
const TICKET_STATUS_FA = { new: 'جدید', in_progress: 'در حال رسیدگی', waiting_customer: 'در انتظار مشتری', resolved: 'حل شد', closed: 'بسته' };
const TICKET_TYPE_FA = { support: 'پشتیبانی فنی', warranty: 'گارانتی', complaint: 'شکایت', quality: 'ایراد کیفی', request: 'درخواست', installation: 'نصب و راه‌اندازی' };
const SEVERITY_FA = { low: 'کم', normal: 'عادی', high: 'زیاد', critical: 'بحرانی' };
const MONEY_DESC = 'amount in RIAL as a plain number. If the user says تومان multiply by 10; expand میلیون/میلیارد (e.g. "۲ میلیارد تومان" → 20000000000)';

const money = (n) => `${Number(n || 0).toLocaleString('fa-IR')} ریال`;
function toNum(v, label) {
  if (v === undefined || v === null || v === '') return undefined;
  const n = Number(enDigits(v).replace(/[,٬،\s]/g, ''));
  if (!Number.isFinite(n) || n < 0) throw new ToolError(`${label} باید عدد باشد`);
  return n;
}
// تاریخِ شمسی/نسبی ← «YYYY-MM-DD» میلادی
function gDate(input, label = 'تاریخ') {
  if (!input) return null;
  const j = parseJalali(resolveDate(input) || '');
  if (!j) throw new ToolError(`${label} نامعتبر است؛ قالب درست: 1405/07/20`);
  const g = toGregorian(j.jy, j.jm, j.jd);
  const p2 = (n) => String(n).padStart(2, '0');
  return `${g.gy}-${p2(g.gm)}-${p2(g.gd)}`;
}
// «YYYY-MM-DD…» میلادی ← شمسی؛ برای ستون‌های فقط-تاریخ که isoToFa نمی‌شناسد
function dateFa(v) {
  if (!v) return undefined;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v));
  if (!m) return isoToFa(v) || undefined;
  const j = toJalaali(+m[1], +m[2], +m[3]);
  return formatJalali(j.jy, j.jm, j.jd);
}
function crmCustomer(id) {
  const c = db.prepare('SELECT id, name FROM crm_customers WHERE id = ?').get(Number(id));
  if (!c) throw new ToolError(`مشتری ${id} یافت نشد؛ اول با crm_find_customers شناسه را پیدا کن`);
  return c;
}
const pick = (v, map, label) => {
  if (v === undefined || v === null || v === '') return undefined;
  if (!map[v]) throw new ToolError(`${label} باید یکی از این‌ها باشد: ${Object.keys(map).join(', ')}`);
  return v;
};

Object.assign(READ_TOOLS, {
  crm_overview: {
    description: 'CRM dashboard for the user: open/won/lost deals and amounts, success rate, overdue follow-ups, open tenders, and the customers most in need of attention (with reasons and a suggested action). Use for "وضعیت فروش"، "امروز سراغ کدام مشتری بروم"، "پیگیری‌های من".',
    parameters: { type: 'object', properties: {} },
    label: 'مرور CRM',
    async run(user) {
      const [summary, fu, smart] = await Promise.all([
        api(user, 'GET', '/crm/summary'), api(user, 'GET', '/crm/follow-ups'), api(user, 'GET', '/crm/smart-followups'),
      ]);
      const today = new Date().toISOString().slice(0, 10);
      return {
        summary: {
          customers: summary.customers, open_deals: summary.open_count, open_amount: money(summary.open_amount),
          won_deals: summary.won_count, won_amount: money(summary.won_amount), lost_deals: summary.lost_count,
          success_rate_pct: summary.success_rate, overdue_follow_ups: summary.overdue_follow_ups,
          open_tenders: summary.open_tenders, tenders_due_within_7_days: summary.tenders_due_soon,
        },
        follow_ups: fu.follow_ups.slice(0, 15).map(a => ({
          activity_id: a.id, customer_id: a.customer_id, customer: a.customer_name, subject: a.subject || undefined,
          due: dateFa(a.follow_up_at), overdue: String(a.follow_up_at).slice(0, 10) <= today || undefined, by: a.user_name,
        })),
        customers_needing_attention: smart.customers.slice(0, 10).map(c => ({
          customer_id: c.id, name: c.name, priority: c.priority, reasons: c.reasons.join('، '),
          suggested_action: c.suggested_action, owner: c.owner_name || undefined,
        })),
        link: '/crm',
      };
    },
  },

  crm_find_customers: {
    description: 'Search CRM customers (مشتریان) by name, phone, email, city or industry. Returns customer ids needed by other crm_* tools.',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string' }, status: { type: 'string', enum: Object.keys(CUSTOMER_STATUS_FA) } },
    },
    label: 'جست‌وجوی مشتریان',
    async run(user, { query = '', status = '' }) {
      const qs = new URLSearchParams({ q: str(query, 100), status: CUSTOMER_STATUS_FA[status] ? status : '' });
      const { customers } = await api(user, 'GET', `/crm/customers?${qs}`);
      return {
        total: customers.length,
        customers: customers.slice(0, 25).map(c => ({
          id: c.id, name: c.name, status: CUSTOMER_STATUS_FA[c.status] || c.status, city: c.city || undefined,
          industry: c.industry || undefined, phone: c.phone || undefined, owner: c.owner_name || undefined,
          open_amount: c.open_amount ? money(c.open_amount) : undefined, won_amount: c.won_amount ? money(c.won_amount) : undefined,
          deals: c.deals_count || undefined, next_follow_up: dateFa(c.next_follow_up),
        })),
      };
    },
  },

  crm_get_customer: {
    description: 'Full file of one customer: details, contacts, recent activities (calls/meetings + follow-ups), deals with stages and amounts. Use to summarise a customer or before logging an activity / creating a deal.',
    parameters: { type: 'object', properties: { customer_id: { type: 'integer' } }, required: ['customer_id'] },
    label: 'خواندن پروندهٔ مشتری',
    async run(user, { customer_id }) {
      const { customer: c } = await api(user, 'GET', `/crm/customers/${Number(customer_id)}`);
      return {
        id: c.id, name: c.name, kind: c.kind, status: CUSTOMER_STATUS_FA[c.status] || c.status,
        ...compact({ phone: c.phone, email: c.email, city: c.city, address: c.address, industry: c.industry, source: c.source, note: c.note, owner: c.owner_name, department: c.department_name, extra: c.extra }),
        won_amount: money(c.won_amount), open_amount: money(c.open_amount),
        contacts: c.contacts.slice(0, 15).map(x => compact({ id: x.id, name: `${x.first_name} ${x.last_name}`.trim(), position: x.position, mobile: x.mobile, phone: x.phone, email: x.email, primary: x.is_primary ? true : null })),
        activities: c.activities.slice(0, 15).map(a => compact({
          id: a.id, type: ACTIVITY_TYPE_FA[a.type] || a.type, subject: a.subject, body: str(a.body, 300), outcome: str(a.outcome, 200),
          when: dateFa(a.happened_at), by: a.user_name, follow_up: dateFa(a.follow_up_at), follow_up_done: a.follow_up_at ? !!a.follow_up_done : null,
        })),
        deals: c.deals.slice(0, 15).map(d => compact({
          id: d.id, title: d.title, stage: DEAL_STAGE_FA[d.stage] || d.stage, amount: money(d.amount), probability: d.probability,
          expected_close: dateFa(d.expected_close), product: d.product, lost_reason: d.lost_reason, owner: d.owner_name,
        })),
        link: '/crm',
      };
    },
  },

  crm_list_deals: {
    description: 'List sales deals (معاملات / فرصت‌های فروش), optionally by stage, customer or a search phrase. query matches the deal title, product AND customer name — use it to find a deal the user names by its title.',
    parameters: {
      type: 'object',
      properties: {
        stage: { type: 'string', enum: [...Object.keys(DEAL_STAGE_FA), 'open'] , description: '"open" = not won/lost' },
        customer_id: { type: 'integer' }, query: { type: 'string' },
      },
    },
    label: 'خواندن معاملات',
    async run(user, { stage = '', customer_id, query }) {
      const qs = new URLSearchParams();
      if (DEAL_STAGE_FA[stage]) qs.set('stage', stage);
      if (customer_id) qs.set('customer_id', String(Number(customer_id)));
      let { deals } = await api(user, 'GET', `/crm/deals?${qs}`);
      if (stage === 'open') deals = deals.filter(d => !['won', 'lost'].includes(d.stage));
      if (query) deals = deals.filter(d => norm(`${d.title} ${d.customer_name} ${d.product || ''}`).includes(norm(query)));
      const sum = deals.reduce((s, d) => s + Number(d.amount || 0), 0);
      return {
        total: deals.length, total_amount: money(sum),
        deals: deals.slice(0, 30).map(d => compact({
          id: d.id, title: d.title, customer_id: d.customer_id, customer: d.customer_name, stage: DEAL_STAGE_FA[d.stage] || d.stage,
          amount: money(d.amount), probability: d.probability, expected_close: dateFa(d.expected_close),
          owner: d.owner_name, lost_reason: d.lost_reason,
        })),
      };
    },
  },

  crm_sales_analysis_data: {
    description: 'The full CRM analysis package: totals, success rate, stage funnel, lost reasons, monthly trend, per-salesperson numbers, tenders and price gaps, products/stock, feedback, and the text of salespeople\'s stage reports. Use when the user asks you to ANALYSE sales/CRM data (why we lose, trends, who to focus on, compare people, recommendations). Answer only from this data; never invent numbers. scope "team" (managers only) or "me".',
    parameters: { type: 'object', properties: { scope: { type: 'string', enum: ['team', 'me'] } } },
    label: 'خواندن دادهٔ تحلیل فروش',
    async run(user, { scope }) {
      const data = await api(user, 'GET', `/crm/insights/payload?compact=1${scope === 'me' ? '&scope=me' : ''}`);
      delete data.instruction;
      return { note: 'amounts are in RIAL', ...data };
    },
  },

  crm_list_tickets: {
    description: 'Customer support tickets (تیکت‌های پشتیبانی / شکایت / گارانتی).',
    parameters: {
      type: 'object',
      properties: { open_only: { type: 'boolean', description: 'default true' }, customer_id: { type: 'integer' }, query: { type: 'string' } },
    },
    label: 'خواندن تیکت‌ها',
    async run(user, { open_only = true, customer_id, query }) {
      const qs = new URLSearchParams({ open_only: open_only ? '1' : '', q: str(query, 100) });
      if (customer_id) qs.set('customer_id', String(Number(customer_id)));
      const { tickets } = await api(user, 'GET', `/crm/tickets?${qs}`);
      return {
        total: tickets.length,
        tickets: tickets.slice(0, 30).map(t => compact({
          id: t.id, subject: t.subject, customer: t.customer_name, type: TICKET_TYPE_FA[t.type] || t.type,
          severity: SEVERITY_FA[t.severity] || t.severity, status: TICKET_STATUS_FA[t.status] || t.status,
          assignee: t.assignee_name, age_hours: t.is_open ? t.age_hours : null, overdue: t.is_overdue || null,
          product: t.product_name, created: isoToFa(t.created_at),
        })),
      };
    },
  },

  crm_list_tenders: {
    description: 'Tenders / auctions (مناقصات) the company is tracking, with deadlines, our bid and result.',
    parameters: { type: 'object', properties: { open_only: { type: 'boolean', description: 'default true' }, query: { type: 'string' } } },
    label: 'خواندن مناقصات',
    async run(user, { open_only = true, query }) {
      const qs = new URLSearchParams({ open_only: open_only ? '1' : '', q: str(query, 100) });
      const { tenders, statuses } = await api(user, 'GET', `/crm/tenders?${qs}`);
      return {
        total: tenders.length,
        tenders: tenders.slice(0, 25).map(t => compact({
          id: t.id, title: t.title, tender_no: t.tender_no, organization: t.customer_name || t.organization,
          status: statuses?.[t.status] || t.status, submit_deadline: dateFa(t.submit_deadline), opening: dateFa(t.opening_at),
          estimated: t.estimated_amount ? money(t.estimated_amount) : null, our_bid: t.our_bid_amount ? money(t.our_bid_amount) : null,
          winner: t.winner_name, price_gap_pct: t.price_gap_pct, owner: t.owner_name,
        })),
      };
    },
  },
});

Object.assign(WRITE_TOOLS, {
  crm_create_customer: {
    description: 'Add a new customer (مشتری / سرنخ) to the CRM, optionally with one contact person. Search first with crm_find_customers to avoid duplicates.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string' }, kind: { type: 'string', enum: ['company', 'person'] },
        status: { type: 'string', enum: Object.keys(CUSTOMER_STATUS_FA), description: 'default lead' },
        phone: { type: 'string' }, email: { type: 'string' }, city: { type: 'string' }, address: { type: 'string' },
        industry: { type: 'string' }, source: { type: 'string', description: 'how they found us, e.g. نمایشگاه، معرفی' },
        note: { type: 'string' },
        contact: { type: 'object', properties: { first_name: { type: 'string' }, last_name: { type: 'string' }, position: { type: 'string' }, mobile: { type: 'string' } } },
      },
      required: ['name'],
    },
    label: 'ثبت مشتری',
    async prepare(user, a) {
      const name = str(a.name, 200);
      if (!name) throw new ToolError('نامِ مشتری لازم است');
      const dup = db.prepare('SELECT id, name FROM crm_customers WHERE name = ?').get(name);
      const body = { name, kind: a.kind === 'person' ? 'person' : 'company', status: pick(a.status, CUSTOMER_STATUS_FA, 'وضعیت') || 'lead' };
      for (const k of ['phone', 'email', 'city', 'address', 'industry', 'source', 'note']) if (str(a[k])) body[k] = str(a[k], k === 'note' ? 3000 : 300);
      const lines = [['نام', name], ['نوع', body.kind === 'person' ? 'شخص' : 'شرکت'], ['وضعیت', CUSTOMER_STATUS_FA[body.status]]];
      for (const [k, l] of [['phone', 'تلفن'], ['email', 'ایمیل'], ['city', 'شهر'], ['industry', 'صنعت'], ['source', 'منبع'], ['note', 'یادداشت']]) if (body[k]) lines.push([l, body[k]]);
      const ct = a.contact && (str(a.contact.first_name) || str(a.contact.last_name))
        ? { first_name: str(a.contact.first_name, 100), last_name: str(a.contact.last_name, 100), position: str(a.contact.position, 100), mobile: str(a.contact.mobile, 30), is_primary: true }
        : null;
      if (ct) lines.push(['مخاطب', [`${ct.first_name} ${ct.last_name}`.trim(), ct.position, ct.mobile].filter(Boolean).join(' — ')]);
      return {
        title: 'ثبت مشتری جدید', lines, payload: { body, contact: ct },
        note: dup ? `مشتری‌ای با همین نام (شناسهٔ ${dup.id}) از قبل ثبت شده است` : undefined,
      };
    },
    async execute(user, p) {
      const { id } = await api(user, 'POST', '/crm/customers', p.body);
      if (p.contact) await api(user, 'POST', `/crm/customers/${id}/contacts`, p.contact);
      return { message: `مشتری «${p.body.name}» ثبت شد`, link: '/crm', id };
    },
  },

  crm_log_activity: {
    description: 'Log a customer interaction (گزارش تماس/جلسه/بازدید) on a customer\'s file, optionally with a follow-up date (پیگیری). Get customer_id from crm_find_customers.',
    parameters: {
      type: 'object',
      properties: {
        customer_id: { type: 'integer' }, type: { type: 'string', enum: Object.keys(ACTIVITY_TYPE_FA), description: 'default call' },
        subject: { type: 'string' }, body: { type: 'string', description: 'what was discussed' }, outcome: { type: 'string' },
        follow_up_date: { type: 'string', description: DATE_DESC }, deal_id: { type: 'integer' },
      },
      required: ['customer_id'],
    },
    label: 'ثبت گزارش مشتری',
    async prepare(user, a) {
      const c = crmCustomer(a.customer_id);
      const body = {
        type: pick(a.type, ACTIVITY_TYPE_FA, 'نوع') || 'call', subject: str(a.subject, 200), body: str(a.body, 5000), outcome: str(a.outcome, 1000),
        follow_up_at: gDate(a.follow_up_date, 'تاریخ پیگیری'),
      };
      if (!body.subject && !body.body) throw new ToolError('موضوع یا شرحِ گزارش لازم است');
      if (a.deal_id) {
        const d = db.prepare('SELECT id, title FROM crm_deals WHERE id = ? AND customer_id = ?').get(Number(a.deal_id), c.id);
        if (!d) throw new ToolError('این معامله متعلق به این مشتری نیست');
        body.deal_id = d.id;
      }
      const lines = [['مشتری', c.name], ['نوع', ACTIVITY_TYPE_FA[body.type]]];
      if (body.subject) lines.push(['موضوع', body.subject]);
      if (body.body) lines.push(['شرح', body.body.slice(0, 400)]);
      if (body.outcome) lines.push(['نتیجه', body.outcome]);
      if (body.follow_up_at) lines.push(['پیگیری', jalaliWithWeekday(dateFa(body.follow_up_at))]);
      return { title: 'ثبت گزارش مشتری', lines, payload: { customer_id: c.id, name: c.name, body } };
    },
    async execute(user, p) {
      await api(user, 'POST', `/crm/customers/${p.customer_id}/activities`, p.body);
      return { message: `گزارش برای «${p.name}» ثبت شد`, link: '/crm' };
    },
  },

  crm_create_deal: {
    description: 'Create a sales deal / opportunity (معامله) for a customer.',
    parameters: {
      type: 'object',
      properties: {
        customer_id: { type: 'integer' }, title: { type: 'string' }, amount: { type: 'number', description: MONEY_DESC },
        stage: { type: 'string', enum: Object.keys(DEAL_STAGE_FA), description: 'default new' }, probability: { type: 'integer', description: '0-100' },
        expected_close_date: { type: 'string', description: DATE_DESC }, product: { type: 'string' }, note: { type: 'string' },
      },
      required: ['customer_id', 'title'],
    },
    label: 'ساخت معامله',
    async prepare(user, a) {
      const c = crmCustomer(a.customer_id);
      const title = str(a.title, 200);
      if (!title) throw new ToolError('عنوانِ معامله لازم است');
      const body = {
        customer_id: c.id, title, amount: toNum(a.amount, 'مبلغ') || 0, stage: pick(a.stage, DEAL_STAGE_FA, 'مرحله') || 'new',
        probability: Math.min(100, toNum(a.probability, 'احتمال') || 0), expected_close: gDate(a.expected_close_date, 'تاریخ بستن'),
        product: str(a.product, 200), note: str(a.note, 3000),
      };
      const lines = [['مشتری', c.name], ['عنوان', title], ['مبلغ', money(body.amount)], ['مرحله', DEAL_STAGE_FA[body.stage]]];
      if (body.probability) lines.push(['احتمال', `${body.probability}٪`]);
      if (body.expected_close) lines.push(['تاریخ بستن', dateFa(body.expected_close)]);
      if (body.product) lines.push(['محصول', body.product]);
      if (body.note) lines.push(['یادداشت', body.note.slice(0, 300)]);
      return { title: 'معاملهٔ جدید', lines, payload: body };
    },
    async execute(user, p) {
      await api(user, 'POST', '/crm/deals', p);
      return { message: `معاملهٔ «${p.title}» ثبت شد`, link: '/crm' };
    },
  },

  crm_update_deal: {
    description: 'Find deal_id first with crm_list_deals (query = words from the deal title OR customer name — users usually name a deal by its product/title, e.g. "کابل ۴×۱۶"). Update a deal: move its stage (e.g. to won/lost), change amount/probability/close date, and record the stage report (what happened, next action). When marking lost, ask for the lost reason.',
    parameters: {
      type: 'object',
      properties: {
        deal_id: { type: 'integer' }, stage: { type: 'string', enum: Object.keys(DEAL_STAGE_FA) },
        amount: { type: 'number', description: MONEY_DESC }, probability: { type: 'integer' },
        expected_close_date: { type: 'string', description: DATE_DESC }, lost_reason: { type: 'string' },
        summary: { type: 'string', description: 'stage report: what happened' }, next_action: { type: 'string' },
      },
      required: ['deal_id'],
    },
    label: 'ویرایش معامله',
    async prepare(user, a) {
      const d = db.prepare('SELECT d.*, c.name AS customer_name FROM crm_deals d JOIN crm_customers c ON c.id = d.customer_id WHERE d.id = ?').get(Number(a.deal_id));
      if (!d) throw new ToolError('معامله یافت نشد؛ با crm_list_deals شناسه را پیدا کن');
      const body = {}, lines = [['معامله', `${d.title} — ${d.customer_name}`]];
      const stage = pick(a.stage, DEAL_STAGE_FA, 'مرحله');
      if (stage && stage !== d.stage) { body.stage = stage; lines.push(['مرحله', `${DEAL_STAGE_FA[d.stage]} ← ${DEAL_STAGE_FA[stage]}`]); }
      const amount = toNum(a.amount, 'مبلغ');
      if (amount !== undefined) { body.amount = amount; lines.push(['مبلغ', money(amount)]); }
      const prob = toNum(a.probability, 'احتمال');
      if (prob !== undefined) { body.probability = Math.min(100, prob); lines.push(['احتمال', `${body.probability}٪`]); }
      if (a.expected_close_date) { body.expected_close = gDate(a.expected_close_date, 'تاریخ بستن'); lines.push(['تاریخ بستن', dateFa(body.expected_close)]); }
      if (str(a.lost_reason)) { body.lost_reason = str(a.lost_reason, 300); lines.push(['دلیل باخت', body.lost_reason]); }
      if (stage === 'lost' && !body.lost_reason && !d.lost_reason) {
        const reasons = db.prepare("SELECT value FROM app_settings WHERE key = 'crm_lost_reasons'").get()?.value || '';
        throw new ToolError('برای «بازنده» دلیلِ باخت لازم است؛ از کاربر بپرس', { options: reasons.split(/[،,]/).map(s => s.trim()).filter(Boolean) });
      }
      const report = { summary: str(a.summary, 2000), next_action: str(a.next_action, 500) };
      if (report.summary) lines.push(['گزارش', report.summary.slice(0, 300)]);
      if (report.next_action) lines.push(['اقدام بعدی', report.next_action]);
      if (Object.keys(body).length === 0 && !report.summary && !report.next_action) throw new ToolError('هیچ تغییری مشخص نشده است');
      if (body.stage) body.stage_report = report;
      return { title: 'ویرایش معامله', lines, payload: { id: d.id, title: d.title, body, report: body.stage ? null : report } };
    },
    async execute(user, p) {
      if (Object.keys(p.body).length) await api(user, 'PUT', `/crm/deals/${p.id}`, p.body);
      if (p.report && (p.report.summary || p.report.next_action)) await api(user, 'POST', `/crm/deals/${p.id}/stage-reports`, p.report);
      return { message: `معاملهٔ «${p.title}» به‌روزرسانی شد`, link: '/crm' };
    },
  },

  crm_create_ticket: {
    description: 'Open a customer support ticket (تیکت پشتیبانی / شکایت / گارانتی / ایراد کیفی).',
    parameters: {
      type: 'object',
      properties: {
        customer_id: { type: 'integer' }, subject: { type: 'string' }, body: { type: 'string' },
        type: { type: 'string', enum: Object.keys(TICKET_TYPE_FA), description: 'default support' },
        severity: { type: 'string', enum: Object.keys(SEVERITY_FA), description: 'default normal' },
        assignee_user_id: { type: 'integer', description: 'default: the user themself' },
        due_date: { type: 'string', description: DATE_DESC },
      },
      required: ['customer_id', 'subject'],
    },
    label: 'ثبت تیکت',
    async prepare(user, a) {
      const c = crmCustomer(a.customer_id);
      const subject = str(a.subject, 200);
      if (!subject) throw new ToolError('موضوعِ تیکت لازم است');
      const assignee = a.assignee_user_id ? requireUser(a.assignee_user_id, 'مسئول') : { id: user.id, full_name: user.full_name };
      const type = pick(a.type, TICKET_TYPE_FA, 'نوع') || 'support';
      const body = {
        customer_id: c.id, subject, body: str(a.body, 5000), type, severity: pick(a.severity, SEVERITY_FA, 'شدت') || 'normal',
        assignee_id: assignee.id, due_at: gDate(a.due_date, 'مهلت'), is_quality_issue: type === 'quality',
      };
      const lines = [['مشتری', c.name], ['موضوع', subject], ['نوع', TICKET_TYPE_FA[type]], ['شدت', SEVERITY_FA[body.severity]],
        ['مسئول', assignee.id === user.id ? 'خودتان' : assignee.full_name]];
      if (body.body) lines.push(['شرح', body.body.slice(0, 400)]);
      if (body.due_at) lines.push(['مهلت', dateFa(body.due_at)]);
      return { title: 'تیکت پشتیبانی جدید', lines, payload: body };
    },
    async execute(user, p) {
      await api(user, 'POST', '/crm/tickets', p);
      return { message: `تیکت «${p.subject}» ثبت شد`, link: '/crm' };
    },
  },
});

// update_process همان ساختارِ fields/steps را دارد که create_process
WRITE_TOOLS.update_process.parameters.properties.fields = WRITE_TOOLS.create_process.parameters.properties.fields;
WRITE_TOOLS.update_process.parameters.properties.steps = WRITE_TOOLS.create_process.parameters.properties.steps;

// ---------------------------------------------------------------------------
//  رابط بیرونی
// ---------------------------------------------------------------------------
export const TOOL_DEFS = [...Object.entries(READ_TOOLS), ...Object.entries(WRITE_TOOLS)].map(([name, t]) => ({
  type: 'function',
  function: {
    name,
    description: t.description + (WRITE_TOOLS[name] ? ' [Creates a confirmation card; the action only runs when the user clicks confirm.]' : ''),
    parameters: t.parameters,
  },
}));

// ابزارهای CRM فقط برای کسی که به CRM دسترسی دارد — بقیه حتی از وجودشان باخبر نمی‌شوند
export function toolDefsFor(user) {
  const crm = canUseCrm(user);
  return TOOL_DEFS.filter(t => crm || !t.function.name.startsWith('crm_'));
}

export const toolLabel = (name) => (READ_TOOLS[name] || WRITE_TOOLS[name])?.label || name;
export const isWriteTool = (name) => !!WRITE_TOOLS[name];

export async function runReadTool(user, name, args) {
  return READ_TOOLS[name].run(user, args || {});
}
// اگر کاربر دقیقاً یک تاریخِ نسبی گفته و مدل یک تاریخِ دیگر فرستاده، تاریخِ محاسبه‌شدهٔ سرور
// ملاک است — مدل‌های کوچک در حسابِ «پنجشنبهٔ هفتهٔ بعد» زیاد اشتباه می‌کنند.
const DATE_ARGS = ['deadline_date', 'remind_date', 'start_date', 'follow_up_date', 'expected_close_date', 'due_date'];
function guardDates(args, userText) {
  const set = DATE_ARGS.filter(k => args[k]);
  const said = datesInText(userText);
  if (set.length !== 1 || said.length !== 1) return args;
  const k = set[0];
  if (resolveDate(args[k]) === said[0]) return args;
  return { ...args, [k]: said[0] };
}

// همین منطق برای فرم‌ها: اگر تعدادِ تاریخ‌های نسبیِ گفته‌شده با تعدادِ فیلدهای تاریخیِ پرشده
// برابر است، به ترتیبِ زمانی (شروع ← پایان) و به ترتیبِ فیلدها جایگزین می‌شوند
function guardFormDates(schema, fields, userText) {
  if (!fields || typeof fields !== 'object') return fields;
  const said = datesInText(userText).sort();
  if (!said.length) return fields;
  const byKey = new Map(Object.keys(fields).map(k => [norm(k), k]));
  const filled = schema.filter(x => x.type === 'date')
    .map(x => byKey.get(norm(x.key)) ?? byKey.get(norm(x.label))).filter(k => k && fields[k]);
  if (filled.length !== said.length) return fields;
  const out = { ...fields };
  filled.forEach((k, i) => { out[k] = said[i]; });
  return out;
}

// خروجی شاملِ final_args است: آرگومان‌ها پس از اصلاحِ سرور، تا اگر کاربر بعداً چیزی را
// عوض کرد، مدل از نسخهٔ درست شروع کند نه از حدسِ اولش
export async function prepareWriteTool(user, name, args, { userText = '' } = {}) {
  let final = guardDates(args || {}, userText);
  if (name === 'submit_request' && final.fields) {
    const t = await templateFor(user, final.process_id);
    final = { ...final, fields: guardFormDates(schemaOf(t), final.fields, userText) };
  }
  const prepared = await WRITE_TOOLS[name].prepare(user, final, { userText });
  return { ...prepared, finalArgs: final };
}
export async function executeWriteTool(user, name, payload) {
  return WRITE_TOOLS[name].execute(user, payload);
}
