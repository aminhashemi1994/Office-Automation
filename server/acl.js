// ============================================================================
//  کنترل دسترسی مبتنی بر واحد (ACL)
//  قاعدهٔ کلی:
//   • ادمین سامانه و اعضای «واحد مدیریت» (is_management) → دسترسی کامل به همه‌جا.
//   • سایر مدیران/سرگروه‌ها → دسترسی کامل فقط در محدودهٔ واحد(های) خودشان.
//   • کارمند عادی → فقط موارد مربوط به خودش.
// ============================================================================
import db from './db.js';
import { hasPerm } from './auth.js';

// ---------------------------------------------------------------------------
//  سِمَت در واحد
//  دو سِمَت داریم و یک نفر می‌تواند هم‌زمان هر دو را داشته باشد:
//    head     → سرگروه واحد
//    director → مدیر واحد (بالادستِ سرگروه)
//  در گردش‌کار می‌شود هرکدام را جداگانه هدف گرفت؛ جاهایی که «مدیریتِ واحد» به‌طور
//  کلی مطرح است (دسترسی، گزارش‌ها) هر دو با هم برگردانده می‌شوند.
// ---------------------------------------------------------------------------
const isActive = (id) => !!db.prepare('SELECT 1 FROM users WHERE id = ? AND is_active = 1').get(id);

// دارندگانِ یک سِمَتِ مشخص در یک واحد
export function deptPositionHolders(deptId, position) {
  if (!deptId) return [];
  const ids = new Set();
  for (const row of db.prepare('SELECT user_id FROM department_managers WHERE department_id = ? AND position = ?')
    .all(deptId, position)) ids.add(row.user_id);
  if (position === 'director') {
    // «مدیرِ اصلیِ واحد» در جدول departments هم همان مدیر است
    const dept = db.prepare('SELECT manager_id FROM departments WHERE id = ?').get(deptId);
    if (dept?.manager_id) ids.add(dept.manager_id);
  }
  if (position === 'head') {
    // سازگاری با گذشته: کاربرِ نقش‌دارِ manager در یک واحد، سرگروهِ همان واحد است
    for (const row of db.prepare("SELECT id FROM users WHERE department_id = ? AND role = 'manager' AND is_active = 1").all(deptId)) {
      ids.add(row.id);
    }
  }
  return [...ids].filter(isActive);
}

export const deptHeads = (deptId) => deptPositionHolders(deptId, 'head');
export const deptDirectors = (deptId) => deptPositionHolders(deptId, 'director');

// «مسئولانِ واحد» — سرگروه‌ها و مدیران با هم. مبنای دسترسی‌های واحدی است.
export function deptManagers(deptId) {
  if (!deptId) return [];
  return [...new Set([...deptHeads(deptId), ...deptDirectors(deptId)])];
}

// سِمَت‌های یک کاربر: [{ department_id, position }]
export function positionsOf(userId) {
  const rows = db.prepare('SELECT department_id, position FROM department_managers WHERE user_id = ?').all(userId);
  const out = rows.map(r => ({ department_id: r.department_id, position: r.position }));
  for (const d of db.prepare('SELECT id FROM departments WHERE manager_id = ?').all(userId)) {
    if (!out.some(x => x.department_id === d.id && x.position === 'director')) {
      out.push({ department_id: d.id, position: 'director' });
    }
  }
  const u = db.prepare('SELECT department_id, role FROM users WHERE id = ?').get(userId);
  if (u?.role === 'manager' && u.department_id
    && !out.some(x => x.department_id === u.department_id && x.position === 'head')) {
    out.push({ department_id: u.department_id, position: 'head' });
  }
  return out;
}

// آیا این کاربر عضو «واحد مدیریت» است؟ (دسترسی سراسری)
export function isManagementMember(user) {
  if (!user?.department_id) return false;
  const d = db.prepare('SELECT is_management FROM departments WHERE id = ?').get(user.department_id);
  return !!d?.is_management;
}

// آیا این کاربر به همه‌جا دسترسی دارد؟ (ادمین یا واحد مدیریت یا مجوز صریح)
export function canAccessEverywhere(user) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  if (hasPerm(user, 'workflows.manage')) return true;
  if (isManagementMember(user)) return true;
  return false;
}

// شناسهٔ واحد(هایی) که این کاربر مدیرشان است (از هر سه منبع)
export function getManagedDeptIds(user) {
  if (!user) return [];
  const ids = new Set();
  for (const row of db.prepare('SELECT id FROM departments WHERE manager_id = ?').all(user.id)) ids.add(row.id);
  for (const row of db.prepare('SELECT department_id FROM department_managers WHERE user_id = ?').all(user.id)) ids.add(row.department_id);
  // کاربرِ نقش‌دارِ manager، مدیرِ واحدِ خودش هم حساب می‌شود
  if (user.role === 'manager' && user.department_id) ids.add(user.department_id);
  return [...ids];
}

// آیا این کاربر مدیرِ واحدِ مشخص است؟
export function isDeptManagerOf(user, deptId) {
  if (!deptId) return false;
  if (canAccessEverywhere(user)) return true;
  return getManagedDeptIds(user).includes(Number(deptId));
}

// آیا این کاربر روی «کاربرِ هدف» دسترسی مدیریتی دارد؟
// یعنی همه‌جا دسترسی دارد، یا مدیرِ واحدِ آن کاربر است.
export function canManageUser(user, targetUserId) {
  if (canAccessEverywhere(user)) return true;
  const target = db.prepare('SELECT department_id FROM users WHERE id = ?').get(targetUserId);
  if (!target?.department_id) return false;
  return getManagedDeptIds(user).includes(target.department_id);
}
