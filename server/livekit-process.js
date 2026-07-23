// ---------------------------------------------------------------------------
// اجرای سرور LiveKit به‌عنوان زیرفرایندِ خودِ سامانه.
// با این کار، `npm start` هم بک‌اند و هم LiveKit را با هم بالا می‌آورد و برای
// بردن به سرور دیگر فقط کافی است همین پوشه منتقل شود (باینری در bin/ و کانفیگ در
// deploy/livekit-lan.yaml همراه پروژه‌اند).
//
// کلید/رمز فقط از .env خوانده می‌شود (منبع واحد) و از طریق متغیر محیطیِ LIVEKIT_KEYS
// به سرور LiveKit تزریق می‌شود؛ پس دیگر لازم نیست کلیدها را در yaml هم بنویسید.
//
// خاموش‌کردنِ این رفتار: در .env مقدار LIVEKIT_EMBEDDED=0 بگذارید (مثلاً وقتی
// LiveKit را جداگانه/داکر/کلاد اجرا می‌کنید).
// ---------------------------------------------------------------------------
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';
import { config } from './config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

let child = null;
let shuttingDown = false;

export function startEmbeddedLivekit() {
  if (process.env.LIVEKIT_EMBEDDED === '0') {
    console.log('ℹ️ LiveKit تعبیه‌شده غیرفعال است (LIVEKIT_EMBEDDED=0) — فرض بر اجرای جداگانه.');
    return;
  }
  if (shuttingDown) return;

  const binName = os.platform() === 'win32' ? 'livekit-server.exe' : 'livekit-server';
  const binPath = process.env.LIVEKIT_BIN || path.join(ROOT, 'bin', binName);
  const configPath = process.env.LIVEKIT_CONFIG || path.join(ROOT, 'deploy', 'livekit-lan.yaml');

  if (!fs.existsSync(binPath)) {
    console.warn(`⚠️ باینری LiveKit پیدا نشد: ${binPath} — تماس‌ها کار نمی‌کنند تا LiveKit را جدا اجرا کنید.`);
    return;
  }
  if (!fs.existsSync(configPath)) {
    console.warn(`⚠️ کانفیگ LiveKit پیدا نشد: ${configPath}`);
    return;
  }

  const args = ['--config', configPath, '--bind', '0.0.0.0'];
  console.log(`🚀 در حال اجرای LiveKit: ${binPath} ${args.join(' ')}`);

  child = spawn(binPath, args, {
    stdio: ['ignore', 'inherit', 'inherit'],
    env: {
      ...process.env,
      // کلیدها از .env — منبع واحد. این متغیر بر keys: داخل yaml اولویت دارد.
      LIVEKIT_KEYS: `${config.livekit.apiKey}: ${config.livekit.apiSecret}`,
    },
  });

  child.on('exit', (code, signal) => {
    child = null;
    if (shuttingDown || signal === 'SIGTERM' || signal === 'SIGINT') return; // خاموشی عمدی
    console.error(`❌ LiveKit با کد ${code} بسته شد. تلاش برای اجرای مجدد تا ۳ ثانیه دیگر…`);
    setTimeout(startEmbeddedLivekit, 3000);
  });
  child.on('error', (err) => console.error('❌ خطا در اجرای LiveKit:', err.message));
}

export function stopEmbeddedLivekit() {
  shuttingDown = true;
  if (child) {
    try { child.kill('SIGTERM'); } catch {}
    // اگر تا ۲ ثانیه نبست، با SIGKILL قطعش کن
    const c = child;
    setTimeout(() => { try { c.kill('SIGKILL'); } catch {} }, 2000).unref?.();
    child = null;
  }
}

// خاموشیِ تمیز: با Ctrl+C (SIGINT) یا SIGTERM، اول LiveKit را ببند بعد خودِ Node را
// خارج کن. حتماً process.exit صدا زده می‌شود؛ چون صرفِ داشتنِ لیسنرِ SIGINT، خروجِ
// پیش‌فرضِ Node را لغو می‌کند و فرایند سرگردان می‌ماند (باگِ «Ctrl+C کار نمی‌کند»).
function shutdown() {
  stopEmbeddedLivekit();
  // فرصت کوتاه برای رسیدن SIGTERM به زیرفرایند، سپس خروج
  setTimeout(() => process.exit(0), 300).unref?.();
}
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
