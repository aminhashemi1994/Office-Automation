// ============================================================================
//  اطلاعیه‌ها
//  مدیریت هر چند روز یک اطلاعیه می‌زند؛ تا امروز مجبور بودند آن را به‌شکل یک
//  «فرآیند» ثبت کنند که هم کارتابل را شلوغ می‌کرد و هم اعلانش به کسی نمی‌رسید.
//  اینجا یک‌طرفه است: منتشر می‌شود، اعلان می‌رود، و معلوم است چه کسی دیده و
//  چه کسی «دریافت شد» زده است.
// ============================================================================
import { Router } from 'express';
import db from '../db.js';
import { hasPerm } from '../auth.js';
import { notifyUsers } from '../notify.js';
import { canAccessEverywhere, getManagedDeptIds } from '../acl.js';
import { normalizeFileIds } from './workflows.js';

const r = Router();

const str = (v) => String(v ?? '').trim();
const parseJson = (v, f) => { try { return JSON.parse(v); } catch { return f; } };
const setting = (k, f = '') => db.prepare('SELECT value FROM app_settings WHERE key = ?').get(k)?.value ?? f;

// چه کسی اطلاعیه منتشر می‌کند؟ مدیر سامانه و واحد مدیریت همیشه؛ بقیه اگر واحدشان
// در تنظیمات سازمان مجاز شده باشد یا مدیرِ واحدی باشند که اجازه دارد.
export function canPublish(user) {
  if (canAccessEverywhere(user) || hasPerm(user, 'announcements.manage')) return true;
  const allowed = parseJson(setting('announcements_dept_ids', '[]'), []).map(Number);
  if (!allowed.length) return false;
  const mine = new Set([user.department_id, ...getManagedDeptIds(user)].filter(Boolean).map(Number));
  return allowed.some(id => mine.has(id));
}

// آیا این اطلاعیه به این کاربر مربوط است؟
function targets(a, user) {
  if (a.audience === 'all') return true;
  if (a.audience === 'departments') {
    const ids = parseJson(a.dept_ids, []).map(Number);
    return user.department_id ? ids.includes(Number(user.department_id)) : false;
  }
  if (a.audience === 'users') return parseJson(a.user_ids, []).map(Number).includes(user.id);
  return false;
}

// همهٔ کاربرانی که یک اطلاعیه برایشان است
function audienceIds(a) {
  if (a.audience === 'departments') {
    const ids = parseJson(a.dept_ids, []).map(Number).filter(Boolean);
    if (!ids.length) return [];
    return db.prepare(`SELECT id FROM users WHERE is_active = 1 AND department_id IN (${ids.map(() => '?').join(',')})`)
      .all(...ids).map(u => u.id);
  }
  if (a.audience === 'users') {
    const ids = parseJson(a.user_ids, []).map(Number).filter(Boolean);
    if (!ids.length) return [];
    return db.prepare(`SELECT id FROM users WHERE is_active = 1 AND id IN (${ids.map(() => '?').join(',')})`)
      .all(...ids).map(u => u.id);
  }
  return db.prepare('SELECT id FROM users WHERE is_active = 1').all().map(u => u.id);
}

// منتشرشده و منقضی‌نشده؟
const live = `a.is_active = 1
  AND (a.publish_at IS NULL OR a.publish_at = '' OR datetime(a.publish_at) <= datetime('now'))
  AND (a.expires_at IS NULL OR a.expires_at = '' OR datetime(a.expires_at) >= datetime('now'))`;

r.get('/', (req, res) => {
  const mine = req.query.mine === '1';
  const rows = db.prepare(`
    SELECT a.*, u.full_name AS author_name, u.avatar_color AS author_color,
      (SELECT COUNT(*) FROM announcement_reads x WHERE x.announcement_id = a.id) AS read_count,
      (SELECT COUNT(*) FROM announcement_reads x WHERE x.announcement_id = a.id AND x.acked_at IS NOT NULL) AS ack_count,
      (SELECT read_at FROM announcement_reads x WHERE x.announcement_id = a.id AND x.user_id = @uid) AS my_read_at,
      (SELECT acked_at FROM announcement_reads x WHERE x.announcement_id = a.id AND x.user_id = @uid) AS my_acked_at
    FROM announcements a LEFT JOIN users u ON u.id = a.created_by
    WHERE (@manage = 1 AND @mine = 1) OR ${live}
    ORDER BY a.pinned DESC, a.id DESC LIMIT 200`)
    .all({ uid: req.user.id, manage: canPublish(req.user) ? 1 : 0, mine: mine ? 1 : 0 });

  const canManage = canPublish(req.user);
  const list = rows
    .filter(a => (mine && canManage ? a.created_by === req.user.id || canAccessEverywhere(req.user) : targets(a, req.user)))
    .map(a => ({
      ...a,
      dept_ids: parseJson(a.dept_ids, []), user_ids: parseJson(a.user_ids, []),
      attachments: parseJson(a.attachments, []),
      audience_count: canManage ? audienceIds(a).length : undefined,
    }));
  res.json({ announcements: list, can_publish: canManage, unread: list.filter(a => !a.my_read_at).length });
});

