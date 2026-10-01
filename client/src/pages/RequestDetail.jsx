import React, { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  ArrowRight, Check, X, Clock, Ban, SkipForward, Printer, Bell, ListTodo, Paperclip,
  Pencil, Undo2, Send, Trash2, ShieldCheck, HelpCircle, Reply, Eye,
} from 'lucide-react';
import { api } from '../api.js';
import { useStore } from '../store.jsx';
import { fmtDateTime, parseDate, formatFieldValue, fa } from '../utils.js';
import { Modal, Field, UserPicker, Avatar } from '../components/common.jsx';
import WorkflowTree from '../components/WorkflowTree.jsx';
import { STATUS } from './Cartable.jsx';
import RequestFormFields, { validateRequestForm } from '../components/RequestForm.jsx';
import { AttachmentList, AttachmentPicker, primeFilesMeta, toFileIds } from '../components/Attachments.jsx';
import { printRequest } from '../utils.js';

const ACTION_LABEL = {
  submit: ['ثبت درخواست', 'badge-sky'],
  approve: ['تایید کرد', 'badge-green'],
  reject: ['رد کرد', 'badge-red'],
  skip: ['عبور داد', 'badge-amber'],
  comment: ['یادداشت', 'badge-gray'],
  edit: ['ویرایش کرد', 'badge-amber'],
  return: ['برگشت داد', 'badge-red'],
  ack: ['دریافت شد', 'badge-green'],
  question: ['پرسش', 'badge-sky'],
  answer: ['پاسخ', 'badge-primary'],
};

