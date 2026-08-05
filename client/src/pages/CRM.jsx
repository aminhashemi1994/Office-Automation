// ============================================================================
//  CRM — مشتریان، مخاطبین، گزارش‌ها/پیگیری‌ها، فروش و گزارش‌گیری
// ============================================================================
import React, { useEffect, useState } from 'react';
import {
  Plus, Search, Users as UsersIcon, Phone, Mail, Trash2, Pencil,
  CalendarClock, BarChart3, Handshake, ArrowRight, Star, Settings2, Check,
  Sparkles, Copy, FileText, Gavel, Download, Package, ArrowLeftRight,
} from 'lucide-react';
import { api } from '../api.js';
import { useStore } from '../store.jsx';
import { fmtDateTime, fmtDate, fa } from '../utils.js';
import { Modal, Field, UserPicker, Segmented } from '../components/common.jsx';
import Gauge, { MiniBar } from '../components/Gauge.jsx';
import { RankedBars, GroupedBars, TrendLine, Funnel, Stat } from '../components/Charts.jsx';
import Tenders, { TenderReport } from './crm/Tenders.jsx';
import Products from './crm/Products.jsx';
import Focus from './crm/Focus.jsx';
import Support from './crm/Support.jsx';
import { getToken } from '../api.js';

export const CUSTOMER_STATUS = {
  lead: ['سرنخ', 'badge-amber'],
  active: ['مشتری فعال', 'badge-green'],
  inactive: ['غیرفعال', 'badge-gray'],
};

export const DEAL_STAGE = {
  new: ['جدید', 'badge-gray'],
  quoted: ['پیش‌فاکتور', 'badge-sky'],
  negotiation: ['مذاکره', 'badge-primary'],
  won: ['برنده', 'badge-green'],
  lost: ['بازنده', 'badge-red'],
};

const ACTIVITY_TYPE = {
  call: 'تماس تلفنی',
  meeting: 'جلسه',
  email: 'ایمیل',
  visit: 'بازدید حضوری',
  note: 'یادداشت',
};

// مبلغ ریالی خوانا
const money = (n) => `${Number(n || 0).toLocaleString('fa-IR')} ریال`;

