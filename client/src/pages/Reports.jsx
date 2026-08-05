import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Printer, Search, FileText, Paperclip, Pencil, Trash2 } from 'lucide-react';
import { api } from '../api.js';
import { useStore } from '../store.jsx';
import { fmtDateTime, fmtDate, fa, printReport } from '../utils.js';
import { Modal, Field } from '../components/common.jsx';
import RequestFormFields, { validateRequestForm } from '../components/RequestForm.jsx';
import { STATUS, OPEN_STATUSES } from './Cartable.jsx';

export default function Reports() {
  const { departments, settings, user, hasPerm, toast } = useStore();
  const [templates, setTemplates] = useState([]);
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);
  const [filters, setFilters] = useState({ template_id: '', status: '', department_id: '', from: '', to: '' });
  const [edit, setEdit] = useState(null);             // {row, title, data} — ویرایش درخواست از بایگانی
  const [confirmDel, setConfirmDel] = useState(null); // ردیفی که در آستانهٔ حذف است

  // ویرایش و حذفِ درخواست‌های بایگانی‌شده فقط برای مدیر سامانه/دارندهٔ workflows.manage
  const canManage = user?.role === 'admin' || hasPerm('workflows.manage');

  useEffect(() => {
    api('/workflows/templates').then(r => setTemplates(r.templates)).catch(() => {});
  }, []);

  const load = async () => {
    setBusy(true);
    try {
      const qs = new URLSearchParams(Object.entries(filters).filter(([, v]) => v)).toString();
      const r = await api(`/workflows/reports${qs ? '?' + qs : ''}`);
      setRows(r.requests);
    } catch (e) { toast(e.message, 'error'); }
    setBusy(false);
  };
  useEffect(() => { load(); }, []);

  const setF = (patch) => setFilters(f => ({ ...f, ...patch }));

  // فرمِ فرآیندِ همین درخواست (برای ویرایش)
  const schemaOf = (row) => {
    const tpl = templates.find(t => t.id === row.template_id);
    try { return JSON.parse(tpl?.form_schema || '[]'); } catch { return []; }
  };

  const openEdit = (row) => {
    let data = {};
    try { data = JSON.parse(row.form_data || '{}'); } catch {}
    setEdit({ row, title: row.title, data });
  };

  const submitEdit = async () => {
    const err = validateRequestForm(schemaOf(edit.row), edit.data, {
      attachmentsOff: settings?.attachments_enabled === '0', allowPast: true,
    });
    if (err) return toast(err, 'error');
    setBusy(true);
    try {
      await api(`/workflows/requests/${edit.row.id}`, { method: 'PUT', body: { title: edit.title, form_data: edit.data } });
      setEdit(null);
      await load();
      toast('درخواست ویرایش شد');
    } catch (e) { toast(e.message, 'error'); }
    setBusy(false);
  };

  const remove = async () => {
    setBusy(true);
    try {
      await api(`/workflows/requests/${confirmDel.id}`, { method: 'DELETE' });
      setConfirmDel(null);
      await load();
      toast('درخواست حذف شد');
    } catch (e) { toast(e.message, 'error'); }
    setBusy(false);
  };

  const summary = {
    total: rows.length,
    approved: rows.filter(r => r.status === 'approved').length,
    rejected: rows.filter(r => r.status === 'rejected').length,
    // وضعیت‌های باز (در جریان، در انتظار تایید نهایی، برگشت برای اصلاح) با هم شمرده می‌شوند
    // تا جمع کارت‌ها با «کل» بخواند
    in_progress: rows.filter(r => OPEN_STATUSES.includes(r.status)).length,
  };

  const activeFilterLabels = () => {
    const parts = [];
    if (filters.template_id) parts.push('نوع: ' + (templates.find(t => t.id === Number(filters.template_id))?.name || ''));
    if (filters.status) parts.push('وضعیت: ' + (STATUS[filters.status]?.[0] || filters.status));
    if (filters.department_id) parts.push('واحد: ' + (departments.find(d => d.id === Number(filters.department_id))?.name || ''));
    if (filters.from) parts.push('از: ' + fmtDate(filters.from));
    if (filters.to) parts.push('تا: ' + fmtDate(filters.to));
    return parts.join(' · ');
  };

  return (
    <div className="content">
      <div className="page-head">
        <h2>گزارش‌گیری و بایگانی درخواست‌ها</h2>
        <button className="btn btn-primary" disabled={!rows.length} onClick={() => printReport(rows, activeFilterLabels())}>
          <Printer size={17} /> چاپ گزارش
        </button>
      </div>

      <div className="card card-pad" style={{ marginBottom: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12, alignItems: 'end' }}>
          <div>
            <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--text-2)', marginBottom: 6 }}>نوع درخواست</label>
            <select className="input" value={filters.template_id} onChange={e => setF({ template_id: e.target.value })}>
              <option value="">همه</option>
              {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--text-2)', marginBottom: 6 }}>وضعیت</label>
            <select className="input" value={filters.status} onChange={e => setF({ status: e.target.value })}>
              <option value="">همه</option>
              {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v[0]}</option>)}
            </select>
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--text-2)', marginBottom: 6 }}>واحد درخواست‌دهنده</label>
            <select className="input" value={filters.department_id} onChange={e => setF({ department_id: e.target.value })}>
              <option value="">همه</option>
              {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--text-2)', marginBottom: 6 }}>از تاریخ</label>
            <input className="input" type="date" value={filters.from} onChange={e => setF({ from: e.target.value })} />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--text-2)', marginBottom: 6 }}>تا تاریخ</label>
            <input className="input" type="date" value={filters.to} onChange={e => setF({ to: e.target.value })} />
          </div>
          <button className="btn btn-primary" onClick={load} disabled={busy}><Search size={16} /> اعمال فیلتر</button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <div className="card card-pad" style={{ flex: 1, minWidth: 130 }}><small style={{ color: 'var(--text-3)' }}>کل</small><div style={{ fontSize: 22, fontWeight: 700 }}>{fa(summary.total)}</div></div>
        <div className="card card-pad" style={{ flex: 1, minWidth: 130 }}><small style={{ color: 'var(--text-3)' }}>تایید نهایی</small><div style={{ fontSize: 22, fontWeight: 700, color: 'var(--green)' }}>{fa(summary.approved)}</div></div>
        <div className="card card-pad" style={{ flex: 1, minWidth: 130 }}><small style={{ color: 'var(--text-3)' }}>رد شده</small><div style={{ fontSize: 22, fontWeight: 700, color: 'var(--red)' }}>{fa(summary.rejected)}</div></div>
        <div className="card card-pad" style={{ flex: 1, minWidth: 130 }}><small style={{ color: 'var(--text-3)' }}>در جریان</small><div style={{ fontSize: 22, fontWeight: 700, color: 'var(--primary)' }}>{fa(summary.in_progress)}</div></div>
      </div>

      <div className="card">
        {rows.length === 0 ? (
          <div className="empty"><FileText size={40} /><div>درخواستی با این فیلترها یافت نشد</div></div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>#</th><th>عنوان</th><th>نوع درخواست</th><th>درخواست‌دهنده</th>
                <th>واحد</th><th>وضعیت / مرحله</th><th>تاییدها</th><th>تاریخ ثبت</th><th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const [sl, sc] = STATUS[r.status] || STATUS.in_progress;
                return (
                  <tr key={r.id}>
                    <td>{fa(r.id)}</td>
                    <td>
                      <Link to={`/cartable/${r.id}`} style={{ fontWeight: 600, color: 'var(--primary)' }}>{r.title}</Link>
                      {/* [پیوست‌ها] نشانِ «این درخواست فایل پیوست دارد» */}
                      {r.attachments_count > 0 && (
                        <span className="badge badge-sky" style={{ marginRight: 6 }}
                          title={`${fa(r.attachments_count)} فایل پیوست دارد`}>
                          <Paperclip size={11} /> {fa(r.attachments_count)}
                        </span>
                      )}
                    </td>
                    <td>{r.template_name}</td>
                    <td>{r.requester_name}</td>
                    <td>{r.requester_department || '—'}</td>
                    <td>
                      <span className={`badge ${sc}`}>{sl}</span>
                      {r.status === 'in_progress' && r.step_title && (
                        <span style={{ fontSize: 12, color: 'var(--text-2)', marginRight: 6 }}>{r.step_title}</span>
                      )}
                    </td>
                    <td>{fa(r.approvals_count || 0)}</td>
                    <td style={{ color: 'var(--text-3)', fontSize: 12.5 }}>{fmtDate(r.created_at)}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <Link to={`/cartable/${r.id}`} className="icon-btn" style={{ width: 30, height: 30 }} title="مشاهده و چاپ"><FileText size={14} /></Link>
                        {/* ویرایش و حذفِ درخواست مستقیماً از بایگانی */}
                        {canManage && (
                          <>
                            <button className="icon-btn" style={{ width: 30, height: 30 }} title="ویرایش درخواست"
                              onClick={() => openEdit(r)}><Pencil size={14} /></button>
                            <button className="icon-btn" style={{ width: 30, height: 30, color: 'var(--red)' }} title="حذف درخواست"
                              onClick={() => setConfirmDel(r)}><Trash2 size={14} /></button>
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

      {/* ویرایش درخواست از صفحهٔ گزارش‌گیری */}
      {edit && (
        <Modal title={`ویرایش درخواست «${edit.row.title}»`} onClose={() => setEdit(null)} wide
          footer={<>
            <button className="btn btn-ghost" onClick={() => setEdit(null)}>انصراف</button>
            <button className="btn btn-primary" disabled={busy || !edit.title.trim()} onClick={submitEdit}>ذخیره تغییرات</button>
          </>}>
          <p style={{ fontSize: 12.5, color: 'var(--text-2)', marginTop: 0 }}>
            تغییرات به‌همراه فهرست فیلدهای عوض‌شده در تاریخچهٔ درخواست ثبت و به افرادِ درگیر اعلام می‌شود.
          </p>
          <Field label="عنوان درخواست">
            <input className="input" value={edit.title} autoFocus onChange={e => setEdit(v => ({ ...v, title: e.target.value }))} />
          </Field>
          <RequestFormFields schema={schemaOf(edit.row)} data={edit.data} allowPast
            onChange={d => setEdit(v => ({ ...v, data: d }))} />
        </Modal>
      )}

      {/* حذف درخواست از بایگانی */}
      {confirmDel && (
        <Modal title="حذف درخواست" onClose={() => setConfirmDel(null)}
          footer={<>
            <button className="btn btn-ghost" onClick={() => setConfirmDel(null)}>انصراف</button>
            <button className="btn btn-danger" disabled={busy} onClick={remove}>بله، حذف کن</button>
          </>}>
          <p style={{ fontSize: 13.5, margin: 0 }}>
            درخواست «{confirmDel.title}» ({confirmDel.template_name}) به‌همراه تمام تاریخچهٔ اقدامات آن
            برای همیشه حذف می‌شود. این کار بازگشت‌پذیر نیست.
          </p>
        </Modal>
      )}
    </div>
  );
}
