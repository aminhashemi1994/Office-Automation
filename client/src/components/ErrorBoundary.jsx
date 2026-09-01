// ============================================================================
//  مرزِ خطا
//  در React، یک خطای رندر کلِ درخت را برمی‌دارد و کاربر «صفحهٔ سفید» می‌بیند —
//  بدون هیچ سرنخی از اینکه چه شد. این کامپوننت جلوی آن را می‌گیرد: پیام فارسی
//  نشان می‌دهد، راه برگشت می‌دهد، و متن خطا را برای گزارش به پشتیبانی نگه می‌دارد.
// ============================================================================
import React from 'react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // در کنسول بماند تا هنگام پشتیبانی قابل دیدن باشد
    console.error('خطای رندر:', error, info?.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    const msg = this.state.error?.message || String(this.state.error);
    return (
      <div style={{
        minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24,
        background: 'var(--bg-2, #f6f7fb)', color: 'var(--text-1, #1a1c25)',
      }}>
        <div style={{
          maxWidth: 460, textAlign: 'center', background: 'var(--bg-1, #fff)',
          border: '1px solid var(--border, #e3e5ee)', borderRadius: 16, padding: '28px 26px',
        }}>
          <div style={{ fontSize: 34, marginBottom: 10 }}>⚠️</div>
          <h2 style={{ fontSize: 17, fontWeight: 800, margin: '0 0 8px' }}>مشکلی در نمایش این صفحه پیش آمد</h2>
          <p style={{ fontSize: 13, color: 'var(--text-2, #5c6079)', lineHeight: 2, margin: '0 0 18px' }}>
            اطلاعات شما سالم است و چیزی از دست نرفته. صفحه را دوباره بارگذاری کنید؛
            اگر باز هم تکرار شد، متن زیر را به مدیر سامانه بدهید.
          </p>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap', marginBottom: 14 }}>
            <button className="btn btn-primary" onClick={() => window.location.reload()}>بارگذاری دوباره</button>
            <button className="btn btn-ghost" onClick={() => { window.location.href = '/'; }}>رفتن به داشبورد</button>
          </div>
          <details style={{ textAlign: 'right' }}>
            <summary style={{ cursor: 'pointer', fontSize: 12, color: 'var(--text-3, #8a8fa6)' }}>جزئیات فنی</summary>
            <pre style={{
              marginTop: 8, fontSize: 11, direction: 'ltr', textAlign: 'left', whiteSpace: 'pre-wrap',
              background: 'var(--bg-2, #f6f7fb)', padding: 10, borderRadius: 8, maxHeight: 160, overflow: 'auto',
            }}>{msg}</pre>
          </details>
        </div>
      </div>
    );
  }
}
