import React, { useState, useRef } from 'react';
import { KeyRound, Camera, Trash2, PenLine, ShieldCheck, Bell, Phone, Play, Square, Upload } from 'lucide-react';
import { api, getToken } from '../api.js';
import { useStore } from '../store.jsx';
import { Field, Avatar, Segmented } from '../components/common.jsx';
import ImageCropper from '../components/ImageCropper.jsx';
import DelegationCard from '../components/DelegationCard.jsx';

export default function Profile() {
  const { user, departments, toast, reloadUser, refreshDirectory, requestNotifPermission, notifEnabled, setNotifEnabled } = useStore();
  const [osNotif, setOsNotif] = useState(typeof Notification !== 'undefined' ? Notification.permission : 'unsupported');
  const enableOsNotif = async () => {
    const p = await requestNotifPermission();
    setOsNotif(p);
    if (p === 'granted') toast('اعلان‌های سیستم‌عامل فعال شد');
    else if (p === 'denied') toast('اعلان‌ها در مرورگر مسدود شده‌اند؛ از تنظیمات مرورگر اجازه دهید', 'error');
  };
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [next2, setNext2] = useState('');
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [sigUploading, setSigUploading] = useState(false);
  const [sigVersion, setSigVersion] = useState(0); // برای بی‌اعتبارکردن کش تصویر بعد از تغییر
  const [cropAvatar, setCropAvatar] = useState(null); // File منتظر برش
  const [cropSig, setCropSig] = useState(null);
  const fileRef = useRef(null);
  const sigRef = useRef(null);
  const dept = departments.find(d => d.id === user.department_id);
  // همهٔ کاربران می‌توانند امضای خود را ثبت کنند — چون با «تاییدکنندگان جایگزین»
  // هر کاربری ممکن است در گردش کاری تاییدکننده شود و به امضا نیاز پیدا کند.

  const pickImage = (file, setter) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) return toast('فقط فایل تصویری مجاز است', 'error');
    setter(file);
  };

  const uploadSignature = async (file) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) return toast('فقط فایل تصویری مجاز است', 'error');
    setSigUploading(true);
    try {
      const fd = new FormData();
      fd.append('signature', file);
      await api(`/users/${user.id}/signature`, { method: 'POST', formData: fd });
      await reloadUser();
      setSigVersion(v => v + 1);
      toast('امضای شما ثبت شد');
    } catch (e) { toast(e.message, 'error'); }
    setSigUploading(false);
  };

  const removeSignature = async () => {
    if (!window.confirm('امضای شما حذف شود؟ در اسناد جدید دیگر درج نمی‌شود.')) return;
    setSigUploading(true);
    try {
      await api(`/users/${user.id}/signature`, { method: 'DELETE' });
      await reloadUser();
      setSigVersion(v => v + 1);
      toast('امضا حذف شد');
    } catch (e) { toast(e.message, 'error'); }
    setSigUploading(false);
  };

  // ---------- صداهای دلخواه (زنگ تماس / اعلان) ----------
  const ringInputRef = useRef(null);
  const notifInputRef = useRef(null);
  const [soundBusy, setSoundBusy] = useState('');
  const [playing, setPlaying] = useState(''); // kind در حال پخش
  const previewRef = useRef(null);

  const soundSrc = (kind) => {
    if (kind === 'ringtone') return user.ringtone_path ? `/usersounds/${user.ringtone_path}` : '/sounds/ringtone.mp3';
    return user.notif_sound_path ? `/usersounds/${user.notif_sound_path}` : '/sounds/notification.mp3';
  };
  const stopPreview = () => {
    try { previewRef.current?.pause(); } catch {}
    setPlaying('');
  };
  // با کلیک دوباره روی همان دکمه، پخش قطع می‌شود (toggle)
  const previewSound = (kind) => {
    if (playing === kind) { stopPreview(); return; }
    try {
      const a = previewRef.current || (previewRef.current = new Audio());
      a.pause();
      a.onended = () => setPlaying('');
      a.src = soundSrc(kind) + `?t=${Date.now()}`;
      a.currentTime = 0;
      a.play?.().then(() => setPlaying(kind)).catch(() => setPlaying(''));
    } catch { setPlaying(''); }
  };
  const uploadSound = async (kind, file) => {
    if (!file) return;
    const okType = file.type.includes('audio') || /\.mp3$/i.test(file.name);
    if (!okType) return toast('فقط فایل mp3 مجاز است', 'error');
    if (file.size > 3 * 1024 * 1024) return toast('حجم فایل باید کمتر از ۳ مگابایت باشد', 'error');
    setSoundBusy(kind);
    try {
      const fd = new FormData();
      fd.append('sound', file);
      await api(`/users/${user.id}/sound/${kind}`, { method: 'POST', formData: fd });
      await reloadUser();
      toast(kind === 'ringtone' ? 'زنگ تماس شما تنظیم شد' : 'صدای اعلان شما تنظیم شد');
    } catch (e) { toast(e.message, 'error'); }
    setSoundBusy('');
  };
  const removeSound = async (kind) => {
    setSoundBusy(kind);
    try {
      await api(`/users/${user.id}/sound/${kind}`, { method: 'DELETE' });
      await reloadUser();
      toast('به صدای پیش‌فرض بازگشت');
    } catch (e) { toast(e.message, 'error'); }
    setSoundBusy('');
  };

  const uploadAvatar = async (file) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) return toast('فقط فایل تصویری مجاز است', 'error');
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('avatar', file);
      await api(`/users/${user.id}/avatar`, { method: 'POST', formData: fd });
      await reloadUser();
      await refreshDirectory();
      toast('عکس پروفایل به‌روزرسانی شد');
    } catch (e) { toast(e.message, 'error'); }
    setUploading(false);
  };

  const removeAvatar = async () => {
    setUploading(true);
    try {
      await api(`/users/${user.id}/avatar`, { method: 'DELETE' });
      await reloadUser();
      await refreshDirectory();
      toast('عکس پروفایل حذف شد');
    } catch (e) { toast(e.message, 'error'); }
    setUploading(false);
  };

  const change = async () => {
    if (next !== next2) return toast('تکرار رمز عبور مطابقت ندارد', 'error');
    setBusy(true);
    try {
      await api('/auth/change-password', { method: 'POST', body: { current, next } });
      toast('رمز عبور با موفقیت تغییر کرد');
      setCurrent(''); setNext(''); setNext2('');
    } catch (e) { toast(e.message, 'error'); }
    setBusy(false);
  };

  return (
    <div className="content">
      <div className="grid-2">
        <div className="card card-pad">
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 18 }}>
            <div className="avatar-edit" onClick={() => !uploading && fileRef.current?.click()} title="تغییر عکس پروفایل">
              <Avatar name={user.full_name} color={user.avatar_color} size={64} avatar={user.avatar_path} />
              <div className="overlay"><Camera size={20} /></div>
              <input ref={fileRef} type="file" accept="image/*" onChange={e => { pickImage(e.target.files[0], setCropAvatar); e.target.value = ''; }} />
            </div>
            <div>
              <h2 style={{ fontSize: 18, fontWeight: 800 }}>{user.full_name}</h2>
              <div style={{ color: 'var(--text-2)', fontSize: 13 }}>{user.position || '—'} · {dept?.name || 'بدون واحد'}</div>
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button className="btn btn-ghost btn-sm" disabled={uploading} onClick={() => fileRef.current?.click()}>
                  <Camera size={13} /> {uploading ? 'در حال بارگذاری…' : 'تغییر عکس'}
                </button>
                {user.avatar_path && (
                  <button className="btn btn-ghost btn-sm" style={{ color: 'var(--red)' }} disabled={uploading} onClick={removeAvatar}>
                    <Trash2 size={13} /> حذف عکس
                  </button>
                )}
              </div>
            </div>
          </div>
          {[['نام کاربری', user.username], ['نقش', { admin: 'مدیر سامانه', manager: 'سرگروه', employee: 'کارمند' }[user.role]],
            ['تلفن', user.phone || '—'], ['ایمیل', user.email || '—']].map(([k, v]) => (
            <div key={k} style={{ display: 'flex', gap: 10, padding: '9px 0', borderBottom: '1px solid var(--border-soft)' }}>
              <span style={{ color: 'var(--text-2)', fontSize: 13, minWidth: 110 }}>{k}:</span>
              <b style={{ fontSize: 13.5 }}>{v}</b>
            </div>
          ))}
        </div>
        <div className="card card-pad">
          <b style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}><KeyRound size={17} /> تغییر رمز عبور</b>
          <Field label="رمز عبور فعلی">
            <input className="input" type="password" value={current} onChange={e => setCurrent(e.target.value)} dir="ltr" />
          </Field>
          <Field label="رمز عبور جدید (حداقل ۶ کاراکتر)">
            <input className="input" type="password" value={next} onChange={e => setNext(e.target.value)} dir="ltr" />
          </Field>
          <Field label="تکرار رمز عبور جدید">
            <input className="input" type="password" value={next2} onChange={e => setNext2(e.target.value)} dir="ltr" />
          </Field>
          <button className="btn btn-primary" disabled={!current || next.length < 6 || busy} onClick={change}>تغییر رمز</button>
        </div>
      </div>

      {(
        <div className="card card-pad" style={{ marginTop: 18 }}>
          <b style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}><PenLine size={17} /> امضای تصویری</b>
          <p style={{ fontSize: 12.8, color: 'var(--text-2)', marginBottom: 14 }}>
            این امضا فقط وقتی درج می‌شود که <b>خودتان</b> مرحله‌ای از یک درخواست را «تایید» کنید و در نسخهٔ چاپی/بایگانی همان درخواست، کنار نام شما قرار می‌گیرد.
            توصیه می‌شود همهٔ کاربران امضای خود را ثبت کنند تا در صورت قرار گرفتن در زنجیرهٔ تایید (به‌ویژه به‌عنوان جایگزین)، سند ناقص نماند.
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
            <div style={{
              width: 220, height: 96, border: '1.5px dashed var(--border)', borderRadius: 12,
              display: 'grid', placeItems: 'center', background: '#fff', overflow: 'hidden',
            }}>
              {user.has_signature ? (
                <img src={`/api/users/${user.id}/signature?token=${encodeURIComponent(getToken())}&v=${sigVersion}`}
                  alt="امضای شما" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
              ) : (
                <span style={{ color: 'var(--text-3)', fontSize: 12.5 }}>امضایی ثبت نشده است</span>
              )}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <input ref={sigRef} type="file" accept="image/*" hidden
                onChange={e => { pickImage(e.target.files[0], setCropSig); e.target.value = ''; }} />
              <button className="btn btn-ghost btn-sm" disabled={sigUploading} onClick={() => sigRef.current?.click()}>
                <Camera size={13} /> {sigUploading ? 'در حال بارگذاری…' : (user.has_signature ? 'تغییر امضا' : 'بارگذاری امضا')}
              </button>
              {user.has_signature && (
                <button className="btn btn-ghost btn-sm" style={{ color: 'var(--red)' }} disabled={sigUploading} onClick={removeSignature}>
                  <Trash2 size={13} /> حذف امضا
                </button>
              )}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 14, padding: '10px 12px', background: 'var(--green-soft)', borderRadius: 10, fontSize: 12, color: 'var(--text-2)' }}>
            <ShieldCheck size={16} style={{ color: 'var(--green)', flexShrink: 0, marginTop: 1 }} />
            <span>
              نکات امنیتی: تنها خودِ شما می‌توانید امضای‌تان را بارگذاری کنید — حتی مدیر سامانه هم نمی‌تواند امضای شما را جای‌گذاری کند.
              تصویر امضا هرگز به‌صورت عمومی در دسترس نیست و فقط در بستر یک تاییدِ واقعی و برای افراد مجاز به دیدن آن درخواست نمایش داده می‌شود.
              کافی است امضا را روی کاغذ سفید بنویسید و با گوشی عکس بگیرید؛ هنگام بارگذاری، سامانه پس‌زمینهٔ سفید را به‌صورت خودکار حذف و امضای شفاف (PNG) می‌سازد و می‌توانید شدت آن را تنظیم کنید.
            </span>
          </div>
        </div>
      )}

      <div className="card card-pad" style={{ marginTop: 18 }}>
        <b style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}><Bell size={17} /> صداها</b>
        <p style={{ fontSize: 12.8, color: 'var(--text-2)', marginBottom: 14 }}>
          می‌توانید برای زنگ تماس و صدای اعلان، فایل mp3 دلخواه خودتان را بارگذاری کنید (حداکثر ۳ مگابایت). در غیر این صورت از صدای پیش‌فرض سامانه استفاده می‌شود.
        </p>

        {[
          { kind: 'ringtone', label: 'زنگ تماس', icon: Phone, custom: !!user.ringtone_path, ref: ringInputRef },
          { kind: 'notif', label: 'صدای اعلان و پیام', icon: Bell, custom: !!user.notif_sound_path, ref: notifInputRef },
        ].map(row => (
          <div key={row.kind} style={{
            display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
            padding: '12px 0', borderBottom: '1px solid var(--border-soft)',
          }}>
            <row.icon size={17} style={{ color: 'var(--text-3)' }} />
            <div style={{ flex: 1, minWidth: 130 }}>
              <div style={{ fontWeight: 600, fontSize: 13.5 }}>{row.label}</div>
              <div style={{ fontSize: 11.8, color: 'var(--text-3)' }}>
                {row.custom ? 'صدای دلخواه شما' : 'صدای پیش‌فرض سامانه'}
              </div>
            </div>
            <input ref={row.ref} type="file" accept="audio/*,.mp3" hidden
              onChange={e => { uploadSound(row.kind, e.target.files[0]); e.target.value = ''; }} />
            <button className="btn btn-ghost btn-sm" onClick={() => previewSound(row.kind)}>
              {playing === row.kind ? <><Square size={13} /> توقف</> : <><Play size={13} /> پخش</>}
            </button>
            <button className="btn btn-ghost btn-sm" disabled={soundBusy === row.kind} onClick={() => row.ref.current?.click()}>
              <Upload size={13} /> {soundBusy === row.kind ? 'در حال بارگذاری…' : 'بارگذاری mp3'}
            </button>
            {row.custom && (
              <button className="btn btn-ghost btn-sm" style={{ color: 'var(--red)' }} disabled={soundBusy === row.kind} onClick={() => removeSound(row.kind)}>
                <Trash2 size={13} /> پیش‌فرض
              </button>
            )}
          </div>
        ))}

        {/* [مورد ۴] فعال/غیرفعال بودن کلیِ اعلان‌ها — پیش‌فرض روشن */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', paddingTop: 14 }}>
          <Bell size={17} style={{ color: 'var(--text-3)' }} />
          <div style={{ flex: 1, minWidth: 130 }}>
            <div style={{ fontWeight: 600, fontSize: 13.5 }}>اعلان‌های سامانه</div>
            <div style={{ fontSize: 11.8, color: 'var(--text-3)' }}>
              پیش‌فرض روشن است. با خاموش‌کردن، دیگر اعلان روی سیستم‌عامل نمی‌گیرید.
            </div>
          </div>
          <Segmented size="sm" value={notifEnabled ? 1 : 0} onChange={v => setNotifEnabled(!!v)}
            options={[{ value: 1, label: 'روشن', tone: 'success' }, { value: 0, label: 'خاموش' }]} />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', paddingTop: 14, opacity: notifEnabled ? 1 : 0.5 }}>
          <Bell size={17} style={{ color: 'var(--text-3)' }} />
          <div style={{ flex: 1, minWidth: 130 }}>
            <div style={{ fontWeight: 600, fontSize: 13.5 }}>اعلان روی سیستم‌عامل</div>
            <div style={{ fontSize: 11.8, color: 'var(--text-3)' }}>
              {osNotif === 'granted' ? 'فعال — هنگام تماس یا اعلان جدید، حتی اگر در تب سامانه نباشید، مطلع می‌شوید'
                : osNotif === 'denied' ? 'مسدود شده در مرورگر'
                : osNotif === 'unsupported' ? 'مرورگر شما پشتیبانی نمی‌کند'
                : 'برای اطلاع هنگام نبودن در تب سامانه فعال کنید'}
            </div>
          </div>
          {osNotif !== 'granted' && osNotif !== 'unsupported' && (
            <button className="btn btn-ghost btn-sm" onClick={enableOsNotif}>
              <Bell size={13} /> فعال‌سازی
            </button>
          )}
        </div>
      </div>

      <DelegationCard />

      {cropAvatar && (
        <ImageCropper
          file={cropAvatar}
          title="برش عکس پروفایل"
          aspects={[{ label: 'مربع', value: 1 }]}
          round
          outputType="image/jpeg"
          outputMaxW={512}
          onCancel={() => setCropAvatar(null)}
          onDone={async (f) => { setCropAvatar(null); await uploadAvatar(f); }}
        />
      )}
      {cropSig && (
        <ImageCropper
          file={cropSig}
          title="برش و شفاف‌سازی امضا"
          aspects={[{ label: '۳:۱', value: 3 }, { label: '۲:۱', value: 2 }, { label: '۴:۱', value: 4 }, { label: 'مربع', value: 1 }]}
          outputType="image/png"
          outputMaxW={600}
          signature
          onCancel={() => setCropSig(null)}
          onDone={async (f) => { setCropSig(null); await uploadSignature(f); }}
        />
      )}
    </div>
  );
}
