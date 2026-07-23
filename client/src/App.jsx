import React, { useState, useEffect, useRef } from 'react';
import { BrowserRouter, Routes, Route, NavLink, Navigate, useNavigate, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, MessageSquare, Inbox, ListTodo, Users as UsersIcon, Building2,
  GitBranch, Bell, LogOut, Cable, UserCircle, CheckCheck, BarChart3, Video, Sun, Moon, Trash2, SlidersHorizontal,
  Send, MessageSquare as MessageSquareIcon, Menu, StickyNote,
} from 'lucide-react';
import { useStore } from './store.jsx';
import { api } from './api.js';
import { fmtRelative } from './utils.js';
import { Toasts, Avatar } from './components/common.jsx';
import { CallOverlay, IncomingCallBanner } from './components/CallOverlay.jsx';
import GlobalSearch from './components/GlobalSearch.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Chat from './pages/Chat.jsx';
import Cartable from './pages/Cartable.jsx';
import RequestDetail from './pages/RequestDetail.jsx';
import Tasks from './pages/Tasks.jsx';
import UsersPage from './pages/Users.jsx';
import Departments from './pages/Departments.jsx';
import Workflows from './pages/Workflows.jsx';
import Reports from './pages/Reports.jsx';
import Recordings from './pages/Recordings.jsx';
import Settings from './pages/Settings.jsx';
import Profile from './pages/Profile.jsx';
import Notes from './pages/Notes.jsx';

const NOTIF_COLORS = {
  task: ['var(--sky-soft)', 'var(--sky)'],
  workflow: ['var(--primary-soft)', 'var(--primary)'],
  reminder: ['var(--amber-soft)', 'var(--amber)'],
  chat: ['var(--green-soft)', 'var(--green)'],
  info: ['#f1f2f7', 'var(--text-2)'],
};

const taskIdFromLink = (link) => {
  const m = /\/tasks\?task=(\d+)/.exec(link || '');
  return m ? Number(m[1]) : null;
};

