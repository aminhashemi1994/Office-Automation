import { DatabaseSync } from 'node:sqlite';
import bcrypt from 'bcryptjs';
import fs from 'fs';
import { DB_FILE, UPLOADS_DIR, SHARED_FILES_DIR, RECORDINGS_DIR, AVATARS_DIR, BRANDING_DIR, SIGNATURES_DIR, SOUNDS_DIR } from './config.js';

fs.mkdirSync(UPLOADS_DIR, { recursive: true });
fs.mkdirSync(SHARED_FILES_DIR, { recursive: true });
fs.mkdirSync(RECORDINGS_DIR, { recursive: true });
fs.mkdirSync(AVATARS_DIR, { recursive: true });
fs.mkdirSync(BRANDING_DIR, { recursive: true });
fs.mkdirSync(SIGNATURES_DIR, { recursive: true });
fs.mkdirSync(SOUNDS_DIR, { recursive: true });

const db = new DatabaseSync(DB_FILE);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS departments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  description TEXT DEFAULT '',
  manager_id INTEGER,
  is_management INTEGER DEFAULT 0, -- واحد مدیریت: اعضایش به همه می‌توانند تسک بدهند
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'employee', -- admin | manager | employee
  department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
  position TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  email TEXT DEFAULT '',
  avatar_color TEXT DEFAULT '#2563eb',
  permissions TEXT DEFAULT '[]', -- JSON array of extra permission keys
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL DEFAULT 'dm', -- dm | group
  name TEXT DEFAULT '',
  created_by INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS conversation_members (
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  is_admin INTEGER DEFAULT 0,
  last_read_message_id INTEGER DEFAULT 0,
  joined_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (conversation_id, user_id)
);

CREATE TABLE IF NOT EXISTS files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  stored_name TEXT NOT NULL,
  original_name TEXT NOT NULL,
  mime TEXT DEFAULT '',
  size INTEGER DEFAULT 0,
  uploader_id INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS recordings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  stored_name TEXT NOT NULL,
  title TEXT DEFAULT '',
  room TEXT DEFAULT '',
  conversation_id INTEGER REFERENCES conversations(id) ON DELETE SET NULL,
  kind TEXT DEFAULT 'audio', -- audio | video
  mime TEXT DEFAULT '',
  size INTEGER DEFAULT 0,
  duration INTEGER DEFAULT 0, -- ثانیه
  recorded_by INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_recordings_conv ON recordings(conversation_id, id);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id INTEGER NOT NULL REFERENCES users(id),
  content TEXT DEFAULT '',
  file_id INTEGER REFERENCES files(id),
  created_at TEXT DEFAULT (datetime('now')),
  deleted INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, id);

CREATE TABLE IF NOT EXISTS workflow_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  form_schema TEXT DEFAULT '[]', -- JSON: [{key,label,type,required,options}]
  is_active INTEGER DEFAULT 1,
  notify_requester_on_final INTEGER DEFAULT 1, -- اطلاع به درخواست‌دهنده بعد از تایید نهایی
  requester_signature INTEGER DEFAULT 1, -- درج امضای درخواست‌دهنده در سند چاپی
  created_by INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS workflow_steps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  template_id INTEGER NOT NULL REFERENCES workflow_templates(id) ON DELETE CASCADE,
  step_order INTEGER NOT NULL,
  title TEXT NOT NULL,
  approver_type TEXT NOT NULL, -- requester_manager | dept_manager | user | role
  approver_id INTEGER, -- user id or department id depending on type
  approver_role TEXT, -- for role type: admin|manager
  deadline_hours INTEGER DEFAULT 0,
  is_optional INTEGER DEFAULT 0, -- مرحله اختیاری: تاییدکننده می‌تواند بدون اظهارنظر عبور دهد
  alt_approvers TEXT DEFAULT '[]', -- تاییدکنندگان جایگزین: [{approver_type, approver_id, approver_role}, ...]
  requires_signature INTEGER DEFAULT 1 -- درج امضای تاییدکننده در سند چاپی
);

