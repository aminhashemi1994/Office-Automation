// ============================================================================
//  داشبورد
//  سه ستونِ اصلی، همان‌طور که کاربران خواسته بودند:
//   ۱) وظایف من   ۲) پیگیری‌ها (من از دیگران و دیگران از من)   ۳) پیشرفت پروژه‌ها
//  بالای صفحه هم کارتِ کارهای امروز و عقب‌افتاده و کارتابل است.
// ============================================================================
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Inbox, ListTodo, ArrowLeft, Clock, Bell, StickyNote, CalendarCheck, Handshake,
  CalendarClock, AlertTriangle, FolderKanban, CheckCheck, Users2, MessageSquare,
} from 'lucide-react';
import { api } from '../api.js';
import { useStore } from '../store.jsx';
import { fa, fmtRelative, fmtDateTime, deadlineState } from '../utils.js';
import { Avatar } from '../components/common.jsx';
import SupportChat from '../components/SupportChat.jsx';

const PRIORITY = { low: ['کم', 'badge-gray'], normal: ['عادی', 'badge-sky'], high: ['زیاد', 'badge-amber'], urgent: ['فوری', 'badge-red'] };
const progressOf = (t) => (t.step_count ? Math.round((t.step_done / t.step_count) * 100) : (t.status === 'done' ? 100 : 0));

function isToday(iso) {
  if (!iso) return false;
  const d = new Date(iso), n = new Date();
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
}

// سرستونِ مشترکِ ستون‌های داشبورد
function ColHead({ icon: Icon, title, count, to, linkText, color }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '15px 18px 8px' }}>
      <b style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13.8 }}>
        <Icon size={16} style={{ color: color || 'var(--text-3)' }} /> {title}
        {count > 0 && <span className="badge-count">{fa(count)}</span>}
      </b>
      {to && <Link to={to} className="btn btn-ghost btn-sm">{linkText || 'همه'} <ArrowLeft size={14} /></Link>}
    </div>
  );
}

function TaskRow({ t, showAssignee }) {
  const [pl, pc] = PRIORITY[t.priority] || PRIORITY.normal;
  const ds = deadlineState(t.deadline, t.status);
  const pct = progressOf(t);
  return (
    <Link to={`/tasks?task=${t.id}`} className="notif-item" style={{ display: 'block' }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 3 }}>
        <span style={{ fontWeight: 600, fontSize: 13.3, flex: 1 }}>{t.title}</span>
        <span className={`badge ${pc}`}>{pl}</span>
      </div>
      <div style={{ display: 'flex', gap: 7, alignItems: 'center', flexWrap: 'wrap', fontSize: 11.8, color: 'var(--text-2)' }}>
        {t.project_name && <span className="badge badge-gray">{t.project_name}</span>}
        {showAssignee
          ? <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Avatar name={t.assignee_name} size={16} color={t.assignee_color} /> {t.assignee_name}</span>
          : <span>از: {t.assigner_name}</span>}
        {t.deadline && (
          <span className={`badge ${ds === 'overdue' ? 'badge-red' : ds === 'soon' ? 'badge-amber' : 'badge-gray'}`}>
            <Clock size={11} /> {fmtDateTime(t.deadline)}
          </span>
        )}
        {t.unread_comments > 0 && <span className="badge badge-red"><MessageSquare size={10} /> {fa(t.unread_comments)}</span>}
      </div>
      {t.step_count > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 6 }}>
          <span style={{ flex: 1, height: 5, borderRadius: 99, background: 'var(--border-soft)', overflow: 'hidden' }}>
            <span style={{ display: 'block', width: `${pct}%`, height: '100%', background: 'var(--chart-a)' }} />
          </span>
          <small style={{ fontSize: 10.8, color: 'var(--text-3)' }}>{fa(pct)}٪</small>
        </div>
      )}
    </Link>
  );
}

