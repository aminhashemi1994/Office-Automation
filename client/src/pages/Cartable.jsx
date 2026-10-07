import React, { useEffect, useState, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Plus, Clock, Search, Paperclip, X, Check, GitBranch, CalendarCheck, Users2, Bell, Eye } from 'lucide-react';
import { api } from '../api.js';
import { useStore } from '../store.jsx';
import { fmtRelative, fmtDateTime, parseDate, fa } from '../utils.js';
import { Modal, Field, Avatar, MySignature } from '../components/common.jsx';
import { AttachmentList, AttachmentPicker, toFileIds as toIds } from '../components/Attachments.jsx';
import RequestFormFields, { validateRequestForm } from '../components/RequestForm.jsx';
import WorkflowTree, { MiniProgress } from '../components/WorkflowTree.jsx';

export const STATUS = {
  in_progress: ['در جریان', 'badge-primary'],
  // [تایید نهایی درخواست‌دهنده] همهٔ مراحل تایید شده و منتظر تایید نهاییِ خودِ درخواست‌دهنده است
  awaiting_requester: ['در انتظار تایید نهایی', 'badge-sky'],
  // [برگشت] برای اصلاح به درخواست‌دهنده برگشته و باید دوباره ارسال شود
  returned: ['برگشت برای اصلاح', 'badge-amber'],
  approved: ['تایید نهایی', 'badge-green'],
  rejected: ['رد شده', 'badge-red'],
  cancelled: ['لغو شده', 'badge-gray'],
};

// وضعیت‌هایی که درخواست هنوز باز است و مرحله/مهلت معنا دارد
export const OPEN_STATUSES = ['in_progress', 'awaiting_requester', 'returned'];

