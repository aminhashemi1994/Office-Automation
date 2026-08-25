// ============================================================================
//  وظایف
//  شش نما روی یک مجموعه کار: کارهای من، پیگیری دیگران از من، پیگیری از دیگران،
//  تقویم کاری، دسته‌بندی کارها، و انجام‌شده‌های روزانه.
//  در هر نما جست‌وجو، فیلتر و مرتب‌سازی هست، و کارها به دو گروهِ «زمان‌دار» و
//  «آینده (بدون زمان)» تقسیم می‌شوند — همان تقسیمی که کاربر خواسته بود.
// ============================================================================
import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Plus, Clock, Trash2, Circle, LoaderCircle, CheckCircle2, Search, CalendarClock,
  MessageSquare, Users2, LayoutGrid, List as ListIcon, CalendarDays, FolderKanban,
  CheckCheck, ChevronRight, ChevronLeft, Bell, Paperclip, SlidersHorizontal, X,
} from 'lucide-react';
import { api } from '../api.js';
import { useStore } from '../store.jsx';
import { fmtDateTime, deadlineState, fa } from '../utils.js';
import { Avatar } from '../components/common.jsx';
import TaskModal from '../components/TaskModal.jsx';
import { toJalaali, toGregorian, formatJalali, jalaaliMonthLength, jalaliWeekIndex, todayJalali, faDigits } from '../jalali.js';

const PRIORITY = { low: ['کم', 'badge-gray', 1], normal: ['عادی', 'badge-sky', 2], high: ['زیاد', 'badge-amber', 3], urgent: ['فوری', 'badge-red', 4] };
const COLS = [
  ['todo', 'در انتظار', Circle, 'var(--text-3)'],
  ['doing', 'در حال انجام', LoaderCircle, 'var(--sky)'],
  ['done', 'انجام شده', CheckCircle2, 'var(--green)'],
];
const TABS = [
  ['mine', 'کارهای من', ListIcon],
  ['from-others', 'پیگیری دیگران از من', Users2],
  ['to-others', 'پیگیری از دیگران', CheckCheck],
  ['calendar', 'تقویم کاری', CalendarDays],
  ['by-project', 'دسته‌بندی کارها', FolderKanban],
  ['daily', 'انجام‌شده‌های روزانه', CheckCircle2],
];
const SORTS = [
  ['deadline', 'نزدیک‌ترین مهلت'],
  ['priority', 'اولویت'],
  ['created', 'تازه‌ترین'],
  ['progress', 'درصد پیشرفت'],
  ['title', 'حروف الفبا'],
];

const progressOf = (t) => (t.step_count ? Math.round((t.step_done / t.step_count) * 100) : (t.status === 'done' ? 100 : 0));

function sortTasks(list, sort) {
  const arr = [...list];
  if (sort === 'deadline') {
    arr.sort((a, b) => (a.deadline ? 0 : 1) - (b.deadline ? 0 : 1) || String(a.deadline || '').localeCompare(String(b.deadline || '')));
  } else if (sort === 'priority') {
    arr.sort((a, b) => (PRIORITY[b.priority]?.[2] || 2) - (PRIORITY[a.priority]?.[2] || 2));
  } else if (sort === 'created') {
    arr.sort((a, b) => b.id - a.id);
  } else if (sort === 'progress') {
    arr.sort((a, b) => progressOf(b) - progressOf(a));
  } else if (sort === 'title') {
    arr.sort((a, b) => String(a.title).localeCompare(String(b.title), 'fa'));
  }
  return arr;
}

// نوارِ پیشرفتِ کوچک روی کارت — درصد همیشه به‌صورت عدد هم نوشته می‌شود
function MiniProgress({ t }) {
  if (!t.step_count) return null;
  const pct = progressOf(t);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 7 }}>
      <span style={{ flex: 1, height: 6, borderRadius: 99, background: 'var(--border-soft)', overflow: 'hidden' }}>
        <span style={{ display: 'block', width: `${pct}%`, height: '100%', background: 'var(--chart-a)' }} />
      </span>
      <small style={{ fontSize: 11, color: 'var(--text-2)', minWidth: 62 }}>
        {fa(pct)}٪ · {fa(t.step_done)}/{fa(t.step_count)}
      </small>
    </div>
  );
}

