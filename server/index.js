import express from 'express';
import http from 'http';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import './db.js';
import { config, AVATARS_DIR, BRANDING_DIR, SOUNDS_DIR } from './config.js';
import { authMiddleware } from './auth.js';
import authRoutes from './routes/auth.js';
import adminRoutes from './routes/admin.js';
import chatRoutes from './routes/chat.js';
import workflowRoutes from './routes/workflows.js';
import taskRoutes from './routes/tasks.js';
import notificationRoutes from './routes/notifications.js';
import searchRoutes from './routes/search.js';
import settingsRoutes from './routes/settings.js';
import notesRoutes from './routes/notes.js';
import delegationRoutes from './routes/delegations.js';
import backupRoutes from './routes/backups.js';
import { setupSocket } from './socket.js';
import { startReminderEngine } from './reminders.js';
import { startBackupEngine } from './backup.js';
import { startEmbeddedLivekit } from './livekit-process.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const server = http.createServer(app);

app.use(express.json({ limit: '2mb' }));

// عکس‌های پروفایل و لوگوی سازمان به‌صورت عمومی (بدون توکن) سرو می‌شوند — حساس نیستند.
// امضاها هرگز اینجا سرو نمی‌شوند؛ فقط از طریق endpoint مجاز در مسیر /api/workflows.
app.use('/avatars', express.static(AVATARS_DIR, { maxAge: '1h' }));
app.use('/branding', express.static(BRANDING_DIR, { maxAge: '1h' }));
app.use('/usersounds', express.static(SOUNDS_DIR, { maxAge: '1h' }));

app.use('/api/auth', authRoutes);
app.use('/api', authMiddleware, adminRoutes);
app.use('/api/chat', authMiddleware, chatRoutes);
app.use('/api/workflows', authMiddleware, workflowRoutes);
app.use('/api/tasks', authMiddleware, taskRoutes);
app.use('/api/notifications', authMiddleware, notificationRoutes);
app.use('/api/search', authMiddleware, searchRoutes);
app.use('/api/settings', authMiddleware, settingsRoutes);
app.use('/api/notes', authMiddleware, notesRoutes);
app.use('/api/delegations', authMiddleware, delegationRoutes);
app.use('/api/backups', authMiddleware, backupRoutes);

// خروجی ساخته‌شده فرانت‌اند
const dist = path.join(__dirname, '..', 'client', 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^(?!\/api).*/, (req, res) => res.sendFile(path.join(dist, 'index.html')));
}

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'خطای داخلی سرور' });
});

setupSocket(server);
startReminderEngine();
startBackupEngine(); // پشتیبان‌گیری خودکارِ دیتابیس (پیش‌فرض هر ۲۴ ساعت)
startEmbeddedLivekit(); // اجرای سرور LiveKit به‌عنوان زیرفرایند (قابل‌خاموشی با LIVEKIT_EMBEDDED=0)

server.listen(config.port, config.host, () => {
  console.log(`✅ سامانه اتوماسیون روی ${config.host}:${config.port} در حال اجراست (دیتابیس: ${config.dbName}.db)`);
  console.log(`   http://localhost:${config.port}`);
});
