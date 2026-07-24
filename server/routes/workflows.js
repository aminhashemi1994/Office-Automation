import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import multer from 'multer';
import db from '../db.js';
import { requirePerm, hasPerm } from '../auth.js';
import { notifyUsers } from '../notify.js';
import { SIGNATURES_DIR, SHARED_FILES_DIR, UPLOADS_DIR } from '../config.js';
import { deptManagers, canAccessEverywhere, getManagedDeptIds, isManagementMember } from '../acl.js';
import { activeDeputiesOf } from './delegations.js';

const r = Router();

// [مورد ۲] آپلود عکسِ ضمیمهٔ فرآیند/درخواست — فقط تصویر، تا ۱۰ مگابایت
const imageUpload = multer({
  storage: multer.diskStorage({
    destination: SHARED_FILES_DIR,
    filename: (req, file, cb) => cb(null, crypto.randomBytes(16).toString('hex') + path.extname(file.originalname)),
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(file.mimetype?.startsWith('image/') ? null : new Error('فقط فایل تصویری مجاز است'), file.mimetype?.startsWith('image/')),
});

r.post('/upload', imageUpload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'تصویری ارسال نشد' });
  const info = db.prepare('INSERT INTO files (stored_name, original_name, mime, size, uploader_id) VALUES (?, ?, ?, ?, ?)')
    .run(req.file.filename, req.file.originalname, req.file.mimetype, req.file.size, req.user.id);
  res.json({ id: info.lastInsertRowid });
});

// سرو تصویر به‌صورت inline (برای نمایش داخل صفحه) — نیازمند احرازهویت
r.get('/files/:id', (req, res) => {
  const f = db.prepare('SELECT * FROM files WHERE id = ?').get(req.params.id);
  if (!f) return res.status(404).json({ error: 'فایل یافت نشد' });
  let p = path.join(SHARED_FILES_DIR, f.stored_name);
  if (!fs.existsSync(p)) p = path.join(UPLOADS_DIR, f.stored_name);
  if (!fs.existsSync(p)) return res.status(404).json({ error: 'فایل یافت نشد' });
  res.setHeader('Content-Type', f.mime || 'application/octet-stream');
  res.setHeader('Cache-Control', 'private, max-age=3600');
  fs.createReadStream(p).pipe(res);
});

// چه کسانی مجازند یک درخواست را ببینند:
// درخواست‌دهنده، هرکس روی آن اقدامی ثبت کرده، مسئولِ مرحلهٔ فعلی،
// سازندهٔ فرآیند، و دارندگان workflows.manage / مدیر سامانه.
export function canViewRequest(user, rq) {
  if (!rq) return false;
  if (canAccessEverywhere(user)) return true;                 // [مورد ۶] ادمین/مدیریت/مجوز → همه
  if (rq.requester_id === user.id) return true;               // درخواست‌های خودم
  const tpl = db.prepare('SELECT created_by FROM workflow_templates WHERE id = ?').get(rq.template_id);
  if (tpl?.created_by === user.id) return true;
  if (db.prepare('SELECT 1 FROM workflow_actions WHERE request_id = ? AND actor_id = ?').get(rq.id, user.id)) return true;
  // [مورد ۶] مدیرِ واحدِ درخواست‌دهنده
  const requester = db.prepare('SELECT department_id FROM users WHERE id = ?').get(rq.requester_id);
  if (requester?.department_id && getManagedDeptIds(user).includes(requester.department_id)) return true;
  // [مورد ۶] اجازهٔ فردیِ دستی
  if (db.prepare('SELECT 1 FROM request_view_grants WHERE viewer_id = ? AND target_id = ?').get(user.id, rq.requester_id)) return true;
  if (rq.status === 'in_progress') {
    const step = db.prepare('SELECT * FROM workflow_steps WHERE template_id = ? AND step_order = ?')
      .get(rq.template_id, rq.current_step);
    if (step && resolveApprovers(step, rq.requester_id).includes(user.id)) return true;
  }
  return false;
}

// چه کسانی می‌توانند فرآیند (فرم درخواست) تعریف کنند:
// مدیر سامانه، دارندگان workflows.manage، سرگروه‌ها/مدیران واحدها و اعضای واحد مدیریت
export function canBuildWorkflows(user) {
  if (hasPerm(user, 'workflows.manage')) return true;
  if (user.role === 'manager') return true;
  if (getManagedDeptIds(user).length) return true; // مدیرِ حداقل یک واحد
  if (isManagementMember(user)) return true;
  return false;
}

// افرادِ یک «قاعدهٔ تاییدکننده» (spec) را برمی‌گرداند — بدون fallback به مدیر سامانه
function resolveSpec(spec, requester, requesterId) {
  if (spec.approver_type === 'user' && spec.approver_id) {
    const u = db.prepare('SELECT id FROM users WHERE id = ? AND is_active = 1').get(spec.approver_id);
    return u ? [u.id] : [];
  }
  if (spec.approver_type === 'requester_manager') {
    if (requester?.department_id) return deptManagers(requester.department_id).filter(id => id !== requesterId);
    return [];
  }
  if (spec.approver_type === 'dept_manager' && spec.approver_id) {
    const mgrs = deptManagers(spec.approver_id);
    if (mgrs.length) return mgrs;
    return db.prepare('SELECT id FROM users WHERE department_id = ? AND is_active = 1').all(spec.approver_id).map(u => u.id);
  }
  // عضو یک تیم/واحد: هر یک از اعضای فعالِ آن واحد می‌تواند به‌عنوان جایگزین اقدام کند (جز خودِ درخواست‌دهنده)
  if (spec.approver_type === 'dept_member' && spec.approver_id) {
    return db.prepare('SELECT id FROM users WHERE department_id = ? AND is_active = 1').all(spec.approver_id)
      .map(u => u.id).filter(id => id !== requesterId);
  }
  if (spec.approver_type === 'role' && spec.approver_role) {
    return db.prepare('SELECT id FROM users WHERE role = ? AND is_active = 1').all(spec.approver_role).map(u => u.id);
  }
  return [];
}

