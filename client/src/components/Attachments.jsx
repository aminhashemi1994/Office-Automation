import React, { useEffect, useState, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  Paperclip, X, Download, Eye, ExternalLink, ZoomIn, ZoomOut, AlertCircle,
  ChevronLeft, ChevronRight, File as FileIcon, FileText, FileSpreadsheet,
  FileArchive, FileImage, Presentation,
} from 'lucide-react';
import { uploadWorkflowFile, workflowFileUrl, workflowFileDownloadUrl, fetchWorkflowFilesMeta } from '../api.js';
import { fmtSize, fa } from '../utils.js';
import { useStore } from '../store.jsx';

// ============================================================================
// پیوستِ فایل (هر نوع سند: عکس، PDF، Word، Excel، PowerPoint، متن، فایل فشرده و …)
//  • عکس و PDF و متن → با کلیک در نمایشگر تمام‌صفحه باز می‌شوند (+ امکان دانلود)
//  • بقیهٔ فایل‌ها → با کلیک دانلود می‌شوند تا کاربر با برنامهٔ خودش بازشان کند
// همه‌جای فرآیندها/کارتابل از همین اجزا استفاده می‌کند تا نمایش پیوست‌ها یکدست باشد.
// ============================================================================

// مقدارِ یک فیلدِ فایلی همیشه آرایه‌ای از شناسهٔ فایل است.
// (سازگاری با دادهٔ قدیمیِ تک‌فایلی: مقدار عددی/رشته‌ای هم پذیرفته می‌شود.)
export function toFileIds(value) {
  if (Array.isArray(value)) return value.map(Number).filter(Boolean);
  return Number(value) ? [Number(value)] : [];
}

// ---------- کَشِ اطلاعات فایل‌ها (نام/نوع/حجم) ----------
const metaCache = new Map();
const listeners = new Set();
let version = 0;

// اطلاعات فایل‌هایی که سرور همراه پاسخ فرستاده را در کش بگذار (بدون درخواست اضافه)
export function primeFilesMeta(files) {
  let changed = false;
  for (const f of files || []) {
    const id = Number(f?.id);
    if (!id) continue;
    const prev = metaCache.get(id);
    if (!prev || prev.original_name !== f.original_name || prev.size !== f.size) {
      metaCache.set(id, { id, original_name: f.original_name || '', mime: f.mime || '', size: Number(f.size) || 0 });
      changed = true;
    }
  }
  if (changed) { version++; listeners.forEach(fn => fn(version)); }
}

// اطلاعات فایل‌های موردنیاز را (اگر در کش نبود) از سرور می‌گیرد و یک getter برمی‌گرداند
export function useFilesMeta(ids) {
  const list = toFileIds(ids);
  const key = list.join(',');
  const [, setV] = useState(0);

  useEffect(() => {
    const fn = (v) => setV(v);
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  }, []);

  useEffect(() => {
    const missing = list.filter(id => !metaCache.has(id));
    if (!missing.length) return;
    let alive = true;
    fetchWorkflowFilesMeta(missing)
      .then(files => { if (alive) primeFilesMeta(files); })
      .catch(() => {});
    return () => { alive = false; };
  }, [key]);

  return (id) => metaCache.get(Number(id));
}

// ---------- تشخیص نوع فایل ----------
const EXT = (name = '') => {
  const m = String(name).match(/\.([a-z0-9]+)$/i);
  return m ? m[1].toLowerCase() : '';
};

// عکسِ قابل نمایش (SVG استثناست: سرور آن را برای امنیت به‌صورت دانلود می‌دهد)
export function isImageFile(meta) {
  if (!meta) return false;
  const mime = meta.mime || '';
  if (mime.startsWith('image/')) return !mime.includes('svg');
  return ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tif', 'tiff', 'heic', 'avif'].includes(EXT(meta.original_name));
}