r.get('/:id', (req, res) => {
  const a = db.prepare(`SELECT a.*, u.full_name AS author_name FROM announcements a
    LEFT JOIN users u ON u.id = a.created_by WHERE a.id = ?`).get(req.params.id);
  if (!a) return res.status(404).json({ error: 'اطلاعیه یافت نشد' });
  const manage = canPublish(req.user);
  if (!targets(a, req.user) && !manage) return res.status(403).json({ error: 'این اطلاعیه برای شما نیست' });
  // باز کردن = خوانده شد
  db.prepare(`INSERT INTO announcement_reads (announcement_id, user_id) VALUES (?, ?)
    ON CONFLICT(announcement_id, user_id) DO NOTHING`).run(a.id, req.user.id);
  const readers = manage ? db.prepare(`
    SELECT x.user_id, x.read_at, x.acked_at, u.full_name, d.name AS department_name
    FROM announcement_reads x JOIN users u ON u.id = x.user_id
    LEFT JOIN departments d ON d.id = u.department_id
    WHERE x.announcement_id = ? ORDER BY x.read_at DESC`).all(a.id) : [];
  const my = db.prepare('SELECT * FROM announcement_reads WHERE announcement_id = ? AND user_id = ?')
    .get(a.id, req.user.id);
  res.json({
    announcement: { ...a, dept_ids: parseJson(a.dept_ids, []), user_ids: parseJson(a.user_ids, []),
      attachments: parseJson(a.attachments, []) },
    readers,
    audience_count: manage ? audienceIds(a).length : undefined,
    my_read_at: my?.read_at || null, my_acked_at: my?.acked_at || null,
    can_manage: manage && (a.created_by === req.user.id || canAccessEverywhere(req.user)),
  });
});

function cleanBody(b, prev = {}) {
  const audience = ['all', 'departments', 'users'].includes(b.audience) ? b.audience : (prev.audience || 'all');
  return {
    title: str(b.title ?? prev.title).slice(0, 200),
    body: String(b.body ?? prev.body ?? '').slice(0, 20000),
    kind: ['notice', 'urgent', 'event'].includes(b.kind) ? b.kind : (prev.kind || 'notice'),
    audience,
    dept_ids: JSON.stringify(audience === 'departments'
      ? (Array.isArray(b.dept_ids) ? b.dept_ids : parseJson(prev.dept_ids, [])).map(Number).filter(Boolean) : []),
    user_ids: JSON.stringify(audience === 'users'
      ? (Array.isArray(b.user_ids) ? b.user_ids : parseJson(prev.user_ids, [])).map(Number).filter(Boolean) : []),
    attachments: JSON.stringify(b.attachments !== undefined
      ? normalizeFileIds(b.attachments) : parseJson(prev.attachments, [])),
    pinned: b.pinned !== undefined ? (b.pinned ? 1 : 0) : (prev.pinned ?? 0),
    require_ack: b.require_ack !== undefined ? (b.require_ack ? 1 : 0) : (prev.require_ack ?? 0),
    publish_at: b.publish_at !== undefined ? (str(b.publish_at) || null) : (prev.publish_at ?? null),
    expires_at: b.expires_at !== undefined ? (str(b.expires_at) || null) : (prev.expires_at ?? null),
  };
}

