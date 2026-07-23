import React, { useEffect, useState, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, Clock, Trash2, Circle, LoaderCircle, CheckCircle2, Search, CalendarClock, Send, MessageSquare, X, UserPlus, Users2 } from 'lucide-react';
import { api } from '../api.js';
import { useStore } from '../store.jsx';
import { fmtDateTime, deadlineState, fa } from '../utils.js';
import { Modal, Field, UserPicker, Avatar } from '../components/common.jsx';
import { JalaliDatePicker } from '../components/JalaliDatePicker.jsx';
import { TimePicker } from '../components/TimePicker.jsx';
import { toJalaali, toGregorian, formatJalali, parseJalali } from '../jalali.js';

// تبدیل ISO ↔ (تاریخ شمسی، ساعت ۲۴)
function isoToParts(iso) {
  if (!iso) return { date: '', time: '' };
  const d = new Date(iso);
  const j = toJalaali(d.getFullYear(), d.getMonth() + 1, d.getDate());
  return {
    date: formatJalali(j.jy, j.jm, j.jd),
    time: `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`,
  };
}
function partsToIso(date, time) {
  if (!date) return null;
  const p = parseJalali(date);
  if (!p) return null;
  const g = toGregorian(p.jy, p.jm, p.jd);
  const [h, m] = (time && /^\d{1,2}:\d{1,2}$/.test(time)) ? time.split(':').map(Number) : [0, 0];
  return new Date(g.gy, g.gm - 1, g.gd, h, m, 0, 0).toISOString();
}

const PRIORITY = { low: ['کم', 'badge-gray'], normal: ['عادی', 'badge-sky'], high: ['زیاد', 'badge-amber'], urgent: ['فوری', 'badge-red'] };
const COLS = [
  ['todo', 'در انتظار', Circle, 'var(--text-3)'],
  ['doing', 'در حال انجام', LoaderCircle, 'var(--sky)'],
  ['done', 'انجام شده', CheckCircle2, 'var(--green)'],
];


// چه کسانی به چه کسانی تسک می‌دهند (آینه قوانین بک‌اند):
// مدیر سامانه و اعضای واحد مدیریت → همه؛ سرگروه/مدیر واحد و دارندگان tasks.assign → واحد خودشان
export function allowedAssignees(user, users, departments, hasPerm) {
  const myDept = departments.find(d => d.id === user.department_id);
  if (user.role === 'admin' || myDept?.is_management) return users.filter(u => u.is_active);
  const managed = departments.filter(d => d.manager_id === user.id).map(d => d.id);
  const canDept = user.role === 'manager' || managed.length > 0 || hasPerm('tasks.assign');
  return users.filter(u => u.is_active && (
    u.id === user.id ||
    (canDept && (managed.includes(u.department_id) || (user.department_id && u.department_id === user.department_id)))
  ));
}

