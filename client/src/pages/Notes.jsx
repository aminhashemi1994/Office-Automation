import React, { useEffect, useState } from 'react';
import { Plus, Pin, PinOff, Trash2, Bell, BellOff, Check, X, StickyNote, Clock, Share2, Users2, Eye, Pencil, ChevronRight, ChevronLeft } from 'lucide-react';
import { api } from '../api.js';
import { useStore } from '../store.jsx';
import { fmtDateTime, fa } from '../utils.js';
import { Modal, Field, Avatar } from '../components/common.jsx';
import { JalaliDatePicker } from '../components/JalaliDatePicker.jsx';
import { TimePicker } from '../components/TimePicker.jsx';
import { toJalaali, toGregorian, formatJalali, parseJalali } from '../jalali.js';

function isoToParts(iso) {
  if (!iso) return { date: '', time: '' };
  const d = new Date(iso);
  const j = toJalaali(d.getFullYear(), d.getMonth() + 1, d.getDate());
  return { date: formatJalali(j.jy, j.jm, j.jd), time: `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` };
}
function partsToIso(date, time) {
  if (!date) return null;
  const p = parseJalali(date);
  if (!p) return null;
  const g = toGregorian(p.jy, p.jm, p.jd);
  const [h, m] = (time && /^\d{1,2}:\d{1,2}$/.test(time)) ? time.split(':').map(Number) : [9, 0];
  return new Date(g.gy, g.gm - 1, g.gd, h, m, 0, 0).toISOString();
}

const COLORS = ['#fde68a', '#fca5a5', '#a7f3d0', '#bfdbfe', '#ddd6fe', '#fbcfe8', '#e5e7eb'];

function NoteEditor({ note, onClose, onSaved }) {
  const { toast } = useStore();
  const rp = isoToParts(note?.remind_at);
  const [title, setTitle] = useState(note?.title || '');
  const [body, setBody] = useState(note?.body || '');
  const [color, setColor] = useState(note?.color || COLORS[0]);
  const [remind, setRemind] = useState(!!note?.remind_at);
  const [rDate, setRDate] = useState(rp.date);
  const [rTime, setRTime] = useState(rp.time || '09:00');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!title.trim() && !body.trim()) return toast('عنوان یا متن یادداشت را وارد کنید', 'error');
    setBusy(true);
    const payload = { title, text: body, color, remind_at: remind ? partsToIso(rDate, rTime) : null };
    try {
      if (note?.id) await api(`/notes/${note.id}`, { method: 'PUT', body: payload });
      else await api('/notes', { method: 'POST', body: payload });
      onSaved();
      onClose();
    } catch (e) { toast(e.message, 'error'); }
    setBusy(false);
  };

  return (
    <Modal title={note?.id ? 'ویرایش یادداشت' : 'یادداشت جدید'} onClose={onClose}
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>انصراف</button>
        <button className="btn btn-primary" disabled={busy} onClick={save}><Check size={16} /> ذخیره</button>
      </>}>
      <Field label="عنوان">
        <input className="input" value={title} autoFocus onChange={e => setTitle(e.target.value)} placeholder="عنوان یادداشت…" />
      </Field>
      <Field label="متن">
        <textarea className="input" rows={5} value={body} onChange={e => setBody(e.target.value)} placeholder="چیزی که می‌خواهید به‌خاطر بسپارید…" />
      </Field>
      <Field label="رنگ برچسب">
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {COLORS.map(c => (
            <button key={c} type="button" onClick={() => setColor(c)}
              style={{ width: 28, height: 28, borderRadius: '50%', background: c, cursor: 'pointer',
                border: color === c ? '3px solid var(--primary)' : '1px solid var(--border)' }} />
          ))}
        </div>
      </Field>
      <Field label="یادآوری">
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13.5 }}>
          <input type="checkbox" checked={remind} onChange={e => setRemind(e.target.checked)} style={{ accentColor: 'var(--primary)' }} />
          در زمان مشخص به من یادآوری کن
        </label>
      </Field>
      {remind && (
        <div style={{ display: 'flex', gap: 10 }}>
          <div style={{ flex: 1 }}><JalaliDatePicker value={rDate} onChange={setRDate} placeholder="تاریخ یادآوری" /></div>
          <div style={{ width: 120 }}><TimePicker value={rTime} onChange={setRTime} variant="input" /></div>
        </div>
      )}
    </Modal>
  );
}