function stepSpecs(step) {
  const specs = [{ approver_type: step.approver_type, approver_id: step.approver_id, approver_role: step.approver_role }];
  let alts = [];
  try { alts = JSON.parse(step.alt_approvers || '[]'); } catch {}
  for (const a of alts) if (a && a.approver_type) specs.push(a);
  return specs;
}

// ---------- resolving approvers ----------
// اجتماعِ افرادِ «قاعدهٔ اصلی» + همهٔ «جایگزین‌ها». هر یک از این افراد می‌تواند تایید کند.
export function resolveApprovers(step, requesterId, { withDeputies = true } = {}) {
  const requester = db.prepare('SELECT * FROM users WHERE id = ?').get(requesterId);
  const ids = new Set();
  for (const spec of stepSpecs(step)) for (const id of resolveSpec(spec, requester, requesterId)) ids.add(id);
  // نیابت/جانشینی: هر جانشینِ فعالِ یکی از تاییدکنندگان هم می‌تواند به‌نیابت اقدام کند.
  // (جلوگیری از گیرکردن درخواست‌ها هنگام نبودِ مدیر)
  if (withDeputies) for (const id of [...ids]) for (const dep of activeDeputiesOf(id)) ids.add(dep);
  if (!ids.size) {
    // هیچ تاییدکننده‌ای پیدا نشد → مدیران سامانه تا گردش کار متوقف نشود
    return db.prepare("SELECT id FROM users WHERE role = 'admin' AND is_active = 1").all().map(u => u.id);
  }
  return [...ids];
}

// توضیح خوانا از قاعده تاییدکننده هر مرحله
function describeApprover(step) {
  if (step.approver_type === 'user' && step.approver_id) {
    const u = db.prepare('SELECT full_name FROM users WHERE id = ?').get(step.approver_id);
    return u ? `کاربر مشخص: ${u.full_name}` : 'کاربر مشخص (نامشخص)';
  }
  if (step.approver_type === 'requester_manager') return 'سرگروه واحد درخواست‌دهنده';
  if (step.approver_type === 'dept_manager' && step.approver_id) {
    const d = db.prepare('SELECT name FROM departments WHERE id = ?').get(step.approver_id);
    return d ? `مدیر واحد ${d.name}` : 'مدیر واحد (نامشخص)';
  }
  if (step.approver_type === 'dept_member' && step.approver_id) {
    const d = db.prepare('SELECT name FROM departments WHERE id = ?').get(step.approver_id);
    return d ? `عضو تیم ${d.name}` : 'عضو تیم (نامشخص)';
  }
  if (step.approver_type === 'role' && step.approver_role) {
    return step.approver_role === 'admin' ? 'مدیران سامانه' : 'سرگروه‌ها/مدیران';
  }
  return 'نامشخص';
}

// افراد دقیق تاییدکننده (id + نام). برای requester_manager بدون درخواست‌دهنده، خالی می‌ماند
function approverPeople(step, requesterId = null) {
  if (step.approver_type === 'requester_manager' && !requesterId) return [];
  const ids = resolveApprovers(step, requesterId);
  if (!ids.length) return [];
  const ph = ids.map(() => '?').join(',');
  return db.prepare(`SELECT id, full_name, avatar_color FROM users WHERE id IN (${ph})`).all(...ids);
}

// افزودن اطلاعات دقیق تاییدکننده به مرحله
function enrichStep(step, requesterId = null) {
  const people = approverPeople(step, requesterId);
  return { ...step, approver_label: describeApprover(step), approver_people: people };
}

function getSteps(templateId) {
  return db.prepare('SELECT * FROM workflow_steps WHERE template_id = ? ORDER BY step_order').all(templateId);
}

function currentStepOf(request) {
  return db.prepare('SELECT * FROM workflow_steps WHERE template_id = ? AND step_order = ?')
    .get(request.template_id, request.current_step);
}

function stepDueAt(step) {
  if (!step?.deadline_hours) return null;
  return new Date(Date.now() + step.deadline_hours * 3600 * 1000).toISOString();
}

function requestDetail(id, userId) {
  const req_ = db.prepare(`
    SELECT r.*, t.name AS template_name, t.form_schema, t.requester_signature,
           t.notify_requester_on_final, u.full_name AS requester_name,
           d.name AS requester_department
    FROM workflow_requests r
    JOIN workflow_templates t ON t.id = r.template_id
    JOIN users u ON u.id = r.requester_id
    LEFT JOIN departments d ON d.id = u.department_id
    WHERE r.id = ?`).get(id);
  if (!req_) return null;
  const steps = getSteps(req_.template_id).map(s => {
    const people = approverPeople(s, req_.requester_id);
    return { ...s, approvers: people.map(p => p.id), approver_people: people, approver_label: describeApprover(s) };
  });
  // requires_signature هر اقدام از روی مرحلهٔ متناظرش تعیین می‌شود
  const actions = db.prepare(`
    SELECT a.*, u.full_name AS actor_name, u.position AS actor_position,
           dpt.name AS actor_department,
           (u.signature_path IS NOT NULL AND u.signature_path != '') AS has_signature,
           s.requires_signature AS step_requires_signature
    FROM workflow_actions a
    JOIN users u ON u.id = a.actor_id
    LEFT JOIN departments dpt ON dpt.id = u.department_id
    LEFT JOIN workflow_steps s ON s.template_id = ? AND s.step_order = a.step_order
    WHERE a.request_id = ? ORDER BY a.id`).all(req_.template_id, id);
  const cur = steps.find(s => s.step_order === req_.current_step);
  const can_act = req_.status === 'in_progress' && cur && cur.approvers.includes(userId);
  return { ...req_, steps, actions, can_act };
}

