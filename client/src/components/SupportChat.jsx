// ============================================================================
//  دستیار هوشمند
//  دکمهٔ شناور در همهٔ صفحه‌ها. دستیار هم راهنمایی می‌کند و هم کار انجام می‌دهد
//  (ثبت درخواست، تایید/رد، تعریف فرآیند، وظیفه، یادداشت…). هر کارِ نوشتنی به‌شکلِ
//  «کارت تأیید» نمایش داده می‌شود و فقط با کلیکِ کاربر اجرا می‌شود.
//  اگر مدیر سامانه این بخش را پیکربندی نکرده باشد، اصلاً نمایش داده نمی‌شود.
// ============================================================================
import React, { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Bot, Send, X, Loader2, Sparkles, Trash2, Plus, Check, Ban, History, Maximize2, Minimize2,
  CheckCircle2, XCircle, ExternalLink, Wrench,
} from 'lucide-react';
import { api } from '../api.js';
import { useStore } from '../store.jsx';
import { fmtDateTime } from '../utils.js';

const SUGGESTIONS = [
  { icon: '📥', label: 'کارتابلم', text: 'چه کارهایی در کارتابلم منتظر من است؟' },
  { icon: '📝', label: 'ثبت درخواست جدید', text: 'می‌خواهم یک درخواست جدید در کارتابل ثبت کنم' },
  { icon: '✅', label: 'ساخت وظیفه', text: 'برای فردا ساعت ۱۰ یک وظیفه بساز' },
  { icon: '🏖️', label: 'ماندهٔ مرخصی', text: 'چقدر مرخصی برایم مانده؟' },
  { icon: '⚙️', label: 'تعریف فرآیند', text: 'یک فرآیند جدید تعریف کن' },
  { icon: '❓', label: 'اشتراک یادداشت', text: 'یادداشتم را چطور با همکارم به اشتراک بگذارم؟' },
];

const THINKING = ['در حال بررسی…', 'در حال خواندن اطلاعات سامانه…', 'در حال آماده‌کردن پاسخ…'];

