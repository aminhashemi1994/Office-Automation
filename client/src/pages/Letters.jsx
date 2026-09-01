// ============================================================================
//  دبیرخانه — نامهٔ اداری
//  نامهٔ وارده/صادره/داخلی با شمارهٔ ثبتِ خودکار، گیرنده و رونوشت، پیوست،
//  «دریافت شد» و ارجاع به همکار با دستور.
//  کارتابل برای گردشِ تاییدِ مرحله‌به‌مرحله است؛ اینجا برای ثبت و پیگیریِ مکاتبات.
// ============================================================================
import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Mail, Plus, Search, Check, Trash2, Pencil, Send, Inbox, ArrowRightLeft,
  CornerUpLeft, Lock, X, Clock,
} from 'lucide-react';
import { api } from '../api.js';
import { useStore } from '../store.jsx';
import { fa, fmtDateTime, fmtRelative } from '../utils.js';
import { Modal, Field, Avatar } from '../components/common.jsx';
import { AttachmentPicker, AttachmentList, toFileIds } from '../components/Attachments.jsx';
import { JalaliDatePicker } from '../components/JalaliDatePicker.jsx';
import { todayJalali, formatJalali } from '../jalali.js';

const DIRECTIONS = {
  in: ['وارده', 'badge-sky', Inbox],
  out: ['صادره', 'badge-amber', Send],
  internal: ['داخلی', 'badge-gray', ArrowRightLeft],
};
const STATUS = { registered: 'ثبت‌شده', in_review: 'در حال بررسی', archived: 'بایگانی' };

// انتخابگرِ چندنفرهٔ گیرنده/رونوشت — بیرون از کامپوننت تعریف شده تا با هر تایپ
// در موضوع یا متن نامه، از نو ساخته نشود.
function Picker({ value, onChange, label, users }) {
  return (
    <>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
        {value.length === 0 && <span style={{ fontSize: 12, color: 'var(--text-3)' }}>کسی انتخاب نشده است.</span>}
        {value.map(id => (
          <span key={id} className="badge badge-sky" style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            {users.find(u => u.id === id)?.full_name || '—'}
            <X size={12} style={{ cursor: 'pointer' }} onClick={() => onChange(value.filter(x => x !== id))} />
          </span>
        ))}
      </div>
      <select className="input" value="" onChange={e => {
        const id = Number(e.target.value);
        if (id && !value.includes(id)) onChange([...value, id]);
      }}>
        <option value="">+ {label}</option>
        {users.filter(u => u.is_active && !value.includes(u.id))
          .map(u => <option key={u.id} value={u.id}>{u.full_name}{u.department_name ? ` (${u.department_name})` : ''}</option>)}
      </select>
    </>
  );
}

