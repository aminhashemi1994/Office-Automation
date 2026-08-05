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
  status TEXT DEFAULT 'in_progress', -- in_progress | awaiting_requester | returned | approved | rejected | cancelled
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

// ============================================================================
//  [تایید نهاییِ درخواست‌دهنده و برگشت درخواست]
//  status درخواست‌ها یکی از این‌هاست:
//    in_progress          → در جریانِ سلسله‌مراتب تایید
//    awaiting_requester   → همهٔ مراحل تایید شده و منتظر «تایید نهاییِ درخواست‌دهنده» است
//    returned             → برای اصلاح به خودِ درخواست‌دهنده برگشت داده شده (قابل ویرایش و ارسال مجدد)
//    approved | rejected | cancelled
// ============================================================================
// آیا در این فرآیند، بعد از آخرین مرحله، تایید نهایی با خودِ درخواست‌دهنده است؟
try { db.exec('ALTER TABLE workflow_templates ADD COLUMN requester_final_approval INTEGER DEFAULT 0'); } catch {}
// آخرین باری که فرمِ درخواست ویرایش شد
try { db.exec('ALTER TABLE workflow_requests ADD COLUMN edited_at TEXT'); } catch {}
// وقتی درخواست به درخواست‌دهنده برگشت داده می‌شود، با «ارسال مجدد» از این مرحله ادامه پیدا می‌کند
try { db.exec('ALTER TABLE workflow_requests ADD COLUMN resume_step INTEGER DEFAULT 1'); } catch {}

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