export default function Dashboard() {
  const { user, on } = useStore();
  const [inbox, setInbox] = useState([]);
  const [mine, setMine] = useState([]);
  const [assigned, setAssigned] = useState([]);
  const [notes, setNotes] = useState([]);
  const [projects, setProjects] = useState([]);
  const [crm, setCrm] = useState(null);

  const load = async () => {
    const [i, t, n, p] = await Promise.all([
      api('/workflows/requests/inbox'),
      api('/tasks'),
      api('/notes'),
      api('/projects').catch(() => ({ projects: [] })),
    ]);
    setInbox(i.requests);
    setMine(t.mine.filter(x => x.status !== 'done'));
    setAssigned(t.assigned.filter(x => x.status !== 'done'));
    setNotes(n.notes);
    setProjects(p.projects || []);
    api('/crm/summary').then(setCrm).catch(() => setCrm(null));
  };
  useEffect(() => { load(); return on('notification', load); }, []);

  const todayTasks = mine.filter(t => t.deadline && (isToday(t.deadline) || new Date(t.deadline) < new Date()));
  const overdue = mine.filter(t => deadlineState(t.deadline, t.status) === 'overdue');
  const reminders = notes.filter(n => n.remind_at && !n.done).sort((a, b) => new Date(a.remind_at) - new Date(b.remind_at));
  const remindToday = reminders.filter(n => isToday(n.remind_at) || new Date(n.remind_at) < new Date());
  const fromOthers = mine.filter(t => t.assigner_id !== user.id);
  const activeProjects = [...projects].filter(p => p.task_count > 0).sort((a, b) => a.progress - b.progress);

  const stats = [
    { label: 'در انتظار اقدام شما', value: inbox.length, icon: Inbox, bg: 'var(--primary-soft)', fg: 'var(--primary)', link: '/cartable' },
    { label: 'کارهای امروز', value: todayTasks.length, icon: CalendarCheck, bg: 'var(--red-soft)', fg: 'var(--red)', link: '/tasks' },
    { label: 'کارهای دارای تأخیر', value: overdue.length, icon: AlertTriangle, bg: 'var(--amber-soft)', fg: 'var(--amber)', link: '/tasks' },
    { label: 'یادآوری‌های امروز', value: remindToday.length, icon: Bell, bg: 'var(--sky-soft)', fg: 'var(--sky)', link: '/notes' },
  ];

  const crmStats = crm ? [
    { label: 'معاملات باز شما', value: fa(crm.open_count), sub: `${Number(crm.open_amount || 0).toLocaleString('fa-IR')} ریال`, fg: 'var(--chart-a)' },
    { label: 'نرخ موفقیت', value: crm.success_rate === null ? '—' : `${fa(crm.success_rate)}٪`,
      sub: `${fa(crm.won_count)} برنده · ${fa(crm.lost_count)} باخته`, fg: 'var(--green)' },
    { label: 'مناقصات باز', value: fa(crm.open_tenders),
      sub: crm.tenders_due_soon > 0 ? `${fa(crm.tenders_due_soon)} مهلت تا یک هفته` : 'مهلت نزدیکی ندارید',
      fg: crm.tenders_due_soon > 0 ? 'var(--red)' : 'var(--text-2)' },
    { label: 'پیگیری عقب‌افتاده', value: fa(crm.overdue_follow_ups),
      sub: crm.overdue_follow_ups > 0 ? 'همین امروز رسیدگی کنید' : 'همه‌چیز به‌روز است',
      fg: crm.overdue_follow_ups > 0 ? 'var(--amber)' : 'var(--green)' },
  ] : [];

  return (
    <div className="content">
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 20, fontWeight: 800 }}>سلام، {user.full_name.split(' ')[0]} 👋</h2>
        <p style={{ color: 'var(--text-2)', fontSize: 13.5 }}>
          {new Intl.DateTimeFormat('fa-IR', { dateStyle: 'full' }).format(new Date())}
        </p>
      </div>

      <div className="stats-grid">
        {stats.map((s, i) => {
          const Icon = s.icon;
          return (
            <Link key={i} to={s.link}>
              <div className="card stat-card" style={{ cursor: 'pointer' }}>
                <div className="stat-icon" style={{ background: s.bg, color: s.fg }}><Icon size={22} /></div>
                <div><b>{fa(s.value)}</b><span>{s.label}</span></div>
              </div>
            </Link>
          );
        })}
      </div>

      {/* کارتابل — در انتظار اقدام */}
      <div className="card" style={{ marginBottom: 16 }}>
        <ColHead icon={Inbox} title="کارتابل — در انتظار اقدام شما" count={inbox.length} to="/cartable" color="var(--primary)" />
        {inbox.length === 0 && <div className="empty">موردی در انتظار اقدام شما نیست 🎉</div>}
        {inbox.slice(0, 5).map(r => (
          <Link key={r.id} to={`/cartable/${r.id}`} className="notif-item" style={{ display: 'flex' }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 13.5 }}>{r.title}</div>
              <div style={{ fontSize: 12.3, color: 'var(--text-2)' }}>{r.template_name} · {r.requester_name} · مرحله: {r.step_title}</div>
            </div>
            <span style={{ fontSize: 11.5, color: 'var(--text-3)' }}>{fmtRelative(r.created_at)}</span>
          </Link>
        ))}
      </div>

      {/* سه ستون اصلی */}
      <div className="dash-cols">
        {/* ۱ — وظایف */}
        <div className="card">
          <ColHead icon={ListTodo} title="وظایف من" count={mine.length} to="/tasks" color="var(--sky)" />
          {mine.length === 0 && <div className="empty">کار بازی ندارید 🎉</div>}
          {mine.slice(0, 7).map(t => <TaskRow key={t.id} t={t} />)}
          {mine.length > 7 && (
            <div style={{ padding: '8px 18px 14px' }}>
              <Link to="/tasks" className="btn btn-ghost btn-sm">{fa(mine.length - 7)} کار دیگر <ArrowLeft size={13} /></Link>
            </div>
          )}
        </div>

        {/* ۲ — پیگیری‌ها؛ دوطرفه */}
        <div className="card">
          <ColHead icon={CheckCheck} title="پیگیری‌ها" count={assigned.length + fromOthers.length} to="/tasks" color="var(--chart-b)" />
          <div style={{ padding: '2px 18px 6px' }}>
            <small style={{ color: 'var(--text-3)' }}>
              <Users2 size={12} style={{ verticalAlign: '-2px' }} /> کارهایی که به دیگران سپرده‌ام ({fa(assigned.length)})
            </small>
          </div>
          {assigned.length === 0 && <div className="empty" style={{ padding: '10px 18px' }}>چیزی به کسی نسپرده‌اید</div>}
          {assigned.slice(0, 4).map(t => <TaskRow key={t.id} t={t} showAssignee />)}

          <div style={{ padding: '10px 18px 6px', borderTop: '1px solid var(--border-soft)', marginTop: 6 }}>
            <small style={{ color: 'var(--text-3)' }}>
              <CalendarClock size={12} style={{ verticalAlign: '-2px' }} /> کارهایی که دیگران از من می‌خواهند ({fa(fromOthers.length)})
            </small>
          </div>
          {fromOthers.length === 0 && <div className="empty" style={{ padding: '10px 18px' }}>کسی کاری از شما نخواسته</div>}
          {fromOthers.slice(0, 4).map(t => <TaskRow key={t.id} t={t} />)}
        </div>

        {/* ۳ — پیشرفت پروژه‌ها */}
        <div className="card">
          <ColHead icon={FolderKanban} title="پیشرفت پروژه‌ها" count={activeProjects.length} to="/projects" color="var(--chart-a)" />
          {activeProjects.length === 0 && (
            <div className="empty">
              هنوز دسته‌بندی فعالی ندارید.<br />
              <Link to="/projects" className="btn btn-ghost btn-sm" style={{ marginTop: 8 }}>ساخت دسته‌بندی</Link>
            </div>
          )}
          <div style={{ padding: '4px 18px 16px', display: 'grid', gap: 13 }}>
            {activeProjects.slice(0, 7).map(p => (
              <Link key={p.id} to={`/tasks?project=${p.id}`} style={{ display: 'block' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 5 }}>
                  <span style={{ width: 9, height: 9, borderRadius: 3, background: p.color }} />
                  <span style={{ fontSize: 13, fontWeight: 600, flex: 1 }}>{p.name}</span>
                  <b style={{ fontSize: 12.3 }}>{fa(p.progress)}٪</b>
                </div>
                <div style={{ height: 7, borderRadius: 99, background: 'var(--border-soft)', overflow: 'hidden' }}>
                  <div style={{ width: `${p.progress}%`, height: '100%', background: p.color }} />
                </div>
                <small style={{ fontSize: 11, color: 'var(--text-3)' }}>
                  {fa(p.done_count)} از {fa(p.task_count)} کار
                  {p.overdue_count > 0 && <span style={{ color: 'var(--red)' }}> · {fa(p.overdue_count)} عقب‌افتاده</span>}
                </small>
              </Link>
            ))}
          </div>
        </div>
      </div>

      {/* یادآوری‌ها و CRM */}
      <div className="grid-2" style={{ marginTop: 16 }}>
        <div className="card">
          <ColHead icon={Bell} title="یادآوری‌های پیشِ‌رو" count={reminders.length} to="/notes" linkText="یادداشت‌ها" color="var(--amber)" />
          {reminders.length === 0 && <div className="empty">یادآوری فعالی ندارید</div>}
          {reminders.slice(0, 6).map(n => {
            const late = new Date(n.remind_at) < new Date();
            return (
              <Link key={n.id} to="/notes" className="notif-item" style={{ display: 'flex' }}>
                <div className="notif-icon" style={{ background: n.color, color: '#7c5b00' }}><StickyNote size={16} /></div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 13.3 }}>{n.title || n.body?.slice(0, 40) || 'یادداشت'}</div>
                  <span className={`badge ${late ? 'badge-red' : 'badge-amber'}`}><Clock size={11} /> {fmtDateTime(n.remind_at)}</span>
                </div>
              </Link>
            );
          })}
        </div>

        {crm ? (
          <Link to="/crm" className="card card-pad" style={{ display: 'block' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <b style={{ display: 'flex', alignItems: 'center', gap: 7 }}><Handshake size={16} /> فروش و مناقصات</b>
              <ArrowLeft size={16} style={{ color: 'var(--text-3)' }} />
            </div>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              {crmStats.map(c => (
                <div key={c.label} style={{ flex: 1, minWidth: 140 }}>
                  <small style={{ color: 'var(--text-3)' }}>{c.label}</small>
                  <div style={{ fontSize: 19, fontWeight: 700, color: c.fg, lineHeight: 1.6 }}>{c.value}</div>
                  <small style={{ color: 'var(--text-3)', fontSize: 11.5 }}>{c.sub}</small>
                </div>
              ))}
            </div>
          </Link>
        ) : (
          <div className="card">
            <ColHead icon={AlertTriangle} title="کارهای دارای تأخیر" count={overdue.length} to="/tasks" color="var(--red)" />
            {overdue.length === 0 && <div className="empty">هیچ کاری عقب نیفتاده 🎉</div>}
            {overdue.slice(0, 6).map(t => <TaskRow key={t.id} t={t} />)}
          </div>
        )}
      </div>

      {/* پشتیبانی هوشمند — اگر مدیر سامانه فعالش کرده باشد */}
      <SupportChat />
    </div>
  );
}