function NotifPanel({ onClose }) {
  const { notifications, setNotifications, setUnreadNotifs, toast, refreshBadges } = useStore();
  const [selected, setSelected] = useState(new Set());
  const [replyId, setReplyId] = useState(null);   // id اعلانی که در حال پاسخ سریع به آن هستیم
  const [replyText, setReplyText] = useState('');
  const [replyBusy, setReplyBusy] = useState(false);
  const navigate = useNavigate();

  const recount = (list) => setUnreadNotifs(list.filter(x => !x.is_read).length);

  const markRead = (id) => {
    setNotifications(list => list.map(x => x.id === id && !x.is_read ? { ...x, is_read: 1 } : x));
    setUnreadNotifs(c => Math.max(0, c - 1));
  };

  const sendReply = async (e, n) => {
    e.stopPropagation();
    const taskId = taskIdFromLink(n.link);
    const body = replyText.trim();
    if (!taskId || !body) return;
    setReplyBusy(true);
    try {
      await api(`/tasks/${taskId}/comments`, { method: 'POST', body: { body } });
      // با ارسال پاسخ، این اعلان خوانده‌شده و بسته می‌شود
      api(`/notifications/${n.id}/read`, { method: 'POST' }).catch(() => {});
      markRead(n.id);
      setReplyId(null); setReplyText('');
      refreshBadges?.();
      toast('پاسخ شما ارسال شد');
    } catch (err) { toast(err.message || 'خطا در ارسال پاسخ', 'error'); }
    setReplyBusy(false);
  };

  const readAll = async () => {
    await api('/notifications/read-all', { method: 'POST' });
    setNotifications(n => n.map(x => ({ ...x, is_read: 1 })));
    setUnreadNotifs(0);
  };

  const removeOne = async (e, n) => {
    e.stopPropagation();
    await api(`/notifications/${n.id}`, { method: 'DELETE' });
    setNotifications(list => { const next = list.filter(x => x.id !== n.id); recount(next); return next; });
    setSelected(s => { const next = new Set(s); next.delete(n.id); return next; });
  };

  const removeSelected = async () => {
    const ids = [...selected];
    await api('/notifications/delete', { method: 'POST', body: { ids } });
    setNotifications(list => { const next = list.filter(x => !selected.has(x.id)); recount(next); return next; });
    setSelected(new Set());
    toast(`${ids.length.toLocaleString('fa-IR')} اعلان حذف شد`);
  };

  const removeAll = async () => {
    if (!window.confirm('همه اعلان‌ها حذف شوند؟')) return;
    await api('/notifications/delete-all', { method: 'POST' });
    setNotifications([]);
    setUnreadNotifs(0);
    setSelected(new Set());
  };

  const toggleSelect = (e, id) => {
    e.stopPropagation();
    setSelected(s => { const next = new Set(s); next.has(id) ? next.delete(id) : next.add(id); return next; });
  };

  const open = async (n) => {
    if (!n.is_read) {
      api(`/notifications/${n.id}/read`, { method: 'POST' });
      setNotifications(list => list.map(x => x.id === n.id ? { ...x, is_read: 1 } : x));
      setUnreadNotifs(c => Math.max(0, c - 1));
    }
    onClose();
    if (n.link) navigate(n.link);
  };

  return (
    <div className="notif-panel">
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '14px 16px 10px', flexWrap: 'wrap' }}>
        <b style={{ marginLeft: 'auto' }}>اعلان‌ها</b>
        {selected.size > 0 && (
          <button className="btn btn-danger btn-sm" onClick={removeSelected}>
            <Trash2 size={14} /> حذف ({selected.size.toLocaleString('fa-IR')})
          </button>
        )}
        {notifications.length > 0 && (
          <button className="btn btn-ghost btn-sm" onClick={removeAll} title="حذف همه اعلان‌ها"><Trash2 size={14} /> همه</button>
        )}
        <button className="btn btn-ghost btn-sm" onClick={readAll}><CheckCheck size={15} /> خواندن همه</button>
      </div>
      <div style={{ overflowY: 'auto' }}>
        {notifications.length === 0 && <div className="empty">اعلانی ندارید</div>}
        {notifications.map(n => {
          const [bg, fg] = NOTIF_COLORS[n.type] || NOTIF_COLORS.info;
          const taskId = taskIdFromLink(n.link);
          return (
            <div key={n.id} className={`notif-item ${n.is_read ? '' : 'unread'}`} onClick={() => open(n)}>
              <input type="checkbox" checked={selected.has(n.id)} onChange={() => {}}
                onClick={(e) => toggleSelect(e, n.id)}
                style={{ marginTop: 10, accentColor: 'var(--primary)', cursor: 'pointer' }} />
              <div className="notif-icon" style={{ background: bg, color: fg }}><Bell size={17} /></div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 13.3 }}>{n.title}</div>
                <div style={{ fontSize: 12.3, color: 'var(--text-2)' }}>{n.body}</div>
                <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>{fmtRelative(n.created_at)}</div>
                {/* پاسخ سریع به آخرین کامنتِ تسک، بدون خروج از هر صفحه‌ای که هستیم */}
                {taskId && (
                  replyId === n.id ? (
                    <div style={{ display: 'flex', gap: 6, marginTop: 8 }} onClick={(e) => e.stopPropagation()}>
                      <input className="input" autoFocus value={replyText} placeholder="پاسخ شما…"
                        onChange={(e) => setReplyText(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) sendReply(e, n); }}
                        style={{ flex: 1, height: 34, fontSize: 12.5 }} />
                      <button className="btn btn-primary btn-sm" disabled={replyBusy || !replyText.trim()}
                        onClick={(e) => sendReply(e, n)}><Send size={13} /></button>
                    </div>
                  ) : (
                    <button className="btn btn-ghost btn-sm" style={{ marginTop: 6 }}
                      onClick={(e) => { e.stopPropagation(); setReplyId(n.id); setReplyText(''); }}>
                      <MessageSquareIcon size={13} /> پاسخ سریع
                    </button>
                  )
                )}
              </div>
              <button className="icon-btn" style={{ width: 28, height: 28, flexShrink: 0 }} title="حذف این اعلان"
                onClick={(e) => removeOne(e, n)}><Trash2 size={13} /></button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const TITLES = {
  '/': 'داشبورد', '/chat': 'گفتگوها', '/cartable': 'کارتابل', '/tasks': 'تسک‌ها',
  '/users': 'کاربران', '/departments': 'واحدهای سازمانی', '/workflows': 'فرآیندها',
  '/reports': 'گزارش‌گیری', '/recordings': 'ضبط جلسات و تماس‌ها', '/settings': 'تنظیمات سازمان', '/profile': 'پروفایل',
  '/notes': 'یادداشت‌ها و یادآوری‌ها',
};

const fmtBadge = (n) => (n > 99 ? '۹۹+' : Number(n).toLocaleString('fa-IR'));

function Layout({ children }) {
  const { user, logout, unreadNotifs, hasPerm, departments, theme, toggleTheme, cartableCount, taskCount, taskCommentCount } = useStore();
  const [notifOpen, setNotifOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const notifRef = useRef(null);
  const location = useLocation();
  useEffect(() => { setNotifOpen(false); setDrawerOpen(false); }, [location.pathname]);

  // بستن پنل اعلان‌ها با کلیک بیرون از آن
  useEffect(() => {
    if (!notifOpen) return;
    const handler = (e) => { if (notifRef.current && !notifRef.current.contains(e.target)) setNotifOpen(false); };
    document.addEventListener('mousedown', handler);
    document.addEventListener('touchstart', handler);
    return () => { document.removeEventListener('mousedown', handler); document.removeEventListener('touchstart', handler); };
  }, [notifOpen]);
  const title = TITLES[location.pathname] || (location.pathname.startsWith('/cartable') ? 'کارتابل' : '');

  // چه کسی فرآیند می‌سازد: مدیر سامانه، سرگروه/مدیر واحد، اعضای واحد مدیریت
  const myDept = departments.find(d => d.id === user.department_id);
  const canBuildWorkflows = hasPerm('workflows.manage') || user.role === 'manager'
    || departments.some(d => d.manager_id === user.id) || !!myDept?.is_management;
  const canViewReports = canBuildWorkflows || hasPerm('reports.view');
  // بخش ضبط‌ها فقط برای مدیر سامانه و سرگروه‌ها/مدیران واحدها
  const canViewRecordings = user.role === 'admin' || user.role === 'manager'
    || departments.some(d => d.manager_id === user.id);

  return (
    <div className="app">
      {drawerOpen && <div className="sidebar-overlay" onClick={() => setDrawerOpen(false)} />}
      <aside className={`sidebar ${drawerOpen ? 'open' : ''}`}>
        <div className="brand">
          <div className="brand-logo"><Cable size={21} /></div>
          <div>
            <b>توس‌کابل</b>
            <small>اتوماسیون اداری</small>
          </div>
        </div>
        <nav className="nav">
          <div className="nav-label">اصلی</div>
          <NavLink to="/" end className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}><LayoutDashboard size={19} /><span>داشبورد</span></NavLink>
          <NavLink to="/chat" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}><MessageSquare size={19} /><span>گفتگوها</span></NavLink>
          <NavLink to="/cartable" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <Inbox size={19} /><span>کارتابل</span>
            {cartableCount > 0 && <span className="badge-count nav-badge">{fmtBadge(cartableCount)}</span>}
          </NavLink>
          <NavLink to="/tasks" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <ListTodo size={19} /><span>تسک‌ها</span>
            <span style={{ marginInlineStart: 'auto', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              {taskCommentCount > 0 && (
                <span className="badge-count" title="کامنت‌های خوانده‌نشده"
                  style={{ background: 'var(--red)', display: 'inline-flex', alignItems: 'center', gap: 3, width: 'auto', padding: '0 6px' }}>
                  <MessageSquare size={11} /> {fmtBadge(taskCommentCount)}
                </span>
              )}
              {taskCount > 0 && <span className="badge-count">{fmtBadge(taskCount)}</span>}
            </span>
          </NavLink>
          <NavLink to="/notes" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}><StickyNote size={19} /><span>یادداشت‌ها</span></NavLink>
          {(hasPerm('users.manage') || hasPerm('departments.manage') || canBuildWorkflows || canViewReports || canViewRecordings || hasPerm('settings.manage')) && (
            <div className="nav-label">مدیریت سامانه</div>
          )}
          {hasPerm('users.manage') && (
            <NavLink to="/users" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}><UsersIcon size={19} /><span>کاربران</span></NavLink>
          )}
          {hasPerm('departments.manage') && (
            <NavLink to="/departments" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}><Building2 size={19} /><span>واحدها</span></NavLink>
          )}
          {canBuildWorkflows && (
            <NavLink to="/workflows" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}><GitBranch size={19} /><span>فرآیندها</span></NavLink>
          )}
          {canViewReports && (
            <NavLink to="/reports" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}><BarChart3 size={19} /><span>گزارش‌گیری</span></NavLink>
          )}
          {canViewRecordings && (
            <NavLink to="/recordings" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}><Video size={19} /><span>ضبط جلسات</span></NavLink>
          )}
          {hasPerm('settings.manage') && (
            <NavLink to="/settings" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}><SlidersHorizontal size={19} /><span>تنظیمات سازمان</span></NavLink>
          )}
        </nav>
        <div className="sidebar-footer">
          <NavLink to="/profile" className="nav-item" style={{ marginBottom: 0 }}>
            <Avatar name={user.full_name} color={user.avatar_color} size={32} avatar={user.avatar_path} />
            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.full_name}</span>
          </NavLink>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <button className="icon-btn hamburger" onClick={() => setDrawerOpen(o => !o)} title="منو"><Menu size={20} /></button>
          <h1>{title}</h1>
          <div className="spacer" />
          <GlobalSearch />
          <div className="spacer" />
          <button className="icon-btn theme-toggle" onClick={toggleTheme} title={theme === 'dark' ? 'حالت روشن' : 'حالت تیره'}>
            {theme === 'dark' ? <Sun size={19} /> : <Moon size={19} />}
          </button>
          <div className="notif-wrap" ref={notifRef}>
            <button className="icon-btn" onClick={() => setNotifOpen(o => !o)} title="اعلان‌ها">
              <Bell size={19} />
              {unreadNotifs > 0 && <span className="dot">{unreadNotifs > 99 ? '۹۹+' : unreadNotifs.toLocaleString('fa-IR')}</span>}
            </button>
            {notifOpen && <NotifPanel onClose={() => setNotifOpen(false)} />}
          </div>
          <NavLink to="/profile" className="icon-btn" title="پروفایل"><UserCircle size={20} /></NavLink>
          <button className="icon-btn" onClick={logout} title="خروج"><LogOut size={19} /></button>
        </header>
        {children}
      </div>
    </div>
  );
}

