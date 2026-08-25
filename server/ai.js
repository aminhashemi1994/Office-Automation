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

export function aiConfig() {
  const base = String(get('ai_base_url', '')).trim().replace(/\/+$/, '');
  return {
    enabled: get('ai_enabled', '0') === '1',
    baseUrl: base,
    apiKey: String(get('ai_api_key', '')).trim(),
    model: String(get('ai_model', '')).trim() || 'gpt-4o-mini',
    temperature: Number(get('ai_temperature', '0.3')) || 0,
  };
}

// آیا همه‌چیز برای پرسیدن آماده است؟
export function aiReady() {
  const c = aiConfig();
  return c.enabled && !!c.baseUrl && !!c.apiKey;
}

/**
 * یک پرسش را به مدل می‌فرستد و متنِ پاسخ را برمی‌گرداند.
 * messages: [{ role: 'system'|'user'|'assistant', content }]
 * خطاها با پیام فارسیِ قابل‌فهم بالا می‌روند تا در رابط کاربری نمایش داده شوند.
 */
export async function askModel(messages, { maxTokens = 900, model, temperature } = {}) {
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
      body: JSON.stringify({
        model: model || c.model,
        messages,
        temperature: temperature ?? c.temperature,
        max_tokens: maxTokens,
      }),
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
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error('پاسخ سرویس هوش مصنوعی خالی بود');
  return String(content).trim();
}