// [مورد ۱] آیا این کاربر مجاز به دیدن/استفادهٔ این فرآیند است؟
// scope خالی = همه‌جا. در غیر این صورت فقط واحدِ خودِ کاربر یا واحدهایی که مدیرشان است،
// به‌علاوهٔ دسترسیِ سراسری و سازندهٔ فرآیند.
function templateInScope(user, tpl) {
  if (canAccessEverywhere(user)) return true;
  if (tpl.created_by === user.id) return true;
  let scope = [];
  try { scope = JSON.parse(tpl.scope_dept_ids || '[]'); } catch {}
  if (!scope.length) return true; // بدون محدودیت
  const mine = new Set([user.department_id, ...getManagedDeptIds(user)].filter(Boolean).map(Number));
  return scope.map(Number).some(id => mine.has(id));
}

// [مورد ۴] اعلان به تاییدکنندگانِ یک مرحله فقط اگر آن مرحله notify_approver داشته باشد
function notifyApprovers(step, ids, payload) {
  if (step && step.notify_approver === 0) return; // اعلان این مرحله خاموش است
  notifyUsers(ids, payload);
}

// [مورد ۷+] ساخت تسک از یک درخواست — قابل فراخوانی برای:
//  • تایید نهایی (تنظیمات سطح‌فرآیند)   • هر مرحله از سلسله‌مراتب (تنظیمات آن مرحله)   • دستی
// opts: { assignee_type: 'requester'|'approver'|'user', assignee_id, approver_id,
//         deadline_hours, notify, title, description, priority, link_to_request }
// درخواست‌دهنده همیشه به‌عنوان «مشارکت‌کننده» اضافه می‌شود تا تسک را ببیند.
function createTaskFromRequest(rq, tpl, actorId, opts = {}) {
  const assigneeType = opts.assignee_type || 'requester';
  let assigneeId =
    assigneeType === 'approver' ? (opts.approver_id || actorId)
    : assigneeType === 'user' ? opts.assignee_id
    : rq.requester_id;
  if (!assigneeId || !db.prepare('SELECT 1 FROM users WHERE id = ? AND is_active = 1').get(assigneeId)) {
    assigneeId = rq.requester_id; // fallback امن
  }
  const hours = Number(opts.deadline_hours) || 0;
  const deadline = hours > 0 ? new Date(Date.now() + hours * 3600 * 1000).toISOString() : null;
  const title = opts.title || `پیگیری: ${rq.title}`;
  const description = opts.description || `این تسک از فرآیند «${tpl.name}» (درخواست #${rq.id}) ساخته شد.`;
  const info = db.prepare(`INSERT INTO tasks (title, description, assigner_id, assignee_id, priority, start_at, deadline)
    VALUES (?, ?, ?, ?, ?, datetime('now'), ?)`)
    .run(title, description, actorId, assigneeId, opts.priority || 'normal', deadline);
  const taskId = info.lastInsertRowid;
  // درخواست‌دهنده تسک را ببیند (اگر خودش مسئول نیست)
  if (rq.requester_id !== assigneeId) {
    db.prepare('INSERT OR IGNORE INTO task_participants (task_id, user_id) VALUES (?, ?)').run(taskId, rq.requester_id);
  }
  // اولین تسکِ ساخته‌شده را به درخواست پیوند بده (برای نشانِ «تسک ساخته شد»)
  if (opts.link_to_request !== false && !rq.task_id) {
    db.prepare('UPDATE workflow_requests SET task_id = ? WHERE id = ?').run(taskId, rq.id);
  }
  if (opts.notify !== false && opts.notify !== 0) {
    notifyUsers([assigneeId], {
      type: 'task',
      title: `تسک جدید: ${title}`,
      body: `از فرآیند «${tpl.name}» ساخته شد`,
      link: `/tasks`,
    });
  }
  return taskId;
}

// ساخت تسک برای یک «مرحله» بر اساس تنظیمات همان مرحله
function createStepTask(rq, tpl, step, approverId) {
  if (!step || !step.create_task) return null;
  return createTaskFromRequest(rq, tpl, approverId, {
    assignee_type: step.task_assignee_type || 'requester',
    assignee_id: step.task_assignee_id,
    approver_id: approverId,
    deadline_hours: step.task_deadline_hours || 0,
    notify: step.task_notify !== 0,
    title: step.task_title || `پیگیری «${step.title}»: ${rq.title}`,
  });
}

// ---------- templates ----------
r.get('/templates', (req, res) => {
  const all = db.prepare('SELECT * FROM workflow_templates ORDER BY id DESC').all();
  const templates = all
    .filter(t => templateInScope(req.user, t))
    .map(t => ({ ...t, steps: getSteps(t.id).map(s => enrichStep(s)) }));
  res.json({ templates });
});