export default function RequestDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user, users, settings, hasPerm, on, toast, refreshBadges } = useStore();
  const [req, setReq] = useState(null);
  const [confirm, setConfirm] = useState(null); // 'approve' | 'reject' | 'skip'
  const [comment, setComment] = useState('');
  const [actionFiles, setActionFiles] = useState([]); // [پیوست‌ها] فایل‌های پیوستِ اقدام
  const [note, setNote] = useState(null); // {comment, attachments} — یادداشت/پیوست بدون تغییر مرحله
  // با کلیک روی یک گرهٔ نمودار، تاریخچه روی همان مرحله فیلتر می‌شود
  const [stepFilter, setStepFilter] = useState(null);
  const historyRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [makeTask, setMakeTask] = useState(null); // {title, assignee_type, assignee_id, deadline_hours}
  const [edit, setEdit] = useState(null);        // {title, data} — ویرایش عنوان و فرمِ درخواست
  const [ret, setRet] = useState(null);          // {to_step, resume_step, comment, attachments} — برگشت درخواست
  const [confirmDel, setConfirmDel] = useState(false);
  const [ask, setAsk] = useState(null);          // {to_user_id, comment} — پرسش از یک فرد
  const [answer, setAnswer] = useState(null);    // {question, comment, attachments} — پاسخ به پرسش

  const load = async () => {
    try {
      const r = await api(`/workflows/requests/${id}`);
      primeFilesMeta(r.request?.files); // نام/حجم فایل‌ها همراه پاسخ می‌آید
      setReq(r.request);
    } catch (e) { toast(e.message, 'error'); navigate('/cartable'); }
  };
  useEffect(() => { load(); return on('notification', load); }, [id]);

  if (!req) return <div className="content"><div className="empty">در حال بارگذاری…</div></div>;

  const [sl, sc] = STATUS[req.status] || STATUS.in_progress;
  let schema = [], data = {};
  try { schema = JSON.parse(req.form_schema || '[]'); } catch {}
  try { data = JSON.parse(req.form_data || '{}'); } catch {}
  const userName = (uid) => users.find(u => u.id === uid)?.full_name || '—';

  const act = async () => {
    setBusy(true);
    try {
      await api(`/workflows/requests/${req.id}/action`, { method: 'POST', body: { action: confirm, comment, attachments: actionFiles } });
      setConfirm(null); setComment(''); setActionFiles([]);
      await load();
      refreshBadges();
      toast(confirm !== 'approve' ? (confirm === 'skip' ? 'بدون اظهارنظر عبور داده شد' : 'درخواست رد شد')
        : req.can_final ? 'درخواست با تایید نهایی شما بسته شد'
        : 'تایید شد و به مرحله بعد رفت');
    } catch (e) { toast(e.message, 'error'); }
    setBusy(false);
  };

  // [پیوست‌ها] ثبت یادداشت و/یا پیوستِ فایل بدون تغییر مرحله —
  // برای همهٔ افرادِ درگیر در سلسله‌مراتب (درخواست‌دهنده، تاییدکنندگان، مدیران)
  const submitNote = async () => {
    setBusy(true);
    try {
      await api(`/workflows/requests/${req.id}/comment`, { method: 'POST', body: {
        comment: note.comment, attachments: note.attachments,
      } });
      setNote(null);
      await load();
      refreshBadges();
      toast('یادداشت/پیوست ثبت شد');
    } catch (e) { toast(e.message, 'error'); }
    setBusy(false);
  };

  // [پرسش و پاسخ]
  const submitAsk = async () => {
    setBusy(true);
    try {
      await api(`/workflows/requests/${req.id}/question`, { method: 'POST', body: ask });
      setAsk(null); await load(); toast('پرسش ارسال شد');
    } catch (e) { toast(e.message, 'error'); }
    setBusy(false);
  };
  const submitAnswer = async () => {
    setBusy(true);
    try {
      await api(`/workflows/requests/${req.id}/answer`, { method: 'POST', body: {
        question_id: answer.question.id, comment: answer.comment, attachments: answer.attachments,
      } });
      setAnswer(null); await load(); refreshBadges(); toast('پاسخ ثبت شد');
    } catch (e) { toast(e.message, 'error'); }
    setBusy(false);
  };
  const openQIds = new Set((req.open_questions || []).map(q => q.id));
  const myOpenQ = (req.open_questions || []).filter(q => (req.my_open_questions || []).includes(q.id));

  const cancel = async () => {
    setBusy(true);
    try { await api(`/workflows/requests/${req.id}/cancel`, { method: 'POST' }); await load(); refreshBadges(); toast('درخواست لغو شد'); }
    catch (e) { toast(e.message, 'error'); }
    setBusy(false);
  };

  // [رونوشت] اعلام «دریافت شد» توسط گیرندهٔ رونوشت
  const ackCc = async () => {
    setBusy(true);
    try {
      const r = await api(`/workflows/requests/${id}/ack`, { method: 'POST', body: {} });
      await load();
      toast(r.pending ? `ثبت شد — ${r.pending.toLocaleString('fa-IR')} نفر دیگر باقی مانده‌اند` : 'دریافت شما ثبت شد');
    } catch (e) { toast(e.message, 'error'); }
    setBusy(false);
  };

  const renotify = async () => {
    setBusy(true);
    try {
      const r = await api(`/workflows/requests/${req.id}/renotify`, { method: 'POST' });
      toast(`اعلان برای ${Number(r.notified).toLocaleString('fa-IR')} نفر مسئول مرحله فعلی ارسال شد`);
    } catch (e) { toast(e.message, 'error'); }
    setBusy(false);
  };

  // ---------- ویرایش عنوان و اطلاعات فرمِ درخواست ----------
  // درخواست‌دهنده تا قبل از اولین تایید (و نیز در حالت «برگشت برای اصلاح» و «تایید نهایی»)،
  // و مدیر سامانه در هر زمان — برای اصلاح از صفحهٔ گزارش‌گیری.
  const submitEdit = async () => {
    const err = validateRequestForm(schema, edit.data, {
      attachmentsOff: settings?.attachments_enabled === '0',
      allowPast: true, // درخواست ممکن است مدت‌ها قبل ثبت شده باشد
    });
    if (err) return toast(err, 'error');
    setBusy(true);
    try {
      await api(`/workflows/requests/${req.id}`, { method: 'PUT', body: { title: edit.title, form_data: edit.data } });
      setEdit(null); await load(); refreshBadges();
      toast('درخواست ویرایش شد و در تاریخچه ثبت گردید');
    } catch (e) { toast(e.message, 'error'); }
    setBusy(false);
  };

  // ---------- برگشت دادن درخواست ----------
  // مقدار ۰ برای to_step یعنی «برگشت به درخواست‌دهنده برای اصلاح».
  const submitReturn = async () => {
    setBusy(true);
    try {
      await api(`/workflows/requests/${req.id}/action`, { method: 'POST', body: {
        action: 'return',
        to_step: Number(ret.to_step),
        resume_step: Number(ret.resume_step) || undefined,
        comment: ret.comment,
        attachments: ret.attachments,
      } });
      setRet(null); await load(); refreshBadges();
      toast(Number(ret.to_step) === 0 ? 'درخواست برای اصلاح به درخواست‌دهنده برگشت داده شد' : 'درخواست به مرحلهٔ انتخابی برگشت داده شد');
    } catch (e) { toast(e.message, 'error'); }
    setBusy(false);
  };

  // ---------- ارسال مجددِ درخواستِ اصلاح‌شده ----------
  const resubmit = async () => {
    setBusy(true);
    try {
      await api(`/workflows/requests/${req.id}/resubmit`, { method: 'POST' });
      await load(); refreshBadges();
      toast('درخواست دوباره ارسال شد');
    } catch (e) { toast(e.message, 'error'); }
    setBusy(false);
  };

  // ---------- حذف کاملِ درخواست (مدیر سامانه) ----------
  const remove = async () => {
    setBusy(true);
    try {
      await api(`/workflows/requests/${req.id}`, { method: 'DELETE' });
      toast('درخواست حذف شد');
      refreshBadges();
      navigate('/cartable');
    } catch (e) { toast(e.message, 'error'); setBusy(false); }
  };

  const canMakeTask = (hasPerm('workflows.manage') || user.role === 'manager' || req.requester_id === user.id) && !req.task_id;
  const submitMakeTask = async () => {
    setBusy(true);
    try {
      await api(`/workflows/requests/${req.id}/make-task`, { method: 'POST', body: {
        title: makeTask.title || null,
        assignee_type: makeTask.assignee_type,
        assignee_id: makeTask.assignee_type === 'user' ? (makeTask.assignee_id || null) : null,
        deadline_hours: Number(makeTask.deadline_hours) || 0,
      } });
      setMakeTask(null); await load(); refreshBadges();
      toast('تسک از این درخواست ساخته شد');
    } catch (e) { toast(e.message, 'error'); }
    setBusy(false);
  };

  const rejectedAt = req.status === 'rejected' ? req.current_step : null;
  const overdue = req.status === 'in_progress' && req.step_due_at && parseDate(req.step_due_at) < new Date();
  const isOpen = ['in_progress', 'awaiting_requester', 'returned'].includes(req.status);
  // مراحلی که می‌توان درخواست را به آن‌ها برگرداند (بر اساس مجوزی که سرور تعیین کرده)
  const returnTargets = req.can_return
    ? req.steps.filter(s => s.step_order >= Math.max(1, req.return_min_step) && s.step_order <= req.return_max_step)
    : [];
  const canReturnToRequester = req.can_return && req.return_min_step === 0;

  return (
    <div className="content">
      <div className="page-head">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Link to="/cartable" className="icon-btn"><ArrowRight size={18} /></Link>
          <div>
            <h2>{req.title}</h2>
            <div style={{ fontSize: 12.8, color: 'var(--text-2)' }}>
              {req.template_name} · {req.requester_name} ({req.requester_department || 'بدون واحد'})
              {req.on_behalf_name ? <span className="badge badge-amber" style={{ marginInlineStart: 6 }}>از طرفِ {req.on_behalf_name}</span> : null}
              {' '}· {fmtDateTime(req.created_at)}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span className={`badge ${sc}`} style={{ fontSize: 13 }}>{sl}</span>
          <button className="btn btn-ghost btn-sm" onClick={() => printRequest(req, sl, settings)}><Printer size={14} /> چاپ / بایگانی</button>
          {canMakeTask && (
            <button className="btn btn-ghost btn-sm" onClick={() => setMakeTask({ title: `پیگیری: ${req.title}`, assignee_type: 'requester', assignee_id: null, deadline_hours: 0 })}>
              <ListTodo size={14} /> ساخت تسک
            </button>
          )}
          {req.task_id && <span className="badge badge-green" title="از این درخواست تسک ساخته شده"><ListTodo size={12} /> تسک ساخته شد</span>}
          {/* [ویرایش] عنوان و اطلاعات فرم — تا قبل از اولین تایید برای درخواست‌دهنده، همیشه برای مدیر سامانه */}
          {req.can_edit && (
            <button className="btn btn-ghost btn-sm" onClick={() => setEdit({ title: req.title, data: { ...data } })} disabled={busy}>
              <Pencil size={14} /> ویرایش درخواست
            </button>
          )}
          {req.status === 'in_progress' && (req.requester_id === user.id || user.role === 'admin') && (
            <button className="btn btn-ghost btn-sm" onClick={renotify} disabled={busy} title="اعلان دوباره برای مسئول مرحله فعلی"><Bell size={14} /> یادآوری به مسئول</button>
          )}
          {isOpen && (req.requester_id === user.id || user.role === 'admin') && (
            <button className="btn btn-ghost btn-sm" onClick={cancel} disabled={busy}><Ban size={14} /> لغو درخواست</button>
          )}
          {/* [حذف] فقط مدیر سامانه — برای پاک‌کردن درخواست‌های اشتباه از بایگانی */}
          {req.can_delete && (
            <button className="btn btn-ghost btn-sm" style={{ color: 'var(--red)' }} onClick={() => setConfirmDel(true)} disabled={busy}>
              <Trash2 size={14} /> حذف درخواست
            </button>
          )}
        </div>
      </div>

      {/* [رونوشت] گیرندهٔ رونوشت باید همان بالا بفهمد تاییدکننده نیست و فقط باید دریافت را اعلام کند */}
      {myOpenQ.length > 0 && (
        <div className="card card-pad" style={{ marginBottom: 16, borderInlineStart: '4px solid var(--primary)' }}>
          <b style={{ display: 'flex', alignItems: 'center', gap: 6 }}><HelpCircle size={16} /> از شما پرسیده شده است</b>
          {myOpenQ.map(q => (
            <div key={q.id} style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 8, fontSize: 13 }}>
              <span style={{ flex: 1 }}><b>{q.actor_name}:</b> {q.comment}</span>
              <button className="btn btn-primary btn-sm" onClick={() => setAnswer({ question: q, comment: '', attachments: [] })}>
                <Reply size={13} /> پاسخ
              </button>
            </div>
          ))}
        </div>
      )}
      {req.can_ack && (
        <div className="card card-pad" style={{
          marginBottom: 16, borderInlineStart: '4px solid var(--primary)', background: 'var(--primary-soft)',
          display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
        }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <b style={{ fontSize: 13.5 }}>این نامه به‌صورت رونوشت برای شما آمده است</b>
            <div style={{ fontSize: 12.5, color: 'var(--text-2)', marginTop: 3, lineHeight: 1.85 }}>
              شما تاییدکنندهٔ این درخواست نیستید و لازم نیست کاری انجام دهید؛ فقط اعلام کنید که آن را دیده‌اید.
            </div>
          </div>
          <button className="btn btn-primary" disabled={busy} onClick={ackCc}>
            <Check size={16} /> دریافت شد
          </button>
        </div>
      )}

      <div className="grid-2">
        <div>
          <div className="card card-pad" style={{ marginBottom: 18 }}>
            <b style={{ display: 'block', marginBottom: 12 }}>اطلاعات فرم</b>
            {schema.length === 0 && <div style={{ color: 'var(--text-3)' }}>فرم اطلاعاتی ندارد</div>}
            {schema.map(f => (
              <div key={f.key} style={{ display: 'flex', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--border-soft)' }}>
                <span style={{ color: 'var(--text-2)', fontSize: 13, minWidth: 140 }}>{f.label}:</span>
                {(f.type === 'image' || f.type === 'file') ? (
                  <AttachmentList ids={data[f.key]} thumb={104}
                    empty={<span style={{ color: 'var(--text-3)' }}>—</span>} />
                ) : (
                  <span style={{ fontWeight: 600, whiteSpace: 'pre-wrap' }}>{formatFieldValue(f, data[f.key])}</span>
                )}
              </div>
            ))}
            {/* [پیوست عمومی] فایل‌هایی که درخواست‌دهنده به خودِ درخواست وصل کرده است */}
            {req.request_attachments?.length > 0 && (
              <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border-soft)' }}>
                <AttachmentList ids={req.request_attachments} thumb={104} title="پیوست‌های درخواست" />
              </div>
            )}
          </div>

          <div className="card card-pad" ref={historyRef}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 8, flexWrap: 'wrap' }}>
              <b style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                تاریخچه اقدامات و پیوست‌ها
                {stepFilter !== null && (
                  <span className="badge badge-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                    فقط مرحلهٔ «{req.steps.find(st => st.step_order === stepFilter)?.title || stepFilter}»
                    <X size={12} style={{ cursor: 'pointer' }} onClick={() => setStepFilter(null)} />
                  </span>
                )}
              </b>
              {/* [پیوست‌ها] هر فردِ درگیر در این سلسله‌مراتب می‌تواند فایل پیوست کند */}
              <button className="btn btn-ghost btn-sm" onClick={() => setNote({ comment: '', attachments: [] })}
                title={req.can_attach_note ? 'ثبت یادداشت و پیوست فایل' : 'در این فرآیند فقط یادداشت متنی مجاز است'}>
                <Paperclip size={14} /> {req.can_attach_note ? 'افزودن یادداشت / پیوست فایل' : 'افزودن یادداشت'}
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => setAsk({ to_user_id: null, comment: '' })}
                title="پرسیدن سؤال از یک همکار دربارهٔ این درخواست">
                <HelpCircle size={14} /> پرسش از همکار
              </button>
            </div>
            {(() => {
              const rows = stepFilter === null ? req.actions : req.actions.filter(a => a.step_order === stepFilter);
              if (!rows.length) {
                return <div style={{ fontSize: 12.8, color: 'var(--text-3)', padding: '10px 0' }}>
                  روی این مرحله هنوز اقدامی ثبت نشده است.
                </div>;
              }
              return rows;
            })().map(a => {
              const [al, ac] = ACTION_LABEL[a.action] || ACTION_LABEL.comment;
              const atts = toFileIds((() => { try { return JSON.parse(a.attachments || '[]'); } catch { return []; } })());
              return (
                <div key={a.id} style={{ display: 'flex', gap: 10, padding: '9px 0', borderBottom: '1px solid var(--border-soft)', alignItems: 'baseline' }}>
                  <span className={`badge ${ac}`}>{al}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <b style={{ fontSize: 13.3 }}>{a.actor_name}</b>
                    {a.action === 'question' && a.target_name && (
                      <span style={{ fontSize: 12.3, color: 'var(--text-3)' }}> ← از {a.target_name}</span>
                    )}
                    {a.action === 'answer' && (() => {
                      const q = req.actions.find(x => x.id === a.parent_id);
                      return q && <div style={{ fontSize: 12, color: 'var(--text-3)', borderInlineStart: '2px solid var(--border)', paddingInlineStart: 6, margin: '3px 0' }}>
                        در پاسخ به {q.actor_name}: {q.comment.slice(0, 100)}
                      </div>;
                    })()}
                    {a.comment && <div style={{ fontSize: 12.8, color: 'var(--text-2)' }}>{a.comment}</div>}
                    {atts.length > 0 && (
                      <div style={{ marginTop: 8 }}>
                        <AttachmentList ids={atts} thumb={84} title="پیوستِ این اقدام" />
                      </div>
                    )}
                    {a.action === 'question' && (openQIds.has(a.id)
                      ? <div style={{ marginTop: 5, display: 'flex', gap: 6, alignItems: 'center' }}>
                          <span className="badge badge-amber">منتظر پاسخ</span>
                          {(req.my_open_questions || []).includes(a.id) && (
                            <button className="btn btn-primary btn-sm" onClick={() => setAnswer({ question: a, comment: '', attachments: [] })}>
                              <Reply size={13} /> پاسخ
                            </button>
                          )}
                        </div>
                      : <span className="badge badge-green" style={{ marginTop: 5 }}><Check size={11} /> پاسخ داده شد</span>)}
                  </div>
                  <span style={{ fontSize: 11.5, color: 'var(--text-3)' }}>{fmtDateTime(a.created_at)}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div>
          <div className="card card-pad" style={{ marginBottom: 18 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
              <b>مسیر گردش کار</b>
              <span style={{ fontSize: 11.8, color: 'var(--text-3)', marginInlineStart: 'auto' }}>
                {req.status === 'in_progress' ? 'الان روی مرحلهٔ برجسته است' : ''}
              </span>
            </div>
            {req.orphan_steps?.length > 0 && (
              <div className="panel-soft card-pad" style={{ marginBottom: 12, borderInlineStart: '3px solid var(--red)' }}>
                <b style={{ fontSize: 12.8, color: 'var(--red)' }}>مرحله‌ای بدون مسئول</b>
                <div style={{ fontSize: 12.3, color: 'var(--text-2)', marginTop: 4, lineHeight: 1.85 }}>
                  برای {req.orphan_steps.map(t => `«${t}»`).join('، ')} هیچ سرگروه یا مدیری تعیین نشده،
                  پس فعلاً روی میزِ مدیر سامانه افتاده است. از مدیر سامانه بخواهید در صفحهٔ «واحدها»
                  برای واحد مربوطه سرگروه یا مدیر مشخص کند.
                </div>
              </div>
            )}
            <WorkflowTree req={req} activeStep={stepFilter}
              onStepClick={n => {
                setStepFilter(stepFilter === n.order ? null : n.order);
                historyRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }} />
          </div>

          {/* [ردیابی] چه کسانی درخواست را دیده‌اند و آخرین اقدامشان */}
          {req.views?.length > 0 && (
            <div className="card card-pad" style={{ marginBottom: 18 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <Eye size={15} /><b style={{ fontSize: 13.5 }}>ردیابی مشاهده و اقدام</b>
                <span className="badge badge-gray">{fa(req.views.length)} نفر دیده‌اند</span>
              </div>
              <div style={{ display: 'grid', gap: 8 }}>
                {req.views.map(v => {
                  const la = v.last_action && (ACTION_LABEL[v.last_action.action] || ACTION_LABEL.comment);
                  return (
                    <div key={v.user_id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 }}>
                      <Avatar name={v.full_name} color={v.avatar_color} size={24} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        {v.full_name}
                        {v.department_name && <span style={{ color: 'var(--text-3)' }}> · {v.department_name}</span>}
                        <div style={{ fontSize: 11.3, color: 'var(--text-3)' }}
                          title={`آخرین بار: ${fmtDateTime(v.last_seen_at)} — ${fa(v.view_count)} بار`}>
                          اولین مشاهده: {fmtDateTime(v.first_seen_at)}
                        </div>
                      </div>
                      {la
                        ? <span className={`badge ${la[1]}`}>{la[0]}</span>
                        : <span className="badge badge-gray">فقط دیده</span>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* [رونوشت] چه کسانی در جریان‌اند و چه کسی دریافت را تایید کرده است */}
          {req.cc?.length > 0 && (
            <div className="card card-pad" style={{ marginBottom: 18 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <b style={{ fontSize: 13.5 }}>رونوشت</b>
                <span className="badge badge-gray">{fa(req.cc.length)} نفر</span>
                {req.cc_pending > 0 && (
                  <span className="badge badge-amber">{fa(req.cc_pending)} نفر هنوز دریافت نکرده‌اند</span>
                )}
              </div>
              <div style={{ display: 'grid', gap: 6 }}>
                {req.cc.map(c => (
                  <div key={c.user_id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.8 }}>
                    <Avatar name={c.full_name} color={c.avatar_color} size={24} />
                    <span style={{ flex: 1 }}>
                      {c.full_name}
                      {c.department_name && <span style={{ color: 'var(--text-3)' }}> · {c.department_name}</span>}
                    </span>
                    {c.acked_at
                      ? <span className="badge badge-green" title={c.note || ''}>
                          <Check size={11} /> دریافت شد — {fmtDateTime(c.acked_at)}
                        </span>
                      : <span className="badge badge-gray">
                          {req.views?.some(v => v.user_id === c.user_id) ? 'دیده — ' : 'هنوز ندیده — '}
                          {c.must_ack ? 'منتظر تایید دریافت' : 'در جریان است'}
                        </span>}
                  </div>
                ))}
              </div>
              {req.can_ack && (
                <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border-soft)' }}>
                  <p style={{ fontSize: 12.5, color: 'var(--text-2)', margin: '0 0 8px', lineHeight: 1.85 }}>
                    این نامه به‌صورت رونوشت برای شما آمده است. شما تاییدکننده نیستید؛ فقط اعلام کنید که دیده‌اید.
                  </p>
                  <button className="btn btn-primary" disabled={busy} onClick={ackCc}>
                    <Check size={16} /> دریافت شد
                  </button>
                </div>
              )}
            </div>
          )}

          {req.can_act && (
            <div className="card card-pad" style={{ border: '1.5px solid var(--primary)', background: 'var(--primary-soft)' }}>
              <b style={{ display: 'block', marginBottom: 6 }}>این درخواست در انتظار اقدام شماست</b>
              <p style={{ fontSize: 12.8, color: 'var(--text-2)', marginBottom: 12 }}>
                مرحله فعلی: {req.steps.find(s => s.step_order === req.current_step)?.title}
              </p>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <button className="btn btn-primary" style={{ flex: 1 }} onClick={() => setConfirm('approve')}><Check size={16} /> تایید</button>
                <button className="btn btn-danger" style={{ flex: 1 }} onClick={() => setConfirm('reject')}><X size={16} /> رد</button>
                {!!req.steps.find(s => s.step_order === req.current_step)?.is_optional && (
                  <button className="btn btn-ghost" style={{ flexBasis: '100%' }} onClick={() => setConfirm('skip')}>
                    <SkipForward size={16} /> عبور بدون اظهارنظر (مرحله اختیاری)
                  </button>
                )}
                {/* [برگشت] به‌جای رد کردنِ کامل، درخواست را برای اصلاح یا بازبینی برگردانید */}
                {req.can_return && (
                  <button className="btn btn-ghost" style={{ flexBasis: '100%' }}
                    onClick={() => setRet({ to_step: canReturnToRequester ? 0 : returnTargets[0]?.step_order ?? 0, resume_step: req.current_step, comment: '', attachments: [] })}>
                    <Undo2 size={16} /> برگشت درخواست (به مرحلهٔ قبل یا به درخواست‌دهنده)
                  </button>
                )}
              </div>
            </div>
          )}

          {/* [تایید نهایی درخواست‌دهنده] سلسله‌مراتب تمام شده و تصمیم نهایی با خودِ درخواست‌دهنده است */}
          {req.can_final && (
            <div className="card card-pad" style={{ border: '1.5px solid var(--green)', background: 'var(--green-soft)' }}>
              <b style={{ display: 'block', marginBottom: 6 }}>
                <ShieldCheck size={15} style={{ verticalAlign: '-2px', marginLeft: 4 }} />
                همهٔ مراحل تایید شد — تایید نهایی با شماست
              </b>
              <p style={{ fontSize: 12.8, color: 'var(--text-2)', marginBottom: 12 }}>
                می‌توانید درخواست را ببندید، یادداشت بگذارید، اطلاعات فرم را اصلاح کنید،
                یا آن را به اول یا هر مرحله‌ای از فرآیند برگردانید.
              </p>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <button className="btn btn-primary" style={{ flex: 1 }} onClick={() => setConfirm('approve')}>
                  <Check size={16} /> تایید نهایی و بستن
                </button>
                <button className="btn btn-danger" style={{ flex: 1 }} onClick={() => setConfirm('reject')}><X size={16} /> رد نهایی</button>
                <button className="btn btn-ghost" style={{ flexBasis: '100%' }}
                  onClick={() => setRet({ to_step: 1, resume_step: 1, comment: '', attachments: [] })}>
                  <Undo2 size={16} /> برگشت به اول یا هر مرحله از فرآیند
                </button>
                <button className="btn btn-ghost" style={{ flexBasis: '100%' }} onClick={() => setNote({ comment: '', attachments: [] })}>
                  <Paperclip size={16} /> ثبت کامنت / پیوست
                </button>
              </div>
            </div>
          )}

          {/* [اصلاح] درخواست برای اصلاح برگشته؛ پس از ویرایش باید دوباره ارسال شود */}
          {req.can_resubmit && (
            <div className="card card-pad" style={{ border: '1.5px solid var(--amber)', background: 'var(--amber-soft)' }}>
              <b style={{ display: 'block', marginBottom: 6 }}>این درخواست برای اصلاح به شما برگشت داده شده است</b>
              <p style={{ fontSize: 12.8, color: 'var(--text-2)', marginBottom: 12 }}>
                توضیحِ برگشت را در تاریخچه ببینید، فرم را اصلاح کنید و سپس دوباره ارسال کنید.
                پس از ارسال، درخواست از مرحلهٔ «{req.steps.find(s => s.step_order === req.resume_step)?.title || req.steps[0]?.title}» ادامه پیدا می‌کند.
              </p>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => setEdit({ title: req.title, data: { ...data } })}>
                  <Pencil size={16} /> ویرایش فرم
                </button>
                <button className="btn btn-primary" style={{ flex: 1 }} onClick={resubmit} disabled={busy}>
                  <Send size={16} /> ارسال مجدد
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* [ویرایش] عنوان و اطلاعات فرمِ درخواست — تغییرات در تاریخچه ثبت می‌شود */}
      {edit && (
        <Modal title={`ویرایش درخواست «${req.title}»`} onClose={() => setEdit(null)} wide
          footer={<>
            <button className="btn btn-ghost" onClick={() => setEdit(null)}>انصراف</button>
            <button className="btn btn-primary" disabled={busy || !edit.title.trim()} onClick={submitEdit}>ذخیره تغییرات</button>
          </>}>
          <p style={{ fontSize: 12.5, color: 'var(--text-2)', marginTop: 0 }}>
            تغییرات شما به‌همراه فهرست فیلدهای عوض‌شده در تاریخچهٔ درخواست ثبت می‌شود و
            {req.status === 'in_progress' ? ' مسئول مرحلهٔ فعلی هم مطلع می‌شود.' : ' درخواست‌دهنده مطلع می‌شود.'}
          </p>
          <Field label="عنوان درخواست">
            <input className="input" value={edit.title} autoFocus
              onChange={e => setEdit(v => ({ ...v, title: e.target.value }))} />
          </Field>
          <RequestFormFields schema={schema} data={edit.data} allowPast
            onChange={d => setEdit(v => ({ ...v, data: d }))} />
        </Modal>
      )}

      {/* [برگشت] برگرداندن درخواست به یک مرحلهٔ قبلی یا به خودِ درخواست‌دهنده برای اصلاح */}
      {ret && (
        <Modal title="برگشت درخواست" onClose={() => setRet(null)}
          footer={<>
            <button className="btn btn-ghost" onClick={() => setRet(null)}>انصراف</button>
            <button className="btn btn-danger" disabled={busy} onClick={submitReturn}>برگشت درخواست</button>
          </>}>
          <Field label="برگشت به کجا؟">
            <select className="input" value={ret.to_step} onChange={e => setRet(v => ({ ...v, to_step: Number(e.target.value) }))}>
              {canReturnToRequester && <option value={0}>درخواست‌دهنده ({req.requester_name}) — برای اصلاح فرم</option>}
              {returnTargets.map(s => (
                <option key={s.step_order} value={s.step_order}>
                  مرحلهٔ {s.step_order.toLocaleString('fa-IR')}: {s.title}
                </option>
              ))}
            </select>
          </Field>
          {Number(ret.to_step) === 0 && (
            <Field label="پس از اصلاح، از کدام مرحله ادامه پیدا کند؟"
              hint="درخواست‌دهنده فرم را اصلاح می‌کند و با «ارسال مجدد» درخواست از این مرحله ادامه می‌یابد.">
              <select className="input" value={ret.resume_step} onChange={e => setRet(v => ({ ...v, resume_step: Number(e.target.value) }))}>
                {req.steps.map(s => (
                  <option key={s.step_order} value={s.step_order}>
                    مرحلهٔ {s.step_order.toLocaleString('fa-IR')}: {s.title}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Field label="دلیل برگشت (توصیه می‌شود)">
            <textarea className="input" value={ret.comment} autoFocus
              placeholder="چه چیزی باید اصلاح یا بازبینی شود؟"
              onChange={e => setRet(v => ({ ...v, comment: e.target.value }))} />
          </Field>
          {req.can_attach_action && (
            <Field label="پیوست فایل (اختیاری)">
              <AttachmentPicker value={ret.attachments} onChange={v => setRet(x => ({ ...x, attachments: v }))} />
            </Field>
          )}
        </Modal>
      )}

      {/* [حذف] حذف کاملِ درخواست و تاریخچه‌اش — بازگشت‌ناپذیر */}
      {confirmDel && (
        <Modal title="حذف درخواست" onClose={() => setConfirmDel(false)}
          footer={<>
            <button className="btn btn-ghost" onClick={() => setConfirmDel(false)}>انصراف</button>
            <button className="btn btn-danger" disabled={busy} onClick={remove}>بله، حذف کن</button>
          </>}>
          <p style={{ fontSize: 13.5, margin: 0 }}>
            درخواست «{req.title}» به‌همراه تمام تاریخچهٔ اقدامات آن برای همیشه حذف می‌شود.
            این کار بازگشت‌پذیر نیست.
          </p>
        </Modal>
      )}

      {makeTask && (
        <Modal title="ساخت تسک از درخواست" onClose={() => setMakeTask(null)}
          footer={<>
            <button className="btn btn-ghost" onClick={() => setMakeTask(null)}>انصراف</button>
            <button className="btn btn-primary" disabled={busy} onClick={submitMakeTask}>ساخت تسک</button>
          </>}>
          <Field label="عنوان تسک">
            <input className="input" value={makeTask.title} onChange={e => setMakeTask(m => ({ ...m, title: e.target.value }))} />
          </Field>
          <Field label="مسئول تسک">
            <select className="input" value={makeTask.assignee_type} onChange={e => setMakeTask(m => ({ ...m, assignee_type: e.target.value }))}>
              <option value="requester">خودِ درخواست‌دهنده ({req.requester_name})</option>
              <option value="user">کاربر مشخص</option>
            </select>
          </Field>
          {makeTask.assignee_type === 'user' && (
            <Field label="انتخاب کاربر">
              <UserPicker value={makeTask.assignee_id} onChange={v => setMakeTask(m => ({ ...m, assignee_id: v }))} />
            </Field>
          )}
          <Field label="مهلت تسک (ساعت — ۰ = بدون مهلت)">
            <input className="input" type="number" min="0" value={makeTask.deadline_hours}
              onChange={e => setMakeTask(m => ({ ...m, deadline_hours: Number(e.target.value) }))} />
          </Field>
        </Modal>
      )}

      {confirm && (
        <Modal title={confirm === 'approve' ? 'تایید درخواست' : confirm === 'skip' ? 'عبور از مرحله' : 'رد درخواست'}
          onClose={() => { setConfirm(null); setActionFiles([]); }}
          footer={<>
            <button className="btn btn-ghost" onClick={() => { setConfirm(null); setActionFiles([]); }}>انصراف</button>
            <button className={`btn ${confirm === 'reject' ? 'btn-danger' : 'btn-primary'}`} onClick={act} disabled={busy}>
              {confirm === 'approve' ? 'تایید نهایی' : confirm === 'skip' ? 'عبور از این مرحله' : 'رد درخواست'}
            </button>
          </>}>
          <Field label="توضیحات (اختیاری)">
            <textarea className="input" value={comment} onChange={e => setComment(e.target.value)} autoFocus
              placeholder={confirm === 'reject' ? 'دلیل رد درخواست…' : 'توضیحات تکمیلی…'} />
          </Field>
          {/* [پیوست‌ها] تاییدکننده هم می‌تواند سند پیوست کند — اگر در این فرآیند/مرحله مجاز باشد */}
          {req.can_attach_action ? (
            <Field label="پیوست فایل (اختیاری)"
              hint="هر نوع فایلی: عکس، PDF، Word، Excel، فایل فشرده و … (هر فایل تا ۲۵ مگابایت)">
              <AttachmentPicker value={actionFiles} onChange={setActionFiles} />
            </Field>
          ) : (
            <div style={{ fontSize: 12.3, color: 'var(--text-3)', display: 'flex', alignItems: 'center', gap: 6 }}>
              <Paperclip size={13} /> پیوست فایل در این مرحله مجاز نیست.
            </div>
          )}
        </Modal>
      )}

      {/* [پیوست‌ها] یادداشت/پیوست بدون تغییر مرحله — برای افرادِ درگیر در سلسله‌مراتب */}
      {note && (
        <Modal title={req.can_attach_note ? 'افزودن یادداشت / پیوست فایل' : 'افزودن یادداشت'} onClose={() => setNote(null)}
          footer={<>
            <button className="btn btn-ghost" onClick={() => setNote(null)}>انصراف</button>
            <button className="btn btn-primary" disabled={busy || (!note.comment.trim() && !note.attachments.length)}
              onClick={submitNote}>ثبت</button>
          </>}>
          <p style={{ fontSize: 12.5, color: 'var(--text-2)', marginTop: 0 }}>
            این یادداشت مرحلهٔ درخواست را تغییر نمی‌دهد؛ فقط در تاریخچه ثبت می‌شود و برای درخواست‌دهنده و مسئول مرحلهٔ فعلی اعلان می‌رود.
          </p>
          <Field label="یادداشت">
            <textarea className="input" value={note.comment} autoFocus
              placeholder="توضیح دربارهٔ فایل پیوست…"
              onChange={e => setNote(n => ({ ...n, comment: e.target.value }))} />
          </Field>
          {req.can_attach_note ? (
            <Field label="پیوست فایل"
              hint="هر نوع فایلی: عکس، PDF، Word، Excel، فایل فشرده و … (هر فایل تا ۲۵ مگابایت)">
              <AttachmentPicker value={note.attachments} onChange={v => setNote(n => ({ ...n, attachments: v }))} />
            </Field>
          ) : (
            <div style={{ fontSize: 12.3, color: 'var(--text-3)', display: 'flex', alignItems: 'center', gap: 6 }}>
              <Paperclip size={13} /> پیوست فایل در این فرآیند مجاز نیست؛ فقط یادداشت متنی ثبت می‌شود.
            </div>
          )}
        </Modal>
      )}

      {/* [پرسش و پاسخ] */}
      {ask && (
        <Modal title="پرسش از همکار" onClose={() => setAsk(null)}
          footer={<>
            <button className="btn btn-ghost" onClick={() => setAsk(null)}>انصراف</button>
            <button className="btn btn-primary" disabled={busy || !ask.to_user_id || !ask.comment.trim()} onClick={submitAsk}>ارسال پرسش</button>
          </>}>
          <p style={{ fontSize: 12.5, color: 'var(--text-2)', marginTop: 0 }}>
            مرحلهٔ درخواست تغییر نمی‌کند؛ پرسش برای فردِ انتخاب‌شده اعلان می‌شود و تا پاسخ ندهد در کارتابلش می‌ماند.
          </p>
          <Field label="از چه کسی می‌پرسید؟">
            <UserPicker value={ask.to_user_id} exclude={[user.id]} onChange={v => setAsk(a => ({ ...a, to_user_id: v }))} />
          </Field>
          <Field label="پرسش">
            <textarea className="input" value={ask.comment} autoFocus
              onChange={e => setAsk(a => ({ ...a, comment: e.target.value }))} />
          </Field>
        </Modal>
      )}
      {answer && (
        <Modal title="پاسخ به پرسش" onClose={() => setAnswer(null)}
          footer={<>
            <button className="btn btn-ghost" onClick={() => setAnswer(null)}>انصراف</button>
            <button className="btn btn-primary" disabled={busy || (!answer.comment.trim() && !answer.attachments.length)} onClick={submitAnswer}>ثبت پاسخ</button>
          </>}>
          <div className="panel-soft card-pad" style={{ fontSize: 12.8, marginBottom: 12 }}>
            <b>{answer.question.actor_name}:</b> {answer.question.comment}
          </div>
          <Field label="پاسخ">
            <textarea className="input" value={answer.comment} autoFocus
              onChange={e => setAnswer(a => ({ ...a, comment: e.target.value }))} />
          </Field>
          {req.can_attach_note && (
            <Field label="پیوست فایل">
              <AttachmentPicker value={answer.attachments} onChange={v => setAnswer(a => ({ ...a, attachments: v }))} />
            </Field>
          )}
        </Modal>
      )}
    </div>
  );
}
