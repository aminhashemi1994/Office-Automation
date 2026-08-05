import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Clock, Search, Paperclip } from 'lucide-react';
import { api } from '../api.js';
import { useStore } from '../store.jsx';
import { fmtRelative, fmtDateTime, parseDate } from '../utils.js';
import { Modal, Field } from '../components/common.jsx';
import { AttachmentList, toFileIds as toIds } from '../components/Attachments.jsx';
import RequestFormFields, { validateRequestForm } from '../components/RequestForm.jsx';

export const STATUS = {
  in_progress: ['در جریان', 'badge-primary'],
  // [تایید نهایی درخواست‌دهنده] همهٔ مراحل تایید شده و منتظر تایید نهاییِ خودِ درخواست‌دهنده است
  awaiting_requester: ['در انتظار تایید نهایی', 'badge-sky'],
  // [برگشت] برای اصلاح به درخواست‌دهنده برگشته و باید دوباره ارسال شود
  returned: ['برگشت برای اصلاح', 'badge-amber'],
  approved: ['تایید نهایی', 'badge-green'],
  rejected: ['رد شده', 'badge-red'],
  cancelled: ['لغو شده', 'badge-gray'],
};

// وضعیت‌هایی که درخواست هنوز باز است و مرحله/مهلت معنا دارد
export const OPEN_STATUSES = ['in_progress', 'awaiting_requester', 'returned'];

