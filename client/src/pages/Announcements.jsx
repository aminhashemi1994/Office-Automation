// ============================================================================
//  اطلاعیه‌ها
//  مدیریت هر چند روز اطلاعیه می‌زند. تا امروز آن را به‌شکل «فرآیند» ثبت می‌کردند
//  که کارتابل را شلوغ می‌کرد و اعلانش هم به کسی نمی‌رسید. اینجا یک‌طرفه است:
//  منتشر می‌شود، اعلان می‌رود، و معلوم است چه کسی دیده و چه کسی «دریافت شد» زده.
// ============================================================================
import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Megaphone, Plus, Pin, PinOff, Trash2, Pencil, Check, Users2, Bell,
  AlertTriangle, CalendarDays, Eye, X,
} from 'lucide-react';
import { api } from '../api.js';
import { useStore } from '../store.jsx';
import { fa, fmtDateTime, fmtRelative } from '../utils.js';
import { Modal, Field, Segmented, Avatar } from '../components/common.jsx';
import { AttachmentPicker, AttachmentList, toFileIds } from '../components/Attachments.jsx';
import { JalaliDatePicker } from '../components/JalaliDatePicker.jsx';
import { TimePicker } from '../components/TimePicker.jsx';
import { isoToParts, partsToIso } from '../components/TaskModal.jsx';

const KINDS = {
  notice: ['اطلاعیه', 'badge-sky'],
  urgent: ['فوری', 'badge-red'],
  event: ['رویداد', 'badge-amber'],
};

