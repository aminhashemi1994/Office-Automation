// ============================================================================
//  پشتیبانِ هوشمند — گفتگوی کاربر با مدل زبانی دربارهٔ کار با سامانه
//  تاریخچهٔ هر کاربر جداست و فقط خودش می‌بیند. اگر سرویس تنظیم نشده باشد،
//  بخش پشتیبانی هوشمند به‌کلی نمایش داده نمی‌شود و چیزی به بیرون نمی‌رود.
// ============================================================================
import { Router } from 'express';
import db from '../db.js';
import { requirePerm } from '../auth.js';
import { aiConfig, aiReady, askModel } from '../ai.js';
import { systemPrompt } from '../ai-knowledge.js';

const r = Router();

// Express ۴ خطای پرتاب‌شده در هندلرِ async را خودش نمی‌گیرد و نتیجه‌اش
// unhandled rejection است — یعنی سقوطِ کلِ سرور. این پوشش، خطا را به
// هندلرِ خطای سامانه می‌سپارد تا فقط همان درخواست ۵۰۰ بگیرد.
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);


// سقفِ سادهٔ مصرف: هر کاربر ۴۰ پرسش در ساعت — جلوی هزینهٔ ناخواسته را می‌گیرد
const HOURLY_LIMIT = Number(process.env.AI_HOURLY_LIMIT || 40);
// چند پیام آخر به‌عنوان بافتِ گفتگو فرستاده شود
const HISTORY_TURNS = 12;

r.get('/status', (req, res) => {
  const c = aiConfig();
  res.json({
    enabled: c.enabled,
    ready: aiReady(),
    model: c.model,
    // برای پیام راهنما در رابط کاربری: چه چیزی کم است
    missing: !c.enabled ? 'disabled' : !c.baseUrl ? 'base_url' : !c.apiKey ? 'api_key' : null,
  });
});

r.get('/chats', (req, res) => {
  const chats = db.prepare(`SELECT c.*,
      (SELECT COUNT(*) FROM ai_messages m WHERE m.chat_id = c.id) AS message_count
    FROM ai_chats c WHERE c.user_id = ? ORDER BY c.updated_at DESC, c.id DESC LIMIT 50`).all(req.user.id);
  res.json({ chats });
});

r.get('/chats/:id', (req, res) => {
  const chat = db.prepare('SELECT * FROM ai_chats WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!chat) return res.status(404).json({ error: 'گفتگو یافت نشد' });
  const messages = db.prepare('SELECT * FROM ai_messages WHERE chat_id = ? ORDER BY id').all(chat.id);
  res.json({ chat, messages });
});

r.delete('/chats/:id', (req, res) => {
  const chat = db.prepare('SELECT * FROM ai_chats WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!chat) return res.status(404).json({ error: 'گفتگو یافت نشد' });
  db.prepare('DELETE FROM ai_chats WHERE id = ?').run(chat.id);
  res.json({ ok: true });
});

r.post('/ask', wrap(async (req, res) => {
  if (!aiReady()) {
    return res.status(503).json({ error: 'پشتیبانی هوشمند هنوز پیکربندی نشده است؛ از مدیر سامانه بخواهید در «تنظیمات سازمان» آن را فعال کند' });
  }
  const message = String(req.body?.message || '').trim();
  if (!message) return res.status(400).json({ error: 'پرسش خالی است' });
  if (message.length > 4000) return res.status(400).json({ error: 'پرسش بیش از حد طولانی است' });

  const used = db.prepare(`SELECT COUNT(*) c FROM ai_messages m JOIN ai_chats ch ON ch.id = m.chat_id
    WHERE ch.user_id = ? AND m.role = 'user' AND m.created_at >= datetime('now', '-1 hour')`).get(req.user.id).c;
  if (used >= HOURLY_LIMIT) {
    return res.status(429).json({ error: 'تعداد پرسش‌های شما در این ساعت زیاد بوده است؛ کمی بعد دوباره تلاش کنید' });
  }

  // گفتگوی موجود یا تازه
  let chat = req.body?.chat_id
    ? db.prepare('SELECT * FROM ai_chats WHERE id = ? AND user_id = ?').get(req.body.chat_id, req.user.id)
    : null;
  if (!chat) {
    const info = db.prepare('INSERT INTO ai_chats (user_id, title) VALUES (?, ?)')
      .run(req.user.id, message.slice(0, 60));
    chat = db.prepare('SELECT * FROM ai_chats WHERE id = ?').get(info.lastInsertRowid);
  }

  const history = db.prepare('SELECT role, content FROM ai_messages WHERE chat_id = ? ORDER BY id DESC LIMIT ?')
    .all(chat.id, HISTORY_TURNS).reverse();
  const messages = [
    { role: 'system', content: systemPrompt(req.user) },
    ...history.map(m => ({ role: m.role, content: m.content })),
    { role: 'user', content: message },
  ];

  // پرسش کاربر پیش از تماس با سرویس ثبت می‌شود تا اگر پاسخ نیامد هم گم نشود
  db.prepare('INSERT INTO ai_messages (chat_id, role, content) VALUES (?, ?, ?)').run(chat.id, 'user', message);
  db.prepare("UPDATE ai_chats SET updated_at = datetime('now') WHERE id = ?").run(chat.id);

  let answer;
  try {
    answer = await askModel(messages);
  } catch (e) {
    return res.status(502).json({ error: e.message, chat_id: chat.id });
  }
  const info = db.prepare('INSERT INTO ai_messages (chat_id, role, content) VALUES (?, ?, ?)')
    .run(chat.id, 'assistant', answer);
  db.prepare("UPDATE ai_chats SET updated_at = datetime('now') WHERE id = ?").run(chat.id);
  res.json({
    chat_id: chat.id,
    answer,
    message: db.prepare('SELECT * FROM ai_messages WHERE id = ?').get(info.lastInsertRowid),
  });
}));

// آزمایشِ اتصال — فقط مدیر سامانه؛ برای دکمهٔ «تست اتصال» در تنظیمات
r.post('/test', requirePerm('settings.manage'), wrap(async (req, res) => {
  const c = aiConfig();
  if (!c.baseUrl || !c.apiKey) return res.status(400).json({ error: 'آدرس سرویس و کلید را وارد و ذخیره کنید' });
  try {
    const out = await askModel(
      [{ role: 'user', content: 'سلام. فقط و فقط بنویس: اتصال برقرار است.' }],
      { maxTokens: 30, model: req.body?.model || undefined });
    res.json({ ok: true, model: req.body?.model || c.model, answer: out });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
}));

export default r;