// ---------------------------------------------------------------------------
// اشتراک یادداشت با همکاران — یا فقط برای خواندن، یا با اجازهٔ ویرایش.
// گیرنده هر وقت بخواهد می‌تواند اشتراک را از سمت خودش بردارد.
// ---------------------------------------------------------------------------
function ShareModal({ note, onClose, onSaved }) {
  const { user, users, toast } = useStore();
  const [shares, setShares] = useState([]);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api(`/notes/${note.id}/shares`).then(r => setShares(r.shares)).catch(() => {});
  }, [note.id]);

  const has = (id) => shares.some(s => s.user_id === id);
  const toggle = (u) => setShares(list => has(u.id)
    ? list.filter(s => s.user_id !== u.id)
    : [...list, { user_id: u.id, full_name: u.full_name, avatar_color: u.avatar_color, can_edit: 0 }]);
  const setEdit = (id, v) => setShares(list => list.map(s => s.user_id === id ? { ...s, can_edit: v ? 1 : 0 } : s));

  const save = async () => {
    setBusy(true);
    try {
      await api(`/notes/${note.id}/shares`, { method: 'POST',
        body: { shares: shares.map(s => ({ user_id: s.user_id, can_edit: s.can_edit })) } });
      onSaved(); onClose();
      toast(shares.length ? `یادداشت با ${fa(shares.length)} همکار به اشتراک گذاشته شد` : 'اشتراک‌ها برداشته شد');
    } catch (e) { toast(e.message, 'error'); }
    setBusy(false);
  };

  const nq = q.trim().toLowerCase();
  const candidates = users.filter(u => u.is_active && u.id !== user.id)
    .filter(u => !nq || String(u.full_name).toLowerCase().includes(nq)
      || String(u.department_name || '').toLowerCase().includes(nq));

  return (
    <Modal title={`اشتراک یادداشت «${note.title || 'بدون عنوان'}»`} onClose={onClose}
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>انصراف</button>
        <button className="btn btn-primary" disabled={busy} onClick={save}><Check size={16} /> ذخیره</button>
      </>}>
      {shares.length > 0 && (
        <Field label="با این همکاران به اشتراک گذاشته شده">
          <div style={{ display: 'grid', gap: 6 }}>
            {shares.map(s => (
              <div key={s.user_id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 9px', borderRadius: 9, background: 'var(--bg-2)' }}>
                <Avatar name={s.full_name} color={s.avatar_color} size={26} />
                <span style={{ flex: 1, fontSize: 13 }}>{s.full_name}</span>
                <button className={`btn btn-sm ${s.can_edit ? 'btn-primary' : 'btn-ghost'}`}
                  onClick={() => setEdit(s.user_id, !s.can_edit)}
                  title={s.can_edit ? 'می‌تواند ویرایش کند' : 'فقط می‌تواند بخواند'}>
                  {s.can_edit ? <><Pencil size={13} /> ویرایش</> : <><Eye size={13} /> فقط خواندن</>}
                </button>
                <button className="icon-btn" style={{ color: 'var(--red)' }}
                  onClick={() => setShares(list => list.filter(x => x.user_id !== s.user_id))}><X size={15} /></button>
              </div>
            ))}
          </div>
        </Field>
      )}
      <Field label="افزودن همکار">
        <input className="input" placeholder="جستجوی نام یا واحد…" value={q} onChange={e => setQ(e.target.value)} />
        <div style={{ maxHeight: 240, overflowY: 'auto', marginTop: 8, display: 'grid', gap: 4 }}>
          {candidates.map(u => (
            <button key={u.id} className="support-history" style={{ opacity: has(u.id) ? .5 : 1 }}
              onClick={() => toggle(u)} disabled={has(u.id)}>
              <Avatar name={u.full_name} color={u.avatar_color} size={24} avatar={u.avatar_path} />
              <span style={{ flex: 1, textAlign: 'right' }}>{u.full_name}</span>
              <small style={{ color: 'var(--text-3)' }}>{u.department_name || ''}</small>
              {has(u.id) ? <Check size={14} style={{ color: 'var(--green)' }} /> : <Plus size={14} />}
            </button>
          ))}
          {candidates.length === 0 && <div style={{ fontSize: 12.5, color: 'var(--text-3)' }}>همکاری پیدا نشد</div>}
        </div>
      </Field>
    </Modal>
  );
}