function Editor({ item, onClose, onSaved }) {
  const { toast, departments, users } = useStore();
  const [title, setTitle] = useState(item?.title || '');
  const [body, setBody] = useState(item?.body || '');
  const [kind, setKind] = useState(item?.kind || 'notice');
  const [audience, setAudience] = useState(item?.audience || 'all');
  const [deptIds, setDeptIds] = useState(item?.dept_ids || []);
  const [userIds, setUserIds] = useState(item?.user_ids || []);
  const [attachments, setAttachments] = useState(item?.attachments || []);
  const [pinned, setPinned] = useState(!!item?.pinned);
  const [requireAck, setRequireAck] = useState(!!item?.require_ack);
  const pub = isoToParts(item?.publish_at);
  const exp = isoToParts(item?.expires_at);
  const [pubDate, setPubDate] = useState(pub.date);
  const [pubTime, setPubTime] = useState(pub.time || '08:00');
  const [expDate, setExpDate] = useState(exp.date);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!title.trim()) return toast('عنوان اطلاعیه را بنویسید', 'error');
    if (audience === 'departments' && !deptIds.length) return toast('حداقل یک واحد را انتخاب کنید', 'error');
    if (audience === 'users' && !userIds.length) return toast('حداقل یک نفر را انتخاب کنید', 'error');
    setBusy(true);
    try {
      const b = {
        title, body, kind, audience, dept_ids: deptIds, user_ids: userIds,
        attachments: toFileIds(attachments), pinned: pinned ? 1 : 0, require_ack: requireAck ? 1 : 0,
        publish_at: pubDate ? partsToIso(pubDate, pubTime, 8) : null,
        expires_at: expDate ? partsToIso(expDate, '23:59') : null,
      };
      if (item) await api(`/announcements/${item.id}`, { method: 'PUT', body: b });
      else await api('/announcements', { method: 'POST', body: b });
      onSaved(); onClose();
      toast(item ? 'اطلاعیه به‌روزرسانی شد' : 'اطلاعیه منتشر شد و اعلانش رفت');
    } catch (e) { toast(e.message, 'error'); }
    setBusy(false);
  };

  return (
    <Modal title={item ? 'ویرایش اطلاعیه' : 'اطلاعیهٔ جدید'} onClose={onClose} wide
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>انصراف</button>
        <button className="btn btn-primary" disabled={busy || !title.trim()} onClick={save}>
          {item ? 'ذخیره' : 'انتشار و اعلان'}
        </button>
      </>}>
      <Field label="عنوان">
        <input className="input" value={title} autoFocus onChange={e => setTitle(e.target.value)}
          placeholder="مثلاً: تعطیلی روز پنجشنبه" />
      </Field>
      <Field label="متن اطلاعیه">
        <textarea className="input" style={{ minHeight: 140 }} value={body}
          onChange={e => setBody(e.target.value)} />
      </Field>
      <div className="form-row">
        <Field label="نوع">
          <select className="input" value={kind} onChange={e => setKind(e.target.value)}>
            {Object.entries(KINDS).map(([k, v]) => <option key={k} value={k}>{v[0]}</option>)}
          </select>
        </Field>
        <Field label="مخاطبان">
          <select className="input" value={audience} onChange={e => setAudience(e.target.value)}>
            <option value="all">همهٔ کارکنان</option>
            <option value="departments">واحدهای انتخابی</option>
            <option value="users">افراد انتخابی</option>
          </select>
        </Field>
      </div>

      {audience === 'departments' && (
        <Field label="کدام واحدها؟">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {departments.map(d => {
              const on = deptIds.map(Number).includes(d.id);
              return (
                <button key={d.id} type="button" className={`btn btn-sm ${on ? 'btn-primary' : 'btn-ghost'}`}
                  onClick={() => setDeptIds(on ? deptIds.filter(x => Number(x) !== d.id) : [...deptIds, d.id])}>
                  {d.name}
                </button>
              );
            })}
          </div>
        </Field>
      )}
      {audience === 'users' && (
        <Field label="کدام افراد؟">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
            {userIds.map(id => (
              <span key={id} className="badge badge-sky" style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                {users.find(u => u.id === id)?.full_name || '—'}
                <X size={12} style={{ cursor: 'pointer' }} onClick={() => setUserIds(userIds.filter(x => x !== id))} />
              </span>
            ))}
          </div>
          <select className="input" value="" onChange={e => {
            const id = Number(e.target.value);
            if (id && !userIds.includes(id)) setUserIds([...userIds, id]);
          }}>
            <option value="">+ افزودن…</option>
            {users.filter(u => u.is_active && !userIds.includes(u.id))
              .map(u => <option key={u.id} value={u.id}>{u.full_name}{u.department_name ? ` (${u.department_name})` : ''}</option>)}
          </select>
        </Field>
      )}

      <Field label="پیوست (اختیاری)">
        <AttachmentPicker value={attachments} onChange={setAttachments} placeholder="انتخاب فایل" label="افزودن فایل" thumb={80} />
      </Field>

      <div className="form-row">
        <Field label="زمان انتشار (اختیاری)" hint="خالی = همین حالا">
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ flex: 1 }}><JalaliDatePicker value={pubDate} onChange={setPubDate} placeholder="تاریخ" /></div>
            <div style={{ width: 110 }}><TimePicker value={pubTime} onChange={setPubTime} variant="input" /></div>
          </div>
        </Field>
        <Field label="تاریخ انقضا (اختیاری)" hint="بعد از این تاریخ از فهرست کنار می‌رود">
          <JalaliDatePicker value={expDate} onChange={setExpDate} placeholder="بدون انقضا" />
        </Field>
      </div>

      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginTop: 4 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, cursor: 'pointer' }}>
          <input type="checkbox" checked={pinned} style={{ width: 16, height: 16 }}
            onChange={e => setPinned(e.target.checked)} />
          سنجاق بالای فهرست
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, cursor: 'pointer' }}>
          <input type="checkbox" checked={requireAck} style={{ width: 16, height: 16 }}
            onChange={e => setRequireAck(e.target.checked)} />
          گیرندگان «دریافت شد» بزنند
        </label>
      </div>
    </Modal>
  );
}

