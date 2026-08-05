// ============================================================================
//  پشتیبانی مشتریان، خدمات پس از فروش، کیفیت محصول، بازخورد و پیگیری هوشمند
// ============================================================================
import React, { useEffect, useState } from 'react';
import {
  Plus, Search, Headphones, ArrowRight, Pencil, Trash2, Send, MessageSquare,
  Star, AlertTriangle, Zap, BarChart3, Check, Lock,
} from 'lucide-react';
import { api } from '../../api.js';
import { useStore } from '../../store.jsx';
import { fmtDate, fmtDateTime, fa } from '../../utils.js';
import { Modal, Field, UserPicker } from '../../components/common.jsx';
import { AttachmentPicker, AttachmentList } from '../../components/Attachments.jsx';
import { RankedBars, GroupedBars, Stat } from '../../components/Charts.jsx';
import Gauge, { MiniBar } from '../../components/Gauge.jsx';

const money = (n) => `${Number(n || 0).toLocaleString('fa-IR')} ریال`;

export const TICKET_STATUS = {
  new: ['جدید', 'badge-primary'],
  in_progress: ['در حال رسیدگی', 'badge-sky'],
  waiting_customer: ['در انتظار مشتری', 'badge-amber'],
  resolved: ['حل شد', 'badge-green'],
  closed: ['بسته', 'badge-gray'],
};
const TICKET_TYPE = {
  support: 'پشتیبانی فنی', warranty: 'گارانتی', complaint: 'شکایت',
  quality: 'ایراد کیفی', request: 'درخواست', installation: 'نصب و راه‌اندازی',
};
const SEVERITY = {
  low: ['کم', 'badge-gray'], normal: ['عادی', 'badge-sky'],
  high: ['زیاد', 'badge-amber'], critical: ['بحرانی', 'badge-red'],
};
const CHANNEL = { phone: 'تلفن', email: 'ایمیل', sms: 'پیامک', visit: 'حضوری', portal: 'سامانه' };
const FEEDBACK_KIND = {
  csat: 'رضایت از خدمت', nps: 'احتمال معرفی به دیگران',
  complaint: 'شکایت', suggestion: 'پیشنهاد', praise: 'تقدیر',
};

export default function Support({ canManage }) {
  const [tab, setTab] = useState('tickets');
  return (
    <>
      <div className="tabs" style={{ marginBottom: 16 }}>
        <button className={`tab ${tab === 'tickets' ? 'active' : ''}`} onClick={() => setTab('tickets')}>تیکت‌ها</button>
        <button className={`tab ${tab === 'smart' ? 'active' : ''}`} onClick={() => setTab('smart')}>پیگیری هوشمند</button>
        <button className={`tab ${tab === 'feedback' ? 'active' : ''}`} onClick={() => setTab('feedback')}>بازخورد مشتریان</button>
        <button className={`tab ${tab === 'sms' ? 'active' : ''}`} onClick={() => setTab('sms')}>پیامک</button>
        <button className={`tab ${tab === 'reports' ? 'active' : ''}`} onClick={() => setTab('reports')}>گزارش کیفیت</button>
      </div>
      {tab === 'tickets' && <Tickets canManage={canManage} />}
      {tab === 'smart' && <SmartFollowUps />}
      {tab === 'feedback' && <Feedback canManage={canManage} />}
      {tab === 'sms' && <Sms canManage={canManage} />}
      {tab === 'reports' && <SupportReport />}
    </>
  );
}

