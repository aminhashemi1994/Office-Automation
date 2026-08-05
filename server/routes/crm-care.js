// ============================================================================
//  محصولات و موجودی · تمرکز فروش · پشتیبانی و خدمات پس از فروش · بازخورد
//  مشتری · پیامک · پیگیری هوشمند
//  زیرمجموعهٔ روتر CRM — همان کنترل دسترسی (req.crmManage) را به ارث می‌برد.
// ============================================================================
import { Router } from 'express';
import db from '../db.js';
import { notifyUsers } from '../notify.js';
import { normalizePhone, isMobile, renderTemplate, sendOne, smsConfig } from '../sms.js';

const r = Router();

const num = (v) => (v === undefined || v === null || v === '' ? 0 : Number(v) || 0);
const str = (v) => String(v ?? '').trim();
const parseJson = (s, f) => { try { return JSON.parse(s); } catch { return f; } };
const setting = (k, f = '') => db.prepare('SELECT value FROM app_settings WHERE key = ?').get(k)?.value ?? f;

// ============================================================================
//  موجودی محصولات
// ============================================================================
// موجودی از جمعِ گردشِ انبار محاسبه و در ستون stock نگه داشته می‌شود
function recalcStock(productId) {
  const sum = db.prepare('SELECT COALESCE(SUM(qty), 0) s FROM crm_stock_moves WHERE product_id = ?').get(productId).s;
  db.prepare('UPDATE crm_products SET stock = ? WHERE id = ?').run(sum, productId);
  return sum;
}

