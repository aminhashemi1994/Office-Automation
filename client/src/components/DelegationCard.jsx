import React, { useEffect, useState } from 'react';
import { UserCheck, Plus, Trash2, Power, ArrowLeft } from 'lucide-react';
import { api } from '../api.js';
import { useStore } from '../store.jsx';
import { Field, UserPicker, Avatar } from './common.jsx';
import { JalaliDatePicker } from './JalaliDatePicker.jsx';
import { fmtDate } from '../utils.js';
import { toGregorian, parseJalali } from '../jalali.js';

// تاریخ شمسی → ISO (پایانِ روز اختیاری برای بازهٔ پایان)
function jToIso(date, endOfDay = false) {
  if (!date) return null;
  const p = parseJalali(date);
  if (!p) return null;
  const g = toGregorian(p.jy, p.jm, p.jd);
  const [h, m, s] = endOfDay ? [23, 59, 59] : [0, 0, 0];
  return new Date(g.gy, g.gm - 1, g.gd, h, m, s, 0).toISOString();
}

export default function DelegationCard() {
  const { toast } = useStore();
  const [mine, setMine] = useState([]);
  const [toMe, setToMe] = useState([]);
  const [toUser, setToUser] = useState(null);
  const [reason, setReason] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try { const r = await api('/delegations'); setMine(r.mine); setToMe(r.toMe); } catch {}
  };
  useEffect(() => { load(); }, []);

  const add = async () => {
    if (!toUser) return toast('جانشین را انتخاب کنید', 'error');
    setBusy(true);
    try {
      await api('/delegations', { method: 'POST', body: {
        to_user: toUser, reason,
        starts_at: jToIso(startDate, false),
        ends_at: jToIso(endDate, true),
      } });
      setToUser(null); setReason(''); setStartDate(''); setEndDate('');
      await load();
      toast('جانشین ثبت شد');
    } catch (e) { toast(e.message, 'error'); }
    setBusy(false);
  };

  const toggle = async (dg) => {
    try { await api(`/delegations/${dg.id}`, { method: 'PUT', body: { is_active: dg.is_active ? 0 : 1 } }); await load(); }
    catch (e) { toast(e.message, 'error'); }
  };
  const remove = async (dg) => {
    if (!window.confirm('این نیابت حذف شود؟')) return;
    try { await api(`/delegations/${dg.id}`, { method: 'DELETE' }); await load(); }
    catch (e) { toast(e.message, 'error'); }
  };

  const rangeLabel = (dg) => {
    const s = dg.starts_at ? fmtDate(dg.starts_at) : 'هم‌اکنون';
    const e = dg.ends_at ? fmtDate(dg.ends_at) : 'بدون پایان';
    return `${s} تا ${e}`;
  };

  return (
    <div className="card card-pad" style={{ marginTop: 18 }}>
      <b style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <UserCheck size={17} /> واگذاری و نیابت در تاییدها
      </b>
      <p style={{ fontSize: 12.5, color: 'var(--text-3)', marginBottom: 16, lineHeight: 1.7 }}>
        وقتی در دسترس نیستید، جانشینی تعیین کنید تا درخواست‌های در انتظار تاییدِ شما در کارتابل او هم دیده شود و
        جریان کارها متوقف نشود. می‌توانید بازهٔ زمانی مشخص کنید یا خالی بگذارید تا تا لغوِ دستی فعال بماند.
      </p>

      <div className="field-row" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <Field label="جانشین (نایب)">
          <UserPicker value={toUser} onChange={setToUser} placeholder="انتخاب همکار…" />
        </Field>
        <Field label="علت (اختیاری)">
          <input className="input" value={reason} onChange={e => setReason(e.target.value)} placeholder="مثلاً مرخصی / مأموریت" />
        </Field>
        <Field label="از تاریخ (اختیاری)">
          <JalaliDatePicker value={startDate} onChange={setStartDate} placeholder="از هم‌اکنون" />
        </Field>
        <Field label="تا تاریخ (اختیاری)">
          <JalaliDatePicker value={endDate} onChange={setEndDate} placeholder="بدون پایان" />
        </Field>
      </div>
      <button className="btn btn-primary" disabled={busy} onClick={add}><Plus size={16} /> افزودن جانشین</button>

      {mine.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <div style={{ fontSize: 12.5, color: 'var(--text-2)', fontWeight: 600, marginBottom: 8 }}>جانشین‌های تعیین‌شدهٔ شما</div>
          {mine.map(dg => (
            <div key={dg.id} className="notif-item" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Avatar name={dg.to_name} color={dg.to_color} size={30} avatar={dg.to_avatar} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 13.3 }}>
                  {dg.to_name}
                  <span className={`badge ${dg.active_now ? 'badge-green' : 'badge-gray'}`} style={{ marginInlineStart: 8 }}>
                    {dg.active_now ? 'فعال' : (dg.is_active ? 'زمان‌بندی‌شده' : 'غیرفعال')}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-3)' }}>{rangeLabel(dg)}{dg.reason ? ` · ${dg.reason}` : ''}</div>
              </div>
              <button className="icon-btn" style={{ width: 30, height: 30 }} title={dg.is_active ? 'غیرفعال‌کردن' : 'فعال‌کردن'} onClick={() => toggle(dg)}>
                <Power size={14} style={{ color: dg.is_active ? 'var(--green)' : 'var(--text-3)' }} />
              </button>
              <button className="icon-btn" style={{ width: 30, height: 30 }} title="حذف" onClick={() => remove(dg)}>
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      {toMe.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <div style={{ fontSize: 12.5, color: 'var(--text-2)', fontWeight: 600, marginBottom: 8 }}>شما جانشینِ این افراد هستید</div>
          {toMe.map(dg => (
            <div key={dg.id} className="notif-item" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Avatar name={dg.from_name} color={dg.from_color} size={30} avatar={dg.from_avatar} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 13.3 }}>
                  {dg.from_name}
                  <span className={`badge ${dg.active_now ? 'badge-green' : 'badge-gray'}`} style={{ marginInlineStart: 8 }}>
                    {dg.active_now ? 'فعال' : 'غیرفعال'}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-3)' }}>{rangeLabel(dg)}{dg.reason ? ` · ${dg.reason}` : ''}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
