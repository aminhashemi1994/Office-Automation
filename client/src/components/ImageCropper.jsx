import React, { useState, useRef, useEffect, useCallback } from 'react';
import { X, ZoomIn, RotateCw, Check, Eraser } from 'lucide-react';

// کراپر تصویر — کاملاً آفلاین با canvas مرورگر، بدون هیچ کتابخانهٔ خارجی.
// props:
//   file: File ورودی
//   title: عنوان مودال
//   aspects: [{ label, value }] نسبت‌های ابعادی قابل انتخاب (value عددی مثل 1 یا 16/9)
//   round: پیش‌نمایش دایره‌ای (برای آواتار)
//   outputType: 'image/jpeg' | 'image/png'
//   outputMaxW: حداکثر عرض خروجی
//   signature: حالت امضا — ابزار شفاف‌سازی پس‌زمینهٔ سفید + خروجی PNG شفاف
//   onCancel(), onDone(file)

const BOX_MAX = 340; // حداکثر بُعد نمایش کادر برش

export default function ImageCropper({
  file, title = 'برش تصویر', aspects = [{ label: 'مربع', value: 1 }],
  round = false, outputType = 'image/jpeg', outputMaxW = 512, signature = false, onCancel, onDone,
}) {
  const [url, setUrl] = useState('');
  const [nat, setNat] = useState({ w: 0, h: 0 });
  const [aspect, setAspect] = useState(aspects[0].value);
  const [scale, setScale] = useState(1);
  const [minScale, setMinScale] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 }); // موقعیت گوشهٔ بالا-راست تصویر داخل کادر
  const [rotation, setRotation] = useState(0);
  const [busy, setBusy] = useState(false);
  const [removeBg, setRemoveBg] = useState(signature); // شفاف‌سازی پس‌زمینه (حالت امضا)
  const [threshold, setThreshold] = useState(205);      // آستانهٔ روشنایی برای حذف پس‌زمینه
  const imgRef = useRef(null);
  const previewRef = useRef(null);
  const drag = useRef(null);

  const effType = (signature && removeBg) ? 'image/png' : outputType;

  // حذف پس‌زمینهٔ روشن: پیکسل‌های روشن‌تر از آستانه شفاف می‌شوند، رنگِ قلم حفظ می‌شود
  const applyTransparency = (ctx, w, h) => {
    const img = ctx.getImageData(0, 0, w, h);
    const d = img.data;
    const soft = 38; // لبهٔ نرم برای طبیعی‌ماندن
    for (let i = 0; i < d.length; i += 4) {
      const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      let alpha;
      if (lum >= threshold) alpha = 0;
      else if (lum >= threshold - soft) alpha = Math.round(255 * (threshold - lum) / soft);
      else alpha = 255;
      d[i + 3] = alpha;
    }
    ctx.putImageData(img, 0, 0);
  };

  // ساخت canvasِ برش‌خورده
  const renderCropCanvas = useCallback((outW) => {
    const sw = box.w / scale, sh = box.h / scale;
    const outH = Math.round(outW * (box.h / box.w));
    const sx = -pos.x / scale, sy = -pos.y / scale;
    const canvas = document.createElement('canvas');
    canvas.width = outW; canvas.height = outH;
    const ctx = canvas.getContext('2d');
    if (effType === 'image/jpeg') { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, outW, outH); }
    const k = outW / sw;
    ctx.save();
    ctx.translate(-sx * k, -sy * k);
    ctx.scale(k, k);
    ctx.translate(effW / 2, effH / 2);
    ctx.rotate((rotation * Math.PI) / 180);
    ctx.drawImage(imgRef.current, -nat.w / 2, -nat.h / 2, nat.w, nat.h);
    ctx.restore();
    if (signature && removeBg) applyTransparency(ctx, outW, outH);
    return canvas;
  });

  // ابعاد کادر برش بر اساس نسبت
  const box = aspect >= 1
    ? { w: BOX_MAX, h: Math.round(BOX_MAX / aspect) }
    : { w: Math.round(BOX_MAX * aspect), h: BOX_MAX };

  useEffect(() => {
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);

  // ابعاد مؤثر تصویر با توجه به چرخش (۹۰/۲۷۰ درجه، عرض و ارتفاع جابه‌جا می‌شوند)
  const swapped = rotation % 180 !== 0;
  const effW = swapped ? nat.h : nat.w;
  const effH = swapped ? nat.w : nat.h;

  const clamp = useCallback((p, s) => {
    const iw = effW * s, ih = effH * s;
    return {
      x: Math.min(0, Math.max(box.w - iw, p.x)),
      y: Math.min(0, Math.max(box.h - ih, p.y)),
    };
  }, [effW, effH, box.w, box.h]);

  // با تغییر تصویر/نسبت/چرخش، مقیاس پایه را حساب و وسط‌چین کن
  useEffect(() => {
    if (!effW || !effH) return;
    const ms = Math.max(box.w / effW, box.h / effH);
    setMinScale(ms);
    setScale(ms);
    setPos({ x: (box.w - effW * ms) / 2, y: (box.h - effH * ms) / 2 });
  }, [effW, effH, aspect, rotation]);

  const onImgLoad = (e) => setNat({ w: e.target.naturalWidth, h: e.target.naturalHeight });

  const onPointerDown = (e) => {
    drag.current = { sx: e.clientX, sy: e.clientY, px: pos.x, py: pos.y };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e) => {
    if (!drag.current) return;
    const nx = drag.current.px + (e.clientX - drag.current.sx);
    const ny = drag.current.py + (e.clientY - drag.current.sy);
    setPos(clamp({ x: nx, y: ny }, scale));
  };
  const onPointerUp = () => { drag.current = null; };

  const changeZoom = (newScale) => {
    const s = Math.max(minScale, Math.min(minScale * 5, newScale));
    // مرکز کادر ثابت بماند
    const cxSrc = (-pos.x + box.w / 2) / scale;
    const cySrc = (-pos.y + box.h / 2) / scale;
    const np = clamp({ x: box.w / 2 - cxSrc * s, y: box.h / 2 - cySrc * s }, s);
    setScale(s);
    setPos(np);
  };

  const onWheel = (e) => { e.preventDefault(); changeZoom(scale * (e.deltaY < 0 ? 1.06 : 0.94)); };

  // پیش‌نمایش زندهٔ نتیجه (به‌ویژه برای مشاهدهٔ شفاف‌سازی امضا)
  useEffect(() => {
    if (!signature || !nat.w || !previewRef.current) return;
    const canvas = renderCropCanvas(Math.min(260, Math.round(box.w / scale)) || 200);
    const pv = previewRef.current;
    pv.width = canvas.width; pv.height = canvas.height;
    const ctx = pv.getContext('2d');
    ctx.clearRect(0, 0, pv.width, pv.height);
    ctx.drawImage(canvas, 0, 0);
  }, [signature, removeBg, threshold, pos, scale, rotation, aspect, nat, renderCropCanvas]);

  const confirm = async () => {
    setBusy(true);
    try {
      const outW = Math.min(outputMaxW, Math.round(box.w / scale));
      const canvas = renderCropCanvas(outW);
      const blob = await new Promise(res => canvas.toBlob(res, effType, 0.92));
      const ext = effType === 'image/png' ? 'png' : 'jpg';
      const out = new File([blob], `crop.${ext}`, { type: effType });
      onDone(out);
    } catch {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={e => e.target === e.currentTarget && onCancel()}>
      <div className="modal" style={{ width: 'min(460px, calc(100vw - 32px))' }}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="icon-btn" style={{ width: 34, height: 34 }} onClick={onCancel}><X size={17} /></button>
        </div>
        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
          {aspects.length > 1 && (
            <div className="segmented segmented-sm">
              {aspects.map(a => (
                <button key={a.label} type="button" className={`seg-item ${aspect === a.value ? 'active' : ''}`}
                  onClick={() => setAspect(a.value)}>{a.label}</button>
              ))}
            </div>
          )}
          <div
            style={{
              width: box.w, height: box.h, position: 'relative', overflow: 'hidden',
              background: '#e9ecf3', touchAction: 'none', cursor: 'move',
              borderRadius: round ? '50%' : 10, boxShadow: 'inset 0 0 0 2px rgba(79,70,229,.5)',
              userSelect: 'none',
            }}
            onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onWheel={onWheel}
          >
            {url && (
              <img ref={imgRef} src={url} alt="" onLoad={onImgLoad} draggable={false}
                style={{
                  position: 'absolute', left: pos.x, top: pos.y,
                  width: effW * scale, height: effH * scale,
                  transform: `rotate(${rotation}deg)`, transformOrigin: 'center center',
                  pointerEvents: 'none',
                }} />
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%' }}>
            <ZoomIn size={18} style={{ color: 'var(--text-3)', flexShrink: 0 }} />
            <input type="range" min={minScale} max={minScale * 5} step={minScale / 100}
              value={scale} onChange={e => changeZoom(Number(e.target.value))}
              style={{ flex: 1, accentColor: 'var(--primary)' }} />
            <button className="icon-btn" style={{ width: 36, height: 36, flexShrink: 0 }}
              title="چرخش ۹۰ درجه" onClick={() => setRotation(r => (r + 90) % 360)}><RotateCw size={16} /></button>
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--text-3)', textAlign: 'center' }}>
            برای جابه‌جایی، تصویر را بکشید · با اسکرول یا نوار بالا بزرگ‌نمایی کنید
          </div>

          {signature && (
            <div style={{ width: '100%', borderTop: '1px solid var(--border-soft)', paddingTop: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.8, fontWeight: 600 }}>
                  <Eraser size={15} /> شفاف‌سازی پس‌زمینهٔ سفید
                </span>
                <div className="segmented segmented-sm">
                  <button type="button" className={`seg-item ${removeBg ? 'active' : ''}`} onClick={() => setRemoveBg(true)}>روشن</button>
                  <button type="button" className={`seg-item ${!removeBg ? 'active' : ''}`} onClick={() => setRemoveBg(false)}>خاموش</button>
                </div>
              </div>
              {removeBg && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                  <span style={{ fontSize: 11.5, color: 'var(--text-3)', flexShrink: 0 }}>شدت حذف</span>
                  <input type="range" min={120} max={245} step={1} value={threshold}
                    onChange={e => setThreshold(Number(e.target.value))}
                    style={{ flex: 1, accentColor: 'var(--primary)' }} />
                </div>
              )}
              <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 8 }}>
                پیش‌نمایش نهایی (پس‌زمینهٔ شطرنجی = بخش شفاف):
              </div>
              <div style={{
                display: 'grid', placeItems: 'center', padding: 8, borderRadius: 10,
                backgroundColor: '#fff',
                backgroundImage: 'linear-gradient(45deg,#e2e5ee 25%,transparent 25%),linear-gradient(-45deg,#e2e5ee 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#e2e5ee 75%),linear-gradient(-45deg,transparent 75%,#e2e5ee 75%)',
                backgroundSize: '16px 16px', backgroundPosition: '0 0,0 8px,8px -8px,-8px 0',
                border: '1px solid var(--border)',
              }}>
                <canvas ref={previewRef} style={{ maxWidth: '100%', maxHeight: 120, imageRendering: 'auto' }} />
              </div>
            </div>
          )}
        </div>
        <div className="modal-foot">
          <button className="btn btn-ghost" onClick={onCancel}>انصراف</button>
          <button className="btn btn-primary" disabled={busy || !nat.w} onClick={confirm}>
            <Check size={16} /> {busy ? 'در حال آماده‌سازی…' : 'برش و بارگذاری'}
          </button>
        </div>
      </div>
    </div>
  );
}
