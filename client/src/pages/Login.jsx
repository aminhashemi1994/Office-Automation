import React, { useState } from 'react';
import { Cable, LogIn } from 'lucide-react';
import { useStore } from '../store.jsx';
import { Field } from '../components/common.jsx';

export default function Login() {
  const { login } = useStore();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError('');
    try { await login(username, password); }
    catch (err) { setError(err.message); }
    setBusy(false);
  };

  return (
    <div className="login-page">
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
      </form>
    </div>
  );
}
