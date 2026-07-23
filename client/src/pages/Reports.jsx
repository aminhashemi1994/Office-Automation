import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Printer, Search, FileText } from 'lucide-react';
import { api } from '../api.js';
import { useStore } from '../store.jsx';
import { fmtDateTime, fmtDate, fa, printReport } from '../utils.js';
import { STATUS } from './Cartable.jsx';

export default function Reports() {
  const { departments, toast } = useStore();
  const [templates, setTemplates] = useState([]);
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);
  const [filters, setFilters] = useState({ template_id: '', status: '', department_id: '', from: '', to: '' });

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

  const summary = {
    total: rows.length,
    approved: rows.filter(r => r.status === 'approved').length,
    rejected: rows.filter(r => r.status === 'rejected').length,
    in_progress: rows.filter(r => r.status === 'in_progress').length,
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
                    <td><Link to={`/cartable/${r.id}`} style={{ fontWeight: 600, color: 'var(--primary)' }}>{r.title}</Link></td>
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
                      <Link to={`/cartable/${r.id}`} className="icon-btn" style={{ width: 30, height: 30 }} title="مشاهده و چاپ"><FileText size={14} /></Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
