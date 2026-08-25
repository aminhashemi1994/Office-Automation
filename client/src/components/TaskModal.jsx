// ============================================================================
//  پنجرهٔ وظیفه — ساخت و ویرایش
//  یک وظیفه اینجا کامل می‌شود: مشخصات، دسته‌بندی، زمان‌ها و یادآوری، پیوست،
//  چک‌لیستِ مراحل (که درصد پیشرفت از روی آن حساب می‌شود) و گزارش‌های کاری.
// ============================================================================
import React, { useEffect, useState, useRef } from 'react';
import {
  Send, MessageSquare, X, Users2, Plus, GripVertical, Trash2, Check, Pencil,
  ChevronUp, ChevronDown, Bell, Paperclip, ListChecks, Save,
} from 'lucide-react';
import { api } from '../api.js';
import { useStore } from '../store.jsx';
import { fmtDateTime, fa } from '../utils.js';
import { Modal, Field, UserPicker, Avatar } from './common.jsx';
import { JalaliDatePicker } from './JalaliDatePicker.jsx';
import { TimePicker } from './TimePicker.jsx';
import { AttachmentPicker, toFileIds } from './Attachments.jsx';
import { toJalaali, toGregorian, formatJalali, parseJalali } from '../jalali.js';

// تبدیل ISO ↔ (تاریخ شمسی، ساعت ۲۴)
export function isoToParts(iso) {
  if (!iso) return { date: '', time: '' };
  const d = new Date(iso);
  const j = toJalaali(d.getFullYear(), d.getMonth() + 1, d.getDate());
  return {
    date: formatJalali(j.jy, j.jm, j.jd),
    time: `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`,
  };
}
export function partsToIso(date, time, defaultHour = 0) {
  if (!date) return null;
  const p = parseJalali(date);
  if (!p) return null;
  const g = toGregorian(p.jy, p.jm, p.jd);
  const [h, m] = (time && /^\d{1,2}:\d{1,2}$/.test(time)) ? time.split(':').map(Number) : [defaultHour, 0];
  return new Date(g.gy, g.gm - 1, g.gd, h, m, 0, 0).toISOString();
}

// چه کسانی به چه کسانی تسک می‌دهند (آینه قوانین بک‌اند)
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

