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
import { applyLeaveDeduction } from '../leave-hook.js';

const r = Router();

// ---------- [مورد ۲] آپلود فایلِ ضمیمهٔ فرآیند/درخواست ----------
// هر نوع «سند» مجاز است: عکس، PDF، Word، Excel، PowerPoint، متن، فایل فشرده و … .
// فقط فایل‌های اجراییِ خطرناک مسدود می‌شوند (چون روی سرور/ویندوزِ کاربر قابل اجرا هستند).
export const MAX_ATTACHMENT_SIZE = 25 * 1024 * 1024; // ۲۵ مگابایت
const MAX_ATTACHMENT_MB_FA = '۲۵';

const BLOCKED_EXT = new Set([
  '.exe', '.msi', '.msp', '.com', '.bat', '.cmd', '.pif', '.scr', '.cpl', '.sys', '.dll', '.drv',
  '.sh', '.bash', '.zsh', '.run', '.bin', '.deb', '.rpm', '.appimage',
  '.ps1', '.psm1', '.vbs', '.vbe', '.wsf', '.wsh', '.hta', '.reg', '.lnk', '.scf', '.inf',
  '.js', '.mjs', '.cjs', '.jse', '.jar', '.apk', '.app', '.dmg', '.gadget', '.workflow',
]);

// این پسوندها اگر داخل مرورگر «باز» شوند می‌توانند اسکریپت اجرا کنند → همیشه دانلود می‌شوند
const NEVER_INLINE_EXT = new Set(['.html', '.htm', '.xhtml', '.shtml', '.svg', '.svgz', '.xml', '.xsl', '.xslt', '.mhtml', '.mht']);

// نامِ فایل را busboy با latin1 می‌خواند؛ نام‌های فارسی باید به UTF-8 برگردانده شوند
function decodeFileName(name = '') {
  try {
    const buf = Buffer.from(String(name), 'latin1');
    const utf8 = buf.toString('utf8');
    if (!utf8.includes('\uFFFD') && Buffer.from(utf8, 'utf8').equals(buf)) return utf8;
  } catch {}
  return String(name);
}

function safeExt(originalname = '') {
  const ext = path.extname(String(originalname)).toLowerCase();
  return /^\.[a-z0-9]{1,12}$/.test(ext) ? ext : '';
}

const attachmentMulter = multer({
  storage: multer.diskStorage({
    destination: SHARED_FILES_DIR,
    filename: (req, file, cb) => cb(null, crypto.randomBytes(16).toString('hex') + safeExt(file.originalname)),
  }),
  limits: { fileSize: MAX_ATTACHMENT_SIZE, files: 10 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(decodeFileName(file.originalname)).toLowerCase();
    if (BLOCKED_EXT.has(ext)) {
      return cb(new Error(`فایل «${ext}» مجاز نیست (فایل اجرایی). سند، عکس یا فایل فشرده ارسال کنید`));
    }
    cb(null, true);
  },
});

// خطاهای multer (حجم/نوع فایل) را با پیام فارسی و کد ۴۰۰ برگردان — نه ۵۰۰
function attachmentUpload(req, res, next) {
  attachmentMulter.any()(req, res, (err) => {
    if (!err) return next();
    const msg = err.code === 'LIMIT_FILE_SIZE'
      ? `حجم فایل بیش از حد مجاز است (حداکثر ${MAX_ATTACHMENT_MB_FA} مگابایت)`
      : err.code === 'LIMIT_FILE_COUNT'
      ? 'تعداد فایل‌ها در هر بار آپلود بیش از حد مجاز است'
      : (err.message || 'خطا در آپلود فایل');
    return res.status(400).json({ error: msg });
  });
}

// آپلود یک یا چند فایل ضمیمه. نام فیلد آزاد است (file / files / image — برای سازگاری با نسخهٔ قبل).
r.post('/upload', (req, res, next) => {
  // کلید سراسری خاموش باشد، هیچ فایلی پذیرفته نمی‌شود
  if (!attachmentsEnabledGlobally()) {
    return res.status(403).json({ error: 'پیوست فایل در سامانه غیرفعال شده است (تنظیمات سازمان)' });
  }
  next();
}, attachmentUpload, (req, res) => {
  const files = req.files || [];
  if (!files.length) return res.status(400).json({ error: 'فایلی ارسال نشد' });
  const ins = db.prepare('INSERT INTO files (stored_name, original_name, mime, size, uploader_id) VALUES (?, ?, ?, ?, ?)');
  const out = files.map(f => {
    const original = decodeFileName(f.originalname) || 'file';
    const mime = f.mimetype || 'application/octet-stream';
    const info = ins.run(f.filename, original, mime, f.size || 0, req.user.id);
    return { id: Number(info.lastInsertRowid), original_name: original, mime, size: f.size || 0 };
  });
  // سازگاری با کلاینت قدیم: id فایل اول در ریشهٔ پاسخ هم می‌آید
  res.json({ ...out[0], files: out });
});

