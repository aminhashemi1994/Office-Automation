// ============================================================================
//  پشتیبانِ هوشمند — گفتگوی کاربر با مدل زبانی دربارهٔ کار با سامانه
//  تاریخچهٔ هر کاربر جداست و فقط خودش می‌بیند. اگر سرویس تنظیم نشده باشد،
//  بخش پشتیبانی هوشمند به‌کلی نمایش داده نمی‌شود و چیزی به بیرون نمی‌رود.
// ============================================================================
import { Router } from 'express';
import db from '../db.js';
import { requirePerm } from '../auth.js';
import { aiConfig, aiReady, askModel, chatWithTools } from '../ai.js';
import { toolDefsFor, ToolError, toolLabel, isWriteTool, runReadTool, prepareWriteTool, executeWriteTool } from '../ai-tools.js';
import { systemPrompt } from '../ai-knowledge.js';

const r = Router();

// Express ۴ خطای پرتاب‌شده در هندلرِ async را خودش نمی‌گیرد و نتیجه‌اش
// unhandled rejection است — یعنی سقوطِ کلِ سرور. این پوشش، خطا را به
// هندلرِ خطای سامانه می‌سپارد تا فقط همان درخواست ۵۰۰ بگیرد.
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);


// سقفِ سادهٔ مصرف: هر کاربر ۴۰ پرسش در ساعت — جلوی هزینهٔ ناخواسته را می‌گیرد
const HOURLY_LIMIT = Number(process.env.AI_HOURLY_LIMIT || 40);
// چند ردیفِ آخرِ رونوشت (پیام‌ها + فراخوانی ابزارها) به‌عنوان بافتِ گفتگو فرستاده شود
const HISTORY_ROWS = 60;
// حداکثر چند دور «فکر ← ابزار» در یک پرسش
const MAX_ROUNDS = 8;
const TOOL_RESULT_CHARS = 9000;
// سقفِ کلِ تاریخچه و نتیجهٔ ابزارهای دورهای قبلی (نویسه)
const HISTORY_CHARS = 36000;
const OLD_TOOL_CHARS = 1500;