CREATE TABLE IF NOT EXISTS workflow_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  template_id INTEGER NOT NULL REFERENCES workflow_templates(id),
  requester_id INTEGER NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  form_data TEXT DEFAULT '{}',
  status TEXT DEFAULT 'in_progress', -- in_progress | approved | rejected | cancelled
  current_step INTEGER DEFAULT 1,
  step_due_at TEXT,
  last_reminded_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  closed_at TEXT
);

CREATE TABLE IF NOT EXISTS workflow_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id INTEGER NOT NULL REFERENCES workflow_requests(id) ON DELETE CASCADE,
  step_order INTEGER NOT NULL,
  actor_id INTEGER NOT NULL REFERENCES users(id),
  action TEXT NOT NULL, -- approve | reject | comment | submit
  comment TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  assigner_id INTEGER NOT NULL REFERENCES users(id),
  assignee_id INTEGER NOT NULL REFERENCES users(id),
  status TEXT DEFAULT 'todo', -- todo | doing | done
  priority TEXT DEFAULT 'normal', -- low | normal | high | urgent
  start_at TEXT,
  deadline TEXT,
  last_reminded_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT DEFAULT 'info', -- info | task | workflow | chat | reminder
  title TEXT NOT NULL,
  body TEXT DEFAULT '',
  link TEXT DEFAULT '',
  is_read INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, is_read);
`);

// ---------- migrations (برای دیتابیس‌های موجود) ----------
try {
  db.exec('ALTER TABLE departments ADD COLUMN is_management INTEGER DEFAULT 0');
  db.exec("UPDATE departments SET is_management = 1 WHERE name = 'مدیریت'");
} catch {}
try { db.exec('ALTER TABLE tasks ADD COLUMN start_at TEXT'); } catch {}
try { db.exec('ALTER TABLE workflow_steps ADD COLUMN is_optional INTEGER DEFAULT 0'); } catch {}
// تاییدکنندگان جایگزین هر مرحله: آرایهٔ JSON از {approver_type, approver_id, approver_role}
try { db.exec("ALTER TABLE workflow_steps ADD COLUMN alt_approvers TEXT DEFAULT '[]'"); } catch {}
// آیا امضای تاییدکنندهٔ این مرحله در سند چاپی/بایگانی درج شود؟ (پیش‌فرض: بله)
try { db.exec('ALTER TABLE workflow_steps ADD COLUMN requires_signature INTEGER DEFAULT 1'); } catch {}
// آیا بعد از تایید نهایی به درخواست‌دهنده اطلاع داده شود؟ (پیش‌فرض: بله)
try { db.exec('ALTER TABLE workflow_templates ADD COLUMN notify_requester_on_final INTEGER DEFAULT 1'); } catch {}
// آیا امضای خودِ درخواست‌دهنده در سند چاپی درج شود؟ (پیش‌فرض: بله)
try { db.exec('ALTER TABLE workflow_templates ADD COLUMN requester_signature INTEGER DEFAULT 1'); } catch {}
// حذف گفتگو برای خودم (پنهان‌سازی)
try { db.exec('ALTER TABLE conversation_members ADD COLUMN hidden INTEGER DEFAULT 0'); } catch {}
// پاک‌کردن تاریخچه برای من: پیام‌های تا این id برای این کاربر نمایش داده نمی‌شوند
try { db.exec('ALTER TABLE conversation_members ADD COLUMN cleared_before INTEGER DEFAULT 0'); } catch {}

// مشارکت‌کنندگان و کامنت‌های تسک
db.exec(`
CREATE TABLE IF NOT EXISTS task_participants (
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, user_id)
);
CREATE TABLE IF NOT EXISTS task_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id),
  body TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_task_comments ON task_comments(task_id, id);
