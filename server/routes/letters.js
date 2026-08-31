// ============================================================================
//  نامهٔ اداری (دبیرخانه)
//  نامهٔ وارده / صادره / داخلی با شمارهٔ ثبتِ خودکار، گیرنده و رونوشت، پیوست،
//  «دریافت شد» و ارجاع به همکار با دستور.
//  عمداً از کارتابل جداست: کارتابل برای گردشِ تاییدِ مرحله‌به‌مرحله است، دبیرخانه
//  برای ثبت و پیگیریِ مکاتبات.
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

const DIRECTIONS = { in: 'وارده', out: 'صادره', internal: 'داخلی' };

// سال شمسیِ جاری — برای شمارهٔ ثبت
const jy = () => Number(new Intl.DateTimeFormat('en-u-ca-persian-nu-latn', { year: 'numeric' })
  .format(new Date()).replace(/\D/g, ''));

// شمارهٔ ثبتِ بعدی: «ت‌ک/۱۴۰۵/و-۰۰۱۲»
function nextNumber(direction) {
  const year = jy();
  const mark = direction === 'in' ? 'و' : direction === 'out' ? 'ص' : 'د';
  const prefix = str(setting('letter_prefix', 'ت‌ک'));
  const like = `${prefix}/${year}/${mark}-%`;
  const last = db.prepare('SELECT number FROM letters WHERE number LIKE ? ORDER BY id DESC LIMIT 1').get(like);
  const seq = last ? (Number(String(last.number).split('-').pop().replace(/\D/g, '')) || 0) + 1 : 1;
  return `${prefix}/${year}/${mark}-${String(seq).padStart(4, '0')}`;
}

function recipientsOf(letterId) {
  return db.prepare(`SELECT p.*, u.full_name, u.avatar_color, d.name AS department_name
    FROM letter_recipients p JOIN users u ON u.id = p.user_id
    LEFT JOIN departments d ON d.id = u.department_id
    WHERE p.letter_id = ? ORDER BY p.kind DESC, u.full_name`).all(letterId);
}
function referralsOf(letterId) {
  return db.prepare(`SELECT rf.*, f.full_name AS from_name, t.full_name AS to_name
    FROM letter_referrals rf
    LEFT JOIN users f ON f.id = rf.from_user_id
    JOIN users t ON t.id = rf.to_user_id
    WHERE rf.letter_id = ? ORDER BY rf.id`).all(letterId);
}

// چه کسی نامه را می‌بیند: ثبت‌کننده، گیرنده/رونوشت، ارجاع‌شونده، مدیرِ واحدِ نامه، مدیریت
function canSee(user, l) {
  if (canAccessEverywhere(user) || hasPerm(user, 'letters.manage')) return true;
  if (l.created_by === user.id) return true;
  if (db.prepare('SELECT 1 FROM letter_recipients WHERE letter_id = ? AND user_id = ?').get(l.id, user.id)) return true;
  if (db.prepare('SELECT 1 FROM letter_referrals WHERE letter_id = ? AND to_user_id = ?').get(l.id, user.id)) return true;
  if (l.department_id && getManagedDeptIds(user).includes(Number(l.department_id))) return true;
  return false;
}
const canEdit = (user, l) => canAccessEverywhere(user) || hasPerm(user, 'letters.manage') || l.created_by === user.id;