r.get('/status', (req, res) => {
  const c = aiConfig();
  res.json({
    enabled: c.enabled,
    ready: aiReady(),
    model: c.model,
    key_source: c.keySource,
    can_act: true,
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
  const rows = db.prepare('SELECT * FROM ai_messages WHERE chat_id = ? ORDER BY id').all(chat.id);
  res.json({ chat, messages: rows.map(forClient).filter(Boolean) });
});

r.delete('/chats/:id', (req, res) => {
  const chat = db.prepare('SELECT * FROM ai_chats WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!chat) return res.status(404).json({ error: 'گفتگو یافت نشد' });
  db.prepare('DELETE FROM ai_chats WHERE id = ?').run(chat.id);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
//  ذخیره و بازخوانیِ پیام‌ها
//  رونوشتِ کامل (شامل فراخوانی ابزارها و نتیجه‌شان) ذخیره می‌شود تا در دورِ بعد
//  مدل بداند چه چیزی را قبلاً خوانده یا آماده کرده؛ کاربر فقط پیام‌های متنی را می‌بیند.
// ---------------------------------------------------------------------------
const parse = (s, d = null) => { try { return s ? JSON.parse(s) : d; } catch { return d; } };

function saveMsg(chatId, role, content, meta) {
  const info = db.prepare('INSERT INTO ai_messages (chat_id, role, content, meta) VALUES (?, ?, ?, ?)')
    .run(chatId, role, content ?? '', meta ? JSON.stringify(meta) : null);
  return db.prepare('SELECT * FROM ai_messages WHERE id = ?').get(info.lastInsertRowid);
}

function actionView(a) {
  if (!a) return null;
  const sum = parse(a.summary, {});
  return {
    id: a.id, tool: a.tool, label: toolLabel(a.tool), status: a.status,
    title: sum.title, lines: sum.lines || [], note: sum.note, danger: !!sum.danger,
    result: parse(a.result), created_at: a.created_at,
  };
}

function forClient(m) {
  const meta = parse(m.meta, {});
  if (m.role === 'tool' || (m.role === 'assistant' && meta.tool_calls)) return null;
  const actions = (meta.actions || [])
    .map(id => actionView(db.prepare('SELECT * FROM ai_actions WHERE id = ?').get(id))).filter(Boolean);
  return { id: m.id, role: m.role, content: m.content, created_at: m.created_at, kind: meta.kind, ok: meta.ok, link: meta.link, trace: meta.trace, actions };
}

// تاریخچه برای مدل: از اولین پیامِ کاربر در بازهٔ آخر شروع می‌شود تا زنجیرهٔ
// tool_call/tool نیمه‌کاره نماند (API چنین تاریخچه‌ای را رد می‌کند).
// نتیجهٔ ابزارهای دورهای قدیمی کوتاه می‌شود و کلِ تاریخچه سقفِ اندازه دارد تا هزینه مهار شود.
function historyFor(chatId) {
  const rows = db.prepare('SELECT * FROM ai_messages WHERE chat_id = ? ORDER BY id DESC LIMIT ?')
    .all(chatId, HISTORY_ROWS).reverse();
  const lastUser = rows.map(m => m.role).lastIndexOf('user');
  const msgs = rows.map((m, i) => {
    const meta = parse(m.meta, {});
    if (m.role === 'tool') {
      const old = i < lastUser;
      return { role: 'tool', tool_call_id: meta.tool_call_id, content: old && m.content.length > OLD_TOOL_CHARS ? m.content.slice(0, OLD_TOOL_CHARS) + '…(کوتاه‌شده)' : m.content };
    }
    if (m.role === 'assistant' && meta.tool_calls) return { role: 'assistant', content: m.content || null, tool_calls: meta.tool_calls };
    return { role: m.role, content: m.content };
  });
  // از آخر به اول تا سقفِ اندازه؛ بعد شروع از نخستین پیامِ کاربر
  let size = 0, from = msgs.length;
  while (from > 0) {
    const m = msgs[from - 1];
    size += (m.content || '').length + JSON.stringify(m.tool_calls || '').length;
    if (size > HISTORY_CHARS && from < msgs.length) break;
    from--;
  }
  // پیامِ آخرِ کاربر (همین پرسش) و هرچه بعدش آمده همیشه می‌ماند
  if (lastUser >= 0) from = Math.min(from, lastUser);
  const kept = msgs.slice(from);
  const start = kept.findIndex(m => m.role === 'user');
  return start < 0 ? [] : kept.slice(start);
}

// ---------------------------------------------------------------------------
//  حلقهٔ دستیار: مدل فکر می‌کند ← ابزار صدا می‌زند ← نتیجه را می‌بیند ← … ← پاسخ
// ---------------------------------------------------------------------------
async function runTool(user, chatId, call, userText) {
  const name = call.function?.name;
  let args = {};
  try { args = JSON.parse(call.function?.arguments || '{}'); } catch {
    return { out: { error: 'آرگومان‌ها JSON معتبر نبودند؛ دوباره تلاش کن' }, ok: false };
  }
  if (!toolDefsFor(user).some(t => t.function.name === name)) return { out: { error: `ابزار ${name} وجود ندارد` }, ok: false };
  try {
    if (!isWriteTool(name)) return { out: await runReadTool(user, name, args), ok: true };
    const prepared = await prepareWriteTool(user, name, args, { userText });
    // کارتِ قبلیِ همین نوع در این گفتگو کنار می‌رود — کاربر نسخهٔ اصلاح‌شده را تأیید می‌کند
    db.prepare(`UPDATE ai_actions SET status = 'superseded', decided_at = datetime('now')
      WHERE chat_id = ? AND tool = ? AND status = 'pending'`).run(chatId, name);
    const info = db.prepare('INSERT INTO ai_actions (chat_id, user_id, tool, payload, summary) VALUES (?, ?, ?, ?, ?)')
      .run(chatId, user.id, name, JSON.stringify(prepared.payload),
        JSON.stringify({ title: prepared.title, lines: prepared.lines, note: prepared.note, danger: prepared.danger }));
    const actionId = Number(info.lastInsertRowid);
    return {
      ok: true, actionId,
      out: { status: 'awaiting_user_confirmation', action_id: actionId, shown_to_user: prepared.lines, note: prepared.note,
        final_args: prepared.finalArgs,
        instruction: 'اگر کاربر بعداً چیزی را عوض کرد، همین final_args را مبنا بگیر (سرور تاریخ‌ها را اصلاح کرده) و فقط موردِ خواسته‌شده را تغییر بده. ' + 'هنوز چیزی ثبت/انجام نشده است. کارت تأیید به کاربر نشان داده شد؛ در یک جملهٔ کوتاه بخواه بررسی و روی «تأیید» بزند. هرگز نگو «ثبت شد» یا «انجام شد».' },
    };
  } catch (e) {
    if (e instanceof ToolError) {
      const { message, ...extra } = e;
      return { out: { error: message, ...extra }, ok: false };
    }
    console.error('[ai tool]', name, e);
    return { out: { error: 'خطای داخلی هنگام اجرای ابزار' }, ok: false };
  }
}

r.post('/ask', wrap(async (req, res) => {
  if (!aiReady()) {
    return res.status(503).json({ error: 'دستیار هوشمند هنوز پیکربندی نشده است؛ از مدیر سامانه بخواهید در «تنظیمات سازمان» آن را فعال کند' });
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

  // صفحه‌ای که کاربر الان در آن است — برای پرسش‌هایی مثل «این درخواست را تایید کن»
  const page = String(req.body?.page || '').slice(0, 200);
  // پرسش کاربر پیش از تماس با سرویس ثبت می‌شود تا اگر پاسخ نیامد هم گم نشود
  saveMsg(chat.id, 'user', message);
  db.prepare("UPDATE ai_chats SET updated_at = datetime('now') WHERE id = ?").run(chat.id);

  const system = systemPrompt(req.user) + (page ? `\n\nکاربر هم‌اکنون در این صفحه است: ${page}` : '');
  const messages = [{ role: 'system', content: system }, ...historyFor(chat.id)];
  const tools = toolDefsFor(req.user);
  const trace = [], actionIds = [];
  let answer = null;
  try {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      // دورِ آخر بدون ابزار — مدل باید با همین داده‌ها جمع‌بندی کند
      const last = round === MAX_ROUNDS - 1;
      const msg = last
        ? { content: await askModel(messages, { maxTokens: 1200 }) }
        : await chatWithTools(messages, tools);
      const calls = msg.tool_calls || [];
      if (!calls.length) { answer = String(msg.content || '').trim(); break; }

      const assistantTurn = { role: 'assistant', content: msg.content || null, tool_calls: calls.map(c => ({ id: c.id, type: 'function', function: c.function })) };
      messages.push(assistantTurn);
      saveMsg(chat.id, 'assistant', msg.content || '', { tool_calls: assistantTurn.tool_calls });
      for (const call of calls) {
        const { out, ok, actionId } = await runTool(req.user, chat.id, call, message);
        const content = JSON.stringify(out).slice(0, TOOL_RESULT_CHARS);
        messages.push({ role: 'tool', tool_call_id: call.id, content });
        saveMsg(chat.id, 'tool', content, { tool_call_id: call.id, name: call.function?.name });
        trace.push({ name: call.function?.name, label: toolLabel(call.function?.name), ok });
        if (actionId) actionIds.push(actionId);
      }
    }
  } catch (e) {
    return res.status(502).json({ error: e.message, chat_id: chat.id });
  }
  // فقط آخرین کارتِ هر نوع معتبر است (بقیه در همین دور جایگزین شده‌اند)
  const live = actionIds.filter(id => db.prepare("SELECT status FROM ai_actions WHERE id = ?").get(id)?.status === 'pending');
  if (!answer) answer = live.length ? 'لطفاً جزئیات را در کارت زیر بررسی و تأیید کنید.' : 'متأسفم، نتوانستم پاسخ مناسبی آماده کنم. لطفاً سؤال را دقیق‌تر بپرسید.';
  const saved = saveMsg(chat.id, 'assistant', answer, { trace, actions: live });
  db.prepare("UPDATE ai_chats SET updated_at = datetime('now') WHERE id = ?").run(chat.id);
  res.json({ chat_id: chat.id, answer, message: forClient(saved) });
}));

// ---------------------------------------------------------------------------
//  تأیید / لغوِ کارت‌ها — تنها راهِ اجرای یک اقدامِ نوشتنی
// ---------------------------------------------------------------------------
const ACTION_TTL_HOURS = 12;

function ownAction(req, res) {
  const a = db.prepare('SELECT * FROM ai_actions WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!a) { res.status(404).json({ error: 'اقدام یافت نشد' }); return null; }
  if (a.status !== 'pending') {
    const fa = { done: 'قبلاً انجام شده', failed: 'قبلاً ناموفق بوده', cancelled: 'لغو شده', superseded: 'با نسخهٔ جدیدتری جایگزین شده', running: 'در حال انجام است' }[a.status];
    res.status(409).json({ error: `این اقدام ${fa || 'دیگر معتبر نیست'}`, action: actionView(a) });
    return null;
  }
  return a;
}

r.post('/actions/:id/confirm', wrap(async (req, res) => {
  const a = ownAction(req, res);
  if (!a) return;
  const expired = db.prepare(`SELECT datetime(?, '+${ACTION_TTL_HOURS} hours') < datetime('now') AS x`).get(a.created_at).x;
  if (expired) {
    db.prepare("UPDATE ai_actions SET status = 'cancelled', decided_at = datetime('now') WHERE id = ?").run(a.id);
    return res.status(410).json({ error: 'این کارت منقضی شده است؛ از دستیار بخواهید دوباره آماده‌اش کند' });
  }
  // قفل: دو کلیکِ پشتِ سرهم فقط یک بار اجرا می‌شود
  const lock = db.prepare("UPDATE ai_actions SET status = 'running' WHERE id = ? AND status = 'pending'").run(a.id);
  if (!lock.changes) return res.status(409).json({ error: 'این اقدام در حال انجام است' });

  let status, result;
  try {
    result = await executeWriteTool(req.user, a.tool, parse(a.payload, {}));
    status = 'done';
  } catch (e) {
    if (!(e instanceof ToolError)) console.error('[ai action]', a.tool, e);
    result = { error: e instanceof ToolError ? e.message : 'خطای داخلی هنگام انجام' };
    status = 'failed';
  }
  db.prepare("UPDATE ai_actions SET status = ?, result = ?, decided_at = datetime('now') WHERE id = ?")
    .run(status, JSON.stringify(result), a.id);
  const text = status === 'done' ? `✅ ${result.message}` : `❌ انجام نشد: ${result.error}`;
  const saved = saveMsg(a.chat_id, 'assistant', text, { kind: 'action_result', ok: status === 'done', link: result.link });
  db.prepare("UPDATE ai_chats SET updated_at = datetime('now') WHERE id = ?").run(a.chat_id);
  res.json({ action: actionView(db.prepare('SELECT * FROM ai_actions WHERE id = ?').get(a.id)), message: forClient(saved) });
}));

r.post('/actions/:id/cancel', (req, res) => {
  const a = ownAction(req, res);
  if (!a) return;
  db.prepare("UPDATE ai_actions SET status = 'cancelled', decided_at = datetime('now') WHERE id = ?").run(a.id);
  const saved = saveMsg(a.chat_id, 'assistant', 'این اقدام لغو شد و چیزی ثبت نشد.', { kind: 'action_result', ok: false });
  res.json({ action: actionView(db.prepare('SELECT * FROM ai_actions WHERE id = ?').get(a.id)), message: forClient(saved) });
});

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
