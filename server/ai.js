// ============================================================================
//  اتصال به مدل زبانی (LLM)
//  از قراردادِ سازگار با OpenAI استفاده می‌شود (‎/chat/completions‎) تا هر ارائه‌دهنده‌ای
//  که همین قرارداد را دارد کار کند: OpenAI، سرویس‌های واسط داخلی، یا یک مدلِ محلی.
//  آدرس سرویس، کلید و نامِ مدل، همه از «تنظیمات سازمان» خوانده می‌شوند تا بدون
//  تغییرِ کد قابل عوض‌کردن باشند. تا وقتی کلید تنظیم نشده، این بخش خاموش است و
//  بقیهٔ سامانه کاملاً آفلاین کار می‌کند.
// ============================================================================
import db from './db.js';

const TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS || 60_000);

function get(key, fallback = '') {
  return db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key)?.value ?? fallback;
}

// مقادیرِ «تنظیمات سازمان» اولویت دارند؛ اگر خالی باشند از .env خوانده می‌شوند
// (llm_Token / AI_API_KEY، AI_BASE_URL، AI_MODEL) تا بدون پیکربندیِ دستی هم کار کند.
const ENV_KEY = () => String(process.env.AI_API_KEY || process.env.llm_Token || process.env.LLM_TOKEN || '').trim();
const ENV_BASE = () => String(process.env.AI_BASE_URL || 'https://api.gapgpt.app/v1').trim();
const ENV_MODEL = () => String(process.env.AI_MODEL || 'gpt-4.1-mini').trim();

export function aiConfig() {
  const dbKey = String(get('ai_api_key', '')).trim();
  const envKey = ENV_KEY();
  // کلیدِ .env همیشه با آدرسِ .env جفت می‌شود (آدرسِ ذخیره‌شده مالِ کلیدِ تنظیمات است)
  const base = (dbKey ? String(get('ai_base_url', '')).trim() : envKey ? ENV_BASE() : '').replace(/\/+$/, '');
  // وقتی کلید از .env آمده و مدیر هنوز سوییچ را دست نزده، دستیار روشن است
  const enabledSetting = get('ai_enabled', '');
  return {
    enabled: enabledSetting === '1' || (enabledSetting === '' && !!envKey),
    baseUrl: base,
    apiKey: dbKey || envKey,
    keySource: dbKey ? 'settings' : envKey ? 'env' : null,
    model: String(get('ai_model', '')).trim() || ENV_MODEL(),
    temperature: Number(get('ai_temperature', '0.3')) || 0,
  };
}

// آیا همه‌چیز برای پرسیدن آماده است؟
export function aiReady() {
  const c = aiConfig();
  return c.enabled && !!c.baseUrl && !!c.apiKey;
}

// درخواستِ خام به ‎/chat/completions‎ — پیامِ کاملِ مدل (متن یا tool_calls) را برمی‌گرداند.
// خطاها با پیام فارسیِ قابل‌فهم بالا می‌روند تا در رابط کاربری نمایش داده شوند.
async function complete(body, { model } = {}) {
  const c = aiConfig();
  if (!c.baseUrl) throw new Error('آدرس سرویس هوش مصنوعی تنظیم نشده است');
  if (!c.apiKey) throw new Error('کلید (API token) سرویس هوش مصنوعی تنظیم نشده است');

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let resp;
  try {
    resp = await fetch(`${c.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${c.apiKey}` },
      body: JSON.stringify({ model: model || c.model, temperature: c.temperature, ...body }),
      signal: ctrl.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    if (e.name === 'AbortError') throw new Error('پاسخی از سرویس هوش مصنوعی نرسید (زمان تمام شد)');
    throw new Error('اتصال به سرویس هوش مصنوعی برقرار نشد — اینترنت سرور و آدرس سرویس را بررسی کنید');
  }
  clearTimeout(timer);

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    let detail = '';
    try { detail = JSON.parse(text)?.error?.message || ''; } catch { detail = text.slice(0, 200); }
    if (resp.status === 401 || resp.status === 403) throw new Error('کلید سرویس هوش مصنوعی پذیرفته نشد (۴۰۱)');
    if (resp.status === 404) throw new Error(`مدل «${model || c.model}» روی این سرویس یافت نشد`);
    if (resp.status === 429) throw new Error('محدودیت تعداد درخواست سرویس هوش مصنوعی — کمی بعد دوباره تلاش کنید');
    throw new Error(`خطای سرویس هوش مصنوعی (${resp.status})${detail ? ': ' + detail : ''}`);
  }
  const data = await resp.json().catch(() => null);
  const message = data?.choices?.[0]?.message;
  if (!message) throw new Error('پاسخ سرویس هوش مصنوعی خالی بود');
  return message;
}

/**
 * یک پرسش را به مدل می‌فرستد و متنِ پاسخ را برمی‌گرداند.
 * messages: [{ role: 'system'|'user'|'assistant', content }]
 */
export async function askModel(messages, { maxTokens = 900, model, temperature } = {}) {
  const msg = await complete({
    messages, max_tokens: maxTokens, ...(temperature !== undefined ? { temperature } : {}),
  }, { model });
  if (!msg.content) throw new Error('پاسخ سرویس هوش مصنوعی خالی بود');
  return String(msg.content).trim();
}

/**
 * یک دورِ گفتگو با ابزارها (function calling). پیامِ مدل را همان‌طور که هست برمی‌گرداند:
 * { content, tool_calls? } — حلقهٔ اجرای ابزارها در routes/ai.js است.
 */
export async function chatWithTools(messages, tools, { maxTokens = 1500 } = {}) {
  return complete({ messages, tools, tool_choice: 'auto', max_tokens: maxTokens });
}
