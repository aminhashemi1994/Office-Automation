// ============================================================================
//  پروژه‌ها — دسته‌بندی کلیِ کارها
//  هر وظیفه می‌تواند به یک پروژه تعلق داشته باشد (خرید، اداری، تحقیق و توسعه، …).
//  پروژه یا شخصیِ سازنده است، یا مشترکِ یک واحد، یا در دسترسِ کل سازمان.
//  درصد پیشرفتِ پروژه از وظایفِ داخلش حساب می‌شود و وظیفه‌ای که چک‌لیست دارد
//  به‌جای «انجام‌شده/نشده»، با درصدِ مراحلش شمرده می‌شود تا پیشرفت واقعی‌تر باشد.
// ============================================================================
import { Router } from 'express';
import db from '../db.js';

const r = Router();

// پروژه‌هایی که این کاربر می‌بیند: مالِ خودش + مشترکِ واحدش + سازمانی
function visibleWhere(alias = 'p') {
  return `(${alias}.owner_id = @uid
    OR ${alias}.scope = 'org'
    OR (${alias}.scope = 'department' AND ${alias}.department_id IS NOT NULL AND ${alias}.department_id = @dept))`;
}
// node:sqlite پارامترِ نام‌دارِ استفاده‌نشده را رد می‌کند، پس شرطِ دسترسی همیشه در SQL
// می‌ماند و برای مدیر سامانه با @all خنثی می‌شود.
const ctx = (user) => ({ uid: user.id, dept: user.department_id ?? -1, all: user.role === 'admin' ? 1 : 0 });

export function canSeeProject(user, p) {
  if (!p) return false;
  if (user.role === 'admin') return true;
  return p.owner_id === user.id || p.scope === 'org'
    || (p.scope === 'department' && p.department_id != null && p.department_id === user.department_id);
}
function canEditProject(user, p) {
  return !!p && (p.owner_id === user.id || user.role === 'admin');
}

// آمارِ وظایفِ یک مجموعه پروژه در یک کوئری — از N+1 جلوگیری می‌کند
function statsByProject(user) {
  const rows = db.prepare(`
    SELECT t.project_id AS pid,
      COUNT(*) AS total,
      SUM(CASE WHEN t.status = 'done' THEN 1 ELSE 0 END) AS done,
      SUM(CASE WHEN t.status != 'done' AND t.deadline IS NOT NULL AND datetime(t.deadline) < datetime('now') THEN 1 ELSE 0 END) AS overdue,
      -- پیشرفتِ وزنی: وظیفهٔ دارای چک‌لیست با نسبت مراحلِ انجام‌شده شمرده می‌شود
      SUM(CASE
        WHEN t.status = 'done' THEN 1.0
        WHEN (SELECT COUNT(*) FROM task_steps s WHERE s.task_id = t.id) > 0
          THEN (SELECT COUNT(*) * 1.0 FROM task_steps s WHERE s.task_id = t.id AND s.done = 1)
             / (SELECT COUNT(*) FROM task_steps s WHERE s.task_id = t.id)
        ELSE 0.0 END) AS weighted
    FROM tasks t
    WHERE t.project_id IS NOT NULL
      AND (t.assignee_id = @uid OR t.assigner_id = @uid
           OR t.id IN (SELECT task_id FROM task_participants WHERE user_id = @uid)
           OR @all = 1)
    GROUP BY t.project_id`).all({ uid: user.id, all: user.role === 'admin' ? 1 : 0 });
  const map = {};
  for (const s of rows) map[s.pid] = s;
  return map;
}