function TaskBadges({ t, showAssignee }) {
  const ds = deadlineState(t.deadline, t.status);
  let attachCount = 0;
  try { attachCount = JSON.parse(t.attachments || '[]').length; } catch { attachCount = 0; }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
      {t.project_name && (
        <span className="badge" style={{ background: 'var(--bg-2)', color: t.project_color || 'var(--text-2)', border: `1px solid ${t.project_color || 'var(--border)'}` }}>
          {t.project_name}
        </span>
      )}
      <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11.8, color: 'var(--text-2)' }}>
        <Avatar name={showAssignee ? t.assignee_name : t.assigner_name} size={18} color={t.assignee_color} />
        {showAssignee ? t.assignee_name : `از: ${t.assigner_name}`}
      </span>
      {t.start_at && <span className="badge badge-sky"><CalendarClock size={11} /> شروع: {fmtDateTime(t.start_at)}</span>}
      {t.deadline && (
        <span className={`badge ${ds === 'overdue' ? 'badge-red' : ds === 'soon' ? 'badge-amber' : 'badge-gray'}`}>
          <Clock size={11} /> {fmtDateTime(t.deadline)}
        </span>
      )}
      {t.remind_at && t.status !== 'done' && (
        <span className="badge badge-amber"><Bell size={11} /> {fmtDateTime(t.remind_at)}</span>
      )}
      {attachCount > 0 && <span className="badge badge-gray"><Paperclip size={11} /> {fa(attachCount)}</span>}
      {(t.participants || []).length > 0 && <span className="badge badge-gray"><Users2 size={11} /> {fa(t.participants.length)} همکار</span>}
      {t.comment_count > 0 && <span className="badge badge-gray"><MessageSquare size={11} /> {fa(t.comment_count)}</span>}
      {t.unread_comments > 0 && (
        <span className="badge badge-red" title="گزارش خوانده‌نشده"><MessageSquare size={11} /> {fa(t.unread_comments)} جدید</span>
      )}
    </div>
  );
}

function TaskCard({ t, showAssignee, onOpen, onMove, onRemove, canRemove }) {
  const [pl, pc] = PRIORITY[t.priority] || PRIORITY.normal;
  return (
    <div className="task-card" onClick={() => onOpen(t)}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 5 }}>
        <b style={{ fontSize: 13.5 }}>{t.title}</b>
        <span className={`badge ${pc}`}>{pl}</span>
      </div>
      {t.description && <p style={{ fontSize: 12.5, color: 'var(--text-2)', marginBottom: 7, whiteSpace: 'pre-wrap' }}>{t.description.slice(0, 120)}</p>}
      <TaskBadges t={t} showAssignee={showAssignee} />
      <MiniProgress t={t} />
      <div style={{ display: 'flex', gap: 6, marginTop: 9 }} onClick={e => e.stopPropagation()}>
        {t.status !== 'todo' && <button className="btn btn-ghost btn-sm" onClick={() => onMove(t, t.status === 'done' ? 'doing' : 'todo')}>→ قبلی</button>}
        {t.status !== 'done' && <button className="btn btn-success btn-sm" onClick={() => onMove(t, t.status === 'todo' ? 'doing' : 'done')}>{t.status === 'doing' ? 'انجام شد ✓' : 'شروع'}</button>}
        {canRemove && (
          <button className="btn btn-ghost btn-sm" style={{ marginRight: 'auto', color: 'var(--red)' }} onClick={() => onRemove(t)}><Trash2 size={13} /></button>
        )}
      </div>
    </div>
  );
}