// ============================================================================
//  CRM — مدیریت ارتباط با مشتری
//  • مشتری = شرکت/شخصِ طرف حساب، با فیلدهای پایه + هر تعداد «فیلد دلخواه»
//  • مخاطب = افرادِ رابط هر مشتری (نام، سمت، تلفن، ایمیل، …)
//  • فعالیت = گزارشِ تماس/جلسه/پیگیری با تاریخِ یادآوری
//  • فروش = معامله/فرصت فروش با مبلغ و مرحله — پایهٔ گزارش‌های فروش
//  دسترسی: مدیر سامانه و «واحد مدیریت» همیشه؛ بقیه فقط اگر واحدشان در
//  تنظیمات سازمان (crm_dept_ids) مجاز شده باشد.
// ============================================================================
db.exec(`
CREATE TABLE IF NOT EXISTS crm_customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,                 -- نام شرکت / مشتری
  kind TEXT DEFAULT 'company',        -- company | person
  status TEXT DEFAULT 'active',       -- lead (سرنخ) | active (مشتری فعال) | inactive (غیرفعال)
  economic_code TEXT DEFAULT '',      -- کد اقتصادی
  national_id TEXT DEFAULT '',        -- شناسه ملی / کد ملی
  phone TEXT DEFAULT '',
  email TEXT DEFAULT '',
  website TEXT DEFAULT '',
  city TEXT DEFAULT '',
  address TEXT DEFAULT '',
  postal_code TEXT DEFAULT '',
  industry TEXT DEFAULT '',           -- حوزهٔ فعالیت
  source TEXT DEFAULT '',             -- نحوهٔ آشنایی (نمایشگاه، معرفی، تماس ورودی، …)
  note TEXT DEFAULT '',
  extra TEXT DEFAULT '{}',            -- فیلدهای دلخواه: {"<key>": "<value>"}
  owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL,   -- کارشناسِ مسئول
  department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_crm_customers_name ON crm_customers(name);

CREATE TABLE IF NOT EXISTS crm_contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES crm_customers(id) ON DELETE CASCADE,
  first_name TEXT DEFAULT '',
  last_name TEXT DEFAULT '',
  position TEXT DEFAULT '',           -- سمت
  phone TEXT DEFAULT '',
  mobile TEXT DEFAULT '',
  email TEXT DEFAULT '',
  is_primary INTEGER DEFAULT 0,       -- مخاطب اصلی
  note TEXT DEFAULT '',
  extra TEXT DEFAULT '{}',            -- فیلدهای دلخواه مخاطب
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_crm_contacts_cust ON crm_contacts(customer_id);

CREATE TABLE IF NOT EXISTS crm_activities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES crm_customers(id) ON DELETE CASCADE,
  contact_id INTEGER REFERENCES crm_contacts(id) ON DELETE SET NULL,
  deal_id INTEGER,                    -- در صورت مرتبط‌بودن با یک معامله
  type TEXT DEFAULT 'call',           -- call | meeting | email | visit | note
  subject TEXT DEFAULT '',
  body TEXT DEFAULT '',               -- شرح گزارش
  outcome TEXT DEFAULT '',            -- نتیجه
  happened_at TEXT DEFAULT (datetime('now')),
  follow_up_at TEXT,                  -- تاریخ پیگیری بعدی (یادآوری)
  follow_up_done INTEGER DEFAULT 0,
  attachments TEXT DEFAULT '[]',      -- آرایهٔ JSON از file id
  user_id INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_crm_act_cust ON crm_activities(customer_id, id);
CREATE INDEX IF NOT EXISTS idx_crm_act_follow ON crm_activities(follow_up_at, follow_up_done);

CREATE TABLE IF NOT EXISTS crm_deals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES crm_customers(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  amount REAL DEFAULT 0,              -- مبلغ (ریال)
  currency TEXT DEFAULT 'IRR',
  stage TEXT DEFAULT 'new',           -- new | quoted | negotiation | won | lost
  probability INTEGER DEFAULT 0,      -- درصد احتمال موفقیت
  expected_close TEXT,                -- تاریخ پیش‌بینی‌شدهٔ نهایی‌شدن
  closed_at TEXT,
  lost_reason TEXT DEFAULT '',
  product TEXT DEFAULT '',            -- شرح کالا/خدمات
  note TEXT DEFAULT '',
  extra TEXT DEFAULT '{}',
  owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_crm_deals_cust ON crm_deals(customer_id, id);
CREATE INDEX IF NOT EXISTS idx_crm_deals_stage ON crm_deals(stage, closed_at);

-- تعریفِ «فیلدهای دلخواه» برای مشتری/مخاطب/معامله (مقدارشان در ستون extra ذخیره می‌شود)
CREATE TABLE IF NOT EXISTS crm_fields (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity TEXT NOT NULL DEFAULT 'customer', -- customer | contact | deal
  key TEXT NOT NULL,
  label TEXT NOT NULL,
  type TEXT DEFAULT 'text',           -- text | textarea | number | date | select
  options TEXT DEFAULT '[]',          -- برای select
  required INTEGER DEFAULT 0,
  sort_order INTEGER DEFAULT 0,
  UNIQUE (entity, key)
);

-- ========================================================================
--  گزارشِ مرحله‌ایِ معاملات — قلبِ تحلیل عملکرد و پیشنهادِ هوشمند
--  کارشناس فروش در هر جابه‌جاییِ مرحله می‌نویسد چه شد، چه خوب بود، چه بد بود
--  و قدم بعدی چیست. این متن‌ها هم برای گزارش‌های مدیریتی و هم برای دستیار
--  هوشمند (LLM) در آینده خوانده می‌شوند.
-- ========================================================================
CREATE TABLE IF NOT EXISTS crm_stage_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  deal_id INTEGER REFERENCES crm_deals(id) ON DELETE CASCADE,      -- گزارشِ یک معامله
  tender_id INTEGER REFERENCES crm_tenders(id) ON DELETE CASCADE,  -- یا گزارشِ یک مناقصه
  customer_id INTEGER REFERENCES crm_customers(id) ON DELETE CASCADE,
  from_stage TEXT DEFAULT '',        -- مرحلهٔ قبلی (خالی = اولین گزارش)
  stage TEXT NOT NULL,               -- مرحله‌ای که معامله به آن رسیده
  summary TEXT DEFAULT '',           -- چه اتفاقی افتاد
  went_well TEXT DEFAULT '',         -- چه چیزی خوب پیش رفت
  went_wrong TEXT DEFAULT '',        -- چه چیزی اشتباه بود / مشکل داشت
  blockers TEXT DEFAULT '',          -- موانع و ریسک‌ها
  next_action TEXT DEFAULT '',       -- قدم بعدی
  confidence INTEGER DEFAULT 0,      -- درصد اطمینان کارشناس به موفقیت
  user_id INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_crm_sr_deal ON crm_stage_reports(deal_id, id);
CREATE INDEX IF NOT EXISTS idx_crm_sr_tender ON crm_stage_reports(tender_id, id);
CREATE INDEX IF NOT EXISTS idx_crm_sr_user ON crm_stage_reports(user_id, created_at);

-- ========================================================================
--  کالا و خدمات + اقلامِ هر معامله (پیش‌فاکتور)
--  مبلغِ معامله وقتی قلم داشته باشد از روی اقلام محاسبه می‌شود، نه دستی.
-- ========================================================================
CREATE TABLE IF NOT EXISTS crm_products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT DEFAULT '',              -- کد کالا
  name TEXT NOT NULL,
  category TEXT DEFAULT '',
  unit TEXT DEFAULT 'عدد',           -- واحد شمارش: متر، کیلوگرم، حلقه، …
  list_price REAL DEFAULT 0,         -- قیمت فهرست (ریال)
  cost REAL DEFAULT 0,               -- بهای تمام‌شده — برای محاسبهٔ حاشیهٔ سود
  is_active INTEGER DEFAULT 1,
  note TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_crm_products_name ON crm_products(name);

CREATE TABLE IF NOT EXISTS crm_deal_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  deal_id INTEGER NOT NULL REFERENCES crm_deals(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES crm_products(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  unit TEXT DEFAULT 'عدد',
  qty REAL DEFAULT 1,
  unit_price REAL DEFAULT 0,
  discount_pct REAL DEFAULT 0,       -- درصد تخفیف این قلم
  tax_pct REAL DEFAULT 0,            -- درصد مالیات/عوارض
  cost REAL DEFAULT 0,               -- بهای تمام‌شدهٔ واحد (کپی از کالا در لحظهٔ ثبت)
  sort_order INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_crm_deal_items ON crm_deal_items(deal_id, sort_order);

-- ========================================================================
--  مناقصات
--  فروش از راه مناقصه منطقِ خودش را دارد: فراخوان، مهلت‌های سخت، پاکات،
--  تضمین شرکت در مناقصه، بازگشایی و رقبا. این‌ها در «معاملهٔ» معمولی جا نمی‌شوند.
--  با برنده‌شدن، مناقصه به یک معاملهٔ برنده تبدیل می‌شود تا در آمار فروش بیاید.
-- ========================================================================
CREATE TABLE IF NOT EXISTS crm_tenders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tender_no TEXT DEFAULT '',         -- شماره فراخوان / مناقصه
  title TEXT NOT NULL,
  customer_id INTEGER REFERENCES crm_customers(id) ON DELETE SET NULL, -- مناقصه‌گزار (اگر در فهرست مشتریان هست)
  organization TEXT DEFAULT '',      -- نام دستگاه مناقصه‌گزار (اگر مشتری ثبت‌شده نیست)
  portal TEXT DEFAULT 'setad',       -- setad (ستاد) | own (سامانه اختصاصی) | paper (روزنامه) | other
  portal_url TEXT DEFAULT '',
  method TEXT DEFAULT 'public_1',    -- public_1 | public_2 (دو مرحله‌ای) | limited (محدود) | direct (ترک تشریفات)
  subject TEXT DEFAULT '',           -- موضوع/شرح
  estimated_amount REAL DEFAULT 0,   -- برآورد کارفرما
  our_bid_amount REAL DEFAULT 0,     -- مبلغ پیشنهادی ما
  status TEXT DEFAULT 'identified',  -- identified | reviewing | docs | preparing | submitted | opened | won | lost | cancelled | withdrawn
  published_at TEXT,                 -- تاریخ انتشار فراخوان
  docs_deadline TEXT,                -- مهلت دریافت/خرید اسناد
  submit_deadline TEXT,              -- مهلت ارسال پیشنهاد (حیاتی‌ترین تاریخ)
  opening_at TEXT,                   -- تاریخ بازگشایی پاکات
  -- تضمین شرکت در مناقصه (پاکت الف)
  guarantee_type TEXT DEFAULT '',    -- bank (ضمانت‌نامه بانکی) | cheque | cash | none
  guarantee_amount REAL DEFAULT 0,
  guarantee_no TEXT DEFAULT '',
  guarantee_expires_at TEXT,         -- سررسید ضمانت‌نامه — باید به‌موقع تمدید یا آزاد شود
  guarantee_released INTEGER DEFAULT 0,
  -- نتیجه
  winner_name TEXT DEFAULT '',
  winner_amount REAL DEFAULT 0,
  our_rank INTEGER DEFAULT 0,        -- رتبهٔ ما در بازگشایی
  result_note TEXT DEFAULT '',
  lost_reason TEXT DEFAULT '',
  deal_id INTEGER REFERENCES crm_deals(id) ON DELETE SET NULL, -- معاملهٔ ساخته‌شده پس از برد
  owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
  attachments TEXT DEFAULT '[]',     -- اسناد مناقصه (آرایهٔ JSON از file id)
  note TEXT DEFAULT '',
  extra TEXT DEFAULT '{}',
  created_by INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_crm_tenders_status ON crm_tenders(status, submit_deadline);
CREATE INDEX IF NOT EXISTS idx_crm_tenders_owner ON crm_tenders(owner_id, id);

-- رقبا و مبالغ پیشنهادی‌شان (بعد از بازگشایی) — گنجینهٔ اطلاعات رقابتی
CREATE TABLE IF NOT EXISTS crm_tender_competitors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tender_id INTEGER NOT NULL REFERENCES crm_tenders(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  amount REAL DEFAULT 0,
  rank INTEGER DEFAULT 0,
  is_winner INTEGER DEFAULT 0,
  note TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_crm_tender_comp ON crm_tender_competitors(tender_id, rank);

-- چک‌لیست مدارک پاکات — جلوگیری از ردصلاحیت به‌خاطر یک مدرکِ جامانده
CREATE TABLE IF NOT EXISTS crm_tender_checklist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tender_id INTEGER NOT NULL REFERENCES crm_tenders(id) ON DELETE CASCADE,
  envelope TEXT DEFAULT 'b',         -- a (تضمین) | b (اسناد و سوابق) | c (پیشنهاد قیمت)
  title TEXT NOT NULL,
  required INTEGER DEFAULT 1,
  done INTEGER DEFAULT 0,
  note TEXT DEFAULT '',
  sort_order INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_crm_tender_check ON crm_tender_checklist(tender_id, envelope, sort_order);

-- ========================================================================
--  گردش موجودی کالا — هر سطر یک ورود (مثبت) یا خروج (منفی) از انبار فروش
-- ========================================================================
CREATE TABLE IF NOT EXISTS crm_stock_moves (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES crm_products(id) ON DELETE CASCADE,
  qty REAL NOT NULL,                 -- مثبت = ورود، منفی = خروج
  reason TEXT DEFAULT 'manual',      -- purchase | sale | return | adjust | manual
  deal_id INTEGER REFERENCES crm_deals(id) ON DELETE SET NULL,
  note TEXT DEFAULT '',
  user_id INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_crm_stock_moves ON crm_stock_moves(product_id, id);

-- ========================================================================
--  تمرکز فروش — تیم در هر دوره روی چند محصول/بازار مشخص متمرکز می‌شود
--  و پیشرفتش نسبت به هدف سنجیده می‌شود.
-- ========================================================================
CREATE TABLE IF NOT EXISTS crm_focus (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  period_from TEXT,
  period_to TEXT,
  target_amount REAL DEFAULT 0,      -- هدفِ مبلغ فروش (ریال)
  target_count INTEGER DEFAULT 0,    -- هدفِ تعداد معامله
  product_ids TEXT DEFAULT '[]',     -- محصولاتِ مورد تمرکز
  categories TEXT DEFAULT '',        -- یا دسته‌بندی‌ها (با «،»)
  segment TEXT DEFAULT '',           -- بازار/صنعت هدف
  priority TEXT DEFAULT 'normal',    -- low | normal | high
  is_active INTEGER DEFAULT 1,
  owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now'))
);

-- سهمیهٔ هر کارشناس از یک تمرکز فروش
CREATE TABLE IF NOT EXISTS crm_focus_members (
  focus_id INTEGER NOT NULL REFERENCES crm_focus(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_amount REAL DEFAULT 0,
  PRIMARY KEY (focus_id, user_id)
);

-- ========================================================================
--  پشتیبانی مشتریان، خدمات پس از فروش و کیفیت محصول
-- ========================================================================
CREATE TABLE IF NOT EXISTS crm_tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER REFERENCES crm_customers(id) ON DELETE CASCADE,
  contact_id INTEGER REFERENCES crm_contacts(id) ON DELETE SET NULL,
  deal_id INTEGER REFERENCES crm_deals(id) ON DELETE SET NULL,
  product_id INTEGER REFERENCES crm_products(id) ON DELETE SET NULL,
  subject TEXT NOT NULL,
  body TEXT DEFAULT '',
  type TEXT DEFAULT 'support',       -- support | warranty | complaint | quality | request | installation
  severity TEXT DEFAULT 'normal',    -- low | normal | high | critical
  status TEXT DEFAULT 'new',         -- new | in_progress | waiting_customer | resolved | closed
  channel TEXT DEFAULT 'phone',      -- phone | email | sms | visit | portal
  assignee_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  opened_by INTEGER REFERENCES users(id),
  due_at TEXT,                       -- تعهد زمانی پاسخ/رفع
  first_response_at TEXT,
  resolved_at TEXT,
  resolution TEXT DEFAULT '',        -- چه کاری انجام شد
  root_cause TEXT DEFAULT '',        -- ریشهٔ مشکل (برای تحلیل کیفیت)
  is_quality_issue INTEGER DEFAULT 0,-- آیا ایراد کیفیِ محصول بوده است؟
  batch_no TEXT DEFAULT '',          -- شماره بچ/سری ساخت — برای ردیابی کیفیت
  cost REAL DEFAULT 0,               -- هزینهٔ رسیدگی (تعویض، حمل، …)
  attachments TEXT DEFAULT '[]',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_crm_tickets ON crm_tickets(status, due_at);
CREATE INDEX IF NOT EXISTS idx_crm_tickets_cust ON crm_tickets(customer_id, id);

CREATE TABLE IF NOT EXISTS crm_ticket_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id INTEGER NOT NULL REFERENCES crm_tickets(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  is_internal INTEGER DEFAULT 0,     -- یادداشت داخلی (مشتری نمی‌بیند)
  channel TEXT DEFAULT 'note',       -- note | phone | email | sms
  user_id INTEGER REFERENCES users(id),
  attachments TEXT DEFAULT '[]',
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_crm_ticket_msg ON crm_ticket_messages(ticket_id, id);

-- بازخورد و رضایت مشتری
CREATE TABLE IF NOT EXISTS crm_feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER REFERENCES crm_customers(id) ON DELETE CASCADE,
  contact_id INTEGER REFERENCES crm_contacts(id) ON DELETE SET NULL,
  deal_id INTEGER REFERENCES crm_deals(id) ON DELETE SET NULL,
  ticket_id INTEGER REFERENCES crm_tickets(id) ON DELETE SET NULL,
  product_id INTEGER REFERENCES crm_products(id) ON DELETE SET NULL,
  kind TEXT DEFAULT 'csat',          -- nps | csat | complaint | suggestion | praise
  score INTEGER,                     -- NPS: ۰ تا ۱۰
  csat INTEGER,                      -- رضایت: ۱ تا ۵
  comment TEXT DEFAULT '',
  source TEXT DEFAULT 'phone',       -- phone | sms | email | visit | form
  user_id INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_crm_feedback ON crm_feedback(customer_id, id);

-- ========================================================================
--  پیامک — جا‌نمایی برای اتصال به درگاه واقعی
--  امروز پیام‌ها در صف ثبت و به‌صورت «شبیه‌سازی» علامت می‌خورند؛ برای اتصال
--  کافی است تابع ارسال در server/sms.js به درگاه واقعی وصل شود.
-- ========================================================================
CREATE TABLE IF NOT EXISTS crm_sms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER REFERENCES crm_customers(id) ON DELETE SET NULL,
  contact_id INTEGER REFERENCES crm_contacts(id) ON DELETE SET NULL,
  ticket_id INTEGER REFERENCES crm_tickets(id) ON DELETE SET NULL,
  phone TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT DEFAULT 'queued',      -- queued | sent | failed | simulated | cancelled
  provider TEXT DEFAULT '',
  provider_msg_id TEXT DEFAULT '',
  error TEXT DEFAULT '',
  scheduled_at TEXT,                 -- ارسال زمان‌بندی‌شده
  sent_at TEXT,
  user_id INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_crm_sms ON crm_sms(status, scheduled_at);

CREATE TABLE IF NOT EXISTS crm_sms_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  body TEXT NOT NULL,                -- می‌تواند شامل {نام}، {شرکت}، {مبلغ} باشد
  kind TEXT DEFAULT 'followup',      -- followup | thanks | survey | reminder | support
  created_at TEXT DEFAULT (datetime('now'))
);

-- پیشنهادهای تحلیلی (فعلاً دستی؛ بعداً توسط LLM پر می‌شود)
CREATE TABLE IF NOT EXISTS crm_insights (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scope TEXT DEFAULT 'team',         -- team | user
  target_user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  period_from TEXT DEFAULT '',
  period_to TEXT DEFAULT '',
  source TEXT DEFAULT 'manual',      -- manual | llm
  model TEXT DEFAULT '',             -- نام مدلی که تولیدش کرده
  title TEXT DEFAULT '',
  body TEXT DEFAULT '',              -- متن تحلیل/پیشنهاد
  payload TEXT DEFAULT '{}',         -- دادهٔ خامی که تحلیل بر اساسش انجام شده
  created_by INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_crm_insights ON crm_insights(scope, target_user_id, id);
`);
{
  const defaults = {
    // واحدهایی که می‌توانند با CRM کار کنند — آرایهٔ JSON از id واحد
    crm_dept_ids: '[]',
    // واحدهایی با «دسترسی کامل» (دیدن و ویرایش رکورد همه، حذف، تعریف فیلد، گزارش کل)
    crm_full_dept_ids: '[]',
    crm_enabled: '1',
    // دلایل رایج باخت — برای تحلیل یکدست (با «،» جدا می‌شوند)
    crm_lost_reasons: 'قیمت بالا،زمان تحویل طولانی،رقیب برنده شد،نیاز منتفی شد،مشکل کیفیت،عدم پاسخ مشتری،مشکل شرایط پرداخت',
    // مدارکِ پیش‌فرضِ پاکات مناقصه — هنگام ساخت هر مناقصه به‌صورت چک‌لیست درج می‌شود
    crm_tender_checklist: 'الف|ضمانت‌نامه شرکت در مناقصه\n'
      + 'ب|اساسنامه و آگهی آخرین تغییرات\nب|گواهی ثبت و کد اقتصادی\n'
      + 'ب|رزومه و سوابق قراردادهای مشابه\nب|گواهی صلاحیت / استاندارد\n'
      + 'ب|صورت‌های مالی حسابرسی‌شده\nب|اسناد مناقصهٔ مهر و امضاشده\n'
      + 'ج|برگ پیشنهاد قیمت\nج|آنالیز قیمت',
    // چند روز قبل از مهلت مناقصه یادآوری ارسال شود (با «،» جدا)
    crm_tender_reminder_days: '7،3،1',
    // --- پیامک: جا‌نمایی برای اتصال به درگاه واقعی ---
    sms_enabled: '0',                 // تا وقتی درگاه تنظیم نشده، ارسال «شبیه‌سازی» می‌شود
    sms_provider: '',                 // kavenegar | ghasedak | melipayamak | …
    sms_api_url: '',
    sms_api_key: '',
    sms_sender: '',                   // شمارهٔ فرستنده
    // مشتری بعد از چند روز بی‌ارتباطی، «نیازمند پیگیری» شمرده می‌شود
    crm_stale_customer_days: '45',
  };
  const ins = db.prepare('INSERT OR IGNORE INTO app_settings (key, value) VALUES (?, ?)');
  for (const [k, v] of Object.entries(defaults)) ins.run(k, v);
}