export default function Tasks() {
  const { user, hasPerm, on, toast, setTaskCount } = useStore();
  const [tab, setTab] = useState('mine');
  const [mine, setMine] = useState([]);
  const [assigned, setAssigned] = useState([]);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState(null); // task object or 'new'
  const [focusComments, setFocusComments] = useState(false); // باز شدن روی بخش گفتگو
  const [params, setParams] = useSearchParams();
  const wantTaskId = Number(params.get('task')) || null;

  const load = async () => {
    const r = await api('/tasks');
    setMine(r.mine); setAssigned(r.assigned);
    setTaskCount(r.mine.filter(t => t.status !== 'done').length);
  };
  useEffect(() => {
    load();
    const offNotif = on('notification', load);
    const offComment = on('task:comment', load); // به‌روزرسانی زندهٔ تخته و شمارنده‌ها هنگام کامنت جدید
    return () => { offNotif(); offComment(); };
  }, []);

  // باز کردن مستقیم تسکِ مقصدِ اعلان و رفتن به بخش گفتگو
  useEffect(() => {
    if (!wantTaskId) return;
    const found = [...mine, ...assigned].find(t => t.id === wantTaskId);
    if (found) {
      if (assigned.some(t => t.id === wantTaskId) && !mine.some(t => t.id === wantTaskId)) setTab('assigned');
      setEditing(found);
      setFocusComments(true);
      setParams({}, { replace: true }); // پاک‌کردن پارامتر تا با بستن مودال دوباره باز نشود
    }
  }, [wantTaskId, mine, assigned]);

  const move = async (t, status) => {
    try { await api(`/tasks/${t.id}`, { method: 'PUT', body: { status } }); load(); }
    catch (e) { toast(e.message, 'error'); }
  };

  const remove = async (t) => {
    try { await api(`/tasks/${t.id}`, { method: 'DELETE' }); load(); toast('تسک حذف شد'); }
    catch (e) { toast(e.message, 'error'); }
  };

  const all = tab === 'mine' ? mine : assigned;
  const list = all.filter(t => !search
    || t.title.includes(search) || (t.description || '').includes(search)
    || t.assignee_name.includes(search) || t.assigner_name.includes(search));

  return (
    <div className="content">
      <div className="page-head">
        <div className="tabs">
          <button className={`tab ${tab === 'mine' ? 'active' : ''}`} onClick={() => setTab('mine')}>
            تسک‌های من {mine.filter(t => t.status !== 'done').length > 0 && <span className="badge-count">{fa(mine.filter(t => t.status !== 'done').length)}</span>}
          </button>
          <button className={`tab ${tab === 'assigned' ? 'active' : ''}`} onClick={() => setTab('assigned')}>واگذارشده به دیگران</button>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <div style={{ position: 'relative' }}>
            <Search size={15} style={{ position: 'absolute', right: 11, top: 11, color: 'var(--text-3)' }} />
            <input className="input" style={{ paddingRight: 34, width: 220 }} placeholder="جستجو در تسک‌ها…"
              value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <button className="btn btn-primary" onClick={() => setEditing('new')}><Plus size={17} /> تسک جدید</button>
        </div>
      </div>

      <div className="kanban">
        {COLS.map(([key, label, Icon, color]) => (
          <div key={key} className="kanban-col">
            <h4><Icon size={16} style={{ color }} /> {label} <span style={{ color: 'var(--text-3)', fontWeight: 400 }}>({fa(list.filter(t => t.status === key).length)})</span></h4>
            {list.filter(t => t.status === key).map(t => {
              const [pl, pc] = PRIORITY[t.priority] || PRIORITY.normal;
              const ds = deadlineState(t.deadline, t.status);
              const isParticipant = (t.participants || []).some(p => p.id === user.id);
              const canEdit = t.assignee_id === user.id || t.assigner_id === user.id || user.role === 'admin' || isParticipant;
              return (
                <div key={t.id} className="task-card" onClick={() => canEdit && setEditing(t)}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 5 }}>
                    <b style={{ fontSize: 13.5 }}>{t.title}</b>
                    <span className={`badge ${pc}`}>{pl}</span>
                  </div>
                  {t.description && <p style={{ fontSize: 12.5, color: 'var(--text-2)', marginBottom: 7, whiteSpace: 'pre-wrap' }}>{t.description.slice(0, 120)}</p>}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11.8, color: 'var(--text-2)' }}>
                      <Avatar name={tab === 'mine' ? t.assigner_name : t.assignee_name} size={18} color={t.assignee_color} />
                      {tab === 'mine' ? `از: ${t.assigner_name}` : t.assignee_name}
                    </span>
                    {t.start_at && (
                      <span className="badge badge-sky"><CalendarClock size={11} /> شروع: {fmtDateTime(t.start_at)}</span>
                    )}
                    {t.deadline && (
                      <span className={`badge ${ds === 'overdue' ? 'badge-red' : ds === 'soon' ? 'badge-amber' : 'badge-gray'}`}>
                        <Clock size={11} /> {fmtDateTime(t.deadline)}
                      </span>
                    )}
                    {(t.participants || []).length > 0 && (
                      <span className="badge badge-gray"><Users2 size={11} /> {fa(t.participants.length)} همکار</span>
                    )}
                    {t.comment_count > 0 && (
                      <span className="badge badge-gray"><MessageSquare size={11} /> {fa(t.comment_count)}</span>
                    )}
                    {t.unread_comments > 0 && (
                      <span className="badge badge-red" title="کامنت خوانده‌نشده">
                        <MessageSquare size={11} /> {fa(t.unread_comments)} جدید
                      </span>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 6, marginTop: 9 }} onClick={e => e.stopPropagation()}>
                    {key !== 'todo' && <button className="btn btn-ghost btn-sm" onClick={() => move(t, key === 'done' ? 'doing' : 'todo')}>→ قبلی</button>}
                    {key !== 'done' && <button className="btn btn-success btn-sm" onClick={() => move(t, key === 'todo' ? 'doing' : 'done')}>{key === 'doing' ? 'انجام شد ✓' : 'شروع'}</button>}
                    {(t.assigner_id === user.id || user.role === 'admin') && (
                      <button className="btn btn-ghost btn-sm" style={{ marginRight: 'auto', color: 'var(--red)' }} onClick={() => remove(t)}><Trash2 size={13} /></button>
                    )}
                  </div>
                </div>
              );
            })}
            {list.filter(t => t.status === key).length === 0 && (
              <div style={{ textAlign: 'center', color: 'var(--text-3)', fontSize: 12.5, padding: '18px 0' }}>خالی</div>
            )}
          </div>
        ))}
      </div>

      {editing && (
        <TaskModal task={editing === 'new' ? null : editing}
          scrollToComments={focusComments}
          onClose={() => { setEditing(null); setFocusComments(false); load(); }}
          onDone={() => { setEditing(null); setFocusComments(false); load(); }} />
      )}
    </div>
  );
}

