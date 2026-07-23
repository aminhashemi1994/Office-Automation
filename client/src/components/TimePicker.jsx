import React, { useState, useEffect } from 'react';
import { faDigits } from '../jalali.js';

function clampHM(h, m) {
  const H = Math.min(23, Math.max(0, parseInt(h || '0', 10) || 0));
  const M = Math.min(59, Math.max(0, parseInt(m || '0', 10) || 0));
  return `${String(H).padStart(2, '0')}:${String(M).padStart(2, '0')}`;
}
// تبدیل ورودی آزادِ کاربر به قالب استاندارد HH:MM (۲۴ساعته)
function parseTypedTime(t) {
  t = String(t || '').trim();
  if (!t) return '';
  if (t.includes(':')) { const [h, m] = t.split(':'); return clampHM(h, m); }
  const d = t.replace(/\D/g, '');
  if (!d) return '';
  if (d.length <= 2) return clampHM(d, '0');
  if (d.length === 3) return clampHM(d.slice(0, 1), d.slice(1));
  return clampHM(d.slice(0, 2), d.slice(2, 4));
}

// ورودی متنیِ ساعت ۲۴ساعته — کاربر تایپ می‌کند (مثلاً 14:30)
function TimeTextInput({ value, onChange }) {
  const [text, setText] = useState(value || '');
  useEffect(() => { setText(value || ''); }, [value]);
  return (
    <div>
      <input
        className="input" dir="ltr" inputMode="numeric" maxLength={5}
        style={{ width: 130, textAlign: 'center', letterSpacing: 1, fontVariantNumeric: 'tabular-nums' }}
        placeholder="۱۴:۳۰"
        value={text}
        onChange={e => {
          const raw = e.target.value.replace(/[^0-9:]/g, '').slice(0, 5);
          setText(raw);
          onChange(parseTypedTime(raw));
        }}
        onBlur={() => { const norm = parseTypedTime(text); setText(norm); onChange(norm); }}
      />
      <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 3 }}>
        قالب ۲۴ساعته — ساعت:دقیقه (مثلاً 14:30 یعنی ۲ بعدازظهر){value ? ` · ${faDigits(value)}` : ''}
      </div>
    </div>
  );
}

// انتخابگر ساعت ۲۴ساعته با نمایش ارقام فارسی — مقدار به‌صورت "HH:MM" (۲۴ساعته) ذخیره می‌شود.
// variant='input' → ورودی متنی تایپی؛ در غیر این صورت انتخابگر کشویی.
// minTime: کمینهٔ مجاز به‌صورت "HH:MM" (برای جلوگیری از انتخاب زمان گذشته)
export function TimePicker({ value, onChange, minTime, variant }) {
  if (variant === 'input') return <TimeTextInput value={value} onChange={onChange} />;
  const valid = /^(\d{1,2}):(\d{1,2})$/.test(value || '');
  const [vh, vm] = valid ? value.split(':') : ['', ''];
  const hh = vh === '' ? '' : String(Number(vh));
  const mm = vm === '' ? '' : String(Number(vm));

  const commit = (nh, nm) => {
    if (nh === '' && nm === '') return onChange('');
    const H = String(nh === '' ? 0 : nh).padStart(2, '0');
    const M = String(nm === '' ? 0 : nm).padStart(2, '0');
    onChange(`${H}:${M}`);
  };

  // آیا این ساعت/دقیقه با توجه به minTime مجاز است؟
  const minH = minTime ? Number(minTime.split(':')[0]) : null;
  const minM = minTime ? Number(minTime.split(':')[1]) : null;
  const hourDisabled = (h) => minH != null && h < minH;
  const minuteDisabled = (m) => minH != null && Number(hh || 0) === minH && m < minM;

  const selStyle = { width: 'auto', minWidth: 66, padding: '9px 8px', textAlign: 'center', cursor: 'pointer' };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, direction: 'ltr' }}>
        {/* ساعت */}
        <select className="input" style={selStyle} value={hh}
          onChange={e => commit(e.target.value, mm === '' ? '0' : mm)}>
          <option value="">— ساعت —</option>
          {Array.from({ length: 24 }, (_, i) => (
            <option key={i} value={i} disabled={hourDisabled(i)}>{faDigits(String(i).padStart(2, '0'))}</option>
          ))}
        </select>
        <b style={{ fontSize: 16, color: 'var(--text-2)' }}>:</b>
        {/* دقیقه */}
        <select className="input" style={selStyle} value={mm}
          onChange={e => commit(hh === '' ? '0' : hh, e.target.value)}>
          <option value="">— دقیقه —</option>
          {Array.from({ length: 60 }, (_, i) => (
            <option key={i} value={i} disabled={minuteDisabled(i)}>{faDigits(String(i).padStart(2, '0'))}</option>
          ))}
        </select>
      </div>
      {valid && (
        <span className="badge badge-primary" style={{ fontSize: 13 }}>
          {faDigits(`${vh.padStart(2, '0')}:${vm.padStart(2, '0')}`)}
        </span>
      )}
    </div>
  );
}