// ============================================================================
//  مرخصی — سقفِ سالانهٔ هر نفر و دفترِ کسر/افزایش مانده
//  درخواستِ مرخصی روی همان موتور گردش‌کار ثبت می‌شود؛ فرآیندِ نشان‌دار (leave_enabled)
//  پس از تایید نهایی، به‌طور خودکار از ماندهٔ کاربر کم می‌کند.
// ============================================================================
db.exec(`
CREATE TABLE IF NOT EXISTS leave_balances (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  year INTEGER NOT NULL,                 -- سال شمسی
  entitled_hours REAL DEFAULT 0,         -- سقف مرخصی استحقاقی (ساعت)
  sick_hours REAL DEFAULT 0,             -- سقف مرخصی استعلاجی (ساعت) — ۰ = بدون سقف
  carried_over_hours REAL DEFAULT 0,     -- ماندهٔ منتقل‌شده از سال قبل
  note TEXT DEFAULT '',
  updated_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, year)
);

-- هر سطر یک کسر (منفی) یا افزایش (مثبت) از ماندهٔ مرخصی است
CREATE TABLE IF NOT EXISTS leave_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  year INTEGER NOT NULL,
  leave_type TEXT NOT NULL,              -- entitled | unpaid | sick
  unit TEXT NOT NULL DEFAULT 'hour',     -- hour | day (فقط برای نمایش؛ مقدار همیشه به ساعت ذخیره می‌شود)
  hours REAL NOT NULL,                   -- مقدار به ساعت (منفی = کسر از مانده)
  amount_label TEXT DEFAULT '',          -- شرح خواناى مقدار، مثل «۲ روز» یا «۳ ساعت»
  request_id INTEGER REFERENCES workflow_requests(id) ON DELETE SET NULL,
  from_date TEXT DEFAULT '',
  to_date TEXT DEFAULT '',
  note TEXT DEFAULT '',
  created_by INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_leave_ledger_user ON leave_ledger(user_id, year);
CREATE UNIQUE INDEX IF NOT EXISTS idx_leave_ledger_request ON leave_ledger(request_id) WHERE request_id IS NOT NULL;
`);
{
  const defaults = {
    // ساعت کاری هر روز — مبنای تبدیل «روز» به «ساعت»
    leave_workday_hours: '8',
    // سقف پیش‌فرضِ مرخصی استحقاقی سالانه (روز) — هنگام «تعریف برای همهٔ پرسنل» پیشنهاد می‌شود
    leave_default_days: '26',
    // کدام نوع مرخصی از ماندهٔ استحقاقی کم شود؟ JSON: {entitled:1, unpaid:0, sick:0}
    leave_deduct_policy: '{"entitled":1,"unpaid":0,"sick":0}',
  };
  const ins = db.prepare('INSERT OR IGNORE INTO app_settings (key, value) VALUES (?, ?)');
  for (const [k, v] of Object.entries(defaults)) ins.run(k, v);
}