-- آخرین کامنتی که هر کاربر در هر تسک دیده است (برای شمارش کامنت‌های خوانده‌نشده)
CREATE TABLE IF NOT EXISTS task_comment_reads (
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_read_comment_id INTEGER DEFAULT 0,
  PRIMARY KEY (task_id, user_id)
);
`);
// عکس پروفایل
try { db.exec("ALTER TABLE users ADD COLUMN avatar_path TEXT DEFAULT ''"); } catch {}
// متن راهنمای عنوان درخواست برای هر فرآیند
try { db.exec("ALTER TABLE workflow_templates ADD COLUMN title_placeholder TEXT DEFAULT ''"); } catch {}
// امضای تصویری کاربران (فقط سرگروه/مدیریت لازم دارند) — در پوشهٔ غیرعمومی نگهداری می‌شود
try { db.exec("ALTER TABLE users ADD COLUMN signature_path TEXT DEFAULT ''"); } catch {}
// صداهای دلخواه کاربر (mp3) — خالی یعنی از صدای پیش‌فرض استفاده شود
try { db.exec("ALTER TABLE users ADD COLUMN ringtone_path TEXT DEFAULT ''"); } catch {}
try { db.exec("ALTER TABLE users ADD COLUMN notif_sound_path TEXT DEFAULT ''"); } catch {}

// ============================================================================
//  توسعهٔ فرایندها/واحدها/تسک‌ها (۷ قابلیت جدید)
// ============================================================================

// [مورد ۵] چند مدیر برای هر واحد — علاوه بر departments.manager_id (مدیر اصلی)
db.exec(`
CREATE TABLE IF NOT EXISTS department_managers (
  department_id INTEGER NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (department_id, user_id)
);`);
// انتقالِ مدیرِ اصلیِ فعلیِ هر واحد به جدول چندمدیره (یک‌بار، بدون تکرار)
try {
  db.exec(`INSERT OR IGNORE INTO department_managers (department_id, user_id)
           SELECT id, manager_id FROM departments WHERE manager_id IS NOT NULL`);
} catch {}

// [مورد ۱] محدودهٔ واحدهای مجاز برای هر فرایند — [] یعنی همه‌جا در دسترس است
try { db.exec("ALTER TABLE workflow_templates ADD COLUMN scope_dept_ids TEXT DEFAULT '[]'"); } catch {}
// [مورد ۲] فایل‌های ضمیمهٔ خودِ فرایند (راهنما/نمونه — عکس یا هر سند دیگر) — آرایهٔ JSON از file id
try { db.exec("ALTER TABLE workflow_templates ADD COLUMN attachments TEXT DEFAULT '[]'"); } catch {}
// [پیوست اقدام] فایل‌هایی که افرادِ سلسله‌مراتب هنگام تایید/رد/یادداشت پیوست می‌کنند — آرایهٔ JSON از file id
try { db.exec("ALTER TABLE workflow_actions ADD COLUMN attachments TEXT DEFAULT '[]'"); } catch {}
// [پیوست اقدام] آیا در این فرآیند، افرادِ سلسله‌مراتب اجازهٔ پیوست فایل دارند؟ (پیش‌فرض: بله)
try { db.exec("ALTER TABLE workflow_templates ADD COLUMN allow_attachments INTEGER DEFAULT 1"); } catch {}
// [پیوست اقدام] آیا در این مرحلهٔ مشخص، تاییدکننده اجازهٔ پیوست فایل دارد؟ (پیش‌فرض: بله)
try { db.exec("ALTER TABLE workflow_steps ADD COLUMN allow_attachments INTEGER DEFAULT 1"); } catch {}
// [مورد ۳] مهلت کلِ تایید (ساعت) — می‌تواند برابر جمع مهلت مراحل تنظیم شود
try { db.exec("ALTER TABLE workflow_templates ADD COLUMN total_deadline_hours INTEGER DEFAULT 0"); } catch {}
// [مورد ۷] پس از تایید نهایی، تسک ساخته شود؟ + مسئول و مهلت آن
try { db.exec("ALTER TABLE workflow_templates ADD COLUMN final_task_enabled INTEGER DEFAULT 0"); } catch {}
try { db.exec("ALTER TABLE workflow_templates ADD COLUMN final_task_assignee_type TEXT DEFAULT 'requester'"); } catch {} // requester | user
try { db.exec("ALTER TABLE workflow_templates ADD COLUMN final_task_assignee_id INTEGER"); } catch {}
try { db.exec("ALTER TABLE workflow_templates ADD COLUMN final_task_deadline_hours INTEGER DEFAULT 0"); } catch {}
// [مورد ۴] آیا به تاییدکنندهٔ این مرحله نوتیفیکیشن ارسال شود؟ (پیش‌فرض: بله)
try { db.exec("ALTER TABLE workflow_steps ADD COLUMN notify_approver INTEGER DEFAULT 1"); } catch {}
// [مورد ۷] تسکِ ساخته‌شده از این درخواست (اگر ساخته شده باشد)
try { db.exec("ALTER TABLE workflow_requests ADD COLUMN task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL"); } catch {}

// [مورد ۷+] ساخت تسک در «هر مرحله» از سلسله‌مراتب (نه فقط پس از تایید نهایی)
try { db.exec("ALTER TABLE workflow_steps ADD COLUMN create_task INTEGER DEFAULT 0"); } catch {}
try { db.exec("ALTER TABLE workflow_steps ADD COLUMN task_assignee_type TEXT DEFAULT 'requester'"); } catch {} // requester | approver | user
try { db.exec("ALTER TABLE workflow_steps ADD COLUMN task_assignee_id INTEGER"); } catch {}
try { db.exec("ALTER TABLE workflow_steps ADD COLUMN task_deadline_hours INTEGER DEFAULT 0"); } catch {}
try { db.exec("ALTER TABLE workflow_steps ADD COLUMN task_title TEXT DEFAULT ''"); } catch {}
try { db.exec("ALTER TABLE workflow_steps ADD COLUMN task_notify INTEGER DEFAULT 1"); } catch {}
// آیا هنگام ساخت تسکِ نهایی به مسئول اطلاع داده شود؟ (پیش‌فرض: بله)
try { db.exec("ALTER TABLE workflow_templates ADD COLUMN final_task_notify INTEGER DEFAULT 1"); } catch {}

// [تنظیمات] فعال‌بودن پیش‌فرضِ نوتیفیکیشن مرورگر برای هر کاربر (پیش‌فرض روشن)
try { db.exec("ALTER TABLE users ADD COLUMN notif_enabled INTEGER DEFAULT 1"); } catch {}

// [مورد ۶] اجازهٔ دیدنِ درخواست‌های یک کاربرِ مشخص (تنظیم دستی فردی)
db.exec(`
CREATE TABLE IF NOT EXISTS request_view_grants (
  viewer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (viewer_id, target_id)
);`);

// تنظیمات سازمان (سربرگ چاپ): key/value
db.exec(`
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT DEFAULT ''
);`);
{
  const defaults = {
    company_name: 'شرکت تولید سیم و کابل توس‌کابل',
    company_subtitle: 'سامانه اتوماسیون اداری',
    letterhead_address: '',
    letterhead_footer: 'این سند از سامانه اتوماسیون اداری صادر شده و اعتبار آن با کد رهگیری در سامانه قابل استعلام است.',
    logo_path: '',
    // [پیوست‌ها] کلید سراسری: اگر '0' شود، پیوست فایل در همهٔ فرآیندها غیرفعال می‌شود
    attachments_enabled: '1',
  };
  const ins = db.prepare('INSERT OR IGNORE INTO app_settings (key, value) VALUES (?, ?)');
  for (const [k, v] of Object.entries(defaults)) ins.run(k, v);
}

// مسدودسازی کاربران
db.exec(`
CREATE TABLE IF NOT EXISTS blocked_users (
  blocker_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (blocker_id, blocked_id)
);