// پیش‌نمایش زنجیره تایید برای درخواست‌دهنده فعلی — با نام دقیق افراد
r.get('/templates/:id/preview', (req, res) => {
  const tpl = db.prepare('SELECT * FROM workflow_templates WHERE id = ?').get(req.params.id);
  if (!tpl) return res.status(404).json({ error: 'فرآیند یافت نشد' });
  const steps = getSteps(tpl.id).map(s => enrichStep(s, req.user.id));
  res.json({ steps });
});

// درج مراحل یک فرآیند (شامل جایگزین‌ها و پرچم امضا)
function insertSteps(templateId, steps) {
  const ins = db.prepare(`INSERT INTO workflow_steps
    (template_id, step_order, title, approver_type, approver_id, approver_role, deadline_hours, is_optional, alt_approvers, requires_signature, notify_approver,
     create_task, task_assignee_type, task_assignee_id, task_deadline_hours, task_title, task_notify)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  steps.forEach((s, i) => {
    const alts = Array.isArray(s.alt_approvers) ? s.alt_approvers
      .filter(a => a && a.approver_type)
      .map(a => ({ approver_type: a.approver_type, approver_id: a.approver_id || null, approver_role: a.approver_role || null }))
      : [];
    ins.run(templateId, i + 1, s.title, s.approver_type, s.approver_id || null, s.approver_role || null,
      s.deadline_hours || 0, s.is_optional ? 1 : 0, JSON.stringify(alts),
      s.requires_signature === 0 || s.requires_signature === false ? 0 : 1,
      s.notify_approver === 0 || s.notify_approver === false ? 0 : 1, // [مورد ۴]
      s.create_task ? 1 : 0,
      String(s.task_assignee_type || 'requester'),
      s.task_assignee_type === 'user' ? (s.task_assignee_id || null) : null,
      Number(s.task_deadline_hours) || 0,
      String(s.task_title || ''),
      s.task_notify === 0 || s.task_notify === false ? 0 : 1);
  });
}

// فیلدهای سطح‌فرآیندِ جدید (اسکوپ/ضمیمه/مهلت‌کل/تسک‌نهایی) — از body استخراج و normalize می‌شوند
function templateExtras(body, prev = {}) {
  const num = (v, d) => (v === undefined || v === null || v === '' ? d : Number(v) || 0);
  return {
    scope_dept_ids: body.scope_dept_ids !== undefined
      ? JSON.stringify((Array.isArray(body.scope_dept_ids) ? body.scope_dept_ids : []).map(Number).filter(Boolean))
      : (prev.scope_dept_ids ?? '[]'),
    attachments: body.attachments !== undefined
      ? JSON.stringify((Array.isArray(body.attachments) ? body.attachments : []).map(Number).filter(Boolean))
      : (prev.attachments ?? '[]'),
    total_deadline_hours: body.total_deadline_hours !== undefined ? num(body.total_deadline_hours, 0) : (prev.total_deadline_hours ?? 0),
    final_task_enabled: body.final_task_enabled !== undefined ? (body.final_task_enabled ? 1 : 0) : (prev.final_task_enabled ?? 0),
    final_task_assignee_type: body.final_task_assignee_type !== undefined ? String(body.final_task_assignee_type || 'requester') : (prev.final_task_assignee_type ?? 'requester'),
    final_task_assignee_id: body.final_task_assignee_id !== undefined ? (body.final_task_assignee_id || null) : (prev.final_task_assignee_id ?? null),
    final_task_deadline_hours: body.final_task_deadline_hours !== undefined ? num(body.final_task_deadline_hours, 0) : (prev.final_task_deadline_hours ?? 0),
    final_task_notify: body.final_task_notify !== undefined ? (body.final_task_notify ? 1 : 0) : (prev.final_task_notify ?? 1),
  };
}

r.post('/templates', (req, res) => {
  if (!canBuildWorkflows(req.user)) return res.status(403).json({ error: 'شما مجاز به تعریف فرآیند نیستید' });
  const { name, description = '', title_placeholder = '', form_schema = [], steps = [],
    notify_requester_on_final = 1, requester_signature = 1 } = req.body || {};
  if (!name || !steps.length) return res.status(400).json({ error: 'نام و حداقل یک مرحله الزامی است' });
  const ex = templateExtras(req.body || {});
  const result = db.prepare(`INSERT INTO workflow_templates
    (name, description, title_placeholder, form_schema, notify_requester_on_final, requester_signature, created_by,
     scope_dept_ids, attachments, total_deadline_hours, final_task_enabled, final_task_assignee_type, final_task_assignee_id, final_task_deadline_hours, final_task_notify)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(name, description, title_placeholder, JSON.stringify(form_schema),
      notify_requester_on_final ? 1 : 0, requester_signature ? 1 : 0, req.user.id,
      ex.scope_dept_ids, ex.attachments, ex.total_deadline_hours, ex.final_task_enabled,
      ex.final_task_assignee_type, ex.final_task_assignee_id, ex.final_task_deadline_hours, ex.final_task_notify);
  insertSteps(result.lastInsertRowid, steps);
  res.json({ id: result.lastInsertRowid });
});

