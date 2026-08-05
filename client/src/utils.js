import { displayJalali, faDigits } from './jalali.js';
import { getToken } from './api.js';

// SQLite زمان‌ها را به‌صورت UTC ذخیره می‌کند: "YYYY-MM-DD HH:MM:SS"
export function parseDate(s) {
  if (!s) return null;
  if (typeof s === 'string' && s.includes(' ') && !s.includes('T')) {
    return new Date(s.replace(' ', 'T') + 'Z');
  }
  return new Date(s);
}

const dtf = new Intl.DateTimeFormat('fa-IR', { dateStyle: 'medium', timeStyle: 'short' });
const df = new Intl.DateTimeFormat('fa-IR', { dateStyle: 'medium' });
const tf = new Intl.DateTimeFormat('fa-IR', { timeStyle: 'short' });

export function fmtDateTime(s) { const d = parseDate(s); return d ? dtf.format(d) : ''; }
export function fmtDate(s) { const d = parseDate(s); return d ? df.format(d) : ''; }
export function fmtTime(s) { const d = parseDate(s); return d ? tf.format(d) : ''; }

export function fmtRelative(s) {
  const d = parseDate(s);
  if (!d) return '';
  const diff = Date.now() - d.getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'همین حالا';
  if (min < 60) return `${min.toLocaleString('fa-IR')} دقیقه پیش`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr.toLocaleString('fa-IR')} ساعت پیش`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day.toLocaleString('fa-IR')} روز پیش`;
  return fmtDate(s);
}

