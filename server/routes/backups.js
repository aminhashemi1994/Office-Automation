import { Router } from 'express';
import { requirePerm } from '../auth.js';
import { createBackup, listBackups, backupPath, deleteBackup } from '../backup.js';

const r = Router();

// فهرست پشتیبان‌ها — فقط مدیر سامانه
r.get('/', requirePerm('settings.manage'), (req, res) => {
  res.json({ backups: listBackups() });
});

// ساخت پشتیبان دستی — فقط مدیر سامانه
r.post('/', requirePerm('settings.manage'), (req, res) => {
  try {
    const b = createBackup('manual');
    res.json({ ok: true, backup: b });
  } catch (e) {
    res.status(500).json({ error: 'ساخت پشتیبان ناموفق بود: ' + e.message });
  }
});

// دانلود یک پشتیبان — فقط مدیر سامانه
r.get('/:name', requirePerm('settings.manage'), (req, res) => {
  const p = backupPath(req.params.name);
  if (!p) return res.status(404).json({ error: 'فایل پشتیبان یافت نشد' });
  res.download(p, req.params.name);
});

// حذف یک پشتیبان — فقط مدیر سامانه
r.delete('/:name', requirePerm('settings.manage'), (req, res) => {
  if (!deleteBackup(req.params.name)) return res.status(404).json({ error: 'فایل پشتیبان یافت نشد' });
  res.json({ ok: true });
});

export default r;
