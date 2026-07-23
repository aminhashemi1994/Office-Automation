import React, { useEffect, useRef, useState } from 'react';
import {
  Mic, MicOff, Video, VideoOff, PhoneOff, Phone, Circle, Square,
  Volume2, MonitorUp, MonitorOff, Settings,
} from 'lucide-react';
import { Room, RoomEvent, Track, ConnectionQuality, ConnectionState, VideoPresets } from 'livekit-client';
import { useStore } from '../store.jsx';
import { api } from '../api.js';
import { Avatar } from './common.jsx';

// -----------------------------------------------------------------------------
// تماس صوتی/تصویری و کنفرانس مبتنی بر LiveKit (SFU).
// دیگر از mesh WebRTC نقطه‌به‌نقطه استفاده نمی‌شود؛ همهٔ مدیا از سرور LiveKit عبور
// می‌کند که مقیاس‌پذیر است، کیفیت را وفق می‌دهد (adaptiveStream/dynacast)، و مشکل
// «صدای یک‌طرفه/NAT» را حل می‌کند. سیگنالینگِ «زنگ‌خوردن/دعوت» همچنان روی socket.io
// باقی می‌ماند (call:invite / call:incoming / call:reject ...).
// -----------------------------------------------------------------------------

// اطلاعات نمایشی هر شرکت‌کننده از metadata توکن خوانده می‌شود
function partInfo(p, fallback = {}) {
  let meta = {};
  try { meta = p?.metadata ? JSON.parse(p.metadata) : {}; } catch {}
  return {
    name: meta.name || p?.name || fallback.name || '...',
    color: meta.color || fallback.color || '#4f46e5',
  };
}

// میله‌های کیفیت اتصال
function QualityBars({ quality }) {
  const map = {
    [ConnectionQuality.Excellent]: ['q-excellent', 'اتصال عالی'],
    [ConnectionQuality.Good]: ['q-good', 'اتصال خوب'],
    [ConnectionQuality.Poor]: ['q-poor', 'اتصال ضعیف'],
    [ConnectionQuality.Lost]: ['q-lost', 'اتصال قطع شد'],
  };
  const [cls, title] = map[quality] || ['q-unknown', 'در حال سنجش کیفیت…'];
  return (
    <span className={`quality ${cls}`} title={title}>
      <i style={{ height: 6 }} /><i style={{ height: 11 }} /><i style={{ height: 16 }} />
    </span>
  );
}

// یک کاشیِ شرکت‌کننده: ویدیو/اشتراک‌صفحه + صدا (برای اعضای دیگر) + وضعیت میکروفون
function ParticipantTile({ participant, isLocal, sinkId, fallback }) {
  const videoRef = useRef(null);
  const audioRef = useRef(null);
  const { name, color } = partInfo(participant, fallback);

  // انتخاب ترک تصویری: اشتراک صفحه اولویت دارد، سپس دوربین
  const screenPub = participant.getTrackPublication?.(Track.Source.ScreenShare);
  const camPub = participant.getTrackPublication?.(Track.Source.Camera);
  const micPub = participant.getTrackPublication?.(Track.Source.Microphone);
  const videoPub = (screenPub && screenPub.track && !screenPub.isMuted) ? screenPub
    : (camPub && camPub.track && !camPub.isMuted) ? camPub : null;
  const isScreen = videoPub === screenPub;
  const micEnabled = !!(micPub && micPub.track && !micPub.isMuted);
  const speaking = participant.isSpeaking;

  // اتصال ترک تصویری به عنصر ویدیو
  useEffect(() => {
    const track = videoPub?.track;
    const el = videoRef.current;
    if (track && el) {
      track.attach(el);
      return () => { try { track.detach(el); } catch {} };
    }
  }, [videoPub?.trackSid, videoPub?.track]);

  // اتصال ترک صوتی (فقط اعضای دیگر؛ صدای خودمان را پخش نمی‌کنیم تا اکو نشود)
  useEffect(() => {
    if (isLocal) return;
    const track = micPub?.track;
    const el = audioRef.current;
    if (track && el) {
      track.attach(el);
      return () => { try { track.detach(el); } catch {} };
    }
  }, [isLocal, micPub?.trackSid, micPub?.track]);

  // اعمال خروجی صدای انتخاب‌شده
  useEffect(() => {
    const el = audioRef.current;
    if (el && sinkId && typeof el.setSinkId === 'function') el.setSinkId(sinkId).catch(() => {});
  }, [sinkId, micPub?.track]);

  return (
    <div className={`call-tile ${speaking ? 'speaking' : ''}`}>
      {videoPub && (
        <video ref={videoRef} autoPlay playsInline muted
          style={{ transform: (isLocal && !isScreen) ? 'scaleX(-1)' : 'none', objectFit: isScreen ? 'contain' : 'cover' }} />
      )}
      {!videoPub && <Avatar name={name} color={color} size={84} />}
      {!isLocal && <audio ref={audioRef} data-call-audio autoPlay />}
      <QualityBars quality={participant.connectionQuality} />
      {!micEnabled && (
        <span className="muted-badge"><MicOff size={14} /></span>
      )}
      <span className="tag">
        {speaking && <Circle size={8} fill="var(--green,#22c55e)" color="var(--green,#22c55e)" />}
        {name}{isLocal ? ' (شما)' : ''}
      </span>
    </div>
  );
}