r.get('/', (req, res) => {
  const withArchived = req.query.archived === '1';
  const rows = db.prepare(`
    SELECT p.*, u.full_name AS owner_name, d.name AS department_name
    FROM projects p
    LEFT JOIN users u ON u.id = p.owner_id
    LEFT JOIN departments d ON d.id = p.department_id
    WHERE (@all = 1 OR ${visibleWhere()})
      ${withArchived ? '' : 'AND p.archived = 0'}
    ORDER BY p.archived, p.sort_order, p.id`).all(ctx(req.user));
  const stats = statsByProject(req.user);
  const projects = rows.map(p => {
    const s = stats[p.id] || { total: 0, done: 0, overdue: 0, weighted: 0 };
    const total = Number(s.total) || 0;
    return {
      ...p,
      task_count: total,
      done_count: Number(s.done) || 0,
      overdue_count: Number(s.overdue) || 0,
      // درصد پیشرفت — با یک رقم اعشار
      progress: total ? Math.round((Number(s.weighted) / total) * 1000) / 10 : 0,
    };
  });
  res.json({ projects });
});

r.post('/', (req, res) => {
  const { name, description = '', color = '#2563eb', scope = 'private', department_id = null } = req.body || {};
  if (!String(name || '').trim()) return res.status(400).json({ error: 'نام دسته‌بندی الزامی است' });
  const sc = ['private', 'department', 'org'].includes(scope) ? scope : 'private';
  // پروژهٔ سازمانی فقط توسط مدیر سامانه ساخته می‌شود تا فهرست همه شلوغ نشود
  if (sc === 'org' && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'ساخت دستهٔ سازمانی فقط توسط مدیر سامانه ممکن است' });
  }
  const dept = sc === 'department' ? (Number(department_id) || req.user.department_id) : null;
  const max = db.prepare('SELECT COALESCE(MAX(sort_order), 0) m FROM projects').get().m;
  const info = db.prepare(`INSERT INTO projects (name, description, color, owner_id, department_id, scope, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(String(name).trim().slice(0, 120), String(description).slice(0, 1000),
      /^#[0-9a-fA-F]{6}$/.test(color) ? color : '#2563eb', req.user.id, dept, sc, max + 1);
  res.json({ id: Number(info.lastInsertRowid) });
});

r.put('/:id', (req, res) => {
  const p = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'دسته‌بندی یافت نشد' });
  if (!canEditProject(req.user, p)) return res.status(403).json({ error: 'دسترسی غیرمجاز' });
  const b = req.body || {};
  const scope = ['private', 'department', 'org'].includes(b.scope) ? b.scope : p.scope;
  if (scope === 'org' && p.scope !== 'org' && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'تبدیل به دستهٔ سازمانی فقط توسط مدیر سامانه ممکن است' });
  }
  db.prepare(`UPDATE projects SET name = ?, description = ?, color = ?, scope = ?, department_id = ?, archived = ?
    WHERE id = ?`).run(
    String(b.name ?? p.name).trim().slice(0, 120),
    String(b.description ?? p.description).slice(0, 1000),
    /^#[0-9a-fA-F]{6}$/.test(b.color || '') ? b.color : p.color,
    scope,
    scope === 'department' ? (Number(b.department_id) || p.department_id || req.user.department_id) : null,
    b.archived !== undefined ? (b.archived ? 1 : 0) : p.archived,
    p.id);
  res.json({ ok: true });
});

// جابه‌جایی ترتیبِ دسته‌ها
r.post('/reorder', (req, res) => {
  const ids = (req.body?.ids || []).map(Number).filter(Boolean);
  const upd = db.prepare('UPDATE projects SET sort_order = ? WHERE id = ? AND (owner_id = ? OR ? = 1)');
  ids.forEach((id, i) => upd.run(i + 1, id, req.user.id, req.user.role === 'admin' ? 1 : 0));
  res.json({ ok: true });
});

// حذف دسته — وظایفِ داخلش پاک نمی‌شوند، فقط بی‌دسته می‌شوند (ON DELETE SET NULL)
r.delete('/:id', (req, res) => {
  const p = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'دسته‌بندی یافت نشد' });
  if (!canEditProject(req.user, p)) return res.status(403).json({ error: 'دسترسی غیرمجاز' });
  const n = db.prepare('SELECT COUNT(*) c FROM tasks WHERE project_id = ?').get(p.id).c;
  db.prepare('DELETE FROM projects WHERE id = ?').run(p.id);
  res.json({ ok: true, freed_tasks: n });
});

export default r;
