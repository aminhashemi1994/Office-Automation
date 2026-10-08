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

// اگر کلید در .env باشد (AI_API_KEY یا llm_Token)، پیکربندیِ .env ملاک است و دستیار برای
// همهٔ کاربران روشن است (مگر AI_ENABLED=0). در غیر این صورت از «تنظیمات سازمان» خوانده می‌شود.
const env = (k, d = '') => String(process.env[k] ?? d).trim();
const ENV_KEY = () => env('AI_API_KEY') || env('llm_Token') || env('LLM_TOKEN');

export function aiConfig() {
  const envKey = ENV_KEY();
  if (envKey) {
    return {
      enabled: env('AI_ENABLED', '1') !== '0',
      baseUrl: env('AI_BASE_URL', 'https://api.gapgpt.app/v1').replace(/\/+$/, ''),
      apiKey: envKey,
      keySource: 'env',
      model: env('AI_MODEL', 'gpt-5-nano'),
      temperature: Number(env('AI_TEMPERATURE', '0.3')) || 0,
      reasoningEffort: env('AI_REASONING_EFFORT', 'low'),
    };
  }
  const dbKey = String(get('ai_api_key', '')).trim();
  return {
    enabled: get('ai_enabled', '0') === '1',
    baseUrl: String(get('ai_base_url', '')).trim().replace(/\/+$/, ''),
    apiKey: dbKey,
    keySource: dbKey ? 'settings' : null,
    model: String(get('ai_model', '')).trim() || 'gpt-4o-mini',
    temperature: Number(get('ai_temperature', '0.3')) || 0,
    reasoningEffort: env('AI_REASONING_EFFORT', 'low'),
  };
}

// مدل‌های استدلالی (gpt-5*، o1/o3/o4…) temperature دلخواه نمی‌پذیرند و توکن‌های فکرِ پنهان‌شان
// از سقفِ خروجی کم می‌شود؛ پس سقفِ بزرگ‌تر با max_completion_tokens و reasoning_effort می‌گیرند
const isReasoning = (model) => /^(gpt-5|o\d)/i.test(model);

// آیا همه‌چیز برای پرسیدن آماده است؟
export function aiReady() {
  const c = aiConfig();
  return c.enabled && !!c.baseUrl && !!c.apiKey;
}

function requestBody(c, model, { max_tokens, temperature, ...rest }) {
  if (isReasoning(model)) {
    return {
      model, ...rest,
      max_completion_tokens: Math.max(4000, (max_tokens || 1000) * 4),
      ...(c.reasoningEffort ? { reasoning_effort: c.reasoningEffort } : {}),
    };
  }
  return { model, temperature: temperature ?? c.temperature, max_tokens, ...rest };
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
      body: JSON.stringify(requestBody(c, model || c.model, body)),
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