r.put('/templates/:id', (req, res) => {
  const t = db.prepare('SELECT * FROM workflow_templates WHERE id = ?').get(req.params.id);
  if (!t) return res.status(404).json({ error: 'فرآیند یافت نشد' });
  // سازنده فرآیند یا دارنده workflows.manage می‌تواند ویرایش کند
  if (!hasPerm(req.user, 'workflows.manage') && !(canBuildWorkflows(req.user) && t.created_by === req.user.id)) {
    return res.status(403).json({ error: 'فقط سازنده فرآیند یا مدیر سامانه می‌تواند آن را ویرایش کند' });
  }
  const { name, description, title_placeholder, form_schema, steps, is_active,
    notify_requester_on_final, requester_signature } = req.body || {};
  const ex = templateExtras(req.body || {}, t);
  db.prepare(`UPDATE workflow_templates SET name = ?, description = ?, title_placeholder = ?, form_schema = ?,
    is_active = ?, notify_requester_on_final = ?, requester_signature = ?,
    scope_dept_ids = ?, attachments = ?, total_deadline_hours = ?, final_task_enabled = ?,
    final_task_assignee_type = ?, final_task_assignee_id = ?, final_task_deadline_hours = ?, final_task_notify = ? WHERE id = ?`)
    .run(name ?? t.name, description ?? t.description,
      title_placeholder ?? t.title_placeholder,
      form_schema !== undefined ? JSON.stringify(form_schema) : t.form_schema,
      is_active !== undefined ? (is_active ? 1 : 0) : t.is_active,
      notify_requester_on_final !== undefined ? (notify_requester_on_final ? 1 : 0) : t.notify_requester_on_final,
      requester_signature !== undefined ? (requester_signature ? 1 : 0) : t.requester_signature,
      ex.scope_dept_ids, ex.attachments, ex.total_deadline_hours, ex.final_task_enabled,
      ex.final_task_assignee_type, ex.final_task_assignee_id, ex.final_task_deadline_hours, ex.final_task_notify, t.id);
  if (steps) {
    const hasOpen = db.prepare("SELECT 1 FROM workflow_requests WHERE template_id = ? AND status = 'in_progress'").get(t.id);
    if (hasOpen) return res.status(400).json({ error: 'تا زمانی که درخواست در جریان دارد، مراحل قابل تغییر نیست' });
    db.prepare('DELETE FROM workflow_steps WHERE template_id = ?').run(t.id);
    insertSteps(t.id, steps);
  }
  res.json({ ok: true });
});

// حذف فرآیند — مدیر سامانه (هر فرآیند) یا سرگروه/سازنده (فرآیند خودش)
r.delete('/templates/:id', (req, res) => {
  const t = db.prepare('SELECT * FROM workflow_templates WHERE id = ?').get(req.params.id);
  if (!t) return res.status(404).json({ error: 'فرآیند یافت نشد' });
  if (!hasPerm(req.user, 'workflows.manage') && !(canBuildWorkflows(req.user) && t.created_by === req.user.id)) {
    return res.status(403).json({ error: 'فقط سازنده فرآیند یا مدیر سامانه می‌تواند آن را حذف کند' });
  }
  const count = db.prepare('SELECT COUNT(*) c FROM workflow_requests WHERE template_id = ?').get(t.id).c;
  if (count > 0) {
    return res.status(400).json({ error: 'این فرآیند دارای درخواست ثبت‌شده است و قابل حذف نیست؛ می‌توانید آن را غیرفعال کنید' });
  }
  db.prepare('DELETE FROM workflow_steps WHERE template_id = ?').run(t.id);
  db.prepare('DELETE FROM workflow_templates WHERE id = ?').run(t.id);
  res.json({ ok: true });
});

// ---------- requests ----------
r.post('/requests', (req, res) => {
  const { template_id, title, form_data = {} } = req.body || {};
  const tpl = db.prepare('SELECT * FROM workflow_templates WHERE id = ? AND is_active = 1').get(template_id);
  if (!tpl) return res.status(404).json({ error: 'فرآیند یافت نشد' });
  if (!title) return res.status(400).json({ error: 'عنوان الزامی است' });
  const steps = getSteps(tpl.id);
  if (!steps.length) return res.status(400).json({ error: 'این فرآیند مرحله‌ای ندارد' });
  const first = steps[0];
  const result = db.prepare(`INSERT INTO workflow_requests (template_id, requester_id, title, form_data, step_due_at)
    VALUES (?, ?, ?, ?, ?)`).run(tpl.id, req.user.id, title, JSON.stringify(form_data), stepDueAt(first));
  db.prepare('INSERT INTO workflow_actions (request_id, step_order, actor_id, action, comment) VALUES (?, 0, ?, ?, ?)')
    .run(result.lastInsertRowid, req.user.id, 'submit', 'ثبت درخواست');
  const approvers = resolveApprovers(first, req.user.id);
  notifyApprovers(first, approvers, {
    type: 'workflow',
    title: `کارتابل: ${tpl.name}`,
    body: `«${title}» توسط ${req.user.full_name} ثبت شد و در انتظار اقدام شماست (${first.title})`,
    link: `/cartable/${result.lastInsertRowid}`,
  });
  res.json({ id: result.lastInsertRowid });
});

r.get('/requests/inbox', (req, res) => {
  const open = db.prepare(`
    SELECT r.*, t.name AS template_name, u.full_name AS requester_name
    FROM workflow_requests r
    JOIN workflow_templates t ON t.id = r.template_id
    JOIN users u ON u.id = r.requester_id
    WHERE r.status = 'in_progress' ORDER BY r.id DESC`).all();
  const inbox = open.filter(rq => {
    const step = currentStepOf(rq);
    return step && resolveApprovers(step, rq.requester_id).includes(req.user.id);
  }).map(rq => ({ ...rq, step_title: currentStepOf(rq)?.title }));
  res.json({ requests: inbox });
});

r.get('/requests/mine', (req, res) => {
  const requests = db.prepare(`
    SELECT r.*, t.name AS template_name FROM workflow_requests r
    JOIN workflow_templates t ON t.id = r.template_id
    WHERE r.requester_id = ? ORDER BY r.id DESC`).all(req.user.id)
    .map(rq => ({ ...rq, step_title: rq.status === 'in_progress' ? currentStepOf(rq)?.title : null }));
  res.json({ requests });
});

