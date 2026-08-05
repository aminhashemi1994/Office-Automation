// ============================================================================
//  نمودارهای سبکِ گزارش‌گیری — بدون کتابخانهٔ بیرونی (سامانه آفلاین است)
//
//  قواعدی که رعایت شده‌اند:
//   • رنگِ سری‌ها با آزمونِ کوررنگی انتخاب شده (جفت آبی/کهربایی، نه قرمز/سبز)
//   • هویتِ هر سری فقط با رنگ منتقل نمی‌شود: راهنما + برچسبِ مستقیمِ عدد
//   • هیچ نموداری دو محورِ عمودی ندارد؛ «تعداد» و «درصد» جدا نمایش داده می‌شوند
//   • شبکه و محورها کم‌رنگ‌اند تا داده جلو بیفتد
//   • همهٔ اعداد به فارسی و چیدمان راست‌چین
// ============================================================================
import React from 'react';

const fa = (n, d = 0) => Number(n ?? 0).toLocaleString('fa-IR', { maximumFractionDigits: d });

// ---------------------------------------------------------------- راهنما
export function Legend({ items }) {
  return (
    <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 10 }}>
      {items.map(it => (
        <span key={it.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.3, color: 'var(--text-2)' }}>
          <span style={{ width: 10, height: 10, borderRadius: 3, background: it.color, flexShrink: 0 }} />
          {it.label}
        </span>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- میله‌های افقیِ رتبه‌بندی‌شده
// برای «دلایل باخت»، «اثربخشی منبع»، «قیف فروش» و هر مقایسهٔ دسته‌ای.
// در چیدمان راست‌چین، میله‌ها طبیعی از راست رشد می‌کنند.
export function RankedBars({
  rows, valueKey = 'value', labelKey = 'label',
  format = (v) => fa(v), color, sequential = false, max, emptyText = 'داده‌ای برای نمایش نیست',
}) {
  if (!rows || !rows.length) {
    return <div style={{ fontSize: 12.8, color: 'var(--text-3)', padding: '8px 0' }}>{emptyText}</div>;
  }
  const top = max ?? Math.max(...rows.map(r => Number(r[valueKey]) || 0), 1);
  // رمپِ تک‌رنگ برای دسته‌های مرتب (روشن → پررنگ)
  const seqColor = (i) => `var(--chart-seq-${Math.min(5, Math.max(1, 5 - Math.floor(i * 5 / Math.max(1, rows.length))))})`;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
      {rows.map((r, i) => {
        const v = Number(r[valueKey]) || 0;
        const pct = top > 0 ? (v / top) * 100 : 0;
        return (
          <div key={r[labelKey] ?? i}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 12.5, marginBottom: 3 }}>
              <span style={{ color: 'var(--text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {r[labelKey]}
              </span>
              {/* برچسبِ مستقیمِ عدد — خواندنِ نمودار به رنگ وابسته نباشد */}
              <b style={{ flexShrink: 0, fontSize: 12.5 }}>{format(v, r)}</b>
            </div>
            <div style={{ height: 9, borderRadius: 5, background: 'var(--chart-grid)', overflow: 'hidden' }}
              title={`${r[labelKey]}: ${format(v, r)}`}>
              <div style={{
                width: `${Math.max(pct, v > 0 ? 2 : 0)}%`, height: '100%', borderRadius: 5,
                background: sequential ? seqColor(i) : (color || 'var(--chart-a)'),
                transition: 'width .3s ease',
              }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------- میله‌های گروهیِ ماهانه
// دو سری (برنده / باخته) کنار هم. زمان در چیدمان راست‌چین از راست به چپ می‌رود.
export function GroupedBars({ rows, series, height = 170, emptyText = 'داده‌ای برای نمایش نیست' }) {
  if (!rows || !rows.length) {
    return <div style={{ fontSize: 12.8, color: 'var(--text-3)', padding: '8px 0' }}>{emptyText}</div>;
  }
  const data = [...rows].reverse(); // جدیدترین سمت چپ، قدیمی‌ترین سمت راست (راست‌چین)
  const max = Math.max(1, ...data.flatMap(r => series.map(s => Number(r[s.key]) || 0)));
  const groupW = 100 / data.length;
  const barW = Math.min(14, (groupW / (series.length + 0.8)) * 0.9);

  return (
    <div>
      <Legend items={series.map(s => ({ label: s.label, color: s.color }))} />
      <div style={{ position: 'relative', height, borderBottom: '1px solid var(--chart-grid)' }}>
        {/* خطوط شبکه — عمداً کم‌رنگ */}
        {[0.25, 0.5, 0.75, 1].map(g => (
          <div key={g} style={{
            position: 'absolute', insetInline: 0, bottom: `${g * 100}%`,
            borderTop: '1px dashed var(--chart-grid)',
          }} />
        ))}
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'flex-end' }}>
          {data.map((row, i) => (
            <div key={row.month ?? i} style={{
              flex: 1, display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
              gap: 3, height: '100%',
            }}>
              {series.map(s => {
                const v = Number(row[s.key]) || 0;
                return (
                  <div key={s.key} title={`${row.label ?? row.month} — ${s.label}: ${fa(v)}`}
                    style={{
                      width: `${barW}%`, minWidth: 6, maxWidth: 18,
                      height: `${max > 0 ? (v / max) * 100 : 0}%`,
                      minHeight: v > 0 ? 3 : 0,
                      background: s.color,
                      borderRadius: '4px 4px 0 0',
                      transition: 'height .3s ease',
                    }} />
                );
              })}
            </div>
          ))}
        </div>
      </div>
      <div style={{ display: 'flex', marginTop: 5 }}>
        {data.map((row, i) => (
          <div key={row.month ?? i} style={{
            flex: 1, textAlign: 'center', fontSize: 10.5, color: 'var(--text-3)',
            overflow: 'hidden', whiteSpace: 'nowrap',
          }}>{row.label ?? row.month}</div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- روندِ درصدی
// «نرخ موفقیت» جداگانه رسم می‌شود تا نموداری با دو محورِ عمودی نداشته باشیم.
export function TrendLine({ rows, valueKey = 'success_rate', height = 120, color = 'var(--chart-a)', emptyText = 'داده‌ای برای نمایش نیست' }) {
  const pts = (rows || []).filter(r => r[valueKey] !== null && r[valueKey] !== undefined);
  if (pts.length < 2) {
    return <div style={{ fontSize: 12.8, color: 'var(--text-3)', padding: '8px 0' }}>
      {pts.length ? 'برای رسم روند حداقل دو دوره لازم است' : emptyText}
    </div>;
  }
  const data = [...pts].reverse(); // راست‌چین: قدیمی‌ترین سمت راست
  const W = 100, H = height;
  const pad = 6;
  const x = (i) => pad + (i / (data.length - 1)) * (W - pad * 2);
  const y = (v) => H - 14 - (Math.min(100, Math.max(0, v)) / 100) * (H - 26);
  const path = data.map((r, i) => `${i ? 'L' : 'M'} ${x(i)} ${y(Number(r[valueKey]))}`).join(' ');
  const last = Number(data[data.length - 1][valueKey]);

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={height} preserveAspectRatio="none"
        style={{ overflow: 'visible' }} role="img" aria-label="روند نرخ موفقیت">
        {[0, 50, 100].map(g => (
          <g key={g}>
            <line x1={pad} x2={W - pad} y1={y(g)} y2={y(g)} stroke="var(--chart-grid)" strokeWidth="0.5" strokeDasharray="2 2" />
          </g>
        ))}
        <path d={path} fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round"
          vectorEffect="non-scaling-stroke" />
        {data.map((r, i) => (
          <circle key={i} cx={x(i)} cy={y(Number(r[valueKey]))} r="2.2" fill={color}
            stroke="var(--surface)" strokeWidth="1">
            <title>{`${r.label ?? r.month}: ${fa(r[valueKey], 1)}٪`}</title>
          </circle>
        ))}
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5, color: 'var(--text-3)', marginTop: 2 }}>
        <span>{data[data.length - 1].label ?? data[data.length - 1].month} · {fa(last, 1)}٪</span>
        <span>{data[0].label ?? data[0].month}</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- قیف فروش
// مراحل به ترتیبِ معناییِ فرآیند (نه به ترتیب مقدار) و با رمپِ تک‌رنگ.
export function Funnel({ stages, format = (v) => fa(v), emptyText = 'معامله‌ای ثبت نشده است' }) {
  const total = stages.reduce((s, x) => s + (Number(x.count) || 0), 0);
  if (!total) return <div style={{ fontSize: 12.8, color: 'var(--text-3)', padding: '8px 0' }}>{emptyText}</div>;
  const max = Math.max(...stages.map(s => Number(s.count) || 0), 1);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {stages.map((s, i) => {
        const v = Number(s.count) || 0;
        const share = total > 0 ? (v / total) * 100 : 0;
        return (
          <div key={s.key}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 12.5, marginBottom: 3 }}>
              <span style={{ color: 'var(--text-2)' }}>{s.label}</span>
              <b style={{ fontSize: 12.5 }}>
                {fa(v)} معامله · {format(s.amount)}
                <span style={{ color: 'var(--text-3)', fontWeight: 400, marginRight: 6 }}>({fa(share, 1)}٪)</span>
              </b>
            </div>
            <div style={{ height: 11, borderRadius: 6, background: 'var(--chart-grid)', overflow: 'hidden' }}
              title={`${s.label}: ${fa(v)} معامله`}>
              <div style={{
                width: `${Math.max((v / max) * 100, v > 0 ? 2 : 0)}%`, height: '100%', borderRadius: 6,
                background: `var(--chart-seq-${Math.min(5, i + 1)})`, transition: 'width .3s ease',
              }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------- عددِ شاخص
export function Stat({ label, value, sub, tone }) {
  const color = tone === 'good' ? 'var(--green)' : tone === 'bad' ? 'var(--red)'
    : tone === 'a' ? 'var(--chart-a)' : tone === 'b' ? 'var(--chart-b)' : undefined;
  return (
    <div className="card card-pad" style={{ flex: 1, minWidth: 150 }}>
      <small style={{ color: 'var(--text-3)' }}>{label}</small>
      <div style={{ fontSize: 20, fontWeight: 700, color, lineHeight: 1.5 }}>{value}</div>
      {sub && <small style={{ color: 'var(--text-3)', fontSize: 11.5 }}>{sub}</small>}
    </div>
  );
}
