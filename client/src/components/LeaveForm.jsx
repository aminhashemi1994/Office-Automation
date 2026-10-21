// ============================================================================
//  فرم سادهٔ درخواست مرخصی
//  همهٔ پرسنل با این فرم کار دارند، پس به‌جای فیلدهای عمومیِ فرآیند فقط سه
//  قسمت نشان می‌دهیم: توضیح مرخصی، نوع (ساعتی/روزانه) و جزئیاتِ همان نوع.
//  فیلدها از روی leave_map فرآیند پیدا می‌شوند؛ پس فرآیندی که دستی ساخته شده و
//  نگاشتش کامل است هم همین فرم را می‌گیرد. فرآیند آماده با LEAVE_TEMPLATE ساخته می‌شود.
// ============================================================================
import React from 'react';
import { Field, Segmented } from './common.jsx';
import { JalaliDatePicker } from './JalaliDatePicker.jsx';
import { TimePicker } from './TimePicker.jsx';
import { parseJalali, toGregorian, displayJalali } from '../jalali.js';
import { fa } from '../utils.js';

export const MODE_HOUR = 'ساعتی';
export const MODE_DAY = 'روزانه';
const KINDS = ['استحقاقی', 'استعلاجی', 'بدون حقوق'];

// فرم و نگاشتِ فرآیند آمادهٔ «درخواست مرخصی»
export const LEAVE_SCHEMA = [
  { key: 'leave_desc', label: 'توضیح مرخصی', type: 'textarea' },
  { key: 'leave_mode', label: 'نوع مرخصی', type: 'select', options: [MODE_HOUR, MODE_DAY], required: true },
  { key: 'leave_kind', label: 'عنوان مرخصی', type: 'select', options: KINDS },
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
  default_type: 'entitled',
};

export function parseLeaveMap(tpl) {
  try { return JSON.parse(tpl?.leave_map || '{}') || {}; } catch { return {}; }
}

// فرم ساده فقط وقتی معنا دارد که فیلدِ «ساعتی/روزانه» نگاشت شده باشد
export function isSimpleLeave(tpl) {
  return !!tpl?.leave_enabled && !!parseLeaveMap(tpl).mode_field;
}

// کلیدهایی که فرم ساده خودش نشان می‌دهد؛ بقیهٔ فیلدهای فرآیند به کشوی «گزینه‌های بیشتر» می‌روند
export function leaveKeys(map) {
  return ['mode_field', 'type_field', 'desc_field', 'date_field', 'range_field', 'hour_field',
    'from_field', 'to_field', 'day_field'].map(k => map[k]).filter(Boolean);
}

function minutes(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || ''));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

function toDate(jstr) {
  const p = parseJalali(jstr);
  if (!p) return null;
  const g = toGregorian(p.jy, p.jm, p.jd);
  return new Date(g.gy, g.gm - 1, g.gd);
}

// تعداد روزهای کاری بین دو تاریخ (هر دو روز حساب می‌شوند، جمعه‌ها نه)
export function countLeaveDays(from, to) {
  const a = toDate(from); const b = toDate(to);
  if (!a || !b || b < a) return 0;
  let n = 0;
  for (const d = new Date(a); d <= b; d.setDate(d.getDate() + 1)) if (d.getDay() !== 5) n++;
  return n;
}

export function validateLeaveForm(map, data) {
  const mode = data[map.mode_field];
  if (!mode) return 'ساعتی یا روزانه بودن مرخصی را انتخاب کنید';
  if (mode === MODE_HOUR) {
    if (map.date_field && !data[map.date_field]) return 'تاریخ مرخصی را انتخاب کنید';
    const t = data[map.range_field] || {};
    if (map.range_field && (!t.start || !t.end)) return 'ساعت شروع و پایان را مشخص کنید';
    if (map.range_field && minutes(t.end) <= minutes(t.start)) return 'ساعت پایان باید بعد از ساعت شروع باشد';
  } else {
    if (map.from_field && !data[map.from_field]) return 'تاریخ شروع مرخصی را انتخاب کنید';
    if (map.to_field && !data[map.to_field]) return 'تاریخ پایان مرخصی را انتخاب کنید';
    if (map.from_field && map.to_field && data[map.to_field] < data[map.from_field]) {
      return 'تاریخ پایان نمی‌تواند قبل از تاریخ شروع باشد';
    }
    if (map.day_field && !(Number(data[map.day_field]) > 0)) return 'تعداد روز مرخصی را وارد کنید';
  }
  return null;
}

// عنوانِ خودکار — کاربر دیگر لازم نیست عنوان بنویسد
export function leaveTitle(map, data) {
  const kind = data[map.type_field] ? ` ${data[map.type_field]}` : '';
  if (data[map.mode_field] === MODE_HOUR) {
    const h = data[map.hour_field];
    return `مرخصی ساعتی${kind}${h ? ` — ${fa(h)} ساعت` : ''}${data[map.date_field] ? ` — ${displayJalali(data[map.date_field])}` : ''}`;
  }
  const d = data[map.day_field];
  return `مرخصی روزانه${kind}${d ? ` — ${fa(d)} روز` : ''}${data[map.from_field] ? ` از ${displayJalali(data[map.from_field])}` : ''}`;
}

