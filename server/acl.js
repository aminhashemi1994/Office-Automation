// ============================================================================
//  کنترل دسترسی مبتنی بر واحد (ACL)
//  قاعدهٔ کلی:
//   • ادمین سامانه و اعضای «واحد مدیریت» (is_management) → دسترسی کامل به همه‌جا.
//   • سایر مدیران/سرگروه‌ها → دسترسی کامل فقط در محدودهٔ واحد(های) خودشان.
//   • کارمند عادی → فقط موارد مربوط به خودش.
// ============================================================================
import db from './db.js';
import { hasPerm } from './auth.js';

// مدیر(های) یک واحد: مدیر اصلیِ ثبت‌شده + همهٔ مدیرانِ جدول چندمدیره + اعضای فعالِ
// همان واحد که نقش «مدیر/سرگروه» دارند. (بدون تکرار)
export function deptManagers(deptId) {
  if (!deptId) return [];
  const ids = new Set();
  const dept = db.prepare('SELECT manager_id FROM departments WHERE id = ?').get(deptId);
  if (dept?.manager_id) ids.add(dept.manager_id);
  for (const row of db.prepare('SELECT user_id FROM department_managers WHERE department_id = ?').all(deptId)) {
    ids.add(row.user_id);
  }
  for (const row of db.prepare("SELECT id FROM users WHERE department_id = ? AND role = 'manager' AND is_active = 1").all(deptId)) {
    ids.add(row.id);
  }
  // فقط کاربران فعال
  return [...ids].filter(id => db.prepare('SELECT 1 FROM users WHERE id = ? AND is_active = 1').get(id));
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