CREATE TABLE IF NOT EXISTS user_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reporter_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reported_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id INTEGER REFERENCES conversations(id) ON DELETE SET NULL,
  reason TEXT DEFAULT '',
  status TEXT DEFAULT 'open', -- open | reviewed
  created_at TEXT DEFAULT (datetime('now'))
);
`);

// ============================================================================
//  یادداشت‌ها و یادآوری‌های شخصیِ کاربر
// ============================================================================
db.exec(`
CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT DEFAULT '',
  body TEXT DEFAULT '',
  color TEXT DEFAULT '#fde68a',      -- رنگ برچسبِ یادداشت
  pinned INTEGER DEFAULT 0,          -- سنجاق‌شده بالای فهرست
  done INTEGER DEFAULT 0,            -- برای یادداشت‌های کارمانند (چک‌شده)
  remind_at TEXT,                    -- زمان یادآوری (ISO) — خالی یعنی بدون یادآوری
  reminded INTEGER DEFAULT 0,        -- آیا یادآوری ارسال شده است؟
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_notes_user ON notes(user_id, pinned, id);
CREATE INDEX IF NOT EXISTS idx_notes_remind ON notes(remind_at, reminded);
`);

// ============================================================================
//  واگذاری/نیابت در گردش‌کار — جانشینِ یک کاربر در بازهٔ زمانی مشخص
//  در این بازه، درخواست‌هایی که تاییدکننده‌شان «from_user» است در کارتابلِ «to_user»
//  هم دیده می‌شوند و او می‌تواند به‌نیابت اقدام کند.
// ============================================================================
db.exec(`
CREATE TABLE IF NOT EXISTS delegations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_user INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,  -- کسی که نبودنش جبران می‌شود
  to_user INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,    -- جانشین/نایب
  reason TEXT DEFAULT '',
  starts_at TEXT,                    -- خالی = از هم‌اکنون
  ends_at TEXT,                      -- خالی = بدون پایان
  is_active INTEGER DEFAULT 1,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_deleg_from ON delegations(from_user, is_active);