export default function CRM() {
  const { toast } = useStore();
  const [tab, setTab] = useState('customers');
  const [customers, setCustomers] = useState([]);
  const [deals, setDeals] = useState([]);
  const [followUps, setFollowUps] = useState([]);
  const [fields, setFields] = useState([]);
  const [canManage, setCanManage] = useState(false);
  const [search, setSearch] = useState('');
  const [statusF, setStatusF] = useState('');
  const [openId, setOpenId] = useState(null);      // مشتریِ باز‌شده در نمای جزئیات
  const [editCust, setEditCust] = useState(null);
  const [editDeal, setEditDeal] = useState(null);
  const [manageFields, setManageFields] = useState(false);
  const [denied, setDenied] = useState(false);
  const [perfUser, setPerfUser] = useState(null); // کارشناسی که عملکردش باز شده
  const [repKind, setRepKind] = useState('deals'); // گزارش فروش مستقیم یا مناقصات
  const [tools, setTools] = useState(null);        // ابزارها: خروجی، انتقال مالکیت، کالاها

  const load = async () => {
    try {
      const qs = new URLSearchParams(Object.entries({ q: search, status: statusF }).filter(([, v]) => v)).toString();
      const [c, d, f, fl] = await Promise.all([
        api(`/crm/customers${qs ? '?' + qs : ''}`),
        api('/crm/deals'),
        api('/crm/fields'),
        api('/crm/follow-ups'),
      ]);
      setCustomers(c.customers); setCanManage(c.can_manage);
      setDeals(d.deals); setFields(f.fields); setFollowUps(fl.follow_ups);
      setDenied(false);
    } catch (e) {
      if (/دسترسی/.test(e.message)) setDenied(true);
      else toast(e.message, 'error');
    }
  };
  useEffect(() => { load(); }, []);

  if (denied) {
    return (
      <div className="content">
        <div className="empty">
          <Handshake size={40} />
          <div>واحد شما به بخش CRM دسترسی ندارد.</div>
          <div style={{ fontSize: 12.5, color: 'var(--text-3)', marginTop: 6 }}>
            مدیر سامانه می‌تواند از «تنظیمات سازمان ← دسترسی CRM» واحد شما را مجاز کند.
          </div>
        </div>
      </div>
    );
  }

  if (openId) {
    return <CustomerDetail id={openId} fields={fields} canManage={canManage}
      onBack={() => { setOpenId(null); load(); }} />;
  }

  const overdueFollowUps = followUps.filter(f => new Date(f.follow_up_at) <= new Date()).length;

  return (
    <div className="content">
      <div className="page-head">
        <div className="tabs">
          <button className={`tab ${tab === 'customers' ? 'active' : ''}`} onClick={() => setTab('customers')}>
            مشتریان {customers.length > 0 && <span className="badge-count">{fa(customers.length)}</span>}
          </button>
          <button className={`tab ${tab === 'deals' ? 'active' : ''}`} onClick={() => setTab('deals')}>فروش</button>
          <button className={`tab ${tab === 'tenders' ? 'active' : ''}`} onClick={() => setTab('tenders')}>مناقصات</button>
          <button className={`tab ${tab === 'products' ? 'active' : ''}`} onClick={() => setTab('products')}>محصولات</button>
          <button className={`tab ${tab === 'focus' ? 'active' : ''}`} onClick={() => setTab('focus')}>تمرکز فروش</button>
          <button className={`tab ${tab === 'support' ? 'active' : ''}`} onClick={() => setTab('support')}>پشتیبانی</button>
          <button className={`tab ${tab === 'follow' ? 'active' : ''}`} onClick={() => setTab('follow')}>
            پیگیری‌ها {overdueFollowUps > 0 && <span className="badge-count">{fa(overdueFollowUps)}</span>}
          </button>
          <button className={`tab ${tab === 'reports' ? 'active' : ''}`} onClick={() => { setTab('reports'); setPerfUser(null); }}>گزارش فروش</button>
          <button className={`tab ${tab === 'perf' ? 'active' : ''}`} onClick={() => { setTab('perf'); setPerfUser(null); }}>عملکرد من</button>
          <button className={`tab ${tab === 'assistant' ? 'active' : ''}`} onClick={() => setTab('assistant')}>دستیار هوشمند</button>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn btn-ghost" onClick={() => setTools('export')} title="خروجی، کالاها و ابزارها">
            <Settings2 size={16} /> ابزارها
          </button>
          {canManage && ['customers', 'deals'].includes(tab) && (
            <button className="btn btn-ghost" onClick={() => setManageFields(true)} title="تعریف فیلدهای دلخواه">
              <Settings2 size={16} /> فیلدهای دلخواه
            </button>
          )}
          {tab === 'deals' ? (
            <button className="btn btn-primary" onClick={() => setEditDeal({ stage: 'new', amount: 0, probability: 0, extra: {} })}>
              <Plus size={17} /> معاملهٔ جدید
            </button>
          ) : ['customers', 'follow'].includes(tab) ? (
            <button className="btn btn-primary" onClick={() => setEditCust({ kind: 'company', status: 'lead', extra: {} })}>
              <Plus size={17} /> مشتری جدید
            </button>
          ) : null}
        </div>
      </div>

      {tab === 'customers' && (
        <>
          <div className="card card-pad" style={{ marginBottom: 16, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'end' }}>
            <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
              <Search size={15} style={{ position: 'absolute', right: 11, top: 11, color: 'var(--text-3)' }} />
              <input className="input" style={{ paddingRight: 34 }} placeholder="جستجوی نام، تلفن، ایمیل، شهر…"
                value={search} onChange={e => setSearch(e.target.value)} onKeyDown={e => e.key === 'Enter' && load()} />
            </div>
            <select className="input" style={{ width: 170 }} value={statusF} onChange={e => setStatusF(e.target.value)}>
              <option value="">همهٔ وضعیت‌ها</option>
              {Object.entries(CUSTOMER_STATUS).map(([k, v]) => <option key={k} value={k}>{v[0]}</option>)}
            </select>
            <button className="btn btn-primary" onClick={load}><Search size={16} /> جستجو</button>
          </div>

          <div className="card">
            {customers.length === 0 ? (
              <div className="empty"><UsersIcon size={40} /><div>هنوز مشتری‌ای ثبت نشده است</div></div>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>نام مشتری</th><th>وضعیت</th><th>تلفن</th><th>شهر</th>
                    <th>مخاطب</th><th>معاملات</th><th>فروش موفق</th><th>پیگیری بعدی</th><th>مسئول</th>
                  </tr>
                </thead>
                <tbody>
                  {customers.map(c => {
                    const [sl, sc] = CUSTOMER_STATUS[c.status] || CUSTOMER_STATUS.lead;
                    return (
                      <tr key={c.id}>
                        <td>
                          <a href="#" onClick={e => { e.preventDefault(); setOpenId(c.id); }}
                            style={{ fontWeight: 600, color: 'var(--primary)' }}>{c.name}</a>
                          {c.industry && <div style={{ fontSize: 11.5, color: 'var(--text-3)' }}>{c.industry}</div>}
                        </td>
                        <td><span className={`badge ${sc}`}>{sl}</span></td>
                        <td style={{ fontSize: 12.5 }}>{c.phone || '—'}</td>
                        <td style={{ fontSize: 12.5 }}>{c.city || '—'}</td>
                        <td>{fa(c.contacts_count)}</td>
                        <td>{fa(c.deals_count)}</td>
                        <td style={{ color: 'var(--green)', fontWeight: 600, fontSize: 12.5 }}>
                          {c.won_amount > 0 ? money(c.won_amount) : '—'}
                        </td>
                        <td style={{ fontSize: 12.3 }}>
                          {c.next_follow_up ? (
                            <span className={`badge ${new Date(c.next_follow_up) <= new Date() ? 'badge-red' : 'badge-amber'}`}>
                              <CalendarClock size={11} /> {fmtDate(c.next_follow_up)}
                            </span>
                          ) : '—'}
                        </td>
                        <td style={{ fontSize: 12.3, color: 'var(--text-2)' }}>{c.owner_name || '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {tab === 'deals' && <DealsTable deals={deals} onEdit={setEditDeal} onReload={load} canManage={canManage} />}
      {tab === 'tenders' && <Tenders onOpenCustomer={setOpenId} />}
      {tab === 'products' && <Products canManage={canManage} />}
      {tab === 'focus' && <Focus canManage={canManage} />}
      {tab === 'support' && <Support canManage={canManage} />}
      {tab === 'follow' && <FollowUps rows={followUps} onOpen={setOpenId} onReload={load} />}
      {tab === 'reports' && (perfUser
        ? <MyPerformance userId={perfUser} onBack={() => setPerfUser(null)} />
        : (
          <>
            <div style={{ marginBottom: 16 }}>
              <Segmented value={repKind} onChange={setRepKind} options={[
                { value: 'deals', label: 'فروش مستقیم', tone: 'primary' },
                { value: 'tenders', label: 'مناقصات' },
              ]} />
            </div>
            {repKind === 'deals'
              ? <SalesReport onOpenPerformance={setPerfUser} />
              : <TenderReport />}
          </>
        ))}
      {tab === 'perf' && <MyPerformance />}
      {tab === 'assistant' && <Assistant canManage={canManage} />}

      {editCust && (
        <CustomerModal value={editCust} fields={fields.filter(f => f.entity === 'customer')}
          onClose={() => setEditCust(null)} onDone={() => { setEditCust(null); load(); }} />
      )}
      {editDeal && (
        <DealModal value={editDeal} customers={customers} fields={fields.filter(f => f.entity === 'deal')}
          onClose={() => setEditDeal(null)} onDone={() => { setEditDeal(null); load(); }} />
      )}
      {manageFields && (
        <FieldsModal fields={fields} onClose={() => setManageFields(false)} onDone={load} />
      )}
      {tools && <ToolsModal canManage={canManage} onClose={() => setTools(null)} />}
    </div>
  );
}

// ---------------------------------------------------------------- فیلدهای دلخواه
function ExtraFields({ fields, value, onChange }) {
  if (!fields.length) return null;
  return fields.map(f => (
    <Field key={f.key} label={f.label + (f.required ? ' *' : '')}>
      {f.type === 'textarea' ? (
        <textarea className="input" value={value?.[f.key] || ''}
          onChange={e => onChange({ ...value, [f.key]: e.target.value })} />
      ) : f.type === 'select' ? (
        <select className="input" value={value?.[f.key] || ''}
          onChange={e => onChange({ ...value, [f.key]: e.target.value })}>
          <option value="">— انتخاب —</option>
          {(f.options || []).map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      ) : (
        <input className="input" type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'}
          value={value?.[f.key] || ''} onChange={e => onChange({ ...value, [f.key]: e.target.value })} />
      )}
    </Field>
  ));
}

function FieldsModal({ fields, onClose, onDone }) {
  const { toast } = useStore();
  const [entity, setEntity] = useState('customer');
  const [form, setForm] = useState({ key: '', label: '', type: 'text', options: '' });
  const [busy, setBusy] = useState(false);
  const list = fields.filter(f => f.entity === entity);

  const add = async () => {
    setBusy(true);
    try {
      await api('/crm/fields', { method: 'POST', body: {
        entity, key: form.key, label: form.label, type: form.type,
        options: form.type === 'select' ? form.options.split('،').map(s => s.trim()).filter(Boolean) : [],
      } });
      setForm({ key: '', label: '', type: 'text', options: '' });
      onDone();
      toast('فیلد اضافه شد');
    } catch (e) { toast(e.message, 'error'); }
    setBusy(false);
  };

  const remove = async (id) => {
    try { await api(`/crm/fields/${id}`, { method: 'DELETE' }); onDone(); }
    catch (e) { toast(e.message, 'error'); }
  };

  return (
    <Modal title="فیلدهای دلخواه CRM" onClose={onClose} wide
      footer={<button className="btn btn-ghost" onClick={onClose}>بستن</button>}>
      <p style={{ fontSize: 12.5, color: 'var(--text-2)', marginTop: 0 }}>
        هر فیلدی که لازم دارید اینجا تعریف کنید؛ در فرم مشتری/مخاطب/معامله ظاهر می‌شود.
      </p>
      <Field label="این فیلد برای کدام بخش است؟">
        <select className="input" value={entity} onChange={e => setEntity(e.target.value)}>
          <option value="customer">مشتری</option>
          <option value="contact">مخاطب</option>
          <option value="deal">معامله / فروش</option>
        </select>
      </Field>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
        <Field label="کلید (انگلیسی)">
          <input className="input" value={form.key} placeholder="credit_limit"
            onChange={e => setForm(f => ({ ...f, key: e.target.value }))} />
        </Field>
        <Field label="برچسب نمایشی">
          <input className="input" value={form.label} placeholder="سقف اعتبار"
            onChange={e => setForm(f => ({ ...f, label: e.target.value }))} />
        </Field>
        <Field label="نوع">
          <select className="input" value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}>
            <option value="text">متن</option>
            <option value="textarea">متن بلند</option>
            <option value="number">عدد</option>
            <option value="date">تاریخ</option>
            <option value="select">انتخابی</option>
          </select>
        </Field>
      </div>
      {form.type === 'select' && (
        <Field label="گزینه‌ها (با «،» جدا کنید)">
          <input className="input" value={form.options} placeholder="طلایی، نقره‌ای، برنزی"
            onChange={e => setForm(f => ({ ...f, options: e.target.value }))} />
        </Field>
      )}
      <button className="btn btn-primary" disabled={busy || !form.key.trim() || !form.label.trim()} onClick={add}>
        <Plus size={15} /> افزودن فیلد
      </button>

      <div style={{ marginTop: 18 }}>
        {list.length === 0 ? (
          <div style={{ fontSize: 12.5, color: 'var(--text-3)' }}>هنوز فیلد دلخواهی برای این بخش تعریف نشده است.</div>
        ) : list.map(f => (
          <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--border-soft)' }}>
            <b style={{ fontSize: 13 }}>{f.label}</b>
            <span style={{ fontSize: 11.5, color: 'var(--text-3)' }}>{f.key} · {f.type}</span>
            <button className="icon-btn" style={{ marginRight: 'auto', width: 28, height: 28, color: 'var(--red)' }}
              onClick={() => remove(f.id)}><Trash2 size={13} /></button>
          </div>
        ))}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- مشتری
function CustomerModal({ value, fields, onClose, onDone }) {
  const { toast, departments } = useStore();
  const [v, setV] = useState(value);
  const [busy, setBusy] = useState(false);
  const set = (patch) => setV(x => ({ ...x, ...patch }));

  const save = async () => {
    if (!String(v.name || '').trim()) return toast('نام مشتری الزامی است', 'error');
    setBusy(true);
    try {
      if (v.id) await api(`/crm/customers/${v.id}`, { method: 'PUT', body: v });
      else await api('/crm/customers', { method: 'POST', body: v });
      onDone();
      toast(v.id ? 'مشتری ویرایش شد' : 'مشتری ثبت شد');
    } catch (e) { toast(e.message, 'error'); }
    setBusy(false);
  };

  return (
    <Modal title={v.id ? `ویرایش «${value.name}»` : 'مشتری جدید'} onClose={onClose} wide
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>انصراف</button>
        <button className="btn btn-primary" disabled={busy} onClick={save}>ذخیره</button>
      </>}>
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 10 }}>
        <Field label="نام شرکت / مشتری *">
          <input className="input" value={v.name || ''} autoFocus onChange={e => set({ name: e.target.value })} />
        </Field>
        <Field label="نوع">
          <select className="input" value={v.kind || 'company'} onChange={e => set({ kind: e.target.value })}>
            <option value="company">شرکت</option>
            <option value="person">شخص حقیقی</option>
          </select>
        </Field>
        <Field label="وضعیت">
          <select className="input" value={v.status || 'lead'} onChange={e => set({ status: e.target.value })}>
            {Object.entries(CUSTOMER_STATUS).map(([k, s]) => <option key={k} value={k}>{s[0]}</option>)}
          </select>
        </Field>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <Field label="تلفن"><input className="input" value={v.phone || ''} onChange={e => set({ phone: e.target.value })} /></Field>
        <Field label="ایمیل"><input className="input" value={v.email || ''} onChange={e => set({ email: e.target.value })} /></Field>
        <Field label="شهر"><input className="input" value={v.city || ''} onChange={e => set({ city: e.target.value })} /></Field>
        <Field label="وب‌سایت"><input className="input" value={v.website || ''} onChange={e => set({ website: e.target.value })} /></Field>
        <Field label="کد اقتصادی"><input className="input" value={v.economic_code || ''} onChange={e => set({ economic_code: e.target.value })} /></Field>
        <Field label="شناسه/کد ملی"><input className="input" value={v.national_id || ''} onChange={e => set({ national_id: e.target.value })} /></Field>
        <Field label="کد پستی"><input className="input" value={v.postal_code || ''} onChange={e => set({ postal_code: e.target.value })} /></Field>
        <Field label="حوزهٔ فعالیت"><input className="input" value={v.industry || ''} onChange={e => set({ industry: e.target.value })} /></Field>
        <Field label="نحوهٔ آشنایی"><input className="input" value={v.source || ''} placeholder="نمایشگاه، معرفی، تماس ورودی…" onChange={e => set({ source: e.target.value })} /></Field>
        <Field label="واحد مسئول">
          <select className="input" value={v.department_id || ''} onChange={e => set({ department_id: e.target.value ? Number(e.target.value) : null })}>
            <option value="">— بدون واحد —</option>
            {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </Field>
      </div>
      <Field label="کارشناس مسئول">
        <UserPicker value={v.owner_id} onChange={id => set({ owner_id: id })} />
      </Field>
      <Field label="آدرس"><textarea className="input" value={v.address || ''} onChange={e => set({ address: e.target.value })} /></Field>
      <Field label="توضیحات"><textarea className="input" value={v.note || ''} onChange={e => set({ note: e.target.value })} /></Field>
      <ExtraFields fields={fields} value={v.extra} onChange={x => set({ extra: x })} />
    </Modal>
  );
}

// ---------------------------------------------------------------- جزئیات مشتری
function CustomerDetail({ id, fields, canManage, onBack }) {
  const { toast } = useStore();
  const [c, setC] = useState(null);
  const [editCust, setEditCust] = useState(null);
  const [contact, setContact] = useState(null);
  const [activity, setActivity] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try { const r = await api(`/crm/customers/${id}`); setC(r.customer); }
    catch (e) { toast(e.message, 'error'); onBack(); }
  };
  useEffect(() => { load(); }, [id]);
  if (!c) return <div className="content"><div className="empty">در حال بارگذاری…</div></div>;

  const [sl, sc] = CUSTOMER_STATUS[c.status] || CUSTOMER_STATUS.lead;

  const saveContact = async () => {
    setBusy(true);
    try {
      if (contact.id) await api(`/crm/contacts/${contact.id}`, { method: 'PUT', body: contact });
      else await api(`/crm/customers/${c.id}/contacts`, { method: 'POST', body: contact });
      setContact(null); await load(); toast('مخاطب ذخیره شد');
    } catch (e) { toast(e.message, 'error'); }
    setBusy(false);
  };

  const saveActivity = async () => {
    setBusy(true);
    try {
      if (activity.id) await api(`/crm/activities/${activity.id}`, { method: 'PUT', body: activity });
      else await api(`/crm/customers/${c.id}/activities`, { method: 'POST', body: activity });
      setActivity(null); await load(); toast('گزارش ثبت شد');
    } catch (e) { toast(e.message, 'error'); }
    setBusy(false);
  };

  const delContact = async (cid) => {
    try { await api(`/crm/contacts/${cid}`, { method: 'DELETE' }); await load(); }
    catch (e) { toast(e.message, 'error'); }
  };
  const delActivity = async (aid) => {
    try { await api(`/crm/activities/${aid}`, { method: 'DELETE' }); await load(); }
    catch (e) { toast(e.message, 'error'); }
  };
  const toggleFollowDone = async (a) => {
    try { await api(`/crm/activities/${a.id}`, { method: 'PUT', body: { follow_up_done: a.follow_up_done ? 0 : 1 } }); await load(); }
    catch (e) { toast(e.message, 'error'); }
  };
  const removeCustomer = async () => {
    if (!window.confirm(`مشتری «${c.name}» با همهٔ مخاطبین، گزارش‌ها و معاملاتش حذف شود؟`)) return;
    try { await api(`/crm/customers/${c.id}`, { method: 'DELETE' }); toast('مشتری حذف شد'); onBack(); }
    catch (e) { toast(e.message, 'error'); }
  };

  return (
    <div className="content">
      <div className="page-head">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button className="icon-btn" onClick={onBack}><ArrowRight size={18} /></button>
          <div>
            <h2>{c.name}</h2>
            <div style={{ fontSize: 12.8, color: 'var(--text-2)' }}>
              {c.industry || 'بدون حوزهٔ فعالیت'} · {c.city || 'بدون شهر'} · مسئول: {c.owner_name || '—'}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span className={`badge ${sc}`} style={{ fontSize: 13 }}>{sl}</span>
          <button className="btn btn-ghost btn-sm" onClick={() => setEditCust({ ...c })}><Pencil size={14} /> ویرایش</button>
          {canManage && (
            <button className="btn btn-ghost btn-sm" style={{ color: 'var(--red)' }} onClick={removeCustomer}>
              <Trash2 size={14} /> حذف مشتری
            </button>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <div className="card card-pad" style={{ flex: 1, minWidth: 150 }}>
          <small style={{ color: 'var(--text-3)' }}>فروش موفق</small>
          <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--green)' }}>{money(c.won_amount)}</div>
        </div>
        <div className="card card-pad" style={{ flex: 1, minWidth: 150 }}>
          <small style={{ color: 'var(--text-3)' }}>معاملات باز</small>
          <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--primary)' }}>{money(c.open_amount)}</div>
        </div>
        <div className="card card-pad" style={{ flex: 1, minWidth: 120 }}>
          <small style={{ color: 'var(--text-3)' }}>مخاطبین</small>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{fa(c.contacts.length)}</div>
        </div>
        <div className="card card-pad" style={{ flex: 1, minWidth: 120 }}>
          <small style={{ color: 'var(--text-3)' }}>گزارش‌ها</small>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{fa(c.activities.length)}</div>
        </div>
      </div>

      <div className="grid-2">
        <div>
          {/* اطلاعات پایه */}
          <div className="card card-pad" style={{ marginBottom: 18 }}>
            <b style={{ display: 'block', marginBottom: 12 }}>اطلاعات مشتری</b>
            {[
              ['تلفن', c.phone], ['ایمیل', c.email], ['وب‌سایت', c.website],
              ['کد اقتصادی', c.economic_code], ['شناسه/کد ملی', c.national_id],
              ['کد پستی', c.postal_code], ['نحوهٔ آشنایی', c.source],
              ['واحد مسئول', c.department_name], ['آدرس', c.address], ['توضیحات', c.note],
            ].filter(([, v]) => v).map(([k, v]) => (
              <div key={k} style={{ display: 'flex', gap: 10, padding: '7px 0', borderBottom: '1px solid var(--border-soft)' }}>
                <span style={{ color: 'var(--text-2)', fontSize: 13, minWidth: 120 }}>{k}:</span>
                <span style={{ fontWeight: 600, fontSize: 13, whiteSpace: 'pre-wrap' }}>{v}</span>
              </div>
            ))}
            {fields.filter(f => f.entity === 'customer' && c.extra?.[f.key]).map(f => (
              <div key={f.key} style={{ display: 'flex', gap: 10, padding: '7px 0', borderBottom: '1px solid var(--border-soft)' }}>
                <span style={{ color: 'var(--text-2)', fontSize: 13, minWidth: 120 }}>{f.label}:</span>
                <span style={{ fontWeight: 600, fontSize: 13 }}>{c.extra[f.key]}</span>
              </div>
            ))}
          </div>

          {/* مخاطبین */}
          <div className="card card-pad">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <b>مخاطبین</b>
              <button className="btn btn-ghost btn-sm" onClick={() => setContact({ extra: {} })}><Plus size={14} /> مخاطب</button>
            </div>
            {c.contacts.length === 0 && <div style={{ color: 'var(--text-3)', fontSize: 12.8 }}>مخاطبی ثبت نشده است</div>}
            {c.contacts.map(ct => (
              <div key={ct.id} style={{ display: 'flex', gap: 10, padding: '9px 0', borderBottom: '1px solid var(--border-soft)', alignItems: 'baseline' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <b style={{ fontSize: 13.3 }}>
                    {ct.first_name} {ct.last_name}
                    {!!ct.is_primary && <Star size={12} style={{ marginRight: 5, color: 'var(--amber)' }} />}
                  </b>
                  {ct.position && <span style={{ fontSize: 12.3, color: 'var(--text-3)', marginRight: 6 }}>{ct.position}</span>}
                  <div style={{ fontSize: 12.3, color: 'var(--text-2)', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                    {ct.mobile && <span><Phone size={11} /> {ct.mobile}</span>}
                    {ct.phone && <span><Phone size={11} /> {ct.phone}</span>}
                    {ct.email && <span><Mail size={11} /> {ct.email}</span>}
                  </div>
                  {ct.note && <div style={{ fontSize: 12.2, color: 'var(--text-3)' }}>{ct.note}</div>}
                </div>
                <button className="icon-btn" style={{ width: 28, height: 28 }} onClick={() => setContact({ ...ct })}><Pencil size={13} /></button>
                <button className="icon-btn" style={{ width: 28, height: 28, color: 'var(--red)' }} onClick={() => delContact(ct.id)}><Trash2 size={13} /></button>
              </div>
            ))}
          </div>
        </div>

        <div>
          {/* معاملات */}
          <div className="card card-pad" style={{ marginBottom: 18 }}>
            <b style={{ display: 'block', marginBottom: 12 }}>معاملات / فروش</b>
            {c.deals.length === 0 && <div style={{ color: 'var(--text-3)', fontSize: 12.8 }}>معامله‌ای ثبت نشده است</div>}
            {c.deals.map(d => {
              const [dl, dc] = DEAL_STAGE[d.stage] || DEAL_STAGE.new;
              return (
                <div key={d.id} style={{ display: 'flex', gap: 10, padding: '9px 0', borderBottom: '1px solid var(--border-soft)', alignItems: 'baseline' }}>
                  <span className={`badge ${dc}`}>{dl}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <b style={{ fontSize: 13.3 }}>{d.title}</b>
                    <div style={{ fontSize: 12.3, color: 'var(--text-2)' }}>
                      {money(d.amount)} {d.owner_name ? `· ${d.owner_name}` : ''}
                    </div>
                  </div>
                  <span style={{ fontSize: 11.5, color: 'var(--text-3)' }}>{fmtDate(d.created_at)}</span>
                </div>
              );
            })}
          </div>

          {/* گزارش‌ها و پیگیری‌ها */}
          <div className="card card-pad">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <b>گزارش‌ها و پیگیری‌ها</b>
              <button className="btn btn-ghost btn-sm" onClick={() => setActivity({ type: 'call' })}>
                <Plus size={14} /> ثبت گزارش
              </button>
            </div>
            {c.activities.length === 0 && <div style={{ color: 'var(--text-3)', fontSize: 12.8 }}>گزارشی ثبت نشده است</div>}
            {c.activities.map(a => (
              <div key={a.id} style={{ display: 'flex', gap: 10, padding: '9px 0', borderBottom: '1px solid var(--border-soft)', alignItems: 'baseline' }}>
                <span className="badge badge-sky">{ACTIVITY_TYPE[a.type] || a.type}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  {a.subject && <b style={{ fontSize: 13.3 }}>{a.subject}</b>}
                  {a.body && <div style={{ fontSize: 12.8, color: 'var(--text-2)', whiteSpace: 'pre-wrap' }}>{a.body}</div>}
                  {a.outcome && <div style={{ fontSize: 12.3, color: 'var(--text-3)' }}>نتیجه: {a.outcome}</div>}
                  <div style={{ fontSize: 11.5, color: 'var(--text-3)', marginTop: 3 }}>
                    {a.user_name} · {fmtDateTime(a.happened_at)}
                    {(a.contact_first || a.contact_last) && ` · با ${a.contact_first || ''} ${a.contact_last || ''}`}
                  </div>
                  {a.follow_up_at && (
                    <button className={`badge ${a.follow_up_done ? 'badge-green' : new Date(a.follow_up_at) <= new Date() ? 'badge-red' : 'badge-amber'}`}
                      style={{ marginTop: 5, cursor: 'pointer', border: 'none' }} onClick={() => toggleFollowDone(a)}
                      title={a.follow_up_done ? 'انجام شد — برای برگرداندن کلیک کنید' : 'برای علامت‌زدن به‌عنوان انجام‌شده کلیک کنید'}>
                      {a.follow_up_done ? <Check size={11} /> : <CalendarClock size={11} />} پیگیری: {fmtDate(a.follow_up_at)}
                    </button>
                  )}
                </div>
                <button className="icon-btn" style={{ width: 28, height: 28 }} onClick={() => setActivity({ ...a })}><Pencil size={13} /></button>
                <button className="icon-btn" style={{ width: 28, height: 28, color: 'var(--red)' }} onClick={() => delActivity(a.id)}><Trash2 size={13} /></button>
              </div>
            ))}
          </div>
        </div>
      </div>

      {editCust && (
        <CustomerModal value={editCust} fields={fields.filter(f => f.entity === 'customer')}
          onClose={() => setEditCust(null)} onDone={() => { setEditCust(null); load(); }} />
      )}

      {contact && (
        <Modal title={contact.id ? 'ویرایش مخاطب' : 'مخاطب جدید'} onClose={() => setContact(null)}
          footer={<>
            <button className="btn btn-ghost" onClick={() => setContact(null)}>انصراف</button>
            <button className="btn btn-primary" disabled={busy} onClick={saveContact}>ذخیره</button>
          </>}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Field label="نام"><input className="input" autoFocus value={contact.first_name || ''} onChange={e => setContact(x => ({ ...x, first_name: e.target.value }))} /></Field>
            <Field label="نام خانوادگی"><input className="input" value={contact.last_name || ''} onChange={e => setContact(x => ({ ...x, last_name: e.target.value }))} /></Field>
            <Field label="سمت"><input className="input" value={contact.position || ''} onChange={e => setContact(x => ({ ...x, position: e.target.value }))} /></Field>
            <Field label="موبایل"><input className="input" value={contact.mobile || ''} onChange={e => setContact(x => ({ ...x, mobile: e.target.value }))} /></Field>
            <Field label="تلفن ثابت"><input className="input" value={contact.phone || ''} onChange={e => setContact(x => ({ ...x, phone: e.target.value }))} /></Field>
            <Field label="ایمیل"><input className="input" value={contact.email || ''} onChange={e => setContact(x => ({ ...x, email: e.target.value }))} /></Field>
          </div>
          <Field label="توضیحات"><textarea className="input" value={contact.note || ''} onChange={e => setContact(x => ({ ...x, note: e.target.value }))} /></Field>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
            <input type="checkbox" checked={!!contact.is_primary} onChange={e => setContact(x => ({ ...x, is_primary: e.target.checked }))} />
            مخاطب اصلی این مشتری
          </label>
          <ExtraFields fields={fields.filter(f => f.entity === 'contact')} value={contact.extra}
            onChange={x => setContact(v => ({ ...v, extra: x }))} />
        </Modal>
      )}

      {activity && (
        <Modal title={activity.id ? 'ویرایش گزارش' : 'ثبت گزارش / پیگیری'} onClose={() => setActivity(null)}
          footer={<>
            <button className="btn btn-ghost" onClick={() => setActivity(null)}>انصراف</button>
            <button className="btn btn-primary" disabled={busy} onClick={saveActivity}>ذخیره</button>
          </>}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Field label="نوع">
              <select className="input" value={activity.type || 'call'} onChange={e => setActivity(x => ({ ...x, type: e.target.value }))}>
                {Object.entries(ACTIVITY_TYPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
            <Field label="مخاطب مرتبط">
              <select className="input" value={activity.contact_id || ''} onChange={e => setActivity(x => ({ ...x, contact_id: e.target.value ? Number(e.target.value) : null }))}>
                <option value="">— بدون مخاطب مشخص —</option>
                {c.contacts.map(ct => <option key={ct.id} value={ct.id}>{ct.first_name} {ct.last_name}</option>)}
              </select>
            </Field>
          </div>
          <Field label="موضوع"><input className="input" autoFocus value={activity.subject || ''} onChange={e => setActivity(x => ({ ...x, subject: e.target.value }))} /></Field>
          <Field label="شرح گزارش"><textarea className="input" style={{ minHeight: 90 }} value={activity.body || ''} onChange={e => setActivity(x => ({ ...x, body: e.target.value }))} /></Field>
          <Field label="نتیجه"><input className="input" value={activity.outcome || ''} onChange={e => setActivity(x => ({ ...x, outcome: e.target.value }))} /></Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Field label="معاملهٔ مرتبط">
              <select className="input" value={activity.deal_id || ''} onChange={e => setActivity(x => ({ ...x, deal_id: e.target.value ? Number(e.target.value) : null }))}>
                <option value="">— بدون معامله —</option>
                {c.deals.map(d => <option key={d.id} value={d.id}>{d.title}</option>)}
              </select>
            </Field>
            <Field label="تاریخ پیگیری بعدی" hint="خالی بگذارید اگر پیگیری لازم نیست">
              <input className="input" type="date" value={(activity.follow_up_at || '').slice(0, 10)}
                onChange={e => setActivity(x => ({ ...x, follow_up_at: e.target.value }))} />
            </Field>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- فروش
function DealsTable({ deals, onEdit, onReload, canManage }) {
  const { toast } = useStore();
  const remove = async (d) => {
    if (!window.confirm(`معاملهٔ «${d.title}» حذف شود؟`)) return;
    try { await api(`/crm/deals/${d.id}`, { method: 'DELETE' }); onReload(); }
    catch (e) { toast(e.message, 'error'); }
  };
  const totals = {
    open: deals.filter(d => !['won', 'lost'].includes(d.stage)).reduce((s, d) => s + Number(d.amount || 0), 0),
    won: deals.filter(d => d.stage === 'won').reduce((s, d) => s + Number(d.amount || 0), 0),
  };
  return (
    <>
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <div className="card card-pad" style={{ flex: 1, minWidth: 170 }}>
          <small style={{ color: 'var(--text-3)' }}>مجموع معاملات باز</small>
          <div style={{ fontSize: 19, fontWeight: 700, color: 'var(--primary)' }}>{money(totals.open)}</div>
        </div>
        <div className="card card-pad" style={{ flex: 1, minWidth: 170 }}>
          <small style={{ color: 'var(--text-3)' }}>مجموع فروش موفق</small>
          <div style={{ fontSize: 19, fontWeight: 700, color: 'var(--green)' }}>{money(totals.won)}</div>
        </div>
      </div>
      <div className="card">
        {deals.length === 0 ? (
          <div className="empty"><Handshake size={40} /><div>معامله‌ای ثبت نشده است</div></div>
        ) : (
          <table className="table">
            <thead>
              <tr><th>عنوان</th><th>مشتری</th><th>مبلغ</th><th>مرحله</th><th>احتمال</th><th>مسئول</th><th>ثبت</th><th></th></tr>
            </thead>
            <tbody>
              {deals.map(d => {
                const [dl, dc] = DEAL_STAGE[d.stage] || DEAL_STAGE.new;
                return (
                  <tr key={d.id}>
                    <td style={{ fontWeight: 600 }}>{d.title}</td>
                    <td>{d.customer_name}</td>
                    <td style={{ fontSize: 12.5 }}>{money(d.amount)}</td>
                    <td><span className={`badge ${dc}`}>{dl}</span></td>
                    <td>{fa(d.probability)}٪</td>
                    <td style={{ fontSize: 12.3 }}>{d.owner_name || '—'}</td>
                    <td style={{ fontSize: 12.3, color: 'var(--text-3)' }}>{fmtDate(d.created_at)}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button className="icon-btn" style={{ width: 28, height: 28 }} onClick={() => onEdit({ ...d })}><Pencil size={13} /></button>
                        {canManage && (
                          <button className="icon-btn" style={{ width: 28, height: 28, color: 'var(--red)' }} onClick={() => remove(d)}><Trash2 size={13} /></button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

function DealModal({ value, customers, fields, onClose, onDone }) {
  const { toast, settings } = useStore();
  const [v, setV] = useState(value);
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState({ summary: '', went_well: '', went_wrong: '', blockers: '', next_action: '', confidence: value.probability || 0 });
  const [history, setHistory] = useState([]);
  const [items, setItems] = useState([]);        // اقلامِ معامله (پیش‌فاکتور)
  const [products, setProducts] = useState([]);
  const set = (patch) => setV(x => ({ ...x, ...patch }));
  const stageChanged = !!v.id && v.stage !== value.stage;
  // دلایل باختِ از‌پیش‌تعریف‌شده در تنظیمات سازمان — برای تحلیلِ یکدست
  const lostReasons = String(settings?.crm_lost_reasons || '').split('،').map(x => x.trim()).filter(Boolean);

  // تاریخچهٔ گزارش‌ها و اقلامِ همین معامله
  useEffect(() => {
    api('/crm/products?active=1').then(r => setProducts(r.products)).catch(() => {});
    if (!value.id) return;
    api(`/crm/deals/${value.id}/stage-reports`).then(r => setHistory(r.reports)).catch(() => {});
    api(`/crm/deals/${value.id}/items`).then(r => setItems(r.items || [])).catch(() => {});
  }, [value.id]);

  // جمعِ اقلام — همان فرمولِ سرور تا عددی که کاربر می‌بیند با ذخیره‌شده یکی باشد
  const totals = items.reduce((acc, it) => {
    const line = (Number(it.qty) || 0) * (Number(it.unit_price) || 0);
    const net = line * (1 - (Number(it.discount_pct) || 0) / 100);
    acc.net += net;
    acc.tax += net * ((Number(it.tax_pct) || 0) / 100);
    acc.cost += (Number(it.qty) || 0) * (Number(it.cost) || 0);
    return acc;
  }, { net: 0, tax: 0, cost: 0 });
  totals.total = totals.net + totals.tax;
  totals.margin = totals.net > 0 ? Math.round(((totals.net - totals.cost) / totals.net) * 1000) / 10 : null;

  const setItem = (i, patch) => setItems(list => list.map((it, j) => (j === i ? { ...it, ...patch } : it)));
  const pickProduct = (i, pid) => {
    const p = products.find(x => x.id === Number(pid));
    if (!p) return setItem(i, { product_id: null });
    setItem(i, { product_id: p.id, title: p.name, unit: p.unit, unit_price: p.list_price, cost: p.cost });
  };

  const save = async () => {
    if (!String(v.title || '').trim()) return toast('عنوان معامله الزامی است', 'error');
    if (!v.customer_id) return toast('مشتری را انتخاب کنید', 'error');
    // با تغییر مرحله، نوشتنِ گزارش الزامی است — این متن‌ها پایهٔ تحلیل عملکردند
    if (stageChanged && !String(report.summary || '').trim()) {
      return toast('برای تغییر مرحله، بخش «چه اتفاقی افتاد؟» را پر کنید', 'error');
    }
    if (v.stage === 'lost' && !String(v.lost_reason || '').trim()) {
      return toast('برای معاملهٔ باخته، دلیل باخت را مشخص کنید', 'error');
    }
    setBusy(true);
    try {
      // اگر قلمی وارد شده، مبلغِ معامله از روی اقلام محاسبه می‌شود
      const body = { ...v, stage_report: report };
      if (items.length) body.amount = totals.total;
      let dealId = v.id;
      if (v.id) await api(`/crm/deals/${v.id}`, { method: 'PUT', body });
      else dealId = (await api('/crm/deals', { method: 'POST', body })).id;
      if (dealId && (items.length || v.id)) {
        await api(`/crm/deals/${dealId}/items`, { method: 'PUT', body: { items } });
      }
      onDone(); toast(v.id ? 'معامله ویرایش شد' : 'معامله ثبت شد');
    } catch (e) { toast(e.message, 'error'); }
    setBusy(false);
  };

  return (
    <Modal title={v.id ? `ویرایش «${value.title}»` : 'معاملهٔ جدید'} onClose={onClose}
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>انصراف</button>
        <button className="btn btn-primary" disabled={busy} onClick={save}>ذخیره</button>
      </>}>
      <Field label="مشتری *">
        <select className="input" value={v.customer_id || ''} onChange={e => set({ customer_id: Number(e.target.value) })}>
          <option value="">— انتخاب مشتری —</option>
          {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </Field>
      <Field label="عنوان معامله *">
        <input className="input" value={v.title || ''} placeholder="مثلاً: فروش ۵ تن کابل مسی"
          onChange={e => set({ title: e.target.value })} />
      </Field>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <Field label="مبلغ (ریال)"
          hint={items.length ? 'از جمعِ اقلام محاسبه می‌شود' : undefined}>
          <input className="input" type="number" min="0" disabled={items.length > 0}
            value={items.length ? Math.round(totals.total) : (v.amount ?? 0)}
            onChange={e => set({ amount: Number(e.target.value) })} />
        </Field>
        <Field label="مرحله">
          <select className="input" value={v.stage || 'new'} onChange={e => set({ stage: e.target.value })}>
            {Object.entries(DEAL_STAGE).map(([k, s]) => <option key={k} value={k}>{s[0]}</option>)}
          </select>
        </Field>
        <Field label="احتمال موفقیت (٪)">
          <input className="input" type="number" min="0" max="100" value={v.probability ?? 0} onChange={e => set({ probability: Number(e.target.value) })} />
        </Field>
        <Field label="تاریخ پیش‌بینی‌شدهٔ نهایی‌شدن">
          <input className="input" type="date" value={(v.expected_close || '').slice(0, 10)} onChange={e => set({ expected_close: e.target.value })} />
        </Field>
      </div>
      <Field label="کالا / خدمات"><input className="input" value={v.product || ''} onChange={e => set({ product: e.target.value })} /></Field>
      <Field label="کارشناس مسئول"><UserPicker value={v.owner_id} onChange={id => set({ owner_id: id })} /></Field>
      {v.stage === 'lost' && (
        <Field label="دلیل باخت *"
          hint="از فهرست انتخاب کنید تا در گزارش «دلایل باخت» دسته‌بندی درست انجام شود.">
          <input className="input" list="crm-lost-reasons" value={v.lost_reason || ''}
            placeholder="مثلاً: قیمت بالا" onChange={e => set({ lost_reason: e.target.value })} />
          <datalist id="crm-lost-reasons">
            {lostReasons.map(x => <option key={x} value={x} />)}
          </datalist>
        </Field>
      )}
      <Field label="توضیحات"><textarea className="input" value={v.note || ''} onChange={e => set({ note: e.target.value })} /></Field>
      <ExtraFields fields={fields} value={v.extra} onChange={x => set({ extra: x })} />

      {/* [اقلام] پیش‌فاکتور — اگر قلمی وارد شود، مبلغِ معامله از روی همین‌ها محاسبه می‌شود */}
      <div className="card-pad panel-soft" style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <div style={{ fontSize: 12.8, fontWeight: 700 }}>
            <Package size={14} style={{ verticalAlign: '-2px', marginLeft: 5 }} />
            اقلام معامله (پیش‌فاکتور)
          </div>
          <button className="btn btn-ghost btn-sm" type="button"
            onClick={() => setItems(l => [...l, { title: '', unit: 'عدد', qty: 1, unit_price: 0, discount_pct: 0, tax_pct: 0, cost: 0 }])}>
            <Plus size={14} /> قلم
          </button>
        </div>
        <p style={{ fontSize: 11.8, color: 'var(--text-3)', margin: '0 0 10px', lineHeight: 1.9 }}>
          اختیاری است. اگر قلمی وارد کنید، مبلغ معامله خودکار از جمعِ اقلام محاسبه می‌شود
          و حاشیهٔ سود هم به‌دست می‌آید.
        </p>
        {items.length === 0 ? (
          <div style={{ fontSize: 12.3, color: 'var(--text-3)' }}>قلمی وارد نشده — مبلغ را دستی وارد کنید.</div>
        ) : (
          <>
            {items.map((it, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr .7fr .7fr 1.1fr .7fr auto', gap: 6, alignItems: 'end', marginBottom: 8 }}>
                <div>
                  {i === 0 && <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 3 }}>شرح</div>}
                  <input className="input" value={it.title} placeholder="شرح کالا/خدمت"
                    onChange={e => setItem(i, { title: e.target.value })} />
                </div>
                <div>
                  {i === 0 && <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 3 }}>از فهرست</div>}
                  <select className="input" value={it.product_id || ''} onChange={e => pickProduct(i, e.target.value)}>
                    <option value="">— دستی —</option>
                    {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
                <div>
                  {i === 0 && <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 3 }}>تعداد</div>}
                  <input className="input" type="number" min="0" step="0.01" value={it.qty}
                    onChange={e => setItem(i, { qty: Number(e.target.value) })} />
                </div>
                <div>
                  {i === 0 && <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 3 }}>واحد</div>}
                  <input className="input" value={it.unit || ''} onChange={e => setItem(i, { unit: e.target.value })} />
                </div>
                <div>
                  {i === 0 && <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 3 }}>قیمت واحد</div>}
                  <input className="input" type="number" min="0" value={it.unit_price}
                    onChange={e => setItem(i, { unit_price: Number(e.target.value) })} />
                </div>
                <div>
                  {i === 0 && <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 3 }}>تخفیف٪</div>}
                  <input className="input" type="number" min="0" max="100" value={it.discount_pct}
                    onChange={e => setItem(i, { discount_pct: Number(e.target.value) })} />
                </div>
                <button className="icon-btn" type="button" style={{ width: 30, height: 30, color: 'var(--red)' }}
                  onClick={() => setItems(l => l.filter((_, j) => j !== i))}><Trash2 size={13} /></button>
              </div>
            ))}
            <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', fontSize: 12.8, marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border-soft)' }}>
              <span>جمع کل: <b>{money(totals.total)}</b></span>
              {totals.tax > 0 && <span style={{ color: 'var(--text-2)' }}>مالیات: {money(totals.tax)}</span>}
              {totals.margin !== null && totals.cost > 0 && (
                <span style={{ color: totals.margin >= 15 ? 'var(--green)' : 'var(--amber)' }}>
                  حاشیهٔ سود: <b>{fa(totals.margin, 1)}٪</b>
                </span>
              )}
            </div>
          </>
        )}
      </div>

      {/* [گزارش مرحله‌ای] با هر تغییر مرحله، کارشناس گزارشش را می‌نویسد */}
      <div className="card-pad panel-soft" style={{ marginTop: 6 }}>
        <div style={{ fontSize: 12.8, fontWeight: 700, marginBottom: 4 }}>
          <FileText size={14} style={{ verticalAlign: '-2px', marginLeft: 5 }} />
          گزارش این مرحله {stageChanged && <span style={{ color: 'var(--red)' }}>*</span>}
        </div>
        <p style={{ fontSize: 11.8, color: 'var(--text-3)', margin: '0 0 12px', lineHeight: 1.9 }}>
          {stageChanged
            ? `مرحله از «${DEAL_STAGE[value.stage]?.[0] || value.stage}» به «${DEAL_STAGE[v.stage]?.[0] || v.stage}» تغییر می‌کند — بنویسید چه شد.`
            : 'هرچه دقیق‌تر بنویسید، تحلیل عملکرد و پیشنهادهای بهبود دقیق‌تر می‌شود.'}
        </p>
        <StageReportFields value={report} onChange={setReport} />
      </div>

      {history.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <b style={{ display: 'block', marginBottom: 6, fontSize: 13 }}>گزارش‌های قبلیِ این معامله</b>
          <StageReportList reports={history} />
        </div>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------- پیگیری‌ها
function FollowUps({ rows, onOpen, onReload }) {
  const { toast } = useStore();
  const done = async (a) => {
    try { await api(`/crm/activities/${a.id}`, { method: 'PUT', body: { follow_up_done: 1 } }); onReload(); }
    catch (e) { toast(e.message, 'error'); }
  };
  if (!rows.length) {
    return <div className="card"><div className="empty"><CalendarClock size={40} /><div>پیگیریِ بازی ندارید</div></div></div>;
  }
  return (
    <div className="card">
      <table className="table">
        <thead><tr><th>تاریخ پیگیری</th><th>مشتری</th><th>موضوع</th><th>مسئول</th><th></th></tr></thead>
        <tbody>
          {rows.map(a => {
            const overdue = new Date(a.follow_up_at) <= new Date();
            return (
              <tr key={a.id}>
                <td>
                  <span className={`badge ${overdue ? 'badge-red' : 'badge-amber'}`}>
                    <CalendarClock size={11} /> {fmtDate(a.follow_up_at)}
                  </span>
                </td>
                <td>
                  <a href="#" onClick={e => { e.preventDefault(); onOpen(a.customer_id); }}
                    style={{ fontWeight: 600, color: 'var(--primary)' }}>{a.customer_name}</a>
                </td>
                <td style={{ fontSize: 12.8 }}>{a.subject || a.body?.slice(0, 60) || '—'}</td>
                <td style={{ fontSize: 12.3 }}>{a.user_name || '—'}</td>
                <td>
                  <button className="btn btn-ghost btn-sm" onClick={() => done(a)}><Check size={14} /> انجام شد</button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}


// ---------------------------------------------------------------- گزارش‌های مرحله‌ای
// کارشناس در هر جابه‌جاییِ مرحله می‌نویسد چه شد، چه خوب بود، چه بد بود و قدم بعدی چیست.
// همین متن‌ها هم ورودیِ گزارش‌های مدیریتی‌اند و هم خوراکِ دستیار هوشمند.
export function StageReportFields({ value, onChange, showConfidence = true }) {
  const set = (k, v) => onChange({ ...value, [k]: v });
  return (
    <>
      <Field label="چه اتفاقی افتاد؟" hint="خلاصهٔ آنچه در این مرحله گذشت">
        <textarea className="input" value={value.summary || ''} onChange={e => set('summary', e.target.value)}
          placeholder="مثلاً: جلسهٔ فنی با مدیر خرید برگزار شد و نمونه ارسال کردیم." />
      </Field>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <Field label="چه چیزی خوب پیش رفت؟">
          <textarea className="input" value={value.went_well || ''} onChange={e => set('went_well', e.target.value)}
            placeholder="نقاط قوت این مرحله" />
        </Field>
        <Field label="چه چیزی خوب پیش نرفت؟">
          <textarea className="input" value={value.went_wrong || ''} onChange={e => set('went_wrong', e.target.value)}
            placeholder="اشتباه‌ها و ضعف‌ها — صادقانه بنویسید تا قابل بهبود باشد" />
        </Field>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <Field label="موانع و ریسک‌ها">
          <textarea className="input" value={value.blockers || ''} onChange={e => set('blockers', e.target.value)}
            placeholder="چه چیزی جلوی پیشرفت را می‌گیرد؟" />
        </Field>
        <Field label="قدم بعدی">
          <textarea className="input" value={value.next_action || ''} onChange={e => set('next_action', e.target.value)}
            placeholder="دقیقاً قرار است چه کاری انجام شود؟" />
        </Field>
      </div>
      {showConfidence && (
        <Field label={`اطمینان شما به موفقیت این معامله: ${fa(value.confidence || 0)}٪`}>
          <input type="range" min="0" max="100" step="5" style={{ width: '100%' }}
            value={value.confidence || 0} onChange={e => set('confidence', Number(e.target.value))} />
        </Field>
      )}
    </>
  );
}

export function StageReportList({ reports, onEdit, onDelete, showDeal = false }) {
  if (!reports?.length) {
    return <div style={{ fontSize: 12.8, color: 'var(--text-3)' }}>هنوز گزارشی برای این معامله نوشته نشده است</div>;
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {reports.map(r => {
        const [sl, sc] = DEAL_STAGE[r.stage] || DEAL_STAGE.new;
        return (
          <div key={r.id} style={{ padding: '10px 0', borderBottom: '1px solid var(--border-soft)' }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              {r.from_stage && r.from_stage !== r.stage && (
                <span className="badge badge-gray">{DEAL_STAGE[r.from_stage]?.[0] || r.from_stage} ←</span>
              )}
              <span className={`badge ${sc}`}>{sl}</span>
              {showDeal && r.deal_title && (
                <b style={{ fontSize: 13 }}>{r.deal_title}{r.customer_name ? ` — ${r.customer_name}` : ''}</b>
              )}
              <span style={{ fontSize: 11.5, color: 'var(--text-3)', marginInlineStart: 'auto' }}>
                {r.user_name || ''} · {fmtDateTime(r.created_at)}
              </span>
              {onEdit && (
                <button className="icon-btn" style={{ width: 26, height: 26 }} onClick={() => onEdit(r)}><Pencil size={12} /></button>
              )}
              {onDelete && (
                <button className="icon-btn" style={{ width: 26, height: 26, color: 'var(--red)' }} onClick={() => onDelete(r)}><Trash2 size={12} /></button>
              )}
            </div>
            {r.summary && <div style={{ fontSize: 12.8, marginTop: 5, whiteSpace: 'pre-wrap' }}>{r.summary}</div>}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8, marginTop: 6 }}>
              {[
                ['چه خوب بود', r.went_well, 'var(--chart-a)'],
                ['چه بد بود', r.went_wrong, 'var(--chart-b)'],
                ['موانع', r.blockers, 'var(--text-2)'],
                ['قدم بعدی', r.next_action, 'var(--primary)'],
              ].filter(([, v]) => v).map(([label, v, color]) => (
                <div key={label} style={{ fontSize: 12.3 }}>
                  <b style={{ color, fontSize: 11.5 }}>{label}:</b>
                  <div style={{ color: 'var(--text-2)', whiteSpace: 'pre-wrap' }}>{v}</div>
                </div>
              ))}
            </div>
            {r.confidence > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, fontSize: 12 }}>
                <span style={{ color: 'var(--text-3)' }}>اطمینان:</span>
                <MiniBar value={r.confidence} max={100} width={80} />
                <b>{fa(r.confidence)}٪</b>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------- گزارش فروش
const MONTH_FA = ['ژانویه', 'فوریه', 'مارس', 'آوریل', 'مه', 'ژوئن', 'ژوئیه', 'اوت', 'سپتامبر', 'اکتبر', 'نوامبر', 'دسامبر'];
// «۲۰۲۶-۰۸» → برچسبِ کوتاهِ خوانا
const monthLabel = (m) => {
  const [y, mm] = String(m || '').split('-');
  if (!y || !mm) return m;
  return `${MONTH_FA[Number(mm) - 1] || mm} ${fa(Number(y)).replace(/٬/g, '')}`;
};

// نرخ موفقیت را همه‌جا یکسان نشان می‌دهیم: «—» یعنی هنوز معاملهٔ بسته‌شده‌ای نبوده
const rateText = (v) => (v === null || v === undefined ? '—' : `${fa(v, 1)}٪`);

function SalesReport({ onOpenPerformance }) {
  const { departments, users, toast } = useStore();
  const [rep, setRep] = useState(null);
  const [busy, setBusy] = useState(false);
  const [filters, setFilters] = useState({ from: '', to: '', department_id: '', owner_id: '' });

  const load = async () => {
    setBusy(true);
    try {
      const qs = new URLSearchParams(Object.entries(filters).filter(([, v]) => v)).toString();
      setRep(await api(`/crm/reports${qs ? '?' + qs : ''}`));
    } catch (e) { toast(e.message, 'error'); }
    setBusy(false);
  };
  useEffect(() => { load(); }, []);
  if (!rep) return <div className="card"><div className="empty">در حال بارگذاری…</div></div>;

  const s = rep.summary;
  const monthly = rep.monthly.map(m => ({ ...m, label: monthLabel(m.month) }));
  const stageOrder = ['new', 'quoted', 'negotiation', 'won', 'lost'];
  const funnel = stageOrder.map(k => {
    const row = rep.by_stage.find(x => x.stage === k) || { count: 0, amount: 0 };
    return { key: k, label: DEAL_STAGE[k][0], count: row.count, amount: row.amount };
  });

  return (
    <>
      {/* ---- فیلترها: یک ردیف بالای نمودارها ---- */}
      <div className="card card-pad" style={{ marginBottom: 16, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'end' }}>
        <div>
          <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--text-2)', marginBottom: 6 }}>از تاریخ</label>
          <input className="input" type="date" value={filters.from} onChange={e => setFilters(f => ({ ...f, from: e.target.value }))} />
        </div>
        <div>
          <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--text-2)', marginBottom: 6 }}>تا تاریخ</label>
          <input className="input" type="date" value={filters.to} onChange={e => setFilters(f => ({ ...f, to: e.target.value }))} />
        </div>
        <div>
          <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--text-2)', marginBottom: 6 }}>واحد</label>
          <select className="input" value={filters.department_id} onChange={e => setFilters(f => ({ ...f, department_id: e.target.value }))}>
            <option value="">همه</option>
            {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </div>
        {!rep.scoped && (
          <div>
            <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--text-2)', marginBottom: 6 }}>کارشناس</label>
            <select className="input" value={filters.owner_id} onChange={e => setFilters(f => ({ ...f, owner_id: e.target.value }))}>
              <option value="">همه</option>
              {users.filter(u => u.is_active).map(u => <option key={u.id} value={u.id}>{u.full_name}</option>)}
            </select>
          </div>
        )}
        <button className="btn btn-primary" disabled={busy} onClick={load}><BarChart3 size={16} /> اعمال فیلتر</button>
        {rep.scoped && (
          <span style={{ fontSize: 12, color: 'var(--text-3)' }}>فقط معاملات خودتان نمایش داده می‌شود</span>
        )}
      </div>

      {/* ---- شاخص‌های سرصفحه ---- */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <Stat label="نرخ موفقیت" value={rateText(s.success_rate)} tone="good"
          sub={`${fa(s.won_count)} برنده از ${fa(s.won_count + s.lost_count)} معاملهٔ بسته‌شده`} />
        <Stat label="فروش موفق" value={money(s.won_amount)} tone="a" sub={`${fa(s.won_count)} معامله`} />
        <Stat label="در جریان" value={money(s.open_amount)} sub={`${fa(s.open_count)} معاملهٔ باز`} />
        <Stat label="میانگین ارزش معامله" value={money(Math.round(s.avg_won_amount))} sub="بر مبنای معاملات برنده" />
        <Stat label="میانگین طول چرخهٔ فروش" value={`${fa(s.avg_cycle_days, 1)} روز`} sub="از ثبت تا بسته‌شدن" />
        <Stat label="فرصت از‌دست‌رفته" value={money(s.lost_amount)} tone="b" sub={`${fa(s.lost_count)} معامله`} />
      </div>

      {rep.overdue_follow_ups > 0 && (
        <div className="card card-pad" style={{ marginBottom: 16, borderColor: 'var(--amber)', background: 'var(--amber-soft)' }}>
          <b style={{ fontSize: 13.5 }}>
            <CalendarClock size={15} style={{ verticalAlign: '-3px', marginLeft: 5 }} />
            {fa(rep.overdue_follow_ups)} پیگیریِ عقب‌افتاده دارید
          </b>
          <div style={{ fontSize: 12.5, color: 'var(--text-2)', marginTop: 3 }}>
            پیگیریِ به‌موقع بیشترین اثر را روی نرخ موفقیت دارد — تب «پیگیری‌ها» را ببینید.
          </div>
        </div>
      )}

      <div className="grid-2">
        {/* ---- قیف فروش ---- */}
        <div className="card card-pad" style={{ marginBottom: 18 }}>
          <b style={{ display: 'block', marginBottom: 4 }}>قیف فروش</b>
          <p style={{ fontSize: 12, color: 'var(--text-3)', margin: '0 0 12px' }}>
            چند معامله در هر مرحله مانده است؟ مرحله‌ای که معاملات در آن تلنبار می‌شود، گلوگاه شماست.
          </p>
          <Funnel stages={funnel} format={money} />
        </div>

        {/* ---- روند ماهانه: تعداد ---- */}
        <div className="card card-pad" style={{ marginBottom: 18 }}>
          <b style={{ display: 'block', marginBottom: 4 }}>روند ماهانه — تعداد معاملات</b>
          <p style={{ fontSize: 12, color: 'var(--text-3)', margin: '0 0 12px' }}>
            برنده و باخته در هر ماه، بر اساس تاریخ ثبت معامله.
          </p>
          <GroupedBars rows={monthly} series={[
            { key: 'won_count', label: 'برنده', color: 'var(--chart-a)' },
            { key: 'lost_count', label: 'باخته', color: 'var(--chart-b)' },
          ]} />
        </div>
      </div>

      <div className="grid-2">
        {/* ---- روند نرخ موفقیت (جدا از نمودار تعداد — بدون محور دوم) ---- */}
        <div className="card card-pad" style={{ marginBottom: 18 }}>
          <b style={{ display: 'block', marginBottom: 4 }}>روند نرخ موفقیت</b>
          <p style={{ fontSize: 12, color: 'var(--text-3)', margin: '0 0 12px' }}>
            درصد معاملاتی که در هر ماه به فروش رسیده‌اند (از بین معاملات بسته‌شدهٔ همان ماه).
          </p>
          <TrendLine rows={monthly} />
        </div>

        {/* ---- دلایل باخت ---- */}
        <div className="card card-pad" style={{ marginBottom: 18 }}>
          <b style={{ display: 'block', marginBottom: 4 }}>دلایل باخت</b>
          <p style={{ fontSize: 12, color: 'var(--text-3)', margin: '0 0 12px' }}>
            پرتکرارترین دلیل باخت، اولین چیزی است که باید برایش برنامه بریزید.
          </p>
          <RankedBars rows={rep.lost_reasons.map(r => ({ label: r.reason, value: r.count, amount: r.amount }))}
            color="var(--chart-b)"
            format={(v, r) => `${fa(v)} معامله · ${money(r.amount)}`}
            emptyText="هنوز معاملهٔ باخته‌ای ثبت نشده است" />
        </div>
      </div>

      <div className="grid-2">
        {/* ---- اثربخشی کانال ورودی ---- */}
        <div className="card card-pad" style={{ marginBottom: 18 }}>
          <b style={{ display: 'block', marginBottom: 4 }}>اثربخشی کانال آشنایی</b>
          <p style={{ fontSize: 12, color: 'var(--text-3)', margin: '0 0 12px' }}>
            مشتریانی که از کدام راه آمده‌اند بیشتر به فروش می‌رسند؟ روی کانالِ پربازده سرمایه‌گذاری کنید.
          </p>
          <RankedBars rows={rep.by_source.filter(x => x.success_rate !== null)
            .map(x => ({ label: x.source, value: x.success_rate, total: x.total, won: x.won_count }))}
            max={100}
            format={(v, r) => `${rateText(v)} — ${fa(r.won)} از ${fa(r.total)}`}
            emptyText="برای محاسبه، حداقل یک معاملهٔ بسته‌شده لازم است" />
        </div>

        {/* ---- اثربخشی پیگیری ---- */}
        <div className="card card-pad" style={{ marginBottom: 18 }}>
          <b style={{ display: 'block', marginBottom: 4 }}>اثر تعداد پیگیری بر موفقیت</b>
          <p style={{ fontSize: 12, color: 'var(--text-3)', margin: '0 0 12px' }}>
            معاملاتی که بیشتر پیگیری شده‌اند چقدر بیشتر برنده شده‌اند؟
          </p>
          <RankedBars rows={rep.by_touch.filter(x => x.success_rate !== null)
            .map(x => ({ label: x.bucket, value: x.success_rate, total: x.total, won: x.won_count }))}
            max={100} sequential
            format={(v, r) => `${rateText(v)} — ${fa(r.won)} از ${fa(r.total)}`}
            emptyText="داده‌ای برای تحلیل پیگیری نیست" />
        </div>
      </div>

      {/* ---- جدول عملکرد کارشناسان (همان نمای جدولیِ داده‌ها) ---- */}
      {!rep.scoped && (
        <div className="card" style={{ marginBottom: 18 }}>
          <div className="card-pad" style={{ paddingBottom: 0 }}>
            <b>عملکرد کارشناسان فروش</b>
            <p style={{ fontSize: 12, color: 'var(--text-3)', margin: '4px 0 0' }}>
              روی نام هر کارشناس بزنید تا تحلیل کاملِ عملکرد و گزارش‌هایش را ببینید.
            </p>
          </div>
          <table className="table">
            <thead>
              <tr>
                <th>کارشناس</th><th>کل معاملات</th><th>برنده</th><th>باخته</th><th>باز</th>
                <th>نرخ موفقیت</th><th>فروش موفق</th><th>میانگین چرخه</th>
              </tr>
            </thead>
            <tbody>
              {rep.by_owner.map((o, i) => (
                <tr key={i}>
                  <td>
                    {o.owner_id ? (
                      <a href="#" onClick={e => { e.preventDefault(); onOpenPerformance(o.owner_id); }}
                        style={{ fontWeight: 600, color: 'var(--primary)' }}>{o.owner_name}</a>
                    ) : o.owner_name}
                  </td>
                  <td>{fa(o.total)}</td>
                  <td style={{ color: 'var(--chart-a)', fontWeight: 600 }}>{fa(o.won_count)}</td>
                  <td style={{ color: 'var(--chart-b)', fontWeight: 600 }}>{fa(o.lost_count)}</td>
                  <td>{fa(o.open_count)}</td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <MiniBar value={o.success_rate ?? 0} max={100} width={70} />
                      <b>{rateText(o.success_rate)}</b>
                    </div>
                  </td>
                  <td style={{ fontSize: 12.5 }}>{money(o.won_amount)}</td>
                  <td style={{ fontSize: 12.5 }}>{o.avg_cycle_days ? `${fa(o.avg_cycle_days, 1)} روز` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!rep.scoped && rep.by_department.length > 0 && (
        <div className="card card-pad">
          <b style={{ display: 'block', marginBottom: 12 }}>فروش بر حسب واحد</b>
          <RankedBars rows={rep.by_department.map(d => ({ label: d.department_name, value: d.won_amount, rate: d.success_rate, count: d.total }))}
            format={(v, r) => `${money(v)} · نرخ ${rateText(r.rate)}`} />
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------- عملکرد فردی
// هر کارشناس بازرگانی نرخ موفقیت خودش، روندش، مقایسه با میانگین تیم و
// گزارش‌های خودش را می‌بیند تا بتواند برای دورهٔ بعد برنامه بریزد.
function MyPerformance({ userId, onBack }) {
  const { toast } = useStore();
  const [d, setD] = useState(null);

  const load = async () => {
    try { setD(await api(`/crm/my-performance${userId ? `?user_id=${userId}` : ''}`)); }
    catch (e) { toast(e.message, 'error'); onBack?.(); }
  };
  useEffect(() => { load(); }, [userId]);
  if (!d) return <div className="card"><div className="empty">در حال بارگذاری…</div></div>;

  const m = d.mine;
  const t = d.team;
  const monthly = d.monthly.map(x => ({ ...x, label: monthLabel(x.month) }));
  // مقایسه با میانگین تیم — تفاوت را با علامت و کلمه نشان می‌دهیم، نه فقط رنگ
  const diff = (m.success_rate !== null && t.avg_success_rate !== null)
    ? Math.round((m.success_rate - t.avg_success_rate) * 10) / 10 : null;

  return (
    <>
      {onBack && (
        <div style={{ marginBottom: 12 }}>
          <button className="btn btn-ghost btn-sm" onClick={onBack}><ArrowRight size={14} /> بازگشت به گزارش‌ها</button>
        </div>
      )}

      <div className="card card-pad" style={{ marginBottom: 16 }}>
        <b style={{ display: 'block', marginBottom: 10 }}>نرخ موفقیت {d.person.full_name}</b>
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center' }}>
          <Gauge
            value={m.success_rate ?? 0} max={100}
            label={rateText(m.success_rate)}
            caption={m.won_count + m.lost_count > 0
              ? `${fa(m.won_count)} برنده از ${fa(m.won_count + m.lost_count)} معاملهٔ بسته‌شده`
              : 'هنوز معاملهٔ بسته‌شده‌ای ندارید'}
            maxLabel="۱۰۰٪" size={215}
          />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9, minWidth: 230 }}>
            <div style={{ fontSize: 12.8 }}>
              <span style={{ color: 'var(--text-2)' }}>میانگین نرخ موفقیت تیم: </span>
              <b>{rateText(t.avg_success_rate)}</b>
            </div>
            {diff !== null && (
              <div style={{ fontSize: 12.8, fontWeight: 600, color: diff >= 0 ? 'var(--green)' : 'var(--amber)' }}>
                {diff >= 0
                  ? `شما ${fa(Math.abs(diff), 1)} واحد درصد بالاتر از میانگین تیم هستید`
                  : `شما ${fa(Math.abs(diff), 1)} واحد درصد پایین‌تر از میانگین تیم هستید`}
              </div>
            )}
            {t.rank > 0 && (
              <div style={{ fontSize: 12.8 }}>
                <span style={{ color: 'var(--text-2)' }}>رتبهٔ فروش شما: </span>
                <b>{fa(t.rank)} از {fa(t.people)}</b>
              </div>
            )}
            <div style={{ fontSize: 12.8 }}>
              <span style={{ color: 'var(--text-2)' }}>میانگین طول چرخهٔ فروشِ شما: </span>
              <b>{m.avg_cycle_days ? `${fa(m.avg_cycle_days, 1)} روز` : '—'}</b>
              {t.avg_cycle_days > 0 && (
                <span style={{ color: 'var(--text-3)' }}> (تیم: {fa(t.avg_cycle_days, 1)} روز)</span>
              )}
            </div>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <Stat label="فروش موفق شما" value={money(m.won_amount)} tone="a" sub={`${fa(m.won_count)} معامله`} />
        <Stat label="در جریان" value={money(m.open_amount)} sub={`${fa(m.open_count)} معاملهٔ باز`} />
        <Stat label="از‌دست‌رفته" value={money(m.lost_amount)} tone="b" sub={`${fa(m.lost_count)} معامله`} />
        <Stat label="میانگین ارزش معامله" value={money(Math.round(m.avg_won_amount))} sub="معاملات برنده" />
      </div>

      <div className="grid-2">
        <div className="card card-pad" style={{ marginBottom: 18 }}>
          <b style={{ display: 'block', marginBottom: 4 }}>روند نرخ موفقیت شما</b>
          <p style={{ fontSize: 12, color: 'var(--text-3)', margin: '0 0 12px' }}>
            اگر روند نزولی است، دلایل باختِ زیر را مرور کنید.
          </p>
          <TrendLine rows={monthly} />
        </div>
        <div className="card card-pad" style={{ marginBottom: 18 }}>
          <b style={{ display: 'block', marginBottom: 4 }}>معاملات شما به تفکیک ماه</b>
          <p style={{ fontSize: 12, color: 'var(--text-3)', margin: '0 0 12px' }}>برنده و باخته در هر ماه</p>
          <GroupedBars rows={monthly} series={[
            { key: 'won_count', label: 'برنده', color: 'var(--chart-a)' },
            { key: 'lost_count', label: 'باخته', color: 'var(--chart-b)' },
          ]} />
        </div>
      </div>

      <div className="grid-2">
        <div className="card card-pad" style={{ marginBottom: 18 }}>
          <b style={{ display: 'block', marginBottom: 4 }}>چرا معاملات شما را از دست دادید؟</b>
          <p style={{ fontSize: 12, color: 'var(--text-3)', margin: '0 0 12px' }}>
            پرتکرارترین دلیل، بهترین نقطه برای بهبود در دورهٔ بعد است.
          </p>
          <RankedBars rows={d.lost_reasons.map(r => ({ label: r.reason, value: r.count }))}
            color="var(--chart-b)" format={(v) => `${fa(v)} معامله`}
            emptyText="خوشبختانه معاملهٔ باخته‌ای ندارید" />
        </div>

        <div className="card card-pad" style={{ marginBottom: 18 }}>
          <b style={{ display: 'block', marginBottom: 4 }}>معاملات بازِ شما</b>
          <p style={{ fontSize: 12, color: 'var(--text-3)', margin: '0 0 12px' }}>
            معاملاتی که گزارششان کهنه شده با نشان کهربایی مشخص‌اند.
          </p>
          {d.open_deals.length === 0 ? (
            <div style={{ fontSize: 12.8, color: 'var(--text-3)' }}>معاملهٔ بازی ندارید</div>
          ) : d.open_deals.map(o => {
            const stale = !o.last_report_at
              || (Date.now() - new Date(o.last_report_at + 'Z').getTime()) > 14 * 24 * 3600 * 1000;
            return (
              <div key={o.id} style={{ display: 'flex', gap: 8, alignItems: 'baseline', padding: '7px 0', borderBottom: '1px solid var(--border-soft)' }}>
                <span className={`badge ${DEAL_STAGE[o.stage]?.[1] || 'badge-gray'}`}>{DEAL_STAGE[o.stage]?.[0] || o.stage}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <b style={{ fontSize: 13 }}>{o.title}</b>
                  <div style={{ fontSize: 12, color: 'var(--text-2)' }}>{o.customer_name} · {money(o.amount)}</div>
                </div>
                {stale && <span className="badge badge-amber" title="بیش از دو هفته گزارشی ثبت نشده">گزارش لازم است</span>}
              </div>
            );
          })}
        </div>
      </div>

      <div className="card card-pad">
        <b style={{ display: 'block', marginBottom: 4 }}>گزارش‌های شما</b>
        <p style={{ fontSize: 12, color: 'var(--text-3)', margin: '0 0 12px' }}>
          آنچه خودتان در هر مرحله نوشته‌اید — مرورشان کنید تا الگوهای تکرارشونده را پیدا کنید.
        </p>
        <StageReportList reports={d.reports} showDeal />
      </div>
    </>
  );
}

// ---------------------------------------------------------------- دستیار هوشمند
// این بخش دادهٔ ساخت‌یافته را برای تحلیل آماده می‌کند. امروز تحلیل را خودتان
// (یا هر مدل زبانیِ بیرونی) می‌نویسید و اینجا ثبت می‌شود؛ فردا کافی است همین
// بستهٔ داده به یک LLM داده شود و پاسخش از همین مسیر ذخیره گردد.
function Assistant({ canManage }) {
  const { toast } = useStore();
  const [payload, setPayload] = useState(null);
  const [insights, setInsights] = useState([]);
  const [scope, setScope] = useState(canManage ? 'team' : 'me');
  const [showData, setShowData] = useState(false);
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const [p, i] = await Promise.all([
        api(`/crm/insights/payload?scope=${scope}`),
        api('/crm/insights'),
      ]);
      setPayload(p); setInsights(i.insights);
    } catch (e) { toast(e.message, 'error'); }
  };
  useEffect(() => { load(); }, [scope]);
  if (!payload) return <div className="card"><div className="empty">در حال بارگذاری…</div></div>;

  const t = payload.totals;
  const promptText = `${payload.instruction}\n\n${JSON.stringify(payload, null, 2)}`;

  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(promptText);
      toast('دادهٔ تحلیل در حافظه کپی شد');
    } catch { toast('کپی نشد — متن را از کادر زیر انتخاب کنید', 'error'); }
  };

  const save = async () => {
    setBusy(true);
    try {
      await api('/crm/insights', { method: 'POST', body: {
        scope: draft.scope, title: draft.title, body: draft.body,
        source: draft.source, model: draft.model, payload,
      } });
      setDraft(null); await load(); toast('تحلیل ثبت شد');
    } catch (e) { toast(e.message, 'error'); }
    setBusy(false);
  };

  const remove = async (i) => {
    if (!window.confirm('این تحلیل حذف شود؟')) return;
    try { await api(`/crm/insights/${i.id}`, { method: 'DELETE' }); load(); }
    catch (e) { toast(e.message, 'error'); }
  };

  return (
    <>
      <div className="card card-pad" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <b style={{ display: 'block' }}>
              <Sparkles size={16} style={{ verticalAlign: '-3px', marginLeft: 5 }} />
              دستیار تحلیل فروش
            </b>
            <p style={{ fontSize: 12.5, color: 'var(--text-2)', margin: '4px 0 0', maxWidth: 620, lineHeight: 1.9 }}>
              همهٔ آمار فروش، دلایل باخت و متنِ گزارش‌های کارشناسان در یک بستهٔ ساخت‌یافته آماده شده است.
              می‌توانید آن را کپی کنید و به یک مدل زبانی بدهید، سپس پاسخ را همین‌جا ثبت کنید تا
              در تاریخچهٔ تحلیل‌ها بماند. (اتصال مستقیم به مدل بعداً به همین مسیر اضافه می‌شود.)
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {canManage && (
              <Segmented value={scope} onChange={setScope} size="sm" options={[
                { value: 'team', label: 'کل تیم' },
                { value: 'me', label: 'فقط خودم' },
              ]} />
            )}
            <button className="btn btn-ghost btn-sm" onClick={copyPrompt}><Copy size={14} /> کپی دادهٔ تحلیل</button>
            <button className="btn btn-primary btn-sm" onClick={() => setDraft({
              scope: scope === 'team' ? 'team' : 'user', title: 'تحلیل عملکرد فروش',
              body: '', source: 'llm', model: '',
            })}><Plus size={14} /> ثبت تحلیل</button>
          </div>
        </div>
      </div>

      {/* خلاصهٔ آنچه در بسته هست — تا کاربر بداند مدل قرار است چه چیزی ببیند */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <Stat label="نرخ موفقیت" value={rateText(t.success_rate)} tone="good" />
        <Stat label="معاملات بررسی‌شده" value={fa(t.total)} sub={`${fa(t.won_count)} برنده · ${fa(t.lost_count)} باخته`} />
        <Stat label="گزارش‌های کارشناسان" value={fa(payload.stage_reports.length)} sub="متنِ خامِ ورودیِ تحلیل" />
        <Stat label="دلایل باخت ثبت‌شده" value={fa(payload.lost_reasons.length)} />
      </div>

      {payload.stage_reports.length === 0 && (
        <div className="card card-pad" style={{ marginBottom: 16, borderColor: 'var(--amber)', background: 'var(--amber-soft)' }}>
          <b style={{ fontSize: 13.5 }}>هنوز گزارشی برای تحلیل وجود ندارد</b>
          <div style={{ fontSize: 12.5, color: 'var(--text-2)', marginTop: 4, lineHeight: 1.9 }}>
            کیفیت تحلیل کاملاً به گزارش‌هایی بستگی دارد که کارشناسان در هر مرحله می‌نویسند.
            در تب «فروش»، هنگام تغییر مرحلهٔ هر معامله، بخش «گزارش این مرحله» را پر کنید.
          </div>
        </div>
      )}

      <div className="card card-pad" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <b>دادهٔ آمادهٔ تحلیل</b>
          <button className="btn btn-ghost btn-sm" onClick={() => setShowData(v => !v)}>
            {showData ? 'پنهان کردن' : 'نمایش داده'}
          </button>
        </div>
        {showData && (
          <textarea className="input" readOnly value={promptText} onFocus={e => e.target.select()}
            style={{ minHeight: 260, fontFamily: 'monospace', fontSize: 11.5, direction: 'ltr', textAlign: 'left' }} />
        )}
      </div>

      <div className="card card-pad">
        <b style={{ display: 'block', marginBottom: 12 }}>تاریخچهٔ تحلیل‌ها و پیشنهادها</b>
        {insights.length === 0 ? (
          <div style={{ fontSize: 12.8, color: 'var(--text-3)' }}>هنوز تحلیلی ثبت نشده است</div>
        ) : insights.map(i => (
          <div key={i.id} style={{ padding: '11px 0', borderBottom: '1px solid var(--border-soft)' }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <span className={`badge ${i.source === 'llm' ? 'badge-sky' : 'badge-gray'}`}>
                {i.source === 'llm' ? `هوش مصنوعی${i.model ? ' · ' + i.model : ''}` : 'دستی'}
              </span>
              <span className="badge badge-gray">{i.scope === 'team' ? 'کل تیم' : i.target_name || 'فردی'}</span>
              <b style={{ fontSize: 13.3 }}>{i.title}</b>
              <span style={{ fontSize: 11.5, color: 'var(--text-3)', marginInlineStart: 'auto' }}>
                {i.created_by_name} · {fmtDateTime(i.created_at)}
              </span>
              <button className="icon-btn" style={{ width: 26, height: 26, color: 'var(--red)' }}
                onClick={() => remove(i)}><Trash2 size={12} /></button>
            </div>
            <div style={{ fontSize: 12.8, color: 'var(--text-2)', whiteSpace: 'pre-wrap', marginTop: 6, lineHeight: 1.9 }}>
              {i.body}
            </div>
          </div>
        ))}
      </div>

      {draft && (
        <Modal title="ثبت تحلیل و پیشنهاد" onClose={() => setDraft(null)} wide
          footer={<>
            <button className="btn btn-ghost" onClick={() => setDraft(null)}>انصراف</button>
            <button className="btn btn-primary" disabled={busy || !draft.body.trim()} onClick={save}>ذخیره</button>
          </>}>
          <p style={{ fontSize: 12.5, color: 'var(--text-2)', marginTop: 0, lineHeight: 1.9 }}>
            متنِ تحلیل را اینجا بگذارید. دادهٔ خامی که تحلیل بر اساسش انجام شده هم
            به‌طور خودکار همراه آن ذخیره می‌شود تا بعداً بدانید تحلیل روی چه اعدادی بوده است.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 10 }}>
            <Field label="عنوان">
              <input className="input" value={draft.title} onChange={e => setDraft(d => ({ ...d, title: e.target.value }))} />
            </Field>
            <Field label="منبع">
              <select className="input" value={draft.source} onChange={e => setDraft(d => ({ ...d, source: e.target.value }))}>
                <option value="llm">هوش مصنوعی</option>
                <option value="manual">تحلیل دستی</option>
              </select>
            </Field>
            <Field label="نام مدل (اختیاری)">
              <input className="input" value={draft.model} placeholder="claude / gpt / …"
                onChange={e => setDraft(d => ({ ...d, model: e.target.value }))} />
            </Field>
          </div>
          <Field label="متن تحلیل و پیشنهادها">
            <textarea className="input" style={{ minHeight: 220 }} value={draft.body} autoFocus
              placeholder="نقاط قوت، ضعف‌های تکرارشونده، دلایل اصلی باخت و پیشنهادهای عملی برای دورهٔ بعد…"
              onChange={e => setDraft(d => ({ ...d, body: e.target.value }))} />
          </Field>
        </Modal>
      )}
    </>
  );
}

// ---------------------------------------------------------------- ابزارها
// خروجی اکسل، فهرست کالا/خدمات و انتقال مالکیتِ سبد فروش — کارهایی که
// هر از گاهی لازم می‌شوند و جایشان در نوار اصلی نیست.
function ToolsModal({ canManage, onClose }) {
  const { toast, users } = useStore();
  const [tab, setTab] = useState('export');
  const [products, setProducts] = useState([]);
  const [newProduct, setNewProduct] = useState(null);
  const [move, setMove] = useState({ from_user_id: null, to_user_id: null, what: 'all' });
  const [busy, setBusy] = useState(false);

  const loadProducts = async () => {
    try { setProducts((await api('/crm/products')).products); }
    catch (e) { toast(e.message, 'error'); }
  };
  useEffect(() => { if (tab === 'products') loadProducts(); }, [tab]);

  // خروجی با توکن در آدرس گرفته می‌شود تا مرورگر مستقیم دانلود کند
  const download = (what) => {
    const url = `/api/crm/export/${what}?token=${encodeURIComponent(getToken())}`;
    window.open(url, '_blank');
  };

  const saveProduct = async () => {
    setBusy(true);
    try {
      if (newProduct.id) await api(`/crm/products/${newProduct.id}`, { method: 'PUT', body: newProduct });
      else await api('/crm/products', { method: 'POST', body: newProduct });
      setNewProduct(null); loadProducts(); toast('ذخیره شد');
    } catch (e) { toast(e.message, 'error'); }
    setBusy(false);
  };
  const delProduct = async (p) => {
    if (!window.confirm(`«${p.name}» حذف شود؟`)) return;
    try { await api(`/crm/products/${p.id}`, { method: 'DELETE' }); loadProducts(); }
    catch (e) { toast(e.message, 'error'); }
  };

  const doReassign = async () => {
    if (!move.from_user_id || !move.to_user_id) return toast('کارشناس مبدأ و مقصد را انتخاب کنید', 'error');
    const fromName = users.find(u => u.id === move.from_user_id)?.full_name;
    const toName = users.find(u => u.id === move.to_user_id)?.full_name;
    if (!window.confirm(`رکوردهای بازِ «${fromName}» به «${toName}» منتقل شود؟`)) return;
    setBusy(true);
    try {
      const r = await api('/crm/reassign', { method: 'POST', body: move });
      toast(`${fa(r.customers)} مشتری، ${fa(r.deals)} معامله و ${fa(r.tenders)} مناقصه منتقل شد`);
      setMove({ from_user_id: null, to_user_id: null, what: 'all' });
    } catch (e) { toast(e.message, 'error'); }
    setBusy(false);
  };

  return (
    <Modal title="ابزارهای CRM" onClose={onClose} wide
      footer={<button className="btn btn-ghost" onClick={onClose}>بستن</button>}>
      <div className="tabs" style={{ marginBottom: 16 }}>
        <button className={`tab ${tab === 'export' ? 'active' : ''}`} onClick={() => setTab('export')}>خروجی اکسل</button>
        {canManage && (
          <button className={`tab ${tab === 'move' ? 'active' : ''}`} onClick={() => setTab('move')}>انتقال مالکیت</button>
        )}
      </div>

      {tab === 'export' && (
        <>
          <p style={{ fontSize: 12.5, color: 'var(--text-2)', marginTop: 0, lineHeight: 1.9 }}>
            فایل CSV با کدگذاری مناسبِ فارسی ساخته می‌شود و مستقیم در اکسل باز می‌شود.
            اگر دسترسی کامل ندارید، فقط رکوردهای خودتان صادر می‌شود.
          </p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button className="btn btn-ghost" onClick={() => download('customers')}><Download size={15} /> مشتریان</button>
            <button className="btn btn-ghost" onClick={() => download('deals')}><Download size={15} /> معاملات</button>
            <button className="btn btn-ghost" onClick={() => download('tenders')}><Download size={15} /> مناقصات</button>
          </div>
        </>
      )}

      {tab === 'products' && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <p style={{ fontSize: 12.5, color: 'var(--text-2)', margin: 0, maxWidth: 460, lineHeight: 1.9 }}>
              فهرست کالا و خدمات با قیمت و بهای تمام‌شده. هنگام ثبت اقلامِ یک معامله از همین فهرست
              انتخاب می‌کنید و حاشیهٔ سود خودکار محاسبه می‌شود.
            </p>
            {canManage && (
              <button className="btn btn-primary btn-sm" onClick={() => setNewProduct({ name: '', unit: 'عدد', list_price: 0, cost: 0 })}>
                <Plus size={14} /> کالا
              </button>
            )}
          </div>
          {products.length === 0 ? (
            <div style={{ fontSize: 12.8, color: 'var(--text-3)' }}>هنوز کالایی تعریف نشده است</div>
          ) : (
            <table className="table">
              <thead><tr><th>نام</th><th>کد</th><th>دسته</th><th>واحد</th><th>قیمت</th><th>بهای تمام‌شده</th><th></th></tr></thead>
              <tbody>
                {products.map(p => (
                  <tr key={p.id}>
                    <td style={{ fontWeight: 600 }}>{p.name}</td>
                    <td style={{ fontSize: 12.3 }}>{p.code || '—'}</td>
                    <td style={{ fontSize: 12.3 }}>{p.category || '—'}</td>
                    <td style={{ fontSize: 12.3 }}>{p.unit}</td>
                    <td style={{ fontSize: 12.3 }}>{money(p.list_price)}</td>
                    <td style={{ fontSize: 12.3, color: 'var(--text-2)' }}>{p.cost > 0 ? money(p.cost) : '—'}</td>
                    <td>
                      {canManage && (
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button className="icon-btn" style={{ width: 26, height: 26 }} onClick={() => setNewProduct({ ...p })}><Pencil size={12} /></button>
                          <button className="icon-btn" style={{ width: 26, height: 26, color: 'var(--red)' }} onClick={() => delProduct(p)}><Trash2 size={12} /></button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}

      {tab === 'move' && canManage && (
        <>
          <p style={{ fontSize: 12.5, color: 'var(--text-2)', marginTop: 0, lineHeight: 1.9 }}>
            وقتی کارشناسی از تیم می‌رود یا سبد فروش بازتقسیم می‌شود، رکوردهایش را به نفر دیگری بسپارید.
            <b> فقط معاملات و مناقصاتِ باز منتقل می‌شوند</b> — سوابقِ بسته‌شده برای حفظ صحتِ گزارش‌ها
            به نام خودِ فرد باقی می‌ماند.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Field label="از کارشناس">
              <UserPicker value={move.from_user_id} onChange={id => setMove(m => ({ ...m, from_user_id: id }))} />
            </Field>
            <Field label="به کارشناس">
              <UserPicker value={move.to_user_id} onChange={id => setMove(m => ({ ...m, to_user_id: id }))} />
            </Field>
          </div>
          <Field label="چه چیزی منتقل شود؟">
            <select className="input" value={move.what} onChange={e => setMove(m => ({ ...m, what: e.target.value }))}>
              <option value="all">همه (مشتریان، معاملات باز، مناقصات باز)</option>
              <option value="customers">فقط مشتریان</option>
              <option value="deals">فقط معاملات باز</option>
              <option value="tenders">فقط مناقصات باز</option>
            </select>
          </Field>
          <button className="btn btn-primary" disabled={busy} onClick={doReassign}>
            <ArrowLeftRight size={15} /> انتقال بده
          </button>
        </>
      )}

      {newProduct && (
        <Modal title={newProduct.id ? 'ویرایش کالا' : 'کالا / خدمت جدید'} onClose={() => setNewProduct(null)}
          footer={<>
            <button className="btn btn-ghost" onClick={() => setNewProduct(null)}>انصراف</button>
            <button className="btn btn-primary" disabled={busy || !newProduct.name.trim()} onClick={saveProduct}>ذخیره</button>
          </>}>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 10 }}>
            <Field label="نام کالا / خدمت *">
              <input className="input" autoFocus value={newProduct.name}
                onChange={e => setNewProduct(p => ({ ...p, name: e.target.value }))} />
            </Field>
            <Field label="کد کالا">
              <input className="input" value={newProduct.code || ''}
                onChange={e => setNewProduct(p => ({ ...p, code: e.target.value }))} />
            </Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Field label="دسته‌بندی">
              <input className="input" value={newProduct.category || ''}
                onChange={e => setNewProduct(p => ({ ...p, category: e.target.value }))} />
            </Field>
            <Field label="واحد شمارش">
              <input className="input" value={newProduct.unit || ''} placeholder="متر، کیلوگرم، حلقه…"
                onChange={e => setNewProduct(p => ({ ...p, unit: e.target.value }))} />
            </Field>
            <Field label="قیمت فروش (ریال)">
              <input className="input" type="number" min="0" value={newProduct.list_price ?? 0}
                onChange={e => setNewProduct(p => ({ ...p, list_price: Number(e.target.value) }))} />
            </Field>
            <Field label="بهای تمام‌شده (ریال)" hint="برای محاسبهٔ حاشیهٔ سود — اختیاری">
              <input className="input" type="number" min="0" value={newProduct.cost ?? 0}
                onChange={e => setNewProduct(p => ({ ...p, cost: Number(e.target.value) }))} />
            </Field>
          </div>
        </Modal>
      )}
    </Modal>
  );
}
