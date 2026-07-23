import fs from 'fs';
import path from 'path';
import db from './db.js';
import { BACKUPS_DIR, DB_FILE, config } from './config.js';

fs.mkdirSync(BACKUPS_DIR, { recursive: true });

const DAY = 24 * 3600 * 1000;

// تعداد پشتیبان‌هایی که نگه داشته می‌شوند (قدیمی‌ترها خودکار حذف می‌شوند)
const KEEP = Number(process.env.BACKUP_KEEP || 14);
// فاصلهٔ زمانی پشتیبان‌گیریِ خودکار (ساعت) — پیش‌فرض هر ۲۴ ساعت
const INTERVAL_HOURS = Number(process.env.BACKUP_INTERVAL_HOURS || 24);

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

// یک نسخهٔ سازگار (consistent) از دیتابیس می‌سازد؛ حتی در حالت WAL امن است.
// VACUUM INTO یک کپیِ فشرده و سالم از کلِ دیتابیس در یک فایل مقصد می‌نویسد.
export function createBackup(reason = 'auto') {
  fs.mkdirSync(BACKUPS_DIR, { recursive: true });
  const name = `${config.dbName}-${stamp()}.db`;
  const dest = path.join(BACKUPS_DIR, name);
  // مسیر را با کوتیشن امن می‌کنیم (نام‌ها کنترل‌شده‌اند اما محکم‌کاری)
  db.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);
  const size = fs.statSync(dest).size;
  pruneOld();
  console.log(`💾 پشتیبان دیتابیس ساخته شد (${reason}): ${name} — ${(size / 1024).toFixed(0)}KB`);
  return { name, size, created_at: new Date().toISOString() };
}

// حذف پشتیبان‌های قدیمی و نگه‌داشتن آخرین KEEP مورد
function pruneOld() {
  const files = listBackups();
  for (const f of files.slice(KEEP)) {
    try { fs.unlinkSync(path.join(BACKUPS_DIR, f.name)); } catch {}
  }
}

export function listBackups() {
  let names = [];
  try { names = fs.readdirSync(BACKUPS_DIR); } catch { return []; }
  return names
    .filter(n => n.endsWith('.db'))
    .map(n => {
      const st = fs.statSync(path.join(BACKUPS_DIR, n));
      return { name: n, size: st.size, created_at: st.mtime.toISOString() };
    })
    .sort((a, b) => b.created_at.localeCompare(a.created_at)); // جدیدترین اول
}

export function backupPath(name) {
  // فقط نام فایلِ ساده مجاز است — جلوگیری از پیمایش مسیر
  if (!/^[A-Za-z0-9._-]+\.db$/.test(name)) return null;
  const p = path.join(BACKUPS_DIR, name);
  return fs.existsSync(p) ? p : null;
}

export function deleteBackup(name) {
  const p = backupPath(name);
  if (!p) return false;
  try { fs.unlinkSync(p); return true; } catch { return false; }
}

export function startBackupEngine() {
  const tick = () => {
    try {
      const files = listBackups();
      const last = files[0] ? new Date(files[0].created_at).getTime() : 0;
      // اگر از آخرین پشتیبان بیش از بازهٔ تعیین‌شده گذشته باشد، پشتیبان جدید بساز
      if (Date.now() - last >= INTERVAL_HOURS * 3600 * 1000) createBackup('auto');
    } catch (e) { console.error('backup engine error:', e); }
  };
  // چند ثانیه پس از بالا آمدن سرور یک‌بار بررسی می‌کند، سپس هر ساعت
  setTimeout(tick, 30 * 1000);
  setInterval(tick, 60 * 60 * 1000);
}