// ---------- مایگریشن‌های CRM ----------
// گزارش‌های مرحله‌ای حالا هم برای معامله و هم برای مناقصه استفاده می‌شوند
try { db.exec('ALTER TABLE crm_stage_reports ADD COLUMN tender_id INTEGER REFERENCES crm_tenders(id) ON DELETE CASCADE'); } catch {}
// نسخهٔ اولِ جدول، deal_id را NOT NULL تعریف کرده بود؛ برای گزارشِ مناقصه باید nullable شود.
// SQLite ستون را جای خود تغییر نمی‌دهد، پس جدول بازسازی و داده منتقل می‌شود.
try {
  const info = db.prepare('PRAGMA table_info(crm_stage_reports)').all();
  const dealCol = info.find(c => c.name === 'deal_id');
  if (dealCol && dealCol.notnull) {
    db.exec('PRAGMA foreign_keys = OFF');
    db.exec(`
      CREATE TABLE crm_stage_reports_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        deal_id INTEGER REFERENCES crm_deals(id) ON DELETE CASCADE,
        tender_id INTEGER REFERENCES crm_tenders(id) ON DELETE CASCADE,
        customer_id INTEGER REFERENCES crm_customers(id) ON DELETE CASCADE,
        from_stage TEXT DEFAULT '', stage TEXT NOT NULL,
        summary TEXT DEFAULT '', went_well TEXT DEFAULT '', went_wrong TEXT DEFAULT '',
        blockers TEXT DEFAULT '', next_action TEXT DEFAULT '', confidence INTEGER DEFAULT 0,
        user_id INTEGER REFERENCES users(id),
        created_at TEXT DEFAULT (datetime('now'))
      );
      INSERT INTO crm_stage_reports_new
        (id, deal_id, tender_id, customer_id, from_stage, stage, summary, went_well, went_wrong,
         blockers, next_action, confidence, user_id, created_at)
      SELECT id, deal_id, NULL, customer_id, from_stage, stage, summary, went_well, went_wrong,
             blockers, next_action, confidence, user_id, created_at FROM crm_stage_reports;
      DROP TABLE crm_stage_reports;
      ALTER TABLE crm_stage_reports_new RENAME TO crm_stage_reports;
      CREATE INDEX IF NOT EXISTS idx_crm_sr_deal ON crm_stage_reports(deal_id, id);
      CREATE INDEX IF NOT EXISTS idx_crm_sr_tender ON crm_stage_reports(tender_id, id);
      CREATE INDEX IF NOT EXISTS idx_crm_sr_user ON crm_stage_reports(user_id, created_at);
    `);
    db.exec('PRAGMA foreign_keys = ON');
  }
} catch (e) { console.error('⚠️ بازسازی crm_stage_reports:', e.message); }
// [محصولات] موجودی، مشخصات فنی و اطلاعات تکمیلی
try { db.exec('ALTER TABLE crm_products ADD COLUMN stock REAL DEFAULT 0'); } catch {}
try { db.exec('ALTER TABLE crm_products ADD COLUMN reorder_point REAL DEFAULT 0'); } catch {}
try { db.exec('ALTER TABLE crm_products ADD COLUMN lead_time_days INTEGER DEFAULT 0'); } catch {}
try { db.exec('ALTER TABLE crm_products ADD COLUMN warranty_months INTEGER DEFAULT 0'); } catch {}
try { db.exec("ALTER TABLE crm_products ADD COLUMN spec TEXT DEFAULT ''"); } catch {}
try { db.exec("ALTER TABLE crm_products ADD COLUMN attachments TEXT DEFAULT '[]'"); } catch {}
// [مناقصه] رقیبی که معاملهٔ عادی را برد — برای تحلیل رقابتی
try { db.exec("ALTER TABLE crm_deals ADD COLUMN competitor TEXT DEFAULT ''"); } catch {}
// [مناقصه] معامله‌ای که از مسیر مناقصه آمده است
try { db.exec('ALTER TABLE crm_deals ADD COLUMN tender_id INTEGER REFERENCES crm_tenders(id) ON DELETE SET NULL'); } catch {}