function TaskModal({ task, onClose, onDone, scrollToComments }) {
  const { user, users, departments, hasPerm, toast, refreshNotifs, refreshBadges, on } = useStore();
  const [title, setTitle] = useState(task?.title || '');
  const [description, setDescription] = useState(task?.description || '');
  const [assignee, setAssignee] = useState(task?.assignee_id || user.id);
  const [priority, setPriority] = useState(task?.priority || 'normal');
  const sp = isoToParts(task?.start_at);
  const dp = isoToParts(task?.deadline);
  const [startDate, setStartDate] = useState(sp.date);
  const [startTime, setStartTime] = useState(sp.time);
  const [deadlineDate, setDeadlineDate] = useState(dp.date);
  const [deadlineTime, setDeadlineTime] = useState(dp.time);
  const [participants, setParticipants] = useState((task?.participants || []).map(p => p.id));
  const [busy, setBusy] = useState(false);
  const assignable = allowedAssignees(user, users, departments, hasPerm);

  // چه کسی می‌تواند مشارکت‌کننده اضافه کند
  const canManageParts = user.role === 'admin' || user.role === 'manager'
    || departments.some(d => d.manager_id === user.id)
    || !task || task.assigner_id === user.id;
  const partOptions = users.filter(u => u.is_active && u.id !== assignee && u.id !== user.id && !participants.includes(u.id));
  const nameOf = (id) => users.find(u => u.id === id)?.full_name || '—';

  // ---------- کامنت‌ها ----------
  const [comments, setComments] = useState([]);
  const [commentText, setCommentText] = useState('');
  const [cBusy, setCBusy] = useState(false);
  const commentsRef = useRef(null);
  const didScroll = useRef(false);
  // پس از بارگذاری کامنت‌ها، اگر از طریق اعلان باز شده، به بخش گفتگو اسکرول کن
  useEffect(() => {
    if (!scrollToComments || didScroll.current || !task) return;
    if (!commentsRef.current) return;
    didScroll.current = true;
    const id = setTimeout(() => commentsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 250);
    return () => clearTimeout(id);
  }, [scrollToComments, comments, task]);
  useEffect(() => {
    if (!task) return;
    // با باز شدن تسک، کامنت‌ها خوانده‌شده علامت می‌خورند؛ سپس شمارنده‌ها و اعلان‌ها به‌روز می‌شوند
    api(`/tasks/${task.id}/comments`).then(r => {
      setComments(r.comments);
      refreshNotifs?.();
      refreshBadges?.();
    }).catch(() => {});
    // دریافت زندهٔ کامنت‌های جدیدِ همین تسک بدون رفرش صفحه
    const off = on('task:comment', (d) => {
      if (d.task_id !== task.id) return;
      setComments(list => list.some(c => c.id === d.comment.id) ? list : [...list, d.comment]);
      // چون مودال باز است، تلقی می‌شود دیده شده؛ اعلان مربوطه هم خوانده می‌شود
      api(`/tasks/${task.id}/comments`).catch(() => {});
      refreshNotifs?.();
    });
    return off;
  }, [task?.id]);
  const sendComment = async () => {
    const body = commentText.trim();
    if (!body) return;
    setCBusy(true);
    try {
      const r = await api(`/tasks/${task.id}/comments`, { method: 'POST', body: { body } });
      setComments(c => [...c, r.comment]);
      setCommentText('');
    } catch (e) { toast(e.message, 'error'); }
    setCBusy(false);
  };

  const save = async () => {
    setBusy(true);
    try {
      const body = {
        title, description, priority,
        start_at: partsToIso(startDate, startTime),
        deadline: partsToIso(deadlineDate, deadlineTime),
        participant_ids: participants,
      };
      if (task) await api(`/tasks/${task.id}`, { method: 'PUT', body });
      else await api('/tasks', { method: 'POST', body: { ...body, assignee_id: assignee } });
      onDone();
      toast(task ? 'تسک به‌روزرسانی شد' : 'تسک ایجاد شد');
    } catch (e) { toast(e.message, 'error'); }
    setBusy(false);
  };

  return (
    <Modal title={task ? 'ویرایش تسک' : 'تسک جدید'} onClose={onClose}
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>انصراف</button>
        <button className="btn btn-primary" disabled={!title.trim() || busy} onClick={save}>{task ? 'ذخیره' : 'ایجاد تسک'}</button>
      </>}>
      <Field label="عنوان">
        <input className="input" value={title} onChange={e => setTitle(e.target.value)} autoFocus />
      </Field>
      <Field label="توضیحات">
        <textarea className="input" value={description} onChange={e => setDescription(e.target.value)} />
      </Field>
      {!task && (
        <Field label="مسئول انجام">
          {assignable.length > 1 ? (
            <UserPicker value={assignee} onChange={setAssignee} users={assignable} />
          ) : (
            <input className="input" value={user.full_name} disabled />
          )}
        </Field>
      )}
      <Field label="اولویت">
        <select className="input" value={priority} onChange={e => setPriority(e.target.value)}>
          <option value="low">کم</option>
          <option value="normal">عادی</option>
          <option value="high">زیاد</option>
          <option value="urgent">فوری</option>
        </select>
      </Field>
      <Field label="زمان شروع (اختیاری)">
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ minWidth: 150 }}>
            <div style={{ fontSize: 11.5, color: 'var(--text-3)', marginBottom: 4 }}>تاریخ</div>
            <JalaliDatePicker value={startDate} onChange={setStartDate} placeholder="تاریخ شروع" />
          </div>
          <div>
            <div style={{ fontSize: 11.5, color: 'var(--text-3)', marginBottom: 4 }}>ساعت</div>
            <TimePicker value={startTime} onChange={setStartTime} variant="input" />
          </div>
        </div>
      </Field>
      <Field label="مهلت انجام (اختیاری)">
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ minWidth: 150 }}>
            <div style={{ fontSize: 11.5, color: 'var(--text-3)', marginBottom: 4 }}>تاریخ</div>
            <JalaliDatePicker value={deadlineDate} onChange={setDeadlineDate} placeholder="تاریخ مهلت" />
          </div>
          <div>
            <div style={{ fontSize: 11.5, color: 'var(--text-3)', marginBottom: 4 }}>ساعت</div>
            <TimePicker value={deadlineTime} onChange={setDeadlineTime} variant="input" />
          </div>
        </div>
      </Field>

      {/* مشارکت‌کنندگان */}
      {canManageParts && (
        <Field label="مشارکت‌کنندگان (اختیاری)">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
            {participants.length === 0 && <span style={{ fontSize: 12, color: 'var(--text-3)' }}>کسی اضافه نشده است.</span>}
            {participants.map(id => (
              <span key={id} className="badge badge-sky" style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                {nameOf(id)}
                <X size={12} style={{ cursor: 'pointer' }} onClick={() => setParticipants(p => p.filter(x => x !== id))} />
              </span>
            ))}
          </div>
          <select className="input" value="" onChange={e => { const id = Number(e.target.value); if (id) setParticipants(p => [...p, id]); }}>
            <option value="">+ افزودن مشارکت‌کننده…</option>
            {partOptions.map(u => <option key={u.id} value={u.id}>{u.full_name}{u.department_name ? ` (${u.department_name})` : ''}</option>)}
          </select>
          <div style={{ fontSize: 11.5, color: 'var(--text-3)', marginTop: 4 }}>
            مشارکت‌کنندگان می‌توانند تسک را ببینند، کامنت بگذارند و وضعیت را تغییر دهند.
          </div>
        </Field>
      )}

      {/* پیگیری و کامنت‌ها — فقط برای تسک موجود */}
      {task && (
        <div ref={commentsRef} style={{ marginTop: 8, borderTop: '1px solid var(--border-soft)', paddingTop: 14 }}>
          <b style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <MessageSquare size={16} /> پیگیری و گفتگو {comments.length > 0 && <span className="badge-count">{fa(comments.length)}</span>}
          </b>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 240, overflowY: 'auto', marginBottom: 12 }}>
            {comments.length === 0 && <div style={{ fontSize: 12.5, color: 'var(--text-3)' }}>هنوز کامنتی ثبت نشده است.</div>}
            {comments.map(c => (
              <div key={c.id} style={{ display: 'flex', gap: 9 }}>
                <Avatar name={c.author_name || '—'} color={c.author_color} size={30} avatar={c.author_avatar} />
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                    <b style={{ fontSize: 12.8 }}>{c.author_name || 'کاربر حذف‌شده'}</b>
                    <span style={{ fontSize: 10.5, color: 'var(--text-3)' }}>{fmtDateTime(c.created_at)}</span>
                  </div>
                  <div style={{ fontSize: 13, whiteSpace: 'pre-wrap', color: 'var(--text-1)' }}>{c.body}</div>
                </div>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            <textarea className="input" style={{ flex: 1, minHeight: 40 }} placeholder="یک کامنت بنویسید…"
              value={commentText} onChange={e => setCommentText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) sendComment(); }} />
            <button className="btn btn-primary" disabled={cBusy || !commentText.trim()} onClick={sendComment}><Send size={15} /> ارسال</button>
          </div>
        </div>
      )}
    </Modal>
  );
}