r.get('/', (req, res) => {
  const { direction = '', q = '', mine = '' } = req.query;
  const rows = db.prepare(`
    SELECT l.*, u.full_name AS creator_name, d.name AS department_name,
      (SELECT COUNT(*) FROM letter_recipients p WHERE p.letter_id = l.id) AS recipient_count,
      (SELECT COUNT(*) FROM letter_recipients p WHERE p.letter_id = l.id AND p.must_ack = 1 AND p.acked_at IS NULL) AS pending_ack,
      (SELECT acked_at FROM letter_recipients p WHERE p.letter_id = l.id AND p.user_id = @uid) AS my_acked_at,
      (SELECT 1 FROM letter_recipients p WHERE p.letter_id = l.id AND p.user_id = @uid) AS is_recipient,
      (SELECT COUNT(*) FROM letter_referrals rf WHERE rf.letter_id = l.id AND rf.to_user_id = @uid AND rf.done_at IS NULL) AS my_open_referrals
    FROM letters l
    LEFT JOIN users u ON u.id = l.created_by
    LEFT JOIN departments d ON d.id = l.department_id
    ORDER BY l.id DESC LIMIT 500`).all({ uid: req.user.id });
  const nq = str(q);
  const list = rows
    .filter(l => canSee(req.user, l))
    .filter(l => !direction || l.direction === direction)
    .filter(l => !mine || l.is_recipient || l.created_by === req.user.id || l.my_open_referrals)
    .filter(l => !nq || [l.subject, l.number, l.party, l.body].some(x => String(x || '').includes(nq)))
    .map(l => ({ ...l, attachments: parseJson(l.attachments, []), can_edit: canEdit(req.user, l) }));
  res.json({
    letters: list,
    // شمارِ کارهای بازِ من روی دبیرخانه — برای نشانِ کنار منو
    pending: list.filter(l => (l.is_recipient && !l.my_acked_at) || l.my_open_referrals).length,
    can_register: true,
  });
});

r.get('/:id', (req, res) => {
  const l = db.prepare(`SELECT l.*, u.full_name AS creator_name, d.name AS department_name
    FROM letters l LEFT JOIN users u ON u.id = l.created_by
    LEFT JOIN departments d ON d.id = l.department_id WHERE l.id = ?`).get(req.params.id);
  if (!l) return res.status(404).json({ error: 'نامه یافت نشد' });
  if (!canSee(req.user, l)) return res.status(403).json({ error: 'دسترسی به این نامه ندارید' });
  // باز کردن نامه = خوانده شد
  db.prepare(`UPDATE letter_recipients SET read_at = COALESCE(read_at, datetime('now'))
    WHERE letter_id = ? AND user_id = ?`).run(l.id, req.user.id);
  const recipients = recipientsOf(l.id);
  const mine = recipients.find(x => x.user_id === req.user.id) || null;
  res.json({
    letter: { ...l, attachments: parseJson(l.attachments, []) },
    recipients,
    referrals: referralsOf(l.id),
    can_edit: canEdit(req.user, l),
    can_ack: !!mine && !mine.acked_at,
    pending_ack: recipients.filter(x => x.must_ack && !x.acked_at).length,
  });
});

function setRecipients(letterId, list, kind, requireAck) {
  const ids = [...new Set((Array.isArray(list) ? list : []).map(Number).filter(Boolean))]
    .filter(id => db.prepare('SELECT 1 FROM users WHERE id = ? AND is_active = 1').get(id));
  db.prepare('DELETE FROM letter_recipients WHERE letter_id = ? AND kind = ?').run(letterId, kind);
  const ins = db.prepare('INSERT OR IGNORE INTO letter_recipients (letter_id, user_id, kind, must_ack) VALUES (?, ?, ?, ?)');
  for (const id of ids) ins.run(letterId, id, kind, requireAck ? 1 : 0);
  return ids;
}

