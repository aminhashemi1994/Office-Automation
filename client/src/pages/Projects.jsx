// ============================================================================
//  پروژه‌ها — دسته‌بندی کلیِ کارها
//  هر کاربر کارهایش را در چند دستهٔ کلی می‌چیند (خرید و تدارکات، اداری،
//  تحقیق و توسعه، …) و اینجا می‌بیند هر دسته چقدر پیش رفته و چه چیزی عقب افتاده.
// ============================================================================
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, FolderKanban, Trash2, Pencil, Archive, ArchiveRestore, ArrowLeft, AlertTriangle, ChevronUp, ChevronDown } from 'lucide-react';
import { api } from '../api.js';
import { useStore } from '../store.jsx';
import { fa } from '../utils.js';
import { Modal, Field } from '../components/common.jsx';

const COLORS = ['#2563eb', '#0891b2', '#059669', '#d97706', '#dc2626', '#7c3aed', '#db2777', '#475569'];
const SCOPES = {
  private: ['شخصی', 'فقط خودم می‌بینم'],
  department: ['واحد', 'همهٔ اعضای واحد می‌بینند'],
  org: ['سازمانی', 'همهٔ کاربران می‌بینند'],
};

// نوارِ پیشرفت با درصدِ نوشته‌شده — رنگ به‌تنهایی حاملِ معنا نیست
function ProgressBar({ value, color }) {
  const v = Math.max(0, Math.min(100, Number(value) || 0));
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
      <div style={{ flex: 1, height: 8, borderRadius: 99, background: 'var(--border-soft)', overflow: 'hidden' }}>
        <div style={{ width: `${v}%`, height: '100%', background: color || 'var(--primary)', borderRadius: 99, transition: 'width .3s' }} />
      </div>
      <b style={{ fontSize: 12.5, minWidth: 44, textAlign: 'left' }}>{fa(v)}٪</b>
    </div>
  );
}

function ProjectModal({ project, onClose, onSaved }) {
  const { user, departments, toast } = useStore();
  const [name, setName] = useState(project?.name || '');
  const [description, setDescription] = useState(project?.description || '');
  const [color, setColor] = useState(project?.color || COLORS[0]);
  const [scope, setScope] = useState(project?.scope || 'private');
  const [deptId, setDeptId] = useState(project?.department_id || user.department_id || '');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!name.trim()) return toast('نام دسته‌بندی را وارد کنید', 'error');
    setBusy(true);
    const body = { name, description, color, scope, department_id: scope === 'department' ? Number(deptId) || null : null };
    try {
      if (project) await api(`/projects/${project.id}`, { method: 'PUT', body });
      else await api('/projects', { method: 'POST', body });
      onSaved(); onClose();
      toast(project ? 'دسته‌بندی به‌روزرسانی شد' : 'دسته‌بندی ساخته شد');
    } catch (e) { toast(e.message, 'error'); }
    setBusy(false);
  };

  return (
    <Modal title={project ? 'ویرایش دسته‌بندی' : 'دسته‌بندی جدید'} onClose={onClose}
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>انصراف</button>
        <button className="btn btn-primary" disabled={busy || !name.trim()} onClick={save}>ذخیره</button>
      </>}>
      <Field label="نام دسته‌بندی" hint="مثلاً: خرید و تدارکات، اداری و روزمره، تحقیق و توسعه، بازرگانی">
        <input className="input" value={name} autoFocus onChange={e => setName(e.target.value)} />
      </Field>
      <Field label="توضیح (اختیاری)">
        <textarea className="input" value={description} onChange={e => setDescription(e.target.value)} />
      </Field>
      <Field label="رنگ">
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {COLORS.map(c => (
            <button key={c} type="button" onClick={() => setColor(c)} title={c}
              style={{
                width: 30, height: 30, borderRadius: 9, background: c, cursor: 'pointer',
                border: color === c ? '3px solid var(--text-1)' : '1px solid var(--border)',
              }} />
          ))}
        </div>
      </Field>
      <Field label="چه کسانی این دسته را ببینند؟">
        <select className="input" value={scope} onChange={e => setScope(e.target.value)}>
          {Object.entries(SCOPES).map(([k, [label, hint]]) => (
            <option key={k} value={k} disabled={k === 'org' && user.role !== 'admin'}>
              {label} — {hint}{k === 'org' && user.role !== 'admin' ? ' (فقط مدیر سامانه)' : ''}
            </option>
          ))}
        </select>
      </Field>
      {scope === 'department' && (
        <Field label="واحد">
          <select className="input" value={deptId} onChange={e => setDeptId(e.target.value)}>
            <option value="">— انتخاب واحد —</option>
            {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </Field>
      )}
    </Modal>
  );
}

