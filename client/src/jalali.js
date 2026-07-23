// تبدیل تقویم جلالی (شمسی) — بدون وابستگی بیرونی
// مبتنی بر الگوریتم jalaali-js (MIT)
function div(a, b) { return ~~(a / b); }

function jalCal(jy) {
  const breaks = [-61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210,
    1635, 2060, 2097, 2192, 2262, 2324, 2394, 2456, 3178];
  const bl = breaks.length, gy = jy + 621;
  let leapJ = -14, jp = breaks[0], jm, jump = 0, leap, leapG, march, n, i;
  if (jy < jp || jy >= breaks[bl - 1]) throw new Error('Invalid Jalaali year ' + jy);
  for (i = 1; i < bl; i += 1) {
    jm = breaks[i];
    jump = jm - jp;
    if (jy < jm) break;
    leapJ = leapJ + div(jump, 33) * 8 + div(jump % 33, 4);
    jp = jm;
  }
  n = jy - jp;
  leapJ = leapJ + div(n, 33) * 8 + div(n % 33 + 3, 4);
  if (jump % 33 === 4 && jump - n === 4) leapJ += 1;
  leapG = div(gy, 4) - div((div(gy, 100) + 1) * 3, 4) - 150;
  march = 20 + leapJ - leapG;
  if (jump - n < 6) n = n - jump + div(jump + 4, 33) * 33;
  leap = ((n + 1) % 33 - 1) % 4;
  if (leap === -1) leap = 4;
  return { leap, gy, march };
}

function g2d(gy, gm, gd) {
  let d = div((gy + div(gm - 8, 6) + 100100) * 1461, 4) + div(153 * ((gm + 9) % 12) + 2, 5) + gd - 34840408;
  d = d - div(div(gy + 100100 + div(gm - 8, 6), 100) * 3, 4) + 752;
  return d;
}

function d2g(jdn) {
  let j = 4 * jdn + 139361631;
  j = j + div(div(4 * jdn + 183187720, 146097) * 3, 4) * 4 - 3908;
  const i = div(j % 1461, 4) * 5 + 308;
  const gd = div(i % 153, 5) + 1;
  const gm = (div(i, 153) % 12) + 1;
  const gy = div(j, 1461) - 100100 + div(8 - gm, 6);
  return { gy, gm, gd };
}

function j2d(jy, jm, jd) {
  const r = jalCal(jy);
  return g2d(r.gy, 3, r.march) + (jm - 1) * 31 - div(jm, 7) * (jm - 7) + jd - 1;
}

function d2j(jdn) {
  const gy = d2g(jdn).gy;
  let jy = gy - 621;
  const r = jalCal(jy);
  const jdn1f = g2d(gy, 3, r.march);
  let k = jdn - jdn1f, jm, jd;
  if (k >= 0) {
    if (k <= 185) { jm = 1 + div(k, 31); jd = (k % 31) + 1; return { jy, jm, jd }; }
    k -= 186;
  } else {
    jy -= 1; k += 179;
    if (r.leap === 1) k += 1;
  }
  jm = 7 + div(k, 30);
  jd = (k % 30) + 1;
  return { jy, jm, jd };
}

export function toJalaali(gy, gm, gd) { return d2j(g2d(gy, gm, gd)); }
export function toGregorian(jy, jm, jd) { return d2g(j2d(jy, jm, jd)); }

export function isLeapJalaaliYear(jy) { return jalCal(jy).leap === 0; }
export function jalaaliMonthLength(jy, jm) {
  if (jm <= 6) return 31;
  if (jm <= 11) return 30;
  return isLeapJalaaliYear(jy) ? 30 : 29;
}

export const J_MONTHS = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور',
  'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];
export const J_WEEKDAYS = ['ش', 'ی', 'د', 'س', 'چ', 'پ', 'ج']; // شنبه..جمعه

// ارقام فارسی
export function faDigits(s) { return String(s).replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[+d]); }

// امروز به شمسی
export function todayJalali() {
  const n = new Date();
  return toJalaali(n.getFullYear(), n.getMonth() + 1, n.getDate());
}

// شماره روز هفته برای یک تاریخ شمسی، مبنا شنبه=۰ .. جمعه=۶
export function jalaliWeekIndex(jy, jm, jd) {
  const g = toGregorian(jy, jm, jd);
  const dow = new Date(g.gy, g.gm - 1, g.gd).getDay(); // 0=یکشنبه
  return (dow + 1) % 7; // شنبه=۰
}

// مقدار ذخیره‌شده: "1403/04/27" (ارقام انگلیسی)
export function formatJalali(jy, jm, jd) {
  const p = (x) => String(x).padStart(2, '0');
  return `${jy}/${p(jm)}/${p(jd)}`;
}
export function parseJalali(str) {
  if (!str || typeof str !== 'string') return null;
  const m = /^(\d{3,4})\/(\d{1,2})\/(\d{1,2})$/.exec(str.trim());
  if (!m) return null;
  return { jy: +m[1], jm: +m[2], jd: +m[3] };
}
// نمایش با ارقام فارسی
export function displayJalali(str) {
  const p = parseJalali(str);
  if (!p) return str || '';
  return faDigits(formatJalali(p.jy, p.jm, p.jd));
}
