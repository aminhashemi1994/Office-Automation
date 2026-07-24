import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Send, Paperclip, Phone, Video, Plus, Users2, FileText, Download, UserPlus,
  MoreVertical, Trash2, LogOut, Ban, Flag, Radio, ShieldOff, ChevronRight,
} from 'lucide-react';
import { api, fileUrl } from '../api.js';
import { useStore } from '../store.jsx';
import { fmtTime, fmtRelative, fmtSize } from '../utils.js';
import { Avatar, Modal, Field, UserPicker, UserListPicker } from '../components/common.jsx';

const CONV_LABEL = { dm: '', group: 'گروه', channel: 'کانال' };

export default function Chat() {
  const { user, users, on, socketEmit, setActiveCall, toast } = useStore();
  const [convs, setConvs] = useState([]);
  const [active, setActive] = useState(null);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [search, setSearch] = useState('');
  const [newChat, setNewChat] = useState(null); // 'dm' | 'group' | 'channel'
  const [addMembers, setAddMembers] = useState(false);
  const [showMembers, setShowMembers] = useState(false);
  const [typing, setTyping] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [report, setReport] = useState(null); // {userId, name}
  const msgsRef = useRef(null);
  const fileRef = useRef(null);
  const activeRef = useRef(null);
  activeRef.current = active;

  const loadConvs = useCallback(async () => {
    const r = await api('/chat/conversations');
    setConvs(r.conversations);
    return r.conversations;
  }, []);

  // بازکردن گفتگو از لینک (?c=id) — مثلاً از نتایج جستجو
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    (async () => {
      const list = await loadConvs();
      const target = Number(searchParams.get('c'));
      if (target) {
        const c = list.find(x => x.id === target);
        if (c) openConv(c);
        setSearchParams({}, { replace: true });
      }
    })();
  }, [searchParams.get('c')]);

  useEffect(() => {
    const off1 = on('message:new', ({ conversation_id, message }) => {
      if (activeRef.current?.id === conversation_id) {
        setMessages(m => [...m, message]);
        api(`/chat/conversations/${conversation_id}/read`, { method: 'POST' });
      }
      loadConvs();
    });
    const off2 = on('conversation:new', () => loadConvs());
    const off3 = on('typing', ({ conversation_id, user_id, name }) => {
      if (activeRef.current?.id === conversation_id && user_id !== user.id) {
        setTyping(name);
        clearTimeout(window.__typingTimer);
        window.__typingTimer = setTimeout(() => setTyping(null), 2500);
      }
    });
    const off4 = on('conversation:left', ({ conversation_id }) => {
      if (activeRef.current?.id === conversation_id) setActive(null);
      loadConvs();
    });
    return () => { off1(); off2(); off3(); off4(); };
  }, []);

  useEffect(() => {
    msgsRef.current?.scrollTo({ top: msgsRef.current.scrollHeight });
  }, [messages]);

  const openConv = async (c) => {
    setActive(c);
    setTyping(null);
    const r = await api(`/chat/conversations/${c.id}/messages`);
    setMessages(r.messages);
    await api(`/chat/conversations/${c.id}/read`, { method: 'POST' });
    setConvs(list => list.map(x => x.id === c.id ? { ...x, unread: 0 } : x));
  };

  const send = async () => {
    const content = text.trim();
    if (!content || !active) return;
    setText('');
    try {
      await api(`/chat/conversations/${active.id}/messages`, { method: 'POST', body: { content } });
    } catch (e) { toast(e.message, 'error'); setText(content); }
  };

  const sendFile = async (file) => {
    if (!file || !active) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const r = await api('/chat/files', { method: 'POST', formData: fd });
      await api(`/chat/conversations/${active.id}/messages`, { method: 'POST', body: { file_id: r.file.id, content: '' } });
    } catch (e) { toast(e.message, 'error'); }
    setUploading(false);
  };

  const startCall = (video) => {
    if (!active) return;
    const room = `call:${active.id}:${Date.now()}`;
    const others = active.members.filter(m => m.id !== user.id).map(m => m.id);
    const title = active.type === 'group' ? active.display_name : `تماس با ${active.display_name}`;
    const group = active.type === 'group';
    // دعوت (زنگ‌خوردن طرف مقابل) فقط پس از گرفتن موفق میکروفون/دوربینِ خودمان ارسال می‌شود.
    // این کار را CallOverlay بعد از دسترسی موفق انجام می‌دهد تا اگر تماس برقرار نشد، طرف مقابل بی‌جهت زنگ نخورد.
    setActiveCall({
      room, video, title, conversation_id: active.id, group, outgoing: true,
      invite: { target_user_ids: others, video, title, conversation_id: active.id, group },
    });
  };

  const createChat = async ({ type, name, member_ids }) => {
    try {
      const r = await api('/chat/conversations', { method: 'POST', body: { type, name, member_ids } });
      setNewChat(null);
      await loadConvs();
      openConv(r.conversation);
    } catch (e) { toast(e.message, 'error'); }
  };

  const removeChat = async () => {
    if (!active) return;
    setMenuOpen(false);
    try {
      await api(`/chat/conversations/${active.id}/remove`, { method: 'POST' });
      setActive(null);
      await loadConvs();
      toast('گفتگو از فهرست شما حذف شد');
    } catch (e) { toast(e.message, 'error'); }
  };

  const leaveConv = async () => {
    if (!active) return;
    setMenuOpen(false);
    try {
      await api(`/chat/conversations/${active.id}/leave`, { method: 'POST' });
      setActive(null);
      await loadConvs();
      toast(active.type === 'channel' ? 'کانال را ترک کردید' : 'گروه را ترک کردید');
    } catch (e) { toast(e.message, 'error'); }
  };

  const toggleBlock = async () => {
    if (!active || active.type !== 'dm' || !active.other_id) return;
    setMenuOpen(false);
    try {
      if (active.is_blocked) {
        await api(`/chat/block/${active.other_id}`, { method: 'DELETE' });
        toast('کاربر از حالت مسدود خارج شد');
      } else {
        await api(`/chat/block/${active.other_id}`, { method: 'POST' });
        toast('کاربر مسدود شد');
      }
      const list = await loadConvs();
      const updated = list.find(c => c.id === active.id);
      if (updated) setActive(updated);
    } catch (e) { toast(e.message, 'error'); }
  };

  const submitReport = async (reason) => {
    if (!report) return;
    try {
      await api('/chat/report', { method: 'POST', body: { user_id: report.userId, reason, conversation_id: active?.id || null } });
      setReport(null);
      toast('گزارش شما برای مدیران ارسال شد');
    } catch (e) { toast(e.message, 'error'); }
  };

  const filtered = convs.filter(c => !search || c.display_name.includes(search));
  const isGroupAdmin = active?.members?.find(m => m.id === user.id)?.is_admin || user.role === 'admin';
  const isChannel = active?.type === 'channel';
  const isGroupLike = active?.type === 'group' || active?.type === 'channel';
  // اجازهٔ ارسال پیام: کانال فقط برای مدیر، گفتگوی مسدودشده ممنوع
  const canPost = active && (isChannel ? isGroupAdmin : !active.is_blocked);

  return (
    <div className="content no-pad">
      <div className={`chat-layout ${active ? 'has-active' : ''}`}>
        <div className="chat-list">
          <div className="chat-list-head">
            <input className="input" placeholder="جستجو…" value={search} onChange={e => setSearch(e.target.value)} style={{ flex: 1 }} />
            <button className="icon-btn" title="گفتگوی جدید" onClick={() => setNewChat('dm')}><Plus size={18} /></button>
            <button className="icon-btn" title="گروه جدید" onClick={() => setNewChat('group')}><Users2 size={18} /></button>
            <button className="icon-btn" title="کانال جدید (اطلاع‌رسانی)" onClick={() => setNewChat('channel')}><Radio size={18} /></button>
          </div>
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {filtered.length === 0 && <div className="empty">گفتگویی نیست<br />با دکمه + شروع کنید</div>}
            {filtered.map(c => {
              const other = c.type === 'dm' ? c.members.find(m => m.id !== user.id) : null;
              return (
                <div key={c.id} className={`chat-item ${active?.id === c.id ? 'active' : ''}`} onClick={() => openConv(c)}>
                  <Avatar name={c.display_name} color={other?.avatar_color || '#7c3aed'} size={42} showStatus={!!other} userId={other?.id} avatar={other?.avatar_path} />
                  <div className="meta">
                    <div className="name">
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 6 }}>
                        {c.type === 'channel' && <Radio size={13} style={{ color: 'var(--primary)', flexShrink: 0 }} />}
                        {c.type === 'group' && <Users2 size={13} style={{ color: 'var(--sky)', flexShrink: 0 }} />}
                        {c.display_name}
                      </span>
                      {c.last_message && <time>{fmtRelative(c.last_message.created_at)}</time>}
                    </div>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <span className="prev" style={{ flex: 1 }}>
                        {c.last_message ? (c.last_message.content || '📎 فایل') : 'بدون پیام'}
                      </span>
                      {c.unread > 0 && <span className="badge-count">{c.unread.toLocaleString('fa-IR')}</span>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="chat-pane">
          {!active ? (
            <div className="empty" style={{ margin: 'auto' }}>
              <Users2 size={44} />
              <div>یک گفتگو انتخاب کنید یا گفتگوی جدیدی بسازید</div>
            </div>
          ) : (
            <>
              <div className="chat-pane-head">
                <button className="icon-btn chat-back" title="بازگشت به فهرست" onClick={() => setActive(null)}><ChevronRight size={20} /></button>
                <Avatar name={active.display_name} color={active.type === 'dm' ? (active.members.find(m => m.id !== user.id)?.avatar_color) : '#7c3aed'} size={40}
                  avatar={active.type === 'dm' ? active.members.find(m => m.id !== user.id)?.avatar_path : undefined} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <b style={{ fontSize: 14.5, display: 'flex', alignItems: 'center', gap: 7 }}>
                    {active.display_name}
                    {isGroupLike && <span className={`conv-type ${active.type}`}>{CONV_LABEL[active.type]}</span>}
                    {active.is_blocked && <span className="conv-type" style={{ background: 'var(--red-soft)', color: 'var(--red)' }}>مسدود</span>}
                  </b>
                  <div style={{ fontSize: 12, color: 'var(--text-3)' }}>
                    {isGroupLike ? (
                      <button type="button" onClick={() => setShowMembers(true)}
                        style={{ background: 'none', border: 'none', padding: 0, color: 'var(--primary)', cursor: 'pointer', fontSize: 12 }}
                        title="مشاهدهٔ اعضا">
                        {active.members.length.toLocaleString('fa-IR')} عضو · مشاهده
                      </button>
                    ) : ''}
                  </div>
                </div>
                {isGroupLike && isGroupAdmin && (
                  <button className="icon-btn" title="افزودن عضو" onClick={() => setAddMembers(true)}><UserPlus size={18} /></button>
                )}
                {!isChannel && (
                  <>
                    <button className="icon-btn" title="تماس صوتی" onClick={() => startCall(false)}><Phone size={18} /></button>
                    <button className="icon-btn" title="تماس تصویری" onClick={() => startCall(true)}><Video size={18} /></button>
                  </>
                )}
                <div style={{ position: 'relative' }}>
                  <button className="icon-btn" title="گزینه‌ها" onClick={() => setMenuOpen(o => !o)}><MoreVertical size={18} /></button>
                  {menuOpen && (
                    <>
                      <div style={{ position: 'fixed', inset: 0, zIndex: 90 }} onClick={() => setMenuOpen(false)} />
                      <div className="menu" style={{ top: 'calc(100% + 6px)', left: 0 }}>
                        {active.type === 'dm' && (
                          <>
                            <button className="menu-item" onClick={toggleBlock}>
                              {active.is_blocked ? <ShieldOff size={16} /> : <Ban size={16} />}
                              {active.is_blocked ? 'رفع مسدودی کاربر' : 'مسدودسازی کاربر'}
                            </button>
                            <button className="menu-item danger" onClick={() => { setMenuOpen(false); setReport({ userId: active.other_id, name: active.display_name }); }}>
                              <Flag size={16} /> گزارش تخلف
                            </button>
                            <div className="menu-sep" />
                          </>
                        )}
                        {isGroupLike && (
                          <button className="menu-item danger" onClick={leaveConv}>
                            <LogOut size={16} /> {isChannel ? 'ترک کانال' : 'ترک گروه'}
                          </button>
                        )}
                        <button className="menu-item danger" onClick={removeChat}>
                          <Trash2 size={16} /> حذف گفتگو از فهرست من
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
              <div className="msgs" ref={msgsRef}>
                {messages.map(m => {
                  const mine = m.sender_id === user.id;
                  return (
                    <div key={m.id} className={`msg ${mine ? 'mine' : 'theirs'}`}>
                      {!mine && isGroupLike && (
                        <div className="sender" style={{ color: m.sender_color }}>{m.sender_name}</div>
                      )}
                      <div className="bubble">
                        {m.file_id ? (
                          <a className="msg-file" href={fileUrl(m.file_id)} download>
                            <div className="fi"><FileText size={19} /></div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontWeight: 600, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 220 }}>{m.file_name}</div>
                              <div style={{ fontSize: 11.5, opacity: .8 }}>{fmtSize(m.file_size)}</div>
                            </div>
                            <Download size={16} />
                          </a>
                        ) : m.content}
                      </div>
                      <div className="msg-meta">{fmtTime(m.created_at)}</div>
                    </div>
                  );
                })}
              </div>
              <div className="typing-hint">{typing ? `${typing} در حال نوشتن…` : ''}</div>
              {canPost ? (
                <div className="composer">
                  <button className="icon-btn" disabled={uploading} onClick={() => fileRef.current?.click()} title="پیوست فایل">
                    <Paperclip size={19} />
                  </button>
                  <input type="file" ref={fileRef} hidden onChange={e => { sendFile(e.target.files[0]); e.target.value = ''; }} />
                  <textarea
                    rows={1}
                    placeholder={uploading ? 'در حال ارسال فایل…' : isChannel ? 'ارسال اطلاع‌رسانی به اعضای کانال…' : 'پیام خود را بنویسید…'}
                    value={text}
                    onChange={e => { setText(e.target.value); socketEmit('typing', { conversation_id: active.id }); }}
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
                  />
                  <button className="btn btn-primary" style={{ borderRadius: 13, padding: '10px 16px' }} onClick={send}>
                    <Send size={17} style={{ transform: 'scaleX(-1)' }} />
                  </button>
                </div>
              ) : (
                <div className="composer" style={{ justifyContent: 'center', color: 'var(--text-3)', fontSize: 13 }}>
                  {active.is_blocked ? (
                    <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      این کاربر مسدود است.
                      <button className="btn btn-ghost btn-sm" onClick={toggleBlock}><ShieldOff size={14} /> رفع مسدودی</button>
                    </span>
                  ) : (
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Radio size={15} /> فقط مدیران کانال می‌توانند پیام ارسال کنند</span>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {newChat && <NewChatModal type={newChat} onClose={() => setNewChat(null)} onCreate={createChat} />}
      {report && <ReportModal target={report} onClose={() => setReport(null)} onSubmit={submitReport} />}
      {addMembers && active && (
        <AddMembersModal conv={active} onClose={() => setAddMembers(false)} onDone={async () => {
          setAddMembers(false);
          const list = await loadConvs();
          const updated = list.find(c => c.id === active.id);
          if (updated) setActive(updated);
        }} />
      )}
      {showMembers && active && (
        <MembersModal conv={active} canManage={isGroupAdmin} onClose={() => setShowMembers(false)}
          onChanged={async () => {
            const list = await loadConvs();
            const updated = list.find(c => c.id === active.id);
            if (updated) setActive(updated);
          }} />
      )}
    </div>
  );
}

// [مورد ۱] نمایش اعضای گروه/کانال + حذف عضو توسط مدیر
function MembersModal({ conv, canManage, onClose, onChanged }) {
  const { user, toast } = useStore();
  const [busy, setBusy] = useState(false);
  const members = conv.members || [];
  const remove = async (m) => {
    setBusy(true);
    try {
      await api(`/chat/conversations/${conv.id}/members/${m.id}`, { method: 'DELETE' });
      await onChanged();
      toast(`${m.full_name} از ${conv.type === 'channel' ? 'کانال' : 'گروه'} حذف شد`);
    } catch (e) { toast(e.message, 'error'); }
    setBusy(false);
  };
  return (
    <Modal title={`اعضای ${conv.display_name} (${members.length.toLocaleString('fa-IR')})`} onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 380, overflowY: 'auto' }}>
        {members.map(m => (
          <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 6px', borderBottom: '1px solid var(--border-soft)' }}>
            <Avatar name={m.full_name} color={m.avatar_color} size={34} showStatus userId={m.id} avatar={m.avatar_path} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <b style={{ fontSize: 13.5 }}>{m.full_name}{m.id === user.id ? ' (شما)' : ''}</b>
              {m.department_name && <div style={{ fontSize: 11.5, color: 'var(--text-3)' }}>{m.department_name}</div>}
            </div>
            {!!m.is_admin && <span className="badge badge-amber">مدیر</span>}
            {canManage && m.id !== user.id && (
              <button className="icon-btn" style={{ width: 30, height: 30, color: 'var(--red)' }} disabled={busy}
                title="حذف از گروه" onClick={() => remove(m)}><Trash2 size={15} /></button>
            )}
          </div>
        ))}
      </div>
    </Modal>
  );
}

function ReportModal({ target, onClose, onSubmit }) {
  const [reason, setReason] = useState('');
  return (
    <Modal title={`گزارش تخلف — ${target.name}`} onClose={onClose}
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>انصراف</button>
        <button className="btn btn-danger" onClick={() => onSubmit(reason.trim())}><Flag size={15} /> ارسال گزارش</button>
      </>}>
      <p style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 12 }}>
        گزارش شما برای مدیران سامانه ارسال می‌شود. لطفاً دلیل گزارش را بنویسید.
      </p>
      <Field label="دلیل گزارش">
        <textarea className="input" value={reason} onChange={e => setReason(e.target.value)} autoFocus
          placeholder="مثلاً: ارسال محتوای نامناسب، مزاحمت و…" />
      </Field>
    </Modal>
  );
}

function NewChatModal({ type, onClose, onCreate }) {
  const { user } = useStore();
  const [name, setName] = useState('');
  const [members, setMembers] = useState([]);
  const [dmTarget, setDmTarget] = useState(null);
  const isGroup = type === 'group';
  const isChannel = type === 'channel';
  const isGroupLike = isGroup || isChannel;
  const title = isChannel ? 'ساخت کانال جدید' : isGroup ? 'ساخت گروه جدید' : 'گفتگوی جدید';
  const valid = isGroupLike ? (name.trim() && members.length > 0) : !!dmTarget;
  return (
    <Modal title={title} onClose={onClose}
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>انصراف</button>
        <button className="btn btn-primary" disabled={!valid}
          onClick={() => onCreate({ type, name: name.trim(), member_ids: isGroupLike ? members : [dmTarget] })}>
          {isChannel ? 'ساخت کانال' : isGroup ? 'ساخت گروه' : 'شروع گفتگو'}
        </button>
      </>}>
      {isChannel && (
        <p style={{ fontSize: 12.8, color: 'var(--text-2)', marginBottom: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
          <Radio size={16} style={{ color: 'var(--primary)' }} /> در کانال فقط شما (و مدیران) می‌توانید پیام بفرستید؛ بقیه فقط دریافت می‌کنند.
        </p>
      )}
      {isGroupLike ? (
        <>
          <Field label={isChannel ? 'نام کانال' : 'نام گروه'}>
            <input className="input" value={name} onChange={e => setName(e.target.value)} autoFocus />
          </Field>
          <Field label={isChannel ? 'اعضا (دریافت‌کنندگان)' : 'اعضا'}>
            <UserListPicker multi value={members} onChange={setMembers} exclude={[user.id]} autoFocus={false} />
          </Field>
        </>
      ) : (
        <Field label="مخاطب را انتخاب کنید">
          <UserListPicker value={dmTarget} onChange={setDmTarget} exclude={[user.id]}
            onPick={(id) => onCreate({ type, name: '', member_ids: [id] })} />
        </Field>
      )}
    </Modal>
  );
}

function AddMembersModal({ conv, onClose, onDone }) {
  const { toast } = useStore();
  const [members, setMembers] = useState([]);
  const existing = conv.members.map(m => m.id);
  return (
    <Modal title="افزودن عضو به گروه" onClose={onClose}
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>انصراف</button>
        <button className="btn btn-primary" disabled={!members.length} onClick={async () => {
          try {
            await api(`/chat/conversations/${conv.id}/members`, { method: 'POST', body: { member_ids: members } });
            onDone();
          } catch (e) { toast(e.message, 'error'); }
        }}>افزودن</button>
      </>}>
      <UserListPicker multi value={members} onChange={setMembers} exclude={existing} />
    </Modal>
  );
}
