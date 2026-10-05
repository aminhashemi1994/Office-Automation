// ============================================================================
//  نمودار درختیِ گردش کار
//  کاربران گفتند فهرستِ مرحله‌ها را سخت می‌فهمند و نمی‌دانند «الان کجاست».
//  بالای نمودار یک خلاصه است: نوارِ پیشرفتِ تکه‌تکه (هر مرحله یک تکه) و
//  «الان منتظرِ چه کسی است» همراه با اینکه دیده/دریافت کرده یا نه.
//  زیرش هر مرحله یک گره است؛ مرحلهٔ جاری برجسته و مراحلِ در نوبت کم‌رنگ‌اند.
//  رنگ به‌تنهایی حاملِ معنا نیست: هر گره آیکون و متنِ وضعیت هم دارد.
//  variant: vertical (صفحهٔ جزئیات) | horizontal (بازشده زیرِ ردیفِ کارتابل؛ روی موبایل عمودی می‌شود)
// ============================================================================
import React from 'react';
import { Check, X, Clock, MessageSquare, AlertTriangle, Flag, PenLine, Eye, EyeOff, Inbox } from 'lucide-react';
import { fa, fmtDateTime, initials } from '../utils.js';

const STATE = {
  done: { label: 'تایید شد', cls: 'done', Icon: Check },
  current: { label: 'در انتظار اقدام', cls: 'current', Icon: Clock },
  rejected: { label: 'رد شد', cls: 'rejected', Icon: X },
  pending: { label: 'در نوبت', cls: 'pending', Icon: null },
};

// وضعیتِ دیدن/دریافتِ مسئولِ مرحلهٔ جاری
function WatchPill({ p }) {
  if (p.received_at) return <span className="wf-pill ok" title={fmtDateTime(p.received_at)}><Inbox size={11} /> دریافت کرد</span>;
  if (p.seen_at) return <span className="wf-pill seen" title={fmtDateTime(p.seen_at)}><Eye size={11} /> دیده</span>;
  return <span className="wf-pill muted"><EyeOff size={11} /> هنوز ندیده</span>;
}

function Face({ p, size = 22 }) {
  return (
    <span className="wf-face" style={{ width: size, height: size, background: p.avatar_color || 'var(--primary)', fontSize: size * 0.4 }}
      title={p.full_name}>{initials(p.full_name)}</span>
  );
}

