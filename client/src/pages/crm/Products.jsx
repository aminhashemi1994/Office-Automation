// ============================================================================
//  محصولات — مشخصات، قیمت، موجودی و عملکرد فروش هر کالا
// ============================================================================
import React, { useEffect, useState } from 'react';
import {
  Plus, Search, Package, Pencil, Trash2, ArrowRight, ArrowUpDown, AlertTriangle,
} from 'lucide-react';
import { api } from '../../api.js';
import { useStore } from '../../store.jsx';
import { fmtDateTime, fa } from '../../utils.js';
import { Modal, Field } from '../../components/common.jsx';
import { AttachmentPicker, AttachmentList } from '../../components/Attachments.jsx';
import { RankedBars, Stat } from '../../components/Charts.jsx';
import { MiniBar } from '../../components/Gauge.jsx';

const money = (n) => `${Number(n || 0).toLocaleString('fa-IR')} ریال`;
const rateText = (v) => (v === null || v === undefined ? '—' : `${fa(v, 1)}٪`);

const STOCK_REASON = {
  purchase: 'خرید / تولید', sale: 'فروش', return: 'مرجوعی',
  adjust: 'اصلاح انبارگردانی', manual: 'ثبت دستی',
};

export default function Products({ canManage }) {
  const { toast } = useStore();
  const [rows, setRows] = useState([]);
  const [perf, setPerf] = useState([]);
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState(null);
  const [stockOf, setStockOf] = useState(null);
  const [view, setView] = useState('list'); // list | performance

  const load = async () => {
    try {
      const [p, pf] = await Promise.all([
        api(`/crm/products${q ? '?q=' + encodeURIComponent(q) : ''}`),
        api('/crm/product-performance'),
      ]);
      setRows(p.products); setPerf(pf.products);
    } catch (e) { toast(e.message, 'error'); }
  };
  useEffect(() => { load(); }, []);

  const lowStock = rows.filter(p => p.reorder_point > 0 && p.stock <= p.reorder_point);
  const totalValue = rows.reduce((s, p) => s + (Number(p.stock) || 0) * (Number(p.cost) || Number(p.list_price) || 0), 0);

  return (
    <>
      {lowStock.length > 0 && (
        <div className="card card-pad" style={{ marginBottom: 16, borderColor: 'var(--amber)', background: 'var(--amber-soft)' }}>
          <b style={{ display: 'block', marginBottom: 6, fontSize: 13.5 }}>
            <AlertTriangle size={15} style={{ verticalAlign: '-3px', marginLeft: 5 }} />
            {fa(lowStock.length)} کالا به نقطهٔ سفارش رسیده است
          </b>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', fontSize: 12.5 }}>
            {lowStock.map(p => (
              <span key={p.id} className="badge badge-amber">
                {p.name}: {fa(p.stock)} {p.unit} (حد: {fa(p.reorder_point)})
              </span>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <Stat label="تعداد کالا" value={fa(rows.length)} sub={`${fa(rows.filter(p => p.is_active).length)} فعال`} />
        <Stat label="ارزش موجودی" value={money(totalValue)} sub="بر مبنای بهای تمام‌شده" />
        <Stat label="زیر نقطهٔ سفارش" value={fa(lowStock.length)} tone={lowStock.length ? 'bad' : 'good'} />
      </div>

      <div className="card card-pad" style={{ marginBottom: 16, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'end' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
          <Search size={15} style={{ position: 'absolute', right: 11, top: 11, color: 'var(--text-3)' }} />
          <input className="input" style={{ paddingRight: 34 }} placeholder="جستجوی نام، کد یا دسته‌بندی…"
            value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === 'Enter' && load()} />
        </div>
        <button className="btn btn-ghost" onClick={load}><Search size={16} /> جستجو</button>
        <button className={`btn ${view === 'performance' ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => setView(v => (v === 'list' ? 'performance' : 'list'))}>
          {view === 'list' ? 'عملکرد فروش محصولات' : 'فهرست محصولات'}
        </button>
        {canManage && (
          <button className="btn btn-primary" onClick={() => setEdit({
            name: '', unit: 'عدد', list_price: 0, cost: 0, stock: 0, reorder_point: 0, is_active: 1, attachments: [],
          })}><Plus size={16} /> کالای جدید</button>
        )}
      </div>

      {view === 'list' ? (
        <div className="card">
          {rows.length === 0 ? (
            <div className="empty"><Package size={40} /><div>هنوز کالایی تعریف نشده است</div></div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>نام</th><th>کد</th><th>دسته</th><th>موجودی</th>
                  <th>قیمت فروش</th><th>بهای تمام‌شده</th><th>حاشیهٔ سود</th><th>گارانتی</th><th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map(p => {
                  const margin = p.list_price > 0 && p.cost > 0
                    ? Math.round(((p.list_price - p.cost) / p.list_price) * 1000) / 10 : null;
                  const low = p.reorder_point > 0 && p.stock <= p.reorder_point;
                  return (
                    <tr key={p.id} style={{ opacity: p.is_active ? 1 : 0.55 }}>
                      <td>
                        <b>{p.name}</b>
                        {!p.is_active && <span className="badge badge-gray" style={{ marginRight: 6 }}>غیرفعال</span>}
                        {p.spec && <div style={{ fontSize: 11.5, color: 'var(--text-3)' }}>{p.spec.slice(0, 60)}</div>}
                      </td>
                      <td style={{ fontSize: 12.3 }}>{p.code || '—'}</td>
                      <td style={{ fontSize: 12.3 }}>{p.category || '—'}</td>
                      <td>
                        <span className={`badge ${low ? 'badge-amber' : 'badge-gray'}`}>
                          {fa(p.stock)} {p.unit}
                        </span>
                      </td>
                      <td style={{ fontSize: 12.3 }}>{money(p.list_price)}</td>
                      <td style={{ fontSize: 12.3, color: 'var(--text-2)' }}>{p.cost > 0 ? money(p.cost) : '—'}</td>
                      <td style={{ fontSize: 12.5, fontWeight: 600, color: margin === null ? undefined : margin >= 15 ? 'var(--green)' : 'var(--amber)' }}>
                        {margin === null ? '—' : `${fa(margin, 1)}٪`}
                      </td>
                      <td style={{ fontSize: 12.3 }}>{p.warranty_months > 0 ? `${fa(p.warranty_months)} ماه` : '—'}</td>
                      <td>
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button className="icon-btn" style={{ width: 28, height: 28 }} title="گردش موجودی"
                            onClick={() => setStockOf(p)}><ArrowUpDown size={13} /></button>
                          {canManage && (
                            <>
                              <button className="icon-btn" style={{ width: 28, height: 28 }}
                                onClick={() => setEdit({ ...p })}><Pencil size={13} /></button>
                              <button className="icon-btn" style={{ width: 28, height: 28, color: 'var(--red)' }}
                                onClick={async () => {
                                  if (!window.confirm(`«${p.name}» حذف شود؟`)) return;
                                  try { await api(`/crm/products/${p.id}`, { method: 'DELETE' }); load(); }
                                  catch (e) { toast(e.message, 'error'); }
                                }}><Trash2 size={13} /></button>
                            </>
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
      ) : (
        <>
          <div className="grid-2">
            <div className="card card-pad" style={{ marginBottom: 18 }}>
              <b style={{ display: 'block', marginBottom: 4 }}>پرفروش‌ترین محصولات</b>
              <p style={{ fontSize: 12, color: 'var(--text-3)', margin: '0 0 12px' }}>
                بر اساس مبلغِ اقلامِ معاملات برنده
              </p>
              <RankedBars rows={perf.filter(p => p.sold_amount > 0).slice(0, 10)
                .map(p => ({ label: p.name, value: p.sold_amount, qty: p.sold_qty, unit: p.unit }))}
                format={(v, r) => `${money(v)} · ${fa(r.qty)} ${r.unit}`}
                emptyText="هنوز فروشی با قلمِ محصول ثبت نشده — در مودال معامله اقلام را وارد کنید" />
            </div>
            <div className="card card-pad" style={{ marginBottom: 18 }}>
              <b style={{ display: 'block', marginBottom: 4 }}>نرخ موفقیت هر محصول</b>
              <p style={{ fontSize: 12, color: 'var(--text-3)', margin: '0 0 12px' }}>
                معاملاتی که این محصول در آن‌ها بوده، چند درصد برنده شده‌اند؟
              </p>
              <RankedBars max={100} rows={perf.filter(p => p.success_rate !== null)
                .map(p => ({ label: p.name, value: p.success_rate, won: p.won_deals, lost: p.lost_deals }))}
                format={(v, r) => `${rateText(v)} — ${fa(r.won)} برد / ${fa(r.lost)} باخت`}
                emptyText="داده‌ای برای محاسبه نیست" />
            </div>
          </div>

          <div className="card">
            <div className="card-pad" style={{ paddingBottom: 0 }}>
              <b>جدول کامل عملکرد محصولات</b>
              <p style={{ fontSize: 12, color: 'var(--text-3)', margin: '4px 0 0' }}>
                فروش، حاشیهٔ سود، موجودی و ایرادهای کیفی — کنار هم تصمیم‌گیری را ساده می‌کند.
              </p>
            </div>
            <table className="table">
              <thead>
                <tr>
                  <th>محصول</th><th>فروش‌رفته</th><th>مبلغ فروش</th><th>نرخ موفقیت</th>
                  <th>حاشیهٔ سود</th><th>موجودی</th><th>ایراد کیفی</th>
                </tr>
              </thead>
              <tbody>
                {perf.map(p => (
                  <tr key={p.id}>
                    <td><b>{p.name}</b>{p.category && <div style={{ fontSize: 11.5, color: 'var(--text-3)' }}>{p.category}</div>}</td>
                    <td style={{ fontSize: 12.3 }}>{p.sold_qty > 0 ? `${fa(p.sold_qty)} ${p.unit}` : '—'}</td>
                    <td style={{ fontSize: 12.3, color: 'var(--chart-a)', fontWeight: 600 }}>
                      {p.sold_amount > 0 ? money(p.sold_amount) : '—'}
                    </td>
                    <td>
                      {p.success_rate === null ? '—' : (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                          <MiniBar value={p.success_rate} max={100} width={54} />
                          <span style={{ fontSize: 12.3 }}>{rateText(p.success_rate)}</span>
                        </div>
                      )}
                    </td>
                    <td style={{ fontSize: 12.3, fontWeight: 600, color: p.margin_pct === null ? undefined : p.margin_pct >= 15 ? 'var(--green)' : 'var(--amber)' }}>
                      {p.margin_pct === null ? '—' : `${fa(p.margin_pct, 1)}٪`}
                    </td>
                    <td style={{ fontSize: 12.3 }}>{fa(p.stock)} {p.unit}</td>
                    <td>
                      {p.quality_issues > 0
                        ? <span className="badge badge-red">{fa(p.quality_issues)}</span>
                        : <span style={{ color: 'var(--text-3)' }}>—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {edit && <ProductModal value={edit} onClose={() => setEdit(null)} onDone={() => { setEdit(null); load(); }} />}
      {stockOf && (
        <StockModal product={stockOf} canManage={canManage}
          onClose={() => setStockOf(null)} onDone={load} />
      )}
    </>
  );
}

function ProductModal({ value, onClose, onDone }) {
  const { toast } = useStore();
  const [v, setV] = useState(value);
  const [busy, setBusy] = useState(false);
  const set = (patch) => setV(x => ({ ...x, ...patch }));
  const margin = v.list_price > 0 && v.cost > 0
    ? Math.round(((v.list_price - v.cost) / v.list_price) * 1000) / 10 : null;

  const save = async () => {
    if (!String(v.name || '').trim()) return toast('نام کالا الزامی است', 'error');
    setBusy(true);
    try {
      if (v.id) await api(`/crm/products/${v.id}`, { method: 'PUT', body: v });
      else await api('/crm/products', { method: 'POST', body: v });
      onDone(); toast('ذخیره شد');
    } catch (e) { toast(e.message, 'error'); }
    setBusy(false);
  };

  return (
    <Modal title={v.id ? `ویرایش «${value.name}»` : 'کالا / خدمت جدید'} onClose={onClose} wide
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>انصراف</button>
        <button className="btn btn-primary" disabled={busy} onClick={save}>ذخیره</button>
      </>}>
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 10 }}>
        <Field label="نام کالا / خدمت *">
          <input className="input" autoFocus value={v.name || ''} onChange={e => set({ name: e.target.value })} />
        </Field>
        <Field label="کد کالا">
          <input className="input" value={v.code || ''} onChange={e => set({ code: e.target.value })} />
        </Field>
        <Field label="دسته‌بندی">
          <input className="input" value={v.category || ''} placeholder="کابل فشار ضعیف، سیم افشان…"
            onChange={e => set({ category: e.target.value })} />
        </Field>
      </div>
      <Field label="مشخصات فنی">
        <textarea className="input" value={v.spec || ''} placeholder="سطح مقطع، ولتاژ، استاندارد، جنس عایق…"
          onChange={e => set({ spec: e.target.value })} />
      </Field>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
        <Field label="واحد شمارش">
          <input className="input" value={v.unit || ''} placeholder="متر، کیلوگرم، حلقه"
            onChange={e => set({ unit: e.target.value })} />
        </Field>
        <Field label="قیمت فروش (ریال)">
          <input className="input" type="number" min="0" value={v.list_price ?? 0}
            onChange={e => set({ list_price: Number(e.target.value) })} />
        </Field>
        <Field label="بهای تمام‌شده (ریال)" hint={margin !== null ? `حاشیهٔ سود: ${fa(margin, 1)}٪` : 'برای محاسبهٔ حاشیهٔ سود'}>
          <input className="input" type="number" min="0" value={v.cost ?? 0}
            onChange={e => set({ cost: Number(e.target.value) })} />
        </Field>
        <Field label="نقطهٔ سفارش" hint="با رسیدن موجودی به این عدد هشدار می‌گیرید">
          <input className="input" type="number" min="0" value={v.reorder_point ?? 0}
            onChange={e => set({ reorder_point: Number(e.target.value) })} />
        </Field>
        <Field label="زمان تامین (روز)">
          <input className="input" type="number" min="0" value={v.lead_time_days ?? 0}
            onChange={e => set({ lead_time_days: Number(e.target.value) })} />
        </Field>
        <Field label="گارانتی (ماه)">
          <input className="input" type="number" min="0" value={v.warranty_months ?? 0}
            onChange={e => set({ warranty_months: Number(e.target.value) })} />
        </Field>
      </div>
      <Field label="کاتالوگ و اسناد فنی">
        <AttachmentPicker value={v.attachments || []} onChange={x => set({ attachments: x })} />
      </Field>
      <Field label="یادداشت">
        <textarea className="input" value={v.note || ''} onChange={e => set({ note: e.target.value })} />
      </Field>
      {v.id && (
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
          <input type="checkbox" checked={v.is_active !== 0}
            onChange={e => set({ is_active: e.target.checked ? 1 : 0 })} />
          این کالا فعال است (در فهرست انتخابِ اقلامِ معامله می‌آید)
        </label>
      )}
      {v.id && v.stock !== undefined && (
        <p style={{ fontSize: 12.3, color: 'var(--text-3)', marginBottom: 0 }}>
          موجودی فعلی: <b>{fa(v.stock)} {v.unit}</b> — برای تغییر، از دکمهٔ «گردش موجودی» استفاده کنید
          تا سابقه‌اش ثبت شود.
        </p>
      )}
    </Modal>
  );
}

function StockModal({ product, canManage, onClose, onDone }) {
  const { toast } = useStore();
  const [data, setData] = useState(null);
  const [form, setForm] = useState({ qty: 0, reason: 'purchase', note: '' });
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try { setData(await api(`/crm/products/${product.id}/stock`)); }
    catch (e) { toast(e.message, 'error'); onClose(); }
  };
  useEffect(() => { load(); }, [product.id]);

  const submit = async () => {
    if (!Number(form.qty)) return toast('مقدار را وارد کنید', 'error');
    setBusy(true);
    try {
      await api(`/crm/products/${product.id}/stock`, { method: 'POST', body: form });
      setForm({ qty: 0, reason: 'purchase', note: '' });
      await load(); onDone(); toast('ثبت شد');
    } catch (e) { toast(e.message, 'error'); }
    setBusy(false);
  };

  return (
    <Modal title={`گردش موجودی «${product.name}»`} onClose={onClose} wide
      footer={<button className="btn btn-ghost" onClick={onClose}>بستن</button>}>
      <div style={{ display: 'flex', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
        <Stat label="موجودی فعلی" value={`${fa(data?.stock ?? product.stock)} ${product.unit}`}
          tone={product.reorder_point > 0 && (data?.stock ?? product.stock) <= product.reorder_point ? 'bad' : 'good'} />
        <Stat label="نقطهٔ سفارش" value={product.reorder_point > 0 ? fa(product.reorder_point) : '—'} />
        <Stat label="زمان تامین" value={product.lead_time_days > 0 ? `${fa(product.lead_time_days)} روز` : '—'} />
      </div>

      {canManage && (
        <div className="card-pad panel-soft" style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 12.8, fontWeight: 700, marginBottom: 10 }}>ثبت ورود / خروج</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.2fr 2fr auto', gap: 10, alignItems: 'end' }}>
            <Field label="مقدار" hint="مثبت = ورود، منفی = خروج">
              <input className="input" type="number" step="0.01" value={form.qty}
                onChange={e => setForm(f => ({ ...f, qty: Number(e.target.value) }))} />
            </Field>
            <Field label="بابت">
              <select className="input" value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))}>
                {Object.entries(STOCK_REASON).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </Field>
            <Field label="توضیح">
              <input className="input" value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} />
            </Field>
            <button className="btn btn-primary" disabled={busy} onClick={submit} style={{ marginBottom: 14 }}>ثبت</button>
          </div>
        </div>
      )}

      {!data ? <div className="empty">در حال بارگذاری…</div> : data.moves.length === 0 ? (
        <div style={{ fontSize: 12.8, color: 'var(--text-3)' }}>گردشی ثبت نشده است</div>
      ) : (
        <table className="table">
          <thead><tr><th>مقدار</th><th>بابت</th><th>توضیح</th><th>ثبت‌کننده</th><th>تاریخ</th></tr></thead>
          <tbody>
            {data.moves.map(m => (
              <tr key={m.id}>
                <td style={{ fontWeight: 700, color: m.qty > 0 ? 'var(--green)' : 'var(--red)' }}>
                  {m.qty > 0 ? '+' : '−'}{fa(Math.abs(m.qty))} {product.unit}
                </td>
                <td style={{ fontSize: 12.3 }}>{STOCK_REASON[m.reason] || m.reason}</td>
                <td style={{ fontSize: 12.3, color: 'var(--text-2)' }}>{m.note || m.deal_title || '—'}</td>
                <td style={{ fontSize: 12.3 }}>{m.user_name || '—'}</td>
                <td style={{ fontSize: 12.3, color: 'var(--text-3)' }}>{fmtDateTime(m.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Modal>
  );
}
