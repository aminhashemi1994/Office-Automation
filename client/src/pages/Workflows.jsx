import React, { useEffect, useState } from 'react';
import { Plus, Pencil, ArrowUp, ArrowDown, Trash2, Clock, Search, Paperclip } from 'lucide-react';
import { api } from '../api.js';
import { useStore } from '../store.jsx';
import { Modal, Field, UserPicker, Segmented } from '../components/common.jsx';
import { AttachmentPicker } from '../components/Attachments.jsx';
import { fa } from '../utils.js';

const APPROVER_TYPES = {
  requester_manager: 'سرگروه واحدِ درخواست‌دهنده',
  dept_manager: 'مدیر یک واحد مشخص',
  dept_member: 'عضو یک تیم/واحد (هر یک از اعضا)',
  user: 'کاربر مشخص',
  role: 'همه کاربران با نقش مشخص',
};
const FIELD_TYPES = {
  text: 'متن',
  number: 'عدد',
  textarea: 'متن بلند',
  date: 'تاریخ (شمسی)',
  time: 'ساعت',
  time_range: 'بازه ساعت (شروع/پایان)',
  select: 'انتخابی (دراپ‌داون)',
  image: 'تصویر (فقط آپلود عکس)',
  file: 'فایل/سند (هر نوع فایل: PDF, Word, Excel, عکس و …)',
};

export default function Workflows() {
  const { user, hasPerm, toast } = useStore();
  const [templates, setTemplates] = useState([]);
  const [editing, setEditing] = useState(null);
  const [search, setSearch] = useState('');
  const [confirmDel, setConfirmDel] = useState(null);

  const load = async () => {
    const r = await api('/workflows/templates');
    setTemplates(r.templates);
  };
  useEffect(() => { load(); }, []);
  const filtered = templates.filter(t => !search || t.name.includes(search) || (t.description || '').includes(search));

  const canDelete = (t) => hasPerm('workflows.manage') || t.created_by === user.id;

  const toggleActive = async (t) => {
    try { await api(`/workflows/templates/${t.id}`, { method: 'PUT', body: { is_active: !t.is_active } }); load(); }
    catch (e) { toast(e.message, 'error'); }
  };

  const del = async () => {
    try {
      await api(`/workflows/templates/${confirmDel.id}`, { method: 'DELETE' });
      setConfirmDel(null);
      load();
      toast('فرآیند حذف شد');
    } catch (e) { toast(e.message, 'error'); }
  };

  return (
    <div className="content">
      <div className="page-head">
        <h2>فرآیندهای اداری (گردش کار)</h2>
        <div style={{ display: 'flex', gap: 10 }}>
          <div style={{ position: 'relative' }}>
            <Search size={15} style={{ position: 'absolute', right: 11, top: 11, color: 'var(--text-3)' }} />
            <input className="input" style={{ paddingRight: 34, width: 220 }} placeholder="جستجوی فرآیند…"
              value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <button className="btn btn-primary" onClick={() => setEditing('new')}><Plus size={17} /> فرآیند جدید</button>
        </div>
      </div>
      <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(330px, 1fr))' }}>
        {filtered.map(t => (
          <div key={t.id} className="card card-pad">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: 6 }}>
              <b style={{ fontSize: 15 }}>{t.name}</b>
              <div style={{ display: 'flex', gap: 4 }}>
                <button className="icon-btn" style={{ width: 30, height: 30 }} title="ویرایش" onClick={() => setEditing(t)}><Pencil size={14} /></button>
                {canDelete(t) && (
                  <button className="icon-btn" style={{ width: 30, height: 30, color: 'var(--red)' }} title="حذف فرآیند" onClick={() => setConfirmDel(t)}><Trash2 size={14} /></button>
                )}
              </div>
            </div>
            {t.description && <p style={{ fontSize: 12.8, color: 'var(--text-2)', marginBottom: 10 }}>{t.description}</p>}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
              {t.steps.map(s => (
                <span key={s.id} className={`badge ${s.is_optional ? 'badge-gray' : 'badge-primary'}`}>
                  {fa(s.step_order)}. {s.title}
                  {s.deadline_hours > 0 && <span style={{ opacity: .75 }}> ({fa(s.deadline_hours)}س)</span>}
                  {!!s.is_optional && <span style={{ opacity: .75 }}> · اختیاری</span>}
                </span>
              ))}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <button className={`btn btn-sm ${t.is_active ? 'btn-success' : 'btn-ghost'}`} onClick={() => toggleActive(t)}>
                {t.is_active ? 'فعال ✓' : 'غیرفعال'}
              </button>
              {/* [پیوست‌ها] نشانِ فایل‌های ضمیمهٔ راهنمای این فرآیند */}
              {(() => {
                let n = 0;
                try { n = JSON.parse(t.attachments || '[]').length; } catch {}
                return n ? (
                  <span className="badge badge-sky" title={`${fa(n)} فایل راهنما ضمیمهٔ این فرآیند است`}>
                    <Paperclip size={11} /> {fa(n)} فایل ضمیمه
                  </span>
                ) : null;
              })()}
            </div>
          </div>
        ))}
      </div>
      {editing && (
        <TemplateModal tpl={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onDone={() => { setEditing(null); load(); toast('ذخیره شد'); }} />
      )}
      {confirmDel && (
        <Modal title="حذف فرآیند" onClose={() => setConfirmDel(null)}
          footer={<>
            <button className="btn btn-ghost" onClick={() => setConfirmDel(null)}>انصراف</button>
            <button className="btn btn-danger" onClick={del}>حذف قطعی</button>
          </>}>
          <p>آیا از حذف فرآیند «{confirmDel.name}» مطمئن هستید؟</p>
          <p style={{ fontSize: 12.5, color: 'var(--text-3)' }}>
            اگر این فرآیند درخواست ثبت‌شده داشته باشد قابل حذف نیست و باید آن را غیرفعال کنید.
          </p>
        </Modal>
      )}
    </div>
  );
}