// [مورد ۶] فهرست درخواست‌ها با دسترسیِ اسکوپ‌محور:
//  • ادمین/مدیریت مجموعه → همه
//  • مدیرِ واحد → درخواست‌های اعضای واحد(های) خودش
//  • هرکس → به‌علاوهٔ کاربرانی که دستی به او اجازه داده شده + فرآیندهای ساختهٔ خودش
//  • در غیر این‌صورت فقط درخواست‌های خودش
r.get('/requests/all', (req, res) => {
  const u = req.user;
  const base = `SELECT r.*, t.name AS template_name, us.full_name AS requester_name,
      d.name AS requester_department
    FROM workflow_requests r
    JOIN workflow_templates t ON t.id = r.template_id
    JOIN users us ON us.id = r.requester_id
    LEFT JOIN departments d ON d.id = us.department_id`;
  let rows;
  if (canAccessEverywhere(u)) {
    rows = db.prepare(`${base} ORDER BY r.id DESC LIMIT 500`).all();
  } else {
    // مجموعهٔ کاربرانی که این کاربر مجاز به دیدن درخواست‌هایشان است
    const allowed = new Set([u.id]);
    const managed = getManagedDeptIds(u);
    if (managed.length) {
      const ph = managed.map(() => '?').join(',');
      for (const row of db.prepare(`SELECT id FROM users WHERE department_id IN (${ph})`).all(...managed)) allowed.add(row.id);
    }
    for (const row of db.prepare('SELECT target_id FROM request_view_grants WHERE viewer_id = ?').all(u.id)) allowed.add(row.target_id);
    const ph = [...allowed].map(() => '?').join(',');
    rows = db.prepare(`${base} WHERE r.requester_id IN (${ph}) OR t.created_by = ?
      ORDER BY r.id DESC LIMIT 500`).all(...allowed, u.id);
  }
  const requests = rows.map(rq => ({ ...rq, step_title: rq.status === 'in_progress' ? currentStepOf(rq)?.title : null }));
  res.json({ requests, scoped: !canAccessEverywhere(u) });
});

// [مورد ۶] مدیریتِ اجازه‌های فردیِ دیدن درخواست‌ها — فقط ادمین/مدیریت مجموعه
r.get('/request-grants', (req, res) => {
  if (!canAccessEverywhere(req.user)) return res.status(403).json({ error: 'دسترسی غیرمجاز' });
  const grants = db.prepare(`
    SELECT g.viewer_id, g.target_id, v.full_name AS viewer_name, t.full_name AS target_name
    FROM request_view_grants g
    JOIN users v ON v.id = g.viewer_id
    JOIN users t ON t.id = g.target_id
    ORDER BY v.full_name`).all();
  res.json({ grants });
});
r.post('/request-grants', (req, res) => {
  if (!canAccessEverywhere(req.user)) return res.status(403).json({ error: 'دسترسی غیرمجاز' });
  const { viewer_id, target_id } = req.body || {};
  if (!viewer_id || !target_id) return res.status(400).json({ error: 'بیننده و کاربرِ هدف الزامی است' });
  if (Number(viewer_id) === Number(target_id)) return res.status(400).json({ error: 'کاربر همیشه درخواست‌های خودش را می‌بیند' });
  db.prepare('INSERT OR IGNORE INTO request_view_grants (viewer_id, target_id) VALUES (?, ?)').run(viewer_id, target_id);
  res.json({ ok: true });
});
r.delete('/request-grants', (req, res) => {
  if (!canAccessEverywhere(req.user)) return res.status(403).json({ error: 'دسترسی غیرمجاز' });
  const { viewer_id, target_id } = req.body || {};
  db.prepare('DELETE FROM request_view_grants WHERE viewer_id = ? AND target_id = ?').run(viewer_id, target_id);
  res.json({ ok: true });
});

// ---------- گزارش‌گیری و بایگانی ----------
r.get('/reports', (req, res) => {
  const canReport = canBuildWorkflows(req.user) || hasPerm(req.user, 'reports.view');
  if (!canReport) return res.status(403).json({ error: 'دسترسی غیرمجاز' });
  // دید کامل: مدیر سامانه یا دارنده reports.view — دیگران فقط فرآیندهای خودشان
  const full = hasPerm(req.user, 'workflows.manage') || hasPerm(req.user, 'reports.view');
  const { template_id, status, department_id, from, to } = req.query;
  const where = [];
  const params = [];
  if (!full) { where.push('t.created_by = ?'); params.push(req.user.id); }
  if (template_id) { where.push('r.template_id = ?'); params.push(Number(template_id)); }
  if (status) { where.push('r.status = ?'); params.push(String(status)); }
  if (department_id) { where.push('u.department_id = ?'); params.push(Number(department_id)); }
  if (from) { where.push('r.created_at >= ?'); params.push(String(from)); }
  if (to) { where.push('r.created_at <= ?'); params.push(String(to) + ' 23:59:59'); }
  const requests = db.prepare(`
    SELECT r.*, t.name AS template_name, u.full_name AS requester_name, d.name AS requester_department
    FROM workflow_requests r
    JOIN workflow_templates t ON t.id = r.template_id
    JOIN users u ON u.id = r.requester_id
    LEFT JOIN departments d ON d.id = u.department_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY r.id DESC LIMIT 500`).all(...params)
    .map(rq => {
      const acts = db.prepare(`
        SELECT a.action, a.comment, a.created_at, a.step_order, u.full_name AS actor_name
        FROM workflow_actions a JOIN users u ON u.id = a.actor_id
        WHERE a.request_id = ? ORDER BY a.id`).all(rq.id);
      return {
        ...rq,
        step_title: rq.status === 'in_progress' ? currentStepOf(rq)?.title : null,
        actions: acts,
        approvals_count: acts.filter(a => a.action === 'approve').length,
      };
    });
  res.json({ requests });
});

