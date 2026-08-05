// فیلدهای فرمِ یک فرآیند — مشترک بین «ثبت درخواست جدید» و «ویرایش درخواست».
// تا قبل از این، این منطق فقط داخل مودالِ ثبت وجود داشت و ویرایش ممکن نبود.
import React from 'react';
import { useStore } from '../store.jsx';
import { Field } from './common.jsx';
import { AttachmentPicker, toFileIds } from './Attachments.jsx';
import { JalaliDatePicker } from './JalaliDatePicker.jsx';
import { TimePicker } from './TimePicker.jsx';
import { todayJalali, formatJalali } from '../jalali.js';

// [مورد ۲] فیلد پیوستِ فایل در فرم درخواست — چند فایل؛ مقدار، آرایه‌ای از id فایل‌هاست.
// نوع فیلد 'image' فقط عکس می‌پذیرد و نوع 'file' هر سندی (PDF/Word/Excel/عکس/…).
function FormFileField({ field, value, onChange }) {
  const { settings } = useStore();
  const onlyImages = field.type === 'image';
  // [پیوست‌ها] کلید سراسری در تنظیمات سازمان
  if (settings?.attachments_enabled === '0') {
    return (
      <div style={{ fontSize: 12.3, color: 'var(--text-3)' }}>
        پیوست فایل در سامانه غیرفعال شده است؛ برای فعال‌سازی با مدیر سامانه تماس بگیرید.
      </div>
    );
  }
  return (
    <AttachmentPicker
      value={value}
      onChange={onChange}
      accept={onlyImages ? 'image/*' : undefined}
      placeholder={field.placeholder || (onlyImages ? 'انتخاب عکس' : 'انتخاب فایل')}
      label={onlyImages ? 'افزودن عکس' : 'افزودن فایل'}
      thumb={84}
    />
  );
}

// بافت تاریخ برای بررسی «زمان گذشته»: اگر فرم یک فیلد تاریخ دارد از همان استفاده می‌کنیم،
// در غیر این صورت «امروز» فرض می‌شود. اگر تاریخِ انتخابی امروز باشد، ساعت نباید از اکنون عقب‌تر باشد.
export function minTimeFor(schema, data) {
  const now = new Date();
  const nowHHMM = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const tj = todayJalali();
  const todayStr = formatJalali(tj.jy, tj.jm, tj.jd);
  const dateFields = (schema || []).filter(f => f.type === 'date');
  let isToday;
  if (dateFields.length === 0) isToday = true;                 // بدون فیلد تاریخ → امروز
  else if (dateFields.length === 1) {
    const dv = data?.[dateFields[0].key];
    isToday = dv ? dv === todayStr : false;                    // تا وقتی تاریخ انتخاب نشده، محدود نمی‌کنیم
  } else isToday = false;                                      // چند فیلد تاریخ → ابهام، محدود نمی‌کنیم
  return { timeMin: isToday ? nowHHMM : undefined, nowHHMM };
}

// اعتبارسنجی مقادیر فرم — پیام خطا برمی‌گرداند یا null اگر همه‌چیز درست است.
// در حالت ویرایش (allowPast) محدودیتِ «زمان گذشته» اعمال نمی‌شود، چون ممکن است
// درخواست مدت‌ها قبل ثبت شده باشد و اصلاحِ یک فیلد دیگر نباید به‌خاطر آن قفل شود.
export function validateRequestForm(schema, data, { attachmentsOff = false, allowPast = false } = {}) {
  const { timeMin, nowHHMM } = minTimeFor(schema, data);
  const min = allowPast ? undefined : timeMin;
  for (const f of schema || []) {
    const v = data?.[f.key];
    if (f.required) {
      const missing = f.type === 'time_range'
        ? (!v || !v.start || !v.end)
        : (f.type === 'image' || f.type === 'file')
        ? (!attachmentsOff && toFileIds(v).length === 0) // اگر پیوست کلاً غیرفعال است، الزام را نادیده بگیر
        : !String(v ?? '').trim();
      if (missing) return `«${f.label}» الزامی است`;
    }
    if (min && f.type === 'time' && v && v < min) {
      return `«${f.label}» نمی‌تواند از زمان کنونی (${nowHHMM}) عقب‌تر باشد`;
    }
    if (f.type === 'time_range' && v) {
      if (min && v.start && v.start < min) return `ساعت شروعِ «${f.label}» نمی‌تواند از زمان کنونی عقب‌تر باشد`;
      if (v.start && v.end && v.end <= v.start) return `ساعت پایانِ «${f.label}» باید بعد از ساعت شروع باشد`;
    }
  }
  return null;
}

export default function RequestFormFields({ schema = [], data = {}, onChange, allowPast = false }) {
  const set = (key, value) => onChange({ ...data, [key]: value });
  const { timeMin: rawMin } = minTimeFor(schema, data);
  const timeMin = allowPast ? undefined : rawMin;

  return schema.map(f => (
    <Field key={f.key} label={f.label + (f.required ? ' *' : '')}>
      {f.type === 'textarea' ? (
        <textarea className="input" placeholder={f.placeholder || ''} value={data[f.key] || ''}
          onChange={e => set(f.key, e.target.value)} />
      ) : f.type === 'select' ? (
        <select className="input" value={data[f.key] || ''} onChange={e => set(f.key, e.target.value)}>
          <option value="">{f.placeholder || '— انتخاب —'}</option>
          {(f.options || []).map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      ) : f.type === 'date' ? (
        <JalaliDatePicker value={data[f.key] || ''} placeholder={f.placeholder} disablePast={!allowPast}
          onChange={v => set(f.key, v)} />
      ) : f.type === 'time' ? (
        <TimePicker value={data[f.key] || ''} minTime={timeMin} onChange={v => set(f.key, v)} />
      ) : f.type === 'time_range' ? (
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 11.5, color: 'var(--text-3)', marginBottom: 4 }}>از ساعت</div>
            <TimePicker value={data[f.key]?.start || ''} minTime={timeMin}
              onChange={v => set(f.key, { ...(data[f.key] || {}), start: v })} />
          </div>
          <div>
            <div style={{ fontSize: 11.5, color: 'var(--text-3)', marginBottom: 4 }}>تا ساعت</div>
            <TimePicker value={data[f.key]?.end || ''} minTime={data[f.key]?.start || timeMin}
              onChange={v => set(f.key, { ...(data[f.key] || {}), end: v })} />
          </div>
        </div>
      ) : (f.type === 'image' || f.type === 'file') ? (
        <FormFileField field={f} value={data[f.key]} onChange={v => set(f.key, v)} />
      ) : (
        <input className="input" type={f.type === 'number' ? 'number' : 'text'} placeholder={f.placeholder || ''}
          value={data[f.key] || ''} onChange={e => set(f.key, e.target.value)} />
      )}
      {f.placeholder && !['text', 'number', 'textarea', 'select', 'date', 'image', 'file'].includes(f.type) && (
        <div style={{ fontSize: 11.5, color: 'var(--text-3)', marginTop: 4 }}>{f.placeholder}</div>
      )}
    </Field>
  ));
}