r.post('/', (req, res) => {
  if (!canPublish(req.user)) return res.status(403).json({ error: 'شما مجاز به انتشار اطلاعیه نیستید' });
  const c = cleanBody(req.body || {});
  if (!c.title) return res.status(400).json({ error: 'عنوان اطلاعیه الزامی است' });
  if (c.audience === 'departments' && parseJson(c.dept_ids, []).length === 0) {
    return res.status(400).json({ error: 'حداقل یک واحد را انتخاب کنید' });
  }
  if (c.audience === 'users' && parseJson(c.user_ids, []).length === 0) {
    return res.status(400).json({ error: 'حداقل یک نفر را انتخاب کنید' });
  }
  const info = db.prepare(`INSERT INTO announcements
    (title, body, kind, audience, dept_ids, user_ids, attachments, pinned, require_ack, publish_at, expires_at, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(c.title, c.body, c.kind, c.audience, c.dept_ids, c.user_ids, c.attachments,
      c.pinned, c.require_ack, c.publish_at, c.expires_at, req.user.id);
  const a = db.prepare('SELECT * FROM announcements WHERE id = ?').get(info.lastInsertRowid);
  // اطلاعیهٔ زمان‌بندی‌شده بعداً اعلان می‌گیرد (موتور یادآوری)
  const now = !a.publish_at || new Date(a.publish_at).getTime() <= Date.now();
  if (now) notifyAudience(a, req.user);
  res.json({ id: a.id, notified: now });
});

export function notifyAudience(a, actor) {
  const ids = audienceIds(a).filter(id => id !== a.created_by);
  if (!ids.length) return 0;
  notifyUsers(ids, {
    type: a.kind === 'urgent' ? 'reminder' : 'info',
    title: `${a.kind === 'urgent' ? '🔴 اطلاعیهٔ فوری' : '📢 اطلاعیه'}: ${a.title}`,
    body: String(a.body || '').replace(/\s+/g, ' ').slice(0, 160)
      + (a.require_ack ? ' — لطفاً «دریافت شد» را بزنید' : ''),
    link: `/announcements?a=${a.id}`,
  });
  return ids.length;
}

r.put('/:id', (req, res) => {
  const a = db.prepare('SELECT * FROM announcements WHERE id = ?').get(req.params.id);
  if (!a) return res.status(404).json({ error: 'اطلاعیه یافت نشد' });
  if (!canPublish(req.user) || (a.created_by !== req.user.id && !canAccessEverywhere(req.user))) {
    return res.status(403).json({ error: 'فقط منتشرکنندهٔ اطلاعیه یا مدیریت می‌تواند آن را ویرایش کند' });
  }
  const c = cleanBody(req.body || {}, a);
  db.prepare(`UPDATE announcements SET title = ?, body = ?, kind = ?, audience = ?, dept_ids = ?, user_ids = ?,
    attachments = ?, pinned = ?, require_ack = ?, publish_at = ?, expires_at = ?, is_active = ?,
    updated_at = datetime('now') WHERE id = ?`)
    .run(c.title, c.body, c.kind, c.audience, c.dept_ids, c.user_ids, c.attachments,
      c.pinned, c.require_ack, c.publish_at, c.expires_at,
      req.body?.is_active !== undefined ? (req.body.is_active ? 1 : 0) : a.is_active, a.id);
  // اگر با این ویرایش اطلاعیه تازه «منتشر» شد (فعال شد یا زمان‌بندی‌اش به حالا رسید)، اعلانش برود
  const live = (x) => x.is_active && (!x.publish_at || new Date(x.publish_at).getTime() <= Date.now());
  const after = db.prepare('SELECT * FROM announcements WHERE id = ?').get(a.id);
  let notified = false;
  if (!live(a) && live(after)) {
    notifyAudience(after, req.user);
    if (after.publish_at) db.prepare("UPDATE announcements SET publish_at = '' WHERE id = ?").run(a.id);
    notified = true;
  }
  res.json({ ok: true, notified });
});

r.delete('/:id', (req, res) => {
  const a = db.prepare('SELECT * FROM announcements WHERE id = ?').get(req.params.id);
  if (!a) return res.status(404).json({ error: 'اطلاعیه یافت نشد' });
  if (!canPublish(req.user) || (a.created_by !== req.user.id && !canAccessEverywhere(req.user))) {
    return res.status(403).json({ error: 'دسترسی غیرمجاز' });
  }
  db.prepare('DELETE FROM announcements WHERE id = ?').run(a.id);
  res.json({ ok: true });
});

// «دریافت شد»
r.post('/:id/ack', (req, res) => {
  const a = db.prepare('SELECT * FROM announcements WHERE id = ?').get(req.params.id);
  if (!a) return res.status(404).json({ error: 'اطلاعیه یافت نشد' });
  if (!targets(a, req.user)) return res.status(403).json({ error: 'این اطلاعیه برای شما نیست' });
  db.prepare(`INSERT INTO announcement_reads (announcement_id, user_id, acked_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(announcement_id, user_id) DO UPDATE SET acked_at = COALESCE(announcement_reads.acked_at, datetime('now'))`)
    .run(a.id, req.user.id);
  res.json({ ok: true });
});

// ارسال دوبارهٔ اعلان — وقتی اطلاعیهٔ مهمی را کسی ندیده است
r.post('/:id/renotify', (req, res) => {
  const a = db.prepare('SELECT * FROM announcements WHERE id = ?').get(req.params.id);
  if (!a) return res.status(404).json({ error: 'اطلاعیه یافت نشد' });
  if (!canPublish(req.user)) return res.status(403).json({ error: 'دسترسی غیرمجاز' });
  const seen = new Set(db.prepare('SELECT user_id FROM announcement_reads WHERE announcement_id = ?')
    .all(a.id).map(x => x.user_id));
  const pending = audienceIds(a).filter(id => !seen.has(id) && id !== a.created_by);
  if (pending.length) {
    notifyUsers(pending, {
      type: 'reminder',
      title: `یادآوری اطلاعیه: ${a.title}`,
      body: 'این اطلاعیه را هنوز ندیده‌اید',
      link: `/announcements?a=${a.id}`,
    });
  }
  res.json({ ok: true, notified: pending.length });
});

export default r;