export default function Cartable() {
  const { user, users, departments, hasPerm, on, toast, setCartableCount } = useStore();
  const [tab, setTab] = useState('inbox');
  const [inbox, setInbox] = useState([]);
  const [mine, setMine] = useState([]);
  const [all, setAll] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [newReq, setNewReq] = useState(false);
  const [search, setSearch] = useState('');

  const myDept = departments.find(d => d.id === user.department_id);
  // مدیرِ حداقل یک واحد (مدل چندمدیره) یا مدیر سامانه/واحد مدیریت → دسترسی به «همه درخواست‌ها»
  const canBuild = hasPerm('workflows.manage') || user.role === 'manager'
    || departments.some(d => d.manager_id === user.id || (d.managers || []).some(m => m.id === user.id))
    || !!myDept?.is_management;

  const load = async () => {
    const [i, m, t] = await Promise.all([
      api('/workflows/requests/inbox'),
      api('/workflows/requests/mine'),
      api('/workflows/templates'),
    ]);
    setInbox(i.requests); setMine(m.requests);
    setCartableCount(i.requests.length);
    setTemplates(t.templates.filter(x => x.is_active));
    if (canBuild) {
      const a = await api('/workflows/requests/all');
      setAll(a.requests);
    }
  };
  useEffect(() => { load(); return on('notification', load); }, []);

  const rowsAll = tab === 'inbox' ? inbox : tab === 'mine' ? mine : all;
  const rows = rowsAll.filter(r => !search
    || r.title.includes(search) || r.template_name.includes(search)
    || (r.requester_name || '').includes(search));

  return (
    <div className="content">
      <div className="page-head">
        <div className="tabs">
          <button className={`tab ${tab === 'inbox' ? 'active' : ''}`} onClick={() => setTab('inbox')}>
            در انتظار اقدام من {inbox.length > 0 && <span className="badge-count">{inbox.length.toLocaleString('fa-IR')}</span>}
          </button>
          <button className={`tab ${tab === 'mine' ? 'active' : ''}`} onClick={() => setTab('mine')}>درخواست‌های من</button>
          {canBuild && (
            <button className={`tab ${tab === 'all' ? 'active' : ''}`} onClick={() => setTab('all')}>همه درخواست‌ها</button>
          )}
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <div style={{ position: 'relative' }}>
            <Search size={15} style={{ position: 'absolute', right: 11, top: 11, color: 'var(--text-3)' }} />
            <input className="input" style={{ paddingRight: 34, width: 220 }} placeholder="جستجوی درخواست…"
              value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <button className="btn btn-primary" onClick={() => setNewReq(true)}><Plus size={17} /> درخواست جدید</button>
        </div>
      </div>

      <div className="card">
        {rows.length === 0 ? (
          <div className="empty">درخواستی وجود ندارد</div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>عنوان</th>
                <th>فرآیند</th>
                {tab !== 'mine' && <th>درخواست‌دهنده</th>}
                <th>وضعیت / مرحله</th>
                <th>مهلت مرحله</th>
                <th>ثبت</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const [sl, sc] = STATUS[r.status] || STATUS.in_progress;
                const overdue = r.status === 'in_progress' && r.step_due_at && parseDate(r.step_due_at) < new Date();
                return (
                  <tr key={r.id}>
                    <td>
                      <Link to={`/cartable/${r.id}`} style={{ fontWeight: 600, color: 'var(--primary)' }}>{r.title}</Link>
                      {/* [پیوست‌ها] نشانِ «این درخواست فایل پیوست دارد» */}
                      {r.attachments_count > 0 && (
                        <span className="badge badge-sky" style={{ marginRight: 6 }}
                          title={`${r.attachments_count.toLocaleString('fa-IR')} فایل پیوست دارد`}>
                          <Paperclip size={11} /> {r.attachments_count.toLocaleString('fa-IR')}
                        </span>
                      )}
                    </td>
                    <td>{r.template_name}</td>
                    {tab !== 'mine' && <td>{r.requester_name}</td>}
                    <td>
                      <span className={`badge ${sc}`}>{sl}</span>
                      {r.step_title && (
                        <span style={{ fontSize: 12, color: 'var(--text-2)', marginRight: 6 }}>{r.step_title}</span>
                      )}
                    </td>
                    <td>
                      {r.status === 'in_progress' && r.step_due_at ? (
                        <span className={`badge ${overdue ? 'badge-red' : 'badge-gray'}`}>
                          <Clock size={12} /> {fmtDateTime(r.step_due_at)}
                        </span>
                      ) : '—'}
                    </td>
                    <td style={{ color: 'var(--text-3)', fontSize: 12.5 }}>{fmtRelative(r.created_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {newReq && <NewRequestModal templates={templates} onClose={() => setNewReq(false)} onDone={() => { setNewReq(false); setTab('mine'); load(); toast('درخواست شما ثبت شد'); }} />}
    </div>
  );
}

// نگه‌داری نام‌های قبلی برای سازگاری با کدهایی که از این ماژول import می‌کنند
export const toFileIds = toIds;
export const toImageIds = toIds; // نام قبلی — برای سازگاری

function NewRequestModal({ templates, onClose, onDone }) {
  const { toast, settings } = useStore();
  const attOff = settings?.attachments_enabled === '0'; // [پیوست‌ها] کلید سراسری
  const [tplId, setTplId] = useState(templates[0]?.id || '');
  const [title, setTitle] = useState('');
  const [data, setData] = useState({});
  const [busy, setBusy] = useState(false);
  const [previewSteps, setPreviewSteps] = useState([]);
  const tpl = templates.find(t => t.id === Number(tplId));
  let schema = [];
  try { schema = JSON.parse(tpl?.form_schema || '[]'); } catch {}

  // زنجیره تایید را با نام دقیق افراد برای این درخواست‌دهنده نمایش بده
  useEffect(() => {
    if (!tplId) { setPreviewSteps([]); return; }
    let alive = true;
    api(`/workflows/templates/${tplId}/preview`)
      .then(r => { if (alive) setPreviewSteps(r.steps); })
      .catch(() => { if (alive) setPreviewSteps([]); });
    return () => { alive = false; };
  }, [tplId]);

  const submit = async () => {
    const err = validateRequestForm(schema, data, { attachmentsOff: attOff });
    if (err) return toast(err, 'error');
    setBusy(true);
    try {
      await api('/workflows/requests', { method: 'POST', body: { template_id: tpl.id, title, form_data: data } });
      onDone();
    } catch (e) { toast(e.message, 'error'); }
    setBusy(false);
  };

  return (
    <Modal title="ثبت درخواست جدید" onClose={onClose} wide
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>انصراف</button>
        <button className="btn btn-primary" disabled={!tpl || !title.trim() || busy} onClick={submit}>ثبت درخواست</button>
      </>}>
      <Field label="نوع فرآیند">
        <select className="input" value={tplId} onChange={e => { setTplId(e.target.value); setData({}); }}>
          {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </Field>
      {tpl?.description && <p style={{ fontSize: 12.8, color: 'var(--text-2)', margin: '-6px 0 14px' }}>{tpl.description}</p>}
      {/* [مورد ۲] فایل‌های راهنمای فرآیند (عکس یا هر سند دیگر) */}
      {(() => { let atts = []; try { atts = JSON.parse(tpl?.attachments || '[]'); } catch {} return atts.length ? (
        <div style={{ marginBottom: 14 }}>
          <AttachmentList ids={atts} thumb={96} title="فایل‌های راهنمای این فرآیند" />
        </div>
      ) : null; })()}
      {tpl && (
        <div className="card-pad panel-soft" style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text-2)', marginBottom: 8 }}>مراحل و تاییدکنندگان این درخواست:</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            {(previewSteps.length ? previewSteps : tpl.steps).map((s, i) => {
              const names = (s.approver_people || []).map(p => p.full_name).join('، ');
              return (
                <div key={s.id || i} style={{ display: 'flex', gap: 8, alignItems: 'baseline', fontSize: 12.7 }}>
                  <span className={`badge ${s.is_optional ? 'badge-gray' : 'badge-primary'}`} style={{ flexShrink: 0 }}>
                    {(i + 1).toLocaleString('fa-IR')}. {s.title}{s.is_optional ? ' (اختیاری)' : ''}
                  </span>
                  <span style={{ color: 'var(--text-2)' }}>
                    ← {names || s.approver_label || 'نامشخص'}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
      <Field label="عنوان درخواست">
        <input className="input" value={title} onChange={e => setTitle(e.target.value)}
          placeholder={tpl?.title_placeholder || 'مثلاً: خرید ۵۰ کیلوگرم مس'} />
      </Field>
      <RequestFormFields schema={schema} data={data} onChange={setData} />
    </Modal>
  );
}