export function fileKind(meta) {
  const mime = meta?.mime || '';
  const ext = EXT(meta?.original_name);
  if (isImageFile(meta)) return 'image';
  if (mime === 'application/pdf' || ext === 'pdf') return 'pdf';
  if (['xls', 'xlsx', 'xlsm', 'xlsb', 'csv', 'ods'].includes(ext) || mime.includes('spreadsheet') || mime.includes('excel')) return 'sheet';
  if (['ppt', 'pptx', 'odp'].includes(ext) || mime.includes('presentation') || mime.includes('powerpoint')) return 'slide';
  if (['zip', 'rar', '7z', 'gz', 'tar', 'bz2', 'xz'].includes(ext) || mime.includes('zip') || mime.includes('compressed')) return 'archive';
  if (['txt', 'md', 'log'].includes(ext) || mime === 'text/plain') return 'text';
  if (['doc', 'docx', 'rtf', 'odt'].includes(ext) || mime.includes('word')) return 'doc';
  return 'other';
}

// آیا داخل مرورگر قابل نمایش است؟ (عکس، PDF، متن ساده)
export function canPreview(meta) {
  const k = fileKind(meta);
  return k === 'image' || k === 'pdf' || k === 'text';
}

const KIND = {
  image: { color: '#0ea5e9', label: 'تصویر', Icon: FileImage },
  pdf: { color: '#dc2626', label: 'PDF', Icon: FileText },
  sheet: { color: '#16a34a', label: 'صفحه‌گسترده', Icon: FileSpreadsheet },
  slide: { color: '#ea580c', label: 'ارائه', Icon: Presentation },
  archive: { color: '#a16207', label: 'فایل فشرده', Icon: FileArchive },
  text: { color: '#0f766e', label: 'متن', Icon: FileText },
  doc: { color: '#2563eb', label: 'سند متنی', Icon: FileText },
  other: { color: '#64748b', label: 'فایل', Icon: FileIcon },
};

const kindInfo = (meta) => KIND[fileKind(meta)] || KIND.other;
const fileName = (id, meta) => meta?.original_name || `فایل #${fa(id)}`;

