// ============================================================================
//  مرخصی — سقف مرخصی پرسنل، ماندهٔ هر نفر و ریز گردش کسر/افزایش
//  درخواستِ مرخصی از طریق «کارتابل» ثبت می‌شود؛ فرآیندی که در صفحهٔ «فرآیندها»
//  به‌عنوان «فرآیند مرخصی» علامت خورده باشد، پس از تایید نهایی خودکار کسر می‌کند.
// ============================================================================
import React, { useEffect, useState } from 'react';
import {
  CalendarDays, Users as UsersIcon, Settings2, Minus, Trash2, ArrowRight, Search,
} from 'lucide-react';
import { api } from '../api.js';
import { useStore } from '../store.jsx';
import { fmtDateTime, fa } from '../utils.js';
import { Modal, Field, UserPicker } from '../components/common.jsx';
import Gauge, { MiniBar } from '../components/Gauge.jsx';

const TYPE_LABEL = { entitled: 'استحقاقی', unpaid: 'بدون حقوق', sick: 'استعلاجی' };
const TYPE_BADGE = { entitled: 'badge-primary', unpaid: 'badge-gray', sick: 'badge-amber' };

// ساعت را به شکل «X روز و Y ساعت» نشان می‌دهد
function hoursLabel(hours, workday) {
  const h = Number(hours || 0);
  const wd = Number(workday) || 8;
  const sign = h < 0 ? '−' : '';
  const abs = Math.abs(h);
  const days = Math.floor(abs / wd);
  const rest = Math.round((abs - days * wd) * 10) / 10;
  if (!days) return `${sign}${fa(rest)} ساعت`;
  if (!rest) return `${sign}${fa(days)} روز`;
  return `${sign}${fa(days)} روز و ${fa(rest)} ساعت`;
}

