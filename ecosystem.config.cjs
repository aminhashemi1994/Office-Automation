// پیکربندی PM2 برای «سامانه اتوماسیون توس‌کابل»
// این فرایندِ Node، سرور LiveKit را هم به‌عنوان زیرفرایند بالا می‌آورد و هنگام
// stop/restart آن را می‌بندد (هندلر SIGINT/SIGTERM در server/livekit-process.js).
//
// اجرا:  pm2 start ecosystem.config.cjs
module.exports = {
  apps: [
    {
      name: 'tooscable',
      script: 'server/index.js',
      cwd: __dirname,
      exec_mode: 'fork',          // حتماً fork (نه cluster) چون سرور HTTP/WS و زیرفرایند دارد
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      // به فرایند فرصت بده LiveKit را تمیز ببندد پیش از SIGKILL
      kill_timeout: 5000,
      // تنظیمات از .env خوانده می‌شود؛ در صورت نیاز اینجا override کنید:
      env: {
        NODE_ENV: 'production',
      },
      // لاگ‌ها
      out_file: 'data/pm2-out.log',
      error_file: 'data/pm2-error.log',
      merge_logs: true,
      time: true,
    },
  ],
};