export default function Notes() {
  const { on, toast } = useStore();
  const [notes, setNotes] = useState([]);
  const [editing, setEditing] = useState(null); // note object or {} for new
  const [sharing, setSharing] = useState(null);
  const [tab, setTab] = useState('mine');       // mine | shared

  const load = async () => { try { const r = await api('/notes'); setNotes(r.notes); } catch {} };
  useEffect(() => { load(); return on('notification', load); }, []);

  const patch = async (n, body) => {
    try { await api(`/notes/${n.id}`, { method: 'PUT', body }); load(); }
    catch (e) { toast(e.message, 'error'); }
  };
  const remove = async (n) => {
    const msg = n.is_owner
      ? (n.share_count ? `این یادداشت با ${fa(n.share_count)} نفر به اشتراک گذاشته شده. حذف شود؟` : 'این یادداشت حذف شود؟')
      : 'این یادداشت از فهرست شما برداشته شود؟ (برای سازنده باقی می‌ماند)';
    if (!window.confirm(msg)) return;
    try { await api(`/notes/${n.id}`, { method: 'DELETE' }); load(); }
    catch (e) { toast(e.message, 'error'); }
  };
  // جابه‌جایی ترتیبِ یادداشت‌های خودم
  const move = async (list, idx, dir) => {
    const next = [...list];
    const j = idx + dir;
    if (j < 0 || j >= next.length) return;
    [next[idx], next[j]] = [next[j], next[idx]];
    setNotes(n => [...next, ...n.filter(x => !next.some(y => y.id === x.id))]);
    try { await api('/notes/reorder', { method: 'POST', body: { ids: next.map(n => n.id) } }); load(); }
    catch (e) { toast(e.message, 'error'); }
  };

  const own = notes.filter(n => n.is_owner);
  const shared = notes.filter(n => !n.is_owner);
  const visible = tab === 'shared' ? shared : own;

  const remindLabel = (n) => {
    if (!n.remind_at) return null;
    const overdue = new Date(n.remind_at).getTime() < Date.now();
    return { text: fmtDateTime(n.remind_at), tone: n.reminded ? 'gray' : (overdue ? 'red' : 'amber') };
  };

  return (
    <div className="content">
      <div className="page-head" style={{ flexWrap: 'wrap', gap: 10 }}>
        <div className="tabs">
          <button className={`tab ${tab === 'mine' ? 'active' : ''}`} onClick={() => setTab('mine')}>
            یادداشت‌های من {own.length > 0 && <span className="badge-count">{fa(own.length)}</span>}
          </button>
          <button className={`tab ${tab === 'shared' ? 'active' : ''}`} onClick={() => setTab('shared')}>
            <Users2 size={14} style={{ marginInlineEnd: 5, verticalAlign: '-2px' }} />
            مشترک با من {shared.length > 0 && <span className="badge-count">{fa(shared.length)}</span>}
          </button>
        </div>
        <button className="btn btn-primary" onClick={() => setEditing({})}><Plus size={16} /> یادداشت جدید</button>
      </div>

      {visible.length === 0 && (
        <div className="empty" style={{ padding: '48px 20px' }}>
          <StickyNote size={40} style={{ color: 'var(--text-3)', marginBottom: 10 }} />
          <div>{tab === 'shared'
            ? 'همکاری هنوز یادداشتی با شما به اشتراک نگذاشته است'
            : 'هنوز یادداشتی ندارید. اولین یادداشت خود را بسازید 📝'}</div>
        </div>
      )}

      <div className="notes-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 14 }}>
        {visible.map((n, idx) => {
          const rl = remindLabel(n);
          const readOnly = !n.can_edit;
          return (
            <div key={n.id} className="card" style={{
              borderTop: `5px solid ${n.color}`, padding: 14, display: 'flex', flexDirection: 'column', gap: 8,
              opacity: n.done ? 0.6 : 1,
            }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  {n.title && <div style={{ fontWeight: 700, fontSize: 14, textDecoration: n.done ? 'line-through' : 'none' }}>{n.title}</div>}
                  {!n.is_owner && (
                    <small style={{ color: 'var(--text-3)', fontSize: 11.3 }}>
                      از {n.owner_name} · {n.can_edit ? 'با اجازهٔ ویرایش' : 'فقط خواندن'}
                    </small>
                  )}
                  {n.is_owner && n.share_count > 0 && (
                    <small style={{ color: 'var(--text-3)', fontSize: 11.3 }}>
                      <Users2 size={11} style={{ verticalAlign: '-2px' }} /> مشترک با {fa(n.share_count)} نفر
                    </small>
                  )}
                </div>
                {n.pinned ? <Pin size={15} style={{ color: 'var(--amber)', flexShrink: 0 }} /> : null}
              </div>
              {n.body && <div style={{ fontSize: 13, color: 'var(--text-2)', whiteSpace: 'pre-wrap', lineHeight: 1.7, textDecoration: n.done ? 'line-through' : 'none' }}>{n.body}</div>}
              {rl && (
                <span className={`badge badge-${rl.tone}`} style={{ alignSelf: 'flex-start' }}>
                  <Clock size={11} /> {rl.text}{n.reminded ? ' (یادآوری شد)' : ''}
                </span>
              )}
              <div style={{ display: 'flex', gap: 4, marginTop: 'auto', paddingTop: 6, borderTop: '1px solid var(--border-soft)' }}>
                <button className="icon-btn" style={{ width: 30, height: 30 }} title={n.done ? 'برگرداندن' : 'انجام شد'}
                  disabled={readOnly} onClick={() => patch(n, { done: n.done ? 0 : 1 })}>
                  <Check size={14} style={{ color: n.done ? 'var(--green)' : 'var(--text-3)' }} />
                </button>
                <button className="icon-btn" style={{ width: 30, height: 30 }} title={n.pinned ? 'برداشتن سنجاق' : 'سنجاق‌کردن'}
                  disabled={readOnly} onClick={() => patch(n, { pinned: n.pinned ? 0 : 1 })}>
                  {n.pinned ? <PinOff size={14} /> : <Pin size={14} />}
                </button>
                <button className="icon-btn" style={{ width: 30, height: 30 }} title={readOnly ? 'فقط خواندن' : 'ویرایش'}
                  disabled={readOnly} onClick={() => setEditing(n)}>
                  <StickyNote size={14} />
                </button>
                {n.is_owner && <>
                  <button className="icon-btn" style={{ width: 30, height: 30 }} title="اشتراک با همکاران"
                    onClick={() => setSharing(n)}>
                    <Share2 size={14} style={{ color: n.share_count ? 'var(--primary)' : undefined }} />
                  </button>
                  {tab === 'mine' && <>
                    <button className="icon-btn" style={{ width: 30, height: 30 }} title="جابه‌جایی به راست"
                      onClick={() => move(visible, idx, -1)}><ChevronRight size={14} /></button>
                    <button className="icon-btn" style={{ width: 30, height: 30 }} title="جابه‌جایی به چپ"
                      onClick={() => move(visible, idx, 1)}><ChevronLeft size={14} /></button>
                  </>}
                </>}
                <button className="icon-btn" style={{ width: 30, height: 30, marginInlineStart: 'auto' }}
                  title={n.is_owner ? 'حذف' : 'برداشتن از فهرست من'} onClick={() => remove(n)}>
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {editing && <NoteEditor note={editing.id ? editing : null} onClose={() => setEditing(null)} onSaved={load} />}
      {sharing && <ShareModal note={sharing} onClose={() => setSharing(null)} onSaved={load} />}
    </div>
  );
}
