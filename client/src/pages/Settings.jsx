import React, { useState, useRef, useEffect } from 'react';
import { Building2, Image, Trash2, Save, Printer, DatabaseBackup, Download, Plus, ShieldCheck, Paperclip } from 'lucide-react';
import { api, getToken } from '../api.js';
import { useStore } from '../store.jsx';
import { Field, Segmented } from '../components/common.jsx';
import ImageCropper from '../components/ImageCropper.jsx';
import { printRequest, fmtDateTime, fmtSize } from '../utils.js';

function BackupCard() {
  const { toast } = useStore();
  const [list, setList] = useState([]);
  const [busy, setBusy] = useState(false);
  const load = async () => { try { const r = await api('/backups'); setList(r.backups); } catch {} };
  useEffect(() => { load(); }, []);

  const create = async () => {
    setBusy(true);
    try { await api('/backups', { method: 'POST' }); await load(); toast('پشتیبان جدید ساخته شد'); }
    catch (e) { toast(e.message, 'error'); }
    setBusy(false);
  };
  const remove = async (b) => {
    if (!window.confirm('این فایل پشتیبان حذف شود؟')) return;
    try { await api(`/backups/${b.name}`, { method: 'DELETE' }); await load(); }
    catch (e) { toast(e.message, 'error'); }
  };
  const download = (b) => {
    // دانلود با توکن در query تا از احرازهویت عبور کند
    window.open(`/api/backups/${encodeURIComponent(b.name)}?token=${encodeURIComponent(getToken())}`, '_blank');
  };

  return (
    <div className="card card-pad" style={{ marginTop: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <DatabaseBackup size={17} />
        <b>پشتیبان‌گیری دیتابیس</b>
        <button className="btn btn-primary btn-sm" style={{ marginInlineStart: 'auto' }} disabled={busy} onClick={create}>
          <Plus size={15} /> پشتیبان جدید
        </button>
      </div>
      <p style={{ fontSize: 12.5, color: 'var(--text-3)', marginBottom: 14, lineHeight: 1.7, display: 'flex', alignItems: 'center', gap: 6 }}>
        <ShieldCheck size={14} style={{ color: 'var(--green)' }} />
        سامانه به‌صورت خودکار هر ۲۴ ساعت یک نسخهٔ سالم و کامل از دیتابیس می‌سازد و آخرین نسخه‌ها را نگه می‌دارد.
        می‌توانید هر لحظه پشتیبان دستی بسازید یا نسخه‌ای را برای نگهداری بیرون از سرور دانلود کنید.
      </p>
      {list.length === 0 && <div className="empty">هنوز پشتیبانی ساخته نشده است</div>}
      {list.map(b => (
        <div key={b.name} className="notif-item" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div className="stat-icon" style={{ width: 34, height: 34, background: 'var(--primary-soft)', color: 'var(--primary)' }}>
            <DatabaseBackup size={16} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: 13, direction: 'ltr', textAlign: 'right' }}>{b.name}</div>
            <div style={{ fontSize: 12, color: 'var(--text-3)' }}>{fmtDateTime(b.created_at)} · {fmtSize(b.size)}</div>
          </div>
          <button className="icon-btn" style={{ width: 30, height: 30 }} title="دانلود" onClick={() => download(b)}><Download size={14} /></button>
          <button className="icon-btn" style={{ width: 30, height: 30 }} title="حذف" onClick={() => remove(b)}><Trash2 size={14} /></button>
        </div>
      ))}
    </div>
  );
}

