// ============================================================================
//  مناقصات، کالا/خدمات و اقلامِ معامله
//  این فایل زیرمجموعهٔ روتر CRM است و همان کنترل دسترسی را به ارث می‌برد.
//
//  چرا مناقصه جدا از «معامله» است؟ چون منطقش فرق دارد: فراخوان و مهلت‌های سخت،
//  پاکات الف/ب/ج، تضمین شرکت در مناقصه، بازگشایی و رقبا. با برنده‌شدن، مناقصه
//  به یک «معاملهٔ برنده» تبدیل می‌شود تا در آمار فروش هم دیده شود.
// ============================================================================
import { Router } from 'express';
import db from '../db.js';
import { notifyUsers } from '../notify.js';

const r = Router();

const num = (v) => (v === undefined || v === null || v === '' ? 0 : Number(v) || 0);
const str = (v) => String(v ?? '').trim();
const parseJson = (s, f) => { try { return JSON.parse(s); } catch { return f; } };
const setting = (k, f = '') => db.prepare('SELECT value FROM app_settings WHERE key = ?').get(k)?.value ?? f;

// وضعیت‌های مناقصه به ترتیبِ چرخهٔ عمر
export const TENDER_STATUSES = [
  'identified', 'reviewing', 'docs', 'preparing', 'submitted', 'opened',
  'won', 'lost', 'cancelled', 'withdrawn',
];
const CLOSED = ['won', 'lost', 'cancelled', 'withdrawn'];
const STATUS_FA = {
  identified: 'شناسایی‌شده', reviewing: 'در حال بررسی', docs: 'اسناد دریافت شد',
  preparing: 'آماده‌سازی پیشنهاد', submitted: 'پیشنهاد ارسال شد', opened: 'بازگشایی شد',
  won: 'برنده', lost: 'بازنده', cancelled: 'لغو شده', withdrawn: 'انصراف دادیم',
};

