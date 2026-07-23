import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { io } from 'socket.io-client';
import { api, getToken, setToken } from './api.js';

const Ctx = createContext(null);
export const useStore = () => useContext(Ctx);

// خروج خودکار پس از این مدت بی‌فعالیتیِ واقعی کاربر (۱ ساعت).
// این مقدار هم هنگام بالاآمدن سامانه (boot) و هم به‌صورت زنده بررسی می‌شود.
const IDLE_LIMIT = 60 * 60 * 1000; // ۱ ساعت
const IDLE_KEY = 'lastActivityAt';
const markActivity = () => { try { localStorage.setItem(IDLE_KEY, String(Date.now())); } catch {} };
// آیا از آخرین فعالیتِ ثبت‌شده بیش از حد مجاز گذشته است؟
// (اگر کلیدی ثبت نشده باشد، منقضی حساب نمی‌شود تا کاربرانِ نسخهٔ قبل یک‌بار مهلت بگیرند)
const idleExpired = () => {
  const last = Number(localStorage.getItem(IDLE_KEY));
  return last > 0 && (Date.now() - last) >= IDLE_LIMIT;
};

export function StoreProvider({ children }) {
  const [user, setUser] = useState(null);
  const [booted, setBooted] = useState(false);
  const [users, setUsers] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [settings, setSettings] = useState({});
  const [onlineIds, setOnlineIds] = useState(new Set());
  const [notifications, setNotifications] = useState([]);
  const [unreadNotifs, setUnreadNotifs] = useState(0);
  const [cartableCount, setCartableCount] = useState(0); // درخواست‌های در انتظار اقدام من
  const [taskCount, setTaskCount] = useState(0);         // تسک‌های انجام‌نشدهٔ من
  const [taskCommentCount, setTaskCommentCount] = useState(0); // کامنت‌های خوانده‌نشدهٔ تسک‌ها
  const [toasts, setToasts] = useState([]);
  const [incomingCall, setIncomingCall] = useState(null); // {room, video, from, title}
  const [activeCall, setActiveCall] = useState(null); // {room, video, title}
  const [theme, setThemeState] = useState(() => localStorage.getItem('theme') || 'light');
  const socketRef = useRef(null);
  const listenersRef = useRef(new Map()); // event -> Set<fn>

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);
  const setTheme = useCallback((t) => setThemeState(t), []);
  const toggleTheme = useCallback(() => setThemeState(t => (t === 'dark' ? 'light' : 'dark')), []);

  const toast = useCallback((text, type = 'info') => {
    const id = Math.random();
    setToasts(t => [...t, { id, text, type }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 4200);
  }, []);

  // ---------- صداها (زنگ تماس و اعلان) ----------
  const userRef = useRef(null);
  useEffect(() => { userRef.current = user; }, [user]);
  const soundUrl = useCallback((kind) => {
    const u = userRef.current;
    if (kind === 'ringtone') return u?.ringtone_path ? `/usersounds/${u.ringtone_path}` : '/sounds/ringtone.mp3';
    return u?.notif_sound_path ? `/usersounds/${u.notif_sound_path}` : '/sounds/notification.mp3';
  }, []);
  const notifAudioRef = useRef(null);
  const playNotifSound = useCallback(() => {
    try {
      const a = notifAudioRef.current || (notifAudioRef.current = new Audio());
      a.src = soundUrl('notif');
      a.currentTime = 0;
      a.play?.().catch(() => {});
    } catch {}
  }, [soundUrl]);

  // صداهای سیستمی ثابت: بوق انتظار (Beep) و اشغال (Busy_beep)
  const sysAudioRef = useRef(null);
  const playSystemSound = useCallback((name) => {
    try {
      const a = sysAudioRef.current || (sysAudioRef.current = new Audio());
      a.loop = false;
      a.src = `/sounds/${name}`;
      a.currentTime = 0;
      a.play?.().catch(() => {});
    } catch {}
  }, []);
  const playBusySound = useCallback(() => playSystemSound('Busy_beep.mp3'), [playSystemSound]);

  // ---------- اعلان سیستم‌عاملی (Web Notifications) ----------
  // اگر کاربر در تب سامانه نباشد، اعلان روی سیستم‌عامل نمایش داده می‌شود تا متوجه شود باید بازگردد.
  const notifPermRef = useRef(typeof Notification !== 'undefined' ? Notification.permission : 'denied');
  // ترجیحِ فعال‌بودن اعلان — پیش‌فرض روشن؛ در تنظیمات قابل خاموش‌کردن (ذخیره در همین دستگاه)
  const [notifEnabled, setNotifEnabledState] = useState(() => localStorage.getItem('notifEnabled') !== '0');
  const setNotifEnabled = useCallback((v) => {
    setNotifEnabledState(!!v);
    localStorage.setItem('notifEnabled', v ? '1' : '0');
    if (v) { requestNotifPermissionRef.current?.(); }
  }, []);
  const requestNotifPermissionRef = useRef(null);
  const requestNotifPermission = useCallback(async () => {
    if (typeof Notification === 'undefined') return 'unsupported';
    if (Notification.permission === 'default') {
      try { notifPermRef.current = await Notification.requestPermission(); }
      catch { notifPermRef.current = Notification.permission; }
    } else {
      notifPermRef.current = Notification.permission;
    }
    return notifPermRef.current;
  }, []);
  requestNotifPermissionRef.current = requestNotifPermission;
  const showOSNotification = useCallback((title, body, opts = {}) => {
    try {
      if (!notifEnabled) return; // کاربر اعلان را در تنظیمات خاموش کرده
      if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
      // فقط وقتی تب دیده نمی‌شود اعلان سیستمی بده تا مزاحم کاربرِ حاضر نشویم
      if (!opts.always && document.visibilityState === 'visible' && document.hasFocus()) return;
      const n = new Notification(title, { body: body || '', icon: '/favicon.ico', tag: opts.tag, renotify: true });
      n.onclick = () => { try { window.focus(); n.close(); } catch {} };
    } catch {}
  }, [notifEnabled]);

  // زنگ تماس: تا وقتی تماس ورودی هست به‌صورت تکراری پخش می‌شود
  const ringRef = useRef(null);
  useEffect(() => {
    if (!incomingCall) {
      if (ringRef.current) { try { ringRef.current.pause(); } catch {} ringRef.current = null; }
      return;
    }
    const a = new Audio(soundUrl('ringtone'));
    a.loop = true;
    a.play?.().catch(() => {});
    ringRef.current = a;
    return () => { try { a.pause(); } catch {} ringRef.current = null; };
  }, [incomingCall, soundUrl]);

  const refreshDirectory = useCallback(async () => {
    const [u, d] = await Promise.all([api('/users'), api('/departments')]);
    setUsers(u.users); setDepartments(d.departments);
  }, []);

  const refreshSettings = useCallback(async () => {
    try { const s = await api('/settings'); setSettings(s.settings || {}); }
    catch {}
  }, []);

  const refreshNotifs = useCallback(async () => {
    const n = await api('/notifications');
    setNotifications(n.notifications); setUnreadNotifs(n.unread);
  }, []);

  const reloadUser = useCallback(async () => {
    try { const me = await api('/auth/me'); setUser(me.user); } catch {}
  }, []);

  // شمارندهٔ کارهای در انتظار برای نمایش در سایدبار
  const refreshBadges = useCallback(async () => {
    try {
      const [inbox, tasks] = await Promise.all([
        api('/workflows/requests/inbox'),
        api('/tasks'),
      ]);
      setCartableCount(inbox.requests.length);
      setTaskCount(tasks.mine.filter(t => t.status !== 'done').length);
      const unreadComments = [...tasks.mine, ...tasks.assigned]
        .reduce((s, t) => s + (t.unread_comments || 0), 0);
      setTaskCommentCount(unreadComments);
    } catch {}
  }, []);

  // اشتراک رویدادهای سوکت برای صفحات
  const on = useCallback((event, fn) => {
    if (!listenersRef.current.has(event)) listenersRef.current.set(event, new Set());
    listenersRef.current.get(event).add(fn);
    return () => listenersRef.current.get(event)?.delete(fn);
  }, []);
  const emitLocal = (event, data) => {
    listenersRef.current.get(event)?.forEach(fn => fn(data));
  };

  const connectSocket = useCallback(() => {
    if (socketRef.current) socketRef.current.disconnect();
    const s = io({ auth: { token: getToken() } });
    socketRef.current = s;
    s.on('presence:list', ids => setOnlineIds(new Set(ids)));
    s.on('presence', ({ user_id, online }) => {
      setOnlineIds(prev => {
        const next = new Set(prev);
        online ? next.add(user_id) : next.delete(user_id);
        return next;
      });
    });
    s.on('notification', n => {
      setNotifications(prev => [n, ...prev]);
      setUnreadNotifs(c => c + 1);
      toast(n.title);
      playNotifSound();
      showOSNotification(n.title, n.body || n.message || '', { tag: `notif-${n.id || ''}` });
      emitLocal('notification', n);
      refreshBadges();
    });
    s.on('message:new', d => {
      // صدای اعلان فقط برای پیامِ دیگران (نه پیام‌های خودم)
      if (d?.message && d.message.sender_id !== userRef.current?.id) {
        playNotifSound();
        const m = d.message;
        showOSNotification(m.sender_name || 'پیام جدید', m.content || 'پیام جدید دریافت شد', { tag: `chat-${d.conversation_id || ''}` });
      }
      emitLocal('message:new', d);
    });
    s.on('conversation:new', d => emitLocal('conversation:new', d));
    s.on('typing', d => emitLocal('typing', d));
    s.on('call:incoming', d => {
      setIncomingCall(d);
      const kind = d.video ? 'تماس تصویری' : 'تماس صوتی';
      showOSNotification(`${kind} ورودی`, `${d.from?.name || ''}${d.title ? ` · ${d.title}` : ''}`, { tag: `call-${d.room}`, always: true });
    });
    s.on('call:rejected', d => {
      toast(`${d.by} تماس را رد کرد`);
      playBusySound();
      // در تماس دونفره، رد شدن تماس یعنی پایان آن برای تماس‌گیرنده
      if (activeCallRef.current && activeCallRef.current.room === d.room && !activeCallRef.current.group) {
        setTimeout(() => setActiveCall(null), 900);
      }
      emitLocal('call:rejected', d);
    });
    s.on('call:busy', d => {
      toast(`${d.name || 'کاربر'} در تماس دیگری مشغول است`, 'error');
      playBusySound();
      if (activeCallRef.current && activeCallRef.current.room === d.room && !activeCallRef.current.group) {
        setTimeout(() => setActiveCall(null), 1200);
      }
      emitLocal('call:busy', d);
    });
    s.on('call:cancelled', d => {
      setIncomingCall(prev => (prev && prev.room === d.room ? null : prev));
      emitLocal('call:cancelled', d);
    });
    s.on('call:peers', d => emitLocal('call:peers', d));
    s.on('call:peer-joined', d => emitLocal('call:peer-joined', d));
    s.on('call:peer-left', d => emitLocal('call:peer-left', d));
    s.on('rtc:signal', d => emitLocal('rtc:signal', d));
    s.on('conversation:left', d => emitLocal('conversation:left', d));
    s.on('task:comment', d => { emitLocal('task:comment', d); refreshBadges(); });
  }, [toast, refreshBadges, playNotifSound, showOSNotification, playBusySound]);

  const boot = useCallback(async () => {
    if (!getToken()) { setBooted(true); return; }
    // اگر از آخرین فعالیت بیش از ۱ ساعت گذشته باشد، حتی با وجود توکنِ معتبر
    // نشست را ادامه نمی‌دهیم و کاربر باید دوباره وارد شود.
    if (idleExpired()) { setToken(''); localStorage.removeItem(IDLE_KEY); setBooted(true); return; }
    try {
      const me = await api('/auth/me');
      setUser(me.user);
      connectSocket();
      // اعلان به‌صورت پیش‌فرض روشن است → مجوز را خودکار می‌گیریم (مگر کاربر در تنظیمات خاموش کرده باشد)
      if (localStorage.getItem('notifEnabled') !== '0') requestNotifPermission();
      await Promise.all([refreshDirectory(), refreshNotifs(), refreshBadges(), refreshSettings()]);
    } catch { setToken(''); }
    setBooted(true);
  }, [connectSocket, refreshDirectory, refreshNotifs, refreshBadges, refreshSettings, requestNotifPermission]);

  useEffect(() => { boot(); }, []);

  const login = async (username, password) => {
    const r = await api('/auth/login', { method: 'POST', body: { username, password } });
    setToken(r.token);
    markActivity(); // شروعِ تازهٔ شمارشِ بی‌فعالیتی هنگام ورود
    setUser(r.user);
    connectSocket();
    if (localStorage.getItem('notifEnabled') !== '0') requestNotifPermission();
    await Promise.all([refreshDirectory(), refreshNotifs(), refreshBadges(), refreshSettings()]);
  };

  const logout = useCallback((reason) => {
    socketRef.current?.disconnect();
    setToken('');
    setUser(null);
    if (reason) setTimeout(() => toast(reason, 'info'), 60);
  }, [toast]);

  // خروج خودکار پس از ۳۰ دقیقه بی‌فعالیتی واقعی کاربر.
  // با هر فعالیت (حرکت ماوس، کلید، اسکرول، لمس، کلیک) تایمر ریست می‌شود؛
  // اگر کاربر فعال باشد هرگز خارج نمی‌شود. فعالیت بین چند تب هم مشترک است.
  const activeCallRef = useRef(null);
  useEffect(() => { activeCallRef.current = activeCall; }, [activeCall]);
  useEffect(() => {
    if (!user) return;
    // نکته: اینجا دیگر تایمر را «ریست» نمی‌کنیم؛ چون boot() قبلاً منقضی‌بودن را بررسی کرده
    // و ریستِ کورکورانه دقیقاً همان باگی بود که باعث می‌شد بی‌فعالیتی نادیده گرفته شود.
    // فقط اگر هیچ زمانی ثبت نشده باشد، یک نقطهٔ شروع می‌گذاریم.
    if (!Number(localStorage.getItem(IDLE_KEY))) markActivity();
    let lastWrite = 0;
    const onActivity = () => {
      const now = Date.now();
      if (now - lastWrite < 2000) return; // محدودکردن نوشتن‌ها
      lastWrite = now;
      markActivity();
    };
    const events = ['mousemove', 'mousedown', 'keydown', 'scroll', 'wheel', 'touchstart', 'click'];
    events.forEach(e => window.addEventListener(e, onActivity, { passive: true }));
    const check = setInterval(() => {
      // حین تماس صوتی/تصویری فعال، کاربر «فعال» محسوب می‌شود
      if (activeCallRef.current) { markActivity(); return; }
      if (idleExpired()) {
        logout('به دلیل ۱ ساعت بی‌فعالیتی، به‌طور خودکار از سامانه خارج شدید.');
      }
    }, 20 * 1000);
    return () => {
      events.forEach(e => window.removeEventListener(e, onActivity));
      clearInterval(check);
    };
  }, [user, logout]);

  const hasPerm = (perm) => {
    const perms = user?.permissions || [];
    return perms.includes('*') || perms.includes(perm);
  };

  const socketEmit = (event, data) => socketRef.current?.emit(event, data);

  return (
    <Ctx.Provider value={{
      user, booted, users, departments, settings, onlineIds, notifications, unreadNotifs, toasts,
      incomingCall, setIncomingCall, activeCall, setActiveCall,
      theme, setTheme, toggleTheme,
      cartableCount, taskCount, taskCommentCount, setCartableCount, setTaskCount, refreshBadges,
      login, logout, hasPerm, toast, refreshDirectory, refreshNotifs, refreshSettings, reloadUser,
      setNotifications, setUnreadNotifs, on, socketEmit,
      requestNotifPermission, playSystemSound, showOSNotification,
      notifEnabled, setNotifEnabled,
      socket: () => socketRef.current,
    }}>
      {children}
    </Ctx.Provider>
  );
}
