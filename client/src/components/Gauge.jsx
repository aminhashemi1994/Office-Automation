// ============================================================================
//  سرعت‌سنج (Gauge) — نمایش «چقدر مانده / چقدر مصرف شده» به‌صورت نیم‌دایره
//  کاملاً SVG و بدون کتابخانهٔ بیرونی (سامانه آفلاین است).
//  رنگ عقربه با کم‌شدن مانده از سبز به کهربایی و سپس قرمز می‌رود.
// ============================================================================
import React from 'react';

const fa = (n, digits = 0) =>
  Number(n ?? 0).toLocaleString('fa-IR', { maximumFractionDigits: digits });

// نقطه‌ای روی کمانِ نیم‌دایره (۱۸۰ درجه، از چپ به راست)
function polar(cx, cy, r, ratio) {
  const angle = Math.PI * (1 - Math.min(1, Math.max(0, ratio))); // ۱۸۰° → ۰°
  return { x: cx + r * Math.cos(angle), y: cy - r * Math.sin(angle) };
}

function arcPath(cx, cy, r, from, to) {
  const a = polar(cx, cy, r, from);
  const b = polar(cx, cy, r, to);
  const large = Math.abs(to - from) > 0.5 ? 1 : 0;
  return `M ${a.x} ${a.y} A ${r} ${r} 0 ${large} 1 ${b.x} ${b.y}`;
}

/**
 * value     مقدارِ فعلی (مثلاً ماندهٔ مرخصی به ساعت)
 * max       سقف (مثلاً کل مرخصی سالانه)
 * label     متنِ بزرگِ وسط گِیج (مثلاً «۱۲ روز»)
 * caption   زیرنویس کوچک
 * size      عرض گِیج به پیکسل
 * invert    اگر true باشد، «کم بودن» خوب است (مثلاً مصرف‌شده)
 */
export default function Gauge({
  value = 0, max = 0, label, caption = '', size = 190, invert = false, minLabel, maxLabel,
}) {
  const w = size;
  const h = size * 0.62;
  const cx = w / 2;
  const cy = h - 10;
  const r = w / 2 - 16;
  const stroke = Math.max(10, w * 0.075);

  const safeMax = Number(max) > 0 ? Number(max) : 0;
  const ratio = safeMax > 0 ? Math.min(1, Math.max(0, Number(value) / safeMax)) : 0;
  // «سلامت» مقدار: برای مانده هرچه بیشتر بهتر، برای مصرف برعکس
  const health = invert ? 1 - ratio : ratio;
  const color = health >= 0.5 ? 'var(--green)' : health >= 0.2 ? 'var(--amber)' : 'var(--red)';
  const needle = polar(cx, cy, r - stroke * 0.55, ratio);

  return (
    <div style={{ textAlign: 'center', userSelect: 'none' }}>
      <svg width={w} height={h + 6} viewBox={`0 0 ${w} ${h + 6}`} role="img"
        aria-label={`${label || ''} ${caption}`}>
        {/* کمانِ پس‌زمینه */}
        <path d={arcPath(cx, cy, r, 0, 1)} fill="none" stroke="var(--bg-3)"
          strokeWidth={stroke} strokeLinecap="round" />
        {/* کمانِ پرشده */}
        {safeMax > 0 && ratio > 0 && (
          <path d={arcPath(cx, cy, r, 0, ratio)} fill="none" stroke={color}
            strokeWidth={stroke} strokeLinecap="round" />
        )}
        {/* عقربه */}
        {safeMax > 0 && (
          <>
            <line x1={cx} y1={cy} x2={needle.x} y2={needle.y} stroke={color}
              strokeWidth={2.5} strokeLinecap="round" />
            <circle cx={cx} cy={cy} r={4.5} fill={color} />
          </>
        )}
        {/* عددِ وسط */}
        <text x={cx} y={cy - r * 0.42} textAnchor="middle"
          style={{ fontSize: w * 0.135, fontWeight: 700, fill: color }}>
          {label ?? (safeMax > 0 ? `${fa(ratio * 100)}٪` : '—')}
        </text>
        {/* برچسب ابتدا و انتهای کمان */}
        <text x={cx - r} y={cy + 15} textAnchor="middle"
          style={{ fontSize: 10.5, fill: 'var(--text-3)' }}>{minLabel ?? '۰'}</text>
        <text x={cx + r} y={cy + 15} textAnchor="middle"
          style={{ fontSize: 10.5, fill: 'var(--text-3)' }}>{maxLabel ?? fa(safeMax)}</text>
      </svg>
      {caption && (
        <div style={{ fontSize: 12.3, color: 'var(--text-2)', marginTop: 2, lineHeight: 1.7 }}>{caption}</div>
      )}
    </div>
  );
}

// نوارِ کوچکِ افقی — برای نمایش ماندهٔ هر نفر داخل جدولِ مدیر
export function MiniBar({ value = 0, max = 0, height = 7, width = 96 }) {
  const safeMax = Number(max) > 0 ? Number(max) : 0;
  const ratio = safeMax > 0 ? Math.min(1, Math.max(0, Number(value) / safeMax)) : 0;
  const color = ratio >= 0.5 ? 'var(--green)' : ratio >= 0.2 ? 'var(--amber)' : 'var(--red)';
  return (
    <div title={safeMax > 0 ? `${fa(ratio * 100)}٪ باقی‌مانده` : 'سقفی تعیین نشده'}
      style={{ width, height, borderRadius: height, background: 'var(--bg-3)', overflow: 'hidden' }}>
      <div style={{ width: `${ratio * 100}%`, height: '100%', background: color, borderRadius: height }} />
    </div>
  );
}
