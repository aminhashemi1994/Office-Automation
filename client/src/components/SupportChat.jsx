// ============================================================================
//  پشتیبانی هوشمند
//  یک دکمهٔ شناور در داشبورد که گفتگو با دستیارِ سامانه را باز می‌کند.
//  دستیار «نقشهٔ سامانه» را می‌شناسد و کاربر را قدم‌به‌قدم راهنمایی می‌کند.
//  اگر مدیر سامانه این بخش را پیکربندی نکرده باشد، اصلاً نمایش داده نمی‌شود.
// ============================================================================
import React, { useEffect, useRef, useState } from 'react';
import { Bot, Send, X, Loader2, Sparkles, Trash2, Plus } from 'lucide-react';
import { api } from '../api.js';
import { useStore } from '../store.jsx';
import { fmtDateTime } from '../utils.js';

const SUGGESTIONS = [
  'چطور یک درخواست مرخصی ثبت کنم؟',
  'چطور برای یک وظیفه چک‌لیست و درصد پیشرفت بسازم؟',
  'یادداشتم را چطور با همکارم به اشتراک بگذارم؟',
  'گزارش عملکرد ماهانه‌ام را کجا ببینم؟',
];

export default function SupportChat() {
  const { toast } = useStore();
  const [status, setStatus] = useState(null);
  const [open, setOpen] = useState(false);
  const [chatId, setChatId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState([]);
  const bottomRef = useRef(null);

  useEffect(() => { api('/ai/status').then(setStatus).catch(() => setStatus(null)); }, []);
  useEffect(() => { if (open) api('/ai/chats').then(r => setHistory(r.chats)).catch(() => {}); }, [open, chatId]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, busy]);

  if (!status?.ready) return null;   // پیکربندی نشده → چیزی نشان نده

  const ask = async (q) => {
    const message = String(q ?? text).trim();
    if (!message || busy) return;
    setText('');
    setMessages(m => [...m, { role: 'user', content: message, created_at: new Date().toISOString() }]);
    setBusy(true);
    try {
      const r = await api('/ai/ask', { method: 'POST', body: { message, chat_id: chatId } });
      setChatId(r.chat_id);
      setMessages(m => [...m, r.message]);
    } catch (e) {
      setMessages(m => [...m, { role: 'assistant', content: `⚠️ ${e.message}`, error: true, created_at: new Date().toISOString() }]);
    }
    setBusy(false);
  };

  const openChat = async (id) => {
    try {
      const r = await api(`/ai/chats/${id}`);
      setChatId(r.chat.id); setMessages(r.messages);
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

  return (
    <>
      {!open && (
        <button className="support-fab" onClick={() => setOpen(true)} title="پشتیبانی هوشمند">
          <Bot size={20} /> <span>پشتیبانی</span>
        </button>
      )}

      {open && (
        <div className="support-panel">
          <div className="support-head">
            <Bot size={18} />
            <b style={{ flex: 1 }}>پشتیبانی هوشمند</b>
            <button className="icon-btn" title="گفتگوی تازه" onClick={() => { setChatId(null); setMessages([]); }}><Plus size={17} /></button>
            <button className="icon-btn" title="بستن" onClick={() => setOpen(false)}><X size={18} /></button>
          </div>

          <div className="support-body">
            {messages.length === 0 && (
              <div style={{ padding: '6px 2px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8, color: 'var(--text-2)', fontSize: 13 }}>
                  <Sparkles size={15} /> سلام! دربارهٔ کار با سامانه هرچه می‌خواهید بپرسید.
                </div>
                <div style={{ display: 'grid', gap: 6 }}>
                  {SUGGESTIONS.map(s => (
                    <button key={s} className="support-suggestion" onClick={() => ask(s)}>{s}</button>
                  ))}
                </div>
                {history.length > 0 && (
                  <div style={{ marginTop: 14 }}>
                    <small style={{ color: 'var(--text-3)' }}>گفتگوهای پیشین</small>
                    <div style={{ display: 'grid', gap: 4, marginTop: 6 }}>
                      {history.slice(0, 6).map(c => (
                        <div key={c.id} className="support-history" onClick={() => openChat(c.id)}>
                          <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.title || 'بدون عنوان'}</span>
                          <small style={{ color: 'var(--text-3)' }}>{fmtDateTime(c.updated_at)}</small>
                          <button className="icon-btn" style={{ color: 'var(--red)' }} onClick={e => removeChat(c.id, e)}><Trash2 size={13} /></button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {messages.map((m, i) => (
              <div key={i} className={`support-msg ${m.role === 'user' ? 'me' : 'bot'}`}>
                {m.content}
              </div>
            ))}
            {busy && (
              <div className="support-msg bot" style={{ display: 'flex', alignItems: 'center', gap: 7, color: 'var(--text-3)' }}>
                <Loader2 size={15} className="spin" /> در حال فکر کردن…
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          <div className="support-foot">
            <textarea className="input" style={{ flex: 1, minHeight: 38, maxHeight: 110 }} placeholder="پرسش خود را بنویسید…"
              value={text} onChange={e => setText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(); } }} />
            <button className="btn btn-primary" disabled={busy || !text.trim()} onClick={() => ask()}><Send size={15} /></button>
          </div>
          <small style={{ padding: '0 14px 10px', color: 'var(--text-3)', fontSize: 10.8, lineHeight: 1.7 }}>
            پاسخ‌ها توسط هوش مصنوعی تولید می‌شود و ممکن است خطا داشته باشد. برای کارهای حساس با مدیر سامانه هماهنگ کنید.
          </small>
        </div>
      )}
    </>
  );
}
