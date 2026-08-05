// ============================================================================
//  CRM — مدیریت ارتباط با مشتری
//  مشتریان، مخاطبین، گزارش‌ها/پیگیری‌ها، معاملات (فروش) و گزارش‌گیری فروش.
//  دسترسی: مدیر سامانه و اعضای «واحد مدیریت» همیشه؛ سایر کاربران فقط اگر واحدشان
//  در تنظیمات سازمان (کلید crm_dept_ids) مجاز شده باشد.
// ============================================================================
import { Router } from 'express';
import db from '../db.js';
import { hasPerm } from '../auth.js';
import { notifyUsers } from '../notify.js';
import { canAccessEverywhere, getManagedDeptIds } from '../acl.js';
import tenderRoutes from './crm-tenders.js';
import careRoutes from './crm-care.js';

const r = Router();

// ---------- دسترسی ----------
function setting(key, fallback = '') {
  return db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key)?.value ?? fallback;
}

function deptIdList(key) {
  try {
    const v = JSON.parse(setting(key, '[]'));
    return Array.isArray(v) ? v.map(Number).filter(Boolean) : [];
  } catch { return []; }
}

// واحدهایی که می‌توانند با CRM کار کنند
export function crmDeptIds() { return deptIdList('crm_dept_ids'); }
// واحدهایی با «دسترسی کامل» — پیش‌فرض: بازرگانی و مدیریت
export function crmFullDeptIds() { return deptIdList('crm_full_dept_ids'); }

// واحدهای خودِ کاربر (واحد عضویت + واحدهایی که مدیرشان است)
function myDeptIds(user) {
  return new Set([user?.department_id, ...getManagedDeptIds(user || {})].filter(Boolean).map(Number));
}

// آیا این کاربر اجازهٔ کار با بخش CRM را دارد؟
export function canUseCrm(user) {
  if (!user) return false;
  if (setting('crm_enabled', '1') === '0') return false;
  if (canAccessEverywhere(user)) return true;          // مدیر سامانه / واحد مدیریت / مجوز صریح
  if (hasPerm(user, 'crm.manage')) return true;
  const mine = myDeptIds(user);
  // واحدهای با دسترسی کامل (بازرگانی/مدیریت) و واحدهای عادیِ مجاز
  return [...crmFullDeptIds(), ...crmDeptIds()].some(id => mine.has(id));
}

// آیا می‌تواند رکوردهای دیگران را هم ببیند/ویرایش/حذف کند و گزارشِ کل را بگیرد؟
//  • مدیر سامانه، اعضای «واحد مدیریت»، دارندهٔ مجوز crm.manage
//  • اعضای واحدهایی که «دسترسی کامل» گرفته‌اند (پیش‌فرض: بازرگانی و مدیریت)
//  • مدیرِ واحدی که آن واحد به CRM دسترسی دارد
export function canManageAll(user) {
  if (canAccessEverywhere(user) || hasPerm(user, 'crm.manage')) return true;
  const mine = myDeptIds(user);
  if (crmFullDeptIds().some(id => mine.has(id))) return true;
  return getManagedDeptIds(user).some(id => crmDeptIds().includes(Number(id)));
}

r.use((req, res, next) => {
  if (!canUseCrm(req.user)) {
    return res.status(403).json({ error: 'واحد شما به بخش CRM دسترسی ندارد' });
  }
  // یک‌بار محاسبه و به زیرروترها هم پاس داده می‌شود
  req.crmManage = canManageAll(req.user);
  next();
});

// مناقصات، کالا/خدمات، اقلامِ معامله، محصولات، تمرکز فروش، پشتیبانی و پیامک
// — همه همان کنترل دسترسی بالا را به ارث می‌برند
r.use(tenderRoutes);
r.use(careRoutes);

// ---------- ابزار ----------
const num = (v) => (v === undefined || v === null || v === '' ? 0 : Number(v) || 0);
const str = (v) => String(v ?? '').trim();

// فیلدهای دلخواه به‌صورت JSON در ستون extra ذخیره می‌شوند
function normalizeExtra(entity, extra) {
  const fields = db.prepare('SELECT key FROM crm_fields WHERE entity = ?').all(entity).map(f => f.key);
  const out = {};
  for (const k of fields) {
    const v = extra?.[k];
    if (v !== undefined && v !== null && String(v) !== '') out[k] = v;
  }
  return JSON.stringify(out);
}

function parseJson(s, fallback) {
  try { return JSON.parse(s); } catch { return fallback; }
}

// ---------- فیلدهای دلخواه ----------
r.get('/fields', (req, res) => {
  const fields = db.prepare('SELECT * FROM crm_fields ORDER BY entity, sort_order, id').all()
    .map(f => ({ ...f, options: parseJson(f.options, []) }));
  res.json({ fields });
});