export function fmtSize(bytes) {
  if (!bytes) return '';
  const units = ['بایت', 'کیلوبایت', 'مگابایت', 'گیگابایت'];
  let i = 0, v = bytes;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0).toLocaleString('fa-IR')} ${units[i]}`;
}

export function fa(n) { return Number(n ?? 0).toLocaleString('fa-IR'); }

// نمایش مقدار یک فیلد فرم بر اساس نوع آن (تاریخ شمسی، ساعت، بازه ساعت، ...)
export function formatFieldValue(field, value) {
  if (value === undefined || value === null || value === '') return '—';
  const type = field?.type;
  if (type === 'date') return displayJalali(value);
  if (type === 'time') return faDigits(value);
  if (type === 'time_range') {
    if (typeof value === 'object') {
      const s = value.start ? faDigits(value.start) : '—';
      const e = value.end ? faDigits(value.end) : '—';
      return `${s} تا ${e}`;
    }
    return faDigits(String(value));
  }
  if (type === 'number') return faDigits(String(value));
  // فیلدهای فایلی (عکس/سند): مقدار، آرایه‌ای از شناسهٔ فایل است
  if (type === 'image' || type === 'file') {
    const ids = Array.isArray(value) ? value : [value];
    const n = ids.filter(Boolean).length;
    return n ? `${faDigits(String(n))} فایل پیوست` : '—';
  }
  return String(value);
}

export function deadlineState(deadline, status) {
  if (!deadline || status === 'done') return null;
  const d = parseDate(deadline);
  const diff = d.getTime() - Date.now();
  if (diff < 0) return 'overdue';
  if (diff < 24 * 3600 * 1000) return 'soon';
  return 'ok';
}

export function initials(name = '') {
  return name.trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('‌');
}

const ACTION_FA = {
  submit: 'ثبت درخواست', approve: 'تایید', reject: 'رد', skip: 'عبور (اختیاری)', comment: 'یادداشت',
  edit: 'ویرایش', return: 'برگشت',
};

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// ساخت سند قابل چاپ برای یک درخواست — با سربرگ سازمان، لوگو و امضای تاییدکنندگان
export function printRequest(req, statusLabel = '', settings = {}) {
  let schema = [], data = {};
  try { schema = JSON.parse(req.form_schema || '[]'); } catch {}
  try { data = JSON.parse(req.form_data || '{}'); } catch {}

  const token = getToken();
  const companyName = settings.company_name || 'سامانه اتوماسیون اداری';
  const companySub = settings.company_subtitle || '';
  const address = settings.letterhead_address || '';
  const footer = settings.letterhead_footer || '';
  const logo = settings.logo_path
    ? `<img class="logo" src="/branding/${encodeURIComponent(settings.logo_path)}" alt="لوگو" />` : '';

  // نامِ فایل‌های پیوست (سرور همراه جزئیات درخواست می‌فرستد) تا در سند چاپی نام واقعی بیاید
  const fileNames = new Map((req.files || []).map(f => [Number(f.id), f.original_name || '']));
  const fileList = (value) => {
    const ids = (Array.isArray(value) ? value : [value]).map(Number).filter(Boolean);
    if (!ids.length) return '—';
    return ids.map(id => fileNames.get(id) || `فایل #${fa(id)}`).join('، ');
  };

  const formRows = schema.length
    ? schema.map(f => {
        const cell = (f.type === 'image' || f.type === 'file')
          ? fileList(data[f.key])
          : formatFieldValue(f, data[f.key]);
        return `<tr><th>${esc(f.label)}</th><td>${esc(cell)}</td></tr>`;
      }).join('')
    : '<tr><td colspan="2">فرم اطلاعاتی ندارد</td></tr>';

  // امضا فقط برای اقدام‌های «تایید» و فقط برای مراحلی که در فرم «درج امضا» فعال بوده،
  // از endpoint امن و مقیّد به همان اقدام گرفته می‌شود (نه یک تصویر مستقل).
  const approvals = (req.actions || []).filter(a => a.action === 'approve' && a.step_requires_signature !== 0);
  const signBlocks = approvals.map(a => {
    const sig = a.has_signature
      ? `<img class="sig-img" src="/api/workflows/requests/${req.id}/signature/${a.id}?token=${encodeURIComponent(token)}" alt="امضا" />`
      : `<div class="sig-empty">—</div>`;
    return `<div class="sign-box">
      ${sig}
      <div class="sign-name">${esc(a.actor_name)}</div>
      <div class="sign-role">${esc(a.actor_position || '')}${a.actor_department ? ' · ' + esc(a.actor_department) : ''}</div>
      <div class="sign-date">${esc(fmtDateTime(a.created_at))}</div>
    </div>`;
  }).join('');
  // امضای درخواست‌دهنده — فقط اگر در فرم فعال باشد
  const requesterBox = req.requester_signature === 0 ? '' : `<div class="sign-box">
    <div class="sig-empty">&nbsp;</div>
    <div class="sign-name">${esc(req.requester_name)}</div>
    <div class="sign-role">درخواست‌دهنده${req.requester_department ? ' · ' + esc(req.requester_department) : ''}</div>
    <div class="sign-date">${esc(fmtDateTime(req.created_at))}</div>
  </div>`;

  const stepRows = (req.steps || []).map(s => {
    const people = (s.approver_people && s.approver_people.length)
      ? s.approver_people.map(p => p.full_name).join('، ')
      : (s.approver_label || 'نامشخص');
    return `<tr><td>${fa(s.step_order)}</td><td>${esc(s.title)}${s.is_optional ? ' (اختیاری)' : ''}</td><td>${esc(people)}</td></tr>`;
  }).join('');

  const actionRows = (req.actions || []).map(a => {
    let atts = [];
    try { atts = JSON.parse(a.attachments || '[]'); } catch {}
    const attText = atts.length ? `پیوست: ${fileList(atts)}` : '';
    const note = [a.comment || '', attText].filter(Boolean).join(' — ') || '—';
    return `<tr><td>${esc(ACTION_FA[a.action] || a.action)}</td><td>${esc(a.actor_name)}</td><td>${esc(note)}</td><td>${esc(fmtDateTime(a.created_at))}</td></tr>`;
  }).join('');

  const html = `<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8">
<title>سند درخواست ${esc(req.title)} — شماره ${fa(req.id)}</title>
<style>
  body{font-family:Vazirmatn,Tahoma,sans-serif;color:#111;padding:0;margin:0;line-height:1.9}
  .page{padding:28px 32px}
  .letterhead{display:flex;align-items:center;gap:16px;border-bottom:3px double #333;padding-bottom:14px;margin-bottom:8px}
  .letterhead .logo{height:66px;width:auto;object-fit:contain}
  .letterhead .co{flex:1}
  .letterhead .co h1{font-size:19px;margin:0}
  .letterhead .co .csub{color:#555;font-size:12.5px;margin-top:2px}
  .letterhead .co .caddr{color:#777;font-size:11.5px;margin-top:3px}
  .letterhead .docmeta{text-align:left;font-size:12px;color:#444;white-space:nowrap}
  .title{text-align:center;font-size:17px;font-weight:700;margin:16px 0 4px}
  .sub{color:#555;font-size:12.5px;margin-bottom:8px;text-align:center}
  table{width:100%;border-collapse:collapse;margin:8px 0 20px;font-size:13px}
  th,td{border:1px solid #bbb;padding:7px 9px;text-align:right;vertical-align:top}
  th{background:#f0f2f7;white-space:nowrap}
  h3{font-size:14.5px;margin:16px 0 6px;border-right:4px solid #2563eb;padding-right:8px}
  .status{display:inline-block;border:1px solid #999;border-radius:6px;padding:1px 10px;font-size:12.5px}
  .signs{display:flex;flex-wrap:wrap;gap:14px;margin-top:20px}
  .sign-box{flex:1;min-width:150px;border:1px solid #ccc;border-radius:8px;padding:10px;text-align:center}
  .sig-img{height:56px;width:auto;max-width:90%;object-fit:contain;display:block;margin:0 auto 4px}
  .sig-empty{height:56px;display:flex;align-items:center;justify-content:center;color:#bbb}
  .sign-name{font-weight:700;font-size:12.8px;border-top:1px solid #ddd;padding-top:5px}
  .sign-role{font-size:11px;color:#666}
  .sign-date{font-size:10.5px;color:#999;margin-top:2px}
  .footer{margin-top:26px;border-top:1px solid #ccc;padding-top:8px;font-size:10.5px;color:#888;text-align:center}
  @media print{.noprint{display:none}.page{padding:12px 18px}}
</style></head><body>
<div class="page">
  <div class="letterhead">
    ${logo}
    <div class="co">
      <h1>${esc(companyName)}</h1>
      ${companySub ? `<div class="csub">${esc(companySub)}</div>` : ''}
      ${address ? `<div class="caddr">${esc(address)}</div>` : ''}
    </div>
    <div class="docmeta">
      شماره سند: ${fa(req.id)}<br>
      تاریخ صدور: ${esc(fmtDateTime(new Date().toISOString()))}
    </div>
  </div>

  <div class="title">${esc(req.title)}</div>
  <div class="sub">
    نوع درخواست: <b>${esc(req.template_name)}</b> ·
    درخواست‌دهنده: <b>${esc(req.requester_name)}</b> (${esc(req.requester_department || 'بدون واحد')}) ·
    تاریخ ثبت: ${esc(fmtDateTime(req.created_at))} ·
    وضعیت: <span class="status">${esc(statusLabel || req.status)}</span>
  </div>

  <h3>اطلاعات فرم</h3>
  <table>${formRows}</table>

  <h3>مراحل و تاییدکنندگان</h3>
  <table><thead><tr><th>#</th><th>مرحله</th><th>مسئول تایید</th></tr></thead><tbody>${stepRows}</tbody></table>

  <h3>تاریخچه اقدامات</h3>
  <table><thead><tr><th>اقدام</th><th>کاربر</th><th>توضیحات</th><th>زمان</th></tr></thead><tbody>${actionRows}</tbody></table>

  ${(requesterBox || signBlocks) ? `<h3>امضاها</h3>
  <div class="signs">${requesterBox}${signBlocks || ''}</div>` : ''}

  ${footer ? `<div class="footer">${esc(footer)}</div>` : ''}
  <button class="noprint" onclick="window.print()" style="margin-top:20px;padding:8px 20px;font-size:14px;cursor:pointer">چاپ</button>
</div>
</body></html>`;

  const w = window.open('', '_blank');
  if (!w) return;
  w.document.write(html);
  w.document.close();
  w.focus();
  // کمی صبر تا تصاویر امضا و لوگو بارگذاری شوند
  setTimeout(() => w.print(), 700);
}

