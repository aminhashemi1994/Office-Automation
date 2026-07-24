import React, { useState, useRef, useEffect } from 'react';
import { X, Search, ChevronDown, Check } from 'lucide-react';
import { useStore } from '../store.jsx';
import { initials } from '../utils.js';

export function Avatar({ name, color = '#4f46e5', size = 38, showStatus, userId, avatar }) {
  const { onlineIds } = useStore() || {};
  const online = showStatus && onlineIds?.has(userId);
  const src = avatar ? `/avatars/${avatar}` : '';
  return (
    <div className="avatar" style={{ width: size, height: size, background: color, fontSize: size * 0.36 }}>
      {src
        ? <img src={src} alt={name} style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }} />
        : initials(name)}
      {showStatus && <span className={`status ${online ? 'on' : ''}`} />}
    </div>
  );
}

export function Modal({ title, onClose, children, footer, wide }) {
  return (
    <div className="modal-backdrop" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="icon-btn" style={{ width: 34, height: 34 }} onClick={onClose}><X size={17} /></button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Field({ label, children, hint }) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
      {hint && <div style={{ fontSize: 11.5, color: 'var(--text-3)', marginTop: 4, lineHeight: 1.6 }}>{hint}</div>}
    </div>
  );
}

// انتخابگر کاربر به‌صورت «دراپ‌داونِ قابل‌جستجو» — هم تک‌انتخابی و هم چندانتخابی.
// همه‌جای سامانه از همین استفاده می‌کند تا انتخاب کاربر یکدست و با جستجو باشد.
export function UserPicker({ value, onChange, exclude = [], multi = false, users: usersProp, placeholder }) {
  const { users } = useStore();
  const list = (usersProp || users).filter(u => u.is_active && !exclude.includes(u.id));
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const boxRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    setTimeout(() => inputRef.current?.focus(), 30);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const norm = (s) => String(s || '').toLowerCase();
  const filtered = list.filter(u => !q
    || norm(u.full_name).includes(norm(q))
    || norm(u.username).includes(norm(q))
    || norm(u.department_name).includes(norm(q))
    || norm(u.position).includes(norm(q)));

  const selectedIds = multi ? (Array.isArray(value) ? value : []) : (value != null ? [value] : []);
  const byId = (id) => list.find(u => u.id === id);
  const toggle = (id) => {
    if (multi) {
      const has = selectedIds.includes(id);
      onChange(has ? selectedIds.filter(x => x !== id) : [...selectedIds, id]);
    } else {
      onChange(id); setOpen(false); setQ('');
    }
  };

  const label = multi
    ? (selectedIds.length ? `${selectedIds.length.toLocaleString('fa-IR')} کاربر انتخاب شد` : (placeholder || 'انتخاب کاربران…'))
    : (byId(value)?.full_name || (placeholder || 'انتخاب کاربر…'));

  return (
    <div className="userpicker" ref={boxRef} style={{ position: 'relative' }}>
      <button type="button" className="input" onClick={() => setOpen(o => !o)}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, cursor: 'pointer', textAlign: 'right', width: '100%' }}>
        <span style={{ color: (multi ? selectedIds.length : value != null) ? 'inherit' : 'var(--text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
        <ChevronDown size={16} style={{ flexShrink: 0, color: 'var(--text-3)' }} />
      </button>

      {/* چیپ‌های انتخاب‌شده در حالت چندانتخابی */}
      {multi && selectedIds.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
          {selectedIds.map(id => (
            <span key={id} className="chip" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: 'var(--primary-soft)', color: 'var(--primary)', borderRadius: 999, padding: '3px 9px', fontSize: 12.5 }}>
              {byId(id)?.full_name || '—'}
              <X size={12} style={{ cursor: 'pointer' }} onClick={() => toggle(id)} />
            </span>
          ))}
        </div>
      )}

      {open && (
        <div className="userpicker-pop" style={{
          position: 'absolute', zIndex: 50, top: 'calc(100% + 4px)', left: 0, right: 0,
          background: 'var(--surface, #fff)', border: '1px solid var(--border)', borderRadius: 10,
          boxShadow: '0 12px 32px rgba(0,0,0,.18)', overflow: 'hidden',
        }}>
          <div style={{ position: 'relative', padding: 8, borderBottom: '1px solid var(--border-soft)' }}>
            <Search size={14} style={{ position: 'absolute', right: 18, top: 17, color: 'var(--text-3)' }} />
            <input ref={inputRef} className="input" value={q} onChange={e => setQ(e.target.value)}
              placeholder="جستجوی نام، واحد یا سمت…" style={{ paddingRight: 32 }} />
          </div>
          <div className="userpicker-list" style={{ maxHeight: 'min(420px, 60vh)', overflowY: 'auto' }}>
            {filtered.length > 0 && (
              <div style={{ padding: '6px 12px', fontSize: 11.5, color: 'var(--text-3)', background: 'var(--surface)', position: 'sticky', top: 0, borderBottom: '1px solid var(--border-soft)' }}>
                {filtered.length.toLocaleString('fa-IR')} کاربر{filtered.length > 6 ? ' — برای دیدن بقیه اسکرول کنید' : ''}
              </div>
            )}
            {!multi && (
              <button type="button" className="userpicker-item" onClick={() => { onChange(null); setOpen(false); }}
                style={{ display: 'block', width: '100%', textAlign: 'right', padding: '9px 12px', background: 'none', border: 'none', color: 'var(--text-3)', cursor: 'pointer', fontSize: 13 }}>
                — بدون انتخاب —
              </button>
            )}
            {filtered.length === 0 && <div style={{ padding: '12px', color: 'var(--text-3)', fontSize: 12.5 }}>کاربری یافت نشد</div>}
            {filtered.map(u => {
              const on = selectedIds.includes(u.id);
              return (
                <button key={u.id} type="button" className="userpicker-item" onClick={() => toggle(u.id)}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'right',
                    padding: '8px 12px', background: on ? 'var(--primary-soft)' : 'none', border: 'none', cursor: 'pointer' }}>
                  <Avatar name={u.full_name} color={u.avatar_color} size={26} avatar={u.avatar_path} />
                  <span style={{ flex: 1, fontSize: 13 }}>
                    {u.full_name}
                    {u.department_name ? <span style={{ color: 'var(--text-3)', fontSize: 11.5 }}> · {u.department_name}</span> : null}
                  </span>
                  {on && <Check size={15} style={{ color: 'var(--primary)' }} />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// انتخابگر کاربرِ «درجا» (inline) — بدون دراپ‌داون. یک کادر جستجو + فهرست همیشه‌باز
// با آواتار و وضعیت آنلاین. برای شروع گفتگو/افزودن عضو مناسب است (UX بهتر از دراپ‌داون).
// تک‌انتخابی: کلیک روی کاربر انتخابش می‌کند (و اگر onPick بدهی، بلافاصله اقدام می‌کند).
// چندانتخابی: چیپ‌های انتخاب‌شده بالای فهرست + تیکِ کنارِ هر ردیف.
export function UserListPicker({ value, onChange, exclude = [], multi = false, users: usersProp, onPick, height = 'min(52vh, 440px)', autoFocus = true }) {
  const { users, onlineIds } = useStore();
  const list = (usersProp || users).filter(u => u.is_active && !exclude.includes(u.id));
  const [q, setQ] = useState('');
  const inputRef = useRef(null);

  useEffect(() => { if (autoFocus) setTimeout(() => inputRef.current?.focus(), 40); }, [autoFocus]);

  const norm = (s) => String(s || '').toLowerCase();
  const nq = norm(q);
  const filtered = list.filter(u => !nq
    || norm(u.full_name).includes(nq)
    || norm(u.username).includes(nq)
    || norm(u.department_name).includes(nq)
    || norm(u.position).includes(nq));
  // آنلاین‌ها اول، سپس بر اساس نام
  const sorted = [...filtered].sort((a, b) => {
    const oa = onlineIds?.has(a.id) ? 0 : 1, ob = onlineIds?.has(b.id) ? 0 : 1;
    return oa !== ob ? oa - ob : String(a.full_name).localeCompare(String(b.full_name), 'fa');
  });

  const selectedIds = multi ? (Array.isArray(value) ? value : []) : (value != null ? [value] : []);
  const byId = (id) => list.find(u => u.id === id);
  const pick = (id) => {
    if (multi) {
      const has = selectedIds.includes(id);
      onChange(has ? selectedIds.filter(x => x !== id) : [...selectedIds, id]);
    } else {
      onChange(id);
      onPick?.(id);
    }
  };

  return (
    <div className="userlist-picker">
      {/* چیپ‌های انتخاب‌شده (چندانتخابی) */}
      {multi && selectedIds.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
          {selectedIds.map(id => (
            <span key={id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'var(--primary-soft)', color: 'var(--primary)', borderRadius: 999, padding: '4px 6px 4px 10px', fontSize: 12.5, fontWeight: 600 }}>
              <Avatar name={byId(id)?.full_name} color={byId(id)?.avatar_color} size={20} avatar={byId(id)?.avatar_path} />
              {byId(id)?.full_name || '—'}
              <X size={13} style={{ cursor: 'pointer' }} onClick={() => pick(id)} />
            </span>
          ))}
        </div>
      )}

      {/* کادر جستجو */}
      <div style={{ position: 'relative', marginBottom: 10 }}>
        <Search size={17} style={{ position: 'absolute', right: 13, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-3)' }} />
        <input ref={inputRef} className="input" value={q} onChange={e => setQ(e.target.value)}
          placeholder="جستجوی نام، واحد یا سمت…" style={{ paddingRight: 40, height: 46, fontSize: 14 }} />
        {q && (
          <button type="button" onClick={() => setQ('')}
            style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)', display: 'flex' }}>
            <X size={16} />
          </button>
        )}
      </div>

      {/* فهرست کاربران */}
      <div className="userlist-scroll" style={{ height, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 12, background: 'var(--surface)' }}>
        {sorted.length === 0 && (
          <div style={{ padding: '32px 12px', textAlign: 'center', color: 'var(--text-3)', fontSize: 13 }}>
            کاربری با این مشخصات پیدا نشد
          </div>
        )}
        {sorted.map(u => {
          const on = selectedIds.includes(u.id);
          const online = onlineIds?.has(u.id);
          return (
            <button key={u.id} type="button" onClick={() => pick(u.id)}
              style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'right',
                padding: '10px 14px', background: on ? 'var(--primary-soft)' : 'transparent', border: 'none',
                borderBottom: '1px solid var(--border-soft)', cursor: 'pointer' }}>
              <Avatar name={u.full_name} color={u.avatar_color} size={40} avatar={u.avatar_path} showStatus userId={u.id} />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 14, fontWeight: 600, color: on ? 'var(--primary)' : 'var(--text-1)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {u.full_name}
                </span>
                <span style={{ display: 'block', fontSize: 12, color: 'var(--text-3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {[u.department_name, u.position].filter(Boolean).join(' · ') || (online ? 'آنلاین' : 'آفلاین')}
                </span>
              </span>
              <span style={{ flexShrink: 0, width: 24, height: 24, borderRadius: '50%',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                border: on ? 'none' : '1.5px solid var(--border)', background: on ? 'var(--primary)' : 'transparent' }}>
                {on && <Check size={15} style={{ color: '#fff' }} />}
              </span>
            </button>
          );
        })}
      </div>
      {multi && (
        <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-3)' }}>
          {selectedIds.length > 0 ? `${selectedIds.length.toLocaleString('fa-IR')} نفر انتخاب شده` : 'برای انتخاب روی افراد بزنید'}
        </div>
      )}
    </div>
  );
}

export function Toasts() {
  const { toasts } = useStore();
  return (
    <div className="toast-wrap">
      {toasts.map(t => <div key={t.id} className={`toast ${t.type}`}>{t.text}</div>)}
    </div>
  );
}

// کنترل دوحالته/چندحالته: همه گزینه‌ها همیشه دیده می‌شوند و گزینهٔ فعال هایلایت می‌شود.
// options: [{ value, label, tone?: 'primary'|'success'|'danger', hint? }]
export function Segmented({ value, onChange, options, size = 'md' }) {
  return (
    <div className={`segmented ${size === 'sm' ? 'segmented-sm' : ''}`} role="group">
      {options.map(opt => {
        const active = value === opt.value;
        return (
          <button
            key={String(opt.value)}
            type="button"
            className={`seg-item ${active ? 'active' : ''} ${active && opt.tone ? 'tone-' + opt.tone : ''}`}
            title={opt.hint || ''}
            aria-pressed={active}
            onClick={() => onChange(opt.value)}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