export default function LeaveFormFields({ map, data, onChange, pastDays = 0 }) {
  const mode = data[map.mode_field] || '';
  const set = (patch) => {
    const next = { ...data, ...patch };
    // مقدارِ محاسبه‌شده همراهِ ورودی‌ها به‌روز می‌شود تا کاربر عدد بنویسد فقط اگر بخواهد
    if (map.range_field && map.hour_field && patch[map.range_field]) {
      const s = minutes(next[map.range_field]?.start); const e = minutes(next[map.range_field]?.end);
      next[map.hour_field] = s !== null && e !== null && e > s ? String(Math.round((e - s) / 6) / 10) : '';
    }
    if (map.day_field && (map.from_field in patch || map.to_field in patch)) {
      const from = next[map.from_field]; const to = next[map.to_field] || from;
      const n = countLeaveDays(from, to);
      next[map.day_field] = n ? String(n) : '';
    }
    onChange(next);
  };
  // با عوض‌شدن نوع، جزئیاتِ نوعِ دیگر پاک می‌شود تا در سند و محاسبه قاطی نشود
  const pickMode = (m) => {
    const clear = m === MODE_HOUR ? [map.from_field, map.to_field, map.day_field]
      : [map.date_field, map.range_field, map.hour_field];
    const next = { ...data, [map.mode_field]: m };
    clear.filter(Boolean).forEach(k => { delete next[k]; });
    onChange(next);
  };

  return (
    <>
      {map.desc_field && (
        <Field label="توضیح مرخصی">
          <textarea className="input" rows={3} value={data[map.desc_field] || ''}
            placeholder="مثلاً: مراجعه به پزشک، کار اداری شخصی، …"
            onChange={e => set({ [map.desc_field]: e.target.value })} />
        </Field>
      )}

      <div className="card-pad panel-soft" style={{ marginBottom: 14 }}>
        <Field label="نوع مرخصی *">
          <Segmented value={mode} onChange={pickMode} options={[
            { value: MODE_HOUR, label: 'ساعتی', tone: 'primary', hint: 'چند ساعت از یک روز' },
            { value: MODE_DAY, label: 'روزانه', tone: 'primary', hint: 'یک یا چند روز کامل' },
          ]} />
        </Field>

        {map.type_field && mode && (
          <Field label="عنوان مرخصی">
            <Segmented size="sm" value={data[map.type_field] || KINDS[0]}
              onChange={v => set({ [map.type_field]: v })}
              options={KINDS.map(k => ({ value: k, label: k }))} />
          </Field>
        )}

        {mode === MODE_HOUR && (
          <div className="form-row-wide">
            {map.date_field && (
              <Field label="تاریخ *">
                <JalaliDatePicker value={data[map.date_field] || ''} disablePast pastDays={pastDays}
                  onChange={v => set({ [map.date_field]: v })} />
              </Field>
            )}
            {map.range_field && (
              <Field label="از ساعت … تا ساعت *">
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                  <TimePicker value={data[map.range_field]?.start || ''}
                    onChange={v => set({ [map.range_field]: { ...(data[map.range_field] || {}), start: v } })} />
                  <span style={{ color: 'var(--text-3)' }}>تا</span>
                  <TimePicker value={data[map.range_field]?.end || ''} minTime={data[map.range_field]?.start}
                    onChange={v => set({ [map.range_field]: { ...(data[map.range_field] || {}), end: v } })} />
                </div>
              </Field>
            )}
            {map.hour_field && (
              <Field label="تعداد ساعت" hint={map.range_field ? 'از روی ساعت شروع و پایان حساب می‌شود.' : undefined}>
                <input className="input" type="number" min="0" step="0.5" style={{ maxWidth: 140 }}
                  value={data[map.hour_field] || ''} readOnly={!!map.range_field}
                  onChange={e => set({ [map.hour_field]: e.target.value })} />
              </Field>
            )}
          </div>
        )}

        {mode === MODE_DAY && (
          <div className="form-row-wide">
            {map.from_field && (
              <Field label="از تاریخ *">
                <JalaliDatePicker value={data[map.from_field] || ''} disablePast pastDays={pastDays}
                  onChange={v => set({ [map.from_field]: v })} />
              </Field>
            )}
            {map.to_field && (
              <Field label="تا تاریخ *">
                <JalaliDatePicker value={data[map.to_field] || ''} disablePast pastDays={pastDays}
                  onChange={v => set({ [map.to_field]: v })} />
              </Field>
            )}
            {map.day_field && (
              <Field label="تعداد روز *" hint="خودکار حساب می‌شود (جمعه‌ها حساب نمی‌شوند)؛ در صورت نیاز اصلاحش کنید.">
                <input className="input" type="number" min="0" step="0.5" style={{ maxWidth: 140 }}
                  value={data[map.day_field] || ''} onChange={e => onChange({ ...data, [map.day_field]: e.target.value })} />
              </Field>
            )}
          </div>
        )}
      </div>
    </>
  );
}