CREATE INDEX IF NOT EXISTS idx_deleg_to ON delegations(to_user, is_active);
`);

// ---------- seed ----------
const userCount = db.prepare('SELECT COUNT(*) c FROM users').get().c;
if (userCount === 0) {
  const seedDepts = [
    ['مدیریت', 'مدیریت ارشد کارخانه'], // is_management پایین‌تر ست می‌شود
    ['آزمایشگاه', 'کنترل کیفیت و آزمون محصولات'],
    ['حسابداری', 'امور مالی و حسابداری'],
    ['تحقیق و توسعه', 'واحد R&D'],
    ['بازرگانی', 'خرید، فروش و تدارکات'],
    ['تولید', 'خطوط تولید سیم و کابل'],
    ['انبار', 'انبار مواد اولیه و محصول'],
  ];
  const insDept = db.prepare('INSERT INTO departments (name, description) VALUES (?, ?)');
  for (const d of seedDepts) insDept.run(d[0], d[1]);
  db.exec("UPDATE departments SET is_management = 1 WHERE name = 'مدیریت'");

  const hash = bcrypt.hashSync('admin123', 10);
  db.prepare(`INSERT INTO users (username, password_hash, full_name, role, department_id, position, avatar_color)
    VALUES ('admin', ?, 'مدیر سامانه', 'admin', 1, 'مدیر سامانه', '#7c3aed')`).run(hash);

  // نمونه گردش کار: درخواست خرید
  const tpl = db.prepare(`INSERT INTO workflow_templates (name, description, form_schema, created_by)
    VALUES (?, ?, ?, 1)`).run(
    'درخواست خرید',
    'درخواست خرید کالا یا خدمات — تایید سرگروه، سپس حسابداری، سپس مدیریت و در نهایت تامین توسط بازرگانی',
    JSON.stringify([
      { key: 'item', label: 'شرح کالا / خدمات', type: 'text', required: true },
      { key: 'qty', label: 'تعداد / مقدار', type: 'number', required: true },
      { key: 'est_price', label: 'برآورد هزینه (ریال)', type: 'number', required: false },
      { key: 'reason', label: 'دلیل درخواست', type: 'textarea', required: true },
    ])
  );
  const tplId = tpl.lastInsertRowid;
  const insStep = db.prepare(`INSERT INTO workflow_steps (template_id, step_order, title, approver_type, approver_id, approver_role, deadline_hours)
    VALUES (?, ?, ?, ?, ?, ?, ?)`);
  insStep.run(tplId, 1, 'تایید سرگروه واحد', 'requester_manager', null, null, 24);
  insStep.run(tplId, 2, 'تایید حسابداری', 'dept_manager', 3, null, 48);
  insStep.run(tplId, 3, 'تایید مدیریت', 'role', null, 'admin', 48);
  insStep.run(tplId, 4, 'تامین توسط بازرگانی', 'dept_manager', 5, null, 72);
}

export default db;