// ویرایشگر یک «قاعدهٔ تاییدکننده» (نوع + هدف) — برای قاعدهٔ اصلی و جایگزین‌ها استفاده می‌شود.
// وقتی نوع، هدف نمی‌خواهد (سرگروه واحد درخواست‌دهنده)، فقط یک منوی تمام‌عرض نشان می‌دهد.
function ApproverSpecEditor({ spec, onChange, departments, users }) {
  const needsTarget = spec.approver_type === 'dept_manager' || spec.approver_type === 'dept_member' || spec.approver_type === 'user' || spec.approver_type === 'role';
  return (
    <div style={{ display: 'grid', gridTemplateColumns: needsTarget ? '1fr 1fr' : '1fr', gap: 8 }}>
      <select className="input" value={spec.approver_type}
        onChange={e => onChange({ approver_type: e.target.value, approver_id: null, approver_role: e.target.value === 'role' ? 'manager' : null })}>
        {Object.entries(APPROVER_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </select>
      {(spec.approver_type === 'dept_manager' || spec.approver_type === 'dept_member') && (
        <select className="input" value={spec.approver_id || ''} onChange={e => onChange({ approver_id: Number(e.target.value) || null })}>
          <option value="">— انتخاب {spec.approver_type === 'dept_member' ? 'تیم/واحد' : 'واحد'} —</option>
          {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
      )}
      {spec.approver_type === 'user' && <UserPicker value={spec.approver_id} onChange={v => onChange({ approver_id: v })} />}
      {spec.approver_type === 'role' && (
        <select className="input" value={spec.approver_role || 'manager'} onChange={e => onChange({ approver_role: e.target.value })}>
          <option value="admin">مدیر سامانه</option>
          <option value="manager">سرگروه‌ها</option>
        </select>
      )}
    </div>
  );
}

function parseAlts(v) {
  if (Array.isArray(v)) return v;
  try { return JSON.parse(v || '[]'); } catch { return []; }
}

// [مرخصی] انتخابِ یکی از فیلدهای فرمِ همین فرآیند (فقط انواعِ سازگار نمایش داده می‌شوند)
function FieldPicker({ fields, value, types, onChange }) {
  const usable = fields.filter(f => f.key && (!types || types.includes(f.type || 'text')));
  return (
    <select className="input" value={value || ''} onChange={e => onChange(e.target.value || undefined)}>
      <option value="">— انتخاب نشده —</option>
      {usable.map(f => <option key={f.key} value={f.key}>{f.label || f.key}</option>)}
    </select>
  );
}

function TemplateModal({ tpl, onClose, onDone }) {
  const { departments, users, settings, toast } = useStore();

  // نمایش دقیق فردی که در هر مرحله تایید می‌کند
  const approverPreview = (s) => {
    if (s.approver_type === 'requester_manager') return 'سرگروه واحد درخواست‌دهنده (هنگام ثبت درخواست مشخص می‌شود)';
    if (s.approver_type === 'user') {
      const u = users.find(x => x.id === Number(s.approver_id));
      return u ? u.full_name : '⚠️ کاربری انتخاب نشده';
    }
    if (s.approver_type === 'dept_manager') {
      const d = departments.find(x => x.id === Number(s.approver_id));
      if (!d) return '⚠️ واحدی انتخاب نشده';
      const mgr = users.find(x => x.id === d.manager_id);
      return mgr ? `${d.name} ← ${mgr.full_name}` : `${d.name} ⚠️ (این واحد مدیر تعیین‌شده ندارد)`;
    }
    if (s.approver_type === 'dept_member') {
      const d = departments.find(x => x.id === Number(s.approver_id));
      if (!d) return '⚠️ تیمی انتخاب نشده';
      const members = users.filter(x => x.department_id === d.id);
      return members.length
        ? `اعضای تیم ${d.name}: ${members.map(x => x.full_name).join('، ')}`
        : `${d.name} ⚠️ (این تیم عضوی ندارد)`;
    }
    if (s.approver_type === 'role') {
      const list = users.filter(x => x.role === s.approver_role);
      return list.length ? list.map(x => x.full_name).join('، ') : '⚠️ کاربری با این نقش وجود ندارد';
    }
    return '';
  };
  const [name, setName] = useState(tpl?.name || '');
  const [description, setDescription] = useState(tpl?.description || '');
  const [titlePlaceholder, setTitlePlaceholder] = useState(tpl?.title_placeholder || '');
  const [fields, setFields] = useState(() => { try { return JSON.parse(tpl?.form_schema || '[]'); } catch { return []; } });
  const [steps, setSteps] = useState(tpl?.steps?.map(s => ({
    ...s,
    alt_approvers: parseAlts(s.alt_approvers),
    requires_signature: s.requires_signature === 0 ? 0 : 1,
    allow_attachments: s.allow_attachments === 0 ? 0 : 1, // [پیوست‌ها]
  })) || [
    { title: 'تایید سرگروه واحد', approver_type: 'requester_manager', deadline_hours: 24, alt_approvers: [], requires_signature: 1, allow_attachments: 1 },
  ]);
  const [notifyFinal, setNotifyFinal] = useState(tpl ? tpl.notify_requester_on_final !== 0 : true);
  const [requesterSig, setRequesterSig] = useState(tpl ? tpl.requester_signature !== 0 : true);
  // [تایید نهایی درخواست‌دهنده] پس از آخرین مرحله، درخواست برای تصمیم نهایی به خودِ او برمی‌گردد
  const [requesterFinal, setRequesterFinal] = useState(!!tpl?.requester_final_approval);
  // [مرخصی] این فرآیند یک «درخواست مرخصی» است و پس از تایید نهایی از ماندهٔ کاربر کم می‌کند
  const [leaveOn, setLeaveOn] = useState(!!tpl?.leave_enabled);
  const [leaveMap, setLeaveMap] = useState(() => {
    try { return JSON.parse(tpl?.leave_map || '{}') || {}; } catch { return {}; }
  });
  // [مورد ۱] محدودهٔ واحدها ([] = همه‌جا)
  const [scopeDeptIds, setScopeDeptIds] = useState(() => { try { return JSON.parse(tpl?.scope_dept_ids || '[]'); } catch { return []; } });
  // [مورد ۳] مهلت کل تایید
  const [totalDeadline, setTotalDeadline] = useState(tpl?.total_deadline_hours || 0);
  // [مورد ۲] فایل‌های ضمیمهٔ فرآیند — عکس یا هر سند دیگر (آرایه‌ای از file id)
  const [attachments, setAttachments] = useState(() => { try { return JSON.parse(tpl?.attachments || '[]'); } catch { return []; } });
  // [پیوست‌ها] آیا افرادِ سلسله‌مراتب در این فرآیند می‌توانند فایل پیوست کنند؟
  const [allowAtt, setAllowAtt] = useState(tpl ? tpl.allow_attachments !== 0 : true);
  const globalAttOff = settings?.attachments_enabled === '0'; // کلید سراسری در تنظیمات سازمان
  // [مورد ۷] تسک پس از تایید نهایی
  const [finalTask, setFinalTask] = useState({
    enabled: !!tpl?.final_task_enabled,
    assignee_type: tpl?.final_task_assignee_type || 'requester',
    assignee_id: tpl?.final_task_assignee_id || null,
    deadline_hours: tpl?.final_task_deadline_hours || 0,
    notify: tpl ? tpl.final_task_notify !== 0 : true,
  });
  const [busy, setBusy] = useState(false);
  const stepsDeadlineSum = steps.reduce((sum, s) => sum + (Number(s.deadline_hours) || 0), 0);

  const setStep = (i, patch) => setSteps(list => list.map((s, j) => j === i ? { ...s, ...patch } : s));
  const moveStep = (i, dir) => setSteps(list => {
    const next = [...list];
    const j = i + dir;
    if (j < 0 || j >= next.length) return list;
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  });
  const setField = (i, patch) => setFields(list => list.map((f, j) => j === i ? { ...f, ...patch } : f));

  const save = async () => {
    for (const s of steps) {
      if (!s.title.trim()) return toast('عنوان همه مراحل الزامی است', 'error');
      if (s.approver_type === 'dept_manager' && !s.approver_id) return toast('برای مرحله «مدیر واحد» باید واحد را انتخاب کنید', 'error');
      if (s.approver_type === 'dept_member' && !s.approver_id) return toast('برای مرحله «عضو تیم» باید تیم/واحد را انتخاب کنید', 'error');
      if (s.approver_type === 'user' && !s.approver_id) return toast('برای مرحله «کاربر مشخص» باید کاربر را انتخاب کنید', 'error');
      for (const a of (s.alt_approvers || [])) {
        if (a.approver_type === 'dept_manager' && !a.approver_id) return toast('برای جایگزین «مدیر واحد» باید واحد را انتخاب کنید', 'error');
        if (a.approver_type === 'dept_member' && !a.approver_id) return toast('برای جایگزین «عضو تیم» باید تیم/واحد را انتخاب کنید', 'error');
        if (a.approver_type === 'user' && !a.approver_id) return toast('برای جایگزین «کاربر مشخص» باید کاربر را انتخاب کنید', 'error');
      }
    }
    for (const f of fields) {
      if (!f.key?.trim() || !f.label?.trim()) return toast('کلید و برچسب همه فیلدهای فرم الزامی است', 'error');
    }
    setBusy(true);
    try {
      const body = {
        name, description, title_placeholder: titlePlaceholder, form_schema: fields, steps,
        notify_requester_on_final: notifyFinal, requester_signature: requesterSig,
        requester_final_approval: requesterFinal,
        leave_enabled: leaveOn,
        leave_map: leaveMap,
        scope_dept_ids: scopeDeptIds.map(Number),
        total_deadline_hours: Number(totalDeadline) || 0,
        attachments: attachments.map(Number),
        allow_attachments: allowAtt,
        final_task_enabled: finalTask.enabled,
        final_task_assignee_type: finalTask.assignee_type,
        final_task_assignee_id: finalTask.assignee_type === 'user' ? (finalTask.assignee_id || null) : null,
        final_task_deadline_hours: Number(finalTask.deadline_hours) || 0,
        final_task_notify: finalTask.notify,
      };
      if (tpl) await api(`/workflows/templates/${tpl.id}`, { method: 'PUT', body });
      else await api('/workflows/templates', { method: 'POST', body });
      onDone();
    } catch (e) { toast(e.message, 'error'); }
    setBusy(false);
  };

  return (
    <Modal title={tpl ? `ویرایش فرآیند «${tpl.name}»` : 'فرآیند جدید'} onClose={onClose} wide
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>انصراف</button>
        <button className="btn btn-primary" disabled={!name.trim() || !steps.length || busy} onClick={save}>ذخیره فرآیند</button>
      </>}>
      <Field label="نام فرآیند"><input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="مثلاً: درخواست مرخصی" /></Field>
      <Field label="توضیحات"><textarea className="input" value={description} onChange={e => setDescription(e.target.value)} style={{ minHeight: 56 }} /></Field>
      <Field label="متن راهنمای عنوان درخواست (placeholder)">
        <input className="input" value={titlePlaceholder} onChange={e => setTitlePlaceholder(e.target.value)}
          placeholder="مثلاً: عنوان درخواست مرخصی خود را وارد کنید" />
      </Field>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="اطلاع به درخواست‌دهنده پس از تایید نهایی">
          <Segmented value={notifyFinal ? 1 : 0} onChange={v => setNotifyFinal(!!v)}
            options={[{ value: 1, label: 'بله', tone: 'success' }, { value: 0, label: 'خیر' }]} />
        </Field>
        <Field label="درج امضای درخواست‌دهنده در سند چاپی">
          <Segmented value={requesterSig ? 1 : 0} onChange={v => setRequesterSig(!!v)}
            options={[{ value: 1, label: 'درج شود', tone: 'primary' }, { value: 0, label: 'درج نشود' }]} />
        </Field>
      </div>

      {/* [تایید نهایی درخواست‌دهنده] آخرین حرف را خودِ درخواست‌دهنده می‌زند */}
      <Field label="تایید نهایی توسط درخواست‌دهنده"
        hint="با «فعال»، بعد از تایید آخرین مرحله، درخواست بسته نمی‌شود و به کارتابل خودِ درخواست‌دهنده می‌رود تا آن را تایید نهایی کند، کامنت بگذارد، یا به اول/هر مرحله‌ای از فرآیند برگرداند.">
        <Segmented value={requesterFinal ? 1 : 0} onChange={v => setRequesterFinal(!!v)}
          options={[
            { value: 1, label: 'فعال', tone: 'primary', hint: 'تصمیم نهایی با درخواست‌دهنده است' },
            { value: 0, label: 'غیرفعال', hint: 'با تایید آخرین مرحله، درخواست بسته می‌شود' },
          ]} />
      </Field>

      {/* [پیوست‌ها] اجازهٔ پیوست فایل توسط افرادِ سلسله‌مراتب — کلیدِ کلیِ این فرآیند */}
      <Field label="پیوست فایل توسط افرادِ سلسله‌مراتب"
        hint={globalAttOff
          ? 'توجه: پیوست فایل در تنظیمات سازمان به‌صورت کلی غیرفعال است، پس در هیچ فرآیندی کار نمی‌کند.'
          : 'اگر «مجاز» باشد، تاییدکنندگانِ مراحل می‌توانند همراه تایید/رد و همچنین در قالب یادداشت، فایل پیوست کنند. با «غیرمجاز» این امکان در همهٔ مراحلِ این فرآیند بسته می‌شود (فیلدهای فایلِ فرمِ درخواست‌دهنده تغییری نمی‌کند).'}>
        <Segmented value={allowAtt ? 1 : 0} onChange={v => setAllowAtt(!!v)}
          options={[
            { value: 1, label: 'مجاز', tone: 'primary', hint: 'افرادِ سلسله‌مراتب می‌توانند فایل پیوست کنند' },
            { value: 0, label: 'غیرمجاز', hint: 'در هیچ مرحله‌ای امکان پیوست نیست' },
          ]} />
      </Field>

      {/* [مورد ۱] محدودهٔ واحدهایی که این فرآیند برایشان در دسترس است */}
      <Field label="در دسترس برای کدام واحدها؟"
        hint="هیچ‌کدام انتخاب نشود = برای همهٔ واحدها در دسترس است. در غیر این‌صورت فقط اعضای واحدهای انتخاب‌شده (و مدیرانشان) این فرآیند را می‌بینند.">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {departments.map(d => {
            const on = scopeDeptIds.map(Number).includes(d.id);
            return (
              <button key={d.id} type="button" className={`btn btn-sm ${on ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => setScopeDeptIds(on ? scopeDeptIds.filter(x => Number(x) !== d.id) : [...scopeDeptIds, d.id])}>
                {d.name}
              </button>
            );
          })}
          {!departments.length && <span style={{ fontSize: 12, color: 'var(--text-3)' }}>واحدی تعریف نشده</span>}
        </div>
      </Field>

      {/* [مورد ۲] فایل‌های ضمیمهٔ فرآیند (راهنما/نمونه) — عکس یا هر سند دیگر */}
      <Field label="فایل‌های ضمیمهٔ فرآیند (راهنما/نمونه)"
        hint="هر نوع فایلی می‌توانید بگذارید: عکس، PDF، Word، Excel، فایل فشرده و … . این فایل‌ها هنگام ثبت درخواست به کاربر نمایش داده می‌شوند (حداکثر ۲۵ مگابایت برای هر فایل).">
        <AttachmentPicker value={attachments} onChange={setAttachments} placeholder="انتخاب فایل" label="افزودن فایل"
          disabled={globalAttOff} />
      </Field>

      {/* [مرخصی] این فرآیند را به‌عنوان «درخواست مرخصی» علامت بزنید تا پس از تایید نهایی،
          مقدارِ مرخصی خودکار از ماندهٔ درخواست‌دهنده کم شود. */}
      <Field label="این فرآیند، «درخواست مرخصی» است"
        hint="با فعال‌کردن، پس از تایید نهاییِ درخواست، مقدار مرخصی محاسبه و از ماندهٔ درخواست‌دهنده کم می‌شود (صفحهٔ «مرخصی»).">
        <Segmented value={leaveOn ? 1 : 0} onChange={v => setLeaveOn(!!v)}
          options={[
            { value: 1, label: 'بله', tone: 'primary', hint: 'از ماندهٔ مرخصی کسر می‌شود' },
            { value: 0, label: 'خیر' },
          ]} />
      </Field>
      {leaveOn && (
        <div className="card-pad panel-soft" style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text-2)', marginBottom: 4 }}>
            نگاشت فیلدهای فرم به اطلاعات مرخصی
          </div>
          <p style={{ fontSize: 12, color: 'var(--text-3)', margin: '0 0 12px', lineHeight: 1.8 }}>
            مشخص کنید مقدار مرخصی از کدام فیلدِ فرم خوانده شود. اگر هم «بازهٔ ساعتی» و هم «تعداد روز»
            تعریف شده باشد، اولویت با بازهٔ ساعتی است، سپس تعداد ساعت و در آخر تعداد روز.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Field label="فیلدِ «نوع مرخصی»"
              hint="مقدارهای «استحقاقی»، «بدون حقوق» و «استعلاجی» خودکار شناسایی می‌شوند.">
              <FieldPicker fields={fields} value={leaveMap.type_field} types={['select', 'text']}
                onChange={v => setLeaveMap(m => ({ ...m, type_field: v }))} />
            </Field>
            <Field label="نوع پیش‌فرض (اگر فیلد نوع نداشته باشید)">
              <select className="input" value={leaveMap.default_type || 'entitled'}
                onChange={e => setLeaveMap(m => ({ ...m, default_type: e.target.value }))}>
                <option value="entitled">استحقاقی</option>
                <option value="unpaid">بدون حقوق</option>
                <option value="sick">استعلاجی</option>
              </select>
            </Field>
            <Field label="فیلدِ «بازهٔ ساعتی» (مرخصی ساعتی)">
              <FieldPicker fields={fields} value={leaveMap.range_field} types={['time_range']}
                onChange={v => setLeaveMap(m => ({ ...m, range_field: v }))} />
            </Field>
            <Field label="فیلدِ «تعداد ساعت»">
              <FieldPicker fields={fields} value={leaveMap.hour_field} types={['number', 'text']}
                onChange={v => setLeaveMap(m => ({ ...m, hour_field: v }))} />
            </Field>
            <Field label="فیلدِ «تعداد روز» (مرخصی روزانه)">
              <FieldPicker fields={fields} value={leaveMap.day_field} types={['number', 'text']}
                onChange={v => setLeaveMap(m => ({ ...m, day_field: v }))} />
            </Field>
            <Field label="فیلدِ «تاریخ شروع»">
              <FieldPicker fields={fields} value={leaveMap.from_field} types={['date', 'text']}
                onChange={v => setLeaveMap(m => ({ ...m, from_field: v }))} />
            </Field>
            <Field label="فیلدِ «تاریخ پایان»">
              <FieldPicker fields={fields} value={leaveMap.to_field} types={['date', 'text']}
                onChange={v => setLeaveMap(m => ({ ...m, to_field: v }))} />
            </Field>
          </div>
          {!leaveMap.range_field && !leaveMap.hour_field && !leaveMap.day_field && (
            <p style={{ fontSize: 12.3, color: 'var(--amber)', margin: '4px 0 0' }}>
              حداقل یکی از فیلدهای «بازهٔ ساعتی»، «تعداد ساعت» یا «تعداد روز» را انتخاب کنید،
              وگرنه چیزی از مانده کم نمی‌شود.
            </p>
          )}
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '18px 0 10px' }}>
        <b>مراحل تایید (سلسله‌مراتب)</b>
        <button className="btn btn-ghost btn-sm" onClick={() => setSteps(s => [...s, { title: '', approver_type: 'requester_manager', deadline_hours: 24, alt_approvers: [], requires_signature: 1, allow_attachments: 1 }])}>
          <Plus size={14} /> مرحله
        </button>
      </div>
      {steps.map((s, i) => (
        <div key={i} className="card-pad panel-soft" style={{ marginBottom: 10 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
            <span className="step-dot current" style={{ width: 26, height: 26, fontSize: 12 }}>{fa(i + 1)}</span>
            <input className="input" style={{ flex: 1 }} placeholder="عنوان مرحله (مثلاً: تایید حسابداری)"
              value={s.title} onChange={e => setStep(i, { title: e.target.value })} />
            <button className="icon-btn" style={{ width: 30, height: 30 }} onClick={() => moveStep(i, -1)} disabled={i === 0}><ArrowUp size={14} /></button>
            <button className="icon-btn" style={{ width: 30, height: 30 }} onClick={() => moveStep(i, 1)} disabled={i === steps.length - 1}><ArrowDown size={14} /></button>
            <button className="icon-btn" style={{ width: 30, height: 30, color: 'var(--red)' }} onClick={() => setSteps(list => list.filter((_, j) => j !== i))}><Trash2 size={14} /></button>
          </div>
          {/* تاییدکنندهٔ اصلی */}
          <div style={{ fontSize: 12.3, fontWeight: 700, color: 'var(--text-2)', margin: '2px 0 6px' }}>تاییدکنندهٔ اصلی این مرحله</div>
          <ApproverSpecEditor spec={s} departments={departments} users={users}
            onChange={patch => setStep(i, patch)} />
          <div style={{ fontSize: 12.3, marginTop: 8, padding: '7px 10px', background: 'var(--surface)', borderRadius: 9, border: '1px solid var(--border)' }}>
            <span style={{ color: 'var(--text-3)' }}>یعنی: </span>
            <b style={{ color: 'var(--primary)' }}>{approverPreview(s)}</b>
          </div>

          {/* مهلت و نوع مرحله */}
          <div style={{ display: 'flex', gap: 16, alignItems: 'flex-end', marginTop: 12, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 11.5, color: 'var(--text-3)', marginBottom: 4 }}>مهلت اقدام (ساعت — ۰ یعنی بدون مهلت)</div>
              <div style={{ position: 'relative', width: 140 }}>
                <input className="input" type="number" min="0" value={s.deadline_hours || 0}
                  onChange={e => setStep(i, { deadline_hours: Number(e.target.value) })} style={{ paddingLeft: 30 }} />
                <Clock size={13} style={{ position: 'absolute', left: 10, top: 12, color: 'var(--text-3)' }} />
              </div>
            </div>
            <div>
              <div style={{ fontSize: 11.5, color: 'var(--text-3)', marginBottom: 4 }}>نوع مرحله</div>
              <Segmented size="sm" value={s.is_optional ? 1 : 0}
                onChange={v => setStep(i, { is_optional: v })}
                options={[
                  { value: 0, label: 'الزامی', tone: 'primary', hint: 'تایید این مرحله برای ادامه لازم است' },
                  { value: 1, label: 'اختیاری', hint: 'تاییدکننده می‌تواند بدون اظهارنظر عبور دهد' },
                ]} />
            </div>
            {/* [پیوست‌ها] اجازهٔ پیوست فایل در همین مرحله */}
            <div>
              <div style={{ fontSize: 11.5, color: 'var(--text-3)', marginBottom: 4 }}>
                پیوست فایل در این مرحله
                {!allowAtt && <span style={{ color: 'var(--amber)' }}> (در این فرآیند بسته است)</span>}
              </div>
              <Segmented size="sm" value={s.allow_attachments === 0 ? 0 : 1}
                onChange={v => setStep(i, { allow_attachments: v })}
                options={[
                  { value: 1, label: 'مجاز', tone: 'primary', hint: 'تاییدکنندهٔ این مرحله می‌تواند فایل پیوست کند' },
                  { value: 0, label: 'غیرمجاز', hint: 'در این مرحله امکان پیوست فایل نیست' },
                ]} />
            </div>
          </div>

          {/* تاییدکنندگان جایگزین — هر تعداد */}
          <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px dashed var(--border)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <span style={{ fontSize: 12.3, fontWeight: 700, color: 'var(--text-2)' }}>
                تاییدکنندگان جایگزین <span style={{ fontWeight: 400, color: 'var(--text-3)' }}>(هر یک از این افراد هم می‌تواند این مرحله را تایید کند)</span>
              </span>
              <button type="button" className="btn btn-ghost btn-sm"
                onClick={() => setStep(i, { alt_approvers: [...(s.alt_approvers || []), { approver_type: 'user', approver_id: null }] })}>
                <Plus size={13} /> جایگزین
              </button>
            </div>
            {(s.alt_approvers || []).length === 0 && (
              <div style={{ fontSize: 11.5, color: 'var(--text-3)' }}>جایگزینی تعریف نشده است.</div>
            )}
            {(s.alt_approvers || []).map((alt, ai) => (
              <div key={ai} style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6 }}>
                <span style={{ fontSize: 11.5, color: 'var(--text-3)', minWidth: 16 }}>{fa(ai + 1)}</span>
                <div style={{ flex: 1 }}>
                  <ApproverSpecEditor spec={alt} departments={departments} users={users}
                    onChange={patch => setStep(i, { alt_approvers: (s.alt_approvers || []).map((x, j) => j === ai ? { ...x, ...patch } : x) })} />
                </div>
                <button type="button" className="icon-btn" style={{ width: 30, height: 30, color: 'var(--red)' }}
                  onClick={() => setStep(i, { alt_approvers: (s.alt_approvers || []).filter((_, j) => j !== ai) })}><Trash2 size={13} /></button>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12.3, color: 'var(--text-2)' }}>امضای تاییدکنندهٔ این مرحله در سند چاپی/بایگانی:</span>
            <Segmented size="sm" value={s.requires_signature === 0 ? 0 : 1}
              onChange={v => setStep(i, { requires_signature: v })}
              options={[
                { value: 1, label: 'درج شود', tone: 'primary' },
                { value: 0, label: 'درج نشود' },
              ]} />
          </div>
          {/* [مورد ۴] کنترل نوتیفیکیشن این مرحله */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12.3, color: 'var(--text-2)' }}>ارسال نوتیفیکیشن به تاییدکنندهٔ این مرحله:</span>
            <Segmented size="sm" value={s.notify_approver === 0 ? 0 : 1}
              onChange={v => setStep(i, { notify_approver: v })}
              options={[
                { value: 1, label: 'ارسال شود', tone: 'primary' },
                { value: 0, label: 'ارسال نشود', hint: 'این مرحله بی‌صدا پیش می‌رود؛ به تاییدکننده اطلاع داده نمی‌شود' },
              ]} />
          </div>

          {/* [مورد ۷+] ساخت تسک هنگام تاییدِ همین مرحله */}
          <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px dashed var(--border)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12.3, fontWeight: 700, color: 'var(--text-2)' }}>هنگام تاییدِ این مرحله یک تسک ساخته شود:</span>
              <Segmented size="sm" value={s.create_task ? 1 : 0} onChange={v => setStep(i, { create_task: v })}
                options={[{ value: 1, label: 'بله', tone: 'success' }, { value: 0, label: 'خیر' }]} />
            </div>
            {s.create_task ? (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 10 }}>
                <div>
                  <div style={{ fontSize: 11.5, color: 'var(--text-3)', marginBottom: 4 }}>مسئول تسک</div>
                  <select className="input" value={s.task_assignee_type || 'requester'}
                    onChange={e => setStep(i, { task_assignee_type: e.target.value })}>
                    <option value="requester">درخواست‌دهنده</option>
                    <option value="approver">تاییدکنندهٔ همین مرحله</option>
                    <option value="user">کاربر مشخص</option>
                  </select>
                </div>
                {s.task_assignee_type === 'user' && (
                  <div>
                    <div style={{ fontSize: 11.5, color: 'var(--text-3)', marginBottom: 4 }}>انتخاب کاربر</div>
                    <UserPicker value={s.task_assignee_id} onChange={v => setStep(i, { task_assignee_id: v })} />
                  </div>
                )}
                <div>
                  <div style={{ fontSize: 11.5, color: 'var(--text-3)', marginBottom: 4 }}>مهلت تسک (ساعت — ۰ = بدون مهلت)</div>
                  <input className="input" type="number" min="0" value={s.task_deadline_hours || 0}
                    onChange={e => setStep(i, { task_deadline_hours: Number(e.target.value) })} />
                </div>
                <div>
                  <div style={{ fontSize: 11.5, color: 'var(--text-3)', marginBottom: 4 }}>عنوان تسک (اختیاری)</div>
                  <input className="input" value={s.task_title || ''} placeholder={`پیگیری «${s.title || 'مرحله'}»`}
                    onChange={e => setStep(i, { task_title: e.target.value })} />
                </div>
                <div>
                  <div style={{ fontSize: 11.5, color: 'var(--text-3)', marginBottom: 4 }}>اطلاع به مسئول تسک</div>
                  <Segmented size="sm" value={s.task_notify === 0 ? 0 : 1} onChange={v => setStep(i, { task_notify: v })}
                    options={[{ value: 1, label: 'بله', tone: 'primary' }, { value: 0, label: 'خیر' }]} />
                </div>
                <div style={{ gridColumn: '1 / -1', fontSize: 11.3, color: 'var(--text-3)' }}>
                  درخواست‌دهنده به‌صورت خودکار به این تسک دسترسیِ مشاهده دارد.
                </div>
              </div>
            ) : null}
          </div>
          {s.requires_signature !== 0 && (() => {
            // کاربرانِ مشخصِ تعیین‌شده (اصلی + جایگزین) که هنوز امضا ثبت نکرده‌اند
            const specUserIds = [s, ...(s.alt_approvers || [])]
              .filter(x => x.approver_type === 'user' && x.approver_id)
              .map(x => Number(x.approver_id));
            const missing = users.filter(u => specUserIds.includes(u.id) && !u.has_signature);
            if (!missing.length) return null;
            return (
              <div style={{ fontSize: 11.5, color: 'var(--amber)', marginTop: 6 }}>
                ⚠️ این افراد هنوز امضای تصویری ثبت نکرده‌اند و در سند چاپی جای امضایشان خالی می‌ماند: {missing.map(u => u.full_name).join('، ')}
              </div>
            );
          })()}

          <div style={{ fontSize: 11.5, color: 'var(--text-3)', marginTop: 8 }}>
            مهلت بر حسب ساعت (۰ = بدون مهلت) · مرحله اختیاری قابل «عبور» توسط تاییدکننده است · آخرین مرحله، مقصد نهایی درخواست است
          </div>
        </div>
      ))}

      {/* [مورد ۳] مهلت کل تایید + دکمهٔ برابرکردن با جمع مهلت مراحل */}
      <Field label="مهلت کل تایید (ساعت)"
        hint="مهلت کلی برای طی‌شدن همهٔ مراحل. با دکمهٔ روبه‌رو می‌توانید آن را برابر جمع مهلت مراحل قرار دهید.">
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', width: 160 }}>
            <input className="input" type="number" min="0" value={totalDeadline}
              onChange={e => setTotalDeadline(Number(e.target.value))} style={{ paddingLeft: 30 }} />
            <Clock size={13} style={{ position: 'absolute', left: 10, top: 12, color: 'var(--text-3)' }} />
          </div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setTotalDeadline(stepsDeadlineSum)}>
            = جمع مهلت مراحل ({fa(stepsDeadlineSum)} ساعت)
          </button>
          {totalDeadline > 0 && totalDeadline !== stepsDeadlineSum && (
            <span style={{ fontSize: 11.5, color: 'var(--amber)' }}>
              اکنون با جمع مراحل ({fa(stepsDeadlineSum)}س) برابر نیست
            </span>
          )}
        </div>
      </Field>

      {/* [مورد ۷] ساخت تسک پس از تایید نهایی */}
      <div className="card-pad panel-soft" style={{ marginTop: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <b style={{ fontSize: 13.5 }}>پس از تایید نهایی، یک تسک ساخته شود</b>
          <Segmented size="sm" value={finalTask.enabled ? 1 : 0}
            onChange={v => setFinalTask(f => ({ ...f, enabled: !!v }))}
            options={[{ value: 1, label: 'بله', tone: 'success' }, { value: 0, label: 'خیر' }]} />
        </div>
        {finalTask.enabled && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
            <Field label="مسئول تسک">
              <select className="input" value={finalTask.assignee_type}
                onChange={e => setFinalTask(f => ({ ...f, assignee_type: e.target.value }))}>
                <option value="requester">خودِ درخواست‌دهنده</option>
                <option value="user">کاربر مشخص</option>
              </select>
            </Field>
            {finalTask.assignee_type === 'user' && (
              <Field label="انتخاب کاربر">
                <UserPicker value={finalTask.assignee_id} onChange={v => setFinalTask(f => ({ ...f, assignee_id: v }))} />
              </Field>
            )}
            <Field label="مهلت تسک (ساعت — ۰ = بدون مهلت)">
              <input className="input" type="number" min="0" value={finalTask.deadline_hours}
                onChange={e => setFinalTask(f => ({ ...f, deadline_hours: Number(e.target.value) }))} />
            </Field>
            <Field label="اطلاع به مسئول تسک">
              <Segmented size="sm" value={finalTask.notify ? 1 : 0} onChange={v => setFinalTask(f => ({ ...f, notify: !!v }))}
                options={[{ value: 1, label: 'بله', tone: 'primary' }, { value: 0, label: 'خیر' }]} />
            </Field>
          </div>
        )}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '18px 0 10px' }}>
        <b>فیلدهای فرم درخواست</b>
        <button className="btn btn-ghost btn-sm" onClick={() => setFields(f => [...f, { key: `field_${f.length + 1}`, label: '', type: 'text', required: false }])}>
          <Plus size={14} /> فیلد
        </button>
      </div>
      {fields.map((f, i) => (
        <div key={i} className="card-pad panel-soft" style={{ marginBottom: 10 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 160px auto 34px', gap: 8, alignItems: 'center' }}>
            <input className="input" placeholder="برچسب (مثلاً: مقدار)" value={f.label} onChange={e => setField(i, { label: e.target.value })} />
            <input className="input" placeholder="کلید انگلیسی" value={f.key} onChange={e => setField(i, { key: e.target.value })} dir="ltr" style={{ textAlign: 'left' }} />
            <select className="input" value={f.type} onChange={e => setField(i, { type: e.target.value })}>
              {Object.entries(FIELD_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <Segmented size="sm" value={f.required ? 1 : 0}
              onChange={v => setField(i, { required: !!v })}
              options={[
                { value: 1, label: 'الزامی', tone: 'primary' },
                { value: 0, label: 'اختیاری' },
              ]} />
            <button className="icon-btn" style={{ width: 30, height: 30, color: 'var(--red)' }} onClick={() => setFields(list => list.filter((_, j) => j !== i))}><Trash2 size={14} /></button>
          </div>
          <input className="input" style={{ marginTop: 8 }}
            placeholder="متن راهنما (placeholder این فیلد در فرم درخواست)"
            value={f.placeholder || ''} onChange={e => setField(i, { placeholder: e.target.value })} />
          {f.type === 'select' && (
            <input className="input" style={{ marginTop: 8 }}
              placeholder="گزینه‌ها را با ، جدا کنید — مثلاً: بله، خیر، نامشخص"
              value={(f.options || []).join('، ')}
              onChange={e => setField(i, { options: e.target.value.split(/[,،]/).map(s => s.trim()).filter(Boolean) })} />
          )}
          {(f.type === 'file' || f.type === 'image') && (
            <div style={{ fontSize: 11.5, color: 'var(--text-3)', marginTop: 6, lineHeight: 1.7 }}>
              {f.type === 'file'
                ? 'کاربر می‌تواند هر تعداد و هر نوع فایلی پیوست کند: عکس، PDF، Word، Excel، PowerPoint، متن، فایل فشرده و … (هر فایل تا ۲۵ مگابایت).'
                : 'فقط فایل تصویری پذیرفته می‌شود. اگر می‌خواهید سندهای دیگر (PDF/Word/Excel) هم قابل ارسال باشد، نوع فیلد را «فایل/سند» انتخاب کنید.'}
            </div>
          )}
        </div>
      ))}
    </Modal>
  );
}