// ---------------------------------------------------------------- تیکت‌ها
function Tickets({ canManage }) {
  const { toast } = useStore();
  const [rows, setRows] = useState([]);
  const [openId, setOpenId] = useState(null);
  const [edit, setEdit] = useState(null);
  const [filters, setFilters] = useState({ q: '', status: '', type: '', open_only: '1' });

  const load = async () => {
    try {
      const qs = new URLSearchParams(Object.entries(filters).filter(([, v]) => v)).toString();
      setRows((await api(`/crm/tickets${qs ? '?' + qs : ''}`)).tickets);
    } catch (e) { toast(e.message, 'error'); }
  };
  useEffect(() => { load(); }, []);

  if (openId) return <TicketDetail id={openId} canManage={canManage} onBack={() => { setOpenId(null); load(); }} />;

  const overdue = rows.filter(t => t.is_overdue).length;
  const critical = rows.filter(t => t.is_open && t.severity === 'critical').length;

  return (
    <>
      {(overdue > 0 || critical > 0) && (
        <div className="card card-pad" style={{ marginBottom: 16, borderColor: 'var(--red)', background: 'var(--red-soft)' }}>
          <b style={{ fontSize: 13.5 }}>
            <AlertTriangle size={15} style={{ verticalAlign: '-3px', marginLeft: 5 }} />
            {critical > 0 && `${fa(critical)} تیکت بحرانی باز`}
            {critical > 0 && overdue > 0 && ' · '}
            {overdue > 0 && `${fa(overdue)} تیکت از مهلت گذشته`}
          </b>
        </div>
      )}

      <div className="card card-pad" style={{ marginBottom: 16, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'end' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 190 }}>
          <Search size={15} style={{ position: 'absolute', right: 11, top: 11, color: 'var(--text-3)' }} />
          <input className="input" style={{ paddingRight: 34 }} placeholder="جستجوی موضوع یا مشتری…"
            value={filters.q} onChange={e => setFilters(f => ({ ...f, q: e.target.value }))}
            onKeyDown={e => e.key === 'Enter' && load()} />
        </div>
        <select className="input" style={{ width: 150 }} value={filters.status}
          onChange={e => setFilters(f => ({ ...f, status: e.target.value }))}>
          <option value="">همهٔ وضعیت‌ها</option>
          {Object.entries(TICKET_STATUS).map(([k, v]) => <option key={k} value={k}>{v[0]}</option>)}
        </select>
        <select className="input" style={{ width: 150 }} value={filters.type}
          onChange={e => setFilters(f => ({ ...f, type: e.target.value }))}>
          <option value="">همهٔ انواع</option>
          {Object.entries(TICKET_TYPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12.8, paddingBottom: 9 }}>
          <input type="checkbox" checked={filters.open_only === '1'}
            onChange={e => setFilters(f => ({ ...f, open_only: e.target.checked ? '1' : '' }))} />
          فقط باز
        </label>
        <button className="btn btn-ghost" onClick={load}><Search size={16} /> جستجو</button>
        <button className="btn btn-primary" onClick={() => setEdit({
          subject: '', type: 'support', severity: 'normal', channel: 'phone', attachments: [],
        })}><Plus size={16} /> تیکت جدید</button>
      </div>

      <div className="card">
        {rows.length === 0 ? (
          <div className="empty"><Headphones size={40} /><div>تیکتی یافت نشد</div></div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>موضوع</th><th>مشتری</th><th>نوع</th><th>اولویت</th><th>وضعیت</th>
                <th>محصول</th><th>مسئول</th><th>عمر</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(t => {
                const [sl, sc] = TICKET_STATUS[t.status] || TICKET_STATUS.new;
                const [vl, vc] = SEVERITY[t.severity] || SEVERITY.normal;
                return (
                  <tr key={t.id}>
                    <td>
                      <a href="#" onClick={e => { e.preventDefault(); setOpenId(t.id); }}
                        style={{ fontWeight: 600, color: 'var(--primary)' }}>{t.subject}</a>
                      {!!t.is_quality_issue && <span className="badge badge-red" style={{ marginRight: 6 }}>ایراد کیفی</span>}
                      {t.is_overdue && <span className="badge badge-red" style={{ marginRight: 6 }}>از مهلت گذشته</span>}
                    </td>
                    <td style={{ fontSize: 12.5 }}>{t.customer_name || '—'}</td>
                    <td style={{ fontSize: 12.3 }}>{TICKET_TYPE[t.type] || t.type}</td>
                    <td><span className={`badge ${vc}`}>{vl}</span></td>
                    <td><span className={`badge ${sc}`}>{sl}</span></td>
                    <td style={{ fontSize: 12.3 }}>{t.product_name || '—'}</td>
                    <td style={{ fontSize: 12.3 }}>{t.assignee_name || '—'}</td>
                    <td style={{ fontSize: 12.3, color: 'var(--text-3)' }}>
                      {t.is_open ? `${fa(Math.round(t.age_hours))} ساعت` : (t.resolve_hours !== null ? `${fa(t.resolve_hours, 1)} ساعت` : '—')}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {edit && <TicketModal value={edit} onClose={() => setEdit(null)} onDone={() => { setEdit(null); load(); }} />}
    </>
  );
}

function TicketModal({ value, onClose, onDone }) {
  const { toast } = useStore();
  const [v, setV] = useState(value);
  const [customers, setCustomers] = useState([]);
  const [products, setProducts] = useState([]);
  const [busy, setBusy] = useState(false);
  const set = (patch) => setV(x => ({ ...x, ...patch }));

  useEffect(() => {
    api('/crm/customers').then(r => setCustomers(r.customers)).catch(() => {});
    api('/crm/products?active=1').then(r => setProducts(r.products)).catch(() => {});
  }, []);

  const save = async () => {
    if (!String(v.subject || '').trim()) return toast('موضوع تیکت الزامی است', 'error');
    if (!v.customer_id) return toast('مشتری را انتخاب کنید', 'error');
    setBusy(true);
    try {
      if (v.id) await api(`/crm/tickets/${v.id}`, { method: 'PUT', body: v });
      else await api('/crm/tickets', { method: 'POST', body: v });
      onDone(); toast('ذخیره شد');
    } catch (e) { toast(e.message, 'error'); }
    setBusy(false);
  };

  return (
    <Modal title={v.id ? `ویرایش تیکت «${value.subject}»` : 'ثبت تیکت پشتیبانی'} onClose={onClose} wide
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>انصراف</button>
        <button className="btn btn-primary" disabled={busy} onClick={save}>ذخیره</button>
      </>}>
      <Field label="موضوع *">
        <input className="input" autoFocus value={v.subject || ''}
          placeholder="مثلاً: افت کیفیت عایق در حلقهٔ تحویلی" onChange={e => set({ subject: e.target.value })} />
      </Field>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <Field label="مشتری *">
          <select className="input" value={v.customer_id || ''}
            onChange={e => set({ customer_id: e.target.value ? Number(e.target.value) : null })}>
            <option value="">— انتخاب مشتری —</option>
            {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="محصول مرتبط">
          <select className="input" value={v.product_id || ''}
            onChange={e => set({ product_id: e.target.value ? Number(e.target.value) : null })}>
            <option value="">— بدون محصول —</option>
            {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
      </div>
      <Field label="شرح مشکل / درخواست">
        <textarea className="input" style={{ minHeight: 90 }} value={v.body || ''}
          onChange={e => set({ body: e.target.value })} />
      </Field>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
        <Field label="نوع">
          <select className="input" value={v.type || 'support'} onChange={e => set({ type: e.target.value })}>
            {Object.entries(TICKET_TYPE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </Field>
        <Field label="اولویت">
          <select className="input" value={v.severity || 'normal'} onChange={e => set({ severity: e.target.value })}>
            {Object.entries(SEVERITY).map(([k, l]) => <option key={k} value={k}>{l[0]}</option>)}
          </select>
        </Field>
        <Field label="کانال دریافت">
          <select className="input" value={v.channel || 'phone'} onChange={e => set({ channel: e.target.value })}>
            {Object.entries(CHANNEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </Field>
        {v.id && (
          <Field label="وضعیت">
            <select className="input" value={v.status || 'new'} onChange={e => set({ status: e.target.value })}>
              {Object.entries(TICKET_STATUS).map(([k, l]) => <option key={k} value={k}>{l[0]}</option>)}
            </select>
          </Field>
        )}
        <Field label="مهلت رسیدگی">
          <input className="input" type="date" value={(v.due_at || '').slice(0, 10)}
            onChange={e => set({ due_at: e.target.value })} />
        </Field>
        <Field label="هزینهٔ رسیدگی (ریال)">
          <input className="input" type="number" min="0" value={v.cost ?? 0}
            onChange={e => set({ cost: Number(e.target.value) })} />
        </Field>
      </div>
      <Field label="مسئول رسیدگی">
        <UserPicker value={v.assignee_id} onChange={id => set({ assignee_id: id })} />
      </Field>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, marginBottom: 12 }}>
        <input type="checkbox" checked={!!v.is_quality_issue}
          onChange={e => set({ is_quality_issue: e.target.checked })} />
        این مورد ایرادِ کیفیِ محصول است (در گزارش کیفیت شمرده می‌شود)
      </label>
      {v.is_quality_issue && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 10 }}>
          <Field label="شماره بچ / سری ساخت" hint="برای ردیابی مشکل در تولید">
            <input className="input" value={v.batch_no || ''} onChange={e => set({ batch_no: e.target.value })} />
          </Field>
          <Field label="ریشهٔ مشکل" hint="بعد از بررسی پر کنید — پایهٔ گزارش کیفیت">
            <input className="input" value={v.root_cause || ''}
              placeholder="مثلاً: نوسان دمای خط اکستروژن" onChange={e => set({ root_cause: e.target.value })} />
          </Field>
        </div>
      )}
      {v.id && (
        <Field label="اقدام انجام‌شده / نتیجه">
          <textarea className="input" value={v.resolution || ''} onChange={e => set({ resolution: e.target.value })} />
        </Field>
      )}
      <Field label="پیوست">
        <AttachmentPicker value={v.attachments || []} onChange={x => set({ attachments: x })} />
      </Field>
    </Modal>
  );
}

function TicketDetail({ id, canManage, onBack }) {
  const { toast } = useStore();
  const [t, setT] = useState(null);
  const [edit, setEdit] = useState(null);
  const [msg, setMsg] = useState({ body: '', is_internal: false, channel: 'note' });
  const [smsBody, setSmsBody] = useState('');
  const [fb, setFb] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try { setT((await api(`/crm/tickets/${id}`)).ticket); }
    catch (e) { toast(e.message, 'error'); onBack(); }
  };
  useEffect(() => { load(); }, [id]);
  if (!t) return <div className="card"><div className="empty">در حال بارگذاری…</div></div>;

  const [sl, sc] = TICKET_STATUS[t.status] || TICKET_STATUS.new;
  const [vl, vc] = SEVERITY[t.severity] || SEVERITY.normal;
  const phone = t.contact_mobile || t.customer_phone;

  const send = async () => {
    if (!msg.body.trim()) return;
    setBusy(true);
    try { await api(`/crm/tickets/${t.id}/messages`, { method: 'POST', body: msg });
      setMsg({ body: '', is_internal: false, channel: 'note' }); await load(); }
    catch (e) { toast(e.message, 'error'); }
    setBusy(false);
  };

  const sendSms = async () => {
    if (!smsBody.trim()) return;
    setBusy(true);
    try {
      const r = await api('/crm/sms', { method: 'POST', body: {
        body: smsBody, phone, customer_id: t.customer_id, contact_id: t.contact_id, ticket_id: t.id,
      } });
      setSmsBody('');
      await load();
      toast(r.simulated ? 'پیامک ثبت شد (حالت شبیه‌سازی — درگاه تنظیم نشده)' : 'پیامک ارسال شد');
    } catch (e) { toast(e.message, 'error'); }
    setBusy(false);
  };

  const saveFb = async () => {
    setBusy(true);
    try {
      await api('/crm/feedback', { method: 'POST', body: { ...fb, customer_id: t.customer_id, ticket_id: t.id, product_id: t.product_id } });
      setFb(null); await load(); toast('بازخورد ثبت شد');
    } catch (e) { toast(e.message, 'error'); }
    setBusy(false);
  };

  return (
    <>
      <div className="page-head">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button className="icon-btn" onClick={onBack}><ArrowRight size={18} /></button>
          <div>
            <h2>{t.subject}</h2>
            <div style={{ fontSize: 12.8, color: 'var(--text-2)' }}>
              {t.customer_name}{t.product_name ? ` · ${t.product_name}` : ''} · {TICKET_TYPE[t.type] || t.type}
              {' · '}دریافت از {CHANNEL[t.channel] || t.channel}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span className={`badge ${vc}`}>{vl}</span>
          <span className={`badge ${sc}`} style={{ fontSize: 13 }}>{sl}</span>
          {!!t.is_quality_issue && <span className="badge badge-red">ایراد کیفی</span>}
          <button className="btn btn-ghost btn-sm" onClick={() => setEdit({ ...t })}><Pencil size={14} /> ویرایش</button>
          <button className="btn btn-ghost btn-sm" onClick={() => setFb({ kind: 'csat', csat: 5, comment: '', source: 'phone' })}>
            <Star size={14} /> ثبت رضایت
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <Stat label="عمر تیکت" value={`${fa(Math.round(t.age_hours))} ساعت`}
          tone={t.is_overdue ? 'bad' : undefined} sub={t.due_at ? `مهلت: ${fmtDate(t.due_at)}` : 'بدون مهلت'} />
        <Stat label="زمان اولین پاسخ" value={t.response_hours === null ? 'هنوز پاسخی نداده‌ایم' : `${fa(t.response_hours, 1)} ساعت`}
          tone={t.response_hours === null ? 'bad' : 'good'} />
        <Stat label="زمان رفع" value={t.resolve_hours === null ? '—' : `${fa(t.resolve_hours, 1)} ساعت`} />
        {t.cost > 0 && <Stat label="هزینهٔ رسیدگی" value={money(t.cost)} tone="b" />}
      </div>

      <div className="grid-2">
        <div>
          <div className="card card-pad" style={{ marginBottom: 18 }}>
            <b style={{ display: 'block', marginBottom: 10 }}>شرح و نتیجه</b>
            {t.body && <p style={{ fontSize: 13, whiteSpace: 'pre-wrap', margin: '0 0 10px' }}>{t.body}</p>}
            {[['اقدام انجام‌شده', t.resolution], ['ریشهٔ مشکل', t.root_cause],
              ['شماره بچ', t.batch_no], ['مسئول', t.assignee_name],
              ['ثبت‌کننده', t.opened_by_name],
              ['مخاطب', [t.contact_first, t.contact_last].filter(Boolean).join(' ')],
              ['تلفن', phone]].filter(([, v]) => v).map(([k, v]) => (
              <div key={k} style={{ display: 'flex', gap: 10, padding: '6px 0', borderBottom: '1px solid var(--border-soft)' }}>
                <span style={{ color: 'var(--text-2)', fontSize: 12.8, minWidth: 120 }}>{k}:</span>
                <span style={{ fontWeight: 600, fontSize: 12.8, whiteSpace: 'pre-wrap' }}>{v}</span>
              </div>
            ))}
            {t.attachments?.length > 0 && (
              <div style={{ marginTop: 12 }}><AttachmentList ids={t.attachments} thumb={84} title="پیوست‌ها" /></div>
            )}
          </div>

          {/* پیامک به مشتری */}
          <div className="card card-pad">
            <b style={{ display: 'block', marginBottom: 4 }}>
              <Send size={15} style={{ verticalAlign: '-2px', marginLeft: 5 }} /> پیامک به مشتری
            </b>
            <p style={{ fontSize: 12, color: 'var(--text-3)', margin: '0 0 10px' }}>
              {phone ? `به شمارهٔ ${phone}` : 'برای این مشتری شمارهٔ موبایلی ثبت نشده است'}
            </p>
            <textarea className="input" style={{ minHeight: 70 }} value={smsBody} disabled={!phone}
              placeholder="مثلاً: مشکل شما بررسی و برطرف شد. از صبر شما سپاسگزاریم."
              onChange={e => setSmsBody(e.target.value)} />
            <button className="btn btn-primary btn-sm" style={{ marginTop: 8 }}
              disabled={busy || !phone || !smsBody.trim()} onClick={sendSms}>
              <Send size={14} /> ارسال پیامک
            </button>
            {t.sms?.length > 0 && (
              <div style={{ marginTop: 12 }}>
                {t.sms.map(s => (
                  <div key={s.id} style={{ fontSize: 12.3, padding: '6px 0', borderBottom: '1px solid var(--border-soft)' }}>
                    <span className={`badge ${s.status === 'sent' ? 'badge-green' : s.status === 'failed' ? 'badge-red' : 'badge-gray'}`}>
                      {s.status === 'sent' ? 'ارسال شد' : s.status === 'failed' ? 'ناموفق' : s.status === 'simulated' ? 'شبیه‌سازی' : 'در صف'}
                    </span>
                    <span style={{ marginRight: 8 }}>{s.body}</span>
                    <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{s.phone} · {fmtDateTime(s.created_at)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="card card-pad">
          <b style={{ display: 'block', marginBottom: 10 }}>
            <MessageSquare size={15} style={{ verticalAlign: '-2px', marginLeft: 5 }} /> گفتگو و یادداشت‌ها
          </b>
          <div style={{ marginBottom: 14 }}>
            <textarea className="input" style={{ minHeight: 70 }} value={msg.body}
              placeholder="یادداشت یا خلاصهٔ گفتگو با مشتری…"
              onChange={e => setMsg(m => ({ ...m, body: e.target.value }))} />
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
              <select className="input" style={{ width: 130 }} value={msg.channel}
                onChange={e => setMsg(m => ({ ...m, channel: e.target.value }))}>
                <option value="note">یادداشت</option>
                <option value="phone">تماس تلفنی</option>
                <option value="email">ایمیل</option>
                <option value="sms">پیامک</option>
              </select>
              <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12.5 }}>
                <input type="checkbox" checked={msg.is_internal}
                  onChange={e => setMsg(m => ({ ...m, is_internal: e.target.checked }))} />
                <Lock size={12} /> یادداشت داخلی
              </label>
              <button className="btn btn-primary btn-sm" disabled={busy || !msg.body.trim()} onClick={send}>ثبت</button>
            </div>
            <p style={{ fontSize: 11.5, color: 'var(--text-3)', marginTop: 6 }}>
              اولین پیامِ غیرداخلی، «زمان اولین پاسخ» را ثبت می‌کند.
            </p>
          </div>
          {t.messages.length === 0 ? (
            <div style={{ fontSize: 12.8, color: 'var(--text-3)' }}>هنوز پیامی ثبت نشده است</div>
          ) : t.messages.map(m => (
            <div key={m.id} style={{
              padding: '9px 0', borderBottom: '1px solid var(--border-soft)',
              opacity: m.is_internal ? 0.85 : 1,
            }}>
              <div style={{ display: 'flex', gap: 7, alignItems: 'center', flexWrap: 'wrap' }}>
                {!!m.is_internal && <span className="badge badge-gray"><Lock size={10} /> داخلی</span>}
                <span className="badge badge-sky">{CHANNEL[m.channel] || 'یادداشت'}</span>
                <b style={{ fontSize: 12.8 }}>{m.user_name}</b>
                <span style={{ fontSize: 11.3, color: 'var(--text-3)', marginInlineStart: 'auto' }}>{fmtDateTime(m.created_at)}</span>
              </div>
              <div style={{ fontSize: 12.8, whiteSpace: 'pre-wrap', marginTop: 4 }}>{m.body}</div>
            </div>
          ))}

          {t.feedback?.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <b style={{ display: 'block', marginBottom: 8, fontSize: 13 }}>بازخورد ثبت‌شده</b>
              {t.feedback.map(f => (
                <div key={f.id} style={{ fontSize: 12.5, padding: '6px 0' }}>
                  <span className="badge badge-sky">{FEEDBACK_KIND[f.kind] || f.kind}</span>
                  {f.csat !== null && <b style={{ marginRight: 8 }}>{fa(f.csat)} از ۵</b>}
                  {f.score !== null && <b style={{ marginRight: 8 }}>NPS {fa(f.score)}</b>}
                  {f.comment && <div style={{ color: 'var(--text-2)' }}>{f.comment}</div>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {edit && <TicketModal value={edit} onClose={() => setEdit(null)} onDone={() => { setEdit(null); load(); }} />}
      {fb && <FeedbackModal value={fb} setValue={setFb} busy={busy} onSave={saveFb} />}
    </>
  );
}

// ---------------------------------------------------------------- پیگیری هوشمند
function SmartFollowUps() {
  const { toast } = useStore();
  const [data, setData] = useState(null);
  const [sms, setSms] = useState(null);

  const load = async () => {
    try { setData(await api('/crm/smart-followups')); }
    catch (e) { toast(e.message, 'error'); }
  };
  useEffect(() => { load(); }, []);
  if (!data) return <div className="card"><div className="empty">در حال بارگذاری…</div></div>;

  const high = data.customers.filter(c => c.priority === 'high');

  return (
    <>
      <div className="card card-pad" style={{ marginBottom: 16 }}>
        <b style={{ display: 'block' }}>
          <Zap size={16} style={{ verticalAlign: '-3px', marginLeft: 5 }} />
          مشتریانی که همین امروز باید سراغشان بروید
        </b>
        <p style={{ fontSize: 12.5, color: 'var(--text-2)', margin: '5px 0 0', maxWidth: 680, lineHeight: 1.9 }}>
          سامانه با ترکیبِ چند نشانه (پیگیری عقب‌افتاده، تیکت باز، بازخورد منفی، مدت بی‌ارتباطی،
          معاملهٔ خواب‌رفته و ارزش مشتری) اولویت‌بندی می‌کند. مشتریِ بی‌ارتباط بعد از
          {' '}{fa(data.stale_days)} روز «نیازمند پیگیری» شمرده می‌شود.
          همین فهرست در بستهٔ «دستیار هوشمند» هم می‌رود تا مدل زبانی بتواند اولویت‌ها را
          بازچینی کند و متنِ پیام پیشنهاد بدهد.
        </p>
      </div>

      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <Stat label="اولویت بالا" value={fa(high.length)} tone={high.length ? 'bad' : 'good'} />
        <Stat label="کل نیازمند پیگیری" value={fa(data.customers.length)} />
      </div>

      <div className="card">
        {data.customers.length === 0 ? (
          <div className="empty"><Check size={40} /><div>همه‌چیز به‌روز است — پیگیریِ عقب‌افتاده‌ای ندارید</div></div>
        ) : (
          <table className="table">
            <thead>
              <tr><th>مشتری</th><th>اولویت</th><th>چرا؟</th><th>پیشنهاد اقدام</th><th>آخرین تماس</th><th></th></tr>
            </thead>
            <tbody>
              {data.customers.map(c => (
                <tr key={c.id}>
                  <td>
                    <b>{c.name}</b>
                    <div style={{ fontSize: 11.5, color: 'var(--text-3)' }}>
                      {[c.city, c.owner_name].filter(Boolean).join(' · ')}
                    </div>
                  </td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                      <MiniBar value={Math.min(100, c.priority_score)} max={100} width={48} />
                      <span className={`badge ${c.priority === 'high' ? 'badge-red' : c.priority === 'medium' ? 'badge-amber' : 'badge-gray'}`}>
                        {c.priority === 'high' ? 'بالا' : c.priority === 'medium' ? 'متوسط' : 'کم'}
                      </span>
                    </div>
                  </td>
                  <td style={{ fontSize: 12.3 }}>
                    {c.reasons.map(r => <div key={r} style={{ color: 'var(--text-2)' }}>• {r}</div>)}
                  </td>
                  <td style={{ fontSize: 12.5, fontWeight: 600 }}>{c.suggested_action}</td>
                  <td style={{ fontSize: 12.3, color: 'var(--text-3)' }}>
                    {c.days_since_contact === null ? 'هرگز' : `${fa(c.days_since_contact)} روز پیش`}
                  </td>
                  <td>
                    {c.phone && (
                      <button className="btn btn-ghost btn-sm"
                        onClick={() => setSms({ customer: c, body: '' })}><Send size={13} /> پیامک</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {sms && <QuickSms target={sms} onClose={() => setSms(null)} onDone={() => { setSms(null); load(); }} />}
    </>
  );
}

function QuickSms({ target, onClose, onDone }) {
  const { toast } = useStore();
  const [body, setBody] = useState(target.body || '');
  const [templates, setTemplates] = useState([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => { api('/crm/sms').then(r => setTemplates(r.templates)).catch(() => {}); }, []);

  const send = async () => {
    setBusy(true);
    try {
      const r = await api('/crm/sms', { method: 'POST', body: {
        body, phone: target.customer.phone, customer_id: target.customer.id,
        vars: { نام: target.customer.name, شرکت: target.customer.name },
      } });
      const failed = r.results.find(x => !x.ok);
      if (failed) toast(failed.error || 'ارسال ناموفق', 'error');
      else toast(r.simulated ? 'پیامک ثبت شد (شبیه‌سازی — درگاه تنظیم نشده)' : 'پیامک ارسال شد');
      onDone();
    } catch (e) { toast(e.message, 'error'); }
    setBusy(false);
  };

  return (
    <Modal title={`پیامک به ${target.customer.name}`} onClose={onClose}
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>انصراف</button>
        <button className="btn btn-primary" disabled={busy || !body.trim()} onClick={send}>ارسال</button>
      </>}>
      <p style={{ fontSize: 12.5, color: 'var(--text-2)', marginTop: 0 }}>
        شماره: <b style={{ direction: 'ltr', display: 'inline-block' }}>{target.customer.phone}</b>
      </p>
      {templates.length > 0 && (
        <Field label="قالب آماده">
          <select className="input" onChange={e => e.target.value && setBody(e.target.value)}>
            <option value="">— انتخاب قالب —</option>
            {templates.map(t => <option key={t.id} value={t.body}>{t.name}</option>)}
          </select>
        </Field>
      )}
      <Field label="متن پیامک" hint="می‌توانید از {نام} و {شرکت} استفاده کنید">
        <textarea className="input" style={{ minHeight: 100 }} autoFocus value={body}
          onChange={e => setBody(e.target.value)} />
      </Field>
    </Modal>
  );
}

// ---------------------------------------------------------------- بازخورد
function FeedbackModal({ value, setValue, busy, onSave }) {
  return (
    <Modal title="ثبت بازخورد مشتری" onClose={() => setValue(null)}
      footer={<>
        <button className="btn btn-ghost" onClick={() => setValue(null)}>انصراف</button>
        <button className="btn btn-primary" disabled={busy} onClick={onSave}>ثبت</button>
      </>}>
      <Field label="نوع بازخورد">
        <select className="input" value={value.kind} onChange={e => setValue(v => ({ ...v, kind: e.target.value }))}>
          {Object.entries(FEEDBACK_KIND).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </Field>
      {value.kind === 'nps' ? (
        <Field label={`احتمال معرفی ما به دیگران: ${fa(value.score ?? 0)} از ۱۰`}
          hint="۰ تا ۶ ناراضی · ۷ و ۸ بی‌طرف · ۹ و ۱۰ مروج">
          <input type="range" min="0" max="10" style={{ width: '100%' }} value={value.score ?? 0}
            onChange={e => setValue(v => ({ ...v, score: Number(e.target.value) }))} />
        </Field>
      ) : (
        <Field label={`میزان رضایت: ${fa(value.csat ?? 5)} از ۵`}>
          <input type="range" min="1" max="5" style={{ width: '100%' }} value={value.csat ?? 5}
            onChange={e => setValue(v => ({ ...v, csat: Number(e.target.value) }))} />
        </Field>
      )}
      <Field label="توضیح مشتری" hint="عینِ حرف مشتری را بنویسید — همین متن‌ها تحلیل می‌شوند">
        <textarea className="input" style={{ minHeight: 90 }} value={value.comment || ''}
          onChange={e => setValue(v => ({ ...v, comment: e.target.value }))} />
      </Field>
      <Field label="از چه راهی">
        <select className="input" value={value.source || 'phone'} onChange={e => setValue(v => ({ ...v, source: e.target.value }))}>
          {Object.entries(CHANNEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          <option value="form">فرم نظرسنجی</option>
        </select>
      </Field>
    </Modal>
  );
}

function Feedback({ canManage }) {
  const { toast } = useStore();
  const [rows, setRows] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [add, setAdd] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const [f, c] = await Promise.all([api('/crm/feedback'), api('/crm/customers')]);
      setRows(f.feedback); setCustomers(c.customers);
    } catch (e) { toast(e.message, 'error'); }
  };
  useEffect(() => { load(); }, []);

  const save = async () => {
    if (!add.customer_id) return toast('مشتری را انتخاب کنید', 'error');
    setBusy(true);
    try { await api('/crm/feedback', { method: 'POST', body: add }); setAdd(null); load(); toast('ثبت شد'); }
    catch (e) { toast(e.message, 'error'); }
    setBusy(false);
  };
  const remove = async (f) => {
    if (!window.confirm('این بازخورد حذف شود؟')) return;
    try { await api(`/crm/feedback/${f.id}`, { method: 'DELETE' }); load(); }
    catch (e) { toast(e.message, 'error'); }
  };

  const withCsat = rows.filter(f => f.csat !== null);
  const avgCsat = withCsat.length ? withCsat.reduce((s, f) => s + f.csat, 0) / withCsat.length : null;
  const nps = (() => {
    const s = rows.filter(f => f.score !== null);
    if (!s.length) return null;
    const p = s.filter(f => f.score >= 9).length;
    const d = s.filter(f => f.score <= 6).length;
    return Math.round(((p - d) / s.length) * 100);
  })();

  return (
    <>
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap', alignItems: 'stretch' }}>
        {avgCsat !== null && (
          <div className="card card-pad" style={{ flex: 1, minWidth: 220 }}>
            <b style={{ display: 'block', marginBottom: 6, fontSize: 13 }}>میانگین رضایت</b>
            <Gauge value={avgCsat} max={5} label={`${fa(avgCsat, 1)} از ۵`}
              caption={`بر مبنای ${fa(withCsat.length)} بازخورد`} maxLabel="۵" size={175} />
          </div>
        )}
        <Stat label="شاخص NPS" value={nps === null ? '—' : fa(nps)}
          tone={nps === null ? undefined : nps >= 30 ? 'good' : nps < 0 ? 'bad' : undefined}
          sub="از ۱۰۰− تا ۱۰۰+ · بالای ۳۰ خوب است" />
        <Stat label="کل بازخوردها" value={fa(rows.length)} />
        <Stat label="شکایت‌ها" value={fa(rows.filter(f => f.kind === 'complaint').length)} tone="b" />
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
        <button className="btn btn-primary" onClick={() => setAdd({ kind: 'csat', csat: 5, comment: '', source: 'phone' })}>
          <Plus size={16} /> ثبت بازخورد
        </button>
      </div>

      <div className="card">
        {rows.length === 0 ? (
          <div className="empty"><Star size={40} /><div>هنوز بازخوردی ثبت نشده است</div></div>
        ) : (
          <table className="table">
            <thead><tr><th>مشتری</th><th>نوع</th><th>امتیاز</th><th>توضیح</th><th>محصول</th><th>ثبت‌کننده</th><th>تاریخ</th><th></th></tr></thead>
            <tbody>
              {rows.map(f => (
                <tr key={f.id}>
                  <td style={{ fontWeight: 600 }}>{f.customer_name || '—'}</td>
                  <td style={{ fontSize: 12.3 }}>{FEEDBACK_KIND[f.kind] || f.kind}</td>
                  <td>
                    {f.csat !== null && (
                      <span className={`badge ${f.csat >= 4 ? 'badge-green' : f.csat <= 2 ? 'badge-red' : 'badge-amber'}`}>
                        {fa(f.csat)} از ۵
                      </span>
                    )}
                    {f.score !== null && (
                      <span className={`badge ${f.score >= 9 ? 'badge-green' : f.score <= 6 ? 'badge-red' : 'badge-amber'}`}>
                        NPS {fa(f.score)}
                      </span>
                    )}
                    {f.csat === null && f.score === null && '—'}
                  </td>
                  <td style={{ fontSize: 12.5, maxWidth: 320 }}>{f.comment || '—'}</td>
                  <td style={{ fontSize: 12.3 }}>{f.product_name || '—'}</td>
                  <td style={{ fontSize: 12.3 }}>{f.user_name || '—'}</td>
                  <td style={{ fontSize: 12.3, color: 'var(--text-3)' }}>{fmtDate(f.created_at)}</td>
                  <td>
                    <button className="icon-btn" style={{ width: 26, height: 26, color: 'var(--red)' }}
                      onClick={() => remove(f)}><Trash2 size={12} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {add && (
        <Modal title="ثبت بازخورد مشتری" onClose={() => setAdd(null)}
          footer={<>
            <button className="btn btn-ghost" onClick={() => setAdd(null)}>انصراف</button>
            <button className="btn btn-primary" disabled={busy} onClick={save}>ثبت</button>
          </>}>
          <Field label="مشتری *">
            <select className="input" value={add.customer_id || ''}
              onChange={e => setAdd(v => ({ ...v, customer_id: Number(e.target.value) }))}>
              <option value="">— انتخاب مشتری —</option>
              {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Field label="نوع بازخورد">
            <select className="input" value={add.kind} onChange={e => setAdd(v => ({ ...v, kind: e.target.value }))}>
              {Object.entries(FEEDBACK_KIND).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </Field>
          {add.kind === 'nps' ? (
            <Field label={`احتمال معرفی ما به دیگران: ${fa(add.score ?? 0)} از ۱۰`}>
              <input type="range" min="0" max="10" style={{ width: '100%' }} value={add.score ?? 0}
                onChange={e => setAdd(v => ({ ...v, score: Number(e.target.value) }))} />
            </Field>
          ) : (
            <Field label={`میزان رضایت: ${fa(add.csat ?? 5)} از ۵`}>
              <input type="range" min="1" max="5" style={{ width: '100%' }} value={add.csat ?? 5}
                onChange={e => setAdd(v => ({ ...v, csat: Number(e.target.value) }))} />
            </Field>
          )}
          <Field label="توضیح مشتری">
            <textarea className="input" style={{ minHeight: 90 }} value={add.comment || ''}
              onChange={e => setAdd(v => ({ ...v, comment: e.target.value }))} />
          </Field>
        </Modal>
      )}
    </>
  );
}

// ---------------------------------------------------------------- پیامک
function Sms({ canManage }) {
  const { toast } = useStore();
  const [data, setData] = useState(null);
  const [tpl, setTpl] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try { setData(await api('/crm/sms')); }
    catch (e) { toast(e.message, 'error'); }
  };
  useEffect(() => { load(); }, []);
  if (!data) return <div className="card"><div className="empty">در حال بارگذاری…</div></div>;

  const saveTpl = async () => {
    setBusy(true);
    try { await api('/crm/sms-templates', { method: 'POST', body: tpl }); setTpl(null); load(); toast('قالب ذخیره شد'); }
    catch (e) { toast(e.message, 'error'); }
    setBusy(false);
  };

  return (
    <>
      {!data.config.configured && (
        <div className="card card-pad" style={{ marginBottom: 16, borderColor: 'var(--amber)', background: 'var(--amber-soft)' }}>
          <b style={{ fontSize: 13.5 }}>درگاه پیامک هنوز تنظیم نشده است</b>
          <p style={{ fontSize: 12.5, color: 'var(--text-2)', margin: '5px 0 0', lineHeight: 1.9 }}>
            همه‌چیز آماده است و می‌توانید کل جریان کار را همین حالا تست کنید — پیام‌ها با وضعیت
            <b> «شبیه‌سازی»</b> ثبت می‌شوند و هیچ درخواستی به بیرون فرستاده نمی‌شود.
            برای ارسال واقعی: در «تنظیمات سازمان ← پیامک» درگاه، آدرس، کلید و شمارهٔ فرستنده را وارد
            و تابع ارسال را در <code>server/sms.js</code> برای درگاه خودتان تکمیل کنید.
          </p>
        </div>
      )}

      <div className="card card-pad" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <b>قالب‌های پیامک</b>
            <p style={{ fontSize: 12.3, color: 'var(--text-3)', margin: '4px 0 0' }}>
              می‌توانید از {'{نام}'} و {'{شرکت}'} در متن استفاده کنید تا هنگام ارسال جایگزین شوند.
            </p>
          </div>
          {canManage && (
            <button className="btn btn-ghost btn-sm" onClick={() => setTpl({ name: '', body: '', kind: 'followup' })}>
              <Plus size={14} /> قالب جدید
            </button>
          )}
        </div>
        <div style={{ marginTop: 12 }}>
          {data.templates.length === 0 ? (
            <div style={{ fontSize: 12.8, color: 'var(--text-3)' }}>قالبی تعریف نشده است</div>
          ) : data.templates.map(t => (
            <div key={t.id} style={{ padding: '8px 0', borderBottom: '1px solid var(--border-soft)' }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <b style={{ fontSize: 13 }}>{t.name}</b>
                <span className="badge badge-gray">{t.kind}</span>
                {canManage && (
                  <button className="icon-btn" style={{ width: 24, height: 24, marginInlineStart: 'auto', color: 'var(--red)' }}
                    onClick={async () => {
                      try { await api(`/crm/sms-templates/${t.id}`, { method: 'DELETE' }); load(); }
                      catch (e) { toast(e.message, 'error'); }
                    }}><Trash2 size={12} /></button>
                )}
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--text-2)', whiteSpace: 'pre-wrap' }}>{t.body}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="card-pad" style={{ paddingBottom: 0 }}><b>تاریخچهٔ پیامک‌ها</b></div>
        {data.messages.length === 0 ? (
          <div className="empty"><Send size={40} /><div>پیامکی ارسال نشده است</div></div>
        ) : (
          <table className="table">
            <thead><tr><th>وضعیت</th><th>گیرنده</th><th>مشتری</th><th>متن</th><th>فرستنده</th><th>تاریخ</th></tr></thead>
            <tbody>
              {data.messages.map(m => (
                <tr key={m.id}>
                  <td>
                    <span className={`badge ${m.status === 'sent' ? 'badge-green' : m.status === 'failed' ? 'badge-red'
                      : m.status === 'simulated' ? 'badge-sky' : 'badge-gray'}`}>
                      {m.status === 'sent' ? 'ارسال شد' : m.status === 'failed' ? 'ناموفق'
                        : m.status === 'simulated' ? 'شبیه‌سازی' : 'در صف'}
                    </span>
                    {m.error && <div style={{ fontSize: 11, color: 'var(--red)' }}>{m.error}</div>}
                  </td>
                  <td style={{ fontSize: 12.3, direction: 'ltr', textAlign: 'right' }}>{m.phone}</td>
                  <td style={{ fontSize: 12.3 }}>{m.customer_name || '—'}</td>
                  <td style={{ fontSize: 12.5, maxWidth: 340 }}>{m.body}</td>
                  <td style={{ fontSize: 12.3 }}>{m.user_name || '—'}</td>
                  <td style={{ fontSize: 12.3, color: 'var(--text-3)' }}>{fmtDateTime(m.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {tpl && (
        <Modal title="قالب پیامک جدید" onClose={() => setTpl(null)}
          footer={<>
            <button className="btn btn-ghost" onClick={() => setTpl(null)}>انصراف</button>
            <button className="btn btn-primary" disabled={busy || !tpl.name.trim() || !tpl.body.trim()} onClick={saveTpl}>ذخیره</button>
          </>}>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 10 }}>
            <Field label="نام قالب">
              <input className="input" autoFocus value={tpl.name} onChange={e => setTpl(t => ({ ...t, name: e.target.value }))} />
            </Field>
            <Field label="نوع">
              <select className="input" value={tpl.kind} onChange={e => setTpl(t => ({ ...t, kind: e.target.value }))}>
                <option value="followup">پیگیری</option>
                <option value="thanks">تشکر</option>
                <option value="survey">نظرسنجی</option>
                <option value="reminder">یادآوری</option>
                <option value="support">پشتیبانی</option>
              </select>
            </Field>
          </div>
          <Field label="متن پیامک" hint="مثال: {نام} عزیز، از خرید شما سپاسگزاریم. کارشناس ما به‌زودی تماس می‌گیرد.">
            <textarea className="input" style={{ minHeight: 100 }} value={tpl.body}
              onChange={e => setTpl(t => ({ ...t, body: e.target.value }))} />
          </Field>
        </Modal>
      )}
    </>
  );
}

// ---------------------------------------------------------------- گزارش کیفیت
function SupportReport() {
  const { toast } = useStore();
  const [rep, setRep] = useState(null);
  const [filters, setFilters] = useState({ from: '', to: '' });

  const load = async () => {
    try {
      const qs = new URLSearchParams(Object.entries(filters).filter(([, v]) => v)).toString();
      setRep(await api(`/crm/support-reports${qs ? '?' + qs : ''}`));
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
      </div>

      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <Stat label="کل تیکت‌ها" value={fa(s.total)} sub={`${fa(s.open_count)} باز`} />
        <Stat label="ایرادهای کیفی" value={fa(s.quality_count)} tone={s.quality_count ? 'bad' : 'good'} />
        <Stat label="تیکت بحرانی" value={fa(s.critical_count)} tone={s.critical_count ? 'bad' : 'good'} />
        <Stat label="میانگین اولین پاسخ" value={`${fa(s.avg_response_hours, 1)} ساعت`} tone="a" />
        <Stat label="میانگین زمان رفع" value={`${fa(s.avg_resolve_hours, 1)} ساعت`} />
        <Stat label="هزینهٔ رسیدگی" value={money(s.total_cost)} tone="b" />
      </div>

      <div className="grid-2">
        <div className="card card-pad" style={{ marginBottom: 18 }}>
          <b style={{ display: 'block', marginBottom: 4 }}>ریشهٔ ایرادهای کیفی</b>
          <p style={{ fontSize: 12, color: 'var(--text-3)', margin: '0 0 12px' }}>
            پرتکرارترین ریشه، اولین چیزی است که باید در تولید اصلاح شود.
          </p>
          <RankedBars rows={rep.root_causes.map(x => ({ label: x.cause, value: x.count, cost: x.cost }))}
            color="var(--chart-b)"
            format={(v, r) => `${fa(v)} مورد${r.cost > 0 ? ` · ${money(r.cost)}` : ''}`}
            emptyText="ایراد کیفی‌ای ثبت نشده است" />
        </div>
        <div className="card card-pad" style={{ marginBottom: 18 }}>
          <b style={{ display: 'block', marginBottom: 4 }}>روند ماهانهٔ تیکت‌ها</b>
          <p style={{ fontSize: 12, color: 'var(--text-3)', margin: '0 0 12px' }}>کل تیکت‌ها و سهم ایرادهای کیفی</p>
          <GroupedBars rows={monthly} series={[
            { key: 'count', label: 'کل تیکت', color: 'var(--chart-a)' },
            { key: 'quality_count', label: 'ایراد کیفی', color: 'var(--chart-b)' },
          ]} />
        </div>
      </div>

      <div className="grid-2">
        <div className="card card-pad" style={{ marginBottom: 18 }}>
          <b style={{ display: 'block', marginBottom: 4 }}>محصولاتِ پرمسئله</b>
          <p style={{ fontSize: 12, color: 'var(--text-3)', margin: '0 0 12px' }}>
            کدام محصول بیشترین تیکت و هزینهٔ رسیدگی را دارد؟
          </p>
          <RankedBars rows={rep.by_product.map(x => ({ label: x.product_name, value: x.count, q: x.quality_count, cost: x.cost }))}
            sequential
            format={(v, r) => `${fa(v)} تیکت${r.q > 0 ? ` (${fa(r.q)} کیفی)` : ''}`}
            emptyText="داده‌ای نیست" />
        </div>
        <div className="card card-pad" style={{ marginBottom: 18 }}>
          <b style={{ display: 'block', marginBottom: 4 }}>نوع تیکت‌ها</b>
          <p style={{ fontSize: 12, color: 'var(--text-3)', margin: '0 0 12px' }}>ترکیب درخواست‌های مشتریان</p>
          <RankedBars sequential rows={rep.by_type.map(x => ({ label: TICKET_TYPE[x.type] || x.type, value: x.count }))}
            format={(v) => `${fa(v)} تیکت`} emptyText="داده‌ای نیست" />
        </div>
      </div>

      <div className="card card-pad">
        <b style={{ display: 'block', marginBottom: 10 }}>رضایت مشتریان</b>
        <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap', alignItems: 'center' }}>
          {rep.feedback.avg_csat > 0 && (
            <Gauge value={rep.feedback.avg_csat} max={5} label={`${fa(rep.feedback.avg_csat, 1)} از ۵`}
              caption="میانگین رضایت" maxLabel="۵" size={180} />
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 220 }}>
            <div style={{ fontSize: 13 }}>
              <span style={{ color: 'var(--text-2)' }}>شاخص NPS: </span>
              <b style={{ color: rep.feedback.nps === null ? undefined : rep.feedback.nps >= 30 ? 'var(--green)' : rep.feedback.nps < 0 ? 'var(--red)' : 'var(--amber)' }}>
                {rep.feedback.nps === null ? '—' : fa(rep.feedback.nps)}
              </b>
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--text-2)' }}>
              مروج: {fa(rep.feedback.promoters)} · بی‌طرف: {fa(rep.feedback.passives)} · ناراضی: {fa(rep.feedback.detractors)}
            </div>
            <div style={{ fontSize: 12.3, color: 'var(--text-3)', lineHeight: 1.9, maxWidth: 380 }}>
              NPS از ۱۰۰− تا ۱۰۰+ است؛ بالای ۳۰ خوب و بالای ۵۰ عالی شمرده می‌شود.
              مشتریِ ناراضی معمولاً تجربه‌اش را به چند نفر دیگر هم می‌گوید.
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