r.get('/requests/:id', (req, res) => {
  const rq = db.prepare('SELECT * FROM workflow_requests WHERE id = ?').get(req.params.id);
  if (!rq) return res.status(404).json({ error: 'درخواست یافت نشد' });
  if (!canViewRequest(req.user, rq)) return res.status(403).json({ error: 'شما مجاز به مشاهدهٔ این درخواست نیستید' });
  const detail = requestDetail(Number(req.params.id), req.user.id);
  res.json({ request: detail });
});

// سرو امن امضا: تصویر امضا فقط در بستر یک اقدامِ تاییدِ واقعی روی همین درخواست
// و فقط برای کسی که مجاز به دیدن این درخواست است ارائه می‌شود.
// امضاها هرگز به‌صورت مستقل یا عمومی در دسترس نیستند (ضدجعل).
r.get('/requests/:id/signature/:actionId', (req, res) => {
  const rq = db.prepare('SELECT * FROM workflow_requests WHERE id = ?').get(req.params.id);
  if (!rq) return res.status(404).json({ error: 'درخواست یافت نشد' });
  if (!canViewRequest(req.user, rq)) return res.status(403).json({ error: 'دسترسی غیرمجاز' });
  const action = db.prepare('SELECT * FROM workflow_actions WHERE id = ? AND request_id = ?')
    .get(req.params.actionId, rq.id);
  // امضا فقط برای اقدامِ «تایید» معنا دارد (نه رد/عبور/یادداشت)
  if (!action || action.action !== 'approve') return res.status(404).json({ error: 'امضا برای این اقدام وجود ندارد' });
  const u = db.prepare('SELECT signature_path FROM users WHERE id = ?').get(action.actor_id);
  if (!u?.signature_path) return res.status(404).json({ error: 'امضایی ثبت نشده است' });
  const p = path.join(SIGNATURES_DIR, u.signature_path);
  if (!fs.existsSync(p)) return res.status(404).json({ error: 'فایل امضا یافت نشد' });
  res.setHeader('Cache-Control', 'private, no-store');
  res.sendFile(p);
});

// ارسال مجدد اعلان به مسئولان مرحله فعلی — وقتی ساختار سازمانی بعد از ثبت تغییر کرده باشد
r.post('/requests/:id/renotify', (req, res) => {
  const rq = db.prepare('SELECT * FROM workflow_requests WHERE id = ?').get(req.params.id);
  if (!rq) return res.status(404).json({ error: 'درخواست یافت نشد' });
  if (rq.status !== 'in_progress') return res.status(400).json({ error: 'این درخواست بسته شده است' });
  if (rq.requester_id !== req.user.id && !hasPerm(req.user, 'workflows.manage') && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'دسترسی غیرمجاز' });
  }
  const step = currentStepOf(rq);
  if (!step) return res.status(400).json({ error: 'مرحله فعلی نامعتبر است' });
  const approvers = resolveApprovers(step, rq.requester_id);
  if (!approvers.length) return res.status(400).json({ error: 'مسئولی برای مرحله فعلی پیدا نشد' });
  const tpl = db.prepare('SELECT * FROM workflow_templates WHERE id = ?').get(rq.template_id);
  notifyUsers(approvers, {
    type: 'workflow',
    title: `کارتابل: ${tpl.name}`,
    body: `«${rq.title}» در مرحله «${step.title}» در انتظار اقدام شماست`,
    link: `/cartable/${rq.id}`,
  });
  res.json({ ok: true, notified: approvers.length });
});