// اطلاعات (نام/نوع/حجم) چند فایل با هم — برای نمایش فهرست پیوست‌ها در کلاینت
r.get('/files-meta', (req, res) => {
  const ids = [...new Set(String(req.query.ids || '').split(',').map(Number).filter(Boolean))].slice(0, 300);
  if (!ids.length) return res.json({ files: [] });
  const rows = db.prepare(`SELECT id, original_name, mime, size, created_at FROM files WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids);
  res.json({ files: rows });
});

// آیا این فایل را می‌توان بی‌خطر داخل مرورگر نمایش داد؟ (عکس/PDF/متن/صوت/ویدیو)
function isInlineSafe(f) {
  const ext = path.extname(f.original_name || '').toLowerCase();
  if (NEVER_INLINE_EXT.has(ext)) return false;
  const mime = f.mime || '';
  return mime.startsWith('image/') || mime.startsWith('audio/') || mime.startsWith('video/')
    || mime === 'application/pdf' || mime === 'text/plain';
}

// سرو فایل ضمیمه — نیازمند احرازهویت.
// عکس/PDF به‌صورت inline نمایش داده می‌شوند؛ بقیهٔ اسناد (Word/Excel/…) دانلود می‌شوند.
// با ?download=1 هر فایلی به‌صورت دانلود ارائه می‌شود.
r.get('/files/:id', (req, res) => {
  const f = db.prepare('SELECT * FROM files WHERE id = ?').get(req.params.id);
  if (!f) return res.status(404).json({ error: 'فایل یافت نشد' });
  let p = path.join(SHARED_FILES_DIR, f.stored_name);
  if (!fs.existsSync(p)) p = path.join(UPLOADS_DIR, f.stored_name);
  if (!fs.existsSync(p)) return res.status(404).json({ error: 'فایل یافت نشد' });

  const inlineSafe = isInlineSafe(f);
  const asDownload = req.query.download === '1' || !inlineSafe;
  const name = f.original_name || `file-${f.id}`;
  const asciiName = name.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_');
  res.setHeader('Content-Type', inlineSafe ? (f.mime || 'application/octet-stream') : 'application/octet-stream');
  res.setHeader('Content-Disposition',
    `${asDownload ? 'attachment' : 'inline'}; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(name)}`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, max-age=3600');
  try { res.setHeader('Content-Length', fs.statSync(p).size); } catch {}
  fs.createReadStream(p).pipe(res);
});

// ---------- [پیوست‌ها] کنترل «کجا می‌توان فایل پیوست کرد» ----------
// سه لایه، از کلی به جزئی:
//   ۱) کلید سراسریِ سامانه (تنظیمات): attachments_enabled
//   ۲) سطح فرآیند: workflow_templates.allow_attachments
//   ۳) سطح مرحله:  workflow_steps.allow_attachments
// همهٔ پیش‌فرض‌ها «فعال» است؛ خاموش‌کردنِ هر لایه، لایه‌های پایین‌تر را هم خاموش می‌کند.
export function attachmentsEnabledGlobally() {
  return db.prepare("SELECT value FROM app_settings WHERE key = 'attachments_enabled'").get()?.value !== '0';
}

// اجازهٔ پیوست برای «اقدامِ» یک مرحله (step = null یعنی یادداشت/پیوستِ آزاد، بی‌وابسته به مرحله)
function canAttach(tpl, step) {
  if (!attachmentsEnabledGlobally()) return false;
  if (tpl && tpl.allow_attachments === 0) return false;
  if (step && step.allow_attachments === 0) return false;
  return true;
}

// شناسه‌های فایلِ ورودی را پاک‌سازی می‌کند: فقط idهایی که واقعاً در جدول files وجود دارند
function normalizeFileIds(value) {
  const ids = [...new Set((Array.isArray(value) ? value : value ? [value] : []).map(Number).filter(Boolean))].slice(0, 50);
  if (!ids.length) return [];
  const found = new Set(db.prepare(`SELECT id FROM files WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids).map(x => x.id));
  return ids.filter(id => found.has(id));
}

// انواع فیلدِ فرم که مقدارشان «شناسهٔ فایل» است (عکس یا هر سند دیگر)
const FILE_FIELD_TYPES = new Set(['image', 'file']);

// file idهای موجود در مقدارِ یک فیلدِ فایلی (سازگار با دادهٔ قدیمیِ تک‌فایلی)
function fieldFileIds(value) {
  if (Array.isArray(value)) return value.map(Number).filter(Boolean);
  return Number(value) ? [Number(value)] : [];
}

// همهٔ file idهایی که در فرمِ یک درخواست ارجاع داده شده‌اند (بر اساس نوعِ فیلد در form_schema)
function fileIdsInForm(formSchemaRaw, formDataRaw) {
  let schema = [], data = {};
  try { schema = JSON.parse(formSchemaRaw || '[]'); } catch {}
  try { data = JSON.parse(formDataRaw || '{}'); } catch {}
  const out = [];
  for (const f of Array.isArray(schema) ? schema : []) {
    if (f && FILE_FIELD_TYPES.has(f.type)) out.push(...fieldFileIds(data?.[f.key]));
  }
  return out;
}

// شمارِ کلِ فایل‌های پیوستِ یک درخواست (فرم + پیوستِ اقدام‌ها) — برای نشانِ «پیوست دارد» در فهرست‌ها
function attachmentCount(rq) {
  const schema = db.prepare('SELECT form_schema FROM workflow_templates WHERE id = ?').get(rq.template_id)?.form_schema;
  let n = fileIdsInForm(schema, rq.form_data).length;
  for (const row of db.prepare('SELECT attachments FROM workflow_actions WHERE request_id = ?').all(rq.id)) {
    try { n += JSON.parse(row.attachments || '[]').length; } catch {}
  }
  return n;
}

// اطلاعات نام/نوع/حجم چند فایل — برای همراه‌کردن با پاسخِ جزئیات درخواست
function filesMetaByIds(ids) {
  const uniq = [...new Set((ids || []).map(Number).filter(Boolean))].slice(0, 500);
  if (!uniq.length) return [];
  return db.prepare(`SELECT id, original_name, mime, size FROM files WHERE id IN (${uniq.map(() => '?').join(',')})`).all(...uniq);
}

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

// ============================================================================
//  [ویرایش / برگشت / تایید نهاییِ درخواست‌دهنده]
//  وضعیت‌های «باز» یک درخواست:
//    in_progress        → در جریانِ سلسله‌مراتب تایید
//    awaiting_requester → همهٔ مراحل تایید شده، منتظر تایید نهاییِ خودِ درخواست‌دهنده
//    returned           → برای اصلاح به درخواست‌دهنده برگشت داده شده (ویرایش + ارسال مجدد)
// ============================================================================
const OPEN_STATUSES = new Set(['in_progress', 'awaiting_requester', 'returned']);