// فهرستِ دو گروهی: کارهای زمان‌دار و کارهای آینده (بدون زمان)
function GroupedList({ list, showAssignee, onOpen, onMove, onRemove, canRemoveOf }) {
  const timed = list.filter(t => t.deadline || t.start_at);
  const someday = list.filter(t => !t.deadline && !t.start_at);
  const Section = ({ icon: Icon, title, hint, rows }) => (
    <div className="card" style={{ marginBottom: 16 }}>
      <div style={{ padding: '14px 18px 6px', display: 'flex', alignItems: 'center', gap: 8 }}>
        <Icon size={16} style={{ color: 'var(--text-3)' }} />
        <b>{title}</b>
        <span className="badge-count">{fa(rows.length)}</span>
        <small style={{ color: 'var(--text-3)', marginInlineStart: 'auto' }}>{hint}</small>
      </div>
      {rows.length === 0 && <div className="empty">موردی نیست</div>}
      <div style={{ padding: '0 14px 14px', display: 'grid', gap: 8 }}>
        {rows.map(t => (
          <TaskCard key={t.id} t={t} showAssignee={showAssignee} onOpen={onOpen} onMove={onMove}
            onRemove={onRemove} canRemove={canRemoveOf(t)} />
        ))}
      </div>
    </div>
  );
  return (
    <>
      <Section icon={CalendarClock} title="کارهای زمان‌دار" hint="دارای مهلت یا زمان شروع" rows={timed} />
      <Section icon={ListIcon} title="کارهای آینده (بدون زمان)" hint="هر وقت رسیدید" rows={someday} />
    </>
  );
}

// تقویم ماهانهٔ شمسی با کارهای هر روز
function WorkCalendar({ onOpen }) {
  const t0 = todayJalali();
  const [jy, setJy] = useState(t0.jy);
  const [jm, setJm] = useState(t0.jm);
  const [data, setData] = useState({ tasks: [], steps: [] });
  const MONTHS = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];
  const DAYS = ['ش', 'ی', 'د', 'س', 'چ', 'پ', 'ج'];

  useEffect(() => {
    const len = jalaaliMonthLength(jy, jm);
    const g1 = toGregorian(jy, jm, 1);
    const g2 = toGregorian(jy, jm, len);
    const iso = (g) => `${g.gy}-${String(g.gm).padStart(2, '0')}-${String(g.gd).padStart(2, '0')}`;
    api(`/tasks/calendar?from=${iso(g1)}&to=${iso(g2)}`).then(setData).catch(() => setData({ tasks: [], steps: [] }));
  }, [jy, jm]);

  // نگاشتِ «روزِ شمسی → کارها»
  const byDay = useMemo(() => {
    const map = {};
    const push = (iso, item) => {
      if (!iso) return;
      const d = new Date(iso);
      const j = toJalaali(d.getFullYear(), d.getMonth() + 1, d.getDate());
      if (j.jy !== jy || j.jm !== jm) return;
      (map[j.jd] ||= []).push(item);
    };
    for (const t of data.tasks) {
      if (t.deadline) push(t.deadline, { ...t, kind: 'deadline' });
      if (t.start_at) push(t.start_at, { ...t, kind: 'start' });
    }
    for (const s of data.steps) push(s.remind_at, { ...s, kind: 'step', title: s.title, id: `s${s.id}` });
    return map;
  }, [data, jy, jm]);

  const len = jalaaliMonthLength(jy, jm);
  const firstIdx = jalaliWeekIndex(jy, jm, 1);
  const cells = [...Array(firstIdx).fill(null), ...Array.from({ length: len }, (_, i) => i + 1)];
  const prev = () => { if (jm === 1) { setJy(jy - 1); setJm(12); } else setJm(jm - 1); };
  const next = () => { if (jm === 12) { setJy(jy + 1); setJm(1); } else setJm(jm + 1); };

  return (
    <div className="card card-pad">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <button className="icon-btn" onClick={prev} title="ماه قبل"><ChevronRight size={18} /></button>
        <b style={{ fontSize: 15 }}>{MONTHS[jm - 1]} {faDigits(String(jy))}</b>
        <button className="icon-btn" onClick={next} title="ماه بعد"><ChevronLeft size={18} /></button>
        <button className="btn btn-ghost btn-sm" onClick={() => { setJy(t0.jy); setJm(t0.jm); }}>امروز</button>
        <small style={{ marginInlineStart: 'auto', color: 'var(--text-3)' }}>
          مهلت‌ها، زمان‌های شروع و یادآوریِ مراحل
        </small>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 6 }}>
        {DAYS.map(d => (
          <div key={d} style={{ textAlign: 'center', fontSize: 12, fontWeight: 700, color: 'var(--text-3)', paddingBottom: 4 }}>{d}</div>
        ))}
        {cells.map((d, i) => {
          const items = d ? (byDay[d] || []) : [];
          const isToday = d === t0.jd && jm === t0.jm && jy === t0.jy;
          return (
            <div key={i} style={{
              minHeight: 92, borderRadius: 10, padding: 6,
              background: d ? (isToday ? 'var(--primary-soft)' : 'var(--bg-2)') : 'transparent',
              border: isToday ? '1.5px solid var(--primary)' : '1px solid var(--border-soft)',
              opacity: d ? 1 : 0,
            }}>
              {d && <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text-2)', marginBottom: 4 }}>{faDigits(String(d))}</div>}
              <div style={{ display: 'grid', gap: 3 }}>
                {items.slice(0, 4).map((it, k) => (
                  <button key={k} className="cal-chip"
                    onClick={() => it.kind !== 'step' ? onOpen(it.id) : onOpen(it.task_id)}
                    title={it.kind === 'step' ? `مرحله: ${it.title} (${it.task_title})` : it.title}
                    style={{
                      background: it.kind === 'deadline' ? 'var(--red-soft)' : it.kind === 'start' ? 'var(--sky-soft)' : 'var(--amber-soft)',
                      color: it.kind === 'deadline' ? 'var(--red)' : it.kind === 'start' ? 'var(--sky)' : 'var(--amber)',
                    }}>
                    {it.kind === 'deadline' ? '⏰' : it.kind === 'start' ? '▶' : '🔔'} {String(it.title).slice(0, 16)}
                  </button>
                ))}
                {items.length > 4 && <small style={{ fontSize: 10.5, color: 'var(--text-3)' }}>+{fa(items.length - 4)} مورد</small>}
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ display: 'flex', gap: 14, marginTop: 12, fontSize: 11.8, color: 'var(--text-3)', flexWrap: 'wrap' }}>
        <span>⏰ مهلت انجام</span><span>▶ زمان شروع</span><span>🔔 یادآوری مرحله</span>
      </div>
    </div>
  );
}