// پس‌زمینهٔ ملایمِ آیکون از رنگ نوع فایل (بدون وابستگی به color-mix)
function softBg(hex) {
  const m = /^#([0-9a-f]{6})$/i.exec(String(hex));
  if (!m) return 'var(--bg-3)';
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, .13)`;
}

// ============================== نمایشگر تمام‌صفحه ==============================
// عکس/PDF/متن را بزرگ نشان می‌دهد؛ با فلش‌ها بین پیوست‌ها جابه‌جا می‌شود؛
// دکمهٔ دانلود و «باز کردن در تب جدید» همیشه در دسترس است. با Esc بسته می‌شود.
function AttachmentViewer({ items, index, onIndex, onClose }) {
  const [zoom, setZoom] = useState(false);
  const closeRef = useRef(null);
  const item = items[index];
  const kind = fileKind(item?.meta);

  const go = useCallback((d) => {
    if (items.length < 2) return;
    setZoom(false);
    onIndex((index + d + items.length) % items.length);
  }, [index, items.length, onIndex]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft') go(1);   // چیدمان راست‌به‌چپ
      else if (e.key === 'ArrowRight') go(-1);
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // فوکوس روی دکمهٔ بستن تا با Enter/Space و صفحه‌خوان هم قابل بستن باشد
    const t = setTimeout(() => closeRef.current?.focus(), 30);
    return () => {
      clearTimeout(t);
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [go, onClose]);

  if (!item) return null;
  const name = fileName(item.id, item.meta);
  const info = kindInfo(item.meta);

  return createPortal(
    <div className="att-viewer" role="dialog" aria-modal="true" aria-label={`نمایش فایل ${name}`}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="att-viewer-head">
        <span className="att-viewer-ico" style={{ color: info.color }}><info.Icon size={20} /></span>
        <div className="att-viewer-title">
          <div className="att-viewer-name" title={name}>{name}</div>
          <div className="att-viewer-sub">
            {info.label}
            {item.meta?.size ? ` · ${fmtSize(item.meta.size)}` : ''}
            {items.length > 1 ? ` · ${fa(index + 1)} از ${fa(items.length)}` : ''}
          </div>
        </div>
        {kind === 'image' && (
          <button type="button" className="att-vbtn" onClick={() => setZoom(z => !z)} title={zoom ? 'کوچک‌نمایی' : 'بزرگ‌نمایی'}>
            {zoom ? <ZoomOut size={15} /> : <ZoomIn size={15} />}
            <span className="att-vbtn-tx">{zoom ? 'کوچک‌نمایی' : 'بزرگ‌نمایی'}</span>
          </button>
        )}
        <a className="att-vbtn" href={workflowFileUrl(item.id)} target="_blank" rel="noreferrer" title="باز کردن در تب جدید">
          <ExternalLink size={15} /><span className="att-vbtn-tx">تب جدید</span>
        </a>
        <a className="att-vbtn att-vbtn-primary" href={workflowFileDownloadUrl(item.id)} download title="دانلود فایل">
          <Download size={15} /><span className="att-vbtn-tx">دانلود</span>
        </a>
        <button type="button" ref={closeRef} className="att-vbtn att-vbtn-close" onClick={onClose}
          title="بستن (Esc)" aria-label="بستن نمایشگر">
          <X size={17} /><span className="att-vbtn-tx">بستن</span>
        </button>
      </div>

      <div className="att-viewer-body" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
        {items.length > 1 && (
          <>
            <button type="button" className="att-nav att-nav-next" onClick={() => go(1)} title="فایل بعدی" aria-label="فایل بعدی"><ChevronLeft size={22} /></button>
            <button type="button" className="att-nav att-nav-prev" onClick={() => go(-1)} title="فایل قبلی" aria-label="فایل قبلی"><ChevronRight size={22} /></button>
          </>
        )}
        {kind === 'image' ? (
          <img src={workflowFileUrl(item.id)} alt={name} className={zoom ? 'zoom' : ''}
            onClick={() => setZoom(z => !z)} />
        ) : (kind === 'pdf' || kind === 'text') ? (
          <iframe src={workflowFileUrl(item.id)} title={name} />
        ) : (
          <div className="att-fallback">
            <AlertCircle size={40} style={{ opacity: .8 }} />
            <div className="att-fallback-title">این فایل در مرورگر قابل نمایش نیست</div>
            <div className="att-fallback-sub">{name}</div>
            <a className="btn btn-primary" href={workflowFileDownloadUrl(item.id)} download>
              <Download size={16} /> دانلود فایل
            </a>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

// ============================== کارتِ یک پیوست ==============================
function ImageCard({ id, meta, thumb, onOpen, onRemove }) {
  const name = fileName(id, meta);
  return (
    <div className="att-card">
      {onRemove && (
        <button type="button" className="att-remove" title="حذف پیوست" onClick={onRemove}><X size={12} /></button>
      )}
      <div className="att-thumb" style={{ width: thumb, height: thumb }}
        onClick={onOpen} role="button" tabIndex={0} title={`${name} — برای دیدن کلیک کنید`}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } }}>
        <img src={workflowFileUrl(id)} alt={name} loading="lazy" />
        <span className="att-overlay">
          <span className="att-act" title="نمایش"><Eye size={14} /></span>
          <a className="att-act" href={workflowFileDownloadUrl(id)} download title="دانلود"
            onClick={e => e.stopPropagation()}><Download size={14} /></a>
        </span>
      </div>
      <div className="att-cap" style={{ maxWidth: thumb }} title={name}>{name}</div>
    </div>
  );
}

function FileCard({ id, meta, onOpen, onRemove }) {
  const name = fileName(id, meta);
  const info = kindInfo(meta);
  const previewable = canPreview(meta);
  const sub = meta
    ? `${info.label}${meta.size ? ' · ' + fmtSize(meta.size) : ''} · ${previewable ? 'برای نمایش کلیک کنید' : 'برای دانلود کلیک کنید'}`
    : 'در حال دریافت اطلاعات فایل…';
  const body = (
    <>
      <span className="att-ico" style={{ color: info.color, background: softBg(info.color) }}>
        <info.Icon size={19} />
      </span>
      <span className="att-file-tx">
        <span className="att-name">{name}</span>
        <span className="att-meta">{sub}</span>
      </span>
    </>
  );
  return (
    <div className="att-card">
      {onRemove && (
        <button type="button" className="att-remove" title="حذف پیوست" onClick={onRemove}><X size={12} /></button>
      )}
      <div className="att-file">
        {previewable ? (
          <button type="button" className="att-file-main" onClick={onOpen} title={`${name} — نمایش`}>{body}</button>
        ) : (
          <a className="att-file-main" href={workflowFileDownloadUrl(id)} download title={`${name} — دانلود`}>{body}</a>
        )}
        <a className="att-file-dl" href={workflowFileDownloadUrl(id)} download title="دانلود فایل"><Download size={16} /></a>
      </div>
    </div>
  );
}

// ============================== شبکهٔ پیوست‌ها ==============================
function AttachmentGrid({ ids, thumb = 92, onRemove, extra }) {
  const getMeta = useFilesMeta(ids);
  const [viewIdx, setViewIdx] = useState(-1);

  // فقط فایل‌های قابل‌نمایش در نمایشگر ورق زده می‌شوند
  const viewItems = ids.filter(id => canPreview(getMeta(id))).map(id => ({ id, meta: getMeta(id) }));
  const openViewer = (id) => {
    const i = viewItems.findIndex(v => v.id === id);
    setViewIdx(i >= 0 ? i : 0);
  };

  return (
    <>
      <div className="att-wrap">
        {ids.map(id => {
          const meta = getMeta(id);
          const common = { id, meta, onOpen: () => openViewer(id), onRemove: onRemove ? () => onRemove(id) : null };
          return isImageFile(meta)
            ? <ImageCard key={id} {...common} thumb={thumb} />
            : <FileCard key={id} {...common} />;
        })}
        {extra}
      </div>
      {viewIdx >= 0 && viewItems.length > 0 && (
        <AttachmentViewer items={viewItems} index={Math.min(viewIdx, viewItems.length - 1)}
          onIndex={setViewIdx} onClose={() => setViewIdx(-1)} />
      )}
    </>
  );
}

// سرصفحهٔ «n فایل پیوست» — تا کاربر در نگاه اول بفهمد فایلی ضمیمه شده است
function AttachmentHeader({ title, count }) {
  if (!title) return null;
  return (
    <div className="att-head">
      <Paperclip size={13} />
      <span>{title}</span>
      <span className="att-badge">{fa(count)} فایل</span>
    </div>
  );
}

// فهرست فقط-خواندنیِ پیوست‌ها
export function AttachmentList({ ids, thumb = 92, empty = null, title }) {
  const list = toFileIds(ids);
  if (!list.length) return empty;
  return (
    <div className="att-block">
      <AttachmentHeader title={title} count={list.length} />
      <AttachmentGrid ids={list} thumb={thumb} />
    </div>
  );
}

// انتخاب/آپلود پیوست — هر نوع سند (و عکس). با accept می‌توان محدود کرد (مثلاً فقط عکس).
export function AttachmentPicker({ value, onChange, accept, placeholder, label, disabled, thumb = 92 }) {
  const { toast } = useStore();
  const [busy, setBusy] = useState(false);
  const ids = toFileIds(value);

  const addFiles = async (files) => {
    if (!files.length) return;
    setBusy(true);
    try {
      const added = [];
      for (const f of files) {
        const meta = await uploadWorkflowFile(f);
        primeFilesMeta([meta]);
        added.push(meta.id);
      }
      onChange([...ids, ...added]);
      toast(`${fa(added.length)} فایل پیوست شد`);
    } catch (err) {
      toast(err.message || 'خطا در آپلود فایل', 'error');
    }
    setBusy(false);
  };

  const btnLabel = busy ? 'در حال آپلود…' : (ids.length ? (label || 'افزودن فایل') : (placeholder || label || 'انتخاب فایل'));

  const addBtn = (
    <label className={`att-add ${disabled || busy ? 'disabled' : ''}`} key="__add">
      <Paperclip size={15} />
      <span>{btnLabel}</span>
      <input type="file" multiple hidden accept={accept || undefined} disabled={disabled || busy}
        onChange={async e => { const files = [...(e.target.files || [])]; e.target.value = ''; await addFiles(files); }} />
    </label>
  );

  return (
    <div className="att-block">
      <AttachmentGrid ids={ids} thumb={thumb} extra={addBtn}
        onRemove={(id) => onChange(ids.filter(x => x !== id))} />
    </div>
  );
}