// ============================================================================
//  کالا و خدمات
// ============================================================================
r.get('/products', (req, res) => {
  const { q = '', active = '' } = req.query;
  const where = [];
  const params = [];
  if (q) { where.push('(name LIKE ? OR code LIKE ? OR category LIKE ?)'); params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  if (active === '1') where.push('is_active = 1');
  const products = db.prepare(`SELECT * FROM crm_products
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY category, name LIMIT 500`).all(...params);
  res.json({ products });
});

r.post('/products', (req, res) => {
  if (!req.crmManage) return res.status(403).json({ error: 'فقط مدیرانِ CRM می‌توانند کالا تعریف کنند' });
  const b = req.body || {};
  if (!str(b.name)) return res.status(400).json({ error: 'نام کالا/خدمت الزامی است' });
  const info = db.prepare(`INSERT INTO crm_products (code, name, category, unit, list_price, cost, note)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(str(b.code), str(b.name), str(b.category), str(b.unit) || 'عدد', num(b.list_price), num(b.cost), str(b.note));
  res.json({ id: info.lastInsertRowid });
});

r.put('/products/:id', (req, res) => {
  if (!req.crmManage) return res.status(403).json({ error: 'دسترسی غیرمجاز' });
  const p = db.prepare('SELECT * FROM crm_products WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'کالا یافت نشد' });
  const b = req.body || {};
  const pick = (k, f = str) => (b[k] !== undefined ? f(b[k]) : p[k]);
  db.prepare(`UPDATE crm_products SET code = ?, name = ?, category = ?, unit = ?,
    list_price = ?, cost = ?, is_active = ?, note = ? WHERE id = ?`)
    .run(pick('code'), pick('name'), pick('category'), pick('unit'),
      pick('list_price', num), pick('cost', num),
      b.is_active !== undefined ? (b.is_active ? 1 : 0) : p.is_active, pick('note'), p.id);
  res.json({ ok: true });
});

r.delete('/products/:id', (req, res) => {
  if (!req.crmManage) return res.status(403).json({ error: 'دسترسی غیرمجاز' });
  db.prepare('DELETE FROM crm_products WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ============================================================================
//  اقلامِ یک معامله (پیش‌فاکتور)
//  مبلغِ معامله از روی اقلام محاسبه و در crm_deals.amount ذخیره می‌شود تا همهٔ
//  گزارش‌های موجود بدون تغییر کار کنند.
// ============================================================================
export function itemTotals(dealId) {
  const items = db.prepare('SELECT * FROM crm_deal_items WHERE deal_id = ? ORDER BY sort_order, id').all(dealId);
  let net = 0, tax = 0, cost = 0, gross = 0;
  for (const it of items) {
    const line = num(it.qty) * num(it.unit_price);
    const afterDiscount = line * (1 - num(it.discount_pct) / 100);
    gross += line;
    net += afterDiscount;
    tax += afterDiscount * (num(it.tax_pct) / 100);
    cost += num(it.qty) * num(it.cost);
  }
  const total = net + tax;
  return {
    items, gross, net, tax, total, cost,
    profit: net - cost,
    margin_pct: net > 0 ? Math.round(((net - cost) / net) * 1000) / 10 : null,
  };
}

// مبلغ معامله را از روی اقلامش هم‌ترازِ دوباره می‌کند
export function syncDealAmount(dealId) {
  const t = itemTotals(dealId);
  if (t.items.length) {
    db.prepare("UPDATE crm_deals SET amount = ?, updated_at = datetime('now') WHERE id = ?").run(t.total, dealId);
  }
  return t;
}

r.get('/deals/:id/items', (req, res) => {
  const t = itemTotals(Number(req.params.id));
  res.json({ ...t });
});

r.put('/deals/:id/items', (req, res) => {
  const d = db.prepare('SELECT * FROM crm_deals WHERE id = ?').get(req.params.id);
  if (!d) return res.status(404).json({ error: 'معامله یافت نشد' });
  if (d.owner_id !== req.user.id && d.created_by !== req.user.id && !req.crmManage) {
    return res.status(403).json({ error: 'فقط مسئولِ معامله یا مدیر می‌تواند اقلام را تغییر دهد' });
  }
  const rows = Array.isArray(req.body?.items) ? req.body.items : [];
  db.prepare('DELETE FROM crm_deal_items WHERE deal_id = ?').run(d.id);
  const ins = db.prepare(`INSERT INTO crm_deal_items
    (deal_id, product_id, title, unit, qty, unit_price, discount_pct, tax_pct, cost, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  rows.forEach((it, i) => {
    if (!str(it.title)) return;
    ins.run(d.id, it.product_id || null, str(it.title), str(it.unit) || 'عدد',
      num(it.qty) || 1, num(it.unit_price), num(it.discount_pct), num(it.tax_pct), num(it.cost), i);
  });
  res.json({ ok: true, ...syncDealAmount(d.id) });
});

// ============================================================================
//  مناقصات
// ============================================================================
const TENDER_COLS = ['tender_no', 'title', 'organization', 'portal', 'portal_url', 'method', 'subject',
  'guarantee_type', 'guarantee_no', 'winner_name', 'result_note', 'lost_reason', 'note'];
const TENDER_NUMS = ['estimated_amount', 'our_bid_amount', 'guarantee_amount', 'winner_amount', 'our_rank'];
const TENDER_DATES = ['published_at', 'docs_deadline', 'submit_deadline', 'opening_at', 'guarantee_expires_at'];

// روزهای باقی‌مانده تا یک تاریخ (منفی = گذشته)
function daysUntil(dateStr) {
  if (!dateStr) return null;
  const d = new Date(String(dateStr).length <= 10 ? `${dateStr}T23:59:59` : dateStr);
  if (Number.isNaN(d.getTime())) return null;
  return Math.ceil((d.getTime() - Date.now()) / (24 * 3600 * 1000));
}

function tenderRow(t) {
  const checklist = db.prepare('SELECT envelope, required, done FROM crm_tender_checklist WHERE tender_id = ?').all(t.id);
  const requiredItems = checklist.filter(c => c.required);
  return {
    ...t,
    extra: parseJson(t.extra, {}),
    attachments: parseJson(t.attachments, []),
    status_label: STATUS_FA[t.status] || t.status,
    is_closed: CLOSED.includes(t.status),
    days_to_submit: daysUntil(t.submit_deadline),
    days_to_docs: daysUntil(t.docs_deadline),
    days_to_guarantee: t.guarantee_released ? null : daysUntil(t.guarantee_expires_at),
    checklist_total: requiredItems.length,
    checklist_done: requiredItems.filter(c => c.done).length,
    competitors_count: db.prepare('SELECT COUNT(*) c FROM crm_tender_competitors WHERE tender_id = ?').get(t.id).c,
    // فاصلهٔ قیمتیِ ما با برنده — مهم‌ترین عددِ یادگیری از یک مناقصهٔ باخته
    price_gap_pct: (t.winner_amount > 0 && t.our_bid_amount > 0)
      ? Math.round(((t.our_bid_amount - t.winner_amount) / t.winner_amount) * 1000) / 10 : null,
  };
}

r.get('/tenders', (req, res) => {
  const { q = '', status = '', owner_id = '', portal = '', open_only = '' } = req.query;
  const where = [];
  const params = [];
  if (q) { where.push('(t.title LIKE ? OR t.tender_no LIKE ? OR t.organization LIKE ? OR c.name LIKE ?)'); params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`); }
  if (status) { where.push('t.status = ?'); params.push(String(status)); }
  if (portal) { where.push('t.portal = ?'); params.push(String(portal)); }
  if (owner_id) { where.push('t.owner_id = ?'); params.push(Number(owner_id)); }
  if (open_only === '1') where.push(`t.status NOT IN ('${CLOSED.join("','")}')`);
  if (!req.crmManage) { where.push('t.owner_id = ?'); params.push(req.user.id); }
  const rows = db.prepare(`
    SELECT t.*, c.name AS customer_name, u.full_name AS owner_name, dep.name AS department_name
    FROM crm_tenders t
    LEFT JOIN crm_customers c ON c.id = t.customer_id
    LEFT JOIN users u ON u.id = t.owner_id
    LEFT JOIN departments dep ON dep.id = t.department_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY t.status IN ('${CLOSED.join("','")}'), t.submit_deadline IS NULL, t.submit_deadline, t.id DESC
    LIMIT 500`).all(...params);
  res.json({ tenders: rows.map(tenderRow), can_manage: req.crmManage, statuses: STATUS_FA });
});

r.get('/tenders/:id', (req, res) => {
  const t = db.prepare(`
    SELECT t.*, c.name AS customer_name, u.full_name AS owner_name, dep.name AS department_name
    FROM crm_tenders t
    LEFT JOIN crm_customers c ON c.id = t.customer_id
    LEFT JOIN users u ON u.id = t.owner_id
    LEFT JOIN departments dep ON dep.id = t.department_id
    WHERE t.id = ?`).get(req.params.id);
  if (!t) return res.status(404).json({ error: 'مناقصه یافت نشد' });
  if (!req.crmManage && t.owner_id !== req.user.id) {
    return res.status(403).json({ error: 'این مناقصه به شما واگذار نشده است' });
  }
  const checklist = db.prepare('SELECT * FROM crm_tender_checklist WHERE tender_id = ? ORDER BY envelope, sort_order, id').all(t.id);
  const competitors = db.prepare('SELECT * FROM crm_tender_competitors WHERE tender_id = ? ORDER BY rank, amount').all(t.id);
  const reports = db.prepare(`
    SELECT sr.*, u.full_name AS user_name FROM crm_stage_reports sr
    LEFT JOIN users u ON u.id = sr.user_id
    WHERE sr.tender_id = ? ORDER BY sr.id`).all(t.id);
  res.json({ tender: { ...tenderRow(t), checklist, competitors, reports }, can_manage: req.crmManage });
});

r.post('/tenders', (req, res) => {
  const b = req.body || {};
  if (!str(b.title)) return res.status(400).json({ error: 'عنوان مناقصه الزامی است' });
  if (!b.customer_id && !str(b.organization)) {
    return res.status(400).json({ error: 'دستگاه مناقصه‌گزار را مشخص کنید' });
  }
  const status = TENDER_STATUSES.includes(b.status) ? b.status : 'identified';
  const info = db.prepare(`INSERT INTO crm_tenders
    (${TENDER_COLS.join(', ')}, ${TENDER_NUMS.join(', ')}, ${TENDER_DATES.join(', ')},
     status, customer_id, owner_id, department_id, attachments, extra, created_by)
    VALUES (${[...TENDER_COLS, ...TENDER_NUMS, ...TENDER_DATES].map(() => '?').join(', ')}, ?, ?, ?, ?, ?, ?, ?)`)
    .run(
      ...TENDER_COLS.map(k => str(b[k])),
      ...TENDER_NUMS.map(k => num(b[k])),
      ...TENDER_DATES.map(k => str(b[k]) || null),
      status, b.customer_id || null, b.owner_id || req.user.id,
      b.department_id || req.user.department_id || null,
      JSON.stringify(Array.isArray(b.attachments) ? b.attachments.map(Number).filter(Boolean) : []),
      JSON.stringify(b.extra && typeof b.extra === 'object' ? b.extra : {}), req.user.id);
  const id = info.lastInsertRowid;

  // چک‌لیستِ پیش‌فرضِ پاکات از تنظیمات سازمان — هر خط: «پاکت|عنوان»
  const ins = db.prepare('INSERT INTO crm_tender_checklist (tender_id, envelope, title, sort_order) VALUES (?, ?, ?, ?)');
  String(setting('crm_tender_checklist', '')).split('\n').map(x => x.trim()).filter(Boolean)
    .forEach((line, i) => {
      const [env, title] = line.split('|').map(x => (x || '').trim());
      const key = { 'الف': 'a', 'ب': 'b', 'ج': 'c' }[env] || (['a', 'b', 'c'].includes(env) ? env : 'b');
      if (title) ins.run(id, key, title, i);
    });

  db.prepare(`INSERT INTO crm_stage_reports (tender_id, customer_id, from_stage, stage, summary, next_action, user_id)
    VALUES (?, ?, '', ?, ?, ?, ?)`)
    .run(id, b.customer_id || null, status,
      str(b.stage_report?.summary) || 'مناقصه در سامانه ثبت شد', str(b.stage_report?.next_action), req.user.id);
  res.json({ id });
});

r.put('/tenders/:id', (req, res) => {
  const t = db.prepare('SELECT * FROM crm_tenders WHERE id = ?').get(req.params.id);
  if (!t) return res.status(404).json({ error: 'مناقصه یافت نشد' });
  if (t.owner_id !== req.user.id && t.created_by !== req.user.id && !req.crmManage) {
    return res.status(403).json({ error: 'فقط مسئولِ مناقصه یا مدیر می‌تواند آن را ویرایش کند' });
  }
  const b = req.body || {};
  const status = b.status !== undefined
    ? (TENDER_STATUSES.includes(b.status) ? b.status : t.status) : t.status;

  // ثبتِ برنده به‌عنوان رقیبِ برنده هم نگهداری می‌شود تا تحلیل رقابتی کامل بماند
  if (status === 'lost' && str(b.winner_name) && str(b.winner_name) !== t.winner_name) {
    db.prepare(`INSERT INTO crm_tender_competitors (tender_id, name, amount, rank, is_winner)
      VALUES (?, ?, ?, 1, 1)`).run(t.id, str(b.winner_name), num(b.winner_amount));
  }

  db.prepare(`UPDATE crm_tenders SET
    ${TENDER_COLS.map(k => `${k} = ?`).join(', ')},
    ${TENDER_NUMS.map(k => `${k} = ?`).join(', ')},
    ${TENDER_DATES.map(k => `${k} = ?`).join(', ')},
    status = ?, customer_id = ?, owner_id = ?, department_id = ?,
    guarantee_released = ?, attachments = ?, extra = ?, updated_at = datetime('now')
    WHERE id = ?`)
    .run(
      ...TENDER_COLS.map(k => (b[k] !== undefined ? str(b[k]) : t[k])),
      ...TENDER_NUMS.map(k => (b[k] !== undefined ? num(b[k]) : t[k])),
      ...TENDER_DATES.map(k => (b[k] !== undefined ? (str(b[k]) || null) : t[k])),
      status,
      b.customer_id !== undefined ? (b.customer_id || null) : t.customer_id,
      b.owner_id !== undefined ? (b.owner_id || null) : t.owner_id,
      b.department_id !== undefined ? (b.department_id || null) : t.department_id,
      b.guarantee_released !== undefined ? (b.guarantee_released ? 1 : 0) : t.guarantee_released,
      b.attachments !== undefined
        ? JSON.stringify(Array.isArray(b.attachments) ? b.attachments.map(Number).filter(Boolean) : [])
        : t.attachments,
      b.extra !== undefined ? JSON.stringify(b.extra || {}) : t.extra,
      t.id);

  // با هر تغییرِ وضعیت، گزارشِ مرحله ثبت می‌شود (همان منطقِ معاملات)
  if (status !== t.status) {
    const rep = b.stage_report || {};
    db.prepare(`INSERT INTO crm_stage_reports
      (tender_id, customer_id, from_stage, stage, summary, went_well, went_wrong, blockers, next_action, confidence, user_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(t.id, t.customer_id, t.status, status,
        str(rep.summary), str(rep.went_well), str(rep.went_wrong), str(rep.blockers), str(rep.next_action),
        Math.max(0, Math.min(100, num(rep.confidence))), req.user.id);

    // برنده شدیم → معاملهٔ برنده بساز تا در آمار فروش دیده شود
    if (status === 'won' && !t.deal_id) {
      const amount = num(b.our_bid_amount) || t.our_bid_amount;
      const info = db.prepare(`INSERT INTO crm_deals
        (customer_id, title, amount, stage, probability, product, note, owner_id, created_by, closed_at, tender_id)
        VALUES (?, ?, ?, 'won', 100, ?, ?, ?, ?, datetime('now'), ?)`)
        .run(t.customer_id, `مناقصه: ${t.title}`, amount, str(t.subject),
          `برنده مناقصه شماره ${t.tender_no || t.id}`, t.owner_id || req.user.id, req.user.id, t.id);
      db.prepare('UPDATE crm_tenders SET deal_id = ? WHERE id = ?').run(info.lastInsertRowid, t.id);
    }
    const targets = new Set([t.owner_id, t.created_by].filter(Boolean));
    targets.delete(req.user.id);
    if (targets.size) {
      notifyUsers([...targets], {
        type: 'info',
        title: `مناقصه ${STATUS_FA[status] || status}: ${t.title}`,
        body: `${req.user.full_name} وضعیت مناقصه را به «${STATUS_FA[status] || status}» تغییر داد`,
        link: '/crm',
      });
    }
  }
  res.json({ ok: true });
});

r.delete('/tenders/:id', (req, res) => {
  const t = db.prepare('SELECT * FROM crm_tenders WHERE id = ?').get(req.params.id);
  if (!t) return res.status(404).json({ error: 'مناقصه یافت نشد' });
  if (!req.crmManage) return res.status(403).json({ error: 'فقط مدیرانِ CRM می‌توانند مناقصه را حذف کنند' });
  db.prepare('DELETE FROM crm_tenders WHERE id = ?').run(t.id);
  res.json({ ok: true });
});

// ---------- چک‌لیست پاکات ----------
r.post('/tenders/:id/checklist', (req, res) => {
  const b = req.body || {};
  if (!str(b.title)) return res.status(400).json({ error: 'عنوان مدرک الزامی است' });
  const info = db.prepare(`INSERT INTO crm_tender_checklist (tender_id, envelope, title, required, note, sort_order)
    VALUES (?, ?, ?, ?, ?, ?)`)
    .run(req.params.id, ['a', 'b', 'c'].includes(b.envelope) ? b.envelope : 'b',
      str(b.title), b.required === false ? 0 : 1, str(b.note), num(b.sort_order));
  res.json({ id: info.lastInsertRowid });
});

r.put('/checklist/:id', (req, res) => {
  const c = db.prepare('SELECT * FROM crm_tender_checklist WHERE id = ?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'مدرک یافت نشد' });
  const b = req.body || {};
  db.prepare('UPDATE crm_tender_checklist SET title = ?, envelope = ?, required = ?, done = ?, note = ? WHERE id = ?')
    .run(b.title !== undefined ? str(b.title) : c.title,
      b.envelope !== undefined ? b.envelope : c.envelope,
      b.required !== undefined ? (b.required ? 1 : 0) : c.required,
      b.done !== undefined ? (b.done ? 1 : 0) : c.done,
      b.note !== undefined ? str(b.note) : c.note, c.id);
  res.json({ ok: true });
});

r.delete('/checklist/:id', (req, res) => {
  db.prepare('DELETE FROM crm_tender_checklist WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------- رقبا ----------
r.post('/tenders/:id/competitors', (req, res) => {
  const b = req.body || {};
  if (!str(b.name)) return res.status(400).json({ error: 'نام رقیب الزامی است' });
  const info = db.prepare(`INSERT INTO crm_tender_competitors (tender_id, name, amount, rank, is_winner, note)
    VALUES (?, ?, ?, ?, ?, ?)`)
    .run(req.params.id, str(b.name), num(b.amount), num(b.rank), b.is_winner ? 1 : 0, str(b.note));
  // اگر برنده علامت خورد، در خودِ مناقصه هم ثبت شود
  if (b.is_winner) {
    db.prepare('UPDATE crm_tenders SET winner_name = ?, winner_amount = ? WHERE id = ?')
      .run(str(b.name), num(b.amount), req.params.id);
    db.prepare('UPDATE crm_tender_competitors SET is_winner = 0 WHERE tender_id = ? AND id != ?')
      .run(req.params.id, info.lastInsertRowid);
  }
  res.json({ id: info.lastInsertRowid });
});

r.delete('/competitors/:id', (req, res) => {
  db.prepare('DELETE FROM crm_tender_competitors WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------- گزارش مرحله‌ایِ مناقصه ----------
r.post('/tenders/:id/stage-reports', (req, res) => {
  const t = db.prepare('SELECT * FROM crm_tenders WHERE id = ?').get(req.params.id);
  if (!t) return res.status(404).json({ error: 'مناقصه یافت نشد' });
  const b = req.body || {};
  if (!str(b.summary) && !str(b.went_well) && !str(b.went_wrong) && !str(b.next_action)) {
    return res.status(400).json({ error: 'حداقل یکی از بخش‌های گزارش را پر کنید' });
  }
  const info = db.prepare(`INSERT INTO crm_stage_reports
    (tender_id, customer_id, from_stage, stage, summary, went_well, went_wrong, blockers, next_action, confidence, user_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(t.id, t.customer_id, t.status, t.status,
      str(b.summary), str(b.went_well), str(b.went_wrong), str(b.blockers), str(b.next_action),
      Math.max(0, Math.min(100, num(b.confidence))), req.user.id);
  res.json({ id: info.lastInsertRowid });
});

// ============================================================================
//  تحلیل مناقصات
//  نرخ برد در مناقصه، فاصلهٔ قیمتی با برنده، رقبای پرتکرار و مهلت‌های نزدیک.
// ============================================================================
r.get('/tender-reports', (req, res) => {
  const { from = '', to = '' } = req.query;
  const where = [];
  const params = [];
  if (from) { where.push('t.created_at >= ?'); params.push(String(from)); }
  if (to) { where.push('t.created_at <= ?'); params.push(String(to) + ' 23:59:59'); }
  if (!req.crmManage) { where.push('t.owner_id = ?'); params.push(req.user.id); }
  const clause = where.length ? 'WHERE ' + where.join(' AND ') : '';

  const AGG = `
    COUNT(*) AS total,
    SUM(CASE WHEN t.status = 'won' THEN 1 ELSE 0 END) AS won_count,
    SUM(CASE WHEN t.status = 'lost' THEN 1 ELSE 0 END) AS lost_count,
    SUM(CASE WHEN t.status NOT IN ('won','lost','cancelled','withdrawn') THEN 1 ELSE 0 END) AS open_count,
    SUM(CASE WHEN t.status = 'withdrawn' THEN 1 ELSE 0 END) AS withdrawn_count,
    COALESCE(SUM(CASE WHEN t.status = 'won' THEN t.our_bid_amount ELSE 0 END), 0) AS won_amount,
    COALESCE(SUM(CASE WHEN t.status = 'lost' THEN t.our_bid_amount ELSE 0 END), 0) AS lost_amount,
    COALESCE(SUM(CASE WHEN t.status NOT IN ('won','lost','cancelled','withdrawn')
      THEN t.estimated_amount ELSE 0 END), 0) AS open_amount`;
  const rate = (w, l) => (Number(w) + Number(l) > 0 ? Math.round((Number(w) / (Number(w) + Number(l))) * 1000) / 10 : null);

  const summary = db.prepare(`SELECT ${AGG} FROM crm_tenders t ${clause}`).get(...params);
  summary.success_rate = rate(summary.won_count, summary.lost_count);
  // میانگین فاصلهٔ قیمتی ما با برنده در مناقصات باخته — «چقدر گران بودیم»
  const gap = db.prepare(`
    SELECT AVG((t.our_bid_amount - t.winner_amount) * 100.0 / t.winner_amount) AS avg_gap
    FROM crm_tenders t ${clause} ${clause ? 'AND' : 'WHERE'} t.status = 'lost'
      AND t.winner_amount > 0 AND t.our_bid_amount > 0`).get(...params);
  summary.avg_price_gap_pct = gap.avg_gap === null ? null : Math.round(gap.avg_gap * 10) / 10;

  const byStatus = db.prepare(`SELECT t.status, COUNT(*) AS count,
    COALESCE(SUM(t.estimated_amount),0) AS amount FROM crm_tenders t ${clause} GROUP BY t.status`).all(...params)
    .map(x => ({ ...x, label: STATUS_FA[x.status] || x.status }));

  const byPortal = db.prepare(`SELECT t.portal, ${AGG} FROM crm_tenders t ${clause} GROUP BY t.portal`).all(...params)
    .map(x => ({ ...x, success_rate: rate(x.won_count, x.lost_count) }));

  const byOwner = db.prepare(`
    SELECT COALESCE(u.full_name, 'بدون مسئول') AS owner_name, ${AGG}
    FROM crm_tenders t LEFT JOIN users u ON u.id = t.owner_id ${clause}
    GROUP BY t.owner_id`).all(...params)
    .map(x => ({ ...x, success_rate: rate(x.won_count, x.lost_count) }))
    .sort((a, b) => b.won_amount - a.won_amount);

  // رقبایی که بیشترین بار ما را شکست داده‌اند
  const rivals = db.prepare(`
    SELECT cc.name, COUNT(*) AS times, SUM(cc.is_winner) AS wins,
           COALESCE(AVG(cc.amount), 0) AS avg_amount
    FROM crm_tender_competitors cc
    JOIN crm_tenders t ON t.id = cc.tender_id ${clause}
    GROUP BY cc.name ORDER BY wins DESC, times DESC LIMIT 15`).all(...params);

  const lostReasons = db.prepare(`
    SELECT COALESCE(NULLIF(TRIM(t.lost_reason), ''), 'ثبت‌نشده') AS reason, COUNT(*) AS count
    FROM crm_tenders t ${clause} ${clause ? 'AND' : 'WHERE'} t.status = 'lost'
    GROUP BY reason ORDER BY count DESC`).all(...params);

  const monthly = db.prepare(`
    SELECT strftime('%Y-%m', t.created_at) AS month, ${AGG}
    FROM crm_tenders t ${clause} GROUP BY month ORDER BY month`).all(...params)
    .map(x => ({ ...x, success_rate: rate(x.won_count, x.lost_count) }));

  res.json({
    summary, by_status: byStatus, by_portal: byPortal, by_owner: byOwner,
    rivals, lost_reasons: lostReasons, monthly, scoped: !req.crmManage, statuses: STATUS_FA,
  });
});

// مهلت‌های نزدیک و کارهای عقب‌افتادهٔ مناقصات — «تابلوی هشدار»
r.get('/tender-alerts', (req, res) => {
  const mineOnly = req.crmManage ? 1 : 0;
  const rows = db.prepare(`
    SELECT t.*, c.name AS customer_name, u.full_name AS owner_name
    FROM crm_tenders t
    LEFT JOIN crm_customers c ON c.id = t.customer_id
    LEFT JOIN users u ON u.id = t.owner_id
    WHERE (@all = 1 OR t.owner_id = @uid)
      AND (t.status NOT IN ('won','lost','cancelled','withdrawn')
           OR (t.guarantee_released = 0 AND t.guarantee_expires_at IS NOT NULL))
    ORDER BY t.submit_deadline IS NULL, t.submit_deadline`)
    .all({ uid: req.user.id, all: mineOnly });
  const list = rows.map(tenderRow);
  res.json({
    // مهلت ارسال پیشنهاد نزدیک یا گذشته
    submit_soon: list.filter(t => !t.is_closed && t.days_to_submit !== null && t.days_to_submit <= 14),
    // ضمانت‌نامه‌ای که سررسیدش نزدیک است و هنوز آزاد نشده
    guarantee_soon: list.filter(t => t.days_to_guarantee !== null && t.days_to_guarantee <= 30),
    // پاکاتی که مدارکشان کامل نیست ولی مهلت نزدیک است
    incomplete: list.filter(t => !t.is_closed && t.checklist_total > 0
      && t.checklist_done < t.checklist_total && (t.days_to_submit === null || t.days_to_submit <= 21)),
  });
});

export default r;