export default function Projects() {
  const { user, toast } = useStore();
  const [projects, setProjects] = useState([]);
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState(null);

  const load = async () => {
    const r = await api(`/projects${showArchived ? '?archived=1' : ''}`);
    setProjects(r.projects);
  };
  useEffect(() => { load(); }, [showArchived]);

  const archive = async (p, v) => {
    try { await api(`/projects/${p.id}`, { method: 'PUT', body: { archived: v ? 1 : 0 } }); load(); }
    catch (e) { toast(e.message, 'error'); }
  };
  const remove = async (p) => {
    if (!window.confirm(`دستهٔ «${p.name}» حذف شود؟ وظایفِ داخلش پاک نمی‌شوند و فقط بی‌دسته می‌شوند.`)) return;
    try {
      const r = await api(`/projects/${p.id}`, { method: 'DELETE' });
      load();
      toast(r.freed_tasks ? `دسته حذف شد؛ ${fa(r.freed_tasks)} وظیفه بی‌دسته شد` : 'دسته حذف شد');
    } catch (e) { toast(e.message, 'error'); }
  };
  const move = async (idx, dir) => {
    const next = [...projects];
    const j = idx + dir;
    if (j < 0 || j >= next.length) return;
    [next[idx], next[j]] = [next[j], next[idx]];
    setProjects(next);
    try { await api('/projects/reorder', { method: 'POST', body: { ids: next.map(p => p.id) } }); }
    catch (e) { toast(e.message, 'error'); load(); }
  };

  const totalTasks = projects.reduce((s, p) => s + (p.task_count || 0), 0);

  return (
    <div className="content">
      <div className="page-head">
        <div>
          <h2>پروژه‌ها و دسته‌بندی کارها</h2>
          <p style={{ fontSize: 12.5, color: 'var(--text-3)', margin: '4px 0 0' }}>
            هر وظیفه‌ای که می‌سازید می‌تواند در یکی از این دسته‌ها قرار بگیرد؛ فیلتر کردن کارها و
            پیگیریِ آن‌ها توسط مدیرِ هر بخش این‌طور ساده‌تر می‌شود.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-ghost" onClick={() => setShowArchived(v => !v)}>
            {showArchived ? <ArchiveRestore size={16} /> : <Archive size={16} />}
            {showArchived ? 'نمایش فعال‌ها' : 'نمایش بایگانی'}
          </button>
          <button className="btn btn-primary" onClick={() => setEditing('new')}><Plus size={17} /> دستهٔ جدید</button>
        </div>
      </div>

      {projects.length === 0 && (
        <div className="card card-pad" style={{ textAlign: 'center', padding: '40px 20px' }}>
          <FolderKanban size={38} style={{ color: 'var(--text-3)', marginBottom: 10 }} />
          <div style={{ fontWeight: 700, marginBottom: 6 }}>هنوز دسته‌بندی نساخته‌اید</div>
          <p style={{ fontSize: 12.8, color: 'var(--text-3)', maxWidth: 460, margin: '0 auto 14px', lineHeight: 1.9 }}>
            دسته‌ها همان تقسیم‌بندیِ کلیِ کار شماست. مثلاً اگر در دو واحد فعالیت دارید:
            «تحقیق و توسعه»، «بازرگانی»، «خرید و تدارکات» و «روزمره و اداری».
          </p>
          <button className="btn btn-primary" onClick={() => setEditing('new')}><Plus size={17} /> ساخت اولین دسته</button>
        </div>
      )}

      <div className="grid-2">
        {projects.map((p, i) => (
          <div key={p.id} className="card card-pad" style={{ opacity: p.archived ? .65 : 1 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 10 }}>
              <span style={{ width: 12, height: 12, borderRadius: 4, background: p.color, marginTop: 5, flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <b style={{ fontSize: 14.5 }}>{p.name}</b>
                <div style={{ fontSize: 11.8, color: 'var(--text-3)', marginTop: 3 }}>
                  {SCOPES[p.scope]?.[0] || 'شخصی'}
                  {p.department_name ? ` · ${p.department_name}` : ''}
                  {p.owner_id !== user.id && p.owner_name ? ` · سازندهٔ آن: ${p.owner_name}` : ''}
                  {p.archived ? ' · بایگانی‌شده' : ''}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 2 }}>
                <button className="icon-btn" title="بالا" onClick={() => move(i, -1)}><ChevronUp size={16} /></button>
                <button className="icon-btn" title="پایین" onClick={() => move(i, 1)}><ChevronDown size={16} /></button>
              </div>
            </div>

            {p.description && (
              <p style={{ fontSize: 12.5, color: 'var(--text-2)', margin: '0 0 12px', lineHeight: 1.8 }}>{p.description}</p>
            )}

            <ProgressBar value={p.progress} color={p.color} />

            <div style={{ display: 'flex', gap: 14, marginTop: 12, fontSize: 12.3, flexWrap: 'wrap' }}>
              <span style={{ color: 'var(--text-2)' }}>کل کارها: <b>{fa(p.task_count)}</b></span>
              <span style={{ color: 'var(--text-2)' }}>انجام‌شده: <b>{fa(p.done_count)}</b></span>
              {p.overdue_count > 0 && (
                <span style={{ color: 'var(--red)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <AlertTriangle size={13} /> {fa(p.overdue_count)} دارای تأخیر
                </span>
              )}
            </div>

            <div style={{ display: 'flex', gap: 6, marginTop: 14, flexWrap: 'wrap' }}>
              <Link className="btn btn-ghost btn-sm" to={`/tasks?project=${p.id}`}>کارهای این دسته <ArrowLeft size={14} /></Link>
              {(p.owner_id === user.id || user.role === 'admin') && <>
                <button className="btn btn-ghost btn-sm" onClick={() => setEditing(p)}><Pencil size={13} /> ویرایش</button>
                <button className="btn btn-ghost btn-sm" onClick={() => archive(p, !p.archived)}>
                  {p.archived ? <ArchiveRestore size={13} /> : <Archive size={13} />} {p.archived ? 'بازگرداندن' : 'بایگانی'}
                </button>
                <button className="btn btn-ghost btn-sm" style={{ color: 'var(--red)', marginInlineStart: 'auto' }}
                  onClick={() => remove(p)}><Trash2 size={13} /></button>
              </>}
            </div>
          </div>
        ))}
      </div>

      {projects.length > 0 && (
        <p style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 14 }}>
          مجموع کارهای دسته‌بندی‌شدهٔ شما: {fa(totalTasks)}
        </p>
      )}

      {editing && (
        <ProjectModal project={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)} onSaved={load} />
      )}
    </div>
  );
}
