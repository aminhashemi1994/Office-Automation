import React, { useEffect, useState } from 'react';
import { Plus, Pin, PinOff, Trash2, Bell, BellOff, Check, X, StickyNote, Clock } from 'lucide-react';
import { api } from '../api.js';
import { useStore } from '../store.jsx';
import { fmtDateTime, fa } from '../utils.js';
import { Modal, Field } from '../components/common.jsx';
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

export default function Notes() {
  const { on } = useStore();
  const [notes, setNotes] = useState([]);
  const [editing, setEditing] = useState(null); // note object or {} for new

  const load = async () => { try { const r = await api('/notes'); setNotes(r.notes); } catch {} };
  useEffect(() => { load(); return on('notification', load); }, []);

  const patch = async (n, body) => { try { await api(`/notes/${n.id}`, { method: 'PUT', body }); load(); } catch {} };
  const remove = async (n) => { if (!window.confirm('این یادداشت حذف شود؟')) return; try { await api(`/notes/${n.id}`, { method: 'DELETE' }); load(); } catch {} };

  const remindLabel = (n) => {
    if (!n.remind_at) return null;
    const overdue = new Date(n.remind_at).getTime() < Date.now();
    return { text: fmtDateTime(n.remind_at), tone: n.reminded ? 'gray' : (overdue ? 'red' : 'amber') };
  };

  return (
    <div className="content">
      <div className="page-head">
        <h2>یادداشت‌ها و یادآوری‌ها</h2>
        <button className="btn btn-primary" onClick={() => setEditing({})}><Plus size={16} /> یادداشت جدید</button>
      </div>

      {notes.length === 0 && (
        <div className="empty" style={{ padding: '48px 20px' }}>
          <StickyNote size={40} style={{ color: 'var(--text-3)', marginBottom: 10 }} />
          <div>هنوز یادداشتی ندارید. اولین یادداشت خود را بسازید 📝</div>
        </div>
      )}

      <div className="notes-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 14 }}>
        {notes.map(n => {
          const rl = remindLabel(n);
          return (
            <div key={n.id} className="card" style={{
              borderTop: `5px solid ${n.color}`, padding: 14, display: 'flex', flexDirection: 'column', gap: 8,
              opacity: n.done ? 0.6 : 1,
            }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  {n.title && <div style={{ fontWeight: 700, fontSize: 14, textDecoration: n.done ? 'line-through' : 'none' }}>{n.title}</div>}
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
                  onClick={() => patch(n, { done: n.done ? 0 : 1 })}>
                  <Check size={14} style={{ color: n.done ? 'var(--green)' : 'var(--text-3)' }} />
                </button>
                <button className="icon-btn" style={{ width: 30, height: 30 }} title={n.pinned ? 'برداشتن سنجاق' : 'سنجاق‌کردن'}
                  onClick={() => patch(n, { pinned: n.pinned ? 0 : 1 })}>
                  {n.pinned ? <PinOff size={14} /> : <Pin size={14} />}
                </button>
                <button className="icon-btn" style={{ width: 30, height: 30 }} title="ویرایش" onClick={() => setEditing(n)}>
                  <StickyNote size={14} />
                </button>
                <button className="icon-btn" style={{ width: 30, height: 30, marginInlineStart: 'auto' }} title="حذف" onClick={() => remove(n)}>
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {editing && <NoteEditor note={editing.id ? editing : null} onClose={() => setEditing(null)} onSaved={load} />}
    </div>
  );
}
