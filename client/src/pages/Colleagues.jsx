// ============================================================================
//  همکارانم — دفترچهٔ افراد سازمان
//  جست‌وجو بین همکاران، دیدن واحد و سمت و شمارهٔ تماس، و شروعِ سریعِ گفتگو
//  یا واگذاری یک وظیفه — بدون اینکه لازم باشد کاربر مسیرها را بلد باشد.
// ============================================================================
import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, MessageSquare, ListTodo, Phone, Mail, Building2, Users2 } from 'lucide-react';
import { api } from '../api.js';
import { useStore } from '../store.jsx';
import { fa } from '../utils.js';
import { Avatar } from '../components/common.jsx';
import TaskModal from '../components/TaskModal.jsx';

export default function Colleagues() {
  const { user, users, departments, onlineIds, toast } = useStore();
  const [q, setQ] = useState('');
  const [dept, setDept] = useState('');
  const [taskFor, setTaskFor] = useState(null);
  const [projects, setProjects] = useState([]);
  const navigate = useNavigate();

  const list = useMemo(() => {
    const nq = q.trim().toLowerCase();
    const norm = (s) => String(s || '').toLowerCase();
    return users
      .filter(u => u.is_active)
      .filter(u => !dept || String(u.department_id) === String(dept))
      .filter(u => !nq || norm(u.full_name).includes(nq) || norm(u.username).includes(nq)
        || norm(u.position).includes(nq) || norm(u.department_name).includes(nq) || norm(u.phone).includes(nq))
      .sort((a, b) => {
        const oa = onlineIds?.has(a.id) ? 0 : 1, ob = onlineIds?.has(b.id) ? 0 : 1;
        return oa !== ob ? oa - ob : String(a.full_name).localeCompare(String(b.full_name), 'fa');
      });
  }, [users, q, dept, onlineIds]);

  const startChat = async (u) => {
    try {
      const r = await api('/chat/conversations', { method: 'POST', body: { type: 'dm', member_ids: [u.id] } });
      navigate(`/chat?c=${r.conversation.id}`);
    } catch (e) { toast(e.message, 'error'); }
  };
  const openTask = async (u) => {
    if (!projects.length) {
      try { const p = await api('/projects'); setProjects(p.projects); } catch {}
    }
    setTaskFor(u);
  };

  return (
    <div className="content">
      <div className="page-head" style={{ flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h2>همکارانم</h2>
          <p style={{ fontSize: 12.5, color: 'var(--text-3)', margin: '4px 0 0' }}>
            {fa(list.length)} همکار{dept ? ' در این واحد' : ''} — برای گفتگو یا واگذاری کار، از همین‌جا اقدام کنید.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ position: 'relative' }}>
            <Search size={15} style={{ position: 'absolute', right: 11, top: 11, color: 'var(--text-3)' }} />
            <input className="input" style={{ paddingRight: 34, width: 240 }} placeholder="نام، سمت، واحد یا شماره…"
              value={q} onChange={e => setQ(e.target.value)} />
          </div>
          <select className="input" style={{ width: 'auto' }} value={dept} onChange={e => setDept(e.target.value)}>
            <option value="">همهٔ واحدها</option>
            {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </div>
      </div>

      {list.length === 0 && (
        <div className="card"><div className="empty">همکاری با این مشخصات پیدا نشد</div></div>
      )}

      <div className="grid-3">
        {list.map(u => {
          const online = onlineIds?.has(u.id);
          return (
            <div key={u.id} className="card card-pad">
              <div style={{ display: 'flex', gap: 11, alignItems: 'center', marginBottom: 10 }}>
                <div style={{ position: 'relative' }}>
                  <Avatar name={u.full_name} color={u.avatar_color} size={44} avatar={u.avatar_path} />
                  <span title={online ? 'آنلاین' : 'آفلاین'} style={{
                    position: 'absolute', insetInlineEnd: -1, bottom: -1, width: 12, height: 12, borderRadius: 99,
                    background: online ? 'var(--green)' : 'var(--text-3)', border: '2px solid var(--bg-1)',
                  }} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <b style={{ fontSize: 14 }}>{u.full_name}</b>
                  <div style={{ fontSize: 12, color: 'var(--text-3)' }}>{u.position || '—'}</div>
                </div>
              </div>
              <div style={{ display: 'grid', gap: 5, fontSize: 12.3, color: 'var(--text-2)', marginBottom: 12 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Building2 size={13} style={{ color: 'var(--text-3)' }} /> {u.department_name || 'بدون واحد'}
                </span>
                {u.phone && (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6, direction: 'ltr', justifyContent: 'flex-end' }}>
                    {u.phone} <Phone size={13} style={{ color: 'var(--text-3)' }} />
                  </span>
                )}
                {u.email && (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6, direction: 'ltr', justifyContent: 'flex-end', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {u.email} <Mail size={13} style={{ color: 'var(--text-3)' }} />
                  </span>
                )}
              </div>
              {u.id !== user.id && (
                <div style={{ display: 'flex', gap: 6 }}>
                  <button className="btn btn-ghost btn-sm" onClick={() => startChat(u)}><MessageSquare size={14} /> گفتگو</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => openTask(u)}><ListTodo size={14} /> واگذاری کار</button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {taskFor && (
        <TaskModal task={null} projects={projects} defaultAssigneeId={taskFor.id}
          onClose={() => setTaskFor(null)}
          onDone={() => { setTaskFor(null); toast(`وظیفه به ${taskFor.full_name} واگذار شد`); }} />
      )}
    </div>
  );
}
