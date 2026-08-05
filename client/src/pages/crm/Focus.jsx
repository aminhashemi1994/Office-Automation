// ============================================================================
//  تمرکز فروش — تیم در هر دوره روی چند محصول/بازار مشخص متمرکز می‌شود و
//  پیشرفتش نسبت به هدف سنجیده می‌شود.
// ============================================================================
import React, { useEffect, useState } from 'react';
import { Plus, Target, Pencil, Trash2, Trophy } from 'lucide-react';
import { api } from '../../api.js';
import { useStore } from '../../store.jsx';
import { fmtDate, fa } from '../../utils.js';
import { Modal, Field, UserPicker } from '../../components/common.jsx';
import { Stat } from '../../components/Charts.jsx';
import Gauge, { MiniBar } from '../../components/Gauge.jsx';

const money = (n) => `${Number(n || 0).toLocaleString('fa-IR')} ریال`;
const PRIORITY = { low: ['کم', 'badge-gray'], normal: ['عادی', 'badge-sky'], high: ['بالا', 'badge-red'] };

export default function Focus({ canManage }) {
  const { toast } = useStore();
  const [rows, setRows] = useState([]);
  const [products, setProducts] = useState([]);
  const [edit, setEdit] = useState(null);

  const load = async () => {
    try {
      const [f, p] = await Promise.all([api('/crm/focus'), api('/crm/products?active=1')]);
      setRows(f.focus); setProducts(p.products);
    } catch (e) { toast(e.message, 'error'); }
  };
  useEffect(() => { load(); }, []);

  const active = rows.filter(f => f.is_active);
  const totalTarget = active.reduce((s, f) => s + Number(f.target_amount || 0), 0);
  const totalDone = active.reduce((s, f) => s + Number(f.won_amount || 0), 0);

  const remove = async (f) => {
    if (!window.confirm(`تمرکز فروش «${f.title}» حذف شود؟`)) return;
    try { await api(`/crm/focus/${f.id}`, { method: 'DELETE' }); load(); }
    catch (e) { toast(e.message, 'error'); }
  };

  return (
    <>
      <div className="card card-pad" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <b style={{ display: 'block' }}>
              <Target size={16} style={{ verticalAlign: '-3px', marginLeft: 5 }} />
              تمرکز فروش این دوره
            </b>
            <p style={{ fontSize: 12.5, color: 'var(--text-2)', margin: '4px 0 0', maxWidth: 640, lineHeight: 1.9 }}>
              به‌جای پخش‌شدن روی همه‌چیز، در هر دوره چند محصول یا بازار مشخص را هدف بگیرید و
              سهمیهٔ هر کارشناس را تعیین کنید. پیشرفت از روی معاملاتِ برندهٔ همان دوره محاسبه می‌شود.
            </p>
          </div>
          {canManage && (
            <button className="btn btn-primary" onClick={() => setEdit({
              title: '', priority: 'normal', target_amount: 0, target_count: 0, product_ids: [], members: [],
            })}><Plus size={16} /> تمرکز جدید</button>
          )}
        </div>
      </div>

      {active.length > 0 && (
        <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
          <Stat label="هدف کل دوره" value={money(totalTarget)} sub={`${fa(active.length)} تمرکز فعال`} />
          <Stat label="محقق‌شده" value={money(totalDone)} tone="a" />
          <Stat label="درصد پیشرفت"
            value={totalTarget > 0 ? `${fa(Math.round((totalDone / totalTarget) * 1000) / 10, 1)}٪` : '—'}
            tone={totalTarget > 0 && totalDone >= totalTarget ? 'good' : undefined} />
        </div>
      )}

      {rows.length === 0 ? (
        <div className="card"><div className="empty"><Target size={40} /><div>هنوز تمرکز فروشی تعریف نشده است</div></div></div>
      ) : rows.map(f => {
        const [pl, pc] = PRIORITY[f.priority] || PRIORITY.normal;
        const pct = f.progress_pct;
        const reached = pct !== null && pct >= 100;
        return (
          <div key={f.id} className="card card-pad" style={{ marginBottom: 14, opacity: f.is_active ? 1 : 0.6 }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
              {reached && <Trophy size={16} style={{ color: 'var(--green)' }} />}
              <b style={{ fontSize: 14.5 }}>{f.title}</b>
              <span className={`badge ${pc}`}>اولویت {pl}</span>
              {!f.is_active && <span className="badge badge-gray">غیرفعال</span>}
              {f.period_from && (
                <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
                  {fmtDate(f.period_from)} تا {f.period_to ? fmtDate(f.period_to) : '—'}
                  {f.days_left !== null && f.days_left >= 0 && f.is_active && ` · ${fa(f.days_left)} روز مانده`}
                  {f.days_left !== null && f.days_left < 0 && ' · دوره تمام شده'}
                </span>
              )}
              {canManage && (
                <span style={{ marginInlineStart: 'auto', display: 'flex', gap: 4 }}>
                  <button className="icon-btn" style={{ width: 28, height: 28 }}
                    onClick={() => setEdit({ ...f, members: f.members.map(m => ({ user_id: m.user_id, target_amount: m.target_amount })) })}>
                    <Pencil size={13} />
                  </button>
                  <button className="icon-btn" style={{ width: 28, height: 28, color: 'var(--red)' }}
                    onClick={() => remove(f)}><Trash2 size={13} /></button>
                </span>
              )}
            </div>
            {f.description && (
              <p style={{ fontSize: 12.8, color: 'var(--text-2)', margin: '0 0 12px', whiteSpace: 'pre-wrap' }}>{f.description}</p>
            )}

            <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap', alignItems: 'center' }}>
              {f.target_amount > 0 && (
                <Gauge value={Math.min(f.won_amount, f.target_amount)} max={f.target_amount}
                  label={pct === null ? '—' : `${fa(pct, 1)}٪`}
                  caption={`${money(f.won_amount)} از ${money(f.target_amount)}`}
                  maxLabel={money(f.target_amount).replace(' ریال', '')} size={185} />
              )}
              <div style={{ flex: 1, minWidth: 240, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {f.target_count > 0 && (
                  <div style={{ fontSize: 12.8 }}>
                    <span style={{ color: 'var(--text-2)' }}>تعداد معامله: </span>
                    <b>{fa(f.won_deals)} از {fa(f.target_count)}</b>
                    {f.count_progress_pct !== null && <span style={{ color: 'var(--text-3)' }}> ({fa(f.count_progress_pct, 1)}٪)</span>}
                  </div>
                )}
                {f.products?.length > 0 && (
                  <div style={{ fontSize: 12.5 }}>
                    <span style={{ color: 'var(--text-2)' }}>محصولات هدف: </span>
                    {f.products.map(p => <span key={p.id} className="badge badge-sky" style={{ marginLeft: 4 }}>{p.name}</span>)}
                  </div>
                )}
                {f.categories && (
                  <div style={{ fontSize: 12.5 }}>
                    <span style={{ color: 'var(--text-2)' }}>دسته‌ها: </span>{f.categories}
                  </div>
                )}
                {f.segment && (
                  <div style={{ fontSize: 12.5 }}>
                    <span style={{ color: 'var(--text-2)' }}>بازار هدف: </span>{f.segment}
                  </div>
                )}
                {f.members?.length > 0 && (
                  <div style={{ marginTop: 4 }}>
                    <div style={{ fontSize: 12, color: 'var(--text-2)', marginBottom: 5 }}>سهمیهٔ کارشناسان:</div>
                    {f.members.map(m => (
                      <div key={m.user_id} style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 12.5, marginBottom: 4 }}>
                        <span style={{ minWidth: 110 }}>{m.full_name}</span>
                        <MiniBar value={0} max={m.target_amount || 1} width={70} />
                        <span style={{ color: 'var(--text-2)' }}>هدف: {money(m.target_amount)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })}

      {edit && (
        <FocusModal value={edit} products={products}
          onClose={() => setEdit(null)} onDone={() => { setEdit(null); load(); }} />
      )}
    </>
  );
}

function FocusModal({ value, products, onClose, onDone }) {
  const { toast, departments } = useStore();
  const [v, setV] = useState(value);
  const [busy, setBusy] = useState(false);
  const set = (patch) => setV(x => ({ ...x, ...patch }));
  const membersTotal = (v.members || []).reduce((s, m) => s + Number(m.target_amount || 0), 0);

  const save = async () => {
    if (!String(v.title || '').trim()) return toast('عنوان تمرکز فروش الزامی است', 'error');
    setBusy(true);
    try {
      if (v.id) await api(`/crm/focus/${v.id}`, { method: 'PUT', body: v });
      else await api('/crm/focus', { method: 'POST', body: v });
      onDone(); toast('ذخیره شد');
    } catch (e) { toast(e.message, 'error'); }
    setBusy(false);
  };

  const toggleProduct = (id) => set({
    product_ids: (v.product_ids || []).includes(id)
      ? v.product_ids.filter(x => x !== id) : [...(v.product_ids || []), id],
  });

  return (
    <Modal title={v.id ? `ویرایش «${value.title}»` : 'تمرکز فروش جدید'} onClose={onClose} wide
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>انصراف</button>
        <button className="btn btn-primary" disabled={busy} onClick={save}>ذخیره</button>
      </>}>
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 10 }}>
        <Field label="عنوان *">
          <input className="input" autoFocus value={v.title || ''}
            placeholder="مثلاً: نفوذ در بازار کابل فشار متوسط خراسان"
            onChange={e => set({ title: e.target.value })} />
        </Field>
        <Field label="اولویت">
          <select className="input" value={v.priority || 'normal'} onChange={e => set({ priority: e.target.value })}>
            {Object.entries(PRIORITY).map(([k, l]) => <option key={k} value={k}>{l[0]}</option>)}
          </select>
        </Field>
      </div>
      <Field label="توضیح و راهبرد" hint="چرا این تمرکز؟ چه کاری قرار است متفاوت انجام شود؟">
        <textarea className="input" style={{ minHeight: 80 }} value={v.description || ''}
          onChange={e => set({ description: e.target.value })} />
      </Field>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
        <Field label="از تاریخ">
          <input className="input" type="date" value={(v.period_from || '').slice(0, 10)}
            onChange={e => set({ period_from: e.target.value })} />
        </Field>
        <Field label="تا تاریخ">
          <input className="input" type="date" value={(v.period_to || '').slice(0, 10)}
            onChange={e => set({ period_to: e.target.value })} />
        </Field>
        <Field label="هدف مبلغ (ریال)">
          <input className="input" type="number" min="0" value={v.target_amount ?? 0}
            onChange={e => set({ target_amount: Number(e.target.value) })} />
        </Field>
        <Field label="هدف تعداد معامله">
          <input className="input" type="number" min="0" value={v.target_count ?? 0}
            onChange={e => set({ target_count: Number(e.target.value) })} />
        </Field>
      </div>

      <Field label="محصولات هدف" hint="خالی بگذارید تا همهٔ فروشِ دوره شمرده شود">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, maxHeight: 140, overflowY: 'auto' }}>
          {products.map(p => (
            <button key={p.id} type="button"
              className={`btn btn-sm ${(v.product_ids || []).includes(p.id) ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => toggleProduct(p.id)}>{p.name}</button>
          ))}
          {!products.length && <span style={{ fontSize: 12, color: 'var(--text-3)' }}>کالایی تعریف نشده است</span>}
        </div>
      </Field>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <Field label="یا دسته‌بندی‌ها" hint="با «،» جدا کنید">
          <input className="input" value={v.categories || ''} onChange={e => set({ categories: e.target.value })} />
        </Field>
        <Field label="بازار / صنعت هدف">
          <input className="input" value={v.segment || ''} placeholder="پروژه‌های عمرانی، صنایع غذایی…"
            onChange={e => set({ segment: e.target.value })} />
        </Field>
      </div>

      <div className="card-pad panel-soft" style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <div style={{ fontSize: 12.8, fontWeight: 700 }}>سهمیهٔ کارشناسان</div>
          <button className="btn btn-ghost btn-sm" type="button"
            onClick={() => set({ members: [...(v.members || []), { user_id: null, target_amount: 0 }] })}>
            <Plus size={14} /> کارشناس
          </button>
        </div>
        {(v.members || []).length === 0 ? (
          <div style={{ fontSize: 12.3, color: 'var(--text-3)' }}>سهمیه‌ای تعیین نشده است</div>
        ) : (v.members || []).map((m, i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr auto', gap: 8, alignItems: 'end', marginBottom: 8 }}>
            <div>
              {i === 0 && <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 3 }}>کارشناس</div>}
              <UserPicker value={m.user_id}
                onChange={id => set({ members: v.members.map((x, j) => (j === i ? { ...x, user_id: id } : x)) })} />
            </div>
            <div>
              {i === 0 && <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 3 }}>هدف (ریال)</div>}
              <input className="input" type="number" min="0" value={m.target_amount ?? 0}
                onChange={e => set({ members: v.members.map((x, j) => (j === i ? { ...x, target_amount: Number(e.target.value) } : x)) })} />
            </div>
            <button className="icon-btn" type="button" style={{ width: 30, height: 30, color: 'var(--red)' }}
              onClick={() => set({ members: v.members.filter((_, j) => j !== i) })}><Trash2 size={13} /></button>
          </div>
        ))}
        {membersTotal > 0 && v.target_amount > 0 && membersTotal !== Number(v.target_amount) && (
          <p style={{ fontSize: 12.3, color: 'var(--amber)', margin: '6px 0 0' }}>
            جمع سهمیه‌ها ({money(membersTotal)}) با هدف کل ({money(v.target_amount)}) برابر نیست.
          </p>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <Field label="مسئول تمرکز">
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
      {v.id && (
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
          <input type="checkbox" checked={v.is_active !== 0}
            onChange={e => set({ is_active: e.target.checked ? 1 : 0 })} />
          این تمرکز فعال است
        </label>
      )}
    </Modal>
  );
}
