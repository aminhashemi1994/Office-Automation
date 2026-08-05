// ============================================================================
//  مناقصات — فهرست، پروندهٔ کامل، چک‌لیست پاکات، تضمین، رقبا و تحلیل
//  منطقِ مناقصه با فروش مستقیم فرق دارد: مهلت‌های سخت، پاکات الف/ب/ج،
//  ضمانت‌نامه و بازگشایی. هرچه به مهلت نزدیک‌تر، هشدارها پررنگ‌تر می‌شوند.
// ============================================================================
import React, { useEffect, useState } from 'react';
import {
  Plus, Search, Gavel, ArrowRight, Pencil, Trash2, Check, AlertTriangle,
  ShieldCheck, Users as UsersIcon, CalendarClock, BarChart3, FileText,
} from 'lucide-react';
import { api } from '../../api.js';
import { useStore } from '../../store.jsx';
import { fmtDate, fmtDateTime, fa } from '../../utils.js';
import { Modal, Field, UserPicker } from '../../components/common.jsx';
import { AttachmentPicker, AttachmentList } from '../../components/Attachments.jsx';
import { RankedBars, GroupedBars, TrendLine, Stat } from '../../components/Charts.jsx';
import Gauge, { MiniBar } from '../../components/Gauge.jsx';

export const TENDER_STATUS = {
  identified: ['شناسایی‌شده', 'badge-gray'],
  reviewing: ['در حال بررسی', 'badge-gray'],
  docs: ['اسناد دریافت شد', 'badge-sky'],
  preparing: ['آماده‌سازی پیشنهاد', 'badge-primary'],
  submitted: ['پیشنهاد ارسال شد', 'badge-primary'],
  opened: ['بازگشایی شد', 'badge-amber'],
  won: ['برنده', 'badge-green'],
  lost: ['بازنده', 'badge-red'],
  cancelled: ['لغو شده', 'badge-gray'],
  withdrawn: ['انصراف دادیم', 'badge-gray'],
};

const PORTAL = { setad: 'سامانه ستاد', own: 'سامانه اختصاصی', paper: 'روزنامه / آگهی', other: 'سایر' };
const METHOD = {
  public_1: 'عمومی یک مرحله‌ای', public_2: 'عمومی دو مرحله‌ای',
  limited: 'محدود', direct: 'ترک تشریفات',
};
const ENVELOPE = { a: 'پاکت الف — تضمین', b: 'پاکت ب — اسناد و سوابق', c: 'پاکت ج — پیشنهاد قیمت' };
const GUARANTEE = { bank: 'ضمانت‌نامه بانکی', cheque: 'چک', cash: 'واریز نقدی', '': 'نامشخص' };

const money = (n) => `${Number(n || 0).toLocaleString('fa-IR')} ریال`;
const rateText = (v) => (v === null || v === undefined ? '—' : `${fa(v, 1)}٪`);

// نشانِ «چند روز مانده» — هرچه نزدیک‌تر، پررنگ‌تر
function Deadline({ days, date, label = 'مهلت' }) {
  if (!date) return <span style={{ color: 'var(--text-3)' }}>—</span>;
  const tone = days === null ? 'badge-gray'
    : days < 0 ? 'badge-red' : days <= 3 ? 'badge-red' : days <= 7 ? 'badge-amber' : 'badge-gray';
  const text = days === null ? fmtDate(date)
    : days < 0 ? `${fa(Math.abs(days))} روز گذشته`
    : days === 0 ? 'امروز آخرین مهلت'
    : `${fa(days)} روز مانده`;
  return (
    <span className={`badge ${tone}`} title={`${label}: ${fmtDate(date)}`}>
      <CalendarClock size={11} /> {text}
    </span>
  );
}