// ---------------------------------------------------------------------------
// چک‌لیستِ مراحل — عنوان‌ها در هر وظیفه فرق می‌کنند و ترتیبشان قابل تغییر است.
// مثال: «خرید ۱۰ تن مس» → پیش‌فاکتور، تایید مدیریت، تسویه، تولید، بارگیری، فاکتور.
// ---------------------------------------------------------------------------
function StepList({ taskId, steps, setSteps, onChanged }) {
  const { toast } = useStore();
  const [newTitle, setNewTitle] = useState('');
  const [editId, setEditId] = useState(null);
  const [editTitle, setEditTitle] = useState('');
  const [remindFor, setRemindFor] = useState(null); // مرحله‌ای که در حال تعیین یادآوری‌اش هستیم
  const [rDate, setRDate] = useState('');
  const [rTime, setRTime] = useState('09:00');

  const done = steps.filter(s => s.done).length;
  const pct = steps.length ? Math.round((done / steps.length) * 1000) / 10 : 0;

  const add = async () => {
    const title = newTitle.trim();
    if (!title) return;
    try {
      const r = await api(`/tasks/${taskId}/steps`, { method: 'POST', body: { title } });
      setSteps(s => [...s, r.step]);
      setNewTitle('');
      onChanged?.();
    } catch (e) { toast(e.message, 'error'); }
  };
  const patch = async (step, body) => {
    try {
      const r = await api(`/tasks/${taskId}/steps/${step.id}`, { method: 'PUT', body });
      setSteps(list => list.map(s => s.id === step.id ? { ...s, ...r.step } : s));
      onChanged?.();
      if (r.all_done) toast('همهٔ مراحل انجام شد — می‌توانید وظیفه را «انجام‌شده» کنید');
    } catch (e) { toast(e.message, 'error'); }
  };
  const remove = async (step) => {
    try {
      await api(`/tasks/${taskId}/steps/${step.id}`, { method: 'DELETE' });
      setSteps(list => list.filter(s => s.id !== step.id));
      onChanged?.();
    } catch (e) { toast(e.message, 'error'); }
  };
  const move = async (idx, dir) => {
    const next = [...steps];
    const j = idx + dir;
    if (j < 0 || j >= next.length) return;
    [next[idx], next[j]] = [next[j], next[idx]];
    setSteps(next);
    try { await api(`/tasks/${taskId}/steps/reorder`, { method: 'POST', body: { ids: next.map(s => s.id) } }); }
    catch (e) { toast(e.message, 'error'); }
  };
  const saveRemind = async () => {
    const iso = rDate ? partsToIso(rDate, rTime, 9) : null;
    await patch(remindFor, { remind_at: iso });
    setRemindFor(null); setRDate(''); setRTime('09:00');
  };

  return (
    <div style={{ marginTop: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <ListChecks size={16} />
        <b>مراحل انجام</b>
        {steps.length > 0 && (
          <span style={{ marginInlineStart: 'auto', display: 'flex', alignItems: 'center', gap: 8, minWidth: 170 }}>
            <span style={{ flex: 1, height: 7, borderRadius: 99, background: 'var(--border-soft)', overflow: 'hidden' }}>
              <span style={{ display: 'block', width: `${pct}%`, height: '100%', background: 'var(--chart-a)' }} />
            </span>
            <b style={{ fontSize: 12.3 }}>{fa(pct)}٪</b>
            <small style={{ color: 'var(--text-3)' }}>({fa(done)} از {fa(steps.length)})</small>
          </span>
        )}
      </div>

      {steps.length === 0 && (
        <p style={{ fontSize: 12.3, color: 'var(--text-3)', margin: '0 0 10px', lineHeight: 1.8 }}>
          مراحل را مثل یک چک‌لیست بنویسید تا درصد پیشرفت خودکار حساب شود.
          مثال برای «خرید ۱۰ تن مس»: پیش‌فاکتور ← تایید مدیریت ← تسویه ← تولید ← بارگیری ← فاکتور.
        </p>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 10 }}>
        {steps.map((s, i) => (
          <div key={s.id} style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '7px 9px', borderRadius: 9,
            background: s.done ? 'var(--green-soft)' : 'var(--bg-2)',
          }}>
            <GripVertical size={14} style={{ color: 'var(--text-3)', flexShrink: 0 }} />
            <input type="checkbox" checked={!!s.done} onChange={e => patch(s, { done: e.target.checked ? 1 : 0 })}
              style={{ width: 17, height: 17, cursor: 'pointer', flexShrink: 0 }} />
            {editId === s.id ? (
              <input className="input" style={{ flex: 1, height: 32 }} value={editTitle} autoFocus
                onChange={e => setEditTitle(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { patch(s, { title: editTitle }); setEditId(null); } }} />
            ) : (
              <span style={{ flex: 1, fontSize: 13, textDecoration: s.done ? 'line-through' : 'none', color: s.done ? 'var(--text-2)' : 'var(--text-1)' }}>
                {fa(i + 1)}. {s.title}
                {s.done && s.done_at && (
                  <small style={{ color: 'var(--text-3)', marginInlineStart: 8, fontSize: 11 }}>
                    ✓ {fmtDateTime(s.done_at)}{s.done_by_name ? ` — ${s.done_by_name}` : ''}
                  </small>
                )}
                {!s.done && s.remind_at && (
                  <span className="badge badge-amber" style={{ marginInlineStart: 8 }}>
                    <Bell size={10} /> {fmtDateTime(s.remind_at)}
                  </span>
                )}
              </span>
            )}
            <span style={{ display: 'flex', gap: 1, flexShrink: 0 }}>
              {editId === s.id ? (
                <button className="icon-btn" title="ذخیره" onClick={() => { patch(s, { title: editTitle }); setEditId(null); }}><Check size={15} /></button>
              ) : (
                <button className="icon-btn" title="ویرایش" onClick={() => { setEditId(s.id); setEditTitle(s.title); }}><Pencil size={14} /></button>
              )}
              <button className="icon-btn" title="یادآوری" onClick={() => {
                const p = isoToParts(s.remind_at);
                setRemindFor(s); setRDate(p.date); setRTime(p.time || '09:00');
              }}><Bell size={14} /></button>
              <button className="icon-btn" title="بالا" onClick={() => move(i, -1)}><ChevronUp size={15} /></button>
              <button className="icon-btn" title="پایین" onClick={() => move(i, 1)}><ChevronDown size={15} /></button>
              <button className="icon-btn" title="حذف" style={{ color: 'var(--red)' }} onClick={() => remove(s)}><Trash2 size={14} /></button>
            </span>
          </div>
        ))}
      </div>

      {remindFor && (
        <div className="card card-pad" style={{ marginBottom: 10, background: 'var(--bg-2)' }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 8 }}>یادآوری برای مرحلهٔ «{remindFor.title}»</div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div style={{ minWidth: 150 }}>
              <div style={{ fontSize: 11.5, color: 'var(--text-3)', marginBottom: 4 }}>تاریخ</div>
              <JalaliDatePicker value={rDate} onChange={setRDate} placeholder="تاریخ یادآوری" />
            </div>
            <div>
              <div style={{ fontSize: 11.5, color: 'var(--text-3)', marginBottom: 4 }}>ساعت</div>
              <TimePicker value={rTime} onChange={setRTime} variant="input" />
            </div>
            <button className="btn btn-primary btn-sm" onClick={saveRemind}><Check size={14} /> ثبت</button>
            <button className="btn btn-ghost btn-sm" onClick={() => { setRDate(''); saveRemind(); }}>بدون یادآوری</button>
            <button className="btn btn-ghost btn-sm" onClick={() => setRemindFor(null)}>انصراف</button>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8 }}>
        <input className="input" style={{ flex: 1 }} placeholder="مرحلهٔ جدید…" value={newTitle}
          onChange={e => setNewTitle(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} />
        <button className="btn btn-ghost" onClick={add} disabled={!newTitle.trim()}><Plus size={16} /> افزودن</button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// گزارش‌های کاری — «هر تماسی با یک سازمان ممکن است لازم باشد نتیجه‌اش ثبت شود».
// تاریخ ثبت زیر هر گزارش می‌آید و اگر بعداً ویرایش شود، تاریخ ویرایش هم دیده می‌شود.
// ---------------------------------------------------------------------------
function Reports({ taskId, focus }) {
  const { user, toast, refreshNotifs, refreshBadges, on } = useStore();
  const [comments, setComments] = useState([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [editId, setEditId] = useState(null);
  const [editText, setEditText] = useState('');
  const boxRef = useRef(null);
  const didScroll = useRef(false);

  useEffect(() => {
    if (!focus || didScroll.current || !boxRef.current) return;
    didScroll.current = true;
    const id = setTimeout(() => boxRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 250);
    return () => clearTimeout(id);
  }, [focus, comments]);

  useEffect(() => {
    api(`/tasks/${taskId}/comments`).then(r => {
      setComments(r.comments); refreshNotifs?.(); refreshBadges?.();
    }).catch(() => {});
    const off = on('task:comment', (d) => {
      if (d.task_id !== taskId) return;
      setComments(list => list.some(c => c.id === d.comment.id) ? list : [...list, d.comment]);
      api(`/tasks/${taskId}/comments`).catch(() => {});
      refreshNotifs?.();
    });
    return off;
  }, [taskId]);

  const send = async () => {
    const body = text.trim();
    if (!body) return;
    setBusy(true);
    try {
      const r = await api(`/tasks/${taskId}/comments`, { method: 'POST', body: { body } });
      setComments(c => [...c, r.comment]);
      setText('');
    } catch (e) { toast(e.message, 'error'); }
    setBusy(false);
  };
  const saveEdit = async (c) => {
    const body = editText.trim();
    if (!body) return;
    try {
      const r = await api(`/tasks/${taskId}/comments/${c.id}`, { method: 'PUT', body: { body } });
      setComments(list => list.map(x => x.id === c.id ? r.comment : x));
      setEditId(null);
      toast('گزارش ویرایش شد');
    } catch (e) { toast(e.message, 'error'); }
  };
  const removeOne = async (c) => {
    if (!window.confirm('این گزارش حذف شود؟')) return;
    try {
      await api(`/tasks/${taskId}/comments/${c.id}`, { method: 'DELETE' });
      setComments(list => list.filter(x => x.id !== c.id));
    } catch (e) { toast(e.message, 'error'); }
  };

  return (
    <div ref={boxRef} style={{ marginTop: 8, borderTop: '1px solid var(--border-soft)', paddingTop: 14 }}>
      <b style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <MessageSquare size={16} /> گزارش‌ها و پیگیری
        {comments.length > 0 && <span className="badge-count">{fa(comments.length)}</span>}
      </b>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 260, overflowY: 'auto', marginBottom: 12 }}>
        {comments.length === 0 && <div style={{ fontSize: 12.5, color: 'var(--text-3)' }}>هنوز گزارشی ثبت نشده است.</div>}
        {comments.map(c => (
          <div key={c.id} style={{ display: 'flex', gap: 9 }}>
            <Avatar name={c.author_name || '—'} color={c.author_color} size={30} avatar={c.author_avatar} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                <b style={{ fontSize: 12.8 }}>{c.author_name || 'کاربر حذف‌شده'}</b>
                <span style={{ fontSize: 10.5, color: 'var(--text-3)' }}>ثبت: {fmtDateTime(c.created_at)}</span>
                {c.edited_at && <span style={{ fontSize: 10.5, color: 'var(--text-3)' }}>· ویرایش: {fmtDateTime(c.edited_at)}</span>}
                {c.user_id === user.id && editId !== c.id && (
                  <span style={{ marginInlineStart: 'auto', display: 'flex', gap: 2 }}>
                    <button className="icon-btn" title="ویرایش" onClick={() => { setEditId(c.id); setEditText(c.body); }}><Pencil size={13} /></button>
                    <button className="icon-btn" title="حذف" style={{ color: 'var(--red)' }} onClick={() => removeOne(c)}><Trash2 size={13} /></button>
                  </span>
                )}
              </div>
              {editId === c.id ? (
                <div style={{ display: 'flex', gap: 6, marginTop: 5, alignItems: 'flex-end' }}>
                  <textarea className="input" style={{ flex: 1, minHeight: 60 }} value={editText} autoFocus
                    onChange={e => setEditText(e.target.value)} />
                  <button className="btn btn-primary btn-sm" onClick={() => saveEdit(c)}><Save size={14} /></button>
                  <button className="btn btn-ghost btn-sm" onClick={() => setEditId(null)}>انصراف</button>
                </div>
              ) : (
                <div style={{ fontSize: 13, whiteSpace: 'pre-wrap', color: 'var(--text-1)' }}>{c.body}</div>
              )}
            </div>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
        <textarea className="input" style={{ flex: 1, minHeight: 40 }} placeholder="نتیجهٔ تماس، جلسه یا اقدام امروز را بنویسید…"
          value={text} onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) send(); }} />
        <button className="btn btn-primary" disabled={busy || !text.trim()} onClick={send}><Send size={15} /> ثبت گزارش</button>
      </div>
    </div>
  );
}

export default function TaskModal({ task, projects = [], defaultProjectId = null, defaultAssigneeId = null, onClose, onDone, scrollToComments }) {
  const { user, users, departments, hasPerm, settings, toast } = useStore();
  const [title, setTitle] = useState(task?.title || '');
  const [description, setDescription] = useState(task?.description || '');
  const [assignee, setAssignee] = useState(task?.assignee_id || defaultAssigneeId || user.id);
  const [priority, setPriority] = useState(task?.priority || 'normal');
  const [projectId, setProjectId] = useState(task?.project_id || defaultProjectId || '');
  const sp = isoToParts(task?.start_at);
  const dp = isoToParts(task?.deadline);
  const rp = isoToParts(task?.remind_at);
  const [startDate, setStartDate] = useState(sp.date);
  const [startTime, setStartTime] = useState(sp.time);
  const [deadlineDate, setDeadlineDate] = useState(dp.date);
  const [deadlineTime, setDeadlineTime] = useState(dp.time);
  const [remindDate, setRemindDate] = useState(rp.date);
  const [remindTime, setRemindTime] = useState(rp.time || '09:00');
  const [participants, setParticipants] = useState((task?.participants || []).map(p => p.id));
  const [attachments, setAttachments] = useState(() => {
    try { return JSON.parse(task?.attachments || '[]'); } catch { return []; }
  });
  const [steps, setSteps] = useState([]);
  const [draftSteps, setDraftSteps] = useState([]);   // مراحلِ وظیفه‌ای که هنوز ساخته نشده
  const [draftStep, setDraftStep] = useState('');
  const [busy, setBusy] = useState(false);
  const assignable = allowedAssignees(user, users, departments, hasPerm);
  const requireProject = settings?.tasks_require_project === '1';
  const attachmentsOff = settings?.attachments_enabled === '0';

  useEffect(() => {
    if (!task) return;
    api(`/tasks/${task.id}/steps`).then(r => setSteps(r.steps)).catch(() => {});
  }, [task?.id]);

  const canManageParts = user.role === 'admin' || user.role === 'manager'
    || departments.some(d => d.manager_id === user.id)
    || !task || task.assigner_id === user.id;
  const partOptions = users.filter(u => u.is_active && u.id !== assignee && u.id !== user.id && !participants.includes(u.id));
  const nameOf = (id) => users.find(u => u.id === id)?.full_name || '—';

  const save = async () => {
    if (requireProject && !projectId) return toast('انتخاب دسته‌بندی برای هر وظیفه الزامی است', 'error');
    setBusy(true);
    try {
      const body = {
        title, description, priority,
        project_id: projectId ? Number(projectId) : null,
        start_at: partsToIso(startDate, startTime),
        deadline: partsToIso(deadlineDate, deadlineTime),
        remind_at: remindDate ? partsToIso(remindDate, remindTime, 9) : null,
        attachments: toFileIds(attachments),
        participant_ids: participants,
      };
      if (task) await api(`/tasks/${task.id}`, { method: 'PUT', body });
      else await api('/tasks', {
        method: 'POST',
        body: { ...body, assignee_id: assignee, steps: draftSteps.map(t => ({ title: t })) },
      });
      onDone();
      toast(task ? 'وظیفه به‌روزرسانی شد' : 'وظیفه ایجاد شد');
    } catch (e) { toast(e.message, 'error'); }
    setBusy(false);
  };

  return (
    <Modal title={task ? 'ویرایش وظیفه' : 'وظیفهٔ جدید'} onClose={onClose}
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>انصراف</button>
        <button className="btn btn-primary" disabled={!title.trim() || busy} onClick={save}>{task ? 'ذخیره' : 'ایجاد وظیفه'}</button>
      </>}>
      <Field label="عنوان">
        <input className="input" value={title} onChange={e => setTitle(e.target.value)} autoFocus />
      </Field>
      <Field label="توضیحات">
        <textarea className="input" value={description} onChange={e => setDescription(e.target.value)} />
      </Field>

      <Field label={`دسته‌بندی (پروژه)${requireProject ? ' *' : ''}`}
        hint={projects.length === 0 ? 'هنوز دسته‌ای نساخته‌اید — از منوی «پروژه‌ها» بسازید.' : undefined}>
        <select className="input" value={projectId} onChange={e => setProjectId(e.target.value)}>
          <option value="">{requireProject ? '— انتخاب کنید —' : 'بدون دسته'}</option>
          {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
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
      <Field label="مهلت انجام (اختیاری)"
        hint="وظیفهٔ بدون مهلت در گروه «کارهای آینده» می‌ماند و در تقویم نمی‌آید.">
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
      <Field label="یادآوری (اختیاری)"
        hint="مثلاً «شنبه ساعت ۹ یادم بنداز» یا یک ماه دیگر. در زمان تعیین‌شده اعلان می‌گیرید.">
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ minWidth: 150 }}>
            <div style={{ fontSize: 11.5, color: 'var(--text-3)', marginBottom: 4 }}>تاریخ</div>
            <JalaliDatePicker value={remindDate} onChange={setRemindDate} placeholder="تاریخ یادآوری" />
          </div>
          <div>
            <div style={{ fontSize: 11.5, color: 'var(--text-3)', marginBottom: 4 }}>ساعت</div>
            <TimePicker value={remindTime} onChange={setRemindTime} variant="input" />
          </div>
          {remindDate && (
            <button className="btn btn-ghost btn-sm" onClick={() => setRemindDate('')}><X size={14} /> حذف یادآوری</button>
          )}
        </div>
      </Field>

      {!attachmentsOff && (
        <Field label="پیوست (اختیاری)" hint="پی‌دی‌اف، اسکن، عکس یا هر سند دیگر.">
          <AttachmentPicker value={attachments} onChange={setAttachments}
            placeholder="انتخاب فایل" label="افزودن فایل" thumb={78} />
        </Field>
      )}

      {/* مشارکت‌کنندگان */}
      {canManageParts && (
        <Field label="همکاران این وظیفه (اختیاری)">
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
            <option value="">+ افزودن همکار…</option>
            {partOptions.map(u => <option key={u.id} value={u.id}>{u.full_name}{u.department_name ? ` (${u.department_name})` : ''}</option>)}
          </select>
          <div style={{ fontSize: 11.5, color: 'var(--text-3)', marginTop: 4 }}>
            همکاران می‌توانند وظیفه را ببینند، گزارش بنویسند و وضعیت را تغییر دهند.
          </div>
        </Field>
      )}

      {/* چک‌لیستِ مراحل */}
      {task ? (
        <StepList taskId={task.id} steps={steps} setSteps={setSteps} />
      ) : (
        <div style={{ marginTop: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <ListChecks size={16} /><b>مراحل انجام (اختیاری)</b>
          </div>
          {draftSteps.map((s, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 9px', borderRadius: 9, background: 'var(--bg-2)', marginBottom: 4 }}>
              <span style={{ flex: 1, fontSize: 13 }}>{fa(i + 1)}. {s}</span>
              <button className="icon-btn" style={{ color: 'var(--red)' }} onClick={() => setDraftSteps(d => d.filter((_, j) => j !== i))}><Trash2 size={14} /></button>
            </div>
          ))}
          <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
            <input className="input" style={{ flex: 1 }} placeholder="مثلاً: پیش‌فاکتور" value={draftStep}
              onChange={e => setDraftStep(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') { e.preventDefault(); if (draftStep.trim()) { setDraftSteps(d => [...d, draftStep.trim()]); setDraftStep(''); } }
              }} />
            <button className="btn btn-ghost" disabled={!draftStep.trim()}
              onClick={() => { setDraftSteps(d => [...d, draftStep.trim()]); setDraftStep(''); }}><Plus size={16} /> افزودن</button>
          </div>
        </div>
      )}

      {/* گزارش‌ها — فقط برای وظیفهٔ موجود */}
      {task && <Reports taskId={task.id} focus={scrollToComments} />}
    </Modal>
  );
}