function Editor({ item, onClose, onSaved }) {
  const { toast, users, departments, user } = useStore();
  const [direction, setDirection] = useState(item?.direction || 'in');
  const [number, setNumber] = useState(item?.number || '');
  const [subject, setSubject] = useState(item?.subject || '');
  const [body, setBody] = useState(item?.body || '');
  const [party, setParty] = useState(item?.party || '');
  const [partyRef, setPartyRef] = useState(item?.party_ref || '');
  const [letterDate, setLetterDate] = useState(item?.letter_date
    || (() => { const t = todayJalali(); return formatJalali(t.jy, t.jm, t.jd); })());
  const [deptId, setDeptId] = useState(item?.department_id || user.department_id || '');
  const [toIds, setToIds] = useState([]);
  const [ccIds, setCcIds] = useState([]);
  const [attachments, setAttachments] = useState(item?.attachments || []);
  const [confidential, setConfidential] = useState(!!item?.confidential);
  const [requireAck, setRequireAck] = useState(true);
  const [busy, setBusy] = useState(false);

  // شمارهٔ ثبتِ پیشنهادی — با عوض‌شدن نوع نامه به‌روز می‌شود
  useEffect(() => {
    if (item) return;
    api(`/letters/meta/next-number?direction=${direction}`).then(r => setNumber(r.number)).catch(() => {});
  }, [direction, item]);

  useEffect(() => {
    if (!item) return;
    api(`/letters/${item.id}`).then(r => {
      setToIds(r.recipients.filter(x => x.kind === 'to').map(x => x.user_id));
      setCcIds(r.recipients.filter(x => x.kind === 'cc').map(x => x.user_id));
    }).catch(() => {});
  }, [item?.id]);

  const save = async () => {
    if (!subject.trim()) return toast('موضوع نامه را بنویسید', 'error');
    setBusy(true);
    try {
      const b = {
        direction, number, subject, body, party, party_ref: partyRef, letter_date: letterDate,
        department_id: deptId ? Number(deptId) : null, attachments: toFileIds(attachments),
        confidential: confidential ? 1 : 0, to_ids: toIds, cc_ids: ccIds, require_ack: requireAck,
      };
      if (item) await api(`/letters/${item.id}`, { method: 'PUT', body: b });
      else await api('/letters', { method: 'POST', body: b });
      onSaved(); onClose();
      toast(item ? 'نامه به‌روزرسانی شد' : 'نامه ثبت شد');
    } catch (e) { toast(e.message, 'error'); }
    setBusy(false);
  };


  return (
    <Modal title={item ? `ویرایش نامهٔ ${item.number}` : 'ثبت نامهٔ جدید'} onClose={onClose} wide
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>انصراف</button>
        <button className="btn btn-primary" disabled={busy || !subject.trim()} onClick={save}>
          {item ? 'ذخیره' : 'ثبت نامه'}
        </button>
      </>}>
      <div className="form-row-3">
        <Field label="نوع نامه">
          <select className="input" value={direction} onChange={e => setDirection(e.target.value)} disabled={!!item}>
            {Object.entries(DIRECTIONS).map(([k, v]) => <option key={k} value={k}>{v[0]}</option>)}
          </select>
        </Field>
        <Field label="شمارهٔ ثبت" hint={item ? '' : 'خودکار پیشنهاد می‌شود'}>
          <input className="input" value={number} onChange={e => setNumber(e.target.value)}
            style={{ direction: 'ltr', textAlign: 'left' }} />
        </Field>
        <Field label="تاریخ نامه">
          <JalaliDatePicker value={letterDate} onChange={setLetterDate} disablePast={false} pastDays={3650} />
        </Field>
      </div>

      <Field label="موضوع">
        <input className="input" value={subject} autoFocus onChange={e => setSubject(e.target.value)}
          placeholder="مثلاً: استعلام قیمت کابل افشان" />
      </Field>

      <div className="form-row-wide">
        <Field label={direction === 'in' ? 'فرستنده (سازمان بیرونی)' : direction === 'out' ? 'گیرنده (سازمان بیرونی)' : 'طرفِ مکاتبه'}
          hint={direction === 'internal' ? 'برای نامهٔ داخلی می‌توانید خالی بگذارید' : ''}>
          <input className="input" value={party} onChange={e => setParty(e.target.value)} />
        </Field>
        <Field label="شمارهٔ نامهٔ طرف مقابل (اختیاری)">
          <input className="input" value={partyRef} onChange={e => setPartyRef(e.target.value)}
            style={{ direction: 'ltr', textAlign: 'left' }} />
        </Field>
      </div>

      <Field label="متن / خلاصهٔ نامه">
        <textarea className="input" style={{ minHeight: 110 }} value={body} onChange={e => setBody(e.target.value)} />
      </Field>

      <div className="form-row">
        <Field label="گیرندگان">
          <Picker value={toIds} onChange={setToIds} label="افزودن گیرنده…" users={users} />
        </Field>
        <Field label="رونوشت"
          hint="گیرندگانِ رونوشت فقط در جریان قرار می‌گیرند؛ اگر «دریافت شد» الزامی باشد، می‌بینید چه کسی هنوز تایید نکرده.">
          <Picker value={ccIds} onChange={setCcIds} label="افزودن رونوشت…" users={users} />
        </Field>
      </div>

      <Field label="واحد مربوط">
        <select className="input" value={deptId} onChange={e => setDeptId(e.target.value)}>
          <option value="">— بدون واحد —</option>
          {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
      </Field>

      <Field label="پیوست">
        <AttachmentPicker value={attachments} onChange={setAttachments} placeholder="انتخاب فایل" label="افزودن فایل" thumb={80} />
      </Field>

      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, cursor: 'pointer' }}>
          <input type="checkbox" checked={requireAck} style={{ width: 16, height: 16 }}
            onChange={e => setRequireAck(e.target.checked)} />
          گیرندگان «دریافت شد» بزنند
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, cursor: 'pointer' }}>
          <input type="checkbox" checked={confidential} style={{ width: 16, height: 16 }}
            onChange={e => setConfidential(e.target.checked)} />
          محرمانه
        </label>
      </div>
    </Modal>
  );
}