r.post('/', (req, res) => {
  const b = req.body || {};
  const direction = DIRECTIONS[b.direction] ? b.direction : 'internal';
  const subject = str(b.subject);
  if (!subject) return res.status(400).json({ error: 'موضوع نامه الزامی است' });
  const number = str(b.number) || nextNumber(direction);
  const info = db.prepare(`INSERT INTO letters
    (number, direction, subject, body, letter_date, party, party_ref, department_id, attachments, confidential, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(number, direction, subject, String(b.body || '').slice(0, 20000), str(b.letter_date),
      str(b.party), str(b.party_ref), Number(b.department_id) || req.user.department_id || null,
      JSON.stringify(normalizeFileIds(b.attachments)), b.confidential ? 1 : 0, req.user.id);
  const id = Number(info.lastInsertRowid);
  const requireAck = b.require_ack === undefined ? true : !!b.require_ack;
  const to = setRecipients(id, b.to_ids, 'to', requireAck);
  const cc = setRecipients(id, b.cc_ids, 'cc', requireAck);
  const all = [...new Set([...to, ...cc])].filter(x => x !== req.user.id);
  if (all.length) {
    notifyUsers(all, {
      type: 'workflow',
      title: `نامهٔ ${DIRECTIONS[direction]}: ${subject}`,
      body: `${req.user.full_name} نامهٔ «${number}» را برای شما ثبت کرد`
        + (requireAck ? ' — لطفاً «دریافت شد» را بزنید' : ''),
      link: `/letters?l=${id}`,
    });
  }
  res.json({ id, number });
});

r.put('/:id', (req, res) => {
  const l = db.prepare('SELECT * FROM letters WHERE id = ?').get(req.params.id);
  if (!l) return res.status(404).json({ error: 'نامه یافت نشد' });
  if (!canEdit(req.user, l)) return res.status(403).json({ error: 'فقط ثبت‌کنندهٔ نامه یا دبیرخانه می‌تواند ویرایش کند' });
  const b = req.body || {};
  db.prepare(`UPDATE letters SET subject = ?, body = ?, letter_date = ?, party = ?, party_ref = ?,
    department_id = ?, attachments = ?, confidential = ?, status = ?, updated_at = datetime('now')
    WHERE id = ?`)
    .run(str(b.subject) || l.subject, b.body !== undefined ? String(b.body).slice(0, 20000) : l.body,
      b.letter_date !== undefined ? str(b.letter_date) : l.letter_date,
      b.party !== undefined ? str(b.party) : l.party,
      b.party_ref !== undefined ? str(b.party_ref) : l.party_ref,
      b.department_id !== undefined ? (Number(b.department_id) || null) : l.department_id,
      b.attachments !== undefined ? JSON.stringify(normalizeFileIds(b.attachments)) : l.attachments,
      b.confidential !== undefined ? (b.confidential ? 1 : 0) : l.confidential,
      ['registered', 'in_review', 'archived'].includes(b.status) ? b.status : l.status, l.id);
  if (b.to_ids !== undefined || b.cc_ids !== undefined) {
    const requireAck = b.require_ack === undefined ? true : !!b.require_ack;
    const before = recipientsOf(l.id).map(x => x.user_id);
    if (b.to_ids !== undefined) setRecipients(l.id, b.to_ids, 'to', requireAck);
    if (b.cc_ids !== undefined) setRecipients(l.id, b.cc_ids, 'cc', requireAck);
    const added = recipientsOf(l.id).map(x => x.user_id).filter(id => !before.includes(id) && id !== req.user.id);
    if (added.length) {
      notifyUsers(added, {
        type: 'workflow',
        title: `نامه: ${l.subject}`,
        body: `${req.user.full_name} شما را به گیرندگان نامهٔ «${l.number}» اضافه کرد`,
        link: `/letters?l=${l.id}`,
      });
    }
  }
  res.json({ ok: true });
});

r.delete('/:id', (req, res) => {
  const l = db.prepare('SELECT * FROM letters WHERE id = ?').get(req.params.id);
  if (!l) return res.status(404).json({ error: 'نامه یافت نشد' });
  if (!canEdit(req.user, l)) return res.status(403).json({ error: 'دسترسی غیرمجاز' });
  db.prepare('DELETE FROM letters WHERE id = ?').run(l.id);
  res.json({ ok: true });
});

// «دریافت شد» — همان چیزی که برای نامه‌های رونوشت‌دار خواسته شده بود
r.post('/:id/ack', (req, res) => {
  const l = db.prepare('SELECT * FROM letters WHERE id = ?').get(req.params.id);
  if (!l) return res.status(404).json({ error: 'نامه یافت نشد' });
  const row = db.prepare('SELECT * FROM letter_recipients WHERE letter_id = ? AND user_id = ?').get(l.id, req.user.id);
  if (!row) return res.status(403).json({ error: 'این نامه برای شما ثبت نشده است' });
  if (row.acked_at) return res.json({ ok: true, already: true });
  const note = str(req.body?.note).slice(0, 500);
  db.prepare(`UPDATE letter_recipients SET acked_at = datetime('now'), read_at = COALESCE(read_at, datetime('now')), note = ?
    WHERE letter_id = ? AND user_id = ?`).run(note, l.id, req.user.id);
  const pending = recipientsOf(l.id).filter(x => x.must_ack && !x.acked_at).length;
  if (l.created_by && l.created_by !== req.user.id) {
    notifyUsers([l.created_by], {
      type: 'workflow',
      title: 'نامه دریافت شد',
      body: `${req.user.full_name} دریافتِ نامهٔ «${l.number}» را تایید کرد`
        + (pending ? ` — ${pending.toLocaleString('fa-IR')} نفر باقی مانده` : ' — همه دریافت کردند'),
      link: `/letters?l=${l.id}`,
    });
  }
  res.json({ ok: true, pending });
});

// ارجاع نامه به همکار با دستور
r.post('/:id/refer', (req, res) => {
  const l = db.prepare('SELECT * FROM letters WHERE id = ?').get(req.params.id);
  if (!l) return res.status(404).json({ error: 'نامه یافت نشد' });
  if (!canSee(req.user, l)) return res.status(403).json({ error: 'دسترسی غیرمجاز' });
  const to = Number(req.body?.to_user_id);
  if (!db.prepare('SELECT 1 FROM users WHERE id = ? AND is_active = 1').get(to)) {
    return res.status(400).json({ error: 'گیرندهٔ ارجاع معتبر نیست' });
  }
  const info = db.prepare(`INSERT INTO letter_referrals (letter_id, from_user_id, to_user_id, instruction, due_at)
    VALUES (?, ?, ?, ?, ?)`)
    .run(l.id, req.user.id, to, str(req.body?.instruction).slice(0, 1000), str(req.body?.due_at) || null);
  notifyUsers([to], {
    type: 'workflow',
    title: `ارجاع نامه: ${l.subject}`,
    body: `${req.user.full_name} نامهٔ «${l.number}» را به شما ارجاع داد`
      + (str(req.body?.instruction) ? ` — ${str(req.body.instruction).slice(0, 120)}` : ''),
    link: `/letters?l=${l.id}`,
  });
  res.json({ id: info.lastInsertRowid });
});

// اعلام نتیجهٔ ارجاع
r.post('/:id/referrals/:rid/done', (req, res) => {
  const ref = db.prepare('SELECT * FROM letter_referrals WHERE id = ? AND letter_id = ?')
    .get(req.params.rid, req.params.id);
  if (!ref) return res.status(404).json({ error: 'ارجاع یافت نشد' });
  if (ref.to_user_id !== req.user.id && !canAccessEverywhere(req.user)) {
    return res.status(403).json({ error: 'این ارجاع برای شما نیست' });
  }
  db.prepare("UPDATE letter_referrals SET done_at = datetime('now'), result = ? WHERE id = ?")
    .run(str(req.body?.result).slice(0, 1000), ref.id);
  if (ref.from_user_id && ref.from_user_id !== req.user.id) {
    const l = db.prepare('SELECT number, subject FROM letters WHERE id = ?').get(ref.letter_id);
    notifyUsers([ref.from_user_id], {
      type: 'workflow',
      title: 'ارجاع انجام شد',
      body: `${req.user.full_name} ارجاعِ نامهٔ «${l?.number || ''}» را انجام داد`,
      link: `/letters?l=${ref.letter_id}`,
    });
  }
  res.json({ ok: true });
});

// شمارهٔ ثبتِ پیشنهادی برای فرم
r.get('/meta/next-number', (req, res) => {
  const d = DIRECTIONS[req.query.direction] ? req.query.direction : 'internal';
  res.json({ number: nextNumber(d) });
});

export default r;