// ---------------------------------------------------------------------------
//  Markdownِ ساده و امن (بدون innerHTML): پررنگ، کد، لینک، فهرست، تیتر
// ---------------------------------------------------------------------------
function Inline({ text, go }) {
  const parts = [];
  const re = /\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*|`([^`]+)`/g;
  let last = 0, m, i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    if (m[1]) {
      const href = m[2];
      const internal = /^\/(?!\/)/.test(href);   // «//دامنه» لینکِ بیرونی است، نه مسیرِ داخلی
      const safe = internal || /^https?:\/\//.test(href);
      parts.push(safe ? (
        <a key={i++} href={href} className="ai-link"
          target={internal ? undefined : '_blank'} rel="noreferrer"
          onClick={internal ? (e) => { e.preventDefault(); go(href); } : undefined}>
          {m[1]}{!internal && <ExternalLink size={11} />}
        </a>
      ) : m[1]);
    } else if (m[3]) parts.push(<b key={i++}>{m[3]}</b>);
    else if (m[4]) parts.push(<code key={i++} className="ai-code">{m[4]}</code>);
    last = re.lastIndex;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}

function Markdown({ text, go }) {
  const lines = String(text || '').split('\n');
  const out = [];
  let list = null;
  const flush = () => { if (list) { out.push(list); list = null; } };
  lines.forEach((raw, idx) => {
    const line = raw.trimEnd();
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    const num = /^\s*([0-9۰-۹]+)[.)]\s+(.*)$/.exec(line);
    if (bullet || num) {
      const ordered = !!num;
      if (!list || list.ordered !== ordered) { flush(); list = { ordered, items: [], key: idx }; }
      list.items.push(bullet ? bullet[1] : num[2]);
      return;
    }
    flush();
    const h = /^#{1,4}\s+(.*)$/.exec(line);
    if (h) out.push({ h: h[1], key: idx });
    else if (line.trim()) out.push({ p: line, key: idx });
    else out.push({ gap: true, key: idx });
  });
  flush();
  return (
    <div className="ai-md">
      {out.map(b => b.items ? (
        React.createElement(b.ordered ? 'ol' : 'ul', { key: b.key },
          b.items.map((it, j) => <li key={j}><Inline text={it} go={go} /></li>))
      ) : b.h ? <div key={b.key} className="ai-h"><Inline text={b.h} go={go} /></div>
        : b.p ? <div key={b.key}><Inline text={b.p} go={go} /></div>
          : <div key={b.key} className="ai-gap" />)}
    </div>
  );
}

// ---------------------------------------------------------------------------
//  کارت تأیید
// ---------------------------------------------------------------------------
const ACTION_STATE = {
  done: { label: 'انجام شد', cls: 'ok' },
  failed: { label: 'ناموفق', cls: 'bad' },
  cancelled: { label: 'لغو شد', cls: 'muted' },
  superseded: { label: 'با نسخهٔ جدیدتر جایگزین شد', cls: 'muted' },
  running: { label: 'در حال انجام…', cls: 'muted' },
};

function ActionCard({ action, onDecide, busy }) {
  const st = ACTION_STATE[action.status];
  const pending = action.status === 'pending';
  return (
    <div className={`ai-card ${pending ? '' : 'decided'} ${action.danger && pending ? 'danger' : ''}`}>
      <div className="ai-card-head">
        <Wrench size={14} />
        <b style={{ flex: 1 }}>{action.title || action.label}</b>
        {st && <span className={`ai-badge ${st.cls}`}>{st.label}</span>}
      </div>
      <div className="ai-card-body">
        {action.lines.map(([k, v], i) => (
          <div key={i} className="ai-kv">
            <span>{k}</span>
            <div>{String(v ?? '—')}</div>
          </div>
        ))}
        {action.note && <div className="ai-card-note">{action.note}</div>}
      </div>
      {pending && (
        <div className="ai-card-foot">
          <button className={`btn btn-sm ${action.danger ? 'btn-danger' : 'btn-primary'}`} disabled={busy}
            onClick={() => onDecide(action, 'confirm')}>
            {busy ? <Loader2 size={14} className="spin" /> : <Check size={14} />} تأیید و انجام
          </button>
          <button className="btn btn-sm" disabled={busy} onClick={() => onDecide(action, 'cancel')}>
            <Ban size={14} /> لغو
          </button>
          <small>بدون تأیید شما چیزی ثبت نمی‌شود</small>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
export default function SupportChat() {
  const { toast } = useStore();
  const navigate = useNavigate();
  const location = useLocation();
  const [status, setStatus] = useState(null);
  const [open, setOpen] = useState(false);
  const [wide, setWide] = useState(() => { try { return localStorage.getItem('ai_wide') === '1'; } catch { return false; } });
  const [showHistory, setShowHistory] = useState(false);
  const [chatId, setChatId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [thinking, setThinking] = useState(0);
  const [deciding, setDeciding] = useState(null);
  const [history, setHistory] = useState([]);
  const bottomRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => { api('/ai/status').then(setStatus).catch(() => setStatus(null)); }, []);
  useEffect(() => { if (open) api('/ai/chats').then(r => setHistory(r.chats)).catch(() => {}); }, [open, chatId]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, busy]);
  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 50); }, [open, chatId]);
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => setThinking(x => (x + 1) % THINKING.length), 2200);
    return () => clearInterval(t);
  }, [busy]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (!status?.ready) return null;   // پیکربندی نشده → چیزی نشان نده

  const go = (href) => { navigate(href); if (!wide && window.innerWidth < 720) setOpen(false); };
  const toggleWide = () => setWide(w => { try { localStorage.setItem('ai_wide', w ? '0' : '1'); } catch {} return !w; });

  const ask = async (q) => {
    const message = String(q ?? text).trim();
    if (!message || busy) return;
    setText('');
    setShowHistory(false);
    setMessages(m => [...m, { role: 'user', content: message, created_at: new Date().toISOString() }]);
    setBusy(true); setThinking(0);
    try {
      const r = await api('/ai/ask', { method: 'POST', body: { message, chat_id: chatId, page: location.pathname + location.search } });
      setChatId(r.chat_id);
      setMessages(m => [...m, r.message]);
    } catch (e) {
      setMessages(m => [...m, { role: 'assistant', content: `⚠️ ${e.message}`, error: true, created_at: new Date().toISOString() }]);
    }
    setBusy(false);
  };

  const decide = async (action, kind) => {
    setDeciding(action.id);
    try {
      const r = await api(`/ai/actions/${action.id}/${kind}`, { method: 'POST' });
      setMessages(ms => [
        ...ms.map(m => ({ ...m, actions: m.actions?.map(a => (a.id === action.id ? r.action : a)) })),
        r.message,
      ]);
    } catch (e) {
      toast(e.message, 'error');
      // وضعیتِ واقعی را از سرور بخوان (مثلاً اگر در زبانهٔ دیگری تأیید شده بود)
      if (chatId) openChat(chatId);
    }
    setDeciding(null);
  };

  const openChat = async (id) => {
    try {
      const r = await api(`/ai/chats/${id}`);
      setChatId(r.chat.id); setMessages(r.messages); setShowHistory(false);
    } catch (e) { toast(e.message, 'error'); }
  };
  const removeChat = async (id, e) => {
    e.stopPropagation();
    try {
      await api(`/ai/chats/${id}`, { method: 'DELETE' });
      setHistory(h => h.filter(c => c.id !== id));
      if (chatId === id) { setChatId(null); setMessages([]); }
    } catch (err) { toast(err.message, 'error'); }
  };
  const newChat = () => { setChatId(null); setMessages([]); setShowHistory(false); };

  const historyList = (limit = 50) => (
    <div style={{ display: 'grid', gap: 4 }}>
      {history.length === 0 && <small style={{ color: 'var(--text-3)' }}>هنوز گفتگویی ندارید.</small>}
      {history.slice(0, limit).map(c => (
        <div key={c.id} className={`support-history ${c.id === chatId ? 'active' : ''}`} onClick={() => openChat(c.id)}>
          <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.title || 'بدون عنوان'}</span>
          <small style={{ color: 'var(--text-3)' }}>{fmtDateTime(c.updated_at)}</small>
          <button className="ai-icon-del" title="حذف گفتگو" aria-label="حذف گفتگو" onClick={e => removeChat(c.id, e)}><Trash2 size={14} /></button>
        </div>
      ))}
    </div>
  );

  return (
    <>
      {!open && (
        <button className={`support-fab ${location.pathname.startsWith('/chat') ? 'raised' : ''}`} onClick={() => setOpen(true)} title="دستیار هوشمند">
          <Sparkles size={18} /> <span>دستیار</span>
        </button>
      )}

      {open && (
        <div className={`support-panel ${wide ? 'wide' : ''}`} role="dialog" aria-label="دستیار هوشمند">
          <div className="support-head">
            <div className="ai-avatar"><Bot size={19} /></div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <b style={{ display: 'block', fontSize: 14 }}>دستیار هوشمند</b>
              <small style={{ fontSize: 11 }}>راهنمایی و انجامِ کار با تأیید شما</small>
            </div>
            <button className={`ai-head-btn ${showHistory ? 'active' : ''}`} title="گفتگوهای پیشین" aria-label="گفتگوهای پیشین" onClick={() => setShowHistory(s => !s)}><History size={17} /></button>
            <button className="ai-head-btn" title="گفتگوی تازه" aria-label="گفتگوی تازه" onClick={newChat}><Plus size={18} /></button>
            <button className="ai-head-btn ai-hide-mobile" title={wide ? 'کوچک‌کردن' : 'بزرگ‌کردن'} aria-label={wide ? 'کوچک‌کردن' : 'بزرگ‌کردن'} onClick={toggleWide}>
              {wide ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
            </button>
            <button className="ai-head-btn" title="بستن (Esc)" aria-label="بستن" onClick={() => setOpen(false)}><X size={19} /></button>
          </div>

          <div className="support-body">
            {showHistory ? (
              <div>
                <div className="ai-section-title" style={{ marginTop: 0 }}>گفتگوهای پیشین</div>
                {historyList()}
              </div>
            ) : messages.length === 0 ? (
              <div>
                <div className="ai-welcome">
                  <div className="ai-welcome-icon"><Sparkles size={26} /></div>
                  <b>سلام! چه کمکی از من برمی‌آید؟</b>
                  <p>راهنمایی می‌کنم یا خودم کار را انجام می‌دهم؛ هر کاری پیش از انجام برای تأیید به شما نشان داده می‌شود.</p>
                </div>
                <div className="ai-section-title">پیشنهادها</div>
                <div className="ai-suggestions">
                  {SUGGESTIONS.map(s => (
                    <button key={s.text} className="support-suggestion" onClick={() => ask(s.text)}>
                      <span>{s.icon}</span>{s.label}
                    </button>
                  ))}
                </div>
                {history.length > 0 && (
                  <>
                    <div className="ai-section-title">گفتگوهای اخیر</div>
                    {historyList(4)}
                  </>
                )}
              </div>
            ) : null}

            {!showHistory && messages.map((m, i) => (
              m.role === 'user' ? (
                <div key={m.id || `u${i}`} className="support-msg me">{m.content}</div>
              ) : m.kind === 'action_result' ? (
                <div key={m.id || `r${i}`} className={`ai-result ${m.ok ? 'ok' : 'bad'}`}>
                  {m.ok ? <CheckCircle2 size={15} /> : <XCircle size={15} />}
                  <span style={{ flex: 1 }}>{m.content.replace(/^[✅❌]\s*/, '')}</span>
                  {m.link && <button className="btn btn-sm" onClick={() => go(m.link)}>مشاهده</button>}
                </div>
              ) : (
                <div key={m.id || `b${i}`} className="ai-bot-block">
                  {m.trace?.length > 0 && (
                    <div className="ai-trace">
                      {m.trace.map((t, j) => (
                        <span key={j} className={t.ok ? '' : 'bad'}>{t.ok ? '✓' : '!'} {t.label}</span>
                      ))}
                    </div>
                  )}
                  <div className={`support-msg bot ${m.error ? 'error' : ''}`}>
                    <Markdown text={m.content} go={go} />
                  </div>
                  {m.actions?.map(a => (
                    <ActionCard key={a.id} action={a} onDecide={decide} busy={deciding === a.id} />
                  ))}
                </div>
              )
            ))}
            {busy && !showHistory && (
              <div className="support-msg bot ai-typing">
                <Loader2 size={15} className="spin" /> {THINKING[thinking]}
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          <div className="support-foot">
            <textarea ref={inputRef} className="input" rows={1} style={{ flex: 1 }}
              placeholder="بپرسید یا بگویید چه کاری انجام شود…"
              value={text} onChange={e => setText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(); } }} />
            <button className="ai-send" disabled={busy || !text.trim()} onClick={() => ask()} title="ارسال" aria-label="ارسال"><Send size={17} style={{ transform: 'scaleX(-1)' }} /></button>
          </div>
          <small className="ai-disclaimer">
            پاسخ‌ها با هوش مصنوعی تولید می‌شوند و ممکن است خطا داشته باشند؛ کارت‌ها را پیش از تأیید با دقت بخوانید.
          </small>
        </div>
      )}
    </>
  );
}
