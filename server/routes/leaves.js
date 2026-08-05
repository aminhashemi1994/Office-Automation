// ============================================================================
//  مرخصی — سقف مرخصی پرسنل و کسر خودکار از مانده
//  درخواستِ مرخصی روی همان موتور گردش‌کار ثبت می‌شود. کافی است یک فرآیند را
//  «فرآیند مرخصی» علامت بزنید و فیلدهای فرمش را به نوع/مقدار مرخصی نگاشت کنید.
//  با تایید نهایی آن درخواست، مقدار مرخصی به‌طور خودکار از ماندهٔ کاربر کم می‌شود.
// ============================================================================
import { Router } from 'express';
import db from '../db.js';
import { hasPerm } from '../auth.js';
import { canAccessEverywhere, getManagedDeptIds } from '../acl.js';

const r = Router();

// ---------- تنظیمات ----------
function setting(key, fallback = '') {
  return db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key)?.value ?? fallback;
}

export function workdayHours() {
  return Number(setting('leave_workday_hours', '8')) || 8;
}

// کدام نوع مرخصی از ماندهٔ استحقاقی کم می‌شود؟
export function deductPolicy() {
  try {
    const v = JSON.parse(setting('leave_deduct_policy', '{"entitled":1,"unpaid":0,"sick":0}'));
    return { entitled: !!v.entitled, unpaid: !!v.unpaid, sick: !!v.sick };
  } catch { return { entitled: true, unpaid: false, sick: false }; }
}

export const LEAVE_TYPES = {
  entitled: 'استحقاقی',
  unpaid: 'بدون حقوق',
  sick: 'استعلاجی',
};

// سالِ شمسیِ جاری — مبنای ماندهٔ سالانه (تقویم هجری شمسی از خودِ Intl)
export function currentJalaliYear() {
  const y = new Intl.DateTimeFormat('en-u-ca-persian', { year: 'numeric' }).format(new Date());
  return Number(String(y).replace(/[^0-9]/g, '')) || new Date().getFullYear();
}

// ---------- دسترسی ----------
// مدیریت سقف مرخصی: مدیر سامانه / واحد مدیریت / دارندهٔ مجوز. مدیرِ واحد فقط اعضای واحد خودش.
function canManageLeaves(user) {
  return canAccessEverywhere(user) || hasPerm(user, 'leaves.manage');
}
function canSeeUserBalance(user, targetId) {
  if (Number(targetId) === user.id) return true;
  if (canManageLeaves(user)) return true;
  const target = db.prepare('SELECT department_id FROM users WHERE id = ?').get(targetId);
  return !!target?.department_id && getManagedDeptIds(user).includes(target.department_id);
}