const STATUS_FA = {
  in_progress: 'در جریان', awaiting_requester: 'در انتظار تایید نهایی', returned: 'برگشت برای اصلاح',
  approved: 'تایید نهایی', rejected: 'رد شده', cancelled: 'لغو شده',
};

// چاپ فهرست گزارش درخواست‌ها — جهت بایگانی فیزیکی
export function printReport(rows, filterLabel = '') {
  const body = rows.map((r, i) => `<tr>
    <td>${fa(i + 1)}</td>
    <td>${fa(r.id)}</td>
    <td>${esc(r.title)}</td>
    <td>${esc(r.template_name)}</td>
    <td>${esc(r.requester_name)}</td>
    <td>${esc(r.requester_department || '—')}</td>
    <td>${esc(STATUS_FA[r.status] || r.status)}${r.step_title ? ' — ' + esc(r.step_title) : ''}</td>
    <td>${fa(r.approvals_count || 0)}</td>
    <td>${esc(fmtDate(r.created_at))}</td>
  </tr>`).join('');

  const html = `<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8">
<title>گزارش درخواست‌ها</title>
<style>
  body{font-family:Vazirmatn,Tahoma,sans-serif;color:#111;padding:24px}
  h1{font-size:19px;margin:0 0 4px} .sub{color:#555;font-size:12.5px;margin-bottom:14px}
  table{width:100%;border-collapse:collapse;font-size:12px}
  th,td{border:1px solid #bbb;padding:6px 8px;text-align:right}
  th{background:#f0f2f7;white-space:nowrap}
  .foot{margin-top:16px;font-size:12px;color:#555;display:flex;justify-content:space-between}
  @media print{.noprint{display:none}}
</style></head><body>
<h1>گزارش درخواست‌های اداری — توس‌کابل</h1>
<div class="sub">${filterLabel ? 'فیلترها: ' + esc(filterLabel) + ' · ' : ''}تعداد: ${fa(rows.length)} · تاریخ گزارش: ${esc(fmtDateTime(new Date().toISOString()))}</div>
<table><thead><tr>
  <th>ردیف</th><th>شماره</th><th>عنوان</th><th>نوع</th><th>درخواست‌دهنده</th><th>واحد</th><th>وضعیت / مرحله</th><th>تاییدها</th><th>تاریخ</th>
</tr></thead><tbody>${body}</tbody></table>
<div class="foot"><span>مهر و امضای واحد بایگانی</span><span>امضای مسئول گزارش</span></div>
<button class="noprint" onclick="window.print()" style="margin-top:20px;padding:8px 20px;font-size:14px;cursor:pointer">چاپ</button>
</body></html>`;

  const w = window.open('', '_blank');
  if (!w) return;
  w.document.write(html);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 400);
}