// آیا روی این درخواست تاکنون تایید/عبوری ثبت شده است؟
function hasAnyApproval(requestId) {
  return !!db.prepare("SELECT 1 FROM workflow_actions WHERE request_id = ? AND action IN ('approve','skip')").get(requestId);
}

// چه کسی می‌تواند عنوان/فرمِ درخواست را ویرایش کند؟
//  • مدیر سامانه یا دارندهٔ workflows.manage → همیشه (اصلاح از صفحهٔ گزارش‌گیری، حتی پس از بسته‌شدن)
//  • درخواست‌دهنده → تا قبل از اولین تاییدِ سلسله‌مراتب، یا وقتی درخواست برای اصلاح به او برگشته،
//    یا وقتی درخواست در انتظار تایید نهاییِ خودِ اوست
function canEditRequest(user, rq) {
  if (!rq) return false;
  if (user.role === 'admin' || hasPerm(user, 'workflows.manage')) return true;
  if (rq.requester_id !== user.id) return false;
  if (rq.status === 'returned' || rq.status === 'awaiting_requester') return true;
  if (rq.status === 'in_progress') return !hasAnyApproval(rq.id);
  return false;
}

// حذف کاملِ درخواست از سامانه — فقط مدیر سامانه / دارندهٔ workflows.manage
function canDeleteRequest(user) {
  return user.role === 'admin' || hasPerm(user, 'workflows.manage');
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

// برچسبِ «مرحلهٔ فعلی» برای فهرست‌ها — شاملِ وضعیت‌های تایید نهایی و برگشت‌خورده
function stepLabelOf(rq) {
  if (rq.status === 'in_progress') return currentStepOf(rq)?.title || null;
  if (rq.status === 'awaiting_requester') return 'در انتظار تایید نهاییِ درخواست‌دهنده';
  if (rq.status === 'returned') return 'برگشت به درخواست‌دهنده برای اصلاح';
  return null;
}

function stepDueAt(step) {
  if (!step?.deadline_hours) return null;
  return new Date(Date.now() + step.deadline_hours * 3600 * 1000).toISOString();
}

function requestDetail(id, userId) {
  const req_ = db.prepare(`
    SELECT r.*, t.name AS template_name, t.form_schema, t.requester_signature,
           t.notify_requester_on_final, t.requester_final_approval, u.full_name AS requester_name,
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
  const viewer = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  const can_act = req_.status === 'in_progress' && !!cur && cur.approvers.includes(userId);
  // [تایید نهایی درخواست‌دهنده] درخواست همهٔ مراحل را طی کرده و منتظر تایید نهاییِ خودِ اوست
  const can_final = req_.status === 'awaiting_requester'
    && (req_.requester_id === userId || viewer?.role === 'admin');
  // [برگشت] تاییدکنندهٔ مرحلهٔ فعلی می‌تواند به مراحل قبل یا به درخواست‌دهنده برگرداند؛
  // درخواست‌دهنده در مرحلهٔ تایید نهایی می‌تواند به «هر مرحله‌ای» برگرداند.
  const can_return = can_act || can_final;
  const return_min_step = can_final ? 1 : 0;   // ۰ = برگشت به درخواست‌دهنده برای اصلاح
  const return_max_step = can_final ? steps.length : Math.max(0, req_.current_step - 1);
  // [اصلاح] درخواست برای اصلاح برگشته و خودِ درخواست‌دهنده باید دوباره ارسالش کند
  const can_resubmit = req_.status === 'returned'
    && (req_.requester_id === userId || viewer?.role === 'admin');
  const can_edit = viewer ? canEditRequest(viewer, req_) : false;
  const can_delete = viewer ? canDeleteRequest(viewer) : false;
  // [پیوست‌ها] اطلاعات همهٔ فایل‌های ارجاع‌داده‌شده (فرم + پیوستِ اقدام‌ها + ضمیمهٔ فرآیند)
  let tplAtt = [];
  try { tplAtt = JSON.parse(db.prepare('SELECT attachments FROM workflow_templates WHERE id = ?').get(req_.template_id)?.attachments || '[]'); } catch {}
  const actionAtt = actions.flatMap(a => { try { return JSON.parse(a.attachments || '[]'); } catch { return []; } });
  const files = filesMetaByIds([
    ...fileIdsInForm(req_.form_schema, req_.form_data),
    ...actionAtt,
    ...tplAtt.map(Number),
  ]);
  // [پیوست‌ها] آیا کاربر اجازهٔ پیوست دارد؟ (کلید سراسری ← تنظیم فرآیند ← تنظیم مرحله)
  const tplRow = db.prepare('SELECT allow_attachments FROM workflow_templates WHERE id = ?').get(req_.template_id);
  const can_attach_action = canAttach(tplRow, cur || null);                 // همراهِ تایید/رد/عبور
  const can_attach_note = canAttach(tplRow, can_act ? cur : null);           // یادداشت/پیوستِ آزاد
  return {
    ...req_, steps, actions, files, can_attach_action, can_attach_note,
    can_act, can_final, can_return, return_min_step, return_max_step, can_resubmit, can_edit, can_delete,
  };
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

// بستنِ درخواست به‌عنوان «تایید نهایی» + اعلان به درخواست‌دهنده + ساخت تسکِ نهایی (در صورت فعال‌بودن)
function closeAsApproved(rq, tpl, actorId) {
  db.prepare("UPDATE workflow_requests SET status = 'approved', closed_at = datetime('now') WHERE id = ?").run(rq.id);
  // [مرخصی] اگر این فرآیند «فرآیند مرخصی» است، مقدارِ مرخصی از ماندهٔ درخواست‌دهنده کم می‌شود
  applyLeaveDeduction(rq, tpl);
  // اطلاع به درخواست‌دهنده — طبق تنظیم فرآیند (پیش‌فرض: بله). اگر خودش تایید نهایی کرده، اعلان لازم نیست.
  if (tpl.notify_requester_on_final !== 0 && rq.requester_id !== actorId) {
    notifyUsers([rq.requester_id], {
      type: 'workflow',
      title: `درخواست تایید نهایی شد: ${tpl.name}`,
      body: `«${rq.title}» تمام مراحل را با موفقیت طی کرد و تایید نهایی شد`,
      link: `/cartable/${rq.id}`,
    });
  }
  // [مورد ۷] در صورت فعال‌بودن، پس از تایید نهاییِ کلِ سلسله‌مراتب یک تسک بساز
  if (!tpl.final_task_enabled) return null;
  try {
    return createTaskFromRequest(rq, tpl, actorId, {
      assignee_type: tpl.final_task_assignee_type,
      assignee_id: tpl.final_task_assignee_id,
      deadline_hours: tpl.final_task_deadline_hours,
      notify: tpl.final_task_notify !== 0,
    });
  } catch { return null; }
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
     create_task, task_assignee_type, task_assignee_id, task_deadline_hours, task_title, task_notify, allow_attachments)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
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
      s.task_notify === 0 || s.task_notify === false ? 0 : 1,
      // [پیوست‌ها] اجازهٔ پیوست فایل در این مرحله (پیش‌فرض: مجاز)
      s.allow_attachments === 0 || s.allow_attachments === false ? 0 : 1);
  });
}

// فیلدهای سطح‌فرآیندِ جدید (اسکوپ/ضمیمه/مهلت‌کل/تسک‌نهایی) — از body استخراج و normalize می‌شوند
function templateExtras(body, prev = {}) {
  const num = (v, d) => (v === undefined || v === null || v === '' ? d : Number(v) || 0);
  return {
    scope_dept_ids: body.scope_dept_ids !== undefined
      ? JSON.stringify((Array.isArray(body.scope_dept_ids) ? body.scope_dept_ids : []).map(Number).filter(Boolean))
      : (prev.scope_dept_ids ?? '[]'),
    // [مورد ۲] فایل‌های ضمیمهٔ فرآیند — عکس یا هر سند دیگر (فقط idهای معتبر ذخیره می‌شوند)
    attachments: body.attachments !== undefined
      ? JSON.stringify(normalizeFileIds(body.attachments))
      : (prev.attachments ?? '[]'),
    total_deadline_hours: body.total_deadline_hours !== undefined ? num(body.total_deadline_hours, 0) : (prev.total_deadline_hours ?? 0),
    final_task_enabled: body.final_task_enabled !== undefined ? (body.final_task_enabled ? 1 : 0) : (prev.final_task_enabled ?? 0),
    final_task_assignee_type: body.final_task_assignee_type !== undefined ? String(body.final_task_assignee_type || 'requester') : (prev.final_task_assignee_type ?? 'requester'),
    final_task_assignee_id: body.final_task_assignee_id !== undefined ? (body.final_task_assignee_id || null) : (prev.final_task_assignee_id ?? null),
    final_task_deadline_hours: body.final_task_deadline_hours !== undefined ? num(body.final_task_deadline_hours, 0) : (prev.final_task_deadline_hours ?? 0),
    final_task_notify: body.final_task_notify !== undefined ? (body.final_task_notify ? 1 : 0) : (prev.final_task_notify ?? 1),
    // [پیوست‌ها] اجازهٔ پیوست فایل توسط افرادِ سلسله‌مراتب در این فرآیند (پیش‌فرض: مجاز)
    allow_attachments: body.allow_attachments !== undefined ? (body.allow_attachments ? 1 : 0) : (prev.allow_attachments ?? 1),
    // [تایید نهایی درخواست‌دهنده] بعد از آخرین مرحله، درخواست به خودِ درخواست‌دهنده برمی‌گردد
    requester_final_approval: body.requester_final_approval !== undefined
      ? (body.requester_final_approval ? 1 : 0) : (prev.requester_final_approval ?? 0),
    // [مرخصی] این فرآیند یک «درخواست مرخصی» است و پس از تایید نهایی از ماندهٔ کاربر کم می‌کند
    leave_enabled: body.leave_enabled !== undefined ? (body.leave_enabled ? 1 : 0) : (prev.leave_enabled ?? 0),
    leave_map: body.leave_map !== undefined
      ? JSON.stringify(body.leave_map && typeof body.leave_map === 'object' ? body.leave_map : {})
      : (prev.leave_map ?? '{}'),
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
     scope_dept_ids, attachments, total_deadline_hours, final_task_enabled, final_task_assignee_type, final_task_assignee_id, final_task_deadline_hours, final_task_notify,
     allow_attachments, requester_final_approval, leave_enabled, leave_map)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(name, description, title_placeholder, JSON.stringify(form_schema),
      notify_requester_on_final ? 1 : 0, requester_signature ? 1 : 0, req.user.id,
      ex.scope_dept_ids, ex.attachments, ex.total_deadline_hours, ex.final_task_enabled,
      ex.final_task_assignee_type, ex.final_task_assignee_id, ex.final_task_deadline_hours, ex.final_task_notify,
      ex.allow_attachments, ex.requester_final_approval, ex.leave_enabled, ex.leave_map);
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
    final_task_assignee_type = ?, final_task_assignee_id = ?, final_task_deadline_hours = ?, final_task_notify = ?,
    allow_attachments = ?, requester_final_approval = ?, leave_enabled = ?, leave_map = ? WHERE id = ?`)
    .run(name ?? t.name, description ?? t.description,
      title_placeholder ?? t.title_placeholder,
      form_schema !== undefined ? JSON.stringify(form_schema) : t.form_schema,
      is_active !== undefined ? (is_active ? 1 : 0) : t.is_active,
      notify_requester_on_final !== undefined ? (notify_requester_on_final ? 1 : 0) : t.notify_requester_on_final,
      requester_signature !== undefined ? (requester_signature ? 1 : 0) : t.requester_signature,
      ex.scope_dept_ids, ex.attachments, ex.total_deadline_hours, ex.final_task_enabled,
      ex.final_task_assignee_type, ex.final_task_assignee_id, ex.final_task_deadline_hours, ex.final_task_notify,
      ex.allow_attachments, ex.requester_final_approval, ex.leave_enabled, ex.leave_map, t.id);
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
  // [پیوست‌ها] مقدارِ فیلدهای فایلی همیشه آرایه‌ای از idهای معتبر ذخیره می‌شود
  {
    let schema = [];
    try { schema = JSON.parse(tpl.form_schema || '[]'); } catch {}
    for (const f of Array.isArray(schema) ? schema : []) {
      if (f && FILE_FIELD_TYPES.has(f.type)) form_data[f.key] = normalizeFileIds(fieldFileIds(form_data?.[f.key]));
    }
  }
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

// کارهای در انتظار اقدامِ من:
//  • درخواست‌های در جریان که مسئولِ مرحلهٔ فعلی‌شان هستم
//  • درخواست‌های خودم که منتظر «تایید نهایی» من هستند یا برای اصلاح به من برگشته‌اند
r.get('/requests/inbox', (req, res) => {
  const open = db.prepare(`
    SELECT r.*, t.name AS template_name, u.full_name AS requester_name
    FROM workflow_requests r
    JOIN workflow_templates t ON t.id = r.template_id
    JOIN users u ON u.id = r.requester_id
    WHERE r.status IN ('in_progress', 'awaiting_requester', 'returned') ORDER BY r.id DESC`).all();
  const inbox = open.filter(rq => {
    if (rq.status !== 'in_progress') return rq.requester_id === req.user.id;
    const step = currentStepOf(rq);
    return step && resolveApprovers(step, rq.requester_id).includes(req.user.id);
  }).map(rq => ({
    ...rq,
    step_title: rq.status === 'in_progress' ? currentStepOf(rq)?.title
      : rq.status === 'awaiting_requester' ? 'تایید نهایی شما' : 'اصلاح و ارسال مجدد',
    attachments_count: attachmentCount(rq),
  }));
  res.json({ requests: inbox });
});

r.get('/requests/mine', (req, res) => {
  const requests = db.prepare(`
    SELECT r.*, t.name AS template_name FROM workflow_requests r
    JOIN workflow_templates t ON t.id = r.template_id
    WHERE r.requester_id = ? ORDER BY r.id DESC`).all(req.user.id)
    .map(rq => ({ ...rq, step_title: stepLabelOf(rq), attachments_count: attachmentCount(rq) }));
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
  const requests = rows.map(rq => ({
    ...rq,
    step_title: stepLabelOf(rq),
    attachments_count: attachmentCount(rq),
  }));
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
        SELECT a.action, a.comment, a.attachments, a.created_at, a.step_order, u.full_name AS actor_name
        FROM workflow_actions a JOIN users u ON u.id = a.actor_id
        WHERE a.request_id = ? ORDER BY a.id`).all(rq.id);
      return {
        ...rq,
        step_title: stepLabelOf(rq),
        actions: acts,
        approvals_count: acts.filter(a => a.action === 'approve').length,
        attachments_count: attachmentCount(rq),
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
  if (!OPEN_STATUSES.has(rq.status)) return res.status(400).json({ error: 'این درخواست بسته شده است' });
  if (rq.status === 'returned') {
    return res.status(400).json({ error: 'این درخواست برای اصلاح نزد درخواست‌دهنده است و باید دوباره ارسال شود' });
  }
  const { action, comment = '', attachments = [], to_step } = req.body || {};
  const attIds = normalizeFileIds(attachments); // [پیوست‌ها] فایل‌های پیوستِ این اقدام
  const tpl = db.prepare('SELECT * FROM workflow_templates WHERE id = ?').get(rq.template_id);
  const steps = getSteps(rq.template_id);
  // مرحلهٔ «تایید نهاییِ درخواست‌دهنده»: سلسله‌مراتب تمام شده و توپ در زمینِ خودِ درخواست‌دهنده است
  const finalStage = rq.status === 'awaiting_requester';
  const step = finalStage ? null : currentStepOf(rq);

  // ---------- چه کسی مجاز به اقدام است؟ ----------
  if (finalStage) {
    if (rq.requester_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'تایید نهایی این درخواست با درخواست‌دهنده است' });
    }
    if (!['approve', 'reject', 'return'].includes(action)) return res.status(400).json({ error: 'اقدام نامعتبر' });
  } else {
    if (!step) return res.status(400).json({ error: 'مرحله فعلی نامعتبر است' });
    const approvers = resolveApprovers(step, rq.requester_id);
    if (!approvers.includes(req.user.id)) return res.status(403).json({ error: 'شما مجاز به اقدام در این مرحله نیستید' });
    if (!['approve', 'reject', 'skip', 'return'].includes(action)) return res.status(400).json({ error: 'اقدام نامعتبر' });
    if (action === 'skip' && !step.is_optional) return res.status(400).json({ error: 'این مرحله الزامی است و قابل عبور نیست' });
  }
  // [پیوست‌ها] فقط اگر در این فرآیند/مرحله مجاز باشد
  if (attIds.length && !canAttach(tpl, step)) {
    return res.status(400).json({ error: 'پیوست فایل در این مرحله مجاز نیست' });
  }

  const stepLabel = finalStage ? 'تایید نهایی درخواست‌دهنده' : step.title;
  // اگر کاربر تاییدکنندهٔ مستقیم نبوده و فقط به‌واسطهٔ نیابت اقدام می‌کند، در سابقه ثبت شود
  const isDeputy = !finalStage && !resolveApprovers(step, rq.requester_id, { withDeputies: false }).includes(req.user.id);
  const attNote = attIds.length ? ` (${attIds.length.toLocaleString('fa-IR')} فایل پیوست)` : '';
  const logAction = (kind, text) =>
    db.prepare('INSERT INTO workflow_actions (request_id, step_order, actor_id, action, comment, attachments) VALUES (?, ?, ?, ?, ?, ?)')
      .run(rq.id, rq.current_step, req.user.id, kind, text, JSON.stringify(attIds));

  // ---------- برگشتِ درخواست به یک مرحلهٔ قبلی یا به خودِ درخواست‌دهنده ----------
  // to_step === 0 یعنی «برگشت به درخواست‌دهنده برای اصلاح».
  // تاییدکنندهٔ مرحلهٔ فعلی فقط می‌تواند به مراحلِ قبل‌تر برگرداند؛
  // درخواست‌دهنده در مرحلهٔ تایید نهایی می‌تواند به «اول یا هر مرحله‌ای» برگرداند.
  if (action === 'return') {
    const target = Number(to_step);
    const maxStep = finalStage ? steps.length : rq.current_step - 1;
    const minStep = finalStage ? 1 : 0;
    if (!Number.isInteger(target) || target < minStep || target > maxStep) {
      return res.status(400).json({ error: 'مرحلهٔ مقصدِ برگشت نامعتبر است' });
    }
    const back = target === 0 ? null : steps.find(s => s.step_order === target);
    const label = back ? `مرحلهٔ «${back.title}»` : 'درخواست‌دهنده برای اصلاح';
    logAction('return', `برگشت به ${label}${isDeputy ? ' (به نیابت)' : ''}${comment ? ' — ' + comment : ''}`);

    if (!back) {
      // پس از اصلاح، درخواست از کدام مرحله ادامه پیدا کند؟ پیش‌فرض: همین مرحله‌ای که برگشتش داده
      const resume = steps.some(s => s.step_order === Number(req.body?.resume_step))
        ? Number(req.body.resume_step) : Math.max(1, rq.current_step);
      db.prepare(`UPDATE workflow_requests SET status = 'returned', resume_step = ?, step_due_at = NULL,
        last_reminded_at = NULL WHERE id = ?`).run(resume, rq.id);
      notifyUsers([rq.requester_id], {
        type: 'workflow',
        title: `درخواست برای اصلاح برگشت خورد: ${tpl.name}`,
        body: `«${rq.title}» در مرحله «${stepLabel}» توسط ${req.user.full_name} برای اصلاح به شما برگشت داده شد${comment ? ' — ' + comment : ''}${attNote}`,
        link: `/cartable/${rq.id}`,
      });
      return res.json({ ok: true, status: 'returned' });
    }

    db.prepare(`UPDATE workflow_requests SET status = 'in_progress', current_step = ?, step_due_at = ?,
      last_reminded_at = NULL, closed_at = NULL WHERE id = ?`).run(back.step_order, stepDueAt(back), rq.id);
    notifyApprovers(back, resolveApprovers(back, rq.requester_id), {
      type: 'workflow',
      title: `کارتابل: ${tpl.name}`,
      body: `«${rq.title}» توسط ${req.user.full_name} به مرحله «${back.title}» برگشت داده شد و در انتظار اقدام شماست${comment ? ' — ' + comment : ''}`,
      link: `/cartable/${rq.id}`,
    });
    if (rq.requester_id !== req.user.id) {
      notifyUsers([rq.requester_id], {
        type: 'workflow',
        title: `برگشت درخواست: ${tpl.name}`,
        body: `«${rq.title}» از مرحله «${stepLabel}» به مرحله «${back.title}» برگشت داده شد`,
        link: `/cartable/${rq.id}`,
      });
    }
    return res.json({ ok: true, status: 'in_progress', current_step: back.step_order });
  }

  logAction(action, isDeputy ? `(به نیابت) ${comment}`.trim() : comment);

  if (action === 'reject') {
    db.prepare("UPDATE workflow_requests SET status = 'rejected', closed_at = datetime('now') WHERE id = ?").run(rq.id);
    if (rq.requester_id !== req.user.id) {
      notifyUsers([rq.requester_id], {
        type: 'workflow',
        title: `درخواست رد شد: ${tpl.name}`,
        body: `«${rq.title}» در مرحله «${stepLabel}» توسط ${req.user.full_name} رد شد${comment ? ' — ' + comment : ''}${attNote}`,
        link: `/cartable/${rq.id}`,
      });
    }
    return res.json({ ok: true, status: 'rejected' });
  }

  // ---------- تایید نهایی توسط خودِ درخواست‌دهنده ----------
  if (finalStage) {
    const createdTaskId = closeAsApproved(rq, tpl, req.user.id);
    return res.json({ ok: true, status: 'approved', task_id: createdTaskId });
  }

  // [مورد ۷+] اگر این مرحله «ساخت تسک» دارد، هنگام تاییدِ همین مرحله تسک ساخته می‌شود.
  // (تسکِ میانِ سلسله‌مراتب — نه فقط پس از تایید نهایی.)
  if (action === 'approve' && step.create_task) {
    try { createStepTask(rq, tpl, step, req.user.id); } catch {}
    rq.task_id = db.prepare('SELECT task_id FROM workflow_requests WHERE id = ?').get(rq.id)?.task_id || rq.task_id;
  }

  // approve و skip هر دو به مرحله بعد می‌روند (skip فقط برای مراحل اختیاری)
  const next = steps.find(s => s.step_order === rq.current_step + 1);
  if (!next) {
    // [تایید نهایی درخواست‌دهنده] اگر این گزینه در فرآیند روشن باشد، درخواست بسته نمی‌شود و
    // برای تایید نهایی (یا برگشت به هر مرحله) به کارتابلِ خودِ درخواست‌دهنده می‌رود.
    if (tpl.requester_final_approval && rq.requester_id !== req.user.id) {
      db.prepare(`UPDATE workflow_requests SET status = 'awaiting_requester', step_due_at = NULL,
        last_reminded_at = NULL WHERE id = ?`).run(rq.id);
      notifyUsers([rq.requester_id], {
        type: 'workflow',
        title: `در انتظار تایید نهایی شما: ${tpl.name}`,
        body: `«${rq.title}» همهٔ مراحل تایید را طی کرد و برای تایید نهایی در کارتابل شماست`,
        link: `/cartable/${rq.id}`,
      });
      return res.json({ ok: true, status: 'awaiting_requester' });
    }
    const createdTaskId = closeAsApproved(rq, tpl, req.user.id);
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
    body: `«${rq.title}» در مرحله «${step.title}» تایید شد و به «${next.title}» رفت${attNote}`,
    link: `/cartable/${rq.id}`,
  });
  res.json({ ok: true, status: 'in_progress' });
});

// [پیوست‌ها] ثبت یادداشت و/یا پیوستِ فایل بدون تغییرِ مرحله.
// برای همهٔ افرادِ درگیر در سلسله‌مراتب: درخواست‌دهنده، تاییدکنندهٔ مرحلهٔ فعلی،
// هرکسی که قبلاً اقدامی ثبت کرده، مدیرِ واحد و مدیر سامانه (همان قاعدهٔ canViewRequest).
r.post('/requests/:id/comment', (req, res) => {
  const rq = db.prepare('SELECT * FROM workflow_requests WHERE id = ?').get(req.params.id);
  if (!rq) return res.status(404).json({ error: 'درخواست یافت نشد' });
  if (!canViewRequest(req.user, rq)) return res.status(403).json({ error: 'شما مجاز به اقدام روی این درخواست نیستید' });
  const { comment = '', attachments = [] } = req.body || {};
  const text = String(comment || '').trim();
  const attIds = normalizeFileIds(attachments);
  if (!text && !attIds.length) return res.status(400).json({ error: 'یادداشت یا فایل پیوست الزامی است' });
  // [پیوست‌ها] یادداشتِ متنی همیشه آزاد است؛ پیوستِ فایل فقط اگر در این فرآیند مجاز باشد
  if (attIds.length) {
    const tplRow = db.prepare('SELECT allow_attachments FROM workflow_templates WHERE id = ?').get(rq.template_id);
    // اگر ثبت‌کننده همان تاییدکنندهٔ مرحلهٔ فعلی است، محدودیتِ آن مرحله هم اعمال می‌شود
    // (تا مرحلهٔ «غیرمجاز» از راهِ یادداشت دور زده نشود)
    const step = rq.status === 'in_progress' ? currentStepOf(rq) : null;
    const asCurrentApprover = step && resolveApprovers(step, rq.requester_id).includes(req.user.id);
    if (!canAttach(tplRow, asCurrentApprover ? step : null)) {
      return res.status(400).json({ error: 'پیوست فایل در این فرآیند/مرحله مجاز نیست' });
    }
  }

  db.prepare('INSERT INTO workflow_actions (request_id, step_order, actor_id, action, comment, attachments) VALUES (?, ?, ?, ?, ?, ?)')
    .run(rq.id, rq.current_step, req.user.id, 'comment', text, JSON.stringify(attIds));

  // اطلاع به درخواست‌دهنده و مسئولان مرحلهٔ فعلی (جز خودِ ثبت‌کننده)
  const tpl = db.prepare('SELECT * FROM workflow_templates WHERE id = ?').get(rq.template_id);
  const targets = new Set([rq.requester_id]);
  if (rq.status === 'in_progress') {
    const step = currentStepOf(rq);
    if (step) resolveApprovers(step, rq.requester_id).forEach(id => targets.add(id));
  }
  targets.delete(req.user.id);
  if (targets.size) {
    const attNote = attIds.length ? ` — ${attIds.length.toLocaleString('fa-IR')} فایل پیوست` : '';
    notifyUsers([...targets], {
      type: 'workflow',
      title: `یادداشت جدید: ${tpl?.name || 'درخواست'}`,
      body: `${req.user.full_name} روی «${rq.title}» یادداشت/پیوست ثبت کرد${text ? ' — ' + text.slice(0, 120) : ''}${attNote}`,
      link: `/cartable/${rq.id}`,
    });
  }
  res.json({ ok: true, attachments: attIds });
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

// ---------- ویرایش، ارسال مجدد و حذفِ درخواست ----------
// اصلاح عنوان و اطلاعات فرم. تغییرات همیشه در تاریخچهٔ درخواست ثبت می‌شود تا
// تاییدکنندگان بدانند فرم بعد از ثبت عوض شده است.
r.put('/requests/:id', (req, res) => {
  const rq = db.prepare('SELECT * FROM workflow_requests WHERE id = ?').get(req.params.id);
  if (!rq) return res.status(404).json({ error: 'درخواست یافت نشد' });
  if (!canEditRequest(req.user, rq)) {
    return res.status(403).json({ error: 'این درخواست در وضعیت فعلی برای شما قابل ویرایش نیست' });
  }
  const tpl = db.prepare('SELECT * FROM workflow_templates WHERE id = ?').get(rq.template_id);
  const { title, form_data } = req.body || {};
  const newTitle = title !== undefined ? String(title).trim() : rq.title;
  if (!newTitle) return res.status(400).json({ error: 'عنوان الزامی است' });

  let schema = [];
  try { schema = JSON.parse(tpl?.form_schema || '[]'); } catch {}
  if (!Array.isArray(schema)) schema = [];
  let oldData = {};
  try { oldData = JSON.parse(rq.form_data || '{}'); } catch {}
  let newData = oldData;
  if (form_data !== undefined && form_data !== null) {
    newData = { ...form_data };
    // [پیوست‌ها] مقدارِ فیلدهای فایلی همیشه آرایه‌ای از idهای معتبر ذخیره می‌شود
    for (const f of schema) {
      if (f && FILE_FIELD_TYPES.has(f.type)) newData[f.key] = normalizeFileIds(fieldFileIds(newData[f.key]));
    }
  }

  // خلاصهٔ خواناى تغییرات برای تاریخچه
  const changed = [];
  if (newTitle !== rq.title) changed.push(`عنوان درخواست`);
  for (const f of schema) {
    if (!f?.key) continue;
    if (JSON.stringify(oldData?.[f.key] ?? null) !== JSON.stringify(newData?.[f.key] ?? null)) {
      changed.push(f.label || f.key);
    }
  }
  db.prepare("UPDATE workflow_requests SET title = ?, form_data = ?, edited_at = datetime('now') WHERE id = ?")
    .run(newTitle, JSON.stringify(newData), rq.id);
  db.prepare('INSERT INTO workflow_actions (request_id, step_order, actor_id, action, comment) VALUES (?, ?, ?, ?, ?)')
    .run(rq.id, rq.current_step, req.user.id, 'edit',
      changed.length ? `ویرایش درخواست — ${changed.join('، ')}` : 'ویرایش درخواست (بدون تغییر محتوایی)');

  // اطلاع به درخواست‌دهنده و مسئولان مرحلهٔ فعلی (جز خودِ ویرایش‌کننده)
  const targets = new Set([rq.requester_id]);
  if (rq.status === 'in_progress') {
    const step = currentStepOf(rq);
    if (step) resolveApprovers(step, rq.requester_id).forEach(id => targets.add(id));
  }
  targets.delete(req.user.id);
  if (targets.size && changed.length) {
    notifyUsers([...targets], {
      type: 'workflow',
      title: `ویرایش درخواست: ${tpl?.name || ''}`,
      body: `«${newTitle}» توسط ${req.user.full_name} ویرایش شد — ${changed.join('، ')}`,
      link: `/cartable/${rq.id}`,
    });
  }
  res.json({ ok: true, request: requestDetail(rq.id, req.user.id) });
});

// ارسال مجددِ درخواستی که برای اصلاح به درخواست‌دهنده برگشت داده شده است
r.post('/requests/:id/resubmit', (req, res) => {
  const rq = db.prepare('SELECT * FROM workflow_requests WHERE id = ?').get(req.params.id);
  if (!rq) return res.status(404).json({ error: 'درخواست یافت نشد' });
  if (rq.status !== 'returned') return res.status(400).json({ error: 'این درخواست در وضعیت «برگشت برای اصلاح» نیست' });
  if (rq.requester_id !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'فقط درخواست‌دهنده می‌تواند درخواست را دوباره ارسال کند' });
  }
  const steps = getSteps(rq.template_id);
  if (!steps.length) return res.status(400).json({ error: 'این فرآیند مرحله‌ای ندارد' });
  const target = steps.find(s => s.step_order === Number(rq.resume_step)) || steps[0];
  const tpl = db.prepare('SELECT * FROM workflow_templates WHERE id = ?').get(rq.template_id);
  db.prepare(`UPDATE workflow_requests SET status = 'in_progress', current_step = ?, step_due_at = ?,
    last_reminded_at = NULL, closed_at = NULL WHERE id = ?`).run(target.step_order, stepDueAt(target), rq.id);
  db.prepare('INSERT INTO workflow_actions (request_id, step_order, actor_id, action, comment) VALUES (?, ?, ?, ?, ?)')
    .run(rq.id, target.step_order, req.user.id, 'submit', `ارسال مجدد پس از اصلاح — به مرحلهٔ «${target.title}»`);
  notifyApprovers(target, resolveApprovers(target, rq.requester_id), {
    type: 'workflow',
    title: `کارتابل: ${tpl?.name || ''}`,
    body: `«${rq.title}» پس از اصلاح توسط ${req.user.full_name} دوباره ارسال شد و در انتظار اقدام شماست (${target.title})`,
    link: `/cartable/${rq.id}`,
  });
  res.json({ ok: true, current_step: target.step_order });
});

// حذف کاملِ درخواست به‌همراه تاریخچه‌اش — فقط مدیر سامانه / دارندهٔ workflows.manage
r.delete('/requests/:id', (req, res) => {
  const rq = db.prepare('SELECT * FROM workflow_requests WHERE id = ?').get(req.params.id);
  if (!rq) return res.status(404).json({ error: 'درخواست یافت نشد' });
  if (!canDeleteRequest(req.user)) {
    return res.status(403).json({ error: 'فقط مدیر سامانه می‌تواند درخواست را حذف کند' });
  }
  db.prepare('DELETE FROM workflow_actions WHERE request_id = ?').run(rq.id);
  db.prepare('DELETE FROM workflow_requests WHERE id = ?').run(rq.id);
  res.json({ ok: true });
});

r.post('/requests/:id/cancel', (req, res) => {
  const rq = db.prepare('SELECT * FROM workflow_requests WHERE id = ?').get(req.params.id);
  if (!rq) return res.status(404).json({ error: 'درخواست یافت نشد' });
  if (rq.requester_id !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'دسترسی غیرمجاز' });
  if (!OPEN_STATUSES.has(rq.status)) return res.status(400).json({ error: 'این درخواست بسته شده است' });
  db.prepare("UPDATE workflow_requests SET status = 'cancelled', closed_at = datetime('now') WHERE id = ?").run(rq.id);
  db.prepare('INSERT INTO workflow_actions (request_id, step_order, actor_id, action, comment) VALUES (?, ?, ?, ?, ?)')
    .run(rq.id, rq.current_step, req.user.id, 'comment', 'درخواست لغو شد');
  res.json({ ok: true });
});

export default r;