export default function WorkflowTree({ req, onStepClick, activeStep = null, variant = 'vertical' }) {
  const rejectedAt = req.actions?.find(a => a.action === 'reject')?.step_order ?? null;
  const finalStage = !!req.requester_final_approval || req.status === 'awaiting_requester';

  const nodes = (req.steps || []).map(s => {
    const isRejected = rejectedAt === s.step_order;
    const isCurrent = req.status === 'in_progress' && s.step_order === req.current_step;
    const isDone = req.status === 'approved' || req.status === 'awaiting_requester'
      || (s.step_order < req.current_step && !isRejected);
    const key = isRejected ? 'rejected' : isDone ? 'done' : isCurrent ? 'current' : 'pending';
    const acts = (req.actions || []).filter(a => a.step_order === s.step_order);
    const decided = [...acts].reverse().find(a => ['approve', 'reject', 'skip'].includes(a.action));
    const people = s.approver_people || [];
    // اگر نامِ مسئول در عنوانِ مرحله آمده، دوباره نوشته نشود
    const namesInTitle = people.length > 0 && people.every(p => s.title.includes(p.full_name));
    return {
      id: s.id, order: s.step_order, title: s.title, state: key,
      optional: !!s.is_optional,
      signature: s.requires_signature !== 0,
      signed: decided?.action === 'approve' && s.requires_signature !== 0,
      skipped: decided?.action === 'skip',
      people, namesInTitle,
      label: s.approver_label,
      hasApprovers: s.has_approvers !== 0,
      comments: acts.filter(a => ['comment', 'ack', 'receive'].includes(a.action)).length,
      watch: isCurrent ? (req.step_watch?.people || []) : null,
      actor: decided?.actor_name || null,
      at: decided?.created_at || null,
      due: isCurrent ? req.step_due_at : null,
    };
  });

  if (finalStage) {
    nodes.push({
      id: 'final', order: nodes.length + 1, title: 'تایید نهایی درخواست‌دهنده',
      state: req.status === 'approved' ? 'done' : req.status === 'awaiting_requester' ? 'current' : 'pending',
      people: [{ id: 0, full_name: req.requester_name }], namesInTitle: false,
      hasApprovers: true, comments: 0, isFinal: true,
    });
  }

  const real = nodes.filter(n => !n.isFinal);
  const doneCount = real.filter(n => n.state === 'done').length;
  const cur = nodes.find(n => n.state === 'current');
  const after = nodes.filter(n => n.state === 'pending');
  const closedOk = req.status === 'approved';
  const closedBad = req.status === 'rejected' || req.status === 'cancelled';
  const watchFor = (p) => cur?.watch?.find(w => w.id === p.id);

  return (
    <div className={`wf-tree wf-${variant}`}>
      {/* ---------- خلاصه ---------- */}
      {real.length > 0 && (
        <div className="wf-summary">
          <div className="wf-summary-head">
            <span className="wf-count"><b>{fa(doneCount)}</b> از {fa(real.length)} مرحله</span>
            {closedOk && <span className="wf-pill ok"><Check size={11} /> فرآیند کامل شد</span>}
            {req.status === 'rejected' && <span className="wf-pill bad"><X size={11} /> رد شد</span>}
            {req.status === 'cancelled' && <span className="wf-pill muted">لغو شد</span>}
            {req.status === 'returned' && <span className="wf-pill warn">برگشت برای اصلاح</span>}
          </div>
          <div className="wf-segs" aria-hidden="true">
            {real.map(n => <span key={n.id} className={`wf-seg ${n.state}`} />)}
          </div>
          {cur && (
            <div className="wf-waiting">
              <span className="wf-waiting-label">الان منتظرِ</span>
              {(cur.people.length ? cur.people : [{ id: -1, full_name: cur.label || 'نامشخص' }]).map(p => (
                <span key={p.id} className="wf-who">
                  <Face p={p} />
                  <b>{p.full_name}</b>
                  {watchFor(p) && <WatchPill p={watchFor(p)} />}
                </span>
              ))}
              {after.length > 0 && (
                <span className="wf-next">
                  بعد: {after.map(n => n.people.map(p => p.full_name).join('، ') || n.title).join(' ← ')}
                </span>
              )}
            </div>
          )}
          {!cur && !closedOk && !closedBad && req.status === 'returned' && (
            <div className="wf-next">درخواست برای اصلاح نزد درخواست‌دهنده است.</div>
          )}
        </div>
      )}

      {/* ---------- مراحل ---------- */}
      <ol className="wf-steps">
        {nodes.map((n) => {
          const st = STATE[n.state] || STATE.pending;
          const Icon = st.Icon;
          const clickable = !!onStepClick;
          return (
            <li key={n.id} className={`wf-step ${st.cls} ${activeStep === n.order ? 'picked' : ''}`}>
              <span className="wf-rail" aria-hidden="true" />
              <button type="button" className="wf-node" disabled={!clickable}
                onClick={() => onStepClick?.(n)}
                title={clickable ? 'برای دیدن اقدام‌ها و یادداشت‌های همین مرحله کلیک کنید' : undefined}>
                <span className="wf-dot">{Icon ? <Icon size={14} strokeWidth={2.6} /> : fa(n.order)}</span>
                <span className="wf-body">
                  <span className="wf-title">
                    {n.isFinal && <Flag size={12} />}
                    <span className="wf-title-text">{n.title}</span>
                  </span>
                  {!n.namesInTitle && n.people.length > 0 && (
                    <span className="wf-people">
                      {n.people.slice(0, 3).map(p => <Face key={p.id} p={p} size={18} />)}
                      <span>{n.people.map(p => p.full_name).join('، ')}</span>
                    </span>
                  )}
                  {!n.people.length && n.label && <span className="wf-people">{n.label}</span>}
                  <span className="wf-meta">
                    <span className={`wf-state ${st.cls}`}>{n.skipped ? 'عبور داده شد' : st.label}</span>
                    {n.state !== 'current' && n.actor && !n.namesInTitle && <span>· {n.actor}</span>}
                    {n.at && <span>· {fmtDateTime(n.at)}</span>}
                    {n.due && <span>· مهلت {fmtDateTime(n.due)}</span>}
                  </span>
                  {n.watch?.length > 0 && variant === 'vertical' && (
                    <span className="wf-watch">
                      {n.watch.map(p => (
                        <span key={p.id} className="wf-who sm">
                          {n.watch.length > 1 && <span>{p.full_name}</span>}
                          <WatchPill p={p} />
                        </span>
                      ))}
                    </span>
                  )}
                </span>
                <span className="wf-flags">
                  {n.signature && (
                    <span className={`wf-pill ${n.signed ? 'ok' : 'muted'}`}
                      title={n.signed ? 'تایید با امضا ثبت شد' : 'این مرحله با امضا تایید می‌شود'}>
                      <PenLine size={11} /> {n.signed ? 'امضا شد' : 'با امضا'}
                    </span>
                  )}
                  {n.optional && <span className="wf-pill muted">اختیاری</span>}
                  {n.comments > 0 && (
                    <span className="wf-pill seen" title="یادداشت/پیام روی این مرحله">
                      <MessageSquare size={11} /> {fa(n.comments)}
                    </span>
                  )}
                  {!n.hasApprovers && (
                    <span className="wf-pill bad" title="برای این مرحله مسئولی تعریف نشده است">
                      <AlertTriangle size={11} /> بدون مسئول
                    </span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      {onStepClick && (
        <div className="wf-hint">روی هر مرحله بزنید تا فقط اقدام‌ها و یادداشت‌های همان مرحله را ببینید.</div>
      )}
    </div>
  );
}

// نوارِ پیشرفتِ کوچک برای ردیف‌های فهرست
export function MiniProgress({ progress, status }) {
  if (!progress?.total) return null;
  const segs = Array.from({ length: progress.total }, (_, i) =>
    i < progress.done ? 'done' : (i === progress.done && status === 'in_progress') ? 'current'
      : (i === progress.done && status === 'rejected') ? 'rejected' : 'pending');
  return (
    <span className="wf-mini" title={`${fa(progress.done)} از ${fa(progress.total)} مرحله تایید شده`}>
      <span className="wf-mini-segs">{segs.map((s, i) => <span key={i} className={`wf-seg ${s}`} />)}</span>
      <span className="wf-mini-text">{fa(progress.done)}/{fa(progress.total)}</span>
    </span>
  );
}
