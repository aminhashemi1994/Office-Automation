// ============================================================================
//  مانیتورینگ — گزارش عملکرد در طول زمان
//  «پیشرفت ماهانهٔ من در خرید و تدارکات طی سه ماه اخیر چطور بوده؟»
//  هر کس عملکرد خودش را می‌بیند؛ مدیرِ واحد، اعضای واحدش را هم می‌بیند.
// ============================================================================
import React, { useEffect, useMemo, useState } from 'react';
import { BarChart3, Users2, Inbox, ListChecks, Clock, TrendingUp } from 'lucide-react';
import { api } from '../api.js';
import { useStore } from '../store.jsx';
import { fa } from '../utils.js';
import { GroupedBars, TrendLine, RankedBars, Stat, Legend } from '../components/Charts.jsx';
import { faDigits } from '../jalali.js';

const RANGES = [[3, '۳ ماه'], [6, '۶ ماه'], [12, 'یک سال']];
const MONTH_FA = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];
const monthLabel = (key) => {
  const [y, m] = String(key).split('/');
  return `${MONTH_FA[Number(m) - 1] || m} ${faDigits(String(y).slice(2))}`;
};

export default function Monitoring() {
  const { user, users } = useStore();
  const [months, setMonths] = useState(6);
  const [targetId, setTargetId] = useState(user.id);
  const [data, setData] = useState(null);
  const [team, setTeam] = useState(null);
  const [projectId, setProjectId] = useState('');
  const [projects, setProjects] = useState([]);
  const [err, setErr] = useState('');

  useEffect(() => { api('/projects').then(r => setProjects(r.projects)).catch(() => {}); }, []);
  useEffect(() => {
    setErr('');
    const q = `?months=${months}&user_id=${targetId}${projectId ? `&project_id=${projectId}` : ''}`;
    api(`/monitoring/overview${q}`).then(setData).catch(e => { setData(null); setErr(e.message); });
  }, [months, targetId, projectId]);
  useEffect(() => { api(`/monitoring/team?months=${months}`).then(setTeam).catch(() => setTeam(null)); }, [months]);

  const rows = useMemo(() => (data?.monthly || []).map(m => ({ ...m, label: monthLabel(m.key) })), [data]);
  const letterRows = useMemo(() => (data?.letters?.monthly || []).map(m => ({ ...m, label: monthLabel(m.key) })), [data]);
  const canPickUser = (team?.rows?.length || 0) > 1;
  const targetName = users.find(u => u.id === Number(targetId))?.full_name || user.full_name;

  return (
    <div className="content">
      <div className="page-head" style={{ flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h2>مانیتورینگ عملکرد</h2>
          <p style={{ fontSize: 12.5, color: 'var(--text-3)', margin: '4px 0 0' }}>
            کارنامهٔ {targetName} در {RANGES.find(r => r[0] === months)?.[1]} گذشته — وظایف، پروژه‌ها، نامه‌ها و پیگیری‌ها
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {canPickUser && (
            <select className="input" style={{ width: 'auto' }} value={targetId} onChange={e => setTargetId(Number(e.target.value))}>
              {team.rows.map(r => <option key={r.user_id} value={r.user_id}>{r.full_name}{r.user_id === user.id ? ' (خودم)' : ''}</option>)}
            </select>
          )}
          <select className="input" style={{ width: 'auto' }} value={projectId} onChange={e => setProjectId(e.target.value)}>
            <option value="">همهٔ دسته‌ها</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <div className="tabs" style={{ margin: 0 }}>
            {RANGES.map(([m, label]) => (
              <button key={m} className={`tab ${months === m ? 'active' : ''}`} onClick={() => setMonths(m)}>{label}</button>
            ))}
          </div>
        </div>
      </div>

      {err && <div className="card card-pad" style={{ color: 'var(--red)' }}>{err}</div>}
      {!data && !err && <div className="card"><div className="empty">در حال بارگذاری…</div></div>}

      {data && <>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 18 }}>
          <Stat label="کارهای انجام‌شده" value={fa(data.summary.done)} sub={`${fa(data.summary.steps_done)} مرحله هم تیک خورده`} tone="a" />
          <Stat label="به‌موقع انجام‌شده" value={data.summary.on_time_rate === null ? '—' : `${fa(data.summary.on_time_rate)}٪`}
            sub={data.summary.late ? `${fa(data.summary.late)} مورد با تأخیر` : 'بدون تأخیر'}
            tone={data.summary.on_time_rate === null ? undefined : data.summary.on_time_rate >= 80 ? 'good' : 'bad'} />
          <Stat label="کارهای باز" value={fa(data.summary.open)}
            sub={data.summary.overdue ? `${fa(data.summary.overdue)} مورد عقب‌افتاده` : 'چیزی عقب نیفتاده'}
            tone={data.summary.overdue ? 'bad' : 'good'} />
          <Stat label="میانگین زمان انجام" value={data.summary.avg_days === null ? '—' : `${fa(data.summary.avg_days)} روز`}
            sub="از ثبت تا اتمام" />
        </div>

        <div className="grid-2">
          <div className="card card-pad">
            <b style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <BarChart3 size={16} /> کارِ ماهانه
            </b>
            <p style={{ fontSize: 12, color: 'var(--text-3)', margin: '0 0 12px' }}>
              هر ماه چند کار به شما رسیده و چند کار تمام کرده‌اید.
            </p>
            <Legend items={[{ label: 'انجام‌شده', color: 'var(--chart-a)' }, { label: 'ثبت‌شده', color: 'var(--chart-b)' }]} />
            <GroupedBars rows={rows} series={[
              { key: 'done', label: 'انجام‌شده', color: 'var(--chart-a)' },
              { key: 'created', label: 'ثبت‌شده', color: 'var(--chart-b)' },
            ]} />
          </div>

          <div className="card card-pad">
            <b style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <TrendingUp size={16} /> روند به‌موقع بودن
            </b>
            <p style={{ fontSize: 12, color: 'var(--text-3)', margin: '0 0 12px' }}>
              درصد کارهایی که در هر ماه پیش از مهلت تمام شده‌اند.
            </p>
            <TrendLine rows={rows} valueKey="on_time" />
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 10, fontSize: 11.8, color: 'var(--text-3)' }}>
              {rows.map(m => (
                <span key={m.key}>{m.label}: {m.on_time === null ? '—' : `${fa(m.on_time)}٪`}</span>
              ))}
            </div>
          </div>
        </div>

        <div className="grid-2" style={{ marginTop: 16 }}>
          <div className="card card-pad">
            <b style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <ListChecks size={16} /> پیشرفت به تفکیک دسته‌بندی
            </b>
            <RankedBars
              rows={(data.by_project || []).map(p => ({ label: `${p.name} (${fa(p.done)}/${fa(p.total)})`, value: p.progress }))}
              format={(v) => `${fa(v)}٪`} max={100}
              emptyText="هنوز کاری در دسته‌بندی‌ها ثبت نشده است" />
          </div>

          <div className="card card-pad">
            <b style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <Inbox size={16} /> نامه‌ها و پیگیری‌ها
            </b>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, fontSize: 13 }}>
              <div><small style={{ color: 'var(--text-3)' }}>نامه/درخواست ثبت‌شده</small><div style={{ fontSize: 18, fontWeight: 700 }}>{fa(data.letters.sent)}</div></div>
              <div><small style={{ color: 'var(--text-3)' }}>تاییدشده</small><div style={{ fontSize: 18, fontWeight: 700, color: 'var(--green)' }}>{fa(data.letters.approved)}</div></div>
              <div><small style={{ color: 'var(--text-3)' }}>اقدام روی کارتابل</small><div style={{ fontSize: 18, fontWeight: 700 }}>{fa(data.letters.actions)}</div></div>
              <div><small style={{ color: 'var(--text-3)' }}>گزارش نوشته‌شده</small><div style={{ fontSize: 18, fontWeight: 700 }}>{fa(data.follow_ups.reports_written)}</div></div>
              <div><small style={{ color: 'var(--text-3)' }}>سپرده به دیگران</small><div style={{ fontSize: 18, fontWeight: 700 }}>{fa(data.follow_ups.assigned_total)}</div></div>
              <div><small style={{ color: 'var(--text-3)' }}>هنوز باز</small>
                <div style={{ fontSize: 18, fontWeight: 700, color: data.follow_ups.assigned_overdue ? 'var(--red)' : undefined }}>
                  {fa(data.follow_ups.assigned_open)}
                  {data.follow_ups.assigned_overdue > 0 && <small style={{ fontSize: 11.5 }}> ({fa(data.follow_ups.assigned_overdue)} عقب‌افتاده)</small>}
                </div>
              </div>
            </div>
            <div style={{ marginTop: 14 }}>
              <small style={{ color: 'var(--text-3)' }}>نامه‌های ثبت‌شده در هر ماه</small>
              <RankedBars rows={letterRows.map(m => ({ label: m.label, value: m.count }))}
                emptyText="در این بازه نامه‌ای ثبت نکرده‌اید" />
            </div>
          </div>
        </div>

        {team?.rows?.length > 1 && (
          <div className="card card-pad" style={{ marginTop: 16 }}>
            <b style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <Users2 size={16} /> عملکرد اعضای تیم
            </b>
            <p style={{ fontSize: 12, color: 'var(--text-3)', margin: '0 0 12px' }}>
              در {RANGES.find(r => r[0] === months)?.[1]} گذشته. روی هر نام بزنید تا کارنامهٔ کاملش را ببینید.
            </p>
            <div style={{ overflowX: 'auto' }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>نام</th><th>انجام‌شده</th><th>به‌موقع</th><th>باز</th><th>عقب‌افتاده</th><th>نامه</th><th>گزارش</th>
                  </tr>
                </thead>
                <tbody>
                  {team.rows.map(r => (
                    <tr key={r.user_id} style={{ cursor: 'pointer' }} onClick={() => setTargetId(r.user_id)}>
                      <td><b>{r.full_name}</b>{r.user_id === user.id ? ' (خودم)' : ''}</td>
                      <td>{fa(r.done)}</td>
                      <td>{r.on_time_rate === null ? '—' : `${fa(r.on_time_rate)}٪`}</td>
                      <td>{fa(r.open)}</td>
                      <td style={{ color: r.overdue ? 'var(--red)' : undefined }}>{fa(r.overdue)}</td>
                      <td>{fa(r.letters)}</td>
                      <td>{fa(r.reports)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </>}
    </div>
  );
}
