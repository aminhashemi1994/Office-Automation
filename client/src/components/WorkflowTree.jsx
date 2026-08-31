// ============================================================================
//  نمودار درختیِ گردش کار
//  کاربران گفتند فهرستِ مرحله‌ها را سخت می‌فهمند و نمی‌دانند «الان کجاست».
//  اینجا هر مرحله یک گره است، مسیر بینشان کشیده می‌شود، مرحلهٔ جاری برجسته است
//  و اگر روی مرحله‌ای یادداشت تازه‌ای ثبت شده باشد، روی همان گره نشان داده می‌شود.
//  رنگ به‌تنهایی حاملِ معنا نیست: هر گره آیکون و متنِ وضعیت هم دارد.
// ============================================================================
import React from 'react';
import { Check, X, Clock, MessageSquare, AlertTriangle, User, Flag } from 'lucide-react';
import { fa, fmtDateTime } from '../utils.js';

const STATE = {
  done: { label: 'انجام شد', cls: 'done', Icon: Check },
  current: { label: 'در انتظار اقدام', cls: 'current', Icon: Clock },
  rejected: { label: 'رد شد', cls: 'rejected', Icon: X },
  pending: { label: 'در نوبت', cls: '', Icon: null },
};

export default function WorkflowTree({ req, onStepClick, activeStep = null }) {
  const rejectedAt = req.actions?.find(a => a.action === 'reject')?.step_order ?? null;
  const finalStage = !!req.requester_final_approval || req.status === 'awaiting_requester';

  const nodes = (req.steps || []).map(s => {
    const isRejected = rejectedAt === s.step_order;
    const isCurrent = req.status === 'in_progress' && s.step_order === req.current_step;
    const isDone = req.status === 'approved' || req.status === 'awaiting_requester'
      || s.step_order < req.current_step;
    const key = isRejected ? 'rejected' : isDone ? 'done' : isCurrent ? 'current' : 'pending';
    const acts = (req.actions || []).filter(a => a.step_order === s.step_order);
    const decided = acts.find(a => ['approve', 'reject', 'skip'].includes(a.action));
    return {
      id: s.id, order: s.step_order, title: s.title, state: key,
      optional: !!s.is_optional,
      people: (s.approver_people || []).map(p => p.full_name),
      label: s.approver_label,
      hasApprovers: s.has_approvers !== 0,
      comments: acts.filter(a => a.action === 'comment' || a.action === 'ack').length,
      actor: decided?.actor_name || null,
      at: decided?.created_at || null,
      due: isCurrent ? req.step_due_at : null,
    };
  });

  if (finalStage) {
    nodes.push({
      id: 'final', order: nodes.length + 1, title: 'تایید نهایی درخواست‌دهنده',
      state: req.status === 'approved' ? 'done' : req.status === 'awaiting_requester' ? 'current' : 'pending',
      people: [req.requester_name], hasApprovers: true, comments: 0, isFinal: true,
    });
  }

  return (
    <div className="wf-tree">
      {nodes.map((n, i) => {
        const st = STATE[n.state] || STATE.pending;
        const Icon = st.Icon;
        return (
          <div key={n.id} className="wf-node-wrap">
            {i > 0 && <div className={`wf-link ${nodes[i - 1].state === 'done' ? 'passed' : ''}`} />}
            <button type="button" className={`wf-node ${st.cls} ${activeStep === n.order ? 'picked' : ''}`}
              onClick={() => onStepClick?.(n)}
              title={onStepClick
                ? `${n.people.length ? 'مسئول: ' + n.people.join('، ') + ' — ' : ''}برای دیدن اقدام‌های همین مرحله کلیک کنید`
                : (n.people.length ? `مسئول: ${n.people.join('، ')}` : n.label || '')}>
              <span className="wf-dot">
                {Icon ? <Icon size={15} /> : fa(n.order)}
              </span>
              <span className="wf-body">
                <span className="wf-title">
                  {n.isFinal ? <Flag size={12} style={{ verticalAlign: '-1px', marginInlineEnd: 4 }} /> : null}
                  {n.title}
                  {n.optional && <span className="badge badge-gray" style={{ marginInlineStart: 6 }}>اختیاری</span>}
                </span>
                <span className="wf-people">
                  <User size={11} style={{ verticalAlign: '-1px', marginInlineEnd: 3 }} />
                  {n.people.length ? n.people.join('، ') : (n.label || 'نامشخص')}
                </span>
                <span className="wf-meta">
                  <span className={`wf-state ${st.cls}`}>{st.label}</span>
                  {n.actor && <span>· {n.actor}</span>}
                  {n.at && <span>· {fmtDateTime(n.at)}</span>}
                  {n.due && <span>· مهلت {fmtDateTime(n.due)}</span>}
                </span>
              </span>
              <span className="wf-flags">
                {n.comments > 0 && (
                  <span className="badge badge-sky" title="یادداشت/پیام روی این مرحله">
                    <MessageSquare size={11} /> {fa(n.comments)}
                  </span>
                )}
                {!n.hasApprovers && (
                  <span className="badge badge-red" title="برای این مرحله مسئولی تعریف نشده است">
                    <AlertTriangle size={11} /> بدون مسئول
                  </span>
                )}
              </span>
            </button>
          </div>
        );
      })}
      {onStepClick && (
        <div style={{ fontSize: 11.3, color: 'var(--text-3)', marginTop: 10, lineHeight: 1.7 }}>
          روی هر مرحله بزنید تا فقط اقدام‌ها و یادداشت‌های همان مرحله را ببینید.
        </div>
      )}
    </div>
  );
}