export default function Cartable() {
  const { user, users, departments, hasPerm, on, toast, setCartableCount } = useStore();
  const [tab, setTab] = useState('inbox');
  const [inbox, setInbox] = useState([]);
  const [mine, setMine] = useState([]);
  const [all, setAll] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [newReq, setNewReq] = useState(false);
  const [search, setSearch] = useState('');
  const [following, setFollowing] = useState([]); // [مسئول پیگیری] درخواست‌های فرآیندهایی که پیگیرشان هستم
  const [trees, setTrees] = useState({});         // {requestId: detail} — نمای درختیِ باز در فهرست
  const treesRef = useRef(trees); treesRef.current = trees;
  const [quick, setQuick] = useState(null); // {row, comment} — تایید و امضا از همین کارتابل
  const [busy, setBusy] = useState(false);
  // [ماژول‌های کارتابل] پاسخ‌های روزانهٔ امروزِ من (مثل «رخ داد / رخ نداد»)
  const [checkins, setCheckins] = useState([]);
  const [ciConfirm, setCiConfirm] = useState(null); // {item, option, comment}
  const [ciReport, setCiReport] = useState(null);   // {item, option} — فرم برای گزارش باز است
  const [ciStatus, setCiStatus] = useState(null);   // templateId — گزارشِ «چه کسی پاسخ داده»
  const [params, setParams] = useSearchParams();

  const myDept = departments.find(d => d.id === user.department_id);
  // مدیرِ حداقل یک واحد (مدل چندمدیره) یا مدیر سامانه/واحد مدیریت → دسترسی به «همه درخواست‌ها»
  const canBuild = hasPerm('workflows.manage') || user.role === 'manager'
    || departments.some(d => d.manager_id === user.id || (d.managers || []).some(m => m.id === user.id))
    || !!myDept?.is_management;

  const load = async () => {
    const [i, m, t, f] = await Promise.all([
      api('/workflows/requests/inbox'),
      api('/workflows/requests/mine'),
      api('/workflows/templates'),
      api('/workflows/requests/following').catch(() => ({ requests: [] })),
    ]);
    const ci = await api('/workflows/checkins/today').catch(() => ({ items: [], pending: 0 }));
    setCheckins(ci.items || []);
    setInbox(i.requests); setMine(m.requests); setFollowing(f.requests || []);
    // درخت‌های باز، با دادهٔ تازه به‌روز شوند
    Object.keys(treesRef.current).forEach(id => openTree(Number(id), true));
    setCartableCount(i.requests.length + (ci.pending || 0));
    setTemplates(t.templates.filter(x => x.is_active));
    if (canBuild) {
      const a = await api('/workflows/requests/all');
      setAll(a.requests);
    }
  };
  useEffect(() => { load(); return on('notification', load); }, []);
  // لینکِ اعلانِ پاسخ‌ها: /cartable?checkins=<templateId>
  useEffect(() => {
    const id = Number(params.get('checkins'));
    if (id) { setCiStatus(id); setParams({}, { replace: true }); }
  }, [params]);

  const submitCheckin = async (item, option, extra = {}) => {
    setBusy(true);
    try {
      const r = await api('/workflows/checkins', { method: 'POST',
        body: { template_id: item.template_id, option_key: option.key, ...extra } });
      setCiConfirm(null); setCiReport(null); await load();
      toast(`«${option.label}» ${r.signed ? 'با امضا ' : ''}ثبت شد`);
    } catch (e) { toast(e.message, 'error'); }
    setBusy(false);
  };
  const pickOption = (item, option) => {
    if (option.kind === 'report') setCiReport({ item, option });
    else setCiConfirm({ item, option, comment: '' });
  };
  // فرآیندهای روزانه‌ای که من پیگیرشان هستم
  const followedDaily = templates.filter(t => {
    if (t.owner_user_id !== user.id && t.created_by !== user.id) return false;
    try { return !!JSON.parse(t.daily_reminder || '{}')?.enabled && JSON.parse(t.quick_options || '[]').length > 0; }
    catch { return false; }
  });

  const quickApprove = async () => {
    setBusy(true);
    try {
      const r = await api(`/workflows/requests/${quick.row.id}/action`, { method: 'POST',
        body: { action: 'approve', comment: quick.comment } });
      setQuick(null); await load();
      toast(r.status === 'approved' ? 'تایید شد و درخواست بسته شد' : 'تایید شد و به مرحلهٔ بعد رفت');
    } catch (e) { toast(e.message, 'error'); }
    setBusy(false);
  };

  // [نمای درختی] باز/بسته کردنِ نمودارِ مسیر زیرِ همان ردیف
  const openTree = async (id, refresh = false) => {
    if (!refresh && trees[id]) { setTrees(t => { const n = { ...t }; delete n[id]; return n; }); return; }
    try {
      const r = await api(`/workflows/requests/${id}`);
      setTrees(t => ({ ...t, [id]: r.request }));
    } catch (e) { if (!refresh) toast(e.message, 'error'); }
  };

  const rowsAll = tab === 'inbox' ? inbox : tab === 'mine' ? mine : tab === 'following' ? following : all;
  const rows = rowsAll.filter(r => !search
    || r.title.includes(search) || r.template_name.includes(search)
    || (r.requester_name || '').includes(search));

  return (
    <div className="content">
      <div className="page-head">
        <div className="tabs">
          <button className={`tab ${tab === 'inbox' ? 'active' : ''}`} onClick={() => setTab('inbox')}>
            در انتظار اقدام من {(inbox.length + checkins.filter(c => !c.responded_at).length) > 0 && (
              <span className="badge-count">{(inbox.length + checkins.filter(c => !c.responded_at).length).toLocaleString('fa-IR')}</span>
            )}
          </button>
          <button className={`tab ${tab === 'mine' ? 'active' : ''}`} onClick={() => setTab('mine')}>درخواست‌های من</button>
          {(following.length > 0 || followedDaily.length > 0) && (
            <button className={`tab ${tab === 'following' ? 'active' : ''}`} onClick={() => setTab('following')}
              title="درخواست‌های فرآیندهایی که شما مسئول پیگیری‌شان هستید">
              پیگیری فرآیندها
              {following.filter(r => r.status === 'in_progress').length > 0 && (
                <span className="badge-count">{fa(following.filter(r => r.status === 'in_progress').length)}</span>
              )}
            </button>
          )}
          {canBuild && (
            <button className={`tab ${tab === 'all' ? 'active' : ''}`} onClick={() => setTab('all')}>همه درخواست‌ها</button>
          )}
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <div style={{ position: 'relative' }}>
            <Search size={15} style={{ position: 'absolute', right: 11, top: 11, color: 'var(--text-3)' }} />
            <input className="input" style={{ paddingRight: 34, width: 220 }} placeholder="جستجوی درخواست…"
              value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <button className="btn btn-primary" onClick={() => setNewReq(true)}><Plus size={17} /> درخواست جدید</button>
        </div>
      </div>

      {/* [ماژول‌های کارتابل] پاسخِ روزانه با یک کلیک */}
      {tab === 'inbox' && checkins.length > 0 && (
        <div style={{ display: 'grid', gap: 10, marginBottom: 14 }}>
          {checkins.map(c => (
            <div key={c.template_id} className="card card-pad"
              style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
                borderInlineStart: `4px solid ${c.responded_at ? 'var(--green)' : 'var(--amber)'}` }}>
              <CalendarCheck size={20} style={{ color: c.responded_at ? 'var(--green)' : 'var(--amber)' }} />
              <div style={{ flex: 1, minWidth: 180 }}>
                <b>{c.template_name}</b>
                <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>
                  {c.responded_at ? <>پاسخ امروز ثبت شد: <b>{c.option_label}</b> · {fmtRelative(c.responded_at)}</> : 'پاسخ امروز را ثبت کنید'}
                </div>
              </div>
              {c.responded_at ? (
                <>
                  <span className="badge badge-green"><Check size={12} /> {c.option_label}</span>
                  {c.request_id && <Link className="btn btn-ghost btn-sm" to={`/cartable/${c.request_id}`}>دیدن گزارش</Link>}
                </>
              ) : c.options.map(o => (
                <button key={o.key} className={`btn btn-sm ${o.kind === 'report' ? 'btn-ghost' : 'btn-primary'}`}
                  disabled={busy} onClick={() => pickOption(c, o)}>
                  {o.kind === 'report' ? <Plus size={14} /> : <Check size={14} />} {o.label}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
      {/* [پیگیری] چه کسانی امروز پاسخ داده‌اند */}
      {tab === 'following' && followedDaily.length > 0 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
          {followedDaily.map(t => (
            <button key={t.id} className="btn btn-ghost" onClick={() => setCiStatus(t.id)}>
              <Users2 size={15} /> پاسخ‌های امروز: {t.name}
            </button>
          ))}
        </div>
      )}

      <div className="card">
        {rows.length === 0 ? (
          <div className="empty">درخواستی وجود ندارد</div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>عنوان</th>
                <th>فرآیند</th>
                {tab !== 'mine' && <th>درخواست‌دهنده</th>}
                <th>وضعیت / مرحله</th>
                <th>مهلت مرحله</th>
                <th>ثبت</th>
                {tab === 'inbox' && <th></th>}
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const [sl, sc] = STATUS[r.status] || STATUS.in_progress;
                const overdue = r.status === 'in_progress' && r.step_due_at && parseDate(r.step_due_at) < new Date();
                return (
                  <React.Fragment key={r.id}>
                  <tr>
                    <td>
                      <Link to={`/cartable/${r.id}`} style={{ fontWeight: 600, color: 'var(--primary)' }}>{r.title}</Link>
                      <button className={`btn btn-sm ${trees[r.id] ? 'btn-primary' : 'btn-ghost'}`} style={{ marginRight: 6, padding: '2px 8px' }}
                        title="نمایش درختیِ مسیر: الان کجاست و تایید چه کسی مانده" onClick={() => openTree(r.id)}>
                        <GitBranch size={13} /> درختی
                      </button>
                      {/* [پیوست‌ها] نشانِ «این درخواست فایل پیوست دارد» */}
                      {r.attachments_count > 0 && (
                        <span className="badge badge-sky" style={{ marginRight: 6 }}
                          title={`${r.attachments_count.toLocaleString('fa-IR')} فایل پیوست دارد`}>
                          <Paperclip size={11} /> {r.attachments_count.toLocaleString('fa-IR')}
                        </span>
                      )}
                    </td>
                    <td>{r.template_name}</td>
                    {tab !== 'mine' && <td>{r.requester_name}</td>}
                    <td>
                      <span className={`badge ${sc}`}>{sl}</span>
                      <MiniProgress progress={r.progress} status={r.status} />
                      {r.open_questions > 0 && (
                        <span className="badge badge-sky" style={{ marginRight: 6 }}>{fa(r.open_questions)} پرسش بی‌پاسخ</span>
                      )}
                      {r.step_title && (
                        <span style={{ fontSize: 12, color: 'var(--text-2)', marginRight: 6 }}>{r.step_title}</span>
                      )}
                      {/* [ردیابی مرحله] مسئولِ مرحلهٔ فعلی دیده / دریافت کرده؟ */}
                      {r.step_watch && (
                        <span className={`badge ${r.step_watch.received ? 'badge-green' : r.step_watch.seen ? 'badge-sky' : 'badge-gray'}`}
                          style={{ marginRight: 6 }}>
                          {r.step_watch.received ? 'دریافت شد' : r.step_watch.seen ? 'دیده شد' : 'هنوز ندیده'}
                        </span>
                      )}
                    </td>
                    <td>
                      {r.status === 'in_progress' && r.step_due_at ? (
                        <span className={`badge ${overdue ? 'badge-red' : 'badge-gray'}`}>
                          <Clock size={12} /> {fmtDateTime(r.step_due_at)}
                        </span>
                      ) : '—'}
                    </td>
                    <td style={{ color: 'var(--text-3)', fontSize: 12.5 }}>{fmtRelative(r.created_at)}</td>
                    {tab === 'inbox' && (
                      <td>
                        {r.can_quick_approve && (
                          <button className="btn btn-primary btn-sm" style={{ whiteSpace: 'nowrap' }} onClick={() => setQuick({ row: r, comment: '' })}>
                            <Check size={14} /> {r.step_requires_signature ? 'تایید و امضا' : 'تایید'}
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                  {trees[r.id] && (
                    <tr className="wf-row-panel">
                      <td colSpan={10}>
                        <div className="wf-panel-inner">
                          <WorkflowTree req={trees[r.id]} variant="horizontal" />
                        </div>
                      </td>
                    </tr>
                  )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {quick && (
        <Modal title={`تایید: ${quick.row.title}`} onClose={() => setQuick(null)}
          footer={<>
            <button className="btn btn-ghost" onClick={() => setQuick(null)}>انصراف</button>
            <Link className="btn btn-ghost" to={`/cartable/${quick.row.id}`}>دیدن جزئیات</Link>
            <button className="btn btn-primary" disabled={busy} onClick={quickApprove}>
              <Check size={16} /> {quick.row.step_requires_signature ? 'تایید و امضا' : 'تایید'}
            </button>
          </>}>
          <div className="req-meta">
            <span>فرآیند: <b>{quick.row.template_name}</b></span>
            <span>مرحله: <b>{quick.row.step_title}</b></span>
            <span>درخواست‌دهنده: <b>{quick.row.requester_name}</b></span>
          </div>
          {quick.row.step_requires_signature ? <Field label="امضای شما"><MySignature /></Field> : null}
          <Field label="پی‌نوشت (اختیاری)">
            <textarea className="input" value={quick.comment} autoFocus
              onChange={e => setQuick(q => ({ ...q, comment: e.target.value }))} />
          </Field>
        </Modal>
      )}

      {ciConfirm && (
        <Modal title={`${ciConfirm.item.template_name}: ${ciConfirm.option.label}`} onClose={() => setCiConfirm(null)}
          footer={<>
            <button className="btn btn-ghost" onClick={() => setCiConfirm(null)}>انصراف</button>
            <button className="btn btn-primary" disabled={busy}
              onClick={() => submitCheckin(ciConfirm.item, ciConfirm.option, { comment: ciConfirm.comment })}>
              <Check size={16} /> {ciConfirm.item.requires_signature ? 'ثبت و امضا' : 'ثبت'}
            </button>
          </>}>
          <p style={{ fontSize: 13, marginTop: 0 }}>
            پاسخِ امروزِ شما برای «{ciConfirm.item.template_name}»: <b>{ciConfirm.option.label}</b>
          </p>
          {ciConfirm.item.requires_signature ? <Field label="امضای شما"><MySignature /></Field> : null}
          <Field label="توضیح (اختیاری)">
            <textarea className="input" value={ciConfirm.comment}
              onChange={e => setCiConfirm(q => ({ ...q, comment: e.target.value }))} />
          </Field>
        </Modal>
      )}
      {ciReport && (
        <NewRequestModal templates={templates} presetTplId={ciReport.item.template_id}
          onClose={() => setCiReport(null)}
          onDone={(id) => { const { item, option } = ciReport; setCiReport(null); submitCheckin(item, option, { request_id: id }); }} />
      )}
      {ciStatus && <CheckinStatusModal templateId={ciStatus} onClose={() => setCiStatus(null)} />}
      {newReq && <NewRequestModal templates={templates} onClose={() => setNewReq(false)} onDone={() => { setNewReq(false); setTab('mine'); load(); toast('درخواست شما ثبت شد'); }} />}
    </div>
  );
}

// نگه‌داری نام‌های قبلی برای سازگاری با کدهایی که از این ماژول import می‌کنند
export const toFileIds = toIds;
export const toImageIds = toIds; // نام قبلی — برای سازگاری

// فرآیندها را بر اساس واحدِ مرتبطشان دسته‌بندی می‌کند.
// یک فرآیند می‌تواند به چند واحد مربوط باشد و در هر گروه دیده می‌شود؛
// فرآیندهایی که واحد مشخصی ندارند در گروه «عمومی» می‌آیند.
const GENERAL = '__general__';
function groupTemplates(templates, departments) {
  const groups = new Map(); // key → { key, name, items[] }
  const put = (key, name, tpl) => {
    if (!groups.has(key)) groups.set(key, { key, name, items: [] });
    groups.get(key).items.push(tpl);
  };
  for (const t of templates) {
    let scope = [];
    try { scope = JSON.parse(t.scope_dept_ids || '[]'); } catch {}
    scope = (Array.isArray(scope) ? scope : []).map(Number).filter(Boolean);
    if (!scope.length) { put(GENERAL, 'عمومی (همهٔ واحدها)', t); continue; }
    for (const id of scope) {
      const d = departments.find(x => x.id === id);
      put(String(id), d ? d.name : `واحد ${id}`, t);
    }
  }
  // «عمومی» همیشه آخر بیاید تا واحدها جلوتر دیده شوند
  return [...groups.values()].sort((a, b) =>
    (a.key === GENERAL ? 1 : 0) - (b.key === GENERAL ? 1 : 0) || a.name.localeCompare(b.name, 'fa'));
}

function NewRequestModal({ templates, onClose, onDone, presetTplId }) {
  const { toast, settings, user, users, departments } = useStore();
  const attOff = settings?.attachments_enabled === '0'; // [پیوست‌ها] کلید سراسری
  const groups = groupTemplates(templates, departments);
  // پیش‌فرض روی واحدِ خودِ کاربر — بیشترِ درخواست‌ها همان‌جاست
  const [groupKey, setGroupKey] = useState(() => {
    const preset = presetTplId && groups.find(g => g.items.some(t => t.id === presetTplId));
    if (preset) return preset.key;
    const mine = groups.find(g => g.key === String(user?.department_id));
    return (mine || groups[0])?.key || GENERAL;
  });
  const group = groups.find(g => g.key === groupKey) || groups[0];
  const groupItems = group?.items || [];
  const [tplId, setTplId] = useState(presetTplId || groupItems[0]?.id || '');
  const [title, setTitle] = useState('');
  const [data, setData] = useState({});
  const [busy, setBusy] = useState(false);
  const [previewSteps, setPreviewSteps] = useState([]);
  // [پیوست عمومی] فایل‌هایی که به خودِ درخواست وصل می‌شوند، مستقل از فیلدهای فرم
  const [attachments, setAttachments] = useState([]);
  // [ثبت به نمایندگی]
  const [onBehalfId, setOnBehalfId] = useState('');
  const [onBehalfName, setOnBehalfName] = useState('');
  // [رونوشت]
  const [cc, setCc] = useState([]);
  // [مسیر پویا] { [step_id]: { approvers, deadline_hours, skip } }
  const [routing, setRouting] = useState({});
  const tpl = groupItems.find(t => t.id === Number(tplId));
  // مرحله‌هایی که هنگام ثبت باید دربارهٔ آن‌ها تصمیم گرفت
  const dynSteps = (previewSteps.length ? previewSteps : (tpl?.steps || []))
    .filter(st => st.dynamic_approver || st.dynamic_deadline || st.skippable_at_submit);
  let schema = [];
  try { schema = JSON.parse(tpl?.form_schema || '[]'); } catch {}
  const pastDays = Number(tpl?.past_days_limit) || 0;

  // با عوض‌شدن واحد، اولین فرآیندِ همان واحد انتخاب می‌شود
  const pickGroup = (key) => {
    setGroupKey(key);
    const first = (groups.find(g => g.key === key)?.items || [])[0];
    setTplId(first?.id || '');
    setData({});
    setRouting({}); setCc([]); setOnBehalfId(''); setOnBehalfName('');
  };

  // زنجیره تایید را با نام دقیق افراد برای این درخواست‌دهنده نمایش بده
  useEffect(() => { setRouting({}); setCc([]); }, [tplId]);

  useEffect(() => {
    if (!tplId) { setPreviewSteps([]); return; }
    let alive = true;
    api(`/workflows/templates/${tplId}/preview`)
      .then(r => { if (alive) setPreviewSteps(r.steps); })
      .catch(() => { if (alive) setPreviewSteps([]); });
    return () => { alive = false; };
  }, [tplId]);

  const submit = async () => {
    const err = validateRequestForm(schema, data, { attachmentsOff: attOff, pastDays });
    if (err) return toast(err, 'error');
    if (Number(tpl?.cc_mode) === 2 && !cc.length) return toast('برای این فرآیند انتخاب حداقل یک گیرندهٔ رونوشت الزامی است', 'error');
    // مرحلهٔ پویا باید تاییدکننده داشته باشد، وگرنه درخواست روی هوا می‌ماند
    for (const st of dynSteps) {
      if (routing[st.id]?.skip) continue;
      const picked = routing[st.id]?.approvers || [];
      if (st.dynamic_approver && !picked.length && !st.approver_people?.length) {
        return toast(`برای مرحلهٔ «${st.title}» باید تاییدکننده انتخاب کنید`, 'error');
      }
    }
    setBusy(true);
    try {
      const r = await api('/workflows/requests', { method: 'POST', body: {
        template_id: tpl.id, title, form_data: data,
        attachments: toIds(attachments),
        on_behalf_id: onBehalfId ? Number(onBehalfId) : null,
        on_behalf_name: onBehalfId ? '' : onBehalfName,
        cc, routing,
      } });
      if (r.warning) toast(r.warning, 'error');
      onDone(r.id);
    } catch (e) { toast(e.message, 'error'); }
    setBusy(false);
  };

  return (
    <Modal title="ثبت درخواست جدید" onClose={onClose} wide
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>انصراف</button>
        <button className="btn btn-primary" disabled={!tpl || !title.trim() || busy} onClick={submit}>ثبت درخواست</button>
      </>}>
      {/* اول واحد، بعد فرآیندهای همان واحد — فهرست بلندِ همهٔ فرآیندها گیج‌کننده بود */}
      <div className="form-row-wide">
        <Field label="واحد / بخش">
          <select className="input" value={groupKey} onChange={e => pickGroup(e.target.value)}>
            {groups.map(g => (
              <option key={g.key} value={g.key}>
                {g.name} ({g.items.length.toLocaleString('fa-IR')})
              </option>
            ))}
            {!groups.length && <option value="">فرآیندی در دسترس نیست</option>}
          </select>
        </Field>
        <Field label="نوع فرآیند">
          <select className="input" value={tplId} onChange={e => { setTplId(e.target.value); setData({}); }}>
            {groupItems.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            {!groupItems.length && <option value="">فرآیندی برای این واحد تعریف نشده</option>}
          </select>
        </Field>
      </div>
      {tpl?.description && <p style={{ fontSize: 12.8, color: 'var(--text-2)', margin: '-6px 0 14px' }}>{tpl.description}</p>}

      {/* [درخواست‌کننده] همیشه پیدا باشد که این درخواست به نام چه کسی ثبت می‌شود */}
      <div className="panel-soft card-pad" style={{ marginBottom: 14, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <Avatar name={user.full_name} color={user.avatar_color} size={34} avatar={user.avatar_path} />
        <div style={{ flex: 1, minWidth: 160 }}>
          <div style={{ fontSize: 12, color: 'var(--text-3)' }}>درخواست‌کننده</div>
          <b style={{ fontSize: 13.5 }}>{user.full_name}</b>
          <span style={{ fontSize: 12.3, color: 'var(--text-2)' }}>
            {' '}· {departments.find(d => d.id === user.department_id)?.name || 'بدون واحد'}
            {user.position ? ` · ${user.position}` : ''}
          </span>
        </div>
        {onBehalfId || onBehalfName ? (
          <span className="badge badge-amber">از طرفِ: {
            onBehalfId ? (users.find(u => u.id === Number(onBehalfId))?.full_name || '—') : onBehalfName
          }</span>
        ) : null}
      </div>

      {/* [ثبت به نمایندگی] فقط اگر در تعریف فرآیند فعال شده باشد */}
      {!!tpl?.allow_on_behalf && (
        <Field label="این درخواست از طرفِ چه کسی است؟ (اختیاری)"
          hint="اگر برای همکار دیگری ثبت می‌کنید انتخابش کنید. اگر آن شخص حساب کاربری ندارد، نامش را در کادر دوم بنویسید. در هر حال ثبت‌کننده شما باقی می‌مانید.">
          <div className="form-row">
            <select className="input" value={onBehalfId}
              onChange={e => { setOnBehalfId(e.target.value); if (e.target.value) setOnBehalfName(''); }}>
              <option value="">— خودم —</option>
              {users.filter(u => u.is_active && u.id !== user.id)
                .map(u => <option key={u.id} value={u.id}>{u.full_name}{u.department_name ? ` (${u.department_name})` : ''}</option>)}
            </select>
            <input className="input" placeholder="یا نام شخصِ بدون حساب کاربری" value={onBehalfName}
              disabled={!!onBehalfId} onChange={e => setOnBehalfName(e.target.value)} />
          </div>
        </Field>
      )}
      {/* [مورد ۲] فایل‌های راهنمای فرآیند (عکس یا هر سند دیگر) */}
      {(() => { let atts = []; try { atts = JSON.parse(tpl?.attachments || '[]'); } catch {} return atts.length ? (
        <div style={{ marginBottom: 14 }}>
          <AttachmentList ids={atts} thumb={96} title="فایل‌های راهنمای این فرآیند" />
        </div>
      ) : null; })()}
      <Field label="عنوان درخواست">
        <input className="input" value={title} onChange={e => setTitle(e.target.value)}
          placeholder={tpl?.title_placeholder || 'مثلاً: خرید ۵۰ کیلوگرم مس'} />
      </Field>
      {pastDays > 0 && schema.some(f => f.type === 'date') && (
        <p style={{ fontSize: 12.3, color: 'var(--text-2)', margin: '-4px 0 12px' }}>
          برای این فرآیند می‌توانید تا {pastDays.toLocaleString('fa-IR')} روزِ گذشته هم تاریخ انتخاب کنید.
        </p>
      )}
      <RequestFormFields schema={schema} data={data} onChange={setData} pastDays={pastDays} />

      {/* [پیوست عمومی] مستقل از فیلدهای فرم — همیشه می‌شود PDF/اسکن/عکس گذاشت */}
      {!attOff && tpl?.allow_attachments !== 0 && (
        <Field label="پیوست فایل (اختیاری)"
          hint="هر نوع سندی: PDF، Word، Excel، عکس، فایل فشرده و … . این فایل‌ها به خودِ درخواست وصل می‌شوند و همهٔ تاییدکنندگان می‌بینندشان.">
          <AttachmentPicker value={attachments} onChange={setAttachments}
            placeholder="انتخاب فایل" label="افزودن فایل" thumb={84} />
        </Field>
      )}

      {/* [مسیر پویا] مرحله‌هایی که در هر درخواست فرق می‌کنند */}
      {dynSteps.length > 0 && (
        <div className="card-pad panel-soft" style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 12.8, fontWeight: 700, marginBottom: 4 }}>مسیر تایید این درخواست</div>
          <p style={{ fontSize: 11.8, color: 'var(--text-3)', margin: '0 0 10px', lineHeight: 1.85 }}>
            این مرحله‌ها در هر درخواست فرق می‌کنند. آنچه اینجا انتخاب می‌کنید فقط برای همین درخواست ثبت می‌شود.
          </p>
          {dynSteps.map(st => {
            const cfg = routing[st.id] || {};
            const set = (patch) => setRouting(r0 => ({ ...r0, [st.id]: { ...(r0[st.id] || {}), ...patch } }));
            const picked = cfg.approvers || [];
            return (
              <div key={st.id} style={{
                padding: '10px 12px', borderRadius: 10, background: 'var(--bg-1)',
                border: '1px solid var(--border-soft)', marginBottom: 8, opacity: cfg.skip ? .55 : 1,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                  <b style={{ fontSize: 13 }}>{st.title}</b>
                  {!!st.skippable_at_submit && (
                    <label style={{ marginInlineStart: 'auto', display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer' }}>
                      <input type="checkbox" checked={!!cfg.skip} style={{ width: 15, height: 15 }}
                        onChange={e => set({ skip: e.target.checked })} />
                      این مرحله لازم نیست
                    </label>
                  )}
                </div>
                {!cfg.skip && <>
                  {!!st.dynamic_approver && (
                    <div style={{ marginBottom: 8 }}>
                      <div style={{ fontSize: 11.5, color: 'var(--text-3)', marginBottom: 5 }}>
                        چه کسانی تایید کنند؟ {picked.length === 0 && (
                          <span>(پیش‌فرض: {st.approver_label || 'تعیین‌نشده'})</span>
                        )}
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
                        {picked.map((a, k) => (
                          <span key={k} className="badge badge-sky" style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                            {(() => {
                              if (a.approver_type === 'user') return users.find(u => u.id === a.approver_id)?.full_name || '—';
                              const d = departments.find(x => x.id === a.approver_id);
                              const who = a.approver_type === 'dept_head' ? (d?.heads || []) : (d?.directors || []);
                              const role = a.approver_type === 'dept_head' ? 'سرگروه' : 'مدیر';
                              return who.length
                                ? `${role} ${d?.name || ''}: ${who.map(x => x.full_name).join('، ')}`
                                : `${role} ${d?.name || ''} (تعیین‌نشده)`;
                            })()}
                            <X size={12} style={{ cursor: 'pointer' }}
                              onClick={() => set({ approvers: picked.filter((_, j) => j !== k) })} />
                          </span>
                        ))}
                      </div>
                      <div className="form-row">
                        <select className="input" value="" onChange={e => {
                          const [type, id] = e.target.value.split(':');
                          if (!type) return;
                          set({ approvers: [...picked, { approver_type: type, approver_id: Number(id) }] });
                        }}>
                          <option value="">+ افزودن واحد…</option>
                          {/* نامِ واقعیِ سرگروه/مدیر کنار نام واحد می‌آید تا انتخاب کورکورانه نباشد */}
                          <optgroup label="سرگروهِ واحد">
                            {departments.map(d => (
                              <option key={`h${d.id}`} value={`dept_head:${d.id}`} disabled={!(d.heads || []).length}>
                                {d.name}{(d.heads || []).length ? ` — ${d.heads.map(h => h.full_name).join('، ')}` : ' — سرگروه ندارد'}
                              </option>
                            ))}
                          </optgroup>
                          <optgroup label="مدیرِ واحد">
                            {departments.map(d => (
                              <option key={`m${d.id}`} value={`dept_director:${d.id}`} disabled={!(d.directors || []).length}>
                                {d.name}{(d.directors || []).length ? ` — ${d.directors.map(m => m.full_name).join('، ')}` : ' — مدیر ندارد'}
                              </option>
                            ))}
                          </optgroup>
                        </select>
                        <select className="input" value="" onChange={e => {
                          const id = Number(e.target.value);
                          if (id) set({ approvers: [...picked, { approver_type: 'user', approver_id: id }] });
                        }}>
                          <option value="">+ افزودن شخص…</option>
                          {users.filter(u => u.is_active).map(u => (
                            <option key={u.id} value={u.id}>{u.full_name}{u.department_name ? ` (${u.department_name})` : ''}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  )}
                  {!!st.dynamic_deadline && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 11.5, color: 'var(--text-3)' }}>مهلت این مرحله (ساعت):</span>
                      <input className="input" type="number" min="0" style={{ width: 110 }}
                        placeholder={String(st.deadline_hours || 0)}
                        value={cfg.deadline_hours ?? ''} onChange={e => set({ deadline_hours: e.target.value })} />
                      <span style={{ fontSize: 11.3, color: 'var(--text-3)' }}>خالی = پیش‌فرضِ فرآیند ({fa(st.deadline_hours || 0)} ساعت)</span>
                    </div>
                  )}
                </>}
              </div>
            );
          })}
        </div>
      )}

      {/* [رونوشت] */}
      {Number(tpl?.cc_mode) > 0 && (
        <Field label={`رونوشت به${Number(tpl.cc_mode) === 2 ? ' *' : ' (اختیاری)'}`}
          hint={tpl.cc_require_ack
            ? 'گیرندگان رونوشت تاییدکننده نیستند؛ فقط در جریان قرار می‌گیرند و باید «دریافت شد» بزنند.'
            : 'گیرندگان رونوشت فقط در جریان قرار می‌گیرند و تاییدکننده نیستند.'}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
            {cc.length === 0 && <span style={{ fontSize: 12, color: 'var(--text-3)' }}>کسی انتخاب نشده است.</span>}
            {cc.map(id => (
              <span key={id} className="badge badge-gray" style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                {users.find(u => u.id === id)?.full_name || '—'}
                <X size={12} style={{ cursor: 'pointer' }} onClick={() => setCc(c => c.filter(x => x !== id))} />
              </span>
            ))}
          </div>
          <select className="input" value="" onChange={e => {
            const id = Number(e.target.value);
            if (id && !cc.includes(id)) setCc(c => [...c, id]);
          }}>
            <option value="">+ افزودن گیرندهٔ رونوشت…</option>
            {users.filter(u => u.is_active && u.id !== user.id && !cc.includes(u.id))
              .map(u => <option key={u.id} value={u.id}>{u.full_name}{u.department_name ? ` (${u.department_name})` : ''}</option>)}
          </select>
        </Field>
      )}
      {/* پیش‌نمایشِ مسیر تایید — عمداً پایینِ فرم است: «قبل از ثبت ببین کجا می‌رود» */}
      {tpl && (
        <div className="card-pad panel-soft" style={{ marginTop: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <b style={{ fontSize: 12.8 }}>این درخواست به ترتیب پیشِ چه کسانی می‌رود؟</b>
            <span className="badge badge-gray">{fa((previewSteps.length ? previewSteps : tpl.steps || []).length)} مرحله</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            {(previewSteps.length ? previewSteps : tpl.steps || []).map((st, i2) => {
              const skipped = routing[st.id]?.skip;
              const picked = routing[st.id]?.approvers || [];
              const names = picked.length
                ? picked.map(a => a.approver_type === 'user'
                    ? (users.find(u => u.id === a.approver_id)?.full_name || '—')
                    : `${a.approver_type === 'dept_head' ? 'سرگروه' : 'مدیر'} ${departments.find(d => d.id === a.approver_id)?.name || ''}`).join('، ')
                : (st.approver_people || []).map(p2 => p2.full_name).join('، ');
              return (
                <div key={st.id || i2} style={{ display: 'flex', gap: 8, alignItems: 'baseline', fontSize: 12.7,
                  opacity: skipped ? .45 : 1, textDecoration: skipped ? 'line-through' : 'none' }}>
                  <span className={`badge ${st.is_optional ? 'badge-gray' : 'badge-primary'}`} style={{ flexShrink: 0 }}>
                    {fa(i2 + 1)}. {st.title}{st.is_optional ? ' (اختیاری)' : ''}
                  </span>
                  <span style={{ color: names ? 'var(--text-2)' : 'var(--red)' }}>
                    ← {skipped ? 'حذف شد' : (names || 'هنوز مسئولی ندارد — به مدیر سامانه می‌رود')}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </Modal>
  );
}

// [پیگیری ماژول‌ها] امروز چه کسی دیده، چه کسی پاسخ داده و چه کسی هنوز ندیده
function CheckinStatusModal({ templateId, onClose }) {
  const { toast } = useStore();
  const [data, setData] = useState(null);
  useEffect(() => {
    api(`/workflows/checkins/status/${templateId}`).then(setData)
      .catch(e => { toast(e.message, 'error'); onClose(); });
  }, [templateId]);
  if (!data) return null;
  const responded = data.people.filter(p => p.responded_at);
  const seenOnly = data.people.filter(p => !p.responded_at && p.seen_at);
  const notSeen = data.people.filter(p => !p.responded_at && !p.seen_at);
  const renotify = async () => {
    try {
      const r = await api(`/workflows/checkins/status/${templateId}/renotify`, { method: 'POST' });
      toast(r.notified ? `یادآوری برای ${fa(r.notified)} نفر فرستاده شد` : 'همه پاسخ داده‌اند');
    } catch (e) { toast(e.message, 'error'); }
  };
  const Row = ({ p, children }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.8, padding: '4px 0' }}>
      <Avatar name={p.full_name} color={p.avatar_color} size={24} />
      <span style={{ flex: 1 }}>{p.full_name}
        {p.department_name && <span style={{ color: 'var(--text-3)' }}> · {p.department_name}</span>}
      </span>
      {children}
    </div>
  );
  return (
    <Modal title={`پاسخ‌های امروز: ${data.template.name}`} onClose={onClose} wide
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>بستن</button>
        {(seenOnly.length + notSeen.length) > 0 && (
          <button className="btn btn-primary" onClick={renotify}><Bell size={15} /> یادآوری به پاسخ‌نداده‌ها</button>
        )}
      </>}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <span className="badge badge-green">{fa(responded.length)} پاسخ داده</span>
        {data.options.map(o => (
          <span key={o.key} className="badge badge-gray">{o.label}: {fa(responded.filter(p => p.option_key === o.key).length)}</span>
        ))}
        <span className="badge badge-sky">{fa(seenOnly.length)} دیده، بی‌پاسخ</span>
        <span className="badge badge-amber">{fa(notSeen.length)} هنوز ندیده</span>
      </div>
      {responded.length > 0 && <b style={{ fontSize: 13 }}>پاسخ داده‌اند</b>}
      {responded.map(p => (
        <Row key={p.id} p={p}>
          {p.comment && <span style={{ color: 'var(--text-3)', fontSize: 11.5 }}>{p.comment}</span>}
          <span className={`badge ${p.request_id ? 'badge-red' : 'badge-green'}`}>{p.option_label}</span>
          {p.signed && <span className="badge badge-sky">امضا شد</span>}
          {p.request_id && <Link to={`/cartable/${p.request_id}`} onClick={onClose} style={{ fontSize: 12 }}>گزارش</Link>}
          <span style={{ color: 'var(--text-3)', fontSize: 11.5 }}>{fmtDateTime(p.responded_at)}</span>
        </Row>
      ))}
      {seenOnly.length > 0 && <b style={{ fontSize: 13, display: 'block', marginTop: 12 }}>دیده‌اند ولی پاسخ نداده‌اند</b>}
      {seenOnly.map(p => (
        <Row key={p.id} p={p}><Eye size={13} style={{ color: 'var(--text-3)' }} />
          <span style={{ color: 'var(--text-3)', fontSize: 11.5 }}>{fmtRelative(p.seen_at)}</span></Row>
      ))}
      {notSeen.length > 0 && <b style={{ fontSize: 13, display: 'block', marginTop: 12 }}>هنوز ندیده‌اند</b>}
      {notSeen.map(p => <Row key={p.id} p={p}><span className="badge badge-amber">ندیده</span></Row>)}
      {!data.people.length && <div className="empty">برای این فرآیند گیرندهٔ یادآوری روزانه تعریف نشده است</div>}
    </Modal>
  );
}
