import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Inbox, ListTodo, Users, Building2, ArrowLeft, Clock, Bell, StickyNote, CalendarCheck, Handshake, Gavel, CalendarClock } from 'lucide-react';
import { api } from '../api.js';
import { useStore } from '../store.jsx';
import { fa, fmtRelative, fmtDateTime, deadlineState } from '../utils.js';
import { Avatar } from '../components/common.jsx';

const PRIORITY = { low: ['کم', 'badge-gray'], normal: ['عادی', 'badge-sky'], high: ['زیاد', 'badge-amber'], urgent: ['فوری', 'badge-red'] };

// آیا این تاریخ متعلق به «امروز» است؟
function isToday(iso) {
  if (!iso) return false;
  const d = new Date(iso), n = new Date();
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
}

export default function Dashboard() {
  const { user, users, departments, on } = useStore();
  const [inbox, setInbox] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [notes, setNotes] = useState([]);
  const [crm, setCrm] = useState(null); // خلاصهٔ CRM — فقط برای کسانی که دسترسی دارند

  const load = async () => {
    const [i, t, n] = await Promise.all([api('/workflows/requests/inbox'), api('/tasks'), api('/notes')]);
    setInbox(i.requests);
    setTasks(t.mine.filter(x => x.status !== 'done'));
    setNotes(n.notes);
    // بدون دسترسی CRM این درخواست ۴۰۳ می‌دهد و کارت نمایش داده نمی‌شود
    api('/crm/summary').then(setCrm).catch(() => setCrm(null));
  };
  useEffect(() => { load(); return on('notification', load); }, []);

  // کارهای امروز: تسک‌هایی که مهلتشان امروز است یا گذشته
  const todayTasks = tasks.filter(t => t.deadline && (isToday(t.deadline) || new Date(t.deadline) < new Date()));
  // یادآوری‌های پیشِ‌رو: یادداشت‌های دارای زمان، انجام‌نشده، مرتب بر اساس نزدیک‌ترین
  const reminders = notes
    .filter(n => n.remind_at && !n.done)
    .sort((a, b) => new Date(a.remind_at) - new Date(b.remind_at));
  const remindToday = reminders.filter(n => isToday(n.remind_at) || new Date(n.remind_at) < new Date());

  const stats = [
    { label: 'در انتظار اقدام شما', value: inbox.length, icon: Inbox, bg: 'var(--primary-soft)', fg: 'var(--primary)', link: '/cartable' },
    { label: 'کارهای امروز', value: todayTasks.length, icon: CalendarCheck, bg: 'var(--red-soft)', fg: 'var(--red)', link: '/tasks' },
    { label: 'تسک‌های باز شما', value: tasks.length, icon: ListTodo, bg: 'var(--sky-soft)', fg: 'var(--sky)', link: '/tasks' },
    { label: 'یادآوری‌های امروز', value: remindToday.length, icon: Bell, bg: 'var(--amber-soft)', fg: 'var(--amber)', link: '/notes' },
  ];

  // [CRM] کارت خلاصهٔ فروش — فقط برای کاربرانی که به CRM دسترسی دارند
  const crmStats = crm ? [
    { label: 'معاملات باز شما', value: fa(crm.open_count), sub: `${Number(crm.open_amount || 0).toLocaleString('fa-IR')} ریال`,
      icon: Handshake, fg: 'var(--chart-a)' },
    { label: 'نرخ موفقیت', value: crm.success_rate === null ? '—' : `${fa(crm.success_rate, 1)}٪`,
      sub: `${fa(crm.won_count)} برنده · ${fa(crm.lost_count)} باخته`, icon: Handshake, fg: 'var(--green)' },
    { label: 'مناقصات باز', value: fa(crm.open_tenders),
      sub: crm.tenders_due_soon > 0 ? `${fa(crm.tenders_due_soon)} مهلت تا یک هفته` : 'مهلت نزدیکی ندارید',
      icon: Gavel, fg: crm.tenders_due_soon > 0 ? 'var(--red)' : 'var(--text-2)' },
    { label: 'پیگیری عقب‌افتاده', value: fa(crm.overdue_follow_ups),
      sub: crm.overdue_follow_ups > 0 ? 'همین امروز رسیدگی کنید' : 'همه‌چیز به‌روز است',
      icon: CalendarClock, fg: crm.overdue_follow_ups > 0 ? 'var(--amber)' : 'var(--green)' },
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
          const inner = (
            <div className="card stat-card" style={{ cursor: s.link ? 'pointer' : 'default' }}>
              <div className="stat-icon" style={{ background: s.bg, color: s.fg }}><Icon size={22} /></div>
              <div><b>{fa(s.value)}</b><span>{s.label}</span></div>
            </div>
          );
          return s.link ? <Link key={i} to={s.link}>{inner}</Link> : <div key={i}>{inner}</div>;
        })}
      </div>

      {/* کارهای امروز — تسک‌هایی که مهلتشان امروز است یا از آن گذشته */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px 8px' }}>
          <b style={{ display: 'flex', alignItems: 'center', gap: 7 }}><CalendarCheck size={17} style={{ color: 'var(--red)' }} /> کارهای امروز</b>
          <Link to="/tasks" className="btn btn-ghost btn-sm">همه تسک‌ها <ArrowLeft size={14} /></Link>
        </div>
        {todayTasks.length === 0 && <div className="empty">برای امروز کار مهلت‌داری ندارید 🎉</div>}
        {todayTasks.map(t => {
          const [pl, pc] = PRIORITY[t.priority] || PRIORITY.normal;
          const ds = deadlineState(t.deadline, t.status);
          return (
            <div key={t.id} className="notif-item">
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 13.5, display: 'flex', gap: 8, alignItems: 'center' }}>
                  {t.title} <span className={`badge ${pc}`}>{pl}</span>
                </div>
                <div style={{ fontSize: 12.3, color: 'var(--text-2)', display: 'flex', alignItems: 'center', gap: 5 }}>
                  <Avatar name={t.assigner_name} size={18} color="#9aa0b5" /> از طرف {t.assigner_name}
                  <span className={`badge ${ds === 'overdue' ? 'badge-red' : 'badge-amber'}`}>
                    <Clock size={11} /> {fmtDateTime(t.deadline)}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="grid-2">
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px 8px' }}>
            <b>کارتابل — در انتظار اقدام شما</b>
            <Link to="/cartable" className="btn btn-ghost btn-sm">همه <ArrowLeft size={14} /></Link>
          </div>
          {inbox.length === 0 && <div className="empty">موردی در انتظار اقدام شما نیست 🎉</div>}
          {inbox.slice(0, 6).map(r => (
            <Link key={r.id} to={`/cartable/${r.id}`} className="notif-item" style={{ display: 'flex' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 13.5 }}>{r.title}</div>
                <div style={{ fontSize: 12.3, color: 'var(--text-2)' }}>{r.template_name} · {r.requester_name} · مرحله: {r.step_title}</div>
              </div>
              <span style={{ fontSize: 11.5, color: 'var(--text-3)' }}>{fmtRelative(r.created_at)}</span>
            </Link>
          ))}
        </div>

      {/* [CRM] خلاصهٔ فروش و مناقصات — فقط برای واحدهای دارای دسترسی */}
      {crm && (
        <Link to="/crm" className="card card-pad" style={{ display: 'block', marginBottom: 18 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <b style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <Handshake size={16} /> فروش و مناقصات
            </b>
            <ArrowLeft size={16} style={{ color: 'var(--text-3)' }} />
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {crmStats.map(c => (
              <div key={c.label} style={{ flex: 1, minWidth: 150 }}>
                <small style={{ color: 'var(--text-3)' }}>{c.label}</small>
                <div style={{ fontSize: 19, fontWeight: 700, color: c.fg, lineHeight: 1.6 }}>{c.value}</div>
                <small style={{ color: 'var(--text-3)', fontSize: 11.5 }}>{c.sub}</small>
              </div>
            ))}
          </div>
        </Link>
      )}

        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px 8px' }}>
            <b style={{ display: 'flex', alignItems: 'center', gap: 7 }}><Bell size={16} style={{ color: 'var(--amber)' }} /> یادآوری‌های پیشِ‌رو</b>
            <Link to="/notes" className="btn btn-ghost btn-sm">یادداشت‌ها <ArrowLeft size={14} /></Link>
          </div>
          {reminders.length === 0 && <div className="empty">یادآوری فعالی ندارید</div>}
          {reminders.slice(0, 6).map(n => {
            const overdue = new Date(n.remind_at) < new Date();
            return (
              <Link key={n.id} to="/notes" className="notif-item" style={{ display: 'flex' }}>
                <div className="notif-icon" style={{ background: n.color, color: '#7c5b00' }}><StickyNote size={16} /></div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 13.3 }}>{n.title || n.body?.slice(0, 40) || 'یادداشت'}</div>
                  <span className={`badge ${overdue ? 'badge-red' : 'badge-amber'}`}><Clock size={11} /> {fmtDateTime(n.remind_at)}</span>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
