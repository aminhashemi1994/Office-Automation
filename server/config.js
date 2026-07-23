import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

// بارگذاری .env از ریشه پروژه (متغیرهای محیطی از قبل تنظیم‌شده اولویت دارند)
const envPath = path.join(ROOT, '.env');
if (fs.existsSync(envPath)) {
  try { process.loadEnvFile(envPath); }
  catch (e) { console.error('⚠️ خطا در خواندن .env:', e.message); }
}

// نام دیتابیس فقط حروف/عدد/خط تیره — جلوگیری از مسیرهای ناخواسته
function safeName(name) {
  const clean = String(name || '').replace(/[^a-zA-Z0-9_-]/g, '');
  return clean || 'tooscable';
}

export const config = {
  host: process.env.HOST || '0.0.0.0',
  port: Number(process.env.PORT || 3000),
  dbName: safeName(process.env.DB_NAME || 'tooscable'),
  dataDir: path.resolve(ROOT, process.env.DATA_DIR || 'data'),
  // --- LiveKit (SFU برای تماس صوتی/تصویری و کنفرانس) ---
  // آدرسی که مرورگرِ کاربر با آن به LiveKit وصل می‌شود (ws:// یا wss://).
  // در توسعه: ws://localhost:7880  — در استقرار پشت nginx: wss://<دامنه>/livekit
  livekit: {
    // آدرس عمومی که به مرورگر داده می‌شود
    url: process.env.LIVEKIT_URL || 'ws://localhost:7880',
    apiKey: process.env.LIVEKIT_API_KEY || 'devkey',
    apiSecret: process.env.LIVEKIT_API_SECRET || 'secret',
  },
};

export const DB_FILE = path.join(config.dataDir, `${config.dbName}.db`);
export const UPLOADS_DIR = path.join(config.dataDir, 'uploads');
// فایل‌هایی که کاربران در گفتگو برای هم می‌فرستند
export const SHARED_FILES_DIR = path.join(config.dataDir, 'sharedfiles');
// ضبط جلسات و تماس‌های صوتی/تصویری
export const RECORDINGS_DIR = path.join(config.dataDir, 'recordings');
// عکس پروفایل کاربران (به‌صورت عمومی سرو می‌شود)
export const AVATARS_DIR = path.join(config.dataDir, 'avatars');
// لوگو و دارایی‌های سربرگ سازمان (عمومی سرو می‌شود — حساس نیست)
export const BRANDING_DIR = path.join(config.dataDir, 'branding');
// امضای تصویری کاربران — پوشهٔ غیرعمومی؛ فقط از طریق endpoint احرازهویت‌شده و مجاز سرو می‌شود
export const SIGNATURES_DIR = path.join(config.dataDir, 'signatures');
// صداهای دلخواه کاربران (زنگ تماس / اعلان) — عمومی سرو می‌شوند
export const SOUNDS_DIR = path.join(config.dataDir, 'sounds');
// پشتیبان‌های خودکار دیتابیس — پوشهٔ غیرعمومی؛ فقط مدیر سامانه از طریق endpoint مجاز دسترسی دارد
export const BACKUPS_DIR = path.join(config.dataDir, 'backups');