function Viewer({ id, onClose, onChanged }) {
  const { toast } = useStore();
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try { setData(await api(`/announcements/${id}`)); }
    catch (e) { toast(e.message, 'error'); onClose(); }
  };
  useEffect(() => { load(); }, [id]);
  if (!data) return null;
  const a = data.announcement;
  const [kLabel, kCls] = KINDS[a.kind] || KINDS.notice;

  const ack = async () => {
    setBusy(true);
    try { await api(`/announcements/${id}/ack`, { method: 'POST' }); await load(); onChanged?.(); toast('دریافت شما ثبت شد'); }
    catch (e) { toast(e.message, 'error'); }
    setBusy(false);
  };
  const renotify = async () => {
    try {
      const r = await api(`/announcements/${id}/renotify`, { method: 'POST' });
      toast(r.notified ? `یادآوری برای ${fa(r.notified)} نفر فرستاده شد` : 'همه دیده‌اند');
    } catch (e) { toast(e.message, 'error'); }
  };

  return (
    <Modal title={a.title} onClose={onClose} wide
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>بستن</button>
        {data.can_manage && <button className="btn btn-ghost" onClick={renotify}><Bell size={15} /> یادآوری به ندیده‌ها</button>}
        {!!a.require_ack && !data.my_acked_at && (
          <button className="btn btn-primary" disabled={busy} onClick={ack}><Check size={16} /> دریافت شد</button>
        )}
      </>}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
        <span className={`badge ${kCls}`}>{kLabel}</span>
        {!!a.pinned && <span className="badge badge-amber"><Pin size={11} /> سنجاق‌شده</span>}
        <span style={{ fontSize: 12.3, color: 'var(--text-3)' }}>
          {a.author_name} · {fmtDateTime(a.created_at)}
        </span>
        {data.my_acked_at && <span className="badge badge-green"><Check size={11} /> دریافت کرده‌اید</span>}
      </div>
      <div style={{ fontSize: 13.5, lineHeight: 2.1, whiteSpace: 'pre-wrap', color: 'var(--text-1)' }}>{a.body}</div>
      {a.attachments?.length > 0 && (
        <div style={{ marginTop: 14 }}><AttachmentList ids={a.attachments} thumb={96} title="پیوست‌ها" /></div>
      )}
      {a.expires_at && (
        <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 10 }}>
          <CalendarDays size={12} style={{ verticalAlign: '-2px' }} /> اعتبار تا {fmtDateTime(a.expires_at)}
        </div>
      )}

      {data.can_manage && (
        <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--border-soft)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <b style={{ fontSize: 13 }}>چه کسانی دیده‌اند؟</b>
            <span className="badge badge-gray">{fa(data.readers.length)} از {fa(data.audience_count || 0)}</span>
            {!!a.require_ack && (
              <span className="badge badge-sky">
                {fa(data.readers.filter(r => r.acked_at).length)} نفر «دریافت شد» زده‌اند
              </span>
            )}
          </div>
          <div style={{ maxHeight: 200, overflowY: 'auto', display: 'grid', gap: 5 }}>
            {data.readers.length === 0 && <span style={{ fontSize: 12.5, color: 'var(--text-3)' }}>هنوز کسی باز نکرده است</span>}
            {data.readers.map(r => (
              <div key={r.user_id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 }}>
                <Eye size={13} style={{ color: 'var(--text-3)' }} />
                <span style={{ flex: 1 }}>{r.full_name}
                  {r.department_name && <span style={{ color: 'var(--text-3)' }}> · {r.department_name}</span>}
                </span>
                <span style={{ color: 'var(--text-3)', fontSize: 11.5 }}>{fmtRelative(r.read_at)}</span>
                {r.acked_at && <span className="badge badge-green"><Check size={10} /> دریافت</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </Modal>
  );
}

export default function Announcements() {
  const { toast, on } = useStore();
  const [data, setData] = useState(null);
  const [tab, setTab] = useState('inbox');   // inbox | mine
  const [editing, setEditing] = useState(null);
  const [viewing, setViewing] = useState(null);
  const [params, setParams] = useSearchParams();

  const load = async () => {
    try { setData(await api(`/announcements${tab === 'mine' ? '?mine=1' : ''}`)); }
    catch (e) { toast(e.message, 'error'); }
  };
  useEffect(() => { load(); }, [tab]);
  useEffect(() => on('notification', load), [tab]);
  useEffect(() => {
    const a = Number(params.get('a'));
    if (a) { setViewing(a); setParams({}, { replace: true }); }
  }, [params]);

  const remove = async (a) => {
    if (!window.confirm(`اطلاعیهٔ «${a.title}» حذف شود؟`)) return;
    try { await api(`/announcements/${a.id}`, { method: 'DELETE' }); load(); toast('حذف شد'); }
    catch (e) { toast(e.message, 'error'); }
  };
  const togglePin = async (a) => {
    try { await api(`/announcements/${a.id}`, { method: 'PUT', body: { pinned: a.pinned ? 0 : 1 } }); load(); }
    catch (e) { toast(e.message, 'error'); }
  };

  if (!data) return <div className="content"><div className="card"><div className="empty">در حال بارگذاری…</div></div></div>;
  const list = data.announcements;

  return (
    <div className="content">
      <div className="page-head" style={{ flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h2>اطلاعیه‌ها</h2>
          <p style={{ fontSize: 12.5, color: 'var(--text-3)', margin: '4px 0 0' }}>
            اطلاعیه‌های سازمانی — جدا از کارتابل، با اعلان برای همه و امکان پیگیریِ اینکه چه کسی دیده است.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {data.can_publish && (
            <div className="tabs" style={{ margin: 0 }}>
              <button className={`tab ${tab === 'inbox' ? 'active' : ''}`} onClick={() => setTab('inbox')}>
                برای من {data.unread > 0 && <span className="badge-count">{fa(data.unread)}</span>}
              </button>
              <button className={`tab ${tab === 'mine' ? 'active' : ''}`} onClick={() => setTab('mine')}>منتشرشدهٔ من</button>
            </div>
          )}
          {data.can_publish && (
            <button className="btn btn-primary" onClick={() => setEditing('new')}><Plus size={17} /> اطلاعیهٔ جدید</button>
          )}
        </div>
      </div>

      {list.length === 0 && (
        <div className="card card-pad" style={{ textAlign: 'center', padding: '44px 20px' }}>
          <Megaphone size={38} style={{ color: 'var(--text-3)', marginBottom: 10 }} />
          <div style={{ fontWeight: 700 }}>{tab === 'mine' ? 'هنوز اطلاعیه‌ای منتشر نکرده‌اید' : 'اطلاعیه‌ای برای شما نیست'}</div>
        </div>
      )}

      <div style={{ display: 'grid', gap: 12 }}>
        {list.map(a => {
          const [kLabel, kCls] = KINDS[a.kind] || KINDS.notice;
          const unread = !a.my_read_at;
          return (
            <div key={a.id} className="card card-pad"
              style={{ cursor: 'pointer', borderInlineStart: `4px solid ${a.kind === 'urgent' ? 'var(--red)' : a.pinned ? 'var(--amber)' : 'var(--border)'}` }}
              onClick={() => setViewing(a.id)}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap', marginBottom: 4 }}>
                    <b style={{ fontSize: 14.5 }}>{a.title}</b>
                    <span className={`badge ${kCls}`}>{kLabel}</span>
                    {!!a.pinned && <Pin size={13} style={{ color: 'var(--amber)' }} />}
                    {unread && <span className="badge badge-primary">تازه</span>}
                    {!!a.require_ack && !a.my_acked_at && <span className="badge badge-amber">منتظر «دریافت شد»</span>}
                    {!!a.my_acked_at && <span className="badge badge-green"><Check size={11} /> دریافت شد</span>}
                  </div>
                  <p style={{ fontSize: 12.8, color: 'var(--text-2)', margin: 0, lineHeight: 1.9,
                    display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                    {a.body}
                  </p>
                  <div style={{ fontSize: 11.5, color: 'var(--text-3)', marginTop: 6, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <span>{a.author_name}</span>
                    <span>· {fmtRelative(a.created_at)}</span>
                    {a.audience !== 'all' && <span>· <Users2 size={11} style={{ verticalAlign: '-1px' }} /> مخاطب محدود</span>}
                    {a.publish_at && <span className="badge badge-gray">زمان‌بندی‌شده برای {fmtDateTime(a.publish_at)}</span>}
                  </div>
                </div>
                {tab === 'mine' && (
                  <div style={{ display: 'flex', gap: 4 }} onClick={e => e.stopPropagation()}>
                    <span className="badge badge-gray" title="دیده‌شده / مخاطب">
                      <Eye size={11} /> {fa(a.read_count)}{a.audience_count !== undefined ? `/${fa(a.audience_count)}` : ''}
                    </span>
                    {!!a.require_ack && <span className="badge badge-sky"><Check size={11} /> {fa(a.ack_count)}</span>}
                    <button className="icon-btn" title={a.pinned ? 'برداشتن سنجاق' : 'سنجاق'} onClick={() => togglePin(a)}>
                      {a.pinned ? <PinOff size={14} /> : <Pin size={14} />}
                    </button>
                    <button className="icon-btn" title="ویرایش" onClick={() => setEditing(a)}><Pencil size={14} /></button>
                    <button className="icon-btn" style={{ color: 'var(--red)' }} title="حذف" onClick={() => remove(a)}><Trash2 size={14} /></button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {editing && (
        <Editor item={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)} onSaved={load} />
      )}
      {viewing && <Viewer id={viewing} onClose={() => setViewing(null)} onChanged={load} />}
    </div>
  );
}