export default function Leaves() {
  const { toast, departments, user } = useStore();
  const [data, setData] = useState(null);
  const [openUser, setOpenUser] = useState(null);
  const [bulk, setBulk] = useState(null);
  const [setLimit, setSetLimit] = useState(null);
  const [manual, setManual] = useState(null);
  const [config, setConfig] = useState(null);
  const [search, setSearch] = useState('');
  const [deptF, setDeptF] = useState('');

  const load = async () => {
    try { setData(await api('/leaves/balances')); }
    catch (e) { toast(e.message, 'error'); }
  };
  useEffect(() => { load(); }, []);
  if (!data) return <div className="content"><div className="empty">در حال بارگذاری…</div></div>;

  if (openUser) {
    return <UserLedger userId={openUser} year={data.year} workday={data.workday_hours}
      canManage={data.can_manage} onBack={() => { setOpenUser(null); load(); }} />;
  }

  const wd = data.workday_hours;
  // [گِیج] ماندهٔ خودِ کاربر — همیشه بالای صفحه به‌صورت سرعت‌سنج نشان داده می‌شود
  const mine = data.balances.find(b => b.user_id === user.id);
  const rows = data.balances.filter(b =>
    (!search || b.full_name.includes(search)) &&
    (!deptF || String(b.department_id) === String(deptF)));
  const totals = {
    total: rows.reduce((s, b) => s + b.total_hours, 0),
    used: rows.reduce((s, b) => s + b.used_hours, 0),
    remaining: rows.reduce((s, b) => s + b.remaining_hours, 0),
  };
  const policyText = Object.entries(data.policy).filter(([, v]) => v).map(([k]) => TYPE_LABEL[k]).join('، ') || 'هیچ‌کدام';
  // کارمند عادی فقط ردیف خودش را می‌گیرد؛ جدول و کارت‌های تجمیعی برای او تکراری است
  const isTeamView = data.balances.length > 1 || data.can_manage;

  return (
    <div className="content">
      <div className="page-head">
        <div>
          <h2>مرخصی — سال {fa(data.year).replace(/٬/g, '')}</h2>
          <div style={{ fontSize: 12.5, color: 'var(--text-2)' }}>
            هر روز کاری {fa(wd)} ساعت · از ماندهٔ استحقاقی کم می‌شود: {policyText}
          </div>
        </div>
        {data.can_manage && (
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-ghost" onClick={() => setConfig({
              workday_hours: wd, default_days: data.default_days, policy: { ...data.policy },
            })}><Settings2 size={16} /> تنظیمات مرخصی</button>
            <button className="btn btn-ghost" onClick={() => setManual({ direction: 'deduct', leave_type: 'entitled', unit: 'day', amount: 1 })}>
              <Minus size={16} /> ثبت دستی کسر/افزایش
            </button>
            <button className="btn btn-primary" onClick={() => setBulk({ entitled_days: data.default_days, sick_days: 0, department_id: '', overwrite: true })}>
              <UsersIcon size={16} /> تعیین سقف برای همهٔ پرسنل
            </button>
          </div>
        )}
      </div>

      {/* [گِیج] وضعیت مرخصیِ خودِ کاربر — سرعت‌سنجِ مانده + مصرفِ هر نوع */}
      {mine && (
        <div className="card card-pad" style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <b>مرخصی من</b>
            <button className="btn btn-ghost btn-sm" onClick={() => setOpenUser(user.id)}>
              <CalendarDays size={14} /> ریز گردش مرخصی من
            </button>
          </div>
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center' }}>
            <Gauge
              value={Math.max(0, mine.remaining_hours)}
              max={mine.total_hours}
              label={hoursLabel(Math.max(0, mine.remaining_hours), wd)}
              caption={mine.total_hours > 0
                ? `مانده از ${hoursLabel(mine.total_hours, wd)} سقف سالانه`
                : 'هنوز سقف مرخصی برای شما تعیین نشده است'}
              minLabel="۰"
              maxLabel={hoursLabel(mine.total_hours, wd)}
              size={210}
            />
            <Gauge
              value={mine.used_hours}
              max={mine.total_hours}
              invert
              label={hoursLabel(mine.used_hours, wd)}
              caption="مرخصیِ استفاده‌شده تا امروز"
              minLabel="۰"
              maxLabel={hoursLabel(mine.total_hours, wd)}
              size={210}
            />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 190 }}>
              {[
                ['استحقاقی', mine.entitled_used, 'var(--primary)'],
                ['بدون حقوق', mine.unpaid_used, 'var(--text-2)'],
                ['استعلاجی', mine.sick_used, 'var(--amber)'],
              ].map(([label, val, color]) => (
                <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12.8 }}>
                  <span style={{ minWidth: 78, color: 'var(--text-2)' }}>{label}</span>
                  <MiniBar value={val} max={mine.total_hours || val || 1} width={90} />
                  <b style={{ color }}>{val ? hoursLabel(val, wd) : '—'}</b>
                </div>
              ))}
              {mine.remaining_hours < 0 && (
                <div style={{ fontSize: 12.3, color: 'var(--red)', fontWeight: 600 }}>
                  شما {hoursLabel(Math.abs(mine.remaining_hours), wd)} بیش از سقف مرخصی گرفته‌اید.
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {isTeamView && (
        <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
          <div className="card card-pad" style={{ flex: 1, minWidth: 160 }}>
            <small style={{ color: 'var(--text-3)' }}>سقف کل</small>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{hoursLabel(totals.total, wd)}</div>
          </div>
          <div className="card card-pad" style={{ flex: 1, minWidth: 160 }}>
            <small style={{ color: 'var(--text-3)' }}>مصرف‌شده</small>
            <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--amber)' }}>{hoursLabel(totals.used, wd)}</div>
          </div>
          <div className="card card-pad" style={{ flex: 1, minWidth: 160 }}>
            <small style={{ color: 'var(--text-3)' }}>ماندهٔ کل</small>
            <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--green)' }}>{hoursLabel(totals.remaining, wd)}</div>
          </div>
          <div className="card card-pad" style={{ flex: 1, minWidth: 140 }}>
            <small style={{ color: 'var(--text-3)' }}>تعداد پرسنل</small>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{fa(rows.length)}</div>
          </div>
        </div>
      )}

      {isTeamView && (
        <div className="card card-pad" style={{ marginBottom: 16, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'end' }}>
          <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
            <Search size={15} style={{ position: 'absolute', right: 11, top: 11, color: 'var(--text-3)' }} />
            <input className="input" style={{ paddingRight: 34 }} placeholder="جستجوی نام پرسنل…"
              value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <select className="input" style={{ width: 190 }} value={deptF} onChange={e => setDeptF(e.target.value)}>
            <option value="">همهٔ واحدها</option>
            {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </div>
      )}

      <div className="card" style={{ display: isTeamView ? undefined : 'none' }}>
        {rows.length === 0 ? (
          <div className="empty"><CalendarDays size={40} /><div>پرسنلی یافت نشد</div></div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>نام</th><th>واحد</th><th>سقف استحقاقی</th><th>انتقالی از سال قبل</th>
                <th>استحقاقی مصرف‌شده</th><th>بدون حقوق</th><th>استعلاجی</th><th>مانده</th><th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(b => (
                <tr key={b.user_id}>
                  <td>
                    <a href="#" onClick={e => { e.preventDefault(); setOpenUser(b.user_id); }}
                      style={{ fontWeight: 600, color: 'var(--primary)' }}>{b.full_name}</a>
                  </td>
                  <td style={{ fontSize: 12.5 }}>{b.department_name || '—'}</td>
                  <td style={{ fontSize: 12.5 }}>{hoursLabel(b.entitled_hours, wd)}</td>
                  <td style={{ fontSize: 12.5 }}>{b.carried_over_hours ? hoursLabel(b.carried_over_hours, wd) : '—'}</td>
                  <td style={{ fontSize: 12.5 }}>{b.entitled_used ? hoursLabel(b.entitled_used, wd) : '—'}</td>
                  <td style={{ fontSize: 12.5 }}>{b.unpaid_used ? hoursLabel(b.unpaid_used, wd) : '—'}</td>
                  <td style={{ fontSize: 12.5 }}>{b.sick_used ? hoursLabel(b.sick_used, wd) : '—'}</td>
                  <td>
                    {/* [گِیج] ماندهٔ هر نفر برای مدیر — هم نوار تصویری و هم مقدار دقیق */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <MiniBar value={Math.max(0, b.remaining_hours)} max={b.total_hours} />
                      <span className={`badge ${b.remaining_hours < 0 ? 'badge-red' : b.remaining_hours === 0 ? 'badge-gray' : 'badge-green'}`}>
                        {hoursLabel(b.remaining_hours, wd)}
                      </span>
                    </div>
                  </td>
                  <td>
                    {data.can_manage && (
                      <button className="btn btn-ghost btn-sm" onClick={() => setSetLimit({
                        user_id: b.user_id, full_name: b.full_name,
                        entitled_days: b.entitled_hours / wd,
                        sick_days: b.sick_hours / wd,
                        carried_over_days: b.carried_over_hours / wd,
                        note: b.note,
                      })}>تعیین سقف</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {bulk && <BulkModal value={bulk} setValue={setBulk} workday={wd} onDone={load} />}
      {setLimit && <LimitModal value={setLimit} setValue={setSetLimit} onDone={load} />}
      {manual && <ManualModal value={manual} setValue={setManual} onDone={load} />}
      {config && <ConfigModal value={config} setValue={setConfig} onDone={load} />}
    </div>
  );
}

// ---------------------------------------------------------------- تعیین سقف گروهی
function BulkModal({ value, setValue, workday, onDone }) {
  const { toast, departments } = useStore();
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      const r = await api('/leaves/balances/bulk', { method: 'POST', body: {
        entitled_days: Number(value.entitled_days) || 0,
        sick_days: Number(value.sick_days) || 0,
        department_id: value.department_id ? Number(value.department_id) : 0,
        overwrite: value.overwrite,
      } });
      setValue(null); onDone();
      toast(`سقف مرخصی برای ${fa(r.count)} نفر تعیین شد`);
    } catch (e) { toast(e.message, 'error'); }
    setBusy(false);
  };
  return (
    <Modal title="تعیین سقف مرخصی برای پرسنل" onClose={() => setValue(null)}
      footer={<>
        <button className="btn btn-ghost" onClick={() => setValue(null)}>انصراف</button>
        <button className="btn btn-primary" disabled={busy} onClick={save}>اعمال</button>
      </>}>
      <p style={{ fontSize: 12.5, color: 'var(--text-2)', marginTop: 0 }}>
        مقدار مرخصیِ کل برای همهٔ پرسنل (یا یک واحد مشخص) یکجا تعیین می‌شود.
        هر روز کاری {fa(workday)} ساعت حساب می‌شود.
      </p>
      <Field label="برای کدام واحد؟" hint="خالی = همهٔ پرسنل فعال سامانه">
        <select className="input" value={value.department_id} onChange={e => setValue(v => ({ ...v, department_id: e.target.value }))}>
          <option value="">همهٔ پرسنل</option>
          {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
      </Field>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <Field label="مرخصی استحقاقی سالانه (روز)">
          <input className="input" type="number" min="0" step="0.5" value={value.entitled_days}
            onChange={e => setValue(v => ({ ...v, entitled_days: e.target.value }))} />
        </Field>
        <Field label="سقف مرخصی استعلاجی (روز)" hint="۰ یعنی بدون سقف">
          <input className="input" type="number" min="0" step="0.5" value={value.sick_days}
            onChange={e => setValue(v => ({ ...v, sick_days: e.target.value }))} />
        </Field>
      </div>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
        <input type="checkbox" checked={!!value.overwrite} onChange={e => setValue(v => ({ ...v, overwrite: e.target.checked }))} />
        سقف‌های تعیین‌شدهٔ قبلی هم بازنویسی شوند
      </label>
    </Modal>
  );
}

// ---------------------------------------------------------------- تعیین سقف یک نفر
function LimitModal({ value, setValue, onDone }) {
  const { toast } = useStore();
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await api(`/leaves/balances/${value.user_id}`, { method: 'PUT', body: {
        entitled_days: Number(value.entitled_days) || 0,
        sick_days: Number(value.sick_days) || 0,
        carried_over_days: Number(value.carried_over_days) || 0,
        note: value.note || '',
      } });
      setValue(null); onDone(); toast('سقف مرخصی ثبت شد');
    } catch (e) { toast(e.message, 'error'); }
    setBusy(false);
  };
  return (
    <Modal title={`سقف مرخصی «${value.full_name}»`} onClose={() => setValue(null)}
      footer={<>
        <button className="btn btn-ghost" onClick={() => setValue(null)}>انصراف</button>
        <button className="btn btn-primary" disabled={busy} onClick={save}>ذخیره</button>
      </>}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <Field label="مرخصی استحقاقی (روز)">
          <input className="input" type="number" min="0" step="0.5" autoFocus value={value.entitled_days}
            onChange={e => setValue(v => ({ ...v, entitled_days: e.target.value }))} />
        </Field>
        <Field label="سقف استعلاجی (روز)">
          <input className="input" type="number" min="0" step="0.5" value={value.sick_days}
            onChange={e => setValue(v => ({ ...v, sick_days: e.target.value }))} />
        </Field>
      </div>
      <Field label="ماندهٔ منتقل‌شده از سال قبل (روز)">
        <input className="input" type="number" step="0.5" value={value.carried_over_days}
          onChange={e => setValue(v => ({ ...v, carried_over_days: e.target.value }))} />
      </Field>
      <Field label="توضیحات">
        <input className="input" value={value.note || ''} onChange={e => setValue(v => ({ ...v, note: e.target.value }))} />
      </Field>
    </Modal>
  );
}

// ---------------------------------------------------------------- ثبت دستی
function ManualModal({ value, setValue, onDone }) {
  const { toast } = useStore();
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!value.user_id) return toast('کاربر را انتخاب کنید', 'error');
    setBusy(true);
    try {
      await api('/leaves/ledger', { method: 'POST', body: value });
      setValue(null); onDone(); toast('ثبت شد');
    } catch (e) { toast(e.message, 'error'); }
    setBusy(false);
  };
  return (
    <Modal title="ثبت دستی کسر / افزایش مرخصی" onClose={() => setValue(null)}
      footer={<>
        <button className="btn btn-ghost" onClick={() => setValue(null)}>انصراف</button>
        <button className="btn btn-primary" disabled={busy} onClick={save}>ثبت</button>
      </>}>
      <Field label="کاربر">
        <UserPicker value={value.user_id} onChange={id => setValue(v => ({ ...v, user_id: id }))} />
      </Field>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <Field label="نوع عملیات">
          <select className="input" value={value.direction} onChange={e => setValue(v => ({ ...v, direction: e.target.value }))}>
            <option value="deduct">کسر از مانده</option>
            <option value="add">افزودن به مانده</option>
          </select>
        </Field>
        <Field label="نوع مرخصی">
          <select className="input" value={value.leave_type} onChange={e => setValue(v => ({ ...v, leave_type: e.target.value }))}>
            {Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        <Field label="مقدار">
          <input className="input" type="number" min="0" step="0.5" value={value.amount}
            onChange={e => setValue(v => ({ ...v, amount: e.target.value }))} />
        </Field>
        <Field label="واحد">
          <select className="input" value={value.unit} onChange={e => setValue(v => ({ ...v, unit: e.target.value }))}>
            <option value="day">روز</option>
            <option value="hour">ساعت</option>
          </select>
        </Field>
      </div>
      <Field label="توضیحات">
        <input className="input" value={value.note || ''} onChange={e => setValue(v => ({ ...v, note: e.target.value }))} />
      </Field>
    </Modal>
  );
}

// ---------------------------------------------------------------- تنظیمات
function ConfigModal({ value, setValue, onDone }) {
  const { toast } = useStore();
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await api('/leaves/settings', { method: 'PUT', body: {
        workday_hours: Number(value.workday_hours) || 8,
        default_days: Number(value.default_days) || 0,
        policy: value.policy,
      } });
      setValue(null); onDone(); toast('تنظیمات ذخیره شد');
    } catch (e) { toast(e.message, 'error'); }
    setBusy(false);
  };
  const togglePolicy = (k) => setValue(v => ({ ...v, policy: { ...v.policy, [k]: !v.policy[k] } }));
  return (
    <Modal title="تنظیمات مرخصی" onClose={() => setValue(null)}
      footer={<>
        <button className="btn btn-ghost" onClick={() => setValue(null)}>انصراف</button>
        <button className="btn btn-primary" disabled={busy} onClick={save}>ذخیره</button>
      </>}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <Field label="ساعت کاری هر روز" hint="مبنای تبدیل «روز» به «ساعت»">
          <input className="input" type="number" min="1" max="24" step="0.5" value={value.workday_hours}
            onChange={e => setValue(v => ({ ...v, workday_hours: e.target.value }))} />
        </Field>
        <Field label="سقف پیش‌فرض سالانه (روز)">
          <input className="input" type="number" min="0" value={value.default_days}
            onChange={e => setValue(v => ({ ...v, default_days: e.target.value }))} />
        </Field>
      </div>
      <Field label="کدام نوع مرخصی از ماندهٔ استحقاقی کم شود؟"
        hint="مثلاً معمولاً «استحقاقی» از مانده کم می‌شود ولی «بدون حقوق» و «استعلاجی» فقط ثبت می‌شوند.">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {Object.entries(TYPE_LABEL).map(([k, label]) => (
            <label key={k} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
              <input type="checkbox" checked={!!value.policy[k]} onChange={() => togglePolicy(k)} />
              مرخصی {label} از مانده کم شود
            </label>
          ))}
        </div>
      </Field>
    </Modal>
  );
}