export function CallOverlay() {
  const { user, activeCall, setActiveCall, socketEmit, toast } = useStore();
  const roomRef = useRef(null);
  const [, setTick] = useState(0);
  const bump = () => setTick(t => t + 1);

  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(!!activeCall?.video);
  const [screenOn, setScreenOn] = useState(false);
  const [connState, setConnState] = useState(ConnectionState.Connecting);
  // مرورگر (به‌ویژه موبایل) تا اولین لمسِ کاربر پخش خودکار صدا را بلاک می‌کند.
  // با این پرچم یک دکمهٔ «فعال‌سازی صدا» نشان می‌دهیم که room.startAudio() را صدا می‌زند.
  const [audioBlocked, setAudioBlocked] = useState(false);

  // خروجی/ورودی صدا و دوربین
  const [devices, setDevices] = useState({ audioinput: [], audiooutput: [], videoinput: [] });
  const [sinkId, setSinkId] = useState('');
  const [showMenu, setShowMenu] = useState(false);
  const canPickOutput = typeof document.createElement('audio').setSinkId === 'function';

  // ---------- ضبط تماس (صوتی + تصویری) ----------
  const [recording, setRecording] = useState(false);
  const recordingRef = useRef(false);
  const mediaRecorderRef = useRef(null);
  const audioCtxRef = useRef(null);
  const mixDestRef = useRef(null);
  const mixedSourcesRef = useRef(new Set());
  const recordChunksRef = useRef([]);
  const recordStartRef = useRef(0);
  const recMimeRef = useRef('audio/webm');
  const compositorRef = useRef(null);

  // اتصال ترک صوتی به میکس ضبط (بدون تکرار)
  const addTrackToMix = (track) => {
    const ctx = audioCtxRef.current, dest = mixDestRef.current;
    if (!ctx || !dest || !track) return;
    const mst = track.mediaStreamTrack || track;
    if (!mst || mst.kind !== 'audio') return;
    if (mixedSourcesRef.current.has(mst.id)) return;
    try {
      ctx.createMediaStreamSource(new MediaStream([mst])).connect(dest);
      mixedSourcesRef.current.add(mst.id);
    } catch {}
  };

  // -------------------- اتصال به اتاق LiveKit --------------------
  useEffect(() => {
    if (!activeCall) return;
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      toast('برای تماس باید سامانه با HTTPS باز شود. دسترسی به میکروفون/دوربین در حالت http روی شبکه محلی مسدود است.', 'error');
      setActiveCall(null);
      return;
    }
    let cancelled = false;
    // adaptiveStream: کیفیت دریافتی را با اندازهٔ عنصر وفق می‌دهد.
    // dynacast: لایه‌های مصرف‌نشده را متوقف می‌کند (صرفه‌جویی پهنای‌باند).
    // simulcast + لایه‌های پایین: گیرندهٔ ضعیف نسخهٔ سبک‌تر می‌گیرد → رفع «کندی/ارتباط ضعیف».
    const room = new Room({
      adaptiveStream: true,
      dynacast: true,
      videoCaptureDefaults: { resolution: VideoPresets.h540.resolution },
      publishDefaults: {
        simulcast: true,
        videoSimulcastLayers: [VideoPresets.h180, VideoPresets.h360],
        videoCodec: 'vp8', // سازگاری گسترده روی موبایل/دسکتاپ
      },
    });
    roomRef.current = room;

    const onLeft = () => {
      // در تماس دونفره، وقتی طرف مقابل خارج شد تماس پایان می‌یابد
      if (!activeCall.group && room.remoteParticipants.size === 0) {
        toast('تماس پایان یافت', 'info');
        setActiveCall(null);
      } else {
        bump();
      }
    };

    room
      .on(RoomEvent.ParticipantConnected, bump)
      .on(RoomEvent.ParticipantDisconnected, onLeft)
      .on(RoomEvent.TrackSubscribed, (track) => { if (recordingRef.current) addTrackToMix(track); bump(); })
      .on(RoomEvent.TrackUnsubscribed, bump)
      .on(RoomEvent.TrackMuted, bump)
      .on(RoomEvent.TrackUnmuted, bump)
      .on(RoomEvent.LocalTrackPublished, bump)
      .on(RoomEvent.LocalTrackUnpublished, bump)
      .on(RoomEvent.ActiveSpeakersChanged, bump)
      .on(RoomEvent.ConnectionQualityChanged, bump)
      .on(RoomEvent.ConnectionStateChanged, (s) => { setConnState(s); bump(); })
      .on(RoomEvent.MediaDevicesChanged, refreshDevices)
      .on(RoomEvent.AudioPlaybackStatusChanged, () => setAudioBlocked(!room.canPlaybackAudio))
      .on(RoomEvent.Disconnected, () => { if (!cancelled) setActiveCall(null); });

    const connect = async () => {
      const { url, token } = await api('/chat/livekit-token', { method: 'POST', body: { room: activeCall.room } });
      if (cancelled) return;
      // گرم‌کردن DNS/TLS/اتصال پیش از connect تا برقراری تماس سریع‌تر شود
      try { await room.prepareConnection(url, token); } catch {}
      if (cancelled) return;
      await room.connect(url, token);
      if (cancelled) { room.disconnect(); return; }
      // میکروفون و دوربین را موازی روشن کن تا تأخیرِ برقراری کمتر شود
      const media = [
        room.localParticipant.setMicrophoneEnabled(true)
          .then(() => setMicOn(true)).catch((e) => handleMediaError(e, false)),
      ];
      if (activeCall.video) {
        media.push(room.localParticipant.setCameraEnabled(true)
          .then(() => setCamOn(true)).catch((e) => handleMediaError(e, true)));
      }
      // تلاش برای پخش صدا؛ اگر مرورگر (موبایل) بلاک کرد، دکمهٔ فعال‌سازی نشان داده می‌شود
      try { await room.startAudio(); } catch {}
      setAudioBlocked(!room.canPlaybackAudio);
      // ثبت حضور و زنگ‌زدنِ طرف مقابل بلافاصله پس از اتصال (منتظرِ روشن‌شدن مدیا نمی‌مانیم)
      socketEmit('call:join', { room: activeCall.room });
      if (activeCall.invite) socketEmit('call:invite', { room: activeCall.room, ...activeCall.invite });
      bump();
      await Promise.allSettled(media);
      refreshDevices();
      bump();
    };

    connect().catch((err) => {
      if (cancelled) return;
      toast('اتصال به سرور تماس ناموفق بود: ' + (err?.message || ''), 'error');
      setActiveCall(null);
    });

    return () => {
      cancelled = true;
      if (recordingRef.current) stopRecording();
      socketEmit('call:leave', { room: activeCall.room });
      room.disconnect();
      roomRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCall?.room]);

  const handleMediaError = (e, isVideo) => {
    const n = e?.name || '';
    let msg = isVideo ? 'دسترسی به دوربین ممکن نیست' : 'دسترسی به میکروفون ممکن نیست';
    if (n === 'NotAllowedError' || n === 'SecurityError')
      msg = 'اجازهٔ دسترسی به میکروفون/دوربین داده نشد. از تنظیمات مرورگر برای این سایت اجازه دهید.';
    else if (n === 'NotFoundError' || n === 'OverconstrainedError')
      msg = isVideo ? 'دوربینی یافت نشد.' : 'میکروفونی یافت نشد.';
    else if (n === 'NotReadableError')
      msg = 'میکروفون/دوربین توسط برنامهٔ دیگری در حال استفاده است.';
    toast(msg, 'error');
  };

  async function refreshDevices() {
    try {
      const list = await navigator.mediaDevices.enumerateDevices();
      setDevices({
        audioinput: list.filter(d => d.kind === 'audioinput'),
        audiooutput: list.filter(d => d.kind === 'audiooutput'),
        videoinput: list.filter(d => d.kind === 'videoinput'),
      });
    } catch {}
  }

  // -------------------- کنترل‌ها --------------------
  const lp = () => roomRef.current?.localParticipant;

  // آزادسازی پخش صدا: با هر تعاملِ کاربر (لمس صفحه یا هر دکمهٔ کنترل) صدا فعال می‌شود.
  // این کار جای «دکمهٔ مجزای فعال‌سازی صدا» را می‌گیرد تا روی موبایل صدای طرف مقابل پخش شود.
  const unlockAudio = async () => {
    const room = roomRef.current; if (!room) return;
    if (!room.canPlaybackAudio) { try { await room.startAudio(); } catch {} }
    setAudioBlocked(!room.canPlaybackAudio);
  };

  const toggleMic = async () => {
    await unlockAudio();
    const p = lp(); if (!p) return;
    const next = !p.isMicrophoneEnabled;
    try { await p.setMicrophoneEnabled(next); setMicOn(next); } catch (e) { handleMediaError(e, false); }
  };
  const toggleCam = async () => {
    await unlockAudio();
    const p = lp(); if (!p) return;
    const next = !p.isCameraEnabled;
    try { await p.setCameraEnabled(next); setCamOn(next); } catch (e) { handleMediaError(e, true); }
  };
  const toggleScreen = async () => {
    await unlockAudio();
    const p = lp(); if (!p) return;
    // اشتراک صفحه روی اکثر مرورگرهای موبایل پشتیبانی نمی‌شود
    if (!navigator.mediaDevices?.getDisplayMedia) {
      toast('اشتراک صفحه روی این دستگاه/مرورگر پشتیبانی نمی‌شود (معمولاً محدودیت موبایل).', 'error');
      return;
    }
    const next = !p.isScreenShareEnabled;
    try {
      await p.setScreenShareEnabled(next);
      setScreenOn(next);
    } catch (e) {
      // کاربر خودش لغو کرده → پیام نده
      if (e?.name === 'NotAllowedError' || e?.name === 'AbortError') return;
      // خطای واقعی را نشان بده تا علت مشخص شود
      toast('اشتراک صفحه ممکن نشد: ' + (e?.name || '') + ' ' + (e?.message || ''), 'error');
      console.error('screenshare error:', e);
    }
  };

  const switchDevice = async (kind, deviceId) => {
    const room = roomRef.current; if (!room) return;
    try {
      if (kind === 'audiooutput') { setSinkId(deviceId); await room.switchActiveDevice('audiooutput', deviceId); }
      else await room.switchActiveDevice(kind, deviceId);
    } catch {}
    setShowMenu(false);
  };

  const hangUp = () => {
    try { socketEmit('call:leave', { room: activeCall.room }); } catch {}
    setActiveCall(null);
  };

  // -------------------- ضبط تماس --------------------
  const allAudioTracks = () => {
    const room = roomRef.current; if (!room) return [];
    const out = [];
    const mic = room.localParticipant.getTrackPublication(Track.Source.Microphone);
    if (mic?.track) out.push(mic.track);
    room.remoteParticipants.forEach(p => {
      p.trackPublications.forEach(pub => { if (pub.kind === Track.Kind.Audio && pub.track) out.push(pub.track); });
    });
    return out;
  };

  const buildCompositor = () => {
    const canvas = document.createElement('canvas');
    canvas.width = 1280; canvas.height = 720;
    const ctx = canvas.getContext('2d');
    const videoEls = new Map();
    let raf = 0;

    const videoFor = (track, id) => {
      let v = videoEls.get(id);
      if (!v) {
        v = document.createElement('video');
        v.muted = true; v.autoplay = true; v.playsInline = true;
        try { track.attach(v); } catch {}
        v.play().catch(() => {});
        videoEls.set(id, v);
      }
      return v;
    };

    const drawCover = (v, x, y, w, h) => {
      const vw = v.videoWidth, vh = v.videoHeight;
      if (!vw || !vh) return;
      const scale = Math.max(w / vw, h / vh);
      const dw = vw * scale, dh = vh * scale;
      ctx.drawImage(v, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
    };
    const drawAvatar = (t, x, y, w, h) => {
      const cx = x + w / 2, cy = y + h / 2, r = Math.min(w, h) * 0.24;
      ctx.fillStyle = t.color || '#4f46e5';
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = `bold ${Math.round(r)}px Vazirmatn, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText((t.name || '?').trim().charAt(0), cx, cy + 2);
    };

    const draw = () => {
      const room = roomRef.current;
      const tiles = [];
      if (room) {
        const parts = [room.localParticipant, ...room.remoteParticipants.values()];
        parts.forEach((p, i) => {
          const isLocal = p === room.localParticipant;
          const info = isLocal ? { name: user.full_name, color: user.avatar_color } : partInfo(p);
          const scr = p.getTrackPublication(Track.Source.ScreenShare);
          const cam = p.getTrackPublication(Track.Source.Camera);
          const pub = (scr?.track && !scr.isMuted) ? scr : (cam?.track && !cam.isMuted) ? cam : null;
          tiles.push({ ...info, self: isLocal, track: pub?.track, id: (pub?.trackSid || 'a' + i) });
        });
      }
      ctx.fillStyle = '#0b0f1a';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      const n = tiles.length || 1;
      const cols = n <= 1 ? 1 : n <= 4 ? 2 : 3;
      const rows = Math.ceil(n / cols);
      const cw = canvas.width / cols, ch = canvas.height / rows;
      tiles.forEach((t, i) => {
        const x = (i % cols) * cw, y = Math.floor(i / cols) * ch, pad = 6;
        const gx = x + pad, gy = y + pad, gw = cw - pad * 2, gh = ch - pad * 2;
        ctx.save();
        ctx.beginPath(); ctx.rect(gx, gy, gw, gh); ctx.clip();
        ctx.fillStyle = '#141a2b'; ctx.fillRect(gx, gy, gw, gh);
        if (t.track) {
          const v = videoFor(t.track, t.id);
          if (v.videoWidth) drawCover(v, gx, gy, gw, gh); else drawAvatar(t, gx, gy, gw, gh);
        } else drawAvatar(t, gx, gy, gw, gh);
        ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(gx, gy + gh - 34, gw, 34);
        ctx.fillStyle = '#fff';
        ctx.font = '18px Vazirmatn, sans-serif';
        ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
        ctx.fillText((t.name || '') + (t.self ? ' (شما)' : ''), gx + gw - 12, gy + gh - 17);
        ctx.restore();
      });
      raf = requestAnimationFrame(draw);
    };
    draw();
    return {
      canvas,
      stop: () => {
        cancelAnimationFrame(raf);
        videoEls.forEach(v => { try { v.srcObject = null; } catch {} });
        videoEls.clear();
      },
    };
  };

  const pickMime = (video) => {
    const c = video
      ? ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
      : ['audio/webm;codecs=opus', 'audio/webm'];
    return c.find(m => MediaRecorder.isTypeSupported(m)) || c[c.length - 1];
  };

  const startRecording = () => {
    if (recordingRef.current) return;
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const ctx = new AudioCtx();
      audioCtxRef.current = ctx;
      mixDestRef.current = ctx.createMediaStreamDestination();
      mixedSourcesRef.current = new Set();
      allAudioTracks().forEach(addTrackToMix);

      const wantVideo = !!activeCall?.video;
      let recordStream;
      if (wantVideo) {
        compositorRef.current = buildCompositor();
        const canvasStream = compositorRef.current.canvas.captureStream(25);
        recordStream = new MediaStream([
          ...canvasStream.getVideoTracks(),
          ...mixDestRef.current.stream.getAudioTracks(),
        ]);
      } else {
        recordStream = mixDestRef.current.stream;
      }
      const mime = pickMime(wantVideo);
      recMimeRef.current = mime;
      const mr = new MediaRecorder(recordStream, { mimeType: mime });
      recordChunksRef.current = [];
      mr.ondataavailable = e => { if (e.data && e.data.size) recordChunksRef.current.push(e.data); };
      mr.onstop = uploadRecording;
      mr.start(1000);
      mediaRecorderRef.current = mr;
      recordStartRef.current = Date.now();
      recordingRef.current = true;
      setRecording(true);
      toast(wantVideo ? 'ضبط تصویری آغاز شد' : 'ضبط صوتی آغاز شد', 'info');
    } catch {
      toast('ضبط تماس در این مرورگر پشتیبانی نمی‌شود', 'error');
      try { compositorRef.current?.stop(); } catch {}
      compositorRef.current = null;
    }
  };

  const stopRecording = () => {
    recordingRef.current = false;
    setRecording(false);
    const mr = mediaRecorderRef.current;
    if (mr && mr.state !== 'inactive') { try { mr.stop(); } catch {} }
    mediaRecorderRef.current = null;
  };

  const uploadRecording = async () => {
    const chunks = recordChunksRef.current;
    recordChunksRef.current = [];
    try { compositorRef.current?.stop(); } catch {}
    compositorRef.current = null;
    try { audioCtxRef.current?.close(); } catch {}
    audioCtxRef.current = null;
    mixDestRef.current = null;
    mixedSourcesRef.current = new Set();
    if (!chunks.length) return;
    const type = recMimeRef.current || chunks[0].type || 'video/webm';
    const isVideo = type.startsWith('video');
    const blob = new Blob(chunks, { type });
    const duration = Math.round((Date.now() - recordStartRef.current) / 1000);
    const fd = new FormData();
    fd.append('file', blob, isVideo ? 'recording.webm' : 'recording-audio.webm');
    fd.append('title', activeCall?.title || 'تماس');
    fd.append('room', activeCall?.room || '');
    if (activeCall?.conversation_id) fd.append('conversation_id', String(activeCall.conversation_id));
    fd.append('kind', isVideo ? 'video' : 'audio');
    fd.append('duration', String(duration));
    try {
      await api('/chat/recordings', { method: 'POST', formData: fd });
      toast('فایل ضبط ذخیره شد', 'success');
    } catch (e) { toast(e.message || 'خطا در ذخیره ضبط', 'error'); }
  };

  // بوق انتظار برای تماس‌گیرنده تا زمانی که کسی نپیوسته
  const ringbackRef = useRef(null);
  const room = roomRef.current;
  const remoteCount = room ? room.remoteParticipants.size : 0;
  const waiting = !!activeCall?.outgoing && remoteCount === 0 && connState === ConnectionState.Connected;
  useEffect(() => {
    if (!waiting) {
      if (ringbackRef.current) { try { ringbackRef.current.pause(); } catch {} ringbackRef.current = null; }
      return;
    }
    const a = new Audio('/sounds/Beep.mp3');
    a.loop = true; a.play?.().catch(() => {});
    ringbackRef.current = a;
    return () => { try { a.pause(); } catch {} ringbackRef.current = null; };
  }, [waiting]);

  if (!activeCall) return null;

  const participants = room ? [room.localParticipant, ...room.remoteParticipants.values()] : [];
  const count = participants.length || 1;
  const cols = count <= 1 ? 1 : count <= 4 ? 2 : 3;

  return (
    <div className="call-overlay" onPointerDown={audioBlocked ? unlockAudio : undefined}>
      <div style={{ textAlign: 'center', padding: '14px 0 0', fontWeight: 700, fontSize: 15 }}>
        {activeCall.title || 'تماس'} · {count.toLocaleString('fa-IR')} نفر
        {connState === ConnectionState.Connecting && (
          <span style={{ marginRight: 10, color: '#ffcf8f', fontSize: 12.5 }}>در حال اتصال…</span>
        )}
        {waiting && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginRight: 10, color: 'var(--green)', fontSize: 12.5 }}>
            <Phone size={12} /> در حال زنگ زدن…
          </span>
        )}
        {connState === ConnectionState.Reconnecting && (
          <span style={{ marginRight: 10, color: '#ffcf8f', fontSize: 12.5 }}>در حال اتصال مجدد…</span>
        )}
        {recording && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginRight: 10, color: '#ef4444', fontSize: 12.5 }}>
            <Circle size={11} fill="#ef4444" color="#ef4444" /> در حال ضبط
          </span>
        )}
      </div>

      <div className="call-grid" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
        {participants.map((p) => {
          const isLocal = room && p === room.localParticipant;
          return (
            <ParticipantTile
              key={p.sid || p.identity}
              participant={p}
              isLocal={isLocal}
              sinkId={sinkId}
              fallback={isLocal ? { name: user.full_name, color: user.avatar_color } : {}}
            />
          );
        })}
      </div>

      <div className="call-controls">
        {/* منوی دستگاه‌ها (میکروفون/دوربین/بلندگو) */}
        <div style={{ position: 'relative' }}>
          <button className="call-btn" onClick={() => setShowMenu(o => !o)} title="تنظیمات صدا و تصویر">
            <Settings size={22} />
          </button>
          {showMenu && (
            <div className="call-menu">
              {canPickOutput && devices.audiooutput.length > 0 && (
                <>
                  <div className="head"><Volume2 size={12} style={{ verticalAlign: -2 }} /> خروجی صدا</div>
                  {devices.audiooutput.map((d, i) => (
                    <button key={d.deviceId || i} className={`item ${sinkId === d.deviceId ? 'active' : ''}`}
                      onClick={() => switchDevice('audiooutput', d.deviceId)}>{d.label || `خروجی ${i + 1}`}</button>
                  ))}
                </>
              )}
              {devices.audioinput.length > 0 && (
                <>
                  <div className="head"><Mic size={12} style={{ verticalAlign: -2 }} /> میکروفون</div>
                  {devices.audioinput.map((d, i) => (
                    <button key={d.deviceId || i} className="item"
                      onClick={() => switchDevice('audioinput', d.deviceId)}>{d.label || `میکروفون ${i + 1}`}</button>
                  ))}
                </>
              )}
              {activeCall.video && devices.videoinput.length > 0 && (
                <>
                  <div className="head"><Video size={12} style={{ verticalAlign: -2 }} /> دوربین</div>
                  {devices.videoinput.map((d, i) => (
                    <button key={d.deviceId || i} className="item"
                      onClick={() => switchDevice('videoinput', d.deviceId)}>{d.label || `دوربین ${i + 1}`}</button>
                  ))}
                </>
              )}
            </div>
          )}
        </div>

        <button className={`call-btn ${micOn ? '' : 'off'}`} onClick={toggleMic} title="میکروفون">
          {micOn ? <Mic size={22} /> : <MicOff size={22} />}
        </button>

        {activeCall.video && (
          <button className={`call-btn ${camOn ? '' : 'off'}`} onClick={toggleCam} title="دوربین">
            {camOn ? <Video size={22} /> : <VideoOff size={22} />}
          </button>
        )}

        <button className={`call-btn ${screenOn ? 'off' : ''}`} onClick={toggleScreen} title="اشتراک صفحه">
          {screenOn ? <MonitorOff size={22} /> : <MonitorUp size={22} />}
        </button>

        <button className={`call-btn ${recording ? 'off' : ''}`} onClick={recording ? stopRecording : startRecording}
          title={recording ? 'توقف ضبط' : 'ضبط تماس'}>
          {recording ? <Square size={20} fill="currentColor" /> : <Circle size={22} color="#ef4444" fill="#ef4444" />}
        </button>

        <button className="call-btn end" onClick={hangUp} title="پایان تماس">
          <PhoneOff size={22} />
        </button>
      </div>
    </div>
  );
}

export function IncomingCallBanner() {
  const { incomingCall, setIncomingCall, setActiveCall, socketEmit } = useStore();
  if (!incomingCall) return null;
  const accept = () => {
    setActiveCall({
      room: incomingCall.room,
      video: incomingCall.video,
      title: incomingCall.title || `تماس با ${incomingCall.from.name}`,
      conversation_id: incomingCall.conversation_id || null,
      group: !!incomingCall.group,
    });
    setIncomingCall(null);
  };
  const reject = () => {
    socketEmit('call:reject', { room: incomingCall.room, to_user_id: incomingCall.from.id });
    setIncomingCall(null);
  };
  return (
    <div className="incoming-call">
      <Avatar name={incomingCall.from.name} color={incomingCall.from.color} size={46} />
      <div style={{ flex: 1 }}>
        <b>{incomingCall.from.name}</b>
        <div style={{ fontSize: 12.5, color: '#aab0d0' }}>
          {incomingCall.video ? 'تماس تصویری' : 'تماس صوتی'}{incomingCall.title ? ` · ${incomingCall.title}` : ''}
        </div>
      </div>
      <button className="call-btn" style={{ width: 44, height: 44, background: 'var(--green)' }} onClick={accept}><Phone size={19} /></button>
      <button className="call-btn end" style={{ width: 44, height: 44 }} onClick={reject}><PhoneOff size={19} /></button>
    </div>
  );
}
