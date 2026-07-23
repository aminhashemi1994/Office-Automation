import React, { useState, useRef, useEffect } from 'react';
import { Calendar as CalIcon, ChevronRight, ChevronLeft, X } from 'lucide-react';
import {
  J_MONTHS, J_WEEKDAYS, faDigits, todayJalali, jalaaliMonthLength,
  jalaliWeekIndex, formatJalali, parseJalali, displayJalali,
} from '../jalali.js';

const POPUP_W = 268;
const POPUP_H = 336;

// انتخابگر تاریخ شمسی — مقدار به‌صورت "1403/04/27" برمی‌گردد (بدون تاریخ میلادی)
export function JalaliDatePicker({ value, onChange, placeholder, disablePast = false }) {
  const [open, setOpen] = useState(false);
  const parsed = parseJalali(value);
  const t = todayJalali();
  const [view, setView] = useState({ y: parsed?.jy || t.jy, m: parsed?.jm || t.jm });
  const [coords, setCoords] = useState(null);
  const boxRef = useRef(null);
  const popRef = useRef(null);

  // موقعیت‌یابی هوشمند: باز شدن رو به بالا وقتی پایین جا نیست + خروج از کلیپِ مودال
  const reposition = () => {
    const el = boxRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    const openUp = spaceBelow < POPUP_H + 10 && spaceAbove > spaceBelow;
    const top = openUp ? Math.max(8, rect.top - POPUP_H - 6) : rect.bottom + 6;
    // در حالت راست‌چین، لبهٔ راست تقویم با لبهٔ راست ورودی هم‌تراز می‌شود
    let left = rect.right - POPUP_W;
    left = Math.min(Math.max(8, left), window.innerWidth - POPUP_W - 8);
    setCoords({ top, left });
  };

  useEffect(() => {
    if (!open) { setCoords(null); return; }
    reposition();
    const onScroll = () => reposition();
    const onResize = () => reposition();
    // capture=true تا اسکرولِ داخل مودال هم گرفته شود
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    const h = (e) => {
      if (boxRef.current?.contains(e.target)) return;
      if (popRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
      document.removeEventListener('mousedown', h);
    };
  }, [open]);

  useEffect(() => {
    const p = parseJalali(value);
    if (p) setView({ y: p.jy, m: p.jm });
  }, [value]);

  const prevMonth = () => setView(v => v.m === 1 ? { y: v.y - 1, m: 12 } : { y: v.y, m: v.m - 1 });
  const nextMonth = () => setView(v => v.m === 12 ? { y: v.y + 1, m: 1 } : { y: v.y, m: v.m + 1 });

  const days = jalaaliMonthLength(view.y, view.m);
  const firstIdx = jalaliWeekIndex(view.y, view.m, 1); // شنبه=۰
  const cells = [];
  for (let i = 0; i < firstIdx; i++) cells.push(null);
  for (let d = 1; d <= days; d++) cells.push(d);

  const tupleOf = (y, m, d) => y * 10000 + m * 100 + d;
  const todayTuple = tupleOf(t.jy, t.jm, t.jd);
  const isPast = (d) => disablePast && tupleOf(view.y, view.m, d) < todayTuple;
  const pick = (d) => { if (isPast(d)) return; onChange(formatJalali(view.y, view.m, d)); setOpen(false); };
  const isSel = (d) => parsed && parsed.jy === view.y && parsed.jm === view.m && parsed.jd === d;
  const isToday = (d) => t.jy === view.y && t.jm === view.m && t.jd === d;

  return (
    <div style={{ position: 'relative' }} ref={boxRef}>
      <div style={{ position: 'relative' }}>
        <input
          className="input"
          readOnly
          value={value ? displayJalali(value) : ''}
          placeholder={placeholder || 'انتخاب تاریخ (شمسی)'}
          onClick={() => setOpen(o => !o)}
          style={{ cursor: 'pointer', paddingLeft: 60 }}
        />
        {value && (
          <button type="button" onClick={(e) => { e.stopPropagation(); onChange(''); }}
            style={{ position: 'absolute', left: 34, top: 9, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)' }}>
            <X size={15} />
          </button>
        )}
        <CalIcon size={15} style={{ position: 'absolute', left: 12, top: 11, color: 'var(--text-3)', pointerEvents: 'none' }} />
      </div>
      {open && coords && (
        <div ref={popRef} style={{
          position: 'fixed', zIndex: 300, top: coords.top, left: coords.left, width: POPUP_W,
          background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14,
          boxShadow: '0 12px 40px rgba(0,0,0,0.16)', padding: 12,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <button type="button" className="icon-btn" style={{ width: 28, height: 28 }} onClick={nextMonth}><ChevronLeft size={16} /></button>
            <b style={{ fontSize: 13.5 }}>{J_MONTHS[view.m - 1]} {faDigits(view.y)}</b>
            <button type="button" className="icon-btn" style={{ width: 28, height: 28 }} onClick={prevMonth}><ChevronRight size={16} /></button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 3, textAlign: 'center' }}>
            {J_WEEKDAYS.map((w, i) => (
              <div key={i} style={{ fontSize: 11, color: 'var(--text-3)', padding: '2px 0', fontWeight: 600 }}>{w}</div>
            ))}
            {cells.map((d, i) => d === null ? <div key={i} /> : (
              <button key={i} type="button" onClick={() => pick(d)}
                style={{
                  border: isToday(d) ? '1px solid var(--primary)' : '1px solid transparent',
                  background: isSel(d) ? 'var(--primary)' : 'transparent',
                  color: isSel(d) ? '#fff' : 'var(--text-1)',
                  borderRadius: 8, padding: '6px 0', cursor: 'pointer', fontSize: 12.5,
                }}>
                {faDigits(d)}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10 }}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => { const n = todayJalali(); onChange(formatJalali(n.jy, n.jm, n.jd)); setOpen(false); }}>امروز</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>بستن</button>
          </div>
        </div>
      )}
    </div>
  );
}