// انجام‌شده‌های یک روز
function DailyDone({ onOpen }) {
  const [day, setDay] = useState(''); // خالی = امروز
  const [data, setData] = useState({ tasks: [], steps: [] });
  const t0 = todayJalali();
  const [offset, setOffset] = useState(0); // چند روز قبل

  useEffect(() => {
    const d = new Date();
    d.setDate(d.getDate() - offset);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    setDay(iso);
    api(`/tasks/done-log?day=${iso}`).then(setData).catch(() => setData({ tasks: [], steps: [] }));
  }, [offset]);

  const label = (() => {
    const d = new Date();
    d.setDate(d.getDate() - offset);
    const j = toJalaali(d.getFullYear(), d.getMonth() + 1, d.getDate());
    return faDigits(formatJalali(j.jy, j.jm, j.jd));
  })();

  const total = data.tasks.length + data.steps.length;
  return (
    <div className="card">
      <div style={{ padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <button className="icon-btn" onClick={() => setOffset(o => o + 1)} title="روز قبل"><ChevronRight size={18} /></button>
        <b>{offset === 0 ? 'امروز' : offset === 1 ? 'دیروز' : label}</b>
        <button className="icon-btn" onClick={() => setOffset(o => Math.max(0, o - 1))} title="روز بعد" disabled={offset === 0}><ChevronLeft size={18} /></button>
        <span className="badge badge-gray">{fa(total)} مورد</span>
        <small style={{ marginInlineStart: 'auto', color: 'var(--text-3)' }}>کارها و مراحلی که در این روز تمام شده‌اند</small>
      </div>
      {total === 0 && <div className="empty">در این روز موردی تکمیل نشده است</div>}
      <div style={{ padding: '0 16px 16px', display: 'grid', gap: 8 }}>
        {data.tasks.map(t => (
          <div key={`t${t.id}`} className="notif-item" style={{ cursor: 'pointer' }} onClick={() => onOpen(t.id)}>
            <div className="notif-icon" style={{ background: 'var(--green-soft)', color: 'var(--green)' }}><CheckCircle2 size={16} /></div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 13.4 }}>{t.title}</div>
              <small style={{ color: 'var(--text-3)' }}>
                وظیفهٔ کامل‌شده {t.project_name ? `· ${t.project_name}` : ''} · {fmtDateTime(t.completed_at)}
              </small>
            </div>
          </div>
        ))}
        {data.steps.map(s => (
          <div key={`s${s.id}`} className="notif-item" style={{ cursor: 'pointer' }} onClick={() => onOpen(s.task_id)}>
            <div className="notif-icon" style={{ background: 'var(--sky-soft)', color: 'var(--sky)' }}><CheckCheck size={16} /></div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 13.4 }}>{s.title}</div>
              <small style={{ color: 'var(--text-3)' }}>
                مرحله‌ای از «{s.task_title}»{s.project_name ? ` · ${s.project_name}` : ''} · {fmtDateTime(s.done_at)}
              </small>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Tasks() {
  const { user, toast, on, setTaskCount, settings } = useStore();
  const [tab, setTab] = useState('mine');
  const [view, setView] = useState('board');        // board | list
  const [mine, setMine] = useState([]);
  const [assigned, setAssigned] = useState([]);
  const [projects, setProjects] = useState([]);
  const [search, setSearch] = useState('');
  const [fStatus, setFStatus] = useState('');
  const [fPriority, setFPriority] = useState('');
  const [fProject, setFProject] = useState('');
  const [fOverdue, setFOverdue] = useState(false);
  const [sort, setSort] = useState('deadline');
  const [showFilters, setShowFilters] = useState(false);
  const [editing, setEditing] = useState(null);
  const [focusComments, setFocusComments] = useState(false);
  const [params, setParams] = useSearchParams();
  const wantTaskId = Number(params.get('task')) || null;
  const wantProject = params.get('project') || '';

  const load = async () => {
    const [r, p] = await Promise.all([api('/tasks'), api('/projects').catch(() => ({ projects: [] }))]);
    setMine(r.mine); setAssigned(r.assigned); setProjects(p.projects || []);
    setTaskCount(r.mine.filter(t => t.status !== 'done').length);
  };
  useEffect(() => {
    load();
    const offNotif = on('notification', load);
    const offComment = on('task:comment', load);
    return () => { offNotif(); offComment(); };
  }, []);

  // ورود مستقیم از لینک «کارهای این دسته»
  useEffect(() => { if (wantProject) { setFProject(wantProject); setTab('mine'); setView('list'); } }, [wantProject]);

  // باز کردن مستقیم وظیفهٔ مقصدِ اعلان
  useEffect(() => {
    if (!wantTaskId) return;
    const found = [...mine, ...assigned].find(t => t.id === wantTaskId);
    if (found) {
      if (assigned.some(t => t.id === wantTaskId) && !mine.some(t => t.id === wantTaskId)) setTab('to-others');
      setEditing(found);
      setFocusComments(true);
      setParams({}, { replace: true });
    }
  }, [wantTaskId, mine, assigned]);

  const move = async (t, status) => {
    try { await api(`/tasks/${t.id}`, { method: 'PUT', body: { status } }); load(); }
    catch (e) { toast(e.message, 'error'); }
  };
  const remove = async (t) => {
    if (!window.confirm(`وظیفهٔ «${t.title}» حذف شود؟`)) return;
    try { await api(`/tasks/${t.id}`, { method: 'DELETE' }); load(); toast('وظیفه حذف شد'); }
    catch (e) { toast(e.message, 'error'); }
  };
  const openById = (id) => {
    const found = [...mine, ...assigned].find(t => t.id === Number(id));
    if (found) setEditing(found);
  };
  const canRemoveOf = (t) => t.assigner_id === user.id || user.role === 'admin';

  // مجموعهٔ پایه بر اساس تب
  const base = tab === 'to-others' ? assigned
    : tab === 'from-others' ? mine.filter(t => t.assigner_id !== user.id)
    : mine;

  const filtered = useMemo(() => {
    const q = search.trim();
    let list = base.filter(t => !q
      || t.title.includes(q) || (t.description || '').includes(q)
      || (t.project_name || '').includes(q)
      || t.assignee_name.includes(q) || t.assigner_name.includes(q));
    if (fStatus) list = list.filter(t => t.status === fStatus);
    if (fPriority) list = list.filter(t => t.priority === fPriority);
    if (fProject) list = list.filter(t => String(t.project_id || '') === String(fProject));
    if (fOverdue) list = list.filter(t => deadlineState(t.deadline, t.status) === 'overdue');
    return sortTasks(list, sort);
  }, [base, search, fStatus, fPriority, fProject, fOverdue, sort]);

  const activeFilters = [fStatus, fPriority, fProject, fOverdue ? '1' : ''].filter(Boolean).length;
  const showAssignee = tab === 'to-others';

  // گروه‌بندی بر اساس دسته برای تب «دسته‌بندی کارها»
  const grouped = useMemo(() => {
    const map = new Map();
    for (const t of filtered) {
      const key = t.project_id || 0;
      if (!map.has(key)) map.set(key, { id: key, name: t.project_name || 'بدون دسته', color: t.project_color, rows: [] });
      map.get(key).rows.push(t);
    }
    // دسته‌های خالی هم دیده شوند تا کاربر بداند وجود دارند
    for (const p of projects) if (!map.has(p.id)) map.set(p.id, { id: p.id, name: p.name, color: p.color, rows: [] });
    return [...map.values()].sort((a, b) => b.rows.length - a.rows.length);
  }, [filtered, projects]);

  return (
    <div className="content">
      <div className="page-head" style={{ flexWrap: 'wrap', gap: 10 }}>
        <div className="tabs" style={{ flexWrap: 'wrap' }}>
          {TABS.map(([key, label, Icon]) => (
            <button key={key} className={`tab ${tab === key ? 'active' : ''}`} onClick={() => setTab(key)}>
              <Icon size={14} style={{ marginInlineEnd: 5, verticalAlign: '-2px' }} />{label}
              {key === 'mine' && mine.filter(t => t.status !== 'done').length > 0 && (
                <span className="badge-count">{fa(mine.filter(t => t.status !== 'done').length)}</span>
              )}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginInlineStart: 'auto' }}>
          <button className="btn btn-primary" onClick={() => setEditing('new')}><Plus size={17} /> وظیفهٔ جدید</button>
        </div>
      </div>

      {/* نوار ابزار — جست‌وجو، فیلتر، مرتب‌سازی، نوعِ نمایش */}
      {['mine', 'from-others', 'to-others', 'by-project'].includes(tab) && (
        <div className="card card-pad" style={{ marginBottom: 16, padding: 14 }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
              <Search size={15} style={{ position: 'absolute', right: 11, top: 11, color: 'var(--text-3)' }} />
              <input className="input" style={{ paddingRight: 34, width: '100%' }}
                placeholder="جستجو در عنوان، توضیح، دسته و نام افراد…"
                value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <select className="input" style={{ width: 'auto' }} value={sort} onChange={e => setSort(e.target.value)}>
              {SORTS.map(([k, l]) => <option key={k} value={k}>مرتب‌سازی: {l}</option>)}
            </select>
            <button className={`btn ${activeFilters ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setShowFilters(v => !v)}>
              <SlidersHorizontal size={15} /> فیلتر{activeFilters > 0 ? ` (${fa(activeFilters)})` : ''}
            </button>
            {tab !== 'by-project' && (
              <div className="tabs" style={{ margin: 0 }}>
                <button className={`tab ${view === 'board' ? 'active' : ''}`} onClick={() => setView('board')} title="نمای تخته">
                  <LayoutGrid size={15} />
                </button>
                <button className={`tab ${view === 'list' ? 'active' : ''}`} onClick={() => setView('list')} title="نمای فهرست">
                  <ListIcon size={15} />
                </button>
              </div>
            )}
          </div>

          {showFilters && (
            <div style={{ display: 'flex', gap: 10, marginTop: 12, flexWrap: 'wrap', alignItems: 'center' }}>
              <select className="input" style={{ width: 'auto' }} value={fStatus} onChange={e => setFStatus(e.target.value)}>
                <option value="">همهٔ وضعیت‌ها</option>
                {COLS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
              <select className="input" style={{ width: 'auto' }} value={fPriority} onChange={e => setFPriority(e.target.value)}>
                <option value="">همهٔ اولویت‌ها</option>
                {Object.entries(PRIORITY).map(([k, v]) => <option key={k} value={k}>{v[0]}</option>)}
              </select>
              <select className="input" style={{ width: 'auto' }} value={fProject} onChange={e => setFProject(e.target.value)}>
                <option value="">همهٔ دسته‌ها</option>
                {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                <option value="0">بدون دسته</option>
              </select>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
                <input type="checkbox" checked={fOverdue} onChange={e => setFOverdue(e.target.checked)} style={{ width: 16, height: 16 }} />
                فقط دارای تأخیر
              </label>
              {activeFilters > 0 && (
                <button className="btn btn-ghost btn-sm" onClick={() => { setFStatus(''); setFPriority(''); setFProject(''); setFOverdue(false); }}>
                  <X size={14} /> پاک‌کردن فیلترها
                </button>
              )}
              <small style={{ marginInlineStart: 'auto', color: 'var(--text-3)' }}>{fa(filtered.length)} مورد</small>
            </div>
          )}
        </div>
      )}

      {/* --- نماها --- */}
      {['mine', 'from-others', 'to-others'].includes(tab) && view === 'board' && (
        <div className="kanban">
          {COLS.map(([key, label, Icon, color]) => {
            const rows = filtered.filter(t => t.status === key);
            return (
              <div key={key} className="kanban-col">
                <h4><Icon size={16} style={{ color }} /> {label} <span style={{ color: 'var(--text-3)', fontWeight: 400 }}>({fa(rows.length)})</span></h4>
                {rows.map(t => (
                  <TaskCard key={t.id} t={t} showAssignee={showAssignee} onOpen={setEditing} onMove={move}
                    onRemove={remove} canRemove={canRemoveOf(t)} />
                ))}
                {rows.length === 0 && (
                  <div style={{ textAlign: 'center', color: 'var(--text-3)', fontSize: 12.5, padding: '18px 0' }}>خالی</div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {['mine', 'from-others', 'to-others'].includes(tab) && view === 'list' && (
        <GroupedList list={filtered} showAssignee={showAssignee} onOpen={setEditing} onMove={move}
          onRemove={remove} canRemoveOf={canRemoveOf} />
      )}

      {tab === 'by-project' && (
        <>
          {grouped.length === 0 && <div className="card"><div className="empty">هنوز کاری ثبت نشده است</div></div>}
          {grouped.map(g => {
            const done = g.rows.filter(t => t.status === 'done').length;
            const pct = g.rows.length ? Math.round((done / g.rows.length) * 100) : 0;
            return (
              <div key={g.id} className="card" style={{ marginBottom: 16 }}>
                <div style={{ padding: '14px 18px 8px', display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
                  <span style={{ width: 11, height: 11, borderRadius: 4, background: g.color || 'var(--text-3)' }} />
                  <b>{g.name}</b>
                  <span className="badge-count">{fa(g.rows.length)}</span>
                  <span style={{ marginInlineStart: 'auto', display: 'flex', alignItems: 'center', gap: 8, minWidth: 160 }}>
                    <span style={{ flex: 1, height: 7, borderRadius: 99, background: 'var(--border-soft)', overflow: 'hidden' }}>
                      <span style={{ display: 'block', width: `${pct}%`, height: '100%', background: g.color || 'var(--chart-a)' }} />
                    </span>
                    <small style={{ fontSize: 11.8, color: 'var(--text-2)' }}>{fa(pct)}٪</small>
                  </span>
                </div>
                {g.rows.length === 0 && <div className="empty">در این دسته کاری نیست</div>}
                <div style={{ padding: '0 14px 14px', display: 'grid', gap: 8 }}>
                  {g.rows.map(t => (
                    <TaskCard key={t.id} t={t} showAssignee={showAssignee} onOpen={setEditing} onMove={move}
                      onRemove={remove} canRemove={canRemoveOf(t)} />
                  ))}
                </div>
              </div>
            );
          })}
        </>
      )}

      {tab === 'calendar' && <WorkCalendar onOpen={openById} />}
      {tab === 'daily' && <DailyDone onOpen={openById} />}

      {editing && (
        <TaskModal task={editing === 'new' ? null : editing}
          projects={projects}
          defaultProjectId={fProject && fProject !== '0' ? Number(fProject) : null}
          scrollToComments={focusComments}
          onClose={() => { setEditing(null); setFocusComments(false); load(); }}
          onDone={() => { setEditing(null); setFocusComments(false); load(); }} />
      )}
    </div>
  );
}
