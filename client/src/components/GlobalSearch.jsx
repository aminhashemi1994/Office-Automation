import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, MessageSquare, Inbox, ListTodo, User, Building2, FileText, Handshake, Gavel } from 'lucide-react';
import { api, fileUrl } from '../api.js';
import { useStore } from '../store.jsx';
import { fmtRelative, fmtSize } from '../utils.js';
import { Avatar } from './common.jsx';

const GROUPS = [
  ['requests', 'درخواست‌های کارتابل', Inbox],
  ['tasks', 'تسک‌ها', ListTodo],
  ['messages', 'پیام‌ها', MessageSquare],
  ['customers', 'مشتریان', Handshake],
  ['tenders', 'مناقصات', Gavel],
  ['users', 'کاربران', User],
  ['files', 'فایل‌ها', FileText],
  ['departments', 'واحدها', Building2],
];

// وضعیت‌های مناقصه — همان برچسب‌های صفحهٔ مناقصات
const TENDER_FA = {
  identified: 'شناسایی‌شده', reviewing: 'در حال بررسی', docs: 'اسناد دریافت شد',
  preparing: 'آماده‌سازی', submitted: 'ارسال شد', opened: 'بازگشایی شد',
  won: 'برنده', lost: 'بازنده', cancelled: 'لغو شده', withdrawn: 'انصراف',
};

export default function GlobalSearch() {
  const { user, toast } = useStore();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef(null);
  const boxRef = useRef(null);
  const navigate = useNavigate();

  // میانبر Ctrl+K / Cmd+K
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // بستن با کلیک بیرون
  useEffect(() => {
    const onClick = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, []);

  // جستجو با تاخیر
  useEffect(() => {
    if (q.trim().length < 2) { setResults(null); return; }
    setBusy(true);
    const t = setTimeout(async () => {
      try { setResults(await api(`/search?q=${encodeURIComponent(q.trim())}`)); }
      catch {}
      setBusy(false);
    }, 280);
    return () => clearTimeout(t);
  }, [q]);

  const go = (fn) => { setOpen(false); setQ(''); fn(); };

  const openUserChat = async (u) => {
    if (u.id === user.id) return navigate('/profile');
    try {
      const r = await api('/chat/conversations', { method: 'POST', body: { type: 'dm', member_ids: [u.id] } });
      navigate(`/chat?c=${r.conversation.id}`);
    } catch (e) { toast(e.message, 'error'); }
  };

  const total = results ? GROUPS.reduce((n, [k]) => n + (results[k]?.length || 0), 0) : 0;

  const renderItem = (group, item) => {
    switch (group) {
      case 'requests':
        return (
          <div key={`r${item.id}`} className="notif-item" onClick={() => go(() => navigate(`/cartable/${item.id}`))}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 13.3 }}>{item.title}</div>
              <div style={{ fontSize: 12, color: 'var(--text-2)' }}>{item.template_name} · {item.requester_name}</div>
            </div>
            <span style={{ fontSize: 11, color: 'var(--text-3)' }}>{fmtRelative(item.created_at)}</span>
          </div>
        );
      case 'tasks':
        return (
          <div key={`t${item.id}`} className="notif-item" onClick={() => go(() => navigate('/tasks'))}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 13.3 }}>{item.title}</div>
              <div style={{ fontSize: 12, color: 'var(--text-2)' }}>مسئول: {item.assignee_name} · از: {item.assigner_name}</div>
            </div>
          </div>
        );
      case 'messages':
        return (
          <div key={`m${item.id}`} className="notif-item" onClick={() => go(() => navigate(`/chat?c=${item.conversation_id}`))}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12.8 }}>{item.content.slice(0, 90)}</div>
              <div style={{ fontSize: 11.5, color: 'var(--text-2)' }}>
                {item.sender_name}{item.conv_type === 'group' ? ` در ${item.conv_name}` : ''} · {fmtRelative(item.created_at)}
              </div>
            </div>
          </div>
        );
      case 'users':
        return (
          <div key={`u${item.id}`} className="notif-item" onClick={() => go(() => openUserChat(item))}>
            <Avatar name={item.full_name} color={item.avatar_color} size={32} avatar={item.avatar_path} />
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 13.3 }}>{item.full_name}</div>
              <div style={{ fontSize: 11.8, color: 'var(--text-2)' }}>{item.position || '—'} · {item.department_name || 'بدون واحد'}</div>
            </div>
          </div>
        );
      case 'files':
        return (
          <a key={`f${item.id}`} className="notif-item" href={fileUrl(item.id)} download onClick={() => setOpen(false)} style={{ display: 'flex' }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 13 }}>{item.original_name}</div>
              <div style={{ fontSize: 11.5, color: 'var(--text-2)' }}>{fmtSize(item.size)}{item.uploader_name ? ` · ${item.uploader_name}` : ''}</div>
            </div>
          </a>
        );
      case 'customers':
        return (
          <div key={`c${item.id}`} className="notif-item" onClick={() => go(() => navigate('/crm'))}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 13.3 }}>{item.name}</div>
              <div style={{ fontSize: 12, color: 'var(--text-2)' }}>
                {[item.city, item.phone, item.owner_name].filter(Boolean).join(' · ') || 'مشتری'}
              </div>
            </div>
          </div>
        );
      case 'tenders':
        return (
          <div key={`tn${item.id}`} className="notif-item" onClick={() => go(() => navigate('/crm'))}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 13.3 }}>{item.title}</div>
              <div style={{ fontSize: 12, color: 'var(--text-2)' }}>
                {[item.tender_no && `شماره ${item.tender_no}`, item.organization,
                  TENDER_FA[item.status] || item.status].filter(Boolean).join(' · ')}
              </div>
            </div>
          </div>
        );
      case 'departments':
        return (
          <div key={`d${item.id}`} className="notif-item" onClick={() => go(() => navigate('/departments'))}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 13.3 }}>{item.name}</div>
              <div style={{ fontSize: 11.8, color: 'var(--text-2)' }}>سرگروه: {item.manager_name || '—'}</div>
            </div>
          </div>
        );
      default: return null;
    }
  };

  return (
    <div ref={boxRef} className="global-search" style={{ position: 'relative', flex: 1, maxWidth: 440 }}>
      <Search size={16} style={{ position: 'absolute', right: 13, top: 12, color: 'var(--text-3)', pointerEvents: 'none' }} />
      <input
        ref={inputRef}
        className="input"
        style={{ paddingRight: 38, borderRadius: 12, background: 'var(--bg)' }}
        placeholder="جستجو در همه بخش‌ها…  (Ctrl+K)"
        value={q}
        onChange={e => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
      />
      {open && q.trim().length >= 2 && (
        <div className="notif-panel" style={{ top: 48, left: 0, right: 0, width: 'auto', maxHeight: 480 }}>
          <div style={{ overflowY: 'auto' }}>
            {busy && !results && <div className="empty" style={{ padding: 24 }}>در حال جستجو…</div>}
            {results && total === 0 && <div className="empty" style={{ padding: 24 }}>نتیجه‌ای برای «{q}» یافت نشد</div>}
            {results && GROUPS.map(([key, label, Icon]) => (
              (results[key]?.length || 0) > 0 && (
                <div key={key}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '10px 16px 4px', fontSize: 11.5, fontWeight: 700, color: 'var(--text-3)' }}>
                    <Icon size={13} /> {label}
                  </div>
                  {results[key].map(item => renderItem(key, item))}
                </div>
              )
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