// ---------- محاسبهٔ مانده ----------
export function balanceOf(userId, year = currentJalaliYear()) {
  const row = db.prepare('SELECT * FROM leave_balances WHERE user_id = ? AND year = ?').get(userId, year);
  const entitled = Number(row?.entitled_hours || 0) + Number(row?.carried_over_hours || 0);
  const used = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN leave_type = 'entitled' THEN -hours ELSE 0 END), 0) AS entitled_used,
      COALESCE(SUM(CASE WHEN leave_type = 'unpaid'   THEN -hours ELSE 0 END), 0) AS unpaid_used,
      COALESCE(SUM(CASE WHEN leave_type = 'sick'     THEN -hours ELSE 0 END), 0) AS sick_used
    FROM leave_ledger WHERE user_id = ? AND year = ? AND hours < 0`).get(userId, year);
  const policy = deductPolicy();
  // فقط انواعی که طبق سیاست از ماندهٔ استحقاقی کم می‌شوند، در «مصرف‌شده» حساب می‌آیند
  const deducted =
    (policy.entitled ? Number(used.entitled_used) : 0) +
    (policy.unpaid ? Number(used.unpaid_used) : 0) +
    (policy.sick ? Number(used.sick_used) : 0);
  return {
    year,
    entitled_hours: Number(row?.entitled_hours || 0),
    carried_over_hours: Number(row?.carried_over_hours || 0),
    sick_hours: Number(row?.sick_hours || 0),
    total_hours: entitled,
    used_hours: deducted,
    remaining_hours: entitled - deducted,
    entitled_used: Number(used.entitled_used),
    unpaid_used: Number(used.unpaid_used),
    sick_used: Number(used.sick_used),
    note: row?.note || '',
    workday_hours: workdayHours(),
  };
}

// ---------- مانده‌ها ----------
r.get('/balances', (req, res) => {
  const year = Number(req.query.year) || currentJalaliYear();
  const all = canManageLeaves(req.user);
  const managed = getManagedDeptIds(req.user);
  let users;
  if (all) {
    users = db.prepare('SELECT id, full_name, department_id FROM users WHERE is_active = 1 ORDER BY full_name').all();
  } else if (managed.length) {
    const ph = managed.map(() => '?').join(',');
    users = db.prepare(`SELECT id, full_name, department_id FROM users
      WHERE is_active = 1 AND department_id IN (${ph}) ORDER BY full_name`).all(...managed);
  } else {
    users = db.prepare('SELECT id, full_name, department_id FROM users WHERE id = ?').all(req.user.id);
  }
  const balances = users.map(u => ({
    user_id: u.id,
    full_name: u.full_name,
    department_id: u.department_id,
    department_name: db.prepare('SELECT name FROM departments WHERE id = ?').get(u.department_id)?.name || '',
    ...balanceOf(u.id, year),
  }));
  res.json({
    balances, year, can_manage: all,
    policy: deductPolicy(),
    workday_hours: workdayHours(),
    default_days: Number(setting('leave_default_days', '26')) || 0,
  });
});

// ماندهٔ یک کاربر به‌همراه ریز گردشِ آن
r.get('/balances/:userId', (req, res) => {
  const uid = Number(req.params.userId);
  if (!canSeeUserBalance(req.user, uid)) return res.status(403).json({ error: 'دسترسی غیرمجاز' });
  const year = Number(req.query.year) || currentJalaliYear();
  const ledger = db.prepare(`
    SELECT l.*, u.full_name AS created_by_name, wr.title AS request_title
    FROM leave_ledger l
    LEFT JOIN users u ON u.id = l.created_by
    LEFT JOIN workflow_requests wr ON wr.id = l.request_id
    WHERE l.user_id = ? AND l.year = ? ORDER BY l.id DESC`).all(uid, year);
  res.json({ balance: balanceOf(uid, year), ledger, types: LEAVE_TYPES });
});

// تعیین سقف مرخصی یک کاربر
r.put('/balances/:userId', (req, res) => {
  if (!canManageLeaves(req.user)) return res.status(403).json({ error: 'فقط مدیر سامانه می‌تواند سقف مرخصی را تعیین کند' });
  const uid = Number(req.params.userId);
  if (!db.prepare('SELECT 1 FROM users WHERE id = ?').get(uid)) return res.status(404).json({ error: 'کاربر یافت نشد' });
  const year = Number(req.body?.year) || currentJalaliYear();
  const wd = workdayHours();
  // مقدار را می‌توان به «روز» یا مستقیماً به «ساعت» فرستاد
  const hours = (v, days) => (v !== undefined && v !== null && v !== '' ? Number(v) || 0
    : days !== undefined && days !== null && days !== '' ? (Number(days) || 0) * wd : 0);
  const entitled = hours(req.body?.entitled_hours, req.body?.entitled_days);
  const sick = hours(req.body?.sick_hours, req.body?.sick_days);
  const carried = hours(req.body?.carried_over_hours, req.body?.carried_over_days);
  db.prepare(`INSERT INTO leave_balances (user_id, year, entitled_hours, sick_hours, carried_over_hours, note, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(user_id, year) DO UPDATE SET
      entitled_hours = excluded.entitled_hours, sick_hours = excluded.sick_hours,
      carried_over_hours = excluded.carried_over_hours, note = excluded.note, updated_at = datetime('now')`)
    .run(uid, year, entitled, sick, carried, String(req.body?.note || ''));
  res.json({ ok: true, balance: balanceOf(uid, year) });
});

// تعیین سقف یکسان برای همهٔ پرسنل (یا یک واحد) — «مقدار مرخصی کل برای تمامی پرسنل»
r.post('/balances/bulk', (req, res) => {
  if (!canManageLeaves(req.user)) return res.status(403).json({ error: 'دسترسی غیرمجاز' });
  const year = Number(req.body?.year) || currentJalaliYear();
  const wd = workdayHours();
  const entitled = req.body?.entitled_hours !== undefined && req.body?.entitled_hours !== ''
    ? Number(req.body.entitled_hours) || 0
    : (Number(req.body?.entitled_days) || 0) * wd;
  const sick = req.body?.sick_hours !== undefined && req.body?.sick_hours !== ''
    ? Number(req.body.sick_hours) || 0
    : (Number(req.body?.sick_days) || 0) * wd;
  const deptId = Number(req.body?.department_id) || 0;
  const overwrite = req.body?.overwrite !== false; // پیش‌فرض: مقادیر قبلی هم بازنویسی شوند
  const users = deptId
    ? db.prepare('SELECT id FROM users WHERE is_active = 1 AND department_id = ?').all(deptId)
    : db.prepare('SELECT id FROM users WHERE is_active = 1').all();
  const ins = db.prepare(`INSERT INTO leave_balances (user_id, year, entitled_hours, sick_hours, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(user_id, year) DO UPDATE SET
      entitled_hours = CASE WHEN ? THEN excluded.entitled_hours ELSE leave_balances.entitled_hours END,
      sick_hours = CASE WHEN ? THEN excluded.sick_hours ELSE leave_balances.sick_hours END,
      updated_at = datetime('now')`);
  for (const u of users) ins.run(u.id, year, entitled, sick, overwrite ? 1 : 0, overwrite ? 1 : 0);
  res.json({ ok: true, count: users.length, year });
});

// ---------- ثبت دستیِ کسر/افزایش ----------
r.post('/ledger', (req, res) => {
  if (!canManageLeaves(req.user)) return res.status(403).json({ error: 'دسترسی غیرمجاز' });
  const b = req.body || {};
  const uid = Number(b.user_id);
  if (!db.prepare('SELECT 1 FROM users WHERE id = ?').get(uid)) return res.status(400).json({ error: 'کاربر نامعتبر است' });
  const type = LEAVE_TYPES[b.leave_type] ? b.leave_type : 'entitled';
  const wd = workdayHours();
  const unit = b.unit === 'day' ? 'day' : 'hour';
  const amount = Number(b.amount) || 0;
  if (!amount) return res.status(400).json({ error: 'مقدار مرخصی الزامی است' });
  // کسر = منفی. اگر کاربر مقدار مثبت بفرستد و direction='deduct' باشد، منفی می‌شود.
  const magnitude = unit === 'day' ? amount * wd : amount;
  const hours = b.direction === 'add' ? Math.abs(magnitude) : -Math.abs(magnitude);
  const year = Number(b.year) || currentJalaliYear();
  db.prepare(`INSERT INTO leave_ledger (user_id, year, leave_type, unit, hours, amount_label, from_date, to_date, note, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(uid, year, type, unit, hours,
      `${Math.abs(amount).toLocaleString('fa-IR')} ${unit === 'day' ? 'روز' : 'ساعت'}`,
      String(b.from_date || ''), String(b.to_date || ''), String(b.note || ''), req.user.id);
  res.json({ ok: true, balance: balanceOf(uid, year) });
});

r.delete('/ledger/:id', (req, res) => {
  if (!canManageLeaves(req.user)) return res.status(403).json({ error: 'دسترسی غیرمجاز' });
  db.prepare('DELETE FROM leave_ledger WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------- تنظیمات مرخصی ----------
r.get('/settings', (req, res) => {
  res.json({
    workday_hours: workdayHours(),
    default_days: Number(setting('leave_default_days', '26')) || 0,
    policy: deductPolicy(),
    types: LEAVE_TYPES,
    year: currentJalaliYear(),
    can_manage: canManageLeaves(req.user),
    // فرآیندهایی که به‌عنوان «فرآیند مرخصی» علامت خورده‌اند
    templates: db.prepare('SELECT id, name, leave_map FROM workflow_templates WHERE leave_enabled = 1').all(),
  });
});

r.put('/settings', (req, res) => {
  if (!canManageLeaves(req.user)) return res.status(403).json({ error: 'دسترسی غیرمجاز' });
  const b = req.body || {};
  const set = db.prepare('INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  if (b.workday_hours !== undefined) set.run('leave_workday_hours', String(Number(b.workday_hours) || 8));
  if (b.default_days !== undefined) set.run('leave_default_days', String(Number(b.default_days) || 0));
  if (b.policy !== undefined) {
    set.run('leave_deduct_policy', JSON.stringify({
      entitled: !!b.policy.entitled, unpaid: !!b.policy.unpaid, sick: !!b.policy.sick,
    }));
  }
  res.json({ ok: true });
});

export default r;