export default function Tenders({ onOpenCustomer }) {
  const { toast, users } = useStore();
  const [rows, setRows] = useState([]);
  const [alerts, setAlerts] = useState(null);
  const [canManage, setCanManage] = useState(false);
  const [openId, setOpenId] = useState(null);
  const [edit, setEdit] = useState(null);
  const [filters, setFilters] = useState({ q: '', status: '', portal: '', open_only: '1' });

  const load = async () => {
    try {
      const qs = new URLSearchParams(Object.entries(filters).filter(([, v]) => v)).toString();
      const [t, a] = await Promise.all([
        api(`/crm/tenders${qs ? '?' + qs : ''}`),
        api('/crm/tender-alerts'),
      ]);
      setRows(t.tenders); setCanManage(t.can_manage); setAlerts(a);
    } catch (e) { toast(e.message, 'error'); }
  };
  useEffect(() => { load(); }, []);

  if (openId) {
    return <TenderDetail id={openId} canManage={canManage} onOpenCustomer={onOpenCustomer}
      onBack={() => { setOpenId(null); load(); }} />;
  }

  const alertCount = alerts
    ? alerts.submit_soon.filter(t => t.days_to_submit <= 7).length + alerts.guarantee_soon.length
    : 0;

  return (
    <>
      {/* ---- تابلوی هشدار: چیزی که نباید از دست برود ---- */}
      {alerts && alertCount > 0 && (
        <div className="card card-pad" style={{ marginBottom: 16, borderColor: 'var(--red)', background: 'var(--red-soft)' }}>
          <b style={{ display: 'block', marginBottom: 8, fontSize: 13.5 }}>
            <AlertTriangle size={15} style={{ verticalAlign: '-3px', marginLeft: 5 }} />
            کارهای فوریِ مناقصات
          </b>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {alerts.submit_soon.filter(t => t.days_to_submit <= 7).map(t => (
              <div key={`s${t.id}`} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: 12.8 }}>
                <Deadline days={t.days_to_submit} date={t.submit_deadline} />
                <a href="#" onClick={e => { e.preventDefault(); setOpenId(t.id); }}
                  style={{ fontWeight: 600, color: 'var(--primary)' }}>{t.title}</a>
                <span style={{ color: 'var(--text-2)' }}>{t.customer_name || t.organization}</span>
                {t.checklist_total > 0 && t.checklist_done < t.checklist_total && (
                  <span className="badge badge-amber">
                    {fa(t.checklist_total - t.checklist_done)} مدرک ناقص
                  </span>
                )}
              </div>
            ))}
            {alerts.guarantee_soon.map(t => (
              <div key={`g${t.id}`} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: 12.8 }}>
                <span className={`badge ${t.days_to_guarantee <= 7 ? 'badge-red' : 'badge-amber'}`}>
                  <ShieldCheck size={11} /> ضمانت‌نامه: {t.days_to_guarantee < 0
                    ? `${fa(Math.abs(t.days_to_guarantee))} روز گذشته` : `${fa(t.days_to_guarantee)} روز مانده`}
                </span>
                <a href="#" onClick={e => { e.preventDefault(); setOpenId(t.id); }}
                  style={{ fontWeight: 600, color: 'var(--primary)' }}>{t.title}</a>
                <span style={{ color: 'var(--text-2)' }}>{money(t.guarantee_amount)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ---- فیلترها ---- */}
      <div className="card card-pad" style={{ marginBottom: 16, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'end' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
          <Search size={15} style={{ position: 'absolute', right: 11, top: 11, color: 'var(--text-3)' }} />
          <input className="input" style={{ paddingRight: 34 }} placeholder="جستجوی عنوان، شماره مناقصه یا دستگاه…"
            value={filters.q} onChange={e => setFilters(f => ({ ...f, q: e.target.value }))}
            onKeyDown={e => e.key === 'Enter' && load()} />
        </div>
        <select className="input" style={{ width: 165 }} value={filters.status}
          onChange={e => setFilters(f => ({ ...f, status: e.target.value }))}>
          <option value="">همهٔ وضعیت‌ها</option>
          {Object.entries(TENDER_STATUS).map(([k, v]) => <option key={k} value={k}>{v[0]}</option>)}
        </select>
        <select className="input" style={{ width: 150 }} value={filters.portal}
          onChange={e => setFilters(f => ({ ...f, portal: e.target.value }))}>
          <option value="">همهٔ سامانه‌ها</option>
          {Object.entries(PORTAL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12.8, paddingBottom: 9 }}>
          <input type="checkbox" checked={filters.open_only === '1'}
            onChange={e => setFilters(f => ({ ...f, open_only: e.target.checked ? '1' : '' }))} />
          فقط مناقصات باز
        </label>
        <button className="btn btn-primary" onClick={load}><Search size={16} /> جستجو</button>
        <button className="btn btn-ghost" onClick={() => setEdit({
          status: 'identified', portal: 'setad', method: 'public_1', guarantee_type: 'bank', attachments: [],
        })}><Plus size={16} /> مناقصهٔ جدید</button>
      </div>

      <div className="card">
        {rows.length === 0 ? (
          <div className="empty"><Gavel size={40} /><div>مناقصه‌ای یافت نشد</div></div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>عنوان / شماره</th><th>مناقصه‌گزار</th><th>سامانه</th><th>وضعیت</th>
                <th>مهلت ارسال</th><th>پاکات</th><th>برآورد / پیشنهاد ما</th><th>مسئول</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(t => {
                const [sl, sc] = TENDER_STATUS[t.status] || TENDER_STATUS.identified;
                return (
                  <tr key={t.id}>
                    <td>
                      <a href="#" onClick={e => { e.preventDefault(); setOpenId(t.id); }}
                        style={{ fontWeight: 600, color: 'var(--primary)' }}>{t.title}</a>
                      {t.tender_no && <div style={{ fontSize: 11.5, color: 'var(--text-3)' }}>شماره {t.tender_no}</div>}
                    </td>
                    <td style={{ fontSize: 12.5 }}>{t.customer_name || t.organization || '—'}</td>
                    <td style={{ fontSize: 12.3 }}>{PORTAL[t.portal] || t.portal}</td>
                    <td><span className={`badge ${sc}`}>{sl}</span></td>
                    <td>{t.is_closed ? '—' : <Deadline days={t.days_to_submit} date={t.submit_deadline} />}</td>
                    <td>
                      {t.checklist_total > 0 ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                          <MiniBar value={t.checklist_done} max={t.checklist_total} width={54} />
                          <span style={{ fontSize: 12 }}>{fa(t.checklist_done)}/{fa(t.checklist_total)}</span>
                        </div>
                      ) : '—'}
                    </td>
                    <td style={{ fontSize: 12.3 }}>
                      {t.estimated_amount > 0 && <div style={{ color: 'var(--text-2)' }}>{money(t.estimated_amount)}</div>}
                      {t.our_bid_amount > 0 && <div style={{ fontWeight: 600 }}>{money(t.our_bid_amount)}</div>}
                      {!t.estimated_amount && !t.our_bid_amount && '—'}
                    </td>
                    <td style={{ fontSize: 12.3 }}>{t.owner_name || '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {edit && (
        <TenderModal value={edit} onClose={() => setEdit(null)} onDone={() => { setEdit(null); load(); }} />
      )}
    </>
  );
}

// ---------------------------------------------------------------- مودال مناقصه
function TenderModal({ value, onClose, onDone }) {
  const { toast, departments, settings } = useStore();
  const [v, setV] = useState(value);
  const [customers, setCustomers] = useState([]);
  const [report, setReport] = useState({ summary: '', went_well: '', went_wrong: '', blockers: '', next_action: '', confidence: 0 });
  const [busy, setBusy] = useState(false);
  const set = (patch) => setV(x => ({ ...x, ...patch }));
  const statusChanged = !!v.id && v.stage !== undefined ? false : (!!v.id && v.status !== value.status);
  const lostReasons = String(settings?.crm_lost_reasons || '').split('،').map(x => x.trim()).filter(Boolean);

  useEffect(() => {
    api('/crm/customers').then(r => setCustomers(r.customers)).catch(() => {});
  }, []);

  const save = async () => {
    if (!String(v.title || '').trim()) return toast('عنوان مناقصه الزامی است', 'error');
    if (!v.customer_id && !String(v.organization || '').trim()) {
      return toast('دستگاه مناقصه‌گزار را مشخص کنید', 'error');
    }
    if (statusChanged && !String(report.summary || '').trim()) {
      return toast('برای تغییر وضعیت، بخش «چه اتفاقی افتاد؟» را پر کنید', 'error');
    }
    if (v.status === 'lost' && !String(v.lost_reason || '').trim()) {
      return toast('برای مناقصهٔ باخته، دلیل باخت را مشخص کنید', 'error');
    }
    setBusy(true);
    try {
      const body = { ...v, stage_report: report };
      if (v.id) await api(`/crm/tenders/${v.id}`, { method: 'PUT', body });
      else await api('/crm/tenders', { method: 'POST', body });
      onDone(); toast(v.id ? 'مناقصه ویرایش شد' : 'مناقصه ثبت شد');
    } catch (e) { toast(e.message, 'error'); }
    setBusy(false);
  };

  return (
    <Modal title={v.id ? `ویرایش «${value.title}»` : 'ثبت مناقصهٔ جدید'} onClose={onClose} wide
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>انصراف</button>
        <button className="btn btn-primary" disabled={busy} onClick={save}>ذخیره</button>
      </>}>
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 10 }}>
        <Field label="عنوان مناقصه *">
          <input className="input" value={v.title || ''} autoFocus
            placeholder="مثلاً: خرید کابل فشار متوسط" onChange={e => set({ title: e.target.value })} />
        </Field>
        <Field label="شماره فراخوان / مناقصه">
          <input className="input" value={v.tender_no || ''} onChange={e => set({ tender_no: e.target.value })} />
        </Field>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <Field label="مناقصه‌گزار (از فهرست مشتریان)">
          <select className="input" value={v.customer_id || ''}
            onChange={e => set({ customer_id: e.target.value ? Number(e.target.value) : null })}>
            <option value="">— در فهرست نیست —</option>
            {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="یا نام دستگاه مناقصه‌گزار" hint="اگر هنوز به‌عنوان مشتری ثبت نشده است">
          <input className="input" value={v.organization || ''} onChange={e => set({ organization: e.target.value })} />
        </Field>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
        <Field label="سامانه / منبع فراخوان">
          <select className="input" value={v.portal || 'setad'} onChange={e => set({ portal: e.target.value })}>
            {Object.entries(PORTAL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </Field>
        <Field label="نوع مناقصه">
          <select className="input" value={v.method || 'public_1'} onChange={e => set({ method: e.target.value })}>
            {Object.entries(METHOD).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </Field>
        <Field label="وضعیت">
          <select className="input" value={v.status || 'identified'} onChange={e => set({ status: e.target.value })}>
            {Object.entries(TENDER_STATUS).map(([k, l]) => <option key={k} value={k}>{l[0]}</option>)}
          </select>
        </Field>
      </div>
      <Field label="نشانی فراخوان در سامانه">
        <input className="input" value={v.portal_url || ''} placeholder="https://setadiran.ir/…"
          style={{ direction: 'ltr', textAlign: 'left' }} onChange={e => set({ portal_url: e.target.value })} />
      </Field>
      <Field label="موضوع / شرح">
        <textarea className="input" value={v.subject || ''} onChange={e => set({ subject: e.target.value })} />
      </Field>

      <div className="card-pad panel-soft" style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 12.8, fontWeight: 700, marginBottom: 10 }}>تاریخ‌ها و مهلت‌ها</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
          <Field label="تاریخ انتشار">
            <input className="input" type="date" value={(v.published_at || '').slice(0, 10)}
              onChange={e => set({ published_at: e.target.value })} />
          </Field>
          <Field label="مهلت دریافت اسناد">
            <input className="input" type="date" value={(v.docs_deadline || '').slice(0, 10)}
              onChange={e => set({ docs_deadline: e.target.value })} />
          </Field>
          <Field label="مهلت ارسال پیشنهاد" hint="حیاتی‌ترین تاریخ — یادآوری خودکار دارد">
            <input className="input" type="date" value={(v.submit_deadline || '').slice(0, 10)}
              onChange={e => set({ submit_deadline: e.target.value })} />
          </Field>
          <Field label="تاریخ بازگشایی پاکات">
            <input className="input" type="date" value={(v.opening_at || '').slice(0, 10)}
              onChange={e => set({ opening_at: e.target.value })} />
          </Field>
        </div>
      </div>

      <div className="card-pad panel-soft" style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 12.8, fontWeight: 700, marginBottom: 10 }}>مبالغ و تضمین (پاکت الف)</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Field label="برآورد کارفرما (ریال)">
            <input className="input" type="number" min="0" value={v.estimated_amount ?? 0}
              onChange={e => set({ estimated_amount: Number(e.target.value) })} />
          </Field>
          <Field label="مبلغ پیشنهادی ما (ریال)">
            <input className="input" type="number" min="0" value={v.our_bid_amount ?? 0}
              onChange={e => set({ our_bid_amount: Number(e.target.value) })} />
          </Field>
          <Field label="نوع تضمین">
            <select className="input" value={v.guarantee_type || ''} onChange={e => set({ guarantee_type: e.target.value })}>
              <option value="">بدون تضمین</option>
              <option value="bank">ضمانت‌نامه بانکی</option>
              <option value="cheque">چک</option>
              <option value="cash">واریز نقدی</option>
            </select>
          </Field>
          <Field label="مبلغ تضمین (ریال)">
            <input className="input" type="number" min="0" value={v.guarantee_amount ?? 0}
              onChange={e => set({ guarantee_amount: Number(e.target.value) })} />
          </Field>
          <Field label="شماره ضمانت‌نامه">
            <input className="input" value={v.guarantee_no || ''} onChange={e => set({ guarantee_no: e.target.value })} />
          </Field>
          <Field label="سررسید ضمانت‌نامه" hint="۳۰، ۱۵، ۷، ۳ و ۱ روز مانده یادآوری می‌شود">
            <input className="input" type="date" value={(v.guarantee_expires_at || '').slice(0, 10)}
              onChange={e => set({ guarantee_expires_at: e.target.value })} />
          </Field>
        </div>
        {v.id && (
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
            <input type="checkbox" checked={!!v.guarantee_released}
              onChange={e => set({ guarantee_released: e.target.checked })} />
            ضمانت‌نامه آزاد شده است (دیگر یادآوری نشود)
          </label>
        )}
      </div>

      {['opened', 'won', 'lost'].includes(v.status) && (
        <div className="card-pad panel-soft" style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 12.8, fontWeight: 700, marginBottom: 10 }}>نتیجهٔ بازگشایی</div>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 10 }}>
            <Field label="برندهٔ مناقصه">
              <input className="input" value={v.winner_name || ''} onChange={e => set({ winner_name: e.target.value })} />
            </Field>
            <Field label="مبلغ برنده (ریال)">
              <input className="input" type="number" min="0" value={v.winner_amount ?? 0}
                onChange={e => set({ winner_amount: Number(e.target.value) })} />
            </Field>
            <Field label="رتبهٔ ما">
              <input className="input" type="number" min="0" value={v.our_rank ?? 0}
                onChange={e => set({ our_rank: Number(e.target.value) })} />
            </Field>
          </div>
          {v.winner_amount > 0 && v.our_bid_amount > 0 && (
            <div style={{ fontSize: 12.5, color: 'var(--text-2)', marginBottom: 10 }}>
              فاصلهٔ قیمتی ما با برنده:{' '}
              <b style={{ color: v.our_bid_amount > v.winner_amount ? 'var(--chart-b)' : 'var(--green)' }}>
                {fa(Math.round(((v.our_bid_amount - v.winner_amount) / v.winner_amount) * 1000) / 10, 1)}٪
              </b>
            </div>
          )}
          {v.status === 'lost' && (
            <Field label="دلیل باخت *">
              <input className="input" list="tender-lost-reasons" value={v.lost_reason || ''}
                onChange={e => set({ lost_reason: e.target.value })} />
              <datalist id="tender-lost-reasons">
                {['قیمت بالا', 'ردصلاحیت فنی', 'نقص مدارک', 'عدم ارائه به‌موقع', ...lostReasons]
                  .map(x => <option key={x} value={x} />)}
              </datalist>
            </Field>
          )}
          <Field label="توضیح نتیجه">
            <textarea className="input" value={v.result_note || ''} onChange={e => set({ result_note: e.target.value })} />
          </Field>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <Field label="کارشناس مسئول">
          <UserPicker value={v.owner_id} onChange={id => set({ owner_id: id })} />
        </Field>
        <Field label="واحد">
          <select className="input" value={v.department_id || ''}
            onChange={e => set({ department_id: e.target.value ? Number(e.target.value) : null })}>
            <option value="">— بدون واحد —</option>
            {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </Field>
      </div>
      <Field label="اسناد مناقصه" hint="اسناد فراخوان، نقشه‌ها و پیوست‌ها">
        <AttachmentPicker value={v.attachments || []} onChange={x => set({ attachments: x })} />
      </Field>
      <Field label="یادداشت">
        <textarea className="input" value={v.note || ''} onChange={e => set({ note: e.target.value })} />
      </Field>

      {statusChanged && (
        <div className="card-pad panel-soft">
          <div style={{ fontSize: 12.8, fontWeight: 700, marginBottom: 4 }}>
            <FileText size={14} style={{ verticalAlign: '-2px', marginLeft: 5 }} />
            گزارش این مرحله <span style={{ color: 'var(--red)' }}>*</span>
          </div>
          <p style={{ fontSize: 11.8, color: 'var(--text-3)', margin: '0 0 12px' }}>
            وضعیت از «{TENDER_STATUS[value.status]?.[0]}» به «{TENDER_STATUS[v.status]?.[0]}» تغییر می‌کند — بنویسید چه شد.
          </p>
          <Field label="چه اتفاقی افتاد؟">
            <textarea className="input" value={report.summary}
              onChange={e => setReport(x => ({ ...x, summary: e.target.value }))} />
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Field label="چه چیزی خوب پیش رفت؟">
              <textarea className="input" value={report.went_well}
                onChange={e => setReport(x => ({ ...x, went_well: e.target.value }))} />
            </Field>
            <Field label="چه چیزی خوب پیش نرفت؟">
              <textarea className="input" value={report.went_wrong}
                onChange={e => setReport(x => ({ ...x, went_wrong: e.target.value }))} />
            </Field>
          </div>
          <Field label="قدم بعدی">
            <textarea className="input" value={report.next_action}
              onChange={e => setReport(x => ({ ...x, next_action: e.target.value }))} />
          </Field>
        </div>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------- پروندهٔ مناقصه
function TenderDetail({ id, canManage, onBack, onOpenCustomer }) {
  const { toast } = useStore();
  const [t, setT] = useState(null);
  const [edit, setEdit] = useState(null);
  const [newDoc, setNewDoc] = useState(null);
  const [newRival, setNewRival] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try { const r = await api(`/crm/tenders/${id}`); setT(r.tender); }
    catch (e) { toast(e.message, 'error'); onBack(); }
  };
  useEffect(() => { load(); }, [id]);
  if (!t) return <div className="card"><div className="empty">در حال بارگذاری…</div></div>;

  const [sl, sc] = TENDER_STATUS[t.status] || TENDER_STATUS.identified;
  const toggleDoc = async (d) => {
    try { await api(`/crm/checklist/${d.id}`, { method: 'PUT', body: { done: d.done ? 0 : 1 } }); load(); }
    catch (e) { toast(e.message, 'error'); }
  };
  const delDoc = async (d) => {
    try { await api(`/crm/checklist/${d.id}`, { method: 'DELETE' }); load(); }
    catch (e) { toast(e.message, 'error'); }
  };
  const addDoc = async () => {
    setBusy(true);
    try { await api(`/crm/tenders/${t.id}/checklist`, { method: 'POST', body: newDoc }); setNewDoc(null); load(); }
    catch (e) { toast(e.message, 'error'); }
    setBusy(false);
  };
  const addRival = async () => {
    setBusy(true);
    try { await api(`/crm/tenders/${t.id}/competitors`, { method: 'POST', body: newRival }); setNewRival(null); load(); }
    catch (e) { toast(e.message, 'error'); }
    setBusy(false);
  };
  const delRival = async (c) => {
    try { await api(`/crm/competitors/${c.id}`, { method: 'DELETE' }); load(); }
    catch (e) { toast(e.message, 'error'); }
  };
  const remove = async () => {
    if (!window.confirm(`مناقصهٔ «${t.title}» حذف شود؟`)) return;
    try { await api(`/crm/tenders/${t.id}`, { method: 'DELETE' }); toast('حذف شد'); onBack(); }
    catch (e) { toast(e.message, 'error'); }
  };

  const envelopes = ['a', 'b', 'c'];

  return (
    <>
      <div className="page-head">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button className="icon-btn" onClick={onBack}><ArrowRight size={18} /></button>
          <div>
            <h2>{t.title}</h2>
            <div style={{ fontSize: 12.8, color: 'var(--text-2)' }}>
              {t.tender_no ? `شماره ${t.tender_no} · ` : ''}
              {t.customer_name || t.organization} · {PORTAL[t.portal] || t.portal} · {METHOD[t.method] || t.method}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span className={`badge ${sc}`} style={{ fontSize: 13 }}>{sl}</span>
          {!t.is_closed && <Deadline days={t.days_to_submit} date={t.submit_deadline} />}
          <button className="btn btn-ghost btn-sm" onClick={() => setEdit({ ...t })}><Pencil size={14} /> ویرایش</button>
          {canManage && (
            <button className="btn btn-ghost btn-sm" style={{ color: 'var(--red)' }} onClick={remove}>
              <Trash2 size={14} /> حذف
            </button>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <Stat label="برآورد کارفرما" value={money(t.estimated_amount)} />
        <Stat label="پیشنهاد ما" value={money(t.our_bid_amount)} tone="a" />
        {t.winner_amount > 0 && <Stat label="مبلغ برنده" value={money(t.winner_amount)} tone="b"
          sub={t.winner_name || ''} />}
        {t.price_gap_pct !== null && (
          <Stat label="فاصلهٔ قیمتی با برنده" value={`${fa(t.price_gap_pct, 1)}٪`}
            tone={t.price_gap_pct > 0 ? 'bad' : 'good'}
            sub={t.price_gap_pct > 0 ? 'ما گران‌تر بودیم' : 'ما ارزان‌تر بودیم'} />
        )}
        <Stat label="تضمین" value={t.guarantee_amount > 0 ? money(t.guarantee_amount) : '—'}
          sub={`${GUARANTEE[t.guarantee_type] || '—'}${t.guarantee_released ? ' · آزاد شده' : ''}`} />
      </div>

      <div className="grid-2">
        {/* ---- چک‌لیست پاکات ---- */}
        <div className="card card-pad" style={{ marginBottom: 18 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
            <b>مدارک پاکات</b>
            <button className="btn btn-ghost btn-sm" onClick={() => setNewDoc({ envelope: 'b', title: '', required: true })}>
              <Plus size={14} /> مدرک
            </button>
          </div>
          <p style={{ fontSize: 12, color: 'var(--text-3)', margin: '0 0 10px' }}>
            هر مدرکِ جامانده می‌تواند به ردصلاحیت منجر شود. پیش از ارسال، همه را تیک بزنید.
          </p>
          {t.checklist_total > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 12 }}>
              <MiniBar value={t.checklist_done} max={t.checklist_total} width={120} />
              <b style={{ fontSize: 12.8 }}>{fa(t.checklist_done)} از {fa(t.checklist_total)} مدرک آماده</b>
            </div>
          )}
          {envelopes.map(env => {
            const docs = t.checklist.filter(d => d.envelope === env);
            if (!docs.length) return null;
            return (
              <div key={env} style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-2)', marginBottom: 5 }}>
                  {ENVELOPE[env]}
                </div>
                {docs.map(d => (
                  <div key={d.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '5px 0' }}>
                    <button className="icon-btn" style={{ width: 24, height: 24, flexShrink: 0 }}
                      title={d.done ? 'آماده است' : 'هنوز آماده نیست'} onClick={() => toggleDoc(d)}>
                      {d.done ? <Check size={13} style={{ color: 'var(--green)' }} /> : <span style={{ fontSize: 11 }}>○</span>}
                    </button>
                    <span style={{
                      flex: 1, fontSize: 12.8,
                      textDecoration: d.done ? 'line-through' : 'none',
                      color: d.done ? 'var(--text-3)' : 'var(--text)',
                    }}>
                      {d.title}
                      {!d.required && <span className="badge badge-gray" style={{ marginRight: 6 }}>اختیاری</span>}
                    </span>
                    <button className="icon-btn" style={{ width: 24, height: 24, color: 'var(--red)' }}
                      onClick={() => delDoc(d)}><Trash2 size={12} /></button>
                  </div>
                ))}
              </div>
            );
          })}
          {t.checklist.length === 0 && <div style={{ fontSize: 12.8, color: 'var(--text-3)' }}>مدرکی ثبت نشده است</div>}
        </div>

        {/* ---- رقبا ---- */}
        <div className="card card-pad" style={{ marginBottom: 18 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
            <b>رقبا و مبالغ پیشنهادی</b>
            <button className="btn btn-ghost btn-sm" onClick={() => setNewRival({ name: '', amount: 0, rank: 0 })}>
              <Plus size={14} /> رقیب
            </button>
          </div>
          <p style={{ fontSize: 12, color: 'var(--text-3)', margin: '0 0 10px' }}>
            بعد از بازگشایی ثبتشان کنید — در بلندمدت می‌فهمید هر رقیب معمولاً چقدر پایین‌تر قیمت می‌دهد.
          </p>
          {t.competitors.length === 0 ? (
            <div style={{ fontSize: 12.8, color: 'var(--text-3)' }}>هنوز رقیبی ثبت نشده است</div>
          ) : t.competitors.map(c => (
            <div key={c.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '7px 0', borderBottom: '1px solid var(--border-soft)' }}>
              {c.rank > 0 && <span className="badge badge-gray">رتبه {fa(c.rank)}</span>}
              <b style={{ fontSize: 13 }}>{c.name}</b>
              {!!c.is_winner && <span className="badge badge-green">برنده</span>}
              <span style={{ marginInlineStart: 'auto', fontSize: 12.5 }}>{money(c.amount)}</span>
              <button className="icon-btn" style={{ width: 24, height: 24, color: 'var(--red)' }}
                onClick={() => delRival(c)}><Trash2 size={12} /></button>
            </div>
          ))}
        </div>
      </div>

      <div className="grid-2">
        <div className="card card-pad" style={{ marginBottom: 18 }}>
          <b style={{ display: 'block', marginBottom: 12 }}>اطلاعات و تاریخ‌ها</b>
          {[
            ['موضوع', t.subject],
            ['تاریخ انتشار', t.published_at && fmtDate(t.published_at)],
            ['مهلت دریافت اسناد', t.docs_deadline && fmtDate(t.docs_deadline)],
            ['مهلت ارسال پیشنهاد', t.submit_deadline && fmtDate(t.submit_deadline)],
            ['بازگشایی پاکات', t.opening_at && fmtDate(t.opening_at)],
            ['شماره ضمانت‌نامه', t.guarantee_no],
            ['سررسید ضمانت‌نامه', t.guarantee_expires_at && fmtDate(t.guarantee_expires_at)],
            ['رتبهٔ ما', t.our_rank > 0 && fa(t.our_rank)],
            ['دلیل باخت', t.lost_reason],
            ['نتیجه', t.result_note],
            ['کارشناس مسئول', t.owner_name],
            ['واحد', t.department_name],
            ['یادداشت', t.note],
          ].filter(([, v]) => v).map(([k, v]) => (
            <div key={k} style={{ display: 'flex', gap: 10, padding: '7px 0', borderBottom: '1px solid var(--border-soft)' }}>
              <span style={{ color: 'var(--text-2)', fontSize: 13, minWidth: 145 }}>{k}:</span>
              <span style={{ fontWeight: 600, fontSize: 13, whiteSpace: 'pre-wrap' }}>{v}</span>
            </div>
          ))}
          {t.portal_url && (
            <div style={{ marginTop: 10 }}>
              <a href={t.portal_url} target="_blank" rel="noreferrer"
                className="btn btn-ghost btn-sm" style={{ direction: 'ltr' }}>مشاهده در سامانه</a>
            </div>
          )}
          {t.attachments?.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <AttachmentList ids={t.attachments} thumb={88} title="اسناد مناقصه" />
            </div>
          )}
        </div>

        <div className="card card-pad" style={{ marginBottom: 18 }}>
          <b style={{ display: 'block', marginBottom: 4 }}>گزارش‌های مرحله‌ای</b>
          <p style={{ fontSize: 12, color: 'var(--text-3)', margin: '0 0 12px' }}>
            آنچه در هر مرحله ثبت شده — پایهٔ تحلیل و پیشنهادهای بهبود.
          </p>
          {t.reports.length === 0 ? (
            <div style={{ fontSize: 12.8, color: 'var(--text-3)' }}>گزارشی ثبت نشده است</div>
          ) : t.reports.slice().reverse().map(r => (
            <div key={r.id} style={{ padding: '9px 0', borderBottom: '1px solid var(--border-soft)' }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                {r.from_stage && r.from_stage !== r.stage && (
                  <span className="badge badge-gray">{TENDER_STATUS[r.from_stage]?.[0] || r.from_stage} ←</span>
                )}
                <span className={`badge ${TENDER_STATUS[r.stage]?.[1] || 'badge-gray'}`}>
                  {TENDER_STATUS[r.stage]?.[0] || r.stage}
                </span>
                <span style={{ fontSize: 11.5, color: 'var(--text-3)', marginInlineStart: 'auto' }}>
                  {r.user_name} · {fmtDateTime(r.created_at)}
                </span>
              </div>
              {r.summary && <div style={{ fontSize: 12.8, marginTop: 5, whiteSpace: 'pre-wrap' }}>{r.summary}</div>}
              {[['چه خوب بود', r.went_well, 'var(--chart-a)'], ['چه بد بود', r.went_wrong, 'var(--chart-b)'],
                ['موانع', r.blockers, 'var(--text-2)'], ['قدم بعدی', r.next_action, 'var(--primary)']]
                .filter(([, v]) => v).map(([label, v, color]) => (
                  <div key={label} style={{ fontSize: 12.3, marginTop: 4 }}>
                    <b style={{ color, fontSize: 11.5 }}>{label}: </b>
                    <span style={{ color: 'var(--text-2)' }}>{v}</span>
                  </div>
                ))}
            </div>
          ))}
        </div>
      </div>

      {edit && <TenderModal value={edit} onClose={() => setEdit(null)} onDone={() => { setEdit(null); load(); }} />}

      {newDoc && (
        <Modal title="افزودن مدرک به پاکات" onClose={() => setNewDoc(null)}
          footer={<>
            <button className="btn btn-ghost" onClick={() => setNewDoc(null)}>انصراف</button>
            <button className="btn btn-primary" disabled={busy || !newDoc.title.trim()} onClick={addDoc}>افزودن</button>
          </>}>
          <Field label="پاکت">
            <select className="input" value={newDoc.envelope} onChange={e => setNewDoc(d => ({ ...d, envelope: e.target.value }))}>
              {Object.entries(ENVELOPE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </Field>
          <Field label="عنوان مدرک">
            <input className="input" autoFocus value={newDoc.title}
              onChange={e => setNewDoc(d => ({ ...d, title: e.target.value }))} />
          </Field>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
            <input type="checkbox" checked={newDoc.required}
              onChange={e => setNewDoc(d => ({ ...d, required: e.target.checked }))} />
            این مدرک الزامی است
          </label>
        </Modal>
      )}

      {newRival && (
        <Modal title="ثبت رقیب" onClose={() => setNewRival(null)}
          footer={<>
            <button className="btn btn-ghost" onClick={() => setNewRival(null)}>انصراف</button>
            <button className="btn btn-primary" disabled={busy || !newRival.name.trim()} onClick={addRival}>ثبت</button>
          </>}>
          <Field label="نام شرکت رقیب">
            <input className="input" autoFocus value={newRival.name}
              onChange={e => setNewRival(c => ({ ...c, name: e.target.value }))} />
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 10 }}>
            <Field label="مبلغ پیشنهادی (ریال)">
              <input className="input" type="number" min="0" value={newRival.amount}
                onChange={e => setNewRival(c => ({ ...c, amount: Number(e.target.value) }))} />
            </Field>
            <Field label="رتبه">
              <input className="input" type="number" min="0" value={newRival.rank}
                onChange={e => setNewRival(c => ({ ...c, rank: Number(e.target.value) }))} />
            </Field>
          </div>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
            <input type="checkbox" checked={!!newRival.is_winner}
              onChange={e => setNewRival(c => ({ ...c, is_winner: e.target.checked }))} />
            این شرکت برندهٔ مناقصه شد
          </label>
        </Modal>
      )}
    </>
  );
}

// ---------------------------------------------------------------- گزارش مناقصات
export function TenderReport() {
  const { toast } = useStore();
  const [rep, setRep] = useState(null);
  const [filters, setFilters] = useState({ from: '', to: '' });

  const load = async () => {
    try {
      const qs = new URLSearchParams(Object.entries(filters).filter(([, v]) => v)).toString();
      setRep(await api(`/crm/tender-reports${qs ? '?' + qs : ''}`));
    } catch (e) { toast(e.message, 'error'); }
  };
  useEffect(() => { load(); }, []);
  if (!rep) return <div className="card"><div className="empty">در حال بارگذاری…</div></div>;

  const s = rep.summary;
  const monthly = rep.monthly.map(m => {
    const [y, mm] = String(m.month || '').split('-');
    return { ...m, label: `${mm}/${String(y).slice(2)}` };
  });

  return (
    <>
      <div className="card card-pad" style={{ marginBottom: 16, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'end' }}>
        <div>
          <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--text-2)', marginBottom: 6 }}>از تاریخ</label>
          <input className="input" type="date" value={filters.from} onChange={e => setFilters(f => ({ ...f, from: e.target.value }))} />
        </div>
        <div>
          <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--text-2)', marginBottom: 6 }}>تا تاریخ</label>
          <input className="input" type="date" value={filters.to} onChange={e => setFilters(f => ({ ...f, to: e.target.value }))} />
        </div>
        <button className="btn btn-primary" onClick={load}><BarChart3 size={16} /> اعمال فیلتر</button>
        {rep.scoped && <span style={{ fontSize: 12, color: 'var(--text-3)' }}>فقط مناقصات خودتان</span>}
      </div>

      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <Stat label="نرخ برد در مناقصه" value={rateText(s.success_rate)} tone="good"
          sub={`${fa(s.won_count)} برد از ${fa(s.won_count + s.lost_count)} مناقصهٔ بازگشایی‌شده`} />
        <Stat label="مبلغ قراردادهای برنده" value={money(s.won_amount)} tone="a" />
        <Stat label="مناقصات باز" value={fa(s.open_count)} sub={money(s.open_amount)} />
        <Stat label="فرصت از‌دست‌رفته" value={money(s.lost_amount)} tone="b" sub={`${fa(s.lost_count)} مناقصه`} />
        <Stat label="انصراف داده‌ایم" value={fa(s.withdrawn_count)} />
      </div>

      {s.avg_price_gap_pct !== null && (
        <div className="card card-pad" style={{ marginBottom: 16 }}>
          <b style={{ display: 'block', marginBottom: 10 }}>میانگین فاصلهٔ قیمتی ما با برنده</b>
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'center' }}>
            <Gauge value={Math.min(50, Math.abs(s.avg_price_gap_pct))} max={50}
              invert={s.avg_price_gap_pct > 0}
              label={`${fa(s.avg_price_gap_pct, 1)}٪`}
              caption={s.avg_price_gap_pct > 0
                ? 'به‌طور میانگین از برنده گران‌تر بوده‌ایم'
                : 'به‌طور میانگین از برنده ارزان‌تر بوده‌ایم'}
              maxLabel="۵۰٪" size={200} />
            <p style={{ fontSize: 12.8, color: 'var(--text-2)', maxWidth: 420, lineHeight: 2, margin: 0 }}>
              این عدد می‌گوید در مناقصاتی که باخته‌ایم، پیشنهاد ما چقدر از برنده فاصله داشته است.
              فاصلهٔ کوچک یعنی با اصلاحِ جزئیِ قیمت یا شرایط، قابلِ برد بوده‌اند؛
              فاصلهٔ بزرگ یعنی مشکل ساختاری در بهای تمام‌شده داریم، نه در تخفیف.
            </p>
          </div>
        </div>
      )}

      <div className="grid-2">
        <div className="card card-pad" style={{ marginBottom: 18 }}>
          <b style={{ display: 'block', marginBottom: 4 }}>وضعیت مناقصات</b>
          <p style={{ fontSize: 12, color: 'var(--text-3)', margin: '0 0 12px' }}>
            مناقصات در هر مرحله از چرخهٔ عمر
          </p>
          <RankedBars sequential rows={rep.by_status.map(x => ({ label: x.label, value: x.count, amount: x.amount }))}
            format={(v, r) => `${fa(v)} مناقصه${r.amount > 0 ? ` · ${money(r.amount)}` : ''}`} />
        </div>
        <div className="card card-pad" style={{ marginBottom: 18 }}>
          <b style={{ display: 'block', marginBottom: 4 }}>روند ماهانه</b>
          <p style={{ fontSize: 12, color: 'var(--text-3)', margin: '0 0 12px' }}>برد و باخت مناقصات در هر ماه</p>
          <GroupedBars rows={monthly} series={[
            { key: 'won_count', label: 'برنده', color: 'var(--chart-a)' },
            { key: 'lost_count', label: 'بازنده', color: 'var(--chart-b)' },
          ]} />
        </div>
      </div>

      <div className="grid-2">
        <div className="card card-pad" style={{ marginBottom: 18 }}>
          <b style={{ display: 'block', marginBottom: 4 }}>رقبای اصلی</b>
          <p style={{ fontSize: 12, color: 'var(--text-3)', margin: '0 0 12px' }}>
            چه کسانی بیشتر از همه مناقصات را از ما گرفته‌اند؟
          </p>
          <RankedBars rows={rep.rivals.map(x => ({ label: x.name, value: x.wins, times: x.times, avg: x.avg_amount }))}
            color="var(--chart-b)"
            format={(v, r) => `${fa(v)} برد از ${fa(r.times)} رویارویی`}
            emptyText="هنوز رقیبی ثبت نشده — بعد از بازگشایی ثبتشان کنید" />
        </div>
        <div className="card card-pad" style={{ marginBottom: 18 }}>
          <b style={{ display: 'block', marginBottom: 4 }}>دلایل باخت مناقصه</b>
          <p style={{ fontSize: 12, color: 'var(--text-3)', margin: '0 0 12px' }}>
            قیمت؟ مدارک؟ صلاحیت فنی؟ — بدون این عدد نمی‌شود بهبود داد.
          </p>
          <RankedBars rows={rep.lost_reasons.map(x => ({ label: x.reason, value: x.count }))}
            color="var(--chart-b)" format={(v) => `${fa(v)} مناقصه`}
            emptyText="مناقصهٔ باخته‌ای ثبت نشده است" />
        </div>
      </div>

      <div className="grid-2">
        <div className="card card-pad">
          <b style={{ display: 'block', marginBottom: 4 }}>اثربخشی سامانه‌ها</b>
          <p style={{ fontSize: 12, color: 'var(--text-3)', margin: '0 0 12px' }}>
            از کدام سامانه بیشتر برنده می‌شویم؟
          </p>
          <RankedBars rows={rep.by_portal.filter(x => x.success_rate !== null)
            .map(x => ({ label: PORTAL[x.portal] || x.portal, value: x.success_rate, total: x.total, won: x.won_count }))}
            max={100}
            format={(v, r) => `${rateText(v)} — ${fa(r.won)} از ${fa(r.total)}`}
            emptyText="برای محاسبه، حداقل یک مناقصهٔ بازگشایی‌شده لازم است" />
        </div>

        {!rep.scoped && (
          <div className="card">
            <div className="card-pad" style={{ paddingBottom: 0 }}>
              <b>عملکرد کارشناسان در مناقصات</b>
            </div>
            <table className="table">
              <thead><tr><th>کارشناس</th><th>کل</th><th>برنده</th><th>بازنده</th><th>نرخ برد</th><th>مبلغ برنده</th></tr></thead>
              <tbody>
                {rep.by_owner.map((o, i) => (
                  <tr key={i}>
                    <td>{o.owner_name}</td><td>{fa(o.total)}</td>
                    <td style={{ color: 'var(--chart-a)', fontWeight: 600 }}>{fa(o.won_count)}</td>
                    <td style={{ color: 'var(--chart-b)', fontWeight: 600 }}>{fa(o.lost_count)}</td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                        <MiniBar value={o.success_rate ?? 0} max={100} width={60} />
                        <b>{rateText(o.success_rate)}</b>
                      </div>
                    </td>
                    <td style={{ fontSize: 12.5 }}>{money(o.won_amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