r.get('/products/:id/stock', (req, res) => {
  const p = db.prepare('SELECT * FROM crm_products WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'کالا یافت نشد' });
  const moves = db.prepare(`
    SELECT m.*, u.full_name AS user_name, d.title AS deal_title
    FROM crm_stock_moves m
    LEFT JOIN users u ON u.id = m.user_id
    LEFT JOIN crm_deals d ON d.id = m.deal_id
    WHERE m.product_id = ? ORDER BY m.id DESC LIMIT 200`).all(p.id);
  res.json({ product: p, moves, stock: p.stock });
});

r.post('/products/:id/stock', (req, res) => {
  if (!req.crmManage) return res.status(403).json({ error: 'فقط مدیرانِ CRM می‌توانند موجودی را تغییر دهند' });
  const p = db.prepare('SELECT * FROM crm_products WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'کالا یافت نشد' });
  const b = req.body || {};
  const qty = num(b.qty);
  if (!qty) return res.status(400).json({ error: 'مقدار ورود/خروج را وارد کنید' });
  db.prepare(`INSERT INTO crm_stock_moves (product_id, qty, reason, deal_id, note, user_id)
    VALUES (?, ?, ?, ?, ?, ?)`)
    .run(p.id, qty, str(b.reason) || 'manual', b.deal_id || null, str(b.note), req.user.id);
  const stock = recalcStock(p.id);

  // افت زیر نقطهٔ سفارش → اطلاع به مدیران CRM
  if (p.reorder_point > 0 && stock <= p.reorder_point && qty < 0) {
    const managers = db.prepare("SELECT id FROM users WHERE role = 'admin' AND is_active = 1").all().map(u => u.id);
    notifyUsers(managers, {
      type: 'reminder',
      title: `📦 موجودی «${p.name}» به نقطهٔ سفارش رسید`,
      body: `موجودی فعلی ${stock.toLocaleString('fa-IR')} ${p.unit} — نقطهٔ سفارش ${Number(p.reorder_point).toLocaleString('fa-IR')}`,
      link: '/crm',
    });
  }
  res.json({ ok: true, stock });
});

// کالاهایی که موجودی‌شان به نقطهٔ سفارش رسیده
r.get('/stock-alerts', (req, res) => {
  const rows = db.prepare(`SELECT * FROM crm_products
    WHERE is_active = 1 AND reorder_point > 0 AND stock <= reorder_point ORDER BY stock`).all();
  res.json({ products: rows });
});

// پرفروش‌ترین محصولات — از روی اقلامِ معاملاتِ برنده
r.get('/product-performance', (req, res) => {
  const rows = db.prepare(`
    SELECT p.id, p.name, p.category, p.unit, p.stock, p.list_price, p.cost,
      COALESCE(SUM(CASE WHEN d.stage = 'won' THEN i.qty ELSE 0 END), 0) AS sold_qty,
      COALESCE(SUM(CASE WHEN d.stage = 'won' THEN i.qty * i.unit_price * (1 - i.discount_pct / 100.0) ELSE 0 END), 0) AS sold_amount,
      COUNT(DISTINCT CASE WHEN d.stage = 'won' THEN d.id END) AS won_deals,
      COUNT(DISTINCT CASE WHEN d.stage = 'lost' THEN d.id END) AS lost_deals,
      COUNT(DISTINCT CASE WHEN d.stage NOT IN ('won','lost') THEN d.id END) AS open_deals
    FROM crm_products p
    LEFT JOIN crm_deal_items i ON i.product_id = p.id
    LEFT JOIN crm_deals d ON d.id = i.deal_id
    GROUP BY p.id ORDER BY sold_amount DESC`).all()
    .map(x => ({
      ...x,
      // حاشیهٔ سودِ فهرست — راهنمای قیمت‌گذاری
      margin_pct: x.list_price > 0 && x.cost > 0
        ? Math.round(((x.list_price - x.cost) / x.list_price) * 1000) / 10 : null,
      success_rate: (x.won_deals + x.lost_deals) > 0
        ? Math.round((x.won_deals / (x.won_deals + x.lost_deals)) * 1000) / 10 : null,
    }));
  // شکایات کیفی هر محصول — کنارِ فروش، تصویر کامل می‌دهد
  const quality = db.prepare(`SELECT product_id, COUNT(*) AS issues FROM crm_tickets
    WHERE is_quality_issue = 1 AND product_id IS NOT NULL GROUP BY product_id`).all();
  const qmap = Object.fromEntries(quality.map(q => [q.product_id, q.issues]));
  res.json({ products: rows.map(p => ({ ...p, quality_issues: qmap[p.id] || 0 })) });
});

// ============================================================================
//  تمرکز فروش
// ============================================================================
// پیشرفتِ یک تمرکز از روی معاملاتِ دورهٔ آن روی محصولات/دسته‌های هدف
function focusProgress(f) {
  const productIds = parseJson(f.product_ids, []);
  const cats = String(f.categories || '').split('،').map(x => x.trim()).filter(Boolean);
  const conds = [];
  const params = { from: f.period_from || '0000-01-01', to: (f.period_to || '9999-12-31') + ' 23:59:59' };
  if (productIds.length) conds.push(`i.product_id IN (${productIds.map(Number).filter(Boolean).join(',') || '0'})`);
  if (cats.length) {
    cats.forEach((c, i) => { params[`c${i}`] = c; });
    conds.push(`p.category IN (${cats.map((_, i) => `@c${i}`).join(',')})`);
  }
  // بدون محصول/دستهٔ مشخص، همهٔ معاملاتِ دوره شمرده می‌شوند
  const scope = conds.length ? `AND (${conds.join(' OR ')})` : '';
  const row = db.prepare(`
    SELECT COUNT(DISTINCT d.id) AS deals,
      COALESCE(SUM(CASE WHEN d.stage = 'won' THEN i.qty * i.unit_price * (1 - i.discount_pct / 100.0) ELSE 0 END), 0) AS won_amount,
      COUNT(DISTINCT CASE WHEN d.stage = 'won' THEN d.id END) AS won_deals
    FROM crm_deals d
    LEFT JOIN crm_deal_items i ON i.deal_id = d.id
    LEFT JOIN crm_products p ON p.id = i.product_id
    WHERE d.created_at >= @from AND d.created_at <= @to ${scope}`).get(params);
  // اگر معامله قلم نداشته باشد، مبلغ خودِ معامله ملاک است
  const plain = (!productIds.length && !cats.length)
    ? db.prepare(`SELECT COALESCE(SUM(CASE WHEN stage = 'won' THEN amount ELSE 0 END), 0) AS won_amount,
        COUNT(CASE WHEN stage = 'won' THEN 1 END) AS won_deals, COUNT(*) AS deals
        FROM crm_deals WHERE created_at >= @from AND created_at <= @to`).get(params)
    : null;
  const wonAmount = plain ? Math.max(Number(row.won_amount), Number(plain.won_amount)) : Number(row.won_amount);
  const wonDeals = plain ? Math.max(Number(row.won_deals), Number(plain.won_deals)) : Number(row.won_deals);
  const target = Number(f.target_amount) || 0;
  return {
    won_amount: wonAmount,
    won_deals: wonDeals,
    deals: plain ? Number(plain.deals) : Number(row.deals),
    progress_pct: target > 0 ? Math.round((wonAmount / target) * 1000) / 10 : null,
    count_progress_pct: f.target_count > 0 ? Math.round((wonDeals / f.target_count) * 1000) / 10 : null,
    days_left: f.period_to
      ? Math.ceil((new Date(`${f.period_to}T23:59:59`).getTime() - Date.now()) / 86400000) : null,
  };
}

r.get('/focus', (req, res) => {
  const rows = db.prepare(`
    SELECT f.*, u.full_name AS owner_name, d.name AS department_name
    FROM crm_focus f
    LEFT JOIN users u ON u.id = f.owner_id
    LEFT JOIN departments d ON d.id = f.department_id
    ORDER BY f.is_active DESC, f.id DESC`).all();
  const focus = rows.map(f => {
    const members = db.prepare(`SELECT m.*, u.full_name FROM crm_focus_members m
      JOIN users u ON u.id = m.user_id WHERE m.focus_id = ?`).all(f.id);
    const ids = parseJson(f.product_ids, []);
    const products = ids.length
      ? db.prepare(`SELECT id, name FROM crm_products WHERE id IN (${ids.map(Number).filter(Boolean).join(',') || '0'})`).all()
      : [];
    return { ...f, product_ids: ids, products, members, ...focusProgress(f) };
  });
  res.json({ focus, can_manage: req.crmManage });
});

r.post('/focus', (req, res) => {
  if (!req.crmManage) return res.status(403).json({ error: 'فقط مدیرانِ CRM می‌توانند تمرکز فروش تعریف کنند' });
  const b = req.body || {};
  if (!str(b.title)) return res.status(400).json({ error: 'عنوان تمرکز فروش الزامی است' });
  const info = db.prepare(`INSERT INTO crm_focus
    (title, description, period_from, period_to, target_amount, target_count,
     product_ids, categories, segment, priority, owner_id, department_id, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(str(b.title), str(b.description), str(b.period_from) || null, str(b.period_to) || null,
      num(b.target_amount), num(b.target_count),
      JSON.stringify(Array.isArray(b.product_ids) ? b.product_ids.map(Number).filter(Boolean) : []),
      str(b.categories), str(b.segment), str(b.priority) || 'normal',
      b.owner_id || req.user.id, b.department_id || null, req.user.id);
  const id = info.lastInsertRowid;
  const ins = db.prepare('INSERT OR REPLACE INTO crm_focus_members (focus_id, user_id, target_amount) VALUES (?, ?, ?)');
  for (const m of (Array.isArray(b.members) ? b.members : [])) {
    if (m?.user_id) ins.run(id, Number(m.user_id), num(m.target_amount));
  }
  // تیم باید بداند تمرکزِ این دوره چیست
  const targets = (Array.isArray(b.members) ? b.members : []).map(m => Number(m.user_id)).filter(Boolean);
  if (targets.length) {
    notifyUsers(targets, {
      type: 'info',
      title: `🎯 تمرکز فروش جدید: ${str(b.title)}`,
      body: str(b.description).slice(0, 150) || 'سهمیهٔ شما در صفحهٔ CRM ← تمرکز فروش',
      link: '/crm',
    });
  }
  res.json({ id });
});

r.put('/focus/:id', (req, res) => {
  if (!req.crmManage) return res.status(403).json({ error: 'دسترسی غیرمجاز' });
  const f = db.prepare('SELECT * FROM crm_focus WHERE id = ?').get(req.params.id);
  if (!f) return res.status(404).json({ error: 'تمرکز فروش یافت نشد' });
  const b = req.body || {};
  const pick = (k, fn = str) => (b[k] !== undefined ? fn(b[k]) : f[k]);
  db.prepare(`UPDATE crm_focus SET title = ?, description = ?, period_from = ?, period_to = ?,
    target_amount = ?, target_count = ?, product_ids = ?, categories = ?, segment = ?,
    priority = ?, is_active = ?, owner_id = ?, department_id = ? WHERE id = ?`)
    .run(pick('title'), pick('description'),
      b.period_from !== undefined ? (str(b.period_from) || null) : f.period_from,
      b.period_to !== undefined ? (str(b.period_to) || null) : f.period_to,
      pick('target_amount', num), pick('target_count', num),
      b.product_ids !== undefined
        ? JSON.stringify(Array.isArray(b.product_ids) ? b.product_ids.map(Number).filter(Boolean) : [])
        : f.product_ids,
      pick('categories'), pick('segment'), pick('priority'),
      b.is_active !== undefined ? (b.is_active ? 1 : 0) : f.is_active,
      b.owner_id !== undefined ? (b.owner_id || null) : f.owner_id,
      b.department_id !== undefined ? (b.department_id || null) : f.department_id, f.id);
  if (b.members !== undefined) {
    db.prepare('DELETE FROM crm_focus_members WHERE focus_id = ?').run(f.id);
    const ins = db.prepare('INSERT OR REPLACE INTO crm_focus_members (focus_id, user_id, target_amount) VALUES (?, ?, ?)');
    for (const m of (Array.isArray(b.members) ? b.members : [])) {
      if (m?.user_id) ins.run(f.id, Number(m.user_id), num(m.target_amount));
    }
  }
  res.json({ ok: true });
});

r.delete('/focus/:id', (req, res) => {
  if (!req.crmManage) return res.status(403).json({ error: 'دسترسی غیرمجاز' });
  db.prepare('DELETE FROM crm_focus WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ============================================================================
//  پشتیبانی و خدمات پس از فروش
// ============================================================================
const TICKET_COLS = ['subject', 'body', 'type', 'severity', 'channel', 'resolution', 'root_cause', 'batch_no'];
const TICKET_OPEN = ['new', 'in_progress', 'waiting_customer'];

// تاریخِ ذخیره‌شده ممکن است «YYYY-MM-DD HH:MM:SS» (خروجی SQLite، به وقت UTC)
// یا ISO با Z (خروجی JS) باشد؛ این تابع هر دو را درست به میلی‌ثانیه تبدیل می‌کند.
function ts(v) {
  if (!v) return null;
  const s = String(v);
  const iso = /[TZ]/.test(s) ? s : s.replace(' ', 'T') + 'Z';
  const ms = new Date(iso).getTime();
  return Number.isNaN(ms) ? null : ms;
}

function ticketRow(t) {
  const openMs = ts(t.created_at);
  return {
    ...t,
    attachments: parseJson(t.attachments, []),
    is_open: TICKET_OPEN.includes(t.status),
    // چند ساعت طول کشید تا اولین پاسخ داده شود / چقدر باز مانده است
    response_hours: ts(t.first_response_at) !== null && openMs !== null
      ? Math.round(((ts(t.first_response_at) - openMs) / 3600000) * 10) / 10 : null,
    resolve_hours: ts(t.resolved_at) !== null && openMs !== null
      ? Math.round(((ts(t.resolved_at) - openMs) / 3600000) * 10) / 10 : null,
    age_hours: openMs === null ? 0 : Math.round(((Date.now() - openMs) / 3600000) * 10) / 10,
    is_overdue: !!t.due_at && TICKET_OPEN.includes(t.status) && (ts(t.due_at) ?? Infinity) < Date.now(),
  };
}

r.get('/tickets', (req, res) => {
  const { q = '', status = '', type = '', severity = '', customer_id = '', assignee_id = '', open_only = '' } = req.query;
  const where = [];
  const params = [];
  if (q) { where.push('(t.subject LIKE ? OR t.body LIKE ? OR c.name LIKE ?)'); params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  if (status) { where.push('t.status = ?'); params.push(String(status)); }
  if (type) { where.push('t.type = ?'); params.push(String(type)); }
  if (severity) { where.push('t.severity = ?'); params.push(String(severity)); }
  if (customer_id) { where.push('t.customer_id = ?'); params.push(Number(customer_id)); }
  if (assignee_id) { where.push('t.assignee_id = ?'); params.push(Number(assignee_id)); }
  if (open_only === '1') where.push(`t.status IN ('${TICKET_OPEN.join("','")}')`);
  if (!req.crmManage) { where.push('(t.assignee_id = ? OR t.opened_by = ?)'); params.push(req.user.id, req.user.id); }
  const rows = db.prepare(`
    SELECT t.*, c.name AS customer_name, p.name AS product_name,
           u.full_name AS assignee_name, o.full_name AS opened_by_name
    FROM crm_tickets t
    LEFT JOIN crm_customers c ON c.id = t.customer_id
    LEFT JOIN crm_products p ON p.id = t.product_id
    LEFT JOIN users u ON u.id = t.assignee_id
    LEFT JOIN users o ON o.id = t.opened_by
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY t.status IN ('resolved','closed'), t.severity = 'critical' DESC, t.id DESC
    LIMIT 400`).all(...params);
  res.json({ tickets: rows.map(ticketRow), can_manage: req.crmManage });
});

r.get('/tickets/:id', (req, res) => {
  const t = db.prepare(`
    SELECT t.*, c.name AS customer_name, c.phone AS customer_phone, p.name AS product_name,
           u.full_name AS assignee_name, o.full_name AS opened_by_name,
           ct.first_name AS contact_first, ct.last_name AS contact_last, ct.mobile AS contact_mobile
    FROM crm_tickets t
    LEFT JOIN crm_customers c ON c.id = t.customer_id
    LEFT JOIN crm_products p ON p.id = t.product_id
    LEFT JOIN users u ON u.id = t.assignee_id
    LEFT JOIN users o ON o.id = t.opened_by
    LEFT JOIN crm_contacts ct ON ct.id = t.contact_id
    WHERE t.id = ?`).get(req.params.id);
  if (!t) return res.status(404).json({ error: 'تیکت یافت نشد' });
  const messages = db.prepare(`
    SELECT m.*, u.full_name AS user_name FROM crm_ticket_messages m
    LEFT JOIN users u ON u.id = m.user_id WHERE m.ticket_id = ? ORDER BY m.id`).all(t.id)
    .map(m => ({ ...m, attachments: parseJson(m.attachments, []) }));
  const feedback = db.prepare('SELECT * FROM crm_feedback WHERE ticket_id = ? ORDER BY id DESC').all(t.id);
  const sms = db.prepare('SELECT * FROM crm_sms WHERE ticket_id = ? ORDER BY id DESC').all(t.id);
  res.json({ ticket: { ...ticketRow(t), messages, feedback, sms }, can_manage: req.crmManage });
});

r.post('/tickets', (req, res) => {
  const b = req.body || {};
  if (!str(b.subject)) return res.status(400).json({ error: 'موضوع تیکت الزامی است' });
  if (!b.customer_id) return res.status(400).json({ error: 'مشتری را انتخاب کنید' });
  const info = db.prepare(`INSERT INTO crm_tickets
    (${TICKET_COLS.join(', ')}, customer_id, contact_id, deal_id, product_id, status,
     assignee_id, opened_by, due_at, is_quality_issue, cost, attachments)
    VALUES (${TICKET_COLS.map(() => '?').join(', ')}, ?, ?, ?, ?, 'new', ?, ?, ?, ?, ?, ?)`)
    .run(...TICKET_COLS.map(k => str(b[k])),
      b.customer_id, b.contact_id || null, b.deal_id || null, b.product_id || null,
      b.assignee_id || req.user.id, req.user.id, str(b.due_at) || null,
      b.is_quality_issue ? 1 : 0, num(b.cost),
      JSON.stringify(Array.isArray(b.attachments) ? b.attachments.map(Number).filter(Boolean) : []));
  const id = info.lastInsertRowid;
  const assignee = b.assignee_id || req.user.id;
  if (assignee !== req.user.id) {
    notifyUsers([assignee], {
      type: 'info',
      title: `🎧 تیکت پشتیبانی جدید: ${str(b.subject)}`,
      body: str(b.body).slice(0, 150),
      link: '/crm',
    });
  }
  res.json({ id });
});

r.put('/tickets/:id', (req, res) => {
  const t = db.prepare('SELECT * FROM crm_tickets WHERE id = ?').get(req.params.id);
  if (!t) return res.status(404).json({ error: 'تیکت یافت نشد' });
  if (t.assignee_id !== req.user.id && t.opened_by !== req.user.id && !req.crmManage) {
    return res.status(403).json({ error: 'فقط مسئولِ تیکت یا مدیر می‌تواند آن را تغییر دهد' });
  }
  const b = req.body || {};
  const status = b.status !== undefined ? str(b.status) : t.status;
  const nowResolved = ['resolved', 'closed'].includes(status) && !['resolved', 'closed'].includes(t.status);
  db.prepare(`UPDATE crm_tickets SET ${TICKET_COLS.map(k => `${k} = ?`).join(', ')},
    status = ?, severity = ?, assignee_id = ?, product_id = ?, deal_id = ?, contact_id = ?,
    due_at = ?, is_quality_issue = ?, cost = ?, attachments = ?,
    resolved_at = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(...TICKET_COLS.map(k => (b[k] !== undefined ? str(b[k]) : t[k])),
      status, b.severity !== undefined ? str(b.severity) : t.severity,
      b.assignee_id !== undefined ? (b.assignee_id || null) : t.assignee_id,
      b.product_id !== undefined ? (b.product_id || null) : t.product_id,
      b.deal_id !== undefined ? (b.deal_id || null) : t.deal_id,
      b.contact_id !== undefined ? (b.contact_id || null) : t.contact_id,
      b.due_at !== undefined ? (str(b.due_at) || null) : t.due_at,
      b.is_quality_issue !== undefined ? (b.is_quality_issue ? 1 : 0) : t.is_quality_issue,
      b.cost !== undefined ? num(b.cost) : t.cost,
      b.attachments !== undefined
        ? JSON.stringify(Array.isArray(b.attachments) ? b.attachments.map(Number).filter(Boolean) : [])
        : t.attachments,
      nowResolved ? new Date().toISOString().slice(0, 19).replace('T', ' ') : t.resolved_at, t.id);
  res.json({ ok: true });
});

r.delete('/tickets/:id', (req, res) => {
  if (!req.crmManage) return res.status(403).json({ error: 'دسترسی غیرمجاز' });
  db.prepare('DELETE FROM crm_tickets WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// پیام/یادداشت روی تیکت — اولین پاسخِ غیرداخلی، زمانِ «اولین پاسخ» را ثبت می‌کند
r.post('/tickets/:id/messages', (req, res) => {
  const t = db.prepare('SELECT * FROM crm_tickets WHERE id = ?').get(req.params.id);
  if (!t) return res.status(404).json({ error: 'تیکت یافت نشد' });
  const b = req.body || {};
  if (!str(b.body)) return res.status(400).json({ error: 'متن پیام الزامی است' });
  const info = db.prepare(`INSERT INTO crm_ticket_messages (ticket_id, body, is_internal, channel, user_id, attachments)
    VALUES (?, ?, ?, ?, ?, ?)`)
    .run(t.id, str(b.body), b.is_internal ? 1 : 0, str(b.channel) || 'note', req.user.id,
      JSON.stringify(Array.isArray(b.attachments) ? b.attachments.map(Number).filter(Boolean) : []));
  if (!b.is_internal && !t.first_response_at) {
    db.prepare("UPDATE crm_tickets SET first_response_at = datetime('now') WHERE id = ?").run(t.id);
  }
  db.prepare("UPDATE crm_tickets SET updated_at = datetime('now') WHERE id = ?").run(t.id);
  res.json({ id: info.lastInsertRowid });
});

// گزارش پشتیبانی و کیفیت
r.get('/support-reports', (req, res) => {
  const { from = '', to = '' } = req.query;
  const where = [];
  const params = [];
  if (from) { where.push('t.created_at >= ?'); params.push(String(from)); }
  if (to) { where.push('t.created_at <= ?'); params.push(String(to) + ' 23:59:59'); }
  const clause = where.length ? 'WHERE ' + where.join(' AND ') : '';

  const summary = db.prepare(`SELECT COUNT(*) AS total,
      SUM(CASE WHEN t.status IN ('new','in_progress','waiting_customer') THEN 1 ELSE 0 END) AS open_count,
      SUM(CASE WHEN t.status IN ('resolved','closed') THEN 1 ELSE 0 END) AS closed_count,
      SUM(CASE WHEN t.is_quality_issue = 1 THEN 1 ELSE 0 END) AS quality_count,
      SUM(CASE WHEN t.severity = 'critical' THEN 1 ELSE 0 END) AS critical_count,
      COALESCE(SUM(t.cost), 0) AS total_cost,
      COALESCE(AVG(CASE WHEN t.first_response_at IS NOT NULL
        THEN (julianday(t.first_response_at) - julianday(t.created_at)) * 24 END), 0) AS avg_response_hours,
      COALESCE(AVG(CASE WHEN t.resolved_at IS NOT NULL
        THEN (julianday(t.resolved_at) - julianday(t.created_at)) * 24 END), 0) AS avg_resolve_hours
    FROM crm_tickets t ${clause}`).get(...params);

  const byType = db.prepare(`SELECT t.type, COUNT(*) AS count FROM crm_tickets t ${clause} GROUP BY t.type`).all(...params);
  const byStatus = db.prepare(`SELECT t.status, COUNT(*) AS count FROM crm_tickets t ${clause} GROUP BY t.status`).all(...params);
  const bySeverity = db.prepare(`SELECT t.severity, COUNT(*) AS count FROM crm_tickets t ${clause} GROUP BY t.severity`).all(...params);
  // ریشهٔ مشکلات کیفی — مهم‌ترین ورودیِ بهبود محصول
  const rootCauses = db.prepare(`SELECT COALESCE(NULLIF(TRIM(t.root_cause), ''), 'ثبت‌نشده') AS cause,
      COUNT(*) AS count, COALESCE(SUM(t.cost), 0) AS cost
    FROM crm_tickets t ${clause} ${clause ? 'AND' : 'WHERE'} t.is_quality_issue = 1
    GROUP BY cause ORDER BY count DESC`).all(...params);
  const byProduct = db.prepare(`SELECT COALESCE(p.name, 'بدون محصول') AS product_name,
      COUNT(*) AS count, SUM(CASE WHEN t.is_quality_issue = 1 THEN 1 ELSE 0 END) AS quality_count,
      COALESCE(SUM(t.cost), 0) AS cost
    FROM crm_tickets t LEFT JOIN crm_products p ON p.id = t.product_id ${clause}
    GROUP BY t.product_id ORDER BY count DESC LIMIT 15`).all(...params);
  const monthly = db.prepare(`SELECT strftime('%Y-%m', t.created_at) AS month, COUNT(*) AS count,
      SUM(CASE WHEN t.is_quality_issue = 1 THEN 1 ELSE 0 END) AS quality_count
    FROM crm_tickets t ${clause} GROUP BY month ORDER BY month`).all(...params);

  // رضایت مشتری
  const fb = db.prepare(`SELECT
      COUNT(*) AS total,
      COALESCE(AVG(csat), 0) AS avg_csat,
      COALESCE(AVG(score), 0) AS avg_nps,
      SUM(CASE WHEN score >= 9 THEN 1 ELSE 0 END) AS promoters,
      SUM(CASE WHEN score BETWEEN 7 AND 8 THEN 1 ELSE 0 END) AS passives,
      SUM(CASE WHEN score <= 6 AND score IS NOT NULL THEN 1 ELSE 0 END) AS detractors
    FROM crm_feedback`).get();
  const npsBase = Number(fb.promoters) + Number(fb.passives) + Number(fb.detractors);
  fb.nps = npsBase > 0 ? Math.round(((fb.promoters - fb.detractors) / npsBase) * 100) : null;
  fb.avg_csat = Math.round(Number(fb.avg_csat) * 10) / 10;

  res.json({
    summary, by_type: byType, by_status: byStatus, by_severity: bySeverity,
    root_causes: rootCauses, by_product: byProduct, monthly, feedback: fb,
  });
});

// ============================================================================
//  بازخورد و رضایت مشتری
// ============================================================================
r.get('/feedback', (req, res) => {
  const { customer_id = '', kind = '' } = req.query;
  const where = [];
  const params = [];
  if (customer_id) { where.push('f.customer_id = ?'); params.push(Number(customer_id)); }
  if (kind) { where.push('f.kind = ?'); params.push(String(kind)); }
  const rows = db.prepare(`
    SELECT f.*, c.name AS customer_name, p.name AS product_name, u.full_name AS user_name
    FROM crm_feedback f
    LEFT JOIN crm_customers c ON c.id = f.customer_id
    LEFT JOIN crm_products p ON p.id = f.product_id
    LEFT JOIN users u ON u.id = f.user_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY f.id DESC LIMIT 300`).all(...params);
  res.json({ feedback: rows });
});

r.post('/feedback', (req, res) => {
  const b = req.body || {};
  if (!b.customer_id) return res.status(400).json({ error: 'مشتری را انتخاب کنید' });
  if (!str(b.comment) && b.score === undefined && b.csat === undefined) {
    return res.status(400).json({ error: 'امتیاز یا متن بازخورد را وارد کنید' });
  }
  const info = db.prepare(`INSERT INTO crm_feedback
    (customer_id, contact_id, deal_id, ticket_id, product_id, kind, score, csat, comment, source, user_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(b.customer_id, b.contact_id || null, b.deal_id || null, b.ticket_id || null, b.product_id || null,
      str(b.kind) || 'csat',
      b.score === undefined || b.score === '' ? null : Math.max(0, Math.min(10, num(b.score))),
      b.csat === undefined || b.csat === '' ? null : Math.max(1, Math.min(5, num(b.csat))),
      str(b.comment), str(b.source) || 'phone', req.user.id);

  // بازخوردِ منفی نباید گم شود — به مدیران و کارشناسِ مشتری اطلاع بده
  const negative = (b.score !== undefined && num(b.score) <= 6) || (b.csat !== undefined && num(b.csat) <= 2)
    || str(b.kind) === 'complaint';
  if (negative) {
    const owner = db.prepare('SELECT owner_id, name FROM crm_customers WHERE id = ?').get(b.customer_id);
    const admins = db.prepare("SELECT id FROM users WHERE role = 'admin' AND is_active = 1").all().map(u => u.id);
    const targets = [...new Set([owner?.owner_id, ...admins].filter(Boolean))].filter(id => id !== req.user.id);
    if (targets.length) {
      notifyUsers(targets, {
        type: 'info',
        title: `⚠️ بازخورد منفی از ${owner?.name || 'مشتری'}`,
        body: str(b.comment).slice(0, 160) || 'امتیاز پایین ثبت شد — نیازمند رسیدگی',
        link: '/crm',
      });
    }
  }
  res.json({ id: info.lastInsertRowid });
});

r.delete('/feedback/:id', (req, res) => {
  const f = db.prepare('SELECT * FROM crm_feedback WHERE id = ?').get(req.params.id);
  if (!f) return res.status(404).json({ error: 'بازخورد یافت نشد' });
  if (f.user_id !== req.user.id && !req.crmManage) return res.status(403).json({ error: 'دسترسی غیرمجاز' });
  db.prepare('DELETE FROM crm_feedback WHERE id = ?').run(f.id);
  res.json({ ok: true });
});

// ============================================================================
//  پیامک
// ============================================================================
r.get('/sms', (req, res) => {
  const { customer_id = '', status = '' } = req.query;
  const where = [];
  const params = [];
  if (customer_id) { where.push('s.customer_id = ?'); params.push(Number(customer_id)); }
  if (status) { where.push('s.status = ?'); params.push(String(status)); }
  if (!req.crmManage) { where.push('s.user_id = ?'); params.push(req.user.id); }
  const rows = db.prepare(`
    SELECT s.*, c.name AS customer_name, u.full_name AS user_name
    FROM crm_sms s
    LEFT JOIN crm_customers c ON c.id = s.customer_id
    LEFT JOIN users u ON u.id = s.user_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY s.id DESC LIMIT 200`).all(...params);
  const cfg = smsConfig();
  res.json({
    messages: rows,
    templates: db.prepare('SELECT * FROM crm_sms_templates ORDER BY kind, name').all(),
    config: { enabled: cfg.enabled, provider: cfg.provider, sender: cfg.sender, configured: !!(cfg.apiUrl && cfg.apiKey) },
  });
});

// ارسال (یا صف‌کردن) پیامک — اگر درگاه تنظیم نشده باشد «شبیه‌سازی» می‌شود
r.post('/sms', async (req, res) => {
  const b = req.body || {};
  const body = str(b.body);
  if (!body) return res.status(400).json({ error: 'متن پیامک الزامی است' });
  const targets = Array.isArray(b.targets) && b.targets.length
    ? b.targets
    : [{ phone: b.phone, customer_id: b.customer_id, contact_id: b.contact_id, vars: b.vars }];
  const results = [];
  for (const t of targets) {
    const phone = normalizePhone(t.phone);
    if (!isMobile(phone)) { results.push({ phone: t.phone, ok: false, error: 'شمارهٔ موبایل نامعتبر' }); continue; }
    const text = renderTemplate(body, t.vars || {});
    const info = db.prepare(`INSERT INTO crm_sms
      (customer_id, contact_id, ticket_id, phone, body, status, scheduled_at, user_id)
      VALUES (?, ?, ?, ?, ?, 'queued', ?, ?)`)
      .run(t.customer_id || b.customer_id || null, t.contact_id || null, b.ticket_id || null,
        phone, text, str(b.scheduled_at) || null, req.user.id);
    const row = db.prepare('SELECT * FROM crm_sms WHERE id = ?').get(info.lastInsertRowid);
    // زمان‌بندی‌شده‌ها را موتور یادآوری بعداً می‌فرستد
    if (row.scheduled_at) { results.push({ phone, ok: true, scheduled: true }); continue; }
    const out = await sendOne(row);
    results.push({ phone, ...out });
  }
  const cfg = smsConfig();
  res.json({ results, simulated: !cfg.enabled || !cfg.apiUrl || !cfg.apiKey });
});

r.post('/sms-templates', (req, res) => {
  if (!req.crmManage) return res.status(403).json({ error: 'دسترسی غیرمجاز' });
  const b = req.body || {};
  if (!str(b.name) || !str(b.body)) return res.status(400).json({ error: 'نام و متن قالب الزامی است' });
  const info = db.prepare('INSERT INTO crm_sms_templates (name, body, kind) VALUES (?, ?, ?)')
    .run(str(b.name), str(b.body), str(b.kind) || 'followup');
  res.json({ id: info.lastInsertRowid });
});

r.delete('/sms-templates/:id', (req, res) => {
  if (!req.crmManage) return res.status(403).json({ error: 'دسترسی غیرمجاز' });
  db.prepare('DELETE FROM crm_sms_templates WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ============================================================================
//  پیگیری هوشمند مشتریان
//  امروز قاعده‌محور است (رها‌شده، بازخورد منفی، تیکت باز، فرصت خواب‌رفته…).
//  همین خروجی در بستهٔ دستیار هوشمند هم می‌رود تا مدل بتواند اولویت‌ها را
//  بازچینی کند و پیامِ پیشنهادی بنویسد.
// ============================================================================
r.get('/smart-followups', (req, res) => {
  const staleDays = Number(setting('crm_stale_customer_days', '45')) || 45;
  const all = req.crmManage;
  const p = { uid: req.user.id, all: all ? 1 : 0 };

  const rows = db.prepare(`
    SELECT c.id, c.name, c.status, c.phone, c.city, c.industry, c.owner_id,
           u.full_name AS owner_name,
           (SELECT MAX(a.happened_at) FROM crm_activities a WHERE a.customer_id = c.id) AS last_contact,
           (SELECT COUNT(*) FROM crm_deals d WHERE d.customer_id = c.id AND d.stage NOT IN ('won','lost')) AS open_deals,
           (SELECT COALESCE(SUM(d.amount),0) FROM crm_deals d WHERE d.customer_id = c.id AND d.stage NOT IN ('won','lost')) AS open_amount,
           (SELECT COALESCE(SUM(d.amount),0) FROM crm_deals d WHERE d.customer_id = c.id AND d.stage = 'won') AS won_amount,
           (SELECT COUNT(*) FROM crm_tickets t WHERE t.customer_id = c.id AND t.status IN ('new','in_progress','waiting_customer')) AS open_tickets,
           (SELECT MIN(f.csat) FROM crm_feedback f WHERE f.customer_id = c.id) AS worst_csat,
           (SELECT MIN(f.score) FROM crm_feedback f WHERE f.customer_id = c.id) AS worst_nps,
           (SELECT COUNT(*) FROM crm_activities a WHERE a.customer_id = c.id
             AND a.follow_up_done = 0 AND a.follow_up_at IS NOT NULL AND a.follow_up_at <= datetime('now')) AS overdue_followups
    FROM crm_customers c
    LEFT JOIN users u ON u.id = c.owner_id
    WHERE (@all = 1 OR c.owner_id = @uid)`).all(p);

  const now = Date.now();
  const scored = rows.map(c => {
    const reasons = [];
    let score = 0;
    const days = ts(c.last_contact) !== null
      ? Math.floor((now - ts(c.last_contact)) / 86400000) : null;

    if (c.overdue_followups > 0) { score += 40; reasons.push(`${c.overdue_followups.toLocaleString('fa-IR')} پیگیری عقب‌افتاده`); }
    if (c.open_tickets > 0) { score += 30; reasons.push(`${c.open_tickets.toLocaleString('fa-IR')} تیکت پشتیبانی باز`); }
    if (c.worst_csat !== null && c.worst_csat <= 2) { score += 35; reasons.push('بازخورد منفی ثبت شده'); }
    if (c.worst_nps !== null && c.worst_nps <= 6) { score += 25; reasons.push('امتیاز NPS پایین'); }
    if (days === null && c.status !== 'lead') { score += 20; reasons.push('هیچ تماسی ثبت نشده'); }
    if (days !== null && days > staleDays) {
      score += Math.min(30, Math.floor(days / staleDays) * 15);
      reasons.push(`${days.toLocaleString('fa-IR')} روز بدون تماس`);
    }
    if (c.open_deals > 0 && days !== null && days > 14) {
      score += 25; reasons.push('معاملهٔ باز دارد ولی پیگیری نشده');
    }
    if (c.won_amount > 0 && days !== null && days > 90) {
      score += 20; reasons.push('مشتری سابق — فرصت فروش مجدد');
    }
    // ارزش مشتری، اولویت را بالا می‌برد
    if (c.won_amount > 0) score += Math.min(15, Math.log10(c.won_amount) * 1.5);

    return {
      ...c, days_since_contact: days, reasons,
      priority_score: Math.round(score),
      priority: score >= 60 ? 'high' : score >= 30 ? 'medium' : 'low',
      // پیشنهادِ سادهٔ اقدام — بعداً LLM می‌تواند جایش را بگیرد
      suggested_action: c.open_tickets > 0 ? 'ابتدا تیکت پشتیبانی باز را ببندید'
        : (c.worst_csat !== null && c.worst_csat <= 2) ? 'تماس عذرخواهی و رفع نارضایتی'
        : c.overdue_followups > 0 ? 'پیگیریِ عقب‌افتاده را همین امروز انجام دهید'
        : c.open_deals > 0 ? 'وضعیت معاملهٔ باز را از مشتری بپرسید'
        : c.won_amount > 0 ? 'تماس فروش مجدد / معرفی محصول جدید'
        : 'تماس آشنایی و نیازسنجی',
    };
  }).filter(c => c.priority_score > 0)
    .sort((a, b) => b.priority_score - a.priority_score)
    .slice(0, 100);

  res.json({ customers: scored, stale_days: staleDays, scoped: !all });
});

export default r;