// [مرخصی] نشان‌دارکردن یک فرآیند به‌عنوان «فرآیند مرخصی» و نگاشتِ فیلدهای فرمِ آن
try { db.exec('ALTER TABLE workflow_templates ADD COLUMN leave_enabled INTEGER DEFAULT 0'); } catch {}
// نگاشت: {type_field, day_field, hour_field, from_field, to_field, range_field, default_type}
try { db.exec("ALTER TABLE workflow_templates ADD COLUMN leave_map TEXT DEFAULT '{}'"); } catch {}

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

// یک‌بار (و فقط یک‌بار): واحدهای «بازرگانی» و «مدیریت» به‌طور پیش‌فرض دسترسی کاملِ CRM بگیرند.
// عمداً بعد از بلوک seed اجرا می‌شود تا روی دیتابیسِ تازه هم واحدها موجود باشند.
// بعد از این، هر تغییری که مدیر سامانه در تنظیمات بدهد محترم است و بازنویسی نمی‌شود.
{
  const seeded = db.prepare("SELECT value FROM app_settings WHERE key = 'crm_defaults_seeded'").get()?.value;
  if (seeded !== '1') {
    const ids = db.prepare(`SELECT id FROM departments
      WHERE is_management = 1 OR name IN ('بازرگانی', 'مدیریت', 'فروش', 'بازرگانی و فروش')`)
      .all().map(r => r.id);
    if (ids.length) {
      const set = db.prepare(`INSERT INTO app_settings (key, value) VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value`);
      set.run('crm_dept_ids', JSON.stringify(ids));
      set.run('crm_full_dept_ids', JSON.stringify(ids));
      // فقط وقتی واقعاً واحدی پیدا شد علامت بزن — وگرنه اجرای بعدی دوباره تلاش می‌کند
      db.prepare('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)').run('crm_defaults_seeded', '1');
    }
  }
}

export default db;
