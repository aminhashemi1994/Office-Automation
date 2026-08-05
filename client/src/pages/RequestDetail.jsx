import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  ArrowRight, Check, X, Clock, Ban, SkipForward, Printer, Bell, ListTodo, Paperclip,
  Pencil, Undo2, Send, Trash2, ShieldCheck,
} from 'lucide-react';
import { api } from '../api.js';
import { useStore } from '../store.jsx';
import { fmtDateTime, parseDate, formatFieldValue } from '../utils.js';
import { Modal, Field, UserPicker } from '../components/common.jsx';
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
  const [busy, setBusy] = useState(false);
  const [makeTask, setMakeTask] = useState(null); // {title, assignee_type, assignee_id, deadline_hours}
  const [edit, setEdit] = useState(null);        // {title, data} — ویرایش عنوان و فرمِ درخواست
  const [ret, setRet] = useState(null);          // {to_step, resume_step, comment, attachments} — برگشت درخواست
  const [confirmDel, setConfirmDel] = useState(false);

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

  const cancel = async () => {
    setBusy(true);
    try { await api(`/workflows/requests/${req.id}/cancel`, { method: 'POST' }); await load(); refreshBadges(); toast('درخواست لغو شد'); }
    catch (e) { toast(e.message, 'error'); }
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
              {req.template_name} · {req.requester_name} ({req.requester_department || 'بدون واحد'}) · {fmtDateTime(req.created_at)}
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
          </div>

          <div className="card card-pad">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <b>تاریخچه اقدامات و پیوست‌ها</b>
              {/* [پیوست‌ها] هر فردِ درگیر در این سلسله‌مراتب می‌تواند فایل پیوست کند */}
              <button className="btn btn-ghost btn-sm" onClick={() => setNote({ comment: '', attachments: [] })}
                title={req.can_attach_note ? 'ثبت یادداشت و پیوست فایل' : 'در این فرآیند فقط یادداشت متنی مجاز است'}>
                <Paperclip size={14} /> {req.can_attach_note ? 'افزودن یادداشت / پیوست فایل' : 'افزودن یادداشت'}
              </button>
            </div>
            {req.actions.map(a => {
              const [al, ac] = ACTION_LABEL[a.action] || ACTION_LABEL.comment;
              const atts = toFileIds((() => { try { return JSON.parse(a.attachments || '[]'); } catch { return []; } })());
              return (
                <div key={a.id} style={{ display: 'flex', gap: 10, padding: '9px 0', borderBottom: '1px solid var(--border-soft)', alignItems: 'baseline' }}>
                  <span className={`badge ${ac}`}>{al}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <b style={{ fontSize: 13.3 }}>{a.actor_name}</b>
                    {a.comment && <div style={{ fontSize: 12.8, color: 'var(--text-2)' }}>{a.comment}</div>}
                    {atts.length > 0 && (
                      <div style={{ marginTop: 8 }}>
                        <AttachmentList ids={atts} thumb={84} title="پیوستِ این اقدام" />
                      </div>
                    )}
                  </div>
                  <span style={{ fontSize: 11.5, color: 'var(--text-3)' }}>{fmtDateTime(a.created_at)}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div>
          <div className="card card-pad" style={{ marginBottom: 18 }}>
            <b style={{ display: 'block', marginBottom: 16 }}>مراحل گردش کار</b>
            <div className="steps">
              {req.steps.map(s => {
                const isCurrent = req.status === 'in_progress' && s.step_order === req.current_step;
                // در «تایید نهایی درخواست‌دهنده» کل سلسله‌مراتب تایید شده است
                const isDone = req.status === 'approved' || req.status === 'awaiting_requester'
                  || s.step_order < req.current_step;
                const isRejected = rejectedAt === s.step_order;
                return (
                  <div key={s.id} className="step-row">
                    <div className={`step-dot ${isRejected ? 'rejected' : isDone ? 'done' : isCurrent ? 'current' : ''}`}>
                      {isRejected ? <X size={15} /> : isDone ? <Check size={15} /> : s.step_order.toLocaleString('fa-IR')}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: 13.8 }}>
                        {s.title}{!!s.is_optional && <span className="badge badge-gray" style={{ marginRight: 6 }}>اختیاری</span>}
                      </div>
                      <div style={{ fontSize: 12.3, color: 'var(--text-2)' }}>
                        {s.approver_label ? <span style={{ color: 'var(--text-3)' }}>{s.approver_label} — </span> : null}
                        مسئول: {(s.approver_people && s.approver_people.length)
                          ? s.approver_people.map(p => p.full_name).join('، ')
                          : (s.approvers && s.approvers.length ? s.approvers.map(userName).join('، ') : 'نامشخص')}
                      </div>
                      {isCurrent && req.step_due_at && (
                        <span className={`badge ${overdue ? 'badge-red' : 'badge-amber'}`} style={{ marginTop: 4 }}>
                          <Clock size={12} /> مهلت: {fmtDateTime(req.step_due_at)}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
              {/* [تایید نهایی درخواست‌دهنده] مرحلهٔ پایانیِ فرآیند — فقط اگر در این فرآیند فعال باشد */}
              {(req.status === 'awaiting_requester' || !!req.requester_final_approval) && (
                <div className="step-row">
                  <div className={`step-dot ${req.status === 'approved' ? 'done' : req.status === 'awaiting_requester' ? 'current' : ''}`}>
                    {req.status === 'approved' ? <Check size={15} /> : <ShieldCheck size={15} />}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: 13.8 }}>تایید نهایی درخواست‌دهنده</div>
                    <div style={{ fontSize: 12.3, color: 'var(--text-2)' }}>
                      <span style={{ color: 'var(--text-3)' }}>پس از طی همهٔ مراحل — </span>
                      مسئول: {req.requester_name}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

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
    </div>
  );
}
