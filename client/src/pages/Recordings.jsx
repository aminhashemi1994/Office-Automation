import React, { useEffect, useState } from 'react';
import { Video, Mic, Play, Download, Trash2, Search, X } from 'lucide-react';
import { api, recordingStreamUrl, recordingDownloadUrl } from '../api.js';
import { useStore } from '../store.jsx';
import { fmtDateTime, fa, fmtSize } from '../utils.js';
import { Modal } from '../components/common.jsx';

const pers = (n) => String(n).replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[+d]);
function fmtDuration(sec) {
  const s = Number(sec) || 0;
  const m = Math.floor(s / 60), r = s % 60;
  return `${pers(m)}:${pers(String(r).padStart(2, '0'))}`;
}

export default function Recordings() {
  const { user, toast } = useStore();
  const [rows, setRows] = useState([]);
  const [search, setSearch] = useState('');
  const [playing, setPlaying] = useState(null);
  const [confirmDel, setConfirmDel] = useState(null);
  const isAdmin = user.role === 'admin';

  const load = async () => {
    try { const r = await api('/chat/recordings'); setRows(r.recordings); }
    catch (e) { toast(e.message, 'error'); }
  };
  useEffect(() => { load(); }, []);

  const del = async () => {
    try {
      await api(`/chat/recordings/${confirmDel.id}`, { method: 'DELETE' });
      setConfirmDel(null);
      if (playing?.id === confirmDel.id) setPlaying(null);
      load();
      toast('ضبط حذف شد');
    } catch (e) { toast(e.message, 'error'); }
  };

  const filtered = rows.filter(r => !search
    || (r.title || '').includes(search)
    || (r.recorder_name || '').includes(search)
    || (r.conv_name || '').includes(search));

  return (
    <div className="content">
      <div className="page-head">
        <h2>ضبط جلسات و تماس‌ها</h2>
        <div style={{ position: 'relative' }}>
          <Search size={15} style={{ position: 'absolute', right: 11, top: 11, color: 'var(--text-3)' }} />
          <input className="input" style={{ paddingRight: 34, width: 240 }} placeholder="جستجو در ضبط‌ها…"
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>
      </div>

      <div className="card">
        {filtered.length === 0 ? (
          <div className="empty"><Video size={40} /><div>هیچ ضبطی موجود نیست</div></div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>نوع</th><th>عنوان</th><th>ضبط‌کننده</th><th>گفتگو</th>
                <th>مدت</th><th>حجم</th><th>تاریخ</th><th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => (
                <tr key={r.id}>
                  <td>
                    <span className={`badge ${r.kind === 'video' ? 'badge-primary' : 'badge-sky'}`}>
                      {r.kind === 'video' ? <Video size={12} /> : <Mic size={12} />}
                      {r.kind === 'video' ? ' تصویری' : ' صوتی'}
                    </span>
                  </td>
                  <td style={{ fontWeight: 600 }}>{r.title || 'تماس'}</td>
                  <td>{r.recorder_name || '—'}</td>
                  <td>{r.conv_name || (r.conv_type === 'dm' ? 'گفتگوی خصوصی' : '—')}</td>
                  <td>{fmtDuration(r.duration)}</td>
                  <td style={{ fontSize: 12.5, color: 'var(--text-2)' }}>{fmtSize(r.size)}</td>
                  <td style={{ fontSize: 12.5, color: 'var(--text-3)' }}>{fmtDateTime(r.created_at)}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button className="icon-btn" style={{ width: 30, height: 30 }} title="پخش" onClick={() => setPlaying(r)}><Play size={14} /></button>
                      <a className="icon-btn" style={{ width: 30, height: 30 }} title="دانلود" href={recordingDownloadUrl(r.id)} download><Download size={14} /></a>
                      {isAdmin && (
                        <button className="icon-btn" style={{ width: 30, height: 30, color: 'var(--red)' }} title="حذف" onClick={() => setConfirmDel(r)}><Trash2 size={14} /></button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {playing && (
        <div className="player-backdrop" onClick={() => setPlaying(null)}>
          <div className="player-card" onClick={e => e.stopPropagation()}>
            <div className="player-head">
              <b style={{ fontSize: 15 }}>{playing.title || 'تماس'} · {playing.kind === 'video' ? 'تصویری' : 'صوتی'}</b>
              <button className="player-close" title="بستن" onClick={() => setPlaying(null)}><X size={20} /></button>
            </div>
            {playing.kind === 'video' ? (
              <video src={recordingStreamUrl(playing.id)} controls autoPlay style={{ width: '100%', borderRadius: 12, background: '#000', maxHeight: '72vh' }} />
            ) : (
              <audio src={recordingStreamUrl(playing.id)} controls autoPlay style={{ width: '100%' }} />
            )}
          </div>
        </div>
      )}

      {confirmDel && (
        <Modal title="حذف ضبط" onClose={() => setConfirmDel(null)}
          footer={<>
            <button className="btn btn-ghost" onClick={() => setConfirmDel(null)}>انصراف</button>
            <button className="btn btn-danger" onClick={del}>حذف قطعی</button>
          </>}>
          <p>آیا از حذف ضبط «{confirmDel.title || 'تماس'}» مطمئن هستید؟ این عمل قابل بازگشت نیست و فایل از سرور پاک می‌شود.</p>
        </Modal>
      )}
    </div>
  );
}