// ---------------------------------------------------------------- ریز گردش یک نفر
function UserLedger({ userId, year, workday, canManage, onBack }) {
  const { toast, users } = useStore();
  const [data, setData] = useState(null);
  const name = users.find(u => u.id === userId)?.full_name || '';

  const load = async () => {
    try { setData(await api(`/leaves/balances/${userId}`)); }
    catch (e) { toast(e.message, 'error'); onBack(); }
  };
  useEffect(() => { load(); }, [userId]);
  if (!data) return <div className="content"><div className="empty">در حال بارگذاری…</div></div>;

  const b = data.balance;
  const remove = async (id) => {
    if (!window.confirm('این سطر از گردش مرخصی حذف شود؟')) return;
    try { await api(`/leaves/ledger/${id}`, { method: 'DELETE' }); load(); }
    catch (e) { toast(e.message, 'error'); }
  };

  return (
    <div className="content">
      <div className="page-head">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button className="icon-btn" onClick={onBack}><ArrowRight size={18} /></button>
          <div>
            <h2>مرخصی {name}</h2>
            <div style={{ fontSize: 12.5, color: 'var(--text-2)' }}>سال {fa(b.year).replace(/٬/g, '')}</div>
          </div>
        </div>
      </div>

      <div className="card card-pad" style={{ marginBottom: 16, display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center' }}>
        <Gauge
          value={Math.max(0, b.remaining_hours)}
          max={b.total_hours}
          label={hoursLabel(Math.max(0, b.remaining_hours), workday)}
          caption={b.total_hours > 0
            ? `ماندهٔ مرخصی از ${hoursLabel(b.total_hours, workday)} سقف سالانه`
            : 'سقف مرخصی تعیین نشده است'}
          maxLabel={hoursLabel(b.total_hours, workday)}
          size={220}
        />
        <Gauge
          value={b.used_hours}
          max={b.total_hours}
          invert
          label={hoursLabel(b.used_hours, workday)}
          caption="مرخصیِ استفاده‌شده"
          maxLabel={hoursLabel(b.total_hours, workday)}
          size={220}
        />
      </div>

      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <div className="card card-pad" style={{ flex: 1, minWidth: 150 }}>
          <small style={{ color: 'var(--text-3)' }}>سقف کل</small>
          <div style={{ fontSize: 18, fontWeight: 700 }}>{hoursLabel(b.total_hours, workday)}</div>
        </div>
        <div className="card card-pad" style={{ flex: 1, minWidth: 150 }}>
          <small style={{ color: 'var(--text-3)' }}>مصرف‌شده</small>
          <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--amber)' }}>{hoursLabel(b.used_hours, workday)}</div>
        </div>
        <div className="card card-pad" style={{ flex: 1, minWidth: 150 }}>
          <small style={{ color: 'var(--text-3)' }}>مانده</small>
          <div style={{ fontSize: 18, fontWeight: 700, color: b.remaining_hours < 0 ? 'var(--red)' : 'var(--green)' }}>
            {hoursLabel(b.remaining_hours, workday)}
          </div>
        </div>
      </div>

      <div className="card">
        {data.ledger.length === 0 ? (
          <div className="empty"><CalendarDays size={40} /><div>هنوز مرخصی‌ای ثبت نشده است</div></div>
        ) : (
          <table className="table">
            <thead>
              <tr><th>نوع</th><th>مقدار</th><th>بازه</th><th>منبع</th><th>توضیح</th><th>تاریخ ثبت</th><th></th></tr>
            </thead>
            <tbody>
              {data.ledger.map(l => (
                <tr key={l.id}>
                  <td><span className={`badge ${TYPE_BADGE[l.leave_type] || 'badge-gray'}`}>{TYPE_LABEL[l.leave_type] || l.leave_type}</span></td>
                  <td style={{ fontWeight: 600, color: l.hours < 0 ? 'var(--red)' : 'var(--green)' }}>
                    {l.hours < 0 ? '−' : '+'}{l.amount_label || hoursLabel(Math.abs(l.hours), workday)}
                  </td>
                  <td style={{ fontSize: 12.3 }}>{l.from_date || l.to_date ? `${l.from_date || '…'} تا ${l.to_date || '…'}` : '—'}</td>
                  <td style={{ fontSize: 12.3 }}>{l.request_title ? `درخواست: ${l.request_title}` : 'ثبت دستی'}</td>
                  <td style={{ fontSize: 12.3, color: 'var(--text-2)' }}>{l.note || '—'}</td>
                  <td style={{ fontSize: 12.3, color: 'var(--text-3)' }}>{fmtDateTime(l.created_at)}</td>
                  <td>
                    {canManage && (
                      <button className="icon-btn" style={{ width: 28, height: 28, color: 'var(--red)' }}
                        onClick={() => remove(l.id)}><Trash2 size={13} /></button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