r.post('/fields', (req, res) => {
  if (!canManageAll(req.user)) return res.status(403).json({ error: 'دسترسی غیرمجاز' });
  const { entity = 'customer', key, label, type = 'text', options = [], required = 0, sort_order = 0 } = req.body || {};
  if (!['customer', 'contact', 'deal'].includes(entity)) return res.status(400).json({ error: 'نوع رکورد نامعتبر است' });
  const cleanKey = str(key).replace(/[^a-zA-Z0-9_]/g, '');
  if (!cleanKey || !str(label)) return res.status(400).json({ error: 'کلید (انگلیسی) و برچسب فیلد الزامی است' });
  const exists = db.prepare('SELECT 1 FROM crm_fields WHERE entity = ? AND key = ?').get(entity, cleanKey);
  if (exists) return res.status(400).json({ error: 'فیلدی با این کلید از قبل وجود دارد' });
  const info = db.prepare(`INSERT INTO crm_fields (entity, key, label, type, options, required, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(entity, cleanKey, str(label), str(type) || 'text',
      JSON.stringify(Array.isArray(options) ? options : []), required ? 1 : 0, num(sort_order));
  res.json({ id: info.lastInsertRowid });
});

r.delete('/fields/:id', (req, res) => {
  if (!canManageAll(req.user)) return res.status(403).json({ error: 'دسترسی غیرمجاز' });
  db.prepare('DELETE FROM crm_fields WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------- مشتریان ----------
const CUSTOMER_COLS = ['name', 'kind', 'status', 'economic_code', 'national_id', 'phone', 'email',
  'website', 'city', 'address', 'postal_code', 'industry', 'source', 'note'];

function customerRow(c) {
  return {
    ...c,
    extra: parseJson(c.extra, {}),
    contacts_count: db.prepare('SELECT COUNT(*) c FROM crm_contacts WHERE customer_id = ?').get(c.id).c,
    activities_count: db.prepare('SELECT COUNT(*) c FROM crm_activities WHERE customer_id = ?').get(c.id).c,
    deals_count: db.prepare('SELECT COUNT(*) c FROM crm_deals WHERE customer_id = ?').get(c.id).c,
    won_amount: db.prepare("SELECT COALESCE(SUM(amount),0) s FROM crm_deals WHERE customer_id = ? AND stage = 'won'").get(c.id).s,
    open_amount: db.prepare("SELECT COALESCE(SUM(amount),0) s FROM crm_deals WHERE customer_id = ? AND stage NOT IN ('won','lost')").get(c.id).s,
    // نزدیک‌ترین پیگیریِ انجام‌نشده
    next_follow_up: db.prepare(`SELECT MIN(follow_up_at) f FROM crm_activities
      WHERE customer_id = ? AND follow_up_done = 0 AND follow_up_at IS NOT NULL AND follow_up_at != ''`).get(c.id).f || null,
  };
}

r.get('/customers', (req, res) => {
  const { q = '', status = '', owner_id = '', department_id = '' } = req.query;
  const where = [];
  const params = [];
  if (q) {
    where.push('(c.name LIKE ? OR c.phone LIKE ? OR c.email LIKE ? OR c.city LIKE ? OR c.industry LIKE ?)');
    for (let i = 0; i < 5; i++) params.push(`%${q}%`);
  }
  if (status) { where.push('c.status = ?'); params.push(String(status)); }
  if (owner_id) { where.push('c.owner_id = ?'); params.push(Number(owner_id)); }
  if (department_id) { where.push('c.department_id = ?'); params.push(Number(department_id)); }
  const rows = db.prepare(`
    SELECT c.*, u.full_name AS owner_name, d.name AS department_name
    FROM crm_customers c
    LEFT JOIN users u ON u.id = c.owner_id
    LEFT JOIN departments d ON d.id = c.department_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY c.updated_at DESC, c.id DESC LIMIT 500`).all(...params);
  res.json({ customers: rows.map(customerRow), can_manage: canManageAll(req.user) });
});

r.get('/customers/:id', (req, res) => {
  const c = db.prepare(`
    SELECT c.*, u.full_name AS owner_name, d.name AS department_name
    FROM crm_customers c
    LEFT JOIN users u ON u.id = c.owner_id
    LEFT JOIN departments d ON d.id = c.department_id
    WHERE c.id = ?`).get(req.params.id);
  if (!c) return res.status(404).json({ error: 'مشتری یافت نشد' });
  const contacts = db.prepare('SELECT * FROM crm_contacts WHERE customer_id = ? ORDER BY is_primary DESC, id')
    .all(c.id).map(x => ({ ...x, extra: parseJson(x.extra, {}) }));
  const activities = db.prepare(`
    SELECT a.*, u.full_name AS user_name, ct.first_name AS contact_first, ct.last_name AS contact_last
    FROM crm_activities a
    LEFT JOIN users u ON u.id = a.user_id
    LEFT JOIN crm_contacts ct ON ct.id = a.contact_id
    WHERE a.customer_id = ? ORDER BY a.happened_at DESC, a.id DESC`).all(c.id)
    .map(a => ({ ...a, attachments: parseJson(a.attachments, []) }));
  const deals = db.prepare(`
    SELECT dl.*, u.full_name AS owner_name FROM crm_deals dl
    LEFT JOIN users u ON u.id = dl.owner_id
    WHERE dl.customer_id = ? ORDER BY dl.id DESC`).all(c.id)
    .map(d => ({ ...d, extra: parseJson(d.extra, {}) }));
  res.json({ customer: { ...customerRow(c), contacts, activities, deals }, can_manage: canManageAll(req.user) });
});

r.post('/customers', (req, res) => {
  const b = req.body || {};
  if (!str(b.name)) return res.status(400).json({ error: 'نام مشتری الزامی است' });
  const vals = CUSTOMER_COLS.map(k => str(b[k]));
  const info = db.prepare(`INSERT INTO crm_customers
    (${CUSTOMER_COLS.join(', ')}, extra, owner_id, department_id, created_by)
    VALUES (${CUSTOMER_COLS.map(() => '?').join(', ')}, ?, ?, ?, ?)`)
    .run(...vals, normalizeExtra('customer', b.extra),
      b.owner_id || req.user.id, b.department_id || req.user.department_id || null, req.user.id);
  res.json({ id: info.lastInsertRowid });
});

r.put('/customers/:id', (req, res) => {
  const c = db.prepare('SELECT * FROM crm_customers WHERE id = ?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'مشتری یافت نشد' });
  if (c.created_by !== req.user.id && c.owner_id !== req.user.id && !canManageAll(req.user)) {
    return res.status(403).json({ error: 'فقط کارشناسِ مسئول یا مدیر می‌تواند این مشتری را ویرایش کند' });
  }
  const b = req.body || {};
  const vals = CUSTOMER_COLS.map(k => (b[k] !== undefined ? str(b[k]) : c[k]));
  db.prepare(`UPDATE crm_customers SET ${CUSTOMER_COLS.map(k => `${k} = ?`).join(', ')},
    extra = ?, owner_id = ?, department_id = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(...vals,
      b.extra !== undefined ? normalizeExtra('customer', b.extra) : c.extra,
      b.owner_id !== undefined ? (b.owner_id || null) : c.owner_id,
      b.department_id !== undefined ? (b.department_id || null) : c.department_id,
      c.id);
  res.json({ ok: true });
});

r.delete('/customers/:id', (req, res) => {
  const c = db.prepare('SELECT * FROM crm_customers WHERE id = ?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'مشتری یافت نشد' });
  if (!canManageAll(req.user)) return res.status(403).json({ error: 'فقط مدیر می‌تواند مشتری را حذف کند' });
  db.prepare('DELETE FROM crm_customers WHERE id = ?').run(c.id); // مخاطب/فعالیت/معامله CASCADE می‌شوند
  res.json({ ok: true });
});

// ---------- مخاطبین ----------
const CONTACT_COLS = ['first_name', 'last_name', 'position', 'phone', 'mobile', 'email', 'note'];

r.post('/customers/:id/contacts', (req, res) => {
  const c = db.prepare('SELECT id FROM crm_customers WHERE id = ?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'مشتری یافت نشد' });
  const b = req.body || {};
  if (!str(b.first_name) && !str(b.last_name)) return res.status(400).json({ error: 'نام یا نام خانوادگی الزامی است' });
  const info = db.prepare(`INSERT INTO crm_contacts
    (customer_id, ${CONTACT_COLS.join(', ')}, is_primary, extra)
    VALUES (?, ${CONTACT_COLS.map(() => '?').join(', ')}, ?, ?)`)
    .run(c.id, ...CONTACT_COLS.map(k => str(b[k])), b.is_primary ? 1 : 0, normalizeExtra('contact', b.extra));
  // فقط یک مخاطب می‌تواند «اصلی» باشد
  if (b.is_primary) {
    db.prepare('UPDATE crm_contacts SET is_primary = 0 WHERE customer_id = ? AND id != ?').run(c.id, info.lastInsertRowid);
  }
  res.json({ id: info.lastInsertRowid });
});

r.put('/contacts/:id', (req, res) => {
  const ct = db.prepare('SELECT * FROM crm_contacts WHERE id = ?').get(req.params.id);
  if (!ct) return res.status(404).json({ error: 'مخاطب یافت نشد' });
  const b = req.body || {};
  db.prepare(`UPDATE crm_contacts SET ${CONTACT_COLS.map(k => `${k} = ?`).join(', ')}, is_primary = ?, extra = ? WHERE id = ?`)
    .run(...CONTACT_COLS.map(k => (b[k] !== undefined ? str(b[k]) : ct[k])),
      b.is_primary !== undefined ? (b.is_primary ? 1 : 0) : ct.is_primary,
      b.extra !== undefined ? normalizeExtra('contact', b.extra) : ct.extra,
      ct.id);
  if (b.is_primary) {
    db.prepare('UPDATE crm_contacts SET is_primary = 0 WHERE customer_id = ? AND id != ?').run(ct.customer_id, ct.id);
  }
  res.json({ ok: true });
});

r.delete('/contacts/:id', (req, res) => {
  db.prepare('DELETE FROM crm_contacts WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------- گزارش‌ها و پیگیری‌ها ----------
r.post('/customers/:id/activities', (req, res) => {
  const c = db.prepare('SELECT id, name FROM crm_customers WHERE id = ?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'مشتری یافت نشد' });
  const b = req.body || {};
  if (!str(b.subject) && !str(b.body)) return res.status(400).json({ error: 'موضوع یا شرح گزارش الزامی است' });
  const info = db.prepare(`INSERT INTO crm_activities
    (customer_id, contact_id, deal_id, type, subject, body, outcome, happened_at, follow_up_at, attachments, user_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE(NULLIF(?, ''), datetime('now')), ?, ?, ?)`)
    .run(c.id, b.contact_id || null, b.deal_id || null, str(b.type) || 'call',
      str(b.subject), str(b.body), str(b.outcome), str(b.happened_at),
      str(b.follow_up_at) || null,
      JSON.stringify(Array.isArray(b.attachments) ? b.attachments.map(Number).filter(Boolean) : []),
      req.user.id);
  db.prepare("UPDATE crm_customers SET updated_at = datetime('now') WHERE id = ?").run(c.id);
  res.json({ id: info.lastInsertRowid });
});

r.put('/activities/:id', (req, res) => {
  const a = db.prepare('SELECT * FROM crm_activities WHERE id = ?').get(req.params.id);
  if (!a) return res.status(404).json({ error: 'گزارش یافت نشد' });
  if (a.user_id !== req.user.id && !canManageAll(req.user)) {
    return res.status(403).json({ error: 'فقط ثبت‌کنندهٔ گزارش یا مدیر می‌تواند آن را ویرایش کند' });
  }
  const b = req.body || {};
  db.prepare(`UPDATE crm_activities SET type = ?, subject = ?, body = ?, outcome = ?,
    happened_at = ?, follow_up_at = ?, follow_up_done = ?, contact_id = ?, deal_id = ?, attachments = ? WHERE id = ?`)
    .run(b.type !== undefined ? str(b.type) : a.type,
      b.subject !== undefined ? str(b.subject) : a.subject,
      b.body !== undefined ? str(b.body) : a.body,
      b.outcome !== undefined ? str(b.outcome) : a.outcome,
      b.happened_at !== undefined ? str(b.happened_at) : a.happened_at,
      b.follow_up_at !== undefined ? (str(b.follow_up_at) || null) : a.follow_up_at,
      b.follow_up_done !== undefined ? (b.follow_up_done ? 1 : 0) : a.follow_up_done,
      b.contact_id !== undefined ? (b.contact_id || null) : a.contact_id,
      b.deal_id !== undefined ? (b.deal_id || null) : a.deal_id,
      b.attachments !== undefined
        ? JSON.stringify(Array.isArray(b.attachments) ? b.attachments.map(Number).filter(Boolean) : [])
        : a.attachments,
      a.id);
  res.json({ ok: true });
});

r.delete('/activities/:id', (req, res) => {
  const a = db.prepare('SELECT * FROM crm_activities WHERE id = ?').get(req.params.id);
  if (!a) return res.status(404).json({ error: 'گزارش یافت نشد' });
  if (a.user_id !== req.user.id && !canManageAll(req.user)) return res.status(403).json({ error: 'دسترسی غیرمجاز' });
  db.prepare('DELETE FROM crm_activities WHERE id = ?').run(a.id);
  res.json({ ok: true });
});

// پیگیری‌های سررسیدشده/پیشِ‌روی من — برای کارتِ «پیگیری‌های امروز»
r.get('/follow-ups', (req, res) => {
  // نکته: node:sqlite پارامترِ نام‌دارِ استفاده‌نشده را رد می‌کند، پس شرطِ دسترسی
  // به‌جای حذف‌شدن از SQL، با پارامترِ @all کنترل می‌شود.
  const rows = db.prepare(`
    SELECT a.*, c.name AS customer_name, u.full_name AS user_name
    FROM crm_activities a
    JOIN crm_customers c ON c.id = a.customer_id
    LEFT JOIN users u ON u.id = a.user_id
    WHERE a.follow_up_done = 0 AND a.follow_up_at IS NOT NULL AND a.follow_up_at != ''
      AND (@all = 1 OR a.user_id = @uid)
    ORDER BY a.follow_up_at LIMIT 200`).all({ uid: req.user.id, all: canManageAll(req.user) ? 1 : 0 });
  res.json({ follow_ups: rows });
});

// ---------- معاملات / فروش ----------
const DEAL_STAGES = ['new', 'quoted', 'negotiation', 'won', 'lost'];

r.get('/deals', (req, res) => {
  const { stage = '', owner_id = '', customer_id = '', from = '', to = '' } = req.query;
  const where = [];
  const params = [];
  if (stage) { where.push('d.stage = ?'); params.push(String(stage)); }
  if (owner_id) { where.push('d.owner_id = ?'); params.push(Number(owner_id)); }
  if (customer_id) { where.push('d.customer_id = ?'); params.push(Number(customer_id)); }
  if (from) { where.push('d.created_at >= ?'); params.push(String(from)); }
  if (to) { where.push('d.created_at <= ?'); params.push(String(to) + ' 23:59:59'); }
  const deals = db.prepare(`
    SELECT d.*, c.name AS customer_name, u.full_name AS owner_name, dep.name AS department_name
    FROM crm_deals d
    JOIN crm_customers c ON c.id = d.customer_id
    LEFT JOIN users u ON u.id = d.owner_id
    LEFT JOIN departments dep ON dep.id = c.department_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY d.id DESC LIMIT 500`).all(...params)
    .map(d => ({ ...d, extra: parseJson(d.extra, {}) }));
  res.json({ deals, can_manage: canManageAll(req.user) });
});

r.post('/deals', (req, res) => {
  const b = req.body || {};
  const c = db.prepare('SELECT id FROM crm_customers WHERE id = ?').get(b.customer_id);
  if (!c) return res.status(400).json({ error: 'مشتری را انتخاب کنید' });
  if (!str(b.title)) return res.status(400).json({ error: 'عنوان معامله الزامی است' });
  const stage = DEAL_STAGES.includes(b.stage) ? b.stage : 'new';
  const info = db.prepare(`INSERT INTO crm_deals
    (customer_id, title, amount, stage, probability, expected_close, product, note, extra, owner_id, created_by, closed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(c.id, str(b.title), num(b.amount), stage, num(b.probability),
      str(b.expected_close) || null, str(b.product), str(b.note),
      normalizeExtra('deal', b.extra), b.owner_id || req.user.id, req.user.id,
      ['won', 'lost'].includes(stage) ? new Date().toISOString() : null);
  db.prepare("UPDATE crm_customers SET updated_at = datetime('now') WHERE id = ?").run(c.id);
  // [گزارش مرحله‌ای] گزارشِ آغازِ معامله
  {
    const rep = b.stage_report || {};
    db.prepare(`INSERT INTO crm_stage_reports
      (deal_id, customer_id, from_stage, stage, summary, went_well, went_wrong, blockers, next_action, confidence, user_id)
      VALUES (?, ?, '', ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(info.lastInsertRowid, c.id, stage,
        str(rep.summary) || 'ثبت معاملهٔ جدید', str(rep.went_well), str(rep.went_wrong),
        str(rep.blockers), str(rep.next_action),
        Math.max(0, Math.min(100, num(rep.confidence) || num(b.probability))), req.user.id);
  }
  res.json({ id: info.lastInsertRowid });
});

r.put('/deals/:id', (req, res) => {
  const d = db.prepare('SELECT * FROM crm_deals WHERE id = ?').get(req.params.id);
  if (!d) return res.status(404).json({ error: 'معامله یافت نشد' });
  if (d.owner_id !== req.user.id && d.created_by !== req.user.id && !canManageAll(req.user)) {
    return res.status(403).json({ error: 'فقط مسئولِ معامله یا مدیر می‌تواند آن را ویرایش کند' });
  }
  const b = req.body || {};
  const stage = b.stage !== undefined ? (DEAL_STAGES.includes(b.stage) ? b.stage : d.stage) : d.stage;
  const closing = ['won', 'lost'].includes(stage);
  db.prepare(`UPDATE crm_deals SET title = ?, amount = ?, stage = ?, probability = ?, expected_close = ?,
    product = ?, note = ?, lost_reason = ?, extra = ?, owner_id = ?, closed_at = ?, updated_at = datetime('now')
    WHERE id = ?`)
    .run(b.title !== undefined ? str(b.title) : d.title,
      b.amount !== undefined ? num(b.amount) : d.amount,
      stage,
      b.probability !== undefined ? num(b.probability) : d.probability,
      b.expected_close !== undefined ? (str(b.expected_close) || null) : d.expected_close,
      b.product !== undefined ? str(b.product) : d.product,
      b.note !== undefined ? str(b.note) : d.note,
      b.lost_reason !== undefined ? str(b.lost_reason) : d.lost_reason,
      b.extra !== undefined ? normalizeExtra('deal', b.extra) : d.extra,
      b.owner_id !== undefined ? (b.owner_id || null) : d.owner_id,
      closing ? (d.closed_at || new Date().toISOString()) : null,
      d.id);
  // [گزارش مرحله‌ای] با هر جابه‌جاییِ مرحله، گزارشِ کارشناس ثبت می‌شود.
  // این متن‌ها هم در گزارش‌های مدیریتی و هم توسط دستیار هوشمند خوانده می‌شوند.
  if (stage !== d.stage) {
    const rep = b.stage_report || {};
    db.prepare(`INSERT INTO crm_stage_reports
      (deal_id, customer_id, from_stage, stage, summary, went_well, went_wrong, blockers, next_action, confidence, user_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(d.id, d.customer_id, d.stage, stage,
        str(rep.summary), str(rep.went_well), str(rep.went_wrong), str(rep.blockers), str(rep.next_action),
        Math.max(0, Math.min(100, num(rep.confidence))), req.user.id);
  }

  // برنده‌شدن معامله خبر خوبی است — به مسئولش اطلاع بده
  if (stage === 'won' && d.stage !== 'won' && d.owner_id && d.owner_id !== req.user.id) {
    const cust = db.prepare('SELECT name FROM crm_customers WHERE id = ?').get(d.customer_id);
    notifyUsers([d.owner_id], {
      type: 'info',
      title: 'معامله برنده شد',
      body: `«${d.title}» برای مشتری ${cust?.name || ''} به‌عنوان برنده ثبت شد`,
      link: '/crm',
    });
  }
  res.json({ ok: true });
});

r.delete('/deals/:id', (req, res) => {
  const d = db.prepare('SELECT * FROM crm_deals WHERE id = ?').get(req.params.id);
  if (!d) return res.status(404).json({ error: 'معامله یافت نشد' });
  if (d.owner_id !== req.user.id && d.created_by !== req.user.id && !canManageAll(req.user)) {
    return res.status(403).json({ error: 'دسترسی غیرمجاز' });
  }
  db.prepare('DELETE FROM crm_deals WHERE id = ?').run(d.id);
  res.json({ ok: true });
});

// ---------- گزارش‌های مرحله‌ایِ معاملات ----------
// فهرست گزارش‌های یک معامله
r.get('/deals/:id/stage-reports', (req, res) => {
  const rows = db.prepare(`
    SELECT sr.*, u.full_name AS user_name FROM crm_stage_reports sr
    LEFT JOIN users u ON u.id = sr.user_id
    WHERE sr.deal_id = ? ORDER BY sr.id`).all(req.params.id);
  res.json({ reports: rows });
});

// ثبت گزارشِ مستقل (بدون تغییر مرحله) — مثلاً «این هفته چه پیش رفت»
r.post('/deals/:id/stage-reports', (req, res) => {
  const d = db.prepare('SELECT * FROM crm_deals WHERE id = ?').get(req.params.id);
  if (!d) return res.status(404).json({ error: 'معامله یافت نشد' });
  const b = req.body || {};
  if (!str(b.summary) && !str(b.went_well) && !str(b.went_wrong) && !str(b.next_action)) {
    return res.status(400).json({ error: 'حداقل یکی از بخش‌های گزارش را پر کنید' });
  }
  const info = db.prepare(`INSERT INTO crm_stage_reports
    (deal_id, customer_id, from_stage, stage, summary, went_well, went_wrong, blockers, next_action, confidence, user_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(d.id, d.customer_id, d.stage, d.stage,
      str(b.summary), str(b.went_well), str(b.went_wrong), str(b.blockers), str(b.next_action),
      Math.max(0, Math.min(100, num(b.confidence))), req.user.id);
  res.json({ id: info.lastInsertRowid });
});

r.put('/stage-reports/:id', (req, res) => {
  const sr = db.prepare('SELECT * FROM crm_stage_reports WHERE id = ?').get(req.params.id);
  if (!sr) return res.status(404).json({ error: 'گزارش یافت نشد' });
  if (sr.user_id !== req.user.id && !canManageAll(req.user)) {
    return res.status(403).json({ error: 'فقط نویسندهٔ گزارش یا مدیر می‌تواند آن را ویرایش کند' });
  }
  const b = req.body || {};
  const pick = (k) => (b[k] !== undefined ? str(b[k]) : sr[k]);
  db.prepare(`UPDATE crm_stage_reports SET summary = ?, went_well = ?, went_wrong = ?,
    blockers = ?, next_action = ?, confidence = ? WHERE id = ?`)
    .run(pick('summary'), pick('went_well'), pick('went_wrong'), pick('blockers'), pick('next_action'),
      b.confidence !== undefined ? Math.max(0, Math.min(100, num(b.confidence))) : sr.confidence, sr.id);
  res.json({ ok: true });
});

r.delete('/stage-reports/:id', (req, res) => {
  const sr = db.prepare('SELECT * FROM crm_stage_reports WHERE id = ?').get(req.params.id);
  if (!sr) return res.status(404).json({ error: 'گزارش یافت نشد' });
  if (sr.user_id !== req.user.id && !canManageAll(req.user)) return res.status(403).json({ error: 'دسترسی غیرمجاز' });
  db.prepare('DELETE FROM crm_stage_reports WHERE id = ?').run(sr.id);
  res.json({ ok: true });
});

// معاملاتی که گزارشِ به‌روز ندارند — یادآوری به کارشناس که گزارشش را بنویسد
r.get('/pending-reports', (req, res) => {
  const all = canManageAll(req.user);
  const rows = db.prepare(`
    SELECT d.id, d.title, d.stage, d.amount, d.updated_at, c.name AS customer_name,
           u.full_name AS owner_name, d.owner_id,
           (SELECT MAX(created_at) FROM crm_stage_reports sr WHERE sr.deal_id = d.id) AS last_report_at
    FROM crm_deals d
    JOIN crm_customers c ON c.id = d.customer_id
    LEFT JOIN users u ON u.id = d.owner_id
    WHERE d.stage NOT IN ('won','lost') AND (@all = 1 OR d.owner_id = @uid)
    ORDER BY last_report_at IS NULL DESC, last_report_at`).all({ uid: req.user.id, all: all ? 1 : 0 });
  // «کهنه» یعنی بیش از ۱۴ روز از آخرین گزارش گذشته یا اصلاً گزارشی ندارد
  const cutoff = Date.now() - 14 * 24 * 3600 * 1000;
  const stale = rows.filter(d => !d.last_report_at || new Date(d.last_report_at + 'Z').getTime() < cutoff);
  res.json({ deals: stale, total_open: rows.length });
});

// ---------- گزارش‌گیری فروش ----------
// همهٔ گزارش‌ها از یک «فیلترِ پایه» می‌آیند تا اعداد بین بخش‌ها با هم بخوانند.
function reportFilter(req) {
  const { from = '', to = '', owner_id = '', department_id = '', customer_id = '' } = req.query;
  const where = [];
  const params = [];
  if (from) { where.push('d.created_at >= ?'); params.push(String(from)); }
  if (to) { where.push('d.created_at <= ?'); params.push(String(to) + ' 23:59:59'); }
  if (owner_id) { where.push('d.owner_id = ?'); params.push(Number(owner_id)); }
  if (department_id) { where.push('c.department_id = ?'); params.push(Number(department_id)); }
  if (customer_id) { where.push('d.customer_id = ?'); params.push(Number(customer_id)); }
  // کارشناسی که دسترسی کامل ندارد فقط معاملاتِ خودش را می‌بیند
  if (!canManageAll(req.user)) { where.push('d.owner_id = ?'); params.push(req.user.id); }
  return { clause: where.length ? 'WHERE ' + where.join(' AND ') : '', params };
}

// نرخ موفقیت = برنده ÷ (برنده + بازنده). معاملاتِ باز در مخرج نمی‌آیند چون
// هنوز سرنوشتشان معلوم نیست و نرخ را مصنوعی پایین می‌آورند.
function successRate(won, lost) {
  const closed = Number(won) + Number(lost);
  return closed > 0 ? Math.round((Number(won) / closed) * 1000) / 10 : null;
}

const AGG = `
  COUNT(*) AS total,
  SUM(CASE WHEN d.stage = 'won' THEN 1 ELSE 0 END) AS won_count,
  SUM(CASE WHEN d.stage = 'lost' THEN 1 ELSE 0 END) AS lost_count,
  SUM(CASE WHEN d.stage NOT IN ('won','lost') THEN 1 ELSE 0 END) AS open_count,
  COALESCE(SUM(d.amount), 0) AS total_amount,
  COALESCE(SUM(CASE WHEN d.stage = 'won' THEN d.amount ELSE 0 END), 0) AS won_amount,
  COALESCE(SUM(CASE WHEN d.stage = 'lost' THEN d.amount ELSE 0 END), 0) AS lost_amount,
  COALESCE(SUM(CASE WHEN d.stage NOT IN ('won','lost') THEN d.amount ELSE 0 END), 0) AS open_amount,
  COALESCE(AVG(CASE WHEN d.stage = 'won' THEN d.amount END), 0) AS avg_won_amount,
  COALESCE(AVG(CASE WHEN d.closed_at IS NOT NULL
    THEN julianday(d.closed_at) - julianday(d.created_at) END), 0) AS avg_cycle_days`;

r.get('/reports', (req, res) => {
  const { clause, params } = reportFilter(req);
  const base = `FROM crm_deals d JOIN crm_customers c ON c.id = d.customer_id ${clause}`;
  const withRate = (row) => ({ ...row, success_rate: successRate(row.won_count, row.lost_count) });

  // ---- خلاصهٔ کلی
  const summary = withRate(db.prepare(`SELECT ${AGG} ${base}`).get(...params));

  // ---- قیف فروش: در هر مرحله چند معامله و چه مبلغی هست
  const byStage = db.prepare(`
    SELECT d.stage, COUNT(*) AS count, COALESCE(SUM(d.amount), 0) AS amount ${base}
    GROUP BY d.stage`).all(...params);

  // ---- عملکرد هر کارشناس فروش (با نرخ موفقیت)
  const byOwner = db.prepare(`
    SELECT d.owner_id, COALESCE(u.full_name, 'بدون مسئول') AS owner_name, ${AGG}
    ${base} LEFT JOIN users u ON u.id = d.owner_id
    GROUP BY d.owner_id`).all(...params).map(withRate)
    .sort((a, b) => b.won_amount - a.won_amount);

  // ---- عملکرد هر واحد
  const byDepartment = db.prepare(`
    SELECT COALESCE(dep.name, 'بدون واحد') AS department_name, ${AGG}
    ${base} LEFT JOIN departments dep ON dep.id = c.department_id
    GROUP BY c.department_id`).all(...params).map(withRate)
    .sort((a, b) => b.won_amount - a.won_amount);

  // ---- روند ماهانه (بر اساس ماه میلادیِ ثبت — برای نمودار روند)
  const monthly = db.prepare(`
    SELECT strftime('%Y-%m', d.created_at) AS month, ${AGG}
    ${base} GROUP BY month ORDER BY month`).all(...params).map(withRate);

  // ---- مشتریان برتر
  const topCustomers = db.prepare(`
    SELECT c.id, c.name, ${AGG} ${base} GROUP BY c.id`).all(...params).map(withRate)
    .sort((a, b) => b.won_amount - a.won_amount).slice(0, 15);

  // ---- دلایل باخت: مهم‌ترین ورودیِ «چه چیزی را بهتر کنیم»
  const lostReasons = db.prepare(`
    SELECT COALESCE(NULLIF(TRIM(d.lost_reason), ''), 'ثبت‌نشده') AS reason,
           COUNT(*) AS count, COALESCE(SUM(d.amount), 0) AS amount
    ${base} ${clause ? 'AND' : 'WHERE'} d.stage = 'lost'
    GROUP BY reason ORDER BY count DESC`).all(...params);

  // ---- اثربخشی «نحوهٔ آشنایی» با مشتری: کدام کانالِ ورودی بیشتر به فروش می‌رسد
  const bySource = db.prepare(`
    SELECT COALESCE(NULLIF(TRIM(c.source), ''), 'نامشخص') AS source, ${AGG}
    ${base} GROUP BY source`).all(...params).map(withRate)
    .sort((a, b) => b.total - a.total);

  // ---- اثربخشی پیگیری: آیا معاملاتی که بیشتر پیگیری شده‌اند بیشتر برنده می‌شوند؟
  const byTouch = db.prepare(`
    SELECT CASE
             WHEN t.touches = 0 THEN 'بدون پیگیری'
             WHEN t.touches <= 2 THEN '۱ تا ۲ پیگیری'
             WHEN t.touches <= 5 THEN '۳ تا ۵ پیگیری'
             ELSE 'بیش از ۵ پیگیری' END AS bucket,
           MIN(t.touches) AS min_touches, ${AGG}
    ${base}
    JOIN (SELECT d2.id AS did,
            (SELECT COUNT(*) FROM crm_activities a WHERE a.deal_id = d2.id) AS touches
          FROM crm_deals d2) t ON t.did = d.id
    GROUP BY bucket`).all(...params).map(withRate)
    .sort((a, b) => a.min_touches - b.min_touches);

  // ---- فعالیت‌ها (تماس/جلسه/…) در همان بازه
  const actWhere = [];
  const actParams = [];
  if (req.query.from) { actWhere.push('a.happened_at >= ?'); actParams.push(String(req.query.from)); }
  if (req.query.to) { actWhere.push('a.happened_at <= ?'); actParams.push(String(req.query.to) + ' 23:59:59'); }
  if (!canManageAll(req.user)) { actWhere.push('a.user_id = ?'); actParams.push(req.user.id); }
  const activities = db.prepare(`
    SELECT a.type, COUNT(*) AS count FROM crm_activities a
    ${actWhere.length ? 'WHERE ' + actWhere.join(' AND ') : ''}
    GROUP BY a.type`).all(...actParams);

  // ---- پیگیری‌های عقب‌افتاده
  const overdue = db.prepare(`
    SELECT COUNT(*) c FROM crm_activities a
    WHERE a.follow_up_done = 0 AND a.follow_up_at IS NOT NULL AND a.follow_up_at != ''
      AND a.follow_up_at <= datetime('now') AND (@all = 1 OR a.user_id = @uid)`)
    .get({ uid: req.user.id, all: canManageAll(req.user) ? 1 : 0 }).c;

  const customers = db.prepare('SELECT status, COUNT(*) AS count FROM crm_customers GROUP BY status').all();

  res.json({
    summary, by_stage: byStage, by_owner: byOwner, by_department: byDepartment,
    monthly, top_customers: topCustomers, lost_reasons: lostReasons,
    by_source: bySource, by_touch: byTouch, activities, customers,
    overdue_follow_ups: overdue,
    scoped: !canManageAll(req.user),
    lost_reason_options: String(setting('crm_lost_reasons', '')).split('،').map(x => x.trim()).filter(Boolean),
  });
});

// ---------- عملکرد فردی ----------
// هر کارشناس فروش نرخ موفقیت خودش، روندش و مقایسه‌اش با میانگین تیم را می‌بیند
// تا بتواند برای آینده برنامه بریزد.
r.get('/my-performance', (req, res) => {
  const uid = Number(req.query.user_id) || req.user.id;
  if (uid !== req.user.id && !canManageAll(req.user)) {
    return res.status(403).json({ error: 'دسترسی به عملکرد سایر کارشناسان ندارید' });
  }
  const person = db.prepare('SELECT id, full_name FROM users WHERE id = ?').get(uid);
  if (!person) return res.status(404).json({ error: 'کاربر یافت نشد' });

  const mineBase = 'FROM crm_deals d JOIN crm_customers c ON c.id = d.customer_id WHERE d.owner_id = ?';
  const mine = db.prepare(`SELECT ${AGG} ${mineBase}`).get(uid);
  mine.success_rate = successRate(mine.won_count, mine.lost_count);

  // میانگین تیم (همهٔ کارشناسانی که حداقل یک معاملهٔ بسته‌شده دارند)
  const teamRows = db.prepare(`
    SELECT d.owner_id, ${AGG}
    FROM crm_deals d JOIN crm_customers c ON c.id = d.customer_id
    WHERE d.owner_id IS NOT NULL GROUP BY d.owner_id`).all().map(x => ({ ...x, success_rate: successRate(x.won_count, x.lost_count) }));
  const rated = teamRows.filter(t => t.success_rate !== null);
  const team = {
    people: teamRows.length,
    avg_success_rate: rated.length
      ? Math.round((rated.reduce((s, t) => s + t.success_rate, 0) / rated.length) * 10) / 10 : null,
    avg_won_amount: teamRows.length
      ? Math.round(teamRows.reduce((s, t) => s + Number(t.won_amount), 0) / teamRows.length) : 0,
    avg_cycle_days: rated.length
      ? Math.round((teamRows.reduce((s, t) => s + Number(t.avg_cycle_days), 0) / teamRows.length) * 10) / 10 : 0,
    // رتبهٔ این کارشناس بر اساس مبلغ فروش موفق
    rank: teamRows.slice().sort((a, b) => b.won_amount - a.won_amount).findIndex(t => t.owner_id === uid) + 1,
  };

  const monthly = db.prepare(`
    SELECT strftime('%Y-%m', d.created_at) AS month, ${AGG}
    ${mineBase} GROUP BY month ORDER BY month`).all(uid)
    .map(x => ({ ...x, success_rate: successRate(x.won_count, x.lost_count) }));

  const lostReasons = db.prepare(`
    SELECT COALESCE(NULLIF(TRIM(d.lost_reason), ''), 'ثبت‌نشده') AS reason, COUNT(*) AS count
    ${mineBase} AND d.stage = 'lost' GROUP BY reason ORDER BY count DESC`).all(uid);

  // آخرین گزارش‌های خودِ کارشناس — «چه خوب بود / چه بد بود» برای مرور و برنامه‌ریزی
  const reports = db.prepare(`
    SELECT sr.*, d.title AS deal_title, c.name AS customer_name
    FROM crm_stage_reports sr
    JOIN crm_deals d ON d.id = sr.deal_id
    JOIN crm_customers c ON c.id = d.customer_id
    WHERE sr.user_id = ? ORDER BY sr.id DESC LIMIT 40`).all(uid);

  const openDeals = db.prepare(`
    SELECT d.id, d.title, d.stage, d.amount, d.probability, d.expected_close, c.name AS customer_name,
           (SELECT MAX(created_at) FROM crm_stage_reports sr WHERE sr.deal_id = d.id) AS last_report_at
    ${mineBase} AND d.stage NOT IN ('won','lost')
    ORDER BY d.amount DESC LIMIT 30`).all(uid);

  res.json({ person, mine, team, monthly, lost_reasons: lostReasons, reports, open_deals: openDeals });
});

// ---------- ابزارهای تکمیلی ----------
// خروجی CSV برای مشتریان / معاملات / مناقصات — با BOM تا اکسل فارسی را درست باز کند
function csv(rows, cols) {
  const esc = (v) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const head = cols.map(c => esc(c.label)).join(',');
  const body = rows.map(row => cols.map(c => esc(c.get ? c.get(row) : row[c.key])).join(',')).join('\n');
  return '\uFEFF' + head + '\n' + body;
}

function sendCsv(res, name, text) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
  res.send(text);
}

r.get('/export/customers', (req, res) => {
  const rows = db.prepare(`
    SELECT c.*, u.full_name AS owner_name, d.name AS department_name,
      (SELECT COALESCE(SUM(amount),0) FROM crm_deals dl WHERE dl.customer_id = c.id AND dl.stage = 'won') AS won_amount
    FROM crm_customers c
    LEFT JOIN users u ON u.id = c.owner_id
    LEFT JOIN departments d ON d.id = c.department_id
    ORDER BY c.name`).all();
  sendCsv(res, 'crm-customers.csv', csv(rows, [
    { key: 'id', label: 'شناسه' }, { key: 'name', label: 'نام مشتری' },
    { key: 'status', label: 'وضعیت' }, { key: 'phone', label: 'تلفن' },
    { key: 'email', label: 'ایمیل' }, { key: 'city', label: 'شهر' },
    { key: 'industry', label: 'حوزه فعالیت' }, { key: 'source', label: 'نحوه آشنایی' },
    { key: 'economic_code', label: 'کد اقتصادی' }, { key: 'national_id', label: 'شناسه ملی' },
    { key: 'address', label: 'آدرس' }, { key: 'owner_name', label: 'کارشناس مسئول' },
    { key: 'department_name', label: 'واحد' }, { key: 'won_amount', label: 'فروش موفق (ریال)' },
    { key: 'created_at', label: 'تاریخ ثبت' },
  ]));
});

r.get('/export/deals', (req, res) => {
  const scoped = canManageAll(req.user) ? '' : 'WHERE d.owner_id = @uid';
  const rows = db.prepare(`
    SELECT d.*, c.name AS customer_name, u.full_name AS owner_name
    FROM crm_deals d JOIN crm_customers c ON c.id = d.customer_id
    LEFT JOIN users u ON u.id = d.owner_id ${scoped} ORDER BY d.id DESC`)
    .all(scoped ? { uid: req.user.id } : {});
  sendCsv(res, 'crm-deals.csv', csv(rows, [
    { key: 'id', label: 'شناسه' }, { key: 'title', label: 'عنوان' },
    { key: 'customer_name', label: 'مشتری' }, { key: 'amount', label: 'مبلغ (ریال)' },
    { key: 'stage', label: 'مرحله' }, { key: 'probability', label: 'احتمال (٪)' },
    { key: 'owner_name', label: 'کارشناس' }, { key: 'product', label: 'کالا/خدمت' },
    { key: 'lost_reason', label: 'دلیل باخت' }, { key: 'competitor', label: 'رقیب' },
    { key: 'created_at', label: 'تاریخ ثبت' }, { key: 'closed_at', label: 'تاریخ بسته‌شدن' },
  ]));
});

r.get('/export/tenders', (req, res) => {
  const scoped = canManageAll(req.user) ? '' : 'WHERE t.owner_id = @uid';
  const rows = db.prepare(`
    SELECT t.*, c.name AS customer_name, u.full_name AS owner_name
    FROM crm_tenders t LEFT JOIN crm_customers c ON c.id = t.customer_id
    LEFT JOIN users u ON u.id = t.owner_id ${scoped} ORDER BY t.id DESC`)
    .all(scoped ? { uid: req.user.id } : {});
  sendCsv(res, 'crm-tenders.csv', csv(rows, [
    { key: 'tender_no', label: 'شماره مناقصه' }, { key: 'title', label: 'عنوان' },
    { get: (t) => t.customer_name || t.organization, label: 'مناقصه‌گزار' },
    { key: 'portal', label: 'سامانه' }, { key: 'status', label: 'وضعیت' },
    { key: 'estimated_amount', label: 'برآورد کارفرما' }, { key: 'our_bid_amount', label: 'پیشنهاد ما' },
    { key: 'winner_name', label: 'برنده' }, { key: 'winner_amount', label: 'مبلغ برنده' },
    { key: 'our_rank', label: 'رتبه ما' }, { key: 'submit_deadline', label: 'مهلت ارسال' },
    { key: 'opening_at', label: 'بازگشایی' }, { key: 'lost_reason', label: 'دلیل باخت' },
    { key: 'owner_name', label: 'کارشناس' },
  ]));
});

// تشخیص مشتریِ تکراری — پیش از ثبت، مواردِ مشابه را نشان می‌دهد
r.get('/customers-duplicates', (req, res) => {
  const { name = '', phone = '', economic_code = '', national_id = '', exclude_id = '' } = req.query;
  const parts = [];
  const params = [];
  if (str(name).length >= 3) { parts.push('c.name LIKE ?'); params.push(`%${str(name)}%`); }
  if (str(phone).length >= 6) { parts.push('c.phone LIKE ?'); params.push(`%${str(phone)}%`); }
  if (str(economic_code)) { parts.push('c.economic_code = ?'); params.push(str(economic_code)); }
  if (str(national_id)) { parts.push('c.national_id = ?'); params.push(str(national_id)); }
  if (!parts.length) return res.json({ matches: [] });
  let sql = `SELECT c.id, c.name, c.phone, c.city, c.economic_code, u.full_name AS owner_name
    FROM crm_customers c LEFT JOIN users u ON u.id = c.owner_id
    WHERE (${parts.join(' OR ')})`;
  if (exclude_id) { sql += ' AND c.id != ?'; params.push(Number(exclude_id)); }
  res.json({ matches: db.prepare(sql + ' LIMIT 10').all(...params) });
});

// انتقال مالکیتِ رکوردها — وقتی کارشناسی از تیم می‌رود یا سبد فروش بازتقسیم می‌شود
r.post('/reassign', (req, res) => {
  if (!canManageAll(req.user)) return res.status(403).json({ error: 'فقط مدیرانِ CRM می‌توانند مالکیت را منتقل کنند' });
  const from = Number(req.body?.from_user_id);
  const to = Number(req.body?.to_user_id);
  if (!from || !to || from === to) return res.status(400).json({ error: 'کارشناس مبدأ و مقصد را درست انتخاب کنید' });
  if (!db.prepare('SELECT 1 FROM users WHERE id = ? AND is_active = 1').get(to)) {
    return res.status(400).json({ error: 'کارشناس مقصد فعال نیست' });
  }
  const what = req.body?.what || 'all'; // all | customers | deals | tenders — فقط رکوردهای باز منتقل می‌شوند
  const counts = { customers: 0, deals: 0, tenders: 0 };
  if (what === 'all' || what === 'customers') {
    counts.customers = db.prepare("UPDATE crm_customers SET owner_id = ?, updated_at = datetime('now') WHERE owner_id = ?").run(to, from).changes;
  }
  if (what === 'all' || what === 'deals') {
    counts.deals = db.prepare("UPDATE crm_deals SET owner_id = ? WHERE owner_id = ? AND stage NOT IN ('won','lost')").run(to, from).changes;
  }
  if (what === 'all' || what === 'tenders') {
    counts.tenders = db.prepare("UPDATE crm_tenders SET owner_id = ? WHERE owner_id = ? AND status NOT IN ('won','lost','cancelled','withdrawn')").run(to, from).changes;
  }
  const total = counts.customers + counts.deals + counts.tenders;
  if (total > 0 && to !== req.user.id) {
    notifyUsers([to], {
      type: 'info',
      title: 'رکوردهای CRM به شما واگذار شد',
      body: `${counts.customers} مشتری، ${counts.deals} معامله و ${counts.tenders} مناقصه به شما منتقل شد`,
      link: '/crm',
    });
  }
  res.json({ ok: true, ...counts, total });
});

// خلاصهٔ CRM برای داشبورد اصلی سامانه
r.get('/summary', (req, res) => {
  const all = canManageAll(req.user);
  const p = { uid: req.user.id, all: all ? 1 : 0 };
  const deals = db.prepare(`SELECT
      SUM(CASE WHEN stage NOT IN ('won','lost') THEN 1 ELSE 0 END) AS open_count,
      COALESCE(SUM(CASE WHEN stage NOT IN ('won','lost') THEN amount ELSE 0 END), 0) AS open_amount,
      SUM(CASE WHEN stage = 'won' THEN 1 ELSE 0 END) AS won_count,
      COALESCE(SUM(CASE WHEN stage = 'won' THEN amount ELSE 0 END), 0) AS won_amount,
      SUM(CASE WHEN stage = 'lost' THEN 1 ELSE 0 END) AS lost_count
    FROM crm_deals WHERE (@all = 1 OR owner_id = @uid)`).get(p);
  const overdue = db.prepare(`SELECT COUNT(*) c FROM crm_activities a
    WHERE a.follow_up_done = 0 AND a.follow_up_at IS NOT NULL AND a.follow_up_at != ''
      AND a.follow_up_at <= datetime('now') AND (@all = 1 OR a.user_id = @uid)`).get(p).c;
  const tenders = db.prepare(`SELECT COUNT(*) c FROM crm_tenders
    WHERE status NOT IN ('won','lost','cancelled','withdrawn') AND (@all = 1 OR owner_id = @uid)`).get(p).c;
  const tenderSoon = db.prepare(`SELECT COUNT(*) c FROM crm_tenders
    WHERE status NOT IN ('won','lost','cancelled','withdrawn') AND submit_deadline IS NOT NULL
      AND submit_deadline <= datetime('now', '+7 days') AND (@all = 1 OR owner_id = @uid)`).get(p).c;
  const closed = Number(deals.won_count) + Number(deals.lost_count);
  res.json({
    ...deals,
    success_rate: closed > 0 ? Math.round((deals.won_count / closed) * 1000) / 10 : null,
    overdue_follow_ups: overdue,
    open_tenders: tenders,
    tenders_due_soon: tenderSoon,
    customers: db.prepare('SELECT COUNT(*) c FROM crm_customers').get().c,
  });
});

// ---------- دستیار هوشمند (آمادهٔ اتصال به LLM) ----------
// این endpoint همهٔ چیزی را که یک مدل زبانی برای تحلیل لازم دارد در یک بستهٔ
// ساخت‌یافته و فشرده برمی‌گرداند: آمار، دلایل باخت، و متنِ گزارش‌های کارشناسان.
// فعلاً هیچ فراخوانیِ بیرونی انجام نمی‌شود (سامانه آفلاین است)؛ بعداً کافی است
// همین payload به مدل داده شود و پاسخش در جدول crm_insights ذخیره گردد.
r.get('/insights/payload', (req, res) => {
  const scope = canManageAll(req.user) && req.query.scope !== 'me' ? 'team' : 'user';
  const uid = req.user.id;
  // @mine = 1 یعنی «فقط معاملات خودم»؛ پارامترها همیشه پاس داده می‌شوند
  const ownerClause = 'AND (@mine = 0 OR d.owner_id = @uid)';
  const p = { uid, mine: scope === 'user' ? 1 : 0 };

  const totals = db.prepare(`SELECT ${AGG}
    FROM crm_deals d JOIN crm_customers c ON c.id = d.customer_id WHERE 1=1 ${ownerClause}`).get(p);
  totals.success_rate = successRate(totals.won_count, totals.lost_count);

  const stages = db.prepare(`SELECT d.stage, COUNT(*) AS count, COALESCE(SUM(d.amount),0) AS amount
    FROM crm_deals d WHERE 1=1 ${ownerClause} GROUP BY d.stage`).all(p);

  const lost = db.prepare(`SELECT COALESCE(NULLIF(TRIM(d.lost_reason),''),'ثبت‌نشده') AS reason,
      COUNT(*) AS count, COALESCE(SUM(d.amount),0) AS amount
    FROM crm_deals d WHERE d.stage = 'lost' ${ownerClause} GROUP BY reason ORDER BY count DESC`).all(p);

  const sources = db.prepare(`SELECT COALESCE(NULLIF(TRIM(c.source),''),'نامشخص') AS source,
      COUNT(*) AS total, SUM(CASE WHEN d.stage='won' THEN 1 ELSE 0 END) AS won
    FROM crm_deals d JOIN crm_customers c ON c.id = d.customer_id WHERE 1=1 ${ownerClause}
    GROUP BY source`).all(p).map(x => ({ ...x, success_rate: successRate(x.won, x.total - x.won) }));

  const monthly = db.prepare(`SELECT strftime('%Y-%m', d.created_at) AS month,
      COUNT(*) AS total, SUM(CASE WHEN d.stage='won' THEN 1 ELSE 0 END) AS won,
      SUM(CASE WHEN d.stage='lost' THEN 1 ELSE 0 END) AS lost,
      COALESCE(SUM(CASE WHEN d.stage='won' THEN d.amount ELSE 0 END),0) AS won_amount
    FROM crm_deals d WHERE 1=1 ${ownerClause} GROUP BY month ORDER BY month`).all(p);

  // متنِ گزارش‌های کارشناسان — «چه خوب بود / چه بد بود / موانع» خوراکِ اصلیِ تحلیل است
  const reports = db.prepare(`
    SELECT CASE WHEN sr.tender_id IS NOT NULL THEN 'tender' ELSE 'deal' END AS kind,
           sr.stage, sr.from_stage, sr.summary, sr.went_well, sr.went_wrong, sr.blockers,
           sr.next_action, sr.confidence, sr.created_at,
           COALESCE(d.title, t.title) AS subject_title,
           COALESCE(d.amount, t.our_bid_amount) AS amount,
           COALESCE(d.lost_reason, t.lost_reason) AS lost_reason,
           COALESCE(c.name, tc.name, t.organization) AS customer_name,
           COALESCE(c.industry, tc.industry) AS industry,
           COALESCE(c.source, tc.source) AS source,
           u.full_name AS user_name
    FROM crm_stage_reports sr
    LEFT JOIN crm_deals d ON d.id = sr.deal_id
    LEFT JOIN crm_tenders t ON t.id = sr.tender_id
    LEFT JOIN crm_customers c ON c.id = d.customer_id
    LEFT JOIN crm_customers tc ON tc.id = t.customer_id
    LEFT JOIN users u ON u.id = sr.user_id
    WHERE (@mine = 0 OR sr.user_id = @uid)
    ORDER BY sr.id DESC LIMIT 200`).all(p);

  // [مناقصه] فروش از راه مناقصه منطق و آموختنی‌های خودش را دارد
  const tenders = db.prepare(`SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN t.status = 'won' THEN 1 ELSE 0 END) AS won,
      SUM(CASE WHEN t.status = 'lost' THEN 1 ELSE 0 END) AS lost,
      SUM(CASE WHEN t.status = 'withdrawn' THEN 1 ELSE 0 END) AS withdrawn,
      COALESCE(SUM(CASE WHEN t.status = 'won' THEN t.our_bid_amount ELSE 0 END), 0) AS won_amount,
      COALESCE(AVG(CASE WHEN t.status = 'lost' AND t.winner_amount > 0 AND t.our_bid_amount > 0
        THEN (t.our_bid_amount - t.winner_amount) * 100.0 / t.winner_amount END), 0) AS avg_price_gap_pct
    FROM crm_tenders t WHERE (@mine = 0 OR t.owner_id = @uid)`).get(p);
  tenders.success_rate = successRate(tenders.won, tenders.lost);
  tenders.avg_price_gap_pct = Math.round(Number(tenders.avg_price_gap_pct) * 10) / 10;

  const tenderLost = db.prepare(`SELECT COALESCE(NULLIF(TRIM(t.lost_reason),''),'ثبت‌نشده') AS reason,
      COUNT(*) AS count FROM crm_tenders t
    WHERE t.status = 'lost' AND (@mine = 0 OR t.owner_id = @uid)
    GROUP BY reason ORDER BY count DESC`).all(p);

  const rivals = db.prepare(`SELECT cc.name, COUNT(*) AS times, SUM(cc.is_winner) AS wins
    FROM crm_tender_competitors cc JOIN crm_tenders t ON t.id = cc.tender_id
    WHERE (@mine = 0 OR t.owner_id = @uid)
    GROUP BY cc.name ORDER BY wins DESC, times DESC LIMIT 10`).all(p);

  // [محصولات] چه چیزی می‌فروشیم، با چه حاشیه‌ای و با چه کیفیتی
  const products = db.prepare(`
    SELECT p.name, p.category, p.stock, p.reorder_point, p.list_price, p.cost,
      COALESCE(SUM(CASE WHEN d.stage = 'won' THEN i.qty ELSE 0 END), 0) AS sold_qty,
      COALESCE(SUM(CASE WHEN d.stage = 'won' THEN i.qty * i.unit_price * (1 - i.discount_pct / 100.0) ELSE 0 END), 0) AS sold_amount,
      COUNT(DISTINCT CASE WHEN d.stage = 'won' THEN d.id END) AS won_deals,
      COUNT(DISTINCT CASE WHEN d.stage = 'lost' THEN d.id END) AS lost_deals,
      (SELECT COUNT(*) FROM crm_tickets tk WHERE tk.product_id = p.id AND tk.is_quality_issue = 1) AS quality_issues
    FROM crm_products p
    LEFT JOIN crm_deal_items i ON i.product_id = p.id
    LEFT JOIN crm_deals d ON d.id = i.deal_id
    WHERE p.is_active = 1 GROUP BY p.id ORDER BY sold_amount DESC LIMIT 50`).all()
    .map(x => ({ ...x, success_rate: successRate(x.won_deals, x.lost_deals),
      margin_pct: x.list_price > 0 && x.cost > 0
        ? Math.round(((x.list_price - x.cost) / x.list_price) * 1000) / 10 : null,
      low_stock: x.reorder_point > 0 && x.stock <= x.reorder_point }));

  // [تمرکز فروش] اهدافِ دوره و پیشرفتشان
  const focus = db.prepare(`SELECT id, title, description, period_from, period_to,
      target_amount, target_count, segment, priority, categories, product_ids
    FROM crm_focus WHERE is_active = 1`).all()
    .map(f => ({ ...f, product_ids: undefined, categories: f.categories || '' }));

  // [پشتیبانی و کیفیت] تجربهٔ پس از فروش، مستقیماً روی وفاداری و فروش مجدد اثر دارد
  const support = db.prepare(`SELECT COUNT(*) AS total,
      SUM(CASE WHEN status IN ('new','in_progress','waiting_customer') THEN 1 ELSE 0 END) AS open_count,
      SUM(CASE WHEN is_quality_issue = 1 THEN 1 ELSE 0 END) AS quality_count,
      SUM(CASE WHEN severity = 'critical' THEN 1 ELSE 0 END) AS critical_count,
      COALESCE(SUM(cost), 0) AS total_cost,
      COALESCE(AVG(CASE WHEN first_response_at IS NOT NULL
        THEN (julianday(first_response_at) - julianday(created_at)) * 24 END), 0) AS avg_response_hours,
      COALESCE(AVG(CASE WHEN resolved_at IS NOT NULL
        THEN (julianday(resolved_at) - julianday(created_at)) * 24 END), 0) AS avg_resolve_hours
    FROM crm_tickets`).get();
  support.avg_response_hours = Math.round(Number(support.avg_response_hours) * 10) / 10;
  support.avg_resolve_hours = Math.round(Number(support.avg_resolve_hours) * 10) / 10;
  support.root_causes = db.prepare(`SELECT COALESCE(NULLIF(TRIM(root_cause),''),'ثبت‌نشده') AS cause,
      COUNT(*) AS count FROM crm_tickets WHERE is_quality_issue = 1
    GROUP BY cause ORDER BY count DESC LIMIT 10`).all();
  support.by_type = db.prepare('SELECT type, COUNT(*) AS count FROM crm_tickets GROUP BY type').all();

  // [رضایت مشتری] NPS و CSAT + متنِ بازخوردها
  const fbAgg = db.prepare(`SELECT COUNT(*) AS total, COALESCE(AVG(csat),0) AS avg_csat,
      SUM(CASE WHEN score >= 9 THEN 1 ELSE 0 END) AS promoters,
      SUM(CASE WHEN score BETWEEN 7 AND 8 THEN 1 ELSE 0 END) AS passives,
      SUM(CASE WHEN score <= 6 AND score IS NOT NULL THEN 1 ELSE 0 END) AS detractors
    FROM crm_feedback`).get();
  const npsBase = Number(fbAgg.promoters) + Number(fbAgg.passives) + Number(fbAgg.detractors);
  const feedback = {
    ...fbAgg,
    avg_csat: Math.round(Number(fbAgg.avg_csat) * 10) / 10,
    nps: npsBase > 0 ? Math.round(((fbAgg.promoters - fbAgg.detractors) / npsBase) * 100) : null,
    // متنِ بازخوردها خوراکِ مستقیمِ تحلیل کیفی است
    comments: db.prepare(`SELECT f.kind, f.score, f.csat, f.comment, c.name AS customer_name, p.name AS product_name
      FROM crm_feedback f
      LEFT JOIN crm_customers c ON c.id = f.customer_id
      LEFT JOIN crm_products p ON p.id = f.product_id
      WHERE f.comment != '' ORDER BY f.id DESC LIMIT 80`).all(),
  };

  // [پیگیری هوشمند] مشتریانی که قاعده‌های سامانه می‌گویند باید سراغشان رفت —
  // مدل می‌تواند اولویت‌ها را بازچینی کند و متنِ پیام پیشنهاد بدهد
  const attention = db.prepare(`
    SELECT c.name, c.status, c.industry, c.city,
      (SELECT MAX(a.happened_at) FROM crm_activities a WHERE a.customer_id = c.id) AS last_contact,
      (SELECT COUNT(*) FROM crm_deals d WHERE d.customer_id = c.id AND d.stage NOT IN ('won','lost')) AS open_deals,
      (SELECT COALESCE(SUM(d.amount),0) FROM crm_deals d WHERE d.customer_id = c.id AND d.stage = 'won') AS won_amount,
      (SELECT COUNT(*) FROM crm_tickets t WHERE t.customer_id = c.id AND t.status IN ('new','in_progress','waiting_customer')) AS open_tickets,
      (SELECT MIN(f.csat) FROM crm_feedback f WHERE f.customer_id = c.id) AS worst_csat,
      (SELECT COUNT(*) FROM crm_activities a WHERE a.customer_id = c.id
        AND a.follow_up_done = 0 AND a.follow_up_at IS NOT NULL AND a.follow_up_at <= datetime('now')) AS overdue_followups
    FROM crm_customers c
    WHERE (@mine = 0 OR c.owner_id = @uid)
    ORDER BY overdue_followups DESC, open_tickets DESC LIMIT 60`).all(p);

  const people = scope === 'team'
    ? db.prepare(`SELECT COALESCE(u.full_name,'بدون مسئول') AS owner_name, ${AGG}
        FROM crm_deals d JOIN crm_customers c ON c.id = d.customer_id
        LEFT JOIN users u ON u.id = d.owner_id GROUP BY d.owner_id`).all()
        .map(x => ({ owner_name: x.owner_name, total: x.total, won: x.won_count, lost: x.lost_count,
          won_amount: x.won_amount, avg_cycle_days: Math.round(x.avg_cycle_days * 10) / 10,
          success_rate: successRate(x.won_count, x.lost_count) }))
    : [];

  res.json({
    generated_at: new Date().toISOString(),
    scope,
    // راهنمای متنیِ آماده برای دادن به مدل — تا خروجی همیشه یکدست باشد
    instruction: 'بر اساس دادهٔ زیر تحلیل کن: نقاط قوت، ضعف‌های تکرارشونده، دلایل اصلی باخت، '
      + 'و سه تا پنج پیشنهادِ عملی و قابل‌اجرا برای بالابردن نرخ موفقیت در دورهٔ بعد. '
      + 'فروش مستقیم (deals) و فروش از راه مناقصه (tenders) را جدا تحلیل کن؛ در مناقصات به '
      + 'میانگین فاصلهٔ قیمتی با برنده (avg_price_gap_pct) و رقبای پرتکرار (rivals) توجه ویژه کن. '
      + 'همچنین: (۱) محصولات (products) را از نظر حاشیهٔ سود، نرخ موفقیت، موجودی و ایرادهای کیفی بررسی کن '
      + 'و بگو روی کدام محصول باید تمرکز کرد؛ (۲) اهداف تمرکز فروش (sales_focus) را با فروش واقعی بسنج؛ '
      + '(۳) پشتیبانی و کیفیت (support) و رضایت مشتری (feedback) را تحلیل کن و بگو کدام ایراد کیفی '
      + 'بیشترین اثر را روی از‌دست‌رفتن فروش دارد؛ (۴) برای مشتریانِ نیازمند پیگیری '
      + '(customers_needing_attention) بگو به چه ترتیبی و با چه پیامی سراغشان بروند. '
      + 'پاسخ را فارسی، کوتاه و دسته‌بندی‌شده بنویس.',
    totals, stages, lost_reasons: lost, by_source: sources, monthly,
    tenders, tender_lost_reasons: tenderLost, rivals,
    products, sales_focus: focus, support, feedback,
    customers_needing_attention: attention,
    people, stage_reports: reports,
  });
});

// تحلیل‌های ذخیره‌شده (فعلاً دستی؛ بعداً خروجی LLM اینجا می‌نشیند)
r.get('/insights', (req, res) => {
  const all = canManageAll(req.user);
  const rows = db.prepare(`
    SELECT i.*, u.full_name AS created_by_name, t.full_name AS target_name
    FROM crm_insights i
    LEFT JOIN users u ON u.id = i.created_by
    LEFT JOIN users t ON t.id = i.target_user_id
    WHERE (@all = 1 OR i.scope = 'team' OR i.target_user_id = @uid)
    ORDER BY i.id DESC LIMIT 50`).all({ uid: req.user.id, all: all ? 1 : 0 });
  res.json({ insights: rows.map(i => ({ ...i, payload: parseJson(i.payload, {}) })) });
});

r.post('/insights', (req, res) => {
  const b = req.body || {};
  if (!str(b.body)) return res.status(400).json({ error: 'متن تحلیل الزامی است' });
  const scope = b.scope === 'user' ? 'user' : 'team';
  if (scope === 'team' && !canManageAll(req.user)) {
    return res.status(403).json({ error: 'ثبت تحلیل تیمی فقط برای مدیران است' });
  }
  const info = db.prepare(`INSERT INTO crm_insights
    (scope, target_user_id, period_from, period_to, source, model, title, body, payload, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(scope, scope === 'user' ? (b.target_user_id || req.user.id) : null,
      str(b.period_from), str(b.period_to), b.source === 'llm' ? 'llm' : 'manual',
      str(b.model), str(b.title) || 'تحلیل عملکرد فروش', str(b.body),
      JSON.stringify(b.payload && typeof b.payload === 'object' ? b.payload : {}), req.user.id);
  res.json({ id: info.lastInsertRowid });
});

r.delete('/insights/:id', (req, res) => {
  const i = db.prepare('SELECT * FROM crm_insights WHERE id = ?').get(req.params.id);
  if (!i) return res.status(404).json({ error: 'تحلیل یافت نشد' });
  if (i.created_by !== req.user.id && !canManageAll(req.user)) return res.status(403).json({ error: 'دسترسی غیرمجاز' });
  db.prepare('DELETE FROM crm_insights WHERE id = ?').run(i.id);
  res.json({ ok: true });
});

export default r;