function Viewer({ id, onClose, onChanged }) {
  const { toast, users, user } = useStore();
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [referTo, setReferTo] = useState('');
  const [instruction, setInstruction] = useState('');
  const [result, setResult] = useState({});

  const load = async () => {
    try { setData(await api(`/letters/${id}`)); }
    catch (e) { toast(e.message, 'error'); onClose(); }
  };
  useEffect(() => { load(); }, [id]);
  if (!data) return null;
  const l = data.letter;
  const [dLabel, dCls] = DIRECTIONS[l.direction] || DIRECTIONS.internal;

  const ack = async () => {
    setBusy(true);
    try {
      const r = await api(`/letters/${id}/ack`, { method: 'POST', body: {} });
      await load(); onChanged?.();
      toast(r.pending ? `ثبت شد — ${fa(r.pending)} نفر باقی مانده‌اند` : 'دریافت شما ثبت شد');
    } catch (e) { toast(e.message, 'error'); }
    setBusy(false);
  };
  const refer = async () => {
    if (!referTo) return toast('گیرندهٔ ارجاع را انتخاب کنید', 'error');
    try {
      await api(`/letters/${id}/refer`, { method: 'POST', body: { to_user_id: Number(referTo), instruction } });
      setReferTo(''); setInstruction(''); await load(); onChanged?.();
      toast('نامه ارجاع شد');
    } catch (e) { toast(e.message, 'error'); }
  };
  const finishRef = async (rf) => {
    try {
      await api(`/letters/${id}/referrals/${rf.id}/done`, { method: 'POST', body: { result: result[rf.id] || '' } });
      await load(); onChanged?.(); toast('نتیجهٔ ارجاع ثبت شد');
    } catch (e) { toast(e.message, 'error'); }
  };

  return (
    <Modal title={`${dLabel} — ${l.subject}`} onClose={onClose} wide
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>بستن</button>
        {data.can_ack && <button className="btn btn-primary" disabled={busy} onClick={ack}><Check size={16} /> دریافت شد</button>}
      </>}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
        <span className={`badge ${dCls}`}>{dLabel}</span>
        <span className="badge badge-gray" style={{ direction: 'ltr' }}>{l.number}</span>
        {!!l.confidential && <span className="badge badge-red"><Lock size={11} /> محرمانه</span>}
        <span className="badge badge-gray">{STATUS[l.status] || l.status}</span>
        <span style={{ fontSize: 12.3, color: 'var(--text-3)' }}>
          ثبت: {l.creator_name} · {fmtDateTime(l.created_at)}
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12, fontSize: 13 }}>
        {l.party && <div><span style={{ color: 'var(--text-3)' }}>طرفِ مکاتبه: </span><b>{l.party}</b></div>}
        {l.letter_date && <div><span style={{ color: 'var(--text-3)' }}>تاریخ نامه: </span><b>{l.letter_date}</b></div>}
        {l.party_ref && <div><span style={{ color: 'var(--text-3)' }}>شمارهٔ نامهٔ طرف: </span><b style={{ direction: 'ltr', display: 'inline-block' }}>{l.party_ref}</b></div>}
        {l.department_name && <div><span style={{ color: 'var(--text-3)' }}>واحد: </span><b>{l.department_name}</b></div>}
      </div>

      {l.body && (
        <div style={{ fontSize: 13.3, lineHeight: 2.1, whiteSpace: 'pre-wrap', padding: '12px 14px',
          background: 'var(--bg-2)', borderRadius: 10, marginBottom: 12 }}>{l.body}</div>
      )}
      {l.attachments?.length > 0 && <AttachmentList ids={l.attachments} thumb={96} title="پیوست‌ها" />}

      {/* گیرندگان و وضعیت دریافت */}
      <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--border-soft)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <b style={{ fontSize: 13 }}>گیرندگان و رونوشت</b>
          {data.pending_ack > 0 && <span className="badge badge-amber">{fa(data.pending_ack)} نفر دریافت نکرده‌اند</span>}
          {data.pending_ack === 0 && data.recipients.length > 0 && (
            <span className="badge badge-green"><Check size={11} /> همه دریافت کردند</span>
          )}
        </div>
        <div style={{ display: 'grid', gap: 6 }}>
          {data.recipients.length === 0 && <span style={{ fontSize: 12.5, color: 'var(--text-3)' }}>گیرنده‌ای ثبت نشده است</span>}
          {data.recipients.map(rc => (
            <div key={`${rc.user_id}${rc.kind}`} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.8 }}>
              <Avatar name={rc.full_name} color={rc.avatar_color} size={24} />
              <span style={{ flex: 1 }}>
                {rc.full_name}
                <span className="badge badge-gray" style={{ marginInlineStart: 6 }}>{rc.kind === 'cc' ? 'رونوشت' : 'گیرنده'}</span>
                {rc.department_name && <span style={{ color: 'var(--text-3)' }}> · {rc.department_name}</span>}
              </span>
              {rc.acked_at
                ? <span className="badge badge-green" title={rc.note || ''}><Check size={11} /> {fmtRelative(rc.acked_at)}</span>
                : rc.read_at
                ? <span className="badge badge-sky">دیده — منتظر تایید</span>
                : <span className="badge badge-gray"><Clock size={11} /> ندیده</span>}
            </div>
          ))}
        </div>
      </div>

      {/* ارجاع */}
      <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--border-soft)' }}>
        <b style={{ fontSize: 13, display: 'block', marginBottom: 8 }}>ارجاع‌ها</b>
        {data.referrals.length === 0 && <div style={{ fontSize: 12.5, color: 'var(--text-3)', marginBottom: 8 }}>ارجاعی ثبت نشده است</div>}
        <div style={{ display: 'grid', gap: 8, marginBottom: 10 }}>
          {data.referrals.map(rf => (
            <div key={rf.id} style={{ padding: '9px 11px', background: 'var(--bg-2)', borderRadius: 10 }}>
              <div style={{ fontSize: 12.6 }}>
                <b>{rf.from_name}</b> → <b>{rf.to_name}</b>
                <span style={{ color: 'var(--text-3)' }}> · {fmtRelative(rf.created_at)}</span>
                {rf.done_at && <span className="badge badge-green" style={{ marginInlineStart: 6 }}><Check size={11} /> انجام شد</span>}
              </div>
              {rf.instruction && <div style={{ fontSize: 12.5, color: 'var(--text-2)', marginTop: 4 }}>{rf.instruction}</div>}
              {rf.result && <div style={{ fontSize: 12.3, color: 'var(--green)', marginTop: 4 }}>نتیجه: {rf.result}</div>}
              {!rf.done_at && rf.to_user_id === user.id && (
                <div style={{ display: 'flex', gap: 6, marginTop: 7 }}>
                  <input className="input" style={{ flex: 1, height: 34 }} placeholder="نتیجهٔ اقدام…"
                    value={result[rf.id] || ''} onChange={e => setResult(r0 => ({ ...r0, [rf.id]: e.target.value }))} />
                  <button className="btn btn-success btn-sm" onClick={() => finishRef(rf)}>انجام شد</button>
                </div>
              )}
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <select className="input" style={{ width: 200 }} value={referTo} onChange={e => setReferTo(e.target.value)}>
            <option value="">ارجاع به…</option>
            {users.filter(u => u.is_active && u.id !== user.id)
              .map(u => <option key={u.id} value={u.id}>{u.full_name}</option>)}
          </select>
          <input className="input" style={{ flex: 1, minWidth: 180 }} placeholder="دستور / توضیح (اختیاری)"
            value={instruction} onChange={e => setInstruction(e.target.value)} />
          <button className="btn btn-ghost" onClick={refer}><CornerUpLeft size={15} /> ارجاع</button>
        </div>
      </div>
    </Modal>
  );
}

export default function Letters() {
  const { toast, on } = useStore();
  const [data, setData] = useState(null);
  const [dir, setDir] = useState('');
  const [q, setQ] = useState('');
  const [onlyMine, setOnlyMine] = useState(false);
  const [editing, setEditing] = useState(null);
  const [viewing, setViewing] = useState(null);
  const [params, setParams] = useSearchParams();

  const load = async () => {
    try {
      const qs = new URLSearchParams();
      if (dir) qs.set('direction', dir);
      if (onlyMine) qs.set('mine', '1');
      setData(await api(`/letters?${qs.toString()}`));
    } catch (e) { toast(e.message, 'error'); }
  };
  useEffect(() => { load(); }, [dir, onlyMine]);
  useEffect(() => on('notification', load), [dir, onlyMine]);
  useEffect(() => {
    const l = Number(params.get('l'));
    if (l) { setViewing(l); setParams({}, { replace: true }); }
  }, [params]);

  const remove = async (l) => {
    if (!window.confirm(`نامهٔ «${l.number}» حذف شود؟`)) return;
    try { await api(`/letters/${l.id}`, { method: 'DELETE' }); load(); toast('حذف شد'); }
    catch (e) { toast(e.message, 'error'); }
  };

  const list = useMemo(() => {
    const nq = q.trim();
    return (data?.letters || []).filter(l => !nq
      || [l.subject, l.number, l.party, l.creator_name].some(x => String(x || '').includes(nq)));
  }, [data, q]);

  if (!data) return <div className="content"><div className="card"><div className="empty">در حال بارگذاری…</div></div></div>;

  return (
    <div className="content">
      <div className="page-head" style={{ flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h2>دبیرخانه — نامه‌ها</h2>
          <p style={{ fontSize: 12.5, color: 'var(--text-3)', margin: '4px 0 0' }}>
            ثبت و پیگیریِ مکاتبات با شمارهٔ ثبت، رونوشت، «دریافت شد» و ارجاع.
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => setEditing('new')}><Plus size={17} /> ثبت نامه</button>
      </div>

      <div className="card card-pad" style={{ marginBottom: 16, padding: 14 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <div className="tabs" style={{ margin: 0 }}>
            <button className={`tab ${dir === '' ? 'active' : ''}`} onClick={() => setDir('')}>همه</button>
            {Object.entries(DIRECTIONS).map(([k, v]) => (
              <button key={k} className={`tab ${dir === k ? 'active' : ''}`} onClick={() => setDir(k)}>{v[0]}</button>
            ))}
          </div>
          <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
            <Search size={15} style={{ position: 'absolute', right: 11, top: 11, color: 'var(--text-3)' }} />
            <input className="input" style={{ paddingRight: 34, width: '100%' }}
              placeholder="جستجو در موضوع، شماره، طرفِ مکاتبه…" value={q} onChange={e => setQ(e.target.value)} />
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
            <input type="checkbox" checked={onlyMine} style={{ width: 16, height: 16 }}
              onChange={e => setOnlyMine(e.target.checked)} />
            فقط کارهای من
            {data.pending > 0 && <span className="badge-count">{fa(data.pending)}</span>}
          </label>
        </div>
      </div>

      {list.length === 0 && (
        <div className="card card-pad" style={{ textAlign: 'center', padding: '44px 20px' }}>
          <Mail size={38} style={{ color: 'var(--text-3)', marginBottom: 10 }} />
          <div style={{ fontWeight: 700 }}>نامه‌ای یافت نشد</div>
        </div>
      )}

      <div className="card">
        {list.length > 0 && (
          <table className="table">
            <thead>
              <tr><th>شماره</th><th>نوع</th><th>موضوع</th><th>طرف مکاتبه</th><th>تاریخ</th><th>وضعیت</th><th></th></tr>
            </thead>
            <tbody>
              {list.map(l => {
                const [dLabel, dCls] = DIRECTIONS[l.direction] || DIRECTIONS.internal;
                const needsMe = (l.is_recipient && !l.my_acked_at) || l.my_open_referrals;
                return (
                  <tr key={l.id} style={{ cursor: 'pointer' }} onClick={() => setViewing(l.id)}>
                    <td style={{ direction: 'ltr', textAlign: 'right', fontSize: 12.3 }}>{l.number}</td>
                    <td><span className={`badge ${dCls}`}>{dLabel}</span></td>
                    <td>
                      <b style={{ fontSize: 13.3 }}>{l.subject}</b>
                      {!!l.confidential && <Lock size={12} style={{ color: 'var(--red)', marginInlineStart: 5, verticalAlign: '-2px' }} />}
                      {needsMe && <span className="badge badge-amber" style={{ marginInlineStart: 6 }}>نیازمند اقدام شما</span>}
                    </td>
                    <td style={{ fontSize: 12.5 }}>{l.party || '—'}</td>
                    <td style={{ fontSize: 12.3, color: 'var(--text-3)' }}>{l.letter_date || fmtRelative(l.created_at)}</td>
                    <td style={{ fontSize: 12.3 }}>
                      {l.pending_ack > 0
                        ? <span className="badge badge-amber">{fa(l.pending_ack)} دریافت‌نکرده</span>
                        : l.recipient_count > 0
                        ? <span className="badge badge-green"><Check size={11} /> کامل</span>
                        : <span className="badge badge-gray">بدون گیرنده</span>}
                    </td>
                    <td onClick={e => e.stopPropagation()}>
                      {/* فقط ثبت‌کننده/دبیرخانه ویرایش می‌کند؛ برای بقیه دکمه‌ای نشان نمی‌دهیم */}
                      {l.can_edit ? (
                        <div style={{ display: 'flex', gap: 3 }}>
                          <button className="icon-btn" title="ویرایش" onClick={() => setEditing(l)}><Pencil size={14} /></button>
                          <button className="icon-btn" style={{ color: 'var(--red)' }} title="حذف" onClick={() => remove(l)}><Trash2 size={14} /></button>
                        </div>
                      ) : <span style={{ fontSize: 11.5, color: 'var(--text-3)' }}>—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {editing && <Editor item={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={load} />}
      {viewing && <Viewer id={viewing} onClose={() => setViewing(null)} onChanged={load} />}
    </div>
  );
}
