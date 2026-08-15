import React, { useState } from 'react';
import { Cable, LogIn, KeyRound, ArrowRight } from 'lucide-react';
import { api } from '../api.js';
import { useStore } from '../store.jsx';
import { Field } from '../components/common.jsx';

export default function Login() {
  const { login } = useStore();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [forgot, setForgot] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError('');
    try { await login(username, password); }
    catch (err) { setError(err.message); }
    setBusy(false);
  };

  return (
    <div className="login-page">
      {forgot ? (
        <ForgotCard initialUsername={username} onBack={() => { setForgot(false); setError(''); }} />
      ) : (
        <form className="login-card" onSubmit={submit}>
          <div style={{ textAlign: 'center', marginBottom: 26 }}>
            <div className="brand-logo" style={{ width: 62, height: 62, margin: '0 auto 14px', borderRadius: 18 }}>
              <Cable size={30} />
            </div>
            <h2 style={{ fontSize: 20, fontWeight: 800 }}>سامانه اتوماسیون توس‌کابل</h2>
            <p style={{ color: 'var(--text-2)', fontSize: 13, marginTop: 4 }}>کارخانه تولید سیم و کابل</p>
          </div>
          <Field label="نام کاربری">
            <input className="input" value={username} onChange={e => setUsername(e.target.value)} autoFocus dir="ltr" style={{ textAlign: 'left' }} />
          </Field>
          <Field label="رمز عبور">
            <input className="input" type="password" value={password} onChange={e => setPassword(e.target.value)} dir="ltr" style={{ textAlign: 'left' }} />
          </Field>
          {error && <div className="badge badge-red" style={{ width: '100%', justifyContent: 'center', padding: '8px', marginBottom: 12 }}>{error}</div>}
          <button className="btn btn-primary" style={{ width: '100%', padding: '12px' }} disabled={busy}>
            <LogIn size={17} /> {busy ? 'در حال ورود…' : 'ورود به سامانه'}
          </button>
          <button type="button" className="btn btn-ghost btn-sm"
            style={{ width: '100%', marginTop: 10 }} onClick={() => setForgot(true)}>
            <KeyRound size={15} /> رمز عبورم را فراموش کرده‌ام
          </button>
        </form>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- فراموشی رمز
// دو مسیر: اگر درگاه پیامک تنظیم و شمارهٔ موبایل کاربر ثبت باشد، کد یک‌بارمصرف
// می‌آید و خودِ کاربر رمزش را عوض می‌کند؛ در غیر این صورت درخواست برای مدیر
// سامانه ثبت می‌شود و او رمز تازه‌ای تعیین می‌کند.
function ForgotCard({ initialUsername, onBack }) {
  const [username, setUsername] = useState(initialUsername || '');
  const [step, setStep] = useState('ask');   // ask | code | done
  const [phoneMasked, setPhoneMasked] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const request = async (e) => {
    e.preventDefault();
    if (!username.trim()) return setError('نام کاربری را وارد کنید');
    setBusy(true); setError('');
    try {
      const r = await api('/auth/forgot', { method: 'POST', body: { username: username.trim() } });
      if (r.sms) { setPhoneMasked(r.phone_masked || ''); setStep('code'); }
      else { setMsg(r.message); setStep('done'); }
    } catch (err) { setError(err.message); }
    setBusy(false);
  };

  const reset = async (e) => {
    e.preventDefault();
    if (password.length < 6) return setError('رمز جدید باید حداقل ۶ کاراکتر باشد');
    if (password !== password2) return setError('تکرار رمز با رمز جدید یکی نیست');
    setBusy(true); setError('');
    try {
      await api('/auth/reset', { method: 'POST', body: { username: username.trim(), code, password } });
      setMsg('رمز عبور شما با موفقیت تغییر کرد. حالا می‌توانید وارد شوید.');
      setStep('done');
    } catch (err) { setError(err.message); }
    setBusy(false);
  };

  return (
    <form className="login-card" onSubmit={step === 'code' ? reset : request}>
      <div style={{ textAlign: 'center', marginBottom: 22 }}>
        <div className="brand-logo" style={{ width: 56, height: 56, margin: '0 auto 12px', borderRadius: 16 }}>
          <KeyRound size={26} />
        </div>
        <h2 style={{ fontSize: 18, fontWeight: 800 }}>بازیابی رمز عبور</h2>
      </div>

      {step === 'ask' && (
        <>
          <p style={{ fontSize: 12.8, color: 'var(--text-2)', lineHeight: 2, marginTop: 0 }}>
            نام کاربری‌تان را وارد کنید. اگر شمارهٔ موبایلتان در سامانه ثبت باشد و ارسال پیامک فعال
            باشد، کد بازیابی برایتان فرستاده می‌شود؛ در غیر این صورت درخواست برای مدیر سامانه ثبت
            می‌شود تا رمز تازه‌ای برایتان تعیین کند.
          </p>
          <Field label="نام کاربری">
            <input className="input" value={username} autoFocus dir="ltr" style={{ textAlign: 'left' }}
              onChange={e => setUsername(e.target.value)} />
          </Field>
        </>
      )}

      {step === 'code' && (
        <>
          <p style={{ fontSize: 12.8, color: 'var(--text-2)', lineHeight: 2, marginTop: 0 }}>
            کد بازیابی به شمارهٔ <b dir="ltr" style={{ display: 'inline-block' }}>{phoneMasked}</b> پیامک شد.
            کد ۱۵ دقیقه اعتبار دارد.
          </p>
          <Field label="کد بازیابی">
            <input className="input" value={code} autoFocus dir="ltr" inputMode="numeric" maxLength={6}
              style={{ textAlign: 'center', letterSpacing: 6, fontSize: 18 }}
              onChange={e => setCode(e.target.value.replace(/\D/g, ''))} />
          </Field>
          <Field label="رمز عبور جدید">
            <input className="input" type="password" value={password} dir="ltr" style={{ textAlign: 'left' }}
              onChange={e => setPassword(e.target.value)} />
          </Field>
          <Field label="تکرار رمز عبور جدید">
            <input className="input" type="password" value={password2} dir="ltr" style={{ textAlign: 'left' }}
              onChange={e => setPassword2(e.target.value)} />
          </Field>
        </>
      )}

      {step === 'done' && (
        <div className="badge badge-green" style={{ width: '100%', justifyContent: 'center', padding: '12px', marginBottom: 14, lineHeight: 1.9, whiteSpace: 'normal', height: 'auto' }}>
          {msg}
        </div>
      )}

      {error && (
        <div className="badge badge-red" style={{ width: '100%', justifyContent: 'center', padding: '8px', marginBottom: 12 }}>{error}</div>
      )}

      {step !== 'done' && (
        <button className="btn btn-primary" style={{ width: '100%', padding: '12px' }} disabled={busy}>
          {busy ? 'لطفاً صبر کنید…' : step === 'code' ? 'تغییر رمز عبور' : 'ارسال درخواست'}
        </button>
      )}
      <button type="button" className="btn btn-ghost btn-sm" style={{ width: '100%', marginTop: 10 }} onClick={onBack}>
        <ArrowRight size={15} /> بازگشت به صفحهٔ ورود
      </button>
    </form>
  );
}