// [پیوست‌ها] کلید سراسریِ پیوست فایل در فرآیندها.
// خاموش‌کردن آن، پیوست را در همهٔ فرآیندها و همهٔ مراحل غیرفعال می‌کند
// (تنظیمِ ریزتر برای هر فرآیند/مرحله در صفحهٔ «فرآیندهای اداری» است).
function AttachmentsCard() {
  const { settings, refreshSettings, toast } = useStore();
  const [busy, setBusy] = useState(false);
  const on = settings.attachments_enabled !== '0';

  const change = async (v) => {
    setBusy(true);
    try {
      await api('/settings', { method: 'PUT', body: { attachments_enabled: v ? '1' : '0' } });
      await refreshSettings();
      toast(v ? 'پیوست فایل در سامانه فعال شد' : 'پیوست فایل در سامانه غیرفعال شد');
    } catch (e) { toast(e.message, 'error'); }
    setBusy(false);
  };

  return (
    <div className="card card-pad" style={{ marginTop: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <Paperclip size={17} />
        <b>پیوست فایل در فرآیندها</b>
        <span style={{ marginInlineStart: 'auto', opacity: busy ? .6 : 1 }}>
          <Segmented size="sm" value={on ? 1 : 0} onChange={v => change(!!v)}
            options={[
              { value: 1, label: 'فعال', tone: 'primary', hint: 'کاربران و تاییدکنندگان می‌توانند فایل پیوست کنند' },
              { value: 0, label: 'غیرفعال', hint: 'پیوست فایل در کل سامانه بسته می‌شود' },
            ]} />
        </span>
      </div>
      <p style={{ fontSize: 12.5, color: 'var(--text-3)', lineHeight: 1.8, margin: 0 }}>
        این کلید، پیوست فایل را به‌صورت <b>کلی</b> برای همهٔ فرآیندها روشن/خاموش می‌کند: هم فیلدهای فایلِ فرم‌ها و هم
        پیوستِ افرادِ سلسله‌مراتب (تایید/رد/یادداشت). برای تنظیم دقیق‌تر — اینکه در کدام فرآیند و کدام مرحله
        پیوست مجاز باشد — به صفحهٔ «فرآیندهای اداری» و ویرایش همان فرآیند بروید.
        {!on && <span style={{ color: 'var(--red)', fontWeight: 700 }}> در حال حاضر پیوست فایل در کل سامانه غیرفعال است.</span>}
      </p>
    </div>
  );
}

export default function Settings() {
  const { settings, refreshSettings, toast } = useStore();
  const [form, setForm] = useState({
    company_name: settings.company_name || '',
    company_subtitle: settings.company_subtitle || '',
    letterhead_address: settings.letterhead_address || '',
    letterhead_footer: settings.letterhead_footer || '',
  });
  const [busy, setBusy] = useState(false);
  const [logoBusy, setLogoBusy] = useState(false);
  const [cropLogo, setCropLogo] = useState(null);
  const logoRef = useRef(null);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const save = async () => {
    setBusy(true);
    try { await api('/settings', { method: 'PUT', body: form }); await refreshSettings(); toast('تنظیمات سربرگ ذخیره شد'); }
    catch (e) { toast(e.message, 'error'); }
    setBusy(false);
  };

  const uploadLogo = async (file) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) return toast('فقط فایل تصویری مجاز است', 'error');
    setLogoBusy(true);
    try {
      const fd = new FormData();
      fd.append('logo', file);
      await api('/settings/logo', { method: 'POST', formData: fd });
      await refreshSettings();
      toast('لوگو به‌روزرسانی شد');
    } catch (e) { toast(e.message, 'error'); }
    setLogoBusy(false);
  };

  const removeLogo = async () => {
    setLogoBusy(true);
    try { await api('/settings/logo', { method: 'DELETE' }); await refreshSettings(); toast('لوگو حذف شد'); }
    catch (e) { toast(e.message, 'error'); }
    setLogoBusy(false);
  };

  // پیش‌نمایش سربرگ روی یک نمونه درخواست ساختگی
  const preview = () => {
    const sample = {
      id: 0, title: 'نمونهٔ پیش‌نمایش سربرگ', template_name: 'درخواست نمونه',
      requester_name: 'کاربر نمونه', requester_department: 'واحد نمونه',
      created_at: new Date().toISOString(), status: 'approved', form_schema: '[]', form_data: '{}',
      steps: [], actions: [{ id: 0, action: 'submit', actor_name: 'کاربر نمونه', comment: '', created_at: new Date().toISOString() }],
    };
    printRequest(sample, 'نمونه', { ...settings, ...form });
  };

  return (
    <div className="content">
      <div className="page-head">
        <h2>تنظیمات سازمان و سربرگ چاپ</h2>
        <button className="btn btn-ghost" onClick={preview}><Printer size={16} /> پیش‌نمایش سربرگ</button>
      </div>

      <div className="grid-2">
        <div className="card card-pad">
          <b style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}><Building2 size={17} /> اطلاعات سربرگ</b>
          <Field label="نام سازمان">
            <input className="input" value={form.company_name} onChange={e => set('company_name', e.target.value)} />
          </Field>
          <Field label="زیرعنوان (مثلاً نوع فعالیت یا شعار)">
            <input className="input" value={form.company_subtitle} onChange={e => set('company_subtitle', e.target.value)} />
          </Field>
          <Field label="نشانی / اطلاعات تماس (اختیاری)">
            <input className="input" value={form.letterhead_address} onChange={e => set('letterhead_address', e.target.value)} />
          </Field>
          <Field label="متن پاورقی سند">
            <textarea className="input" value={form.letterhead_footer} onChange={e => set('letterhead_footer', e.target.value)} />
          </Field>
          <button className="btn btn-primary" disabled={busy} onClick={save}><Save size={16} /> ذخیره تنظیمات</button>
        </div>

        <div className="card card-pad">
          <b style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}><Image size={17} /> لوگوی سازمان</b>
          <div style={{
            width: '100%', height: 150, border: '1.5px dashed var(--border)', borderRadius: 12,
            display: 'grid', placeItems: 'center', background: '#fff', overflow: 'hidden', marginBottom: 14,
          }}>
            {settings.logo_path ? (
              <img src={`/branding/${settings.logo_path}`} alt="لوگو" style={{ maxWidth: '90%', maxHeight: '90%', objectFit: 'contain' }} />
            ) : (
              <span style={{ color: 'var(--text-3)', fontSize: 13 }}>لوگویی بارگذاری نشده است</span>
            )}
          </div>
          <input ref={logoRef} type="file" accept="image/*" hidden onChange={e => {
            const f = e.target.files[0]; e.target.value = '';
            if (!f) return;
            if (!f.type.startsWith('image/')) return toast('فقط فایل تصویری مجاز است', 'error');
            setCropLogo(f);
          }} />
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-ghost" disabled={logoBusy} onClick={() => logoRef.current?.click()}>
              <Image size={15} /> {logoBusy ? 'در حال بارگذاری…' : 'بارگذاری لوگو'}
            </button>
            {settings.logo_path && (
              <button className="btn btn-ghost" style={{ color: 'var(--red)' }} disabled={logoBusy} onClick={removeLogo}>
                <Trash2 size={15} /> حذف
              </button>
            )}
          </div>
          <p style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 12 }}>
            برای بهترین کیفیت چاپ، لوگوی شفاف (PNG) با پس‌زمینهٔ روشن استفاده کنید. حداکثر ۳ مگابایت.
          </p>
        </div>
      </div>

      <AttachmentsCard />

      <BackupCard />

      {cropLogo && (
        <ImageCropper
          file={cropLogo}
          title="برش لوگو"
          aspects={[{ label: 'مربع', value: 1 }, { label: '۱۶:۹', value: 16 / 9 }, { label: '۳:۱', value: 3 }, { label: '۴:۱', value: 4 }]}
          outputType="image/png"
          outputMaxW={720}
          onCancel={() => setCropLogo(null)}
          onDone={async (f) => { setCropLogo(null); await uploadLogo(f); }}
        />
      )}
    </div>
  );
}