r.post('/requests/:id/action', (req, res) => {
  const rq = db.prepare('SELECT * FROM workflow_requests WHERE id = ?').get(req.params.id);
  if (!rq) return res.status(404).json({ error: 'درخواست یافت نشد' });
  if (rq.status !== 'in_progress') return res.status(400).json({ error: 'این درخواست بسته شده است' });
  const { action, comment = '' } = req.body || {};
  const step = currentStepOf(rq);
  const approvers = resolveApprovers(step, rq.requester_id);
  if (!approvers.includes(req.user.id)) return res.status(403).json({ error: 'شما مجاز به اقدام در این مرحله نیستید' });
  if (!['approve', 'reject', 'skip'].includes(action)) return res.status(400).json({ error: 'اقدام نامعتبر' });
  if (action === 'skip' && !step.is_optional) return res.status(400).json({ error: 'این مرحله الزامی است و قابل عبور نیست' });

  // اگر کاربر تاییدکنندهٔ مستقیم نبوده و فقط به‌واسطهٔ نیابت اقدام می‌کند، در سابقه ثبت شود
  const direct = resolveApprovers(step, rq.requester_id, { withDeputies: false });
  const isDeputy = !direct.includes(req.user.id);
  const finalComment = isDeputy ? `(به نیابت) ${comment}`.trim() : comment;
  db.prepare('INSERT INTO workflow_actions (request_id, step_order, actor_id, action, comment) VALUES (?, ?, ?, ?, ?)')
    .run(rq.id, rq.current_step, req.user.id, action, finalComment);

  const tpl = db.prepare('SELECT * FROM workflow_templates WHERE id = ?').get(rq.template_id);

  if (action === 'reject') {
    db.prepare("UPDATE workflow_requests SET status = 'rejected', closed_at = datetime('now') WHERE id = ?").run(rq.id);
    notifyUsers([rq.requester_id], {
      type: 'workflow',
      title: `درخواست رد شد: ${tpl.name}`,
      body: `«${rq.title}» در مرحله «${step.title}» توسط ${req.user.full_name} رد شد${comment ? ' — ' + comment : ''}`,
      link: `/cartable/${rq.id}`,
    });
    return res.json({ ok: true, status: 'rejected' });
  }

  // [مورد ۷+] اگر این مرحله «ساخت تسک» دارد، هنگام تاییدِ همین مرحله تسک ساخته می‌شود.
  // (تسکِ میانِ سلسله‌مراتب — نه فقط پس از تایید نهایی.)
  if (action === 'approve' && step.create_task) {
    try { createStepTask(rq, tpl, step, req.user.id); } catch {}
    rq.task_id = db.prepare('SELECT task_id FROM workflow_requests WHERE id = ?').get(rq.id)?.task_id || rq.task_id;
  }

  // approve و skip هر دو به مرحله بعد می‌روند (skip فقط برای مراحل اختیاری)
  const steps = getSteps(rq.template_id);
  const next = steps.find(s => s.step_order === rq.current_step + 1);
  if (!next) {
    db.prepare("UPDATE workflow_requests SET status = 'approved', closed_at = datetime('now') WHERE id = ?").run(rq.id);
    // اطلاع به درخواست‌دهنده بعد از تایید نهایی — طبق تنظیم فرآیند (پیش‌فرض: بله)
    if (tpl.notify_requester_on_final !== 0) {
      notifyUsers([rq.requester_id], {
        type: 'workflow',
        title: `درخواست تایید نهایی شد: ${tpl.name}`,
        body: `«${rq.title}» تمام مراحل را با موفقیت طی کرد و تایید نهایی شد`,
        link: `/cartable/${rq.id}`,
      });
    }
    // [مورد ۷] در صورت فعال‌بودن، پس از تایید نهاییِ کلِ سلسله‌مراتب یک تسک بساز
    let createdTaskId = null;
    if (tpl.final_task_enabled) {
      try {
        createdTaskId = createTaskFromRequest(rq, tpl, req.user.id, {
          assignee_type: tpl.final_task_assignee_type,
          assignee_id: tpl.final_task_assignee_id,
          deadline_hours: tpl.final_task_deadline_hours,
          notify: tpl.final_task_notify !== 0,
        });
      } catch {}
    }
    return res.json({ ok: true, status: 'approved', task_id: createdTaskId });
  }

  db.prepare('UPDATE workflow_requests SET current_step = ?, step_due_at = ?, last_reminded_at = NULL WHERE id = ?')
    .run(next.step_order, stepDueAt(next), rq.id);
  const nextApprovers = resolveApprovers(next, rq.requester_id);
  notifyApprovers(next, nextApprovers, {
    type: 'workflow',
    title: `کارتابل: ${tpl.name}`,
    body: `«${rq.title}» به مرحله «${next.title}» رسید و در انتظار اقدام شماست`,
    link: `/cartable/${rq.id}`,
  });
  notifyUsers([rq.requester_id], {
    type: 'workflow',
    title: `پیشرفت درخواست: ${tpl.name}`,
    body: `«${rq.title}» در مرحله «${step.title}» تایید شد و به «${next.title}» رفت`,
    link: `/cartable/${rq.id}`,
  });
  res.json({ ok: true, status: 'in_progress' });
});

// [مورد ۷] ساخت دستیِ تسک از یک درخواست (توسط مدیرِ مجاز یا سازنده/مسئول)
r.post('/requests/:id/make-task', (req, res) => {
  const rq = db.prepare('SELECT * FROM workflow_requests WHERE id = ?').get(req.params.id);
  if (!rq) return res.status(404).json({ error: 'درخواست یافت نشد' });
  if (!canViewRequest(req.user, rq)) return res.status(403).json({ error: 'دسترسی غیرمجاز' });
  if (!canBuildWorkflows(req.user) && rq.requester_id !== req.user.id) {
    return res.status(403).json({ error: 'مجاز به ساخت تسک از این درخواست نیستید' });
  }
  if (rq.task_id) return res.status(400).json({ error: 'برای این درخواست قبلاً تسک ساخته شده است' });
  const tpl = db.prepare('SELECT * FROM workflow_templates WHERE id = ?').get(rq.template_id);
  const { title, description, assignee_type, assignee_id, deadline_hours, priority } = req.body || {};
  const taskId = createTaskFromRequest(rq, tpl, req.user.id, { title, description, assignee_type, assignee_id, deadline_hours, priority });
  res.json({ ok: true, task_id: taskId });
});

r.post('/requests/:id/cancel', (req, res) => {
  const rq = db.prepare('SELECT * FROM workflow_requests WHERE id = ?').get(req.params.id);
  if (!rq) return res.status(404).json({ error: 'درخواست یافت نشد' });
  if (rq.requester_id !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'دسترسی غیرمجاز' });
  if (rq.status !== 'in_progress') return res.status(400).json({ error: 'این درخواست بسته شده است' });
  db.prepare("UPDATE workflow_requests SET status = 'cancelled', closed_at = datetime('now') WHERE id = ?").run(rq.id);
  db.prepare('INSERT INTO workflow_actions (request_id, step_order, actor_id, action, comment) VALUES (?, ?, ?, ?, ?)')
    .run(rq.id, rq.current_step, req.user.id, 'comment', 'درخواست لغو شد');
  res.json({ ok: true });
});

export default r;