export default function App() {
  const { user, booted } = useStore();
  if (!booted) {
    return <div style={{ height: '100vh', display: 'grid', placeItems: 'center', color: 'var(--text-3)' }}>در حال بارگذاری…</div>;
  }
  return (
    <BrowserRouter>
      <Toasts />
      {user && <IncomingCallBanner />}
      {user && <CallOverlay />}
      <Routes>
        <Route path="/login" element={user ? <Navigate to="/" /> : <Login />} />
        <Route path="/*" element={
          !user ? <Navigate to="/login" /> : (
            <Layout>
              <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/chat" element={<Chat />} />
                <Route path="/cartable" element={<Cartable />} />
                <Route path="/cartable/:id" element={<RequestDetail />} />
                <Route path="/tasks" element={<Tasks />} />
                <Route path="/users" element={<UsersPage />} />
                <Route path="/departments" element={<Departments />} />
                <Route path="/workflows" element={<Workflows />} />
                <Route path="/reports" element={<Reports />} />
                <Route path="/recordings" element={<Recordings />} />
                <Route path="/settings" element={<Settings />} />
                <Route path="/profile" element={<Profile />} />
                <Route path="/notes" element={<Notes />} />
                <Route path="*" element={<Navigate to="/" />} />
              </Routes>
            </Layout>
          )
        } />
      </Routes>
    </BrowserRouter>
  );
}
