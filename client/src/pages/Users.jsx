import React, { useState, useRef, useEffect } from 'react';
import { Plus, Pencil, Search, Trash2, Camera } from 'lucide-react';
import { api } from '../api.js';
import { useStore } from '../store.jsx';
import { Modal, Field, Avatar, Segmented, UserPicker } from '../components/common.jsx';
import ImageCropper from '../components/ImageCropper.jsx';

const ROLES = { admin: ['مدیر سامانه', 'badge-red'], manager: ['سرگروه', 'badge-amber'], employee: ['کارمند', 'badge-sky'] };
const EXTRA_PERMS = [
  ['users.manage', 'مدیریت کاربران'],
  ['departments.manage', 'مدیریت واحدها'],
  ['workflows.manage', 'مدیریت همه فرآیندها'],
  ['tasks.assign', 'واگذاری تسک در واحد خود'],
];

export default function UsersPage() {
  const { user: me, users, departments, hasPerm, refreshDirectory, toast } = useStore();
  const [editing, setEditing] = useState(null);
  const [confirmDel, setConfirmDel] = useState(null);
  const [search, setSearch] = useState('');
  const canManage = hasPerm('users.manage');
  const filtered = users.filter(u => !search
    || u.full_name.includes(search) || u.username.includes(search)
    || (u.department_name || '').includes(search) || (u.position || '').includes(search));

  const removeUser = async () => {
    try {
      await api(`/users/${confirmDel.id}`, { method: 'DELETE' });
      setConfirmDel(null);
      await refreshDirectory();
      toast('کاربر حذف شد');
    } catch (e) { toast(e.message, 'error'); }
  };

  return (
    <div className="content">
      <div className="page-head">
        <h2>کاربران سامانه</h2>
        <div style={{ display: 'flex', gap: 10 }}>
          <div style={{ position: 'relative' }}>
            <Search size={15} style={{ position: 'absolute', right: 11, top: 11, color: 'var(--text-3)' }} />
            <input className="input" style={{ paddingRight: 34, width: 230 }} placeholder="جستجوی کاربر…"
              value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <button className="btn btn-primary" onClick={() => setEditing('new')}><Plus size={17} /> کاربر جدید</button>
        </div>
      </div>
      <div className="card">
        <table className="table">
          <thead>
            <tr><th>نام</th><th>نام کاربری</th><th>واحد</th><th>سمت</th><th>نقش</th><th>وضعیت</th><th></th></tr>
          </thead>
          <tbody>
            {filtered.map(u => {
              const [rl, rc] = ROLES[u.role] || ROLES.employee;
              return (
                <tr key={u.id}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <Avatar name={u.full_name} color={u.avatar_color} size={34} showStatus userId={u.id} avatar={u.avatar_path} />
                      <b>{u.full_name}</b>
                    </div>
                  </td>
                  <td dir="ltr" style={{ textAlign: 'right', color: 'var(--text-2)' }}>{u.username}</td>
                  <td>{u.department_name || '—'}</td>
                  <td>{u.position || '—'}</td>
                  <td><span className={`badge ${rc}`}>{rl}</span></td>
                  <td>{u.is_active ? <span className="badge badge-green">فعال</span> : <span className="badge badge-gray">غیرفعال</span>}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button className="icon-btn" style={{ width: 32, height: 32 }} title="ویرایش" onClick={() => setEditing(u)}><Pencil size={15} /></button>
                      {canManage && u.id !== me.id && (
                        <button className="icon-btn" style={{ width: 32, height: 32, color: 'var(--red)' }} title="حذف کاربر" onClick={() => setConfirmDel(u)}><Trash2 size={15} /></button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {editing && (
        <UserModal user={editing === 'new' ? null : editing} departments={departments}
          onClose={() => setEditing(null)}
          onDone={async () => { setEditing(null); await refreshDirectory(); toast('ذخیره شد'); }} />
      )}
      {confirmDel && (
        <Modal title="حذف کاربر" onClose={() => setConfirmDel(null)}
          footer={<>
            <button className="btn btn-ghost" onClick={() => setConfirmDel(null)}>انصراف</button>
            <button className="btn btn-danger" onClick={removeUser}>حذف کامل</button>
          </>}>
          <p>کاربر «{confirmDel.full_name}» به‌طور کامل حذف شود؟</p>
          <p style={{ fontSize: 12.5, color: 'var(--text-3)' }}>
            همهٔ پیام‌ها، تسک‌ها و درخواست‌های او پاک می‌شود و این عمل قابل بازگشت نیست.
          </p>
        </Modal>
      )}
    </div>
  );
}

function UserModal({ user: u, departments, onClose, onDone }) {
  const { user: me, hasPerm, refreshDirectory, reloadUser, toast } = useStore();
  // [مورد ۶] اجازهٔ دیدن درخواست‌های کاربرانِ مشخص (فقط ادمین/مدیریت تنظیم می‌کند)
  const canGrant = hasPerm('workflows.manage') || me.role === 'admin';
  const [viewTargets, setViewTargets] = useState([]);
  const [viewTargetsOrig, setViewTargetsOrig] = useState([]);
  useEffect(() => {
    if (!u || !canGrant) return;
    api('/workflows/request-grants').then(r => {
      const mine = (r.grants || []).filter(g => g.viewer_id === u.id).map(g => g.target_id);
      setViewTargets(mine); setViewTargetsOrig(mine);
    }).catch(() => {});
  }, [u?.id]);
  const syncGrants = async () => {
    if (!u || !canGrant) return;
    const cur = new Set(viewTargets), orig = new Set(viewTargetsOrig);
    for (const t of viewTargets) if (!orig.has(t)) await api('/workflows/request-grants', { method: 'POST', body: { viewer_id: u.id, target_id: t } });
    for (const t of viewTargetsOrig) if (!cur.has(t)) await api('/workflows/request-grants', { method: 'DELETE', body: { viewer_id: u.id, target_id: t } });
  };
  const fileRef = useRef(null);
  const [avatarPath, setAvatarPath] = useState(u?.avatar_path || '');
  const [uploading, setUploading] = useState(false);
  const [cropAvatar, setCropAvatar] = useState(null);
  const [f, setF] = useState({
    username: u?.username || '', password: '', full_name: u?.full_name || '',
    role: u?.role || 'employee', department_id: u?.department_id || '',
    position: u?.position || '', phone: u?.phone || '', email: u?.email || '',
    is_active: u ? !!u.is_active : true,
    permissions: (() => { try { return JSON.parse(u?.permissions || '[]'); } catch { return []; } })(),
    managed_dept_ids: Array.isArray(u?.managed_dept_ids) ? u.managed_dept_ids : [],
  });
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setF(x => ({ ...x, [k]: v }));

  const save = async () => {
    setBusy(true);
    try {
      const body = { ...f, department_id: f.department_id ? Number(f.department_id) : null,
        managed_dept_ids: f.managed_dept_ids.map(Number) };
      if (!body.password) delete body.password;
      if (u) await api(`/users/${u.id}`, { method: 'PUT', body });
      else await api('/users', { method: 'POST', body });
      await syncGrants();
      onDone();
    } catch (e) { toast(e.message, 'error'); }
    setBusy(false);
  };

  const uploadAvatar = async (file) => {
    if (!u || !file) return;
    if (!file.type.startsWith('image/')) return toast('فقط فایل تصویری مجاز است', 'error');
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('avatar', file);
      const r = await api(`/users/${u.id}/avatar`, { method: 'POST', formData: fd });
      setAvatarPath(r.avatar_path);
      await refreshDirectory();
      if (u.id === me.id) await reloadUser();
      toast('عکس پروفایل به‌روزرسانی شد');
    } catch (e) { toast(e.message, 'error'); }
    setUploading(false);
  };

  return (
    <Modal title={u ? `ویرایش ${u.full_name}` : 'کاربر جدید'} onClose={onClose} wide
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>انصراف</button>
        <button className="btn btn-primary" disabled={busy || !f.full_name || !f.username || (!u && !f.password)} onClick={save}>ذخیره</button>
      </>}>
      {u && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16 }}>
          <div className="avatar-edit" onClick={() => !uploading && fileRef.current?.click()} title="تغییر عکس پروفایل">
            <Avatar name={f.full_name} color={u.avatar_color} size={56} avatar={avatarPath} />
            <div className="overlay"><Camera size={18} /></div>
            <input ref={fileRef} type="file" accept="image/*" onChange={e => {
              const file = e.target.files[0]; e.target.value = '';
              if (!file) return;
              if (!file.type.startsWith('image/')) return toast('فقط فایل تصویری مجاز است', 'error');
              setCropAvatar(file);
            }} />
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--text-2)' }}>برای تغییر عکس پروفایل روی تصویر کلیک کنید</div>
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="نام کامل"><input className="input" value={f.full_name} onChange={e => set('full_name', e.target.value)} /></Field>
        <Field label="نام کاربری"><input className="input" value={f.username} onChange={e => set('username', e.target.value)} disabled={!!u} dir="ltr" style={{ textAlign: 'left' }} /></Field>
        <Field label={u ? 'رمز عبور جدید (خالی = بدون تغییر)' : 'رمز عبور'}>
          <input className="input" type="password" value={f.password} onChange={e => set('password', e.target.value)} dir="ltr" style={{ textAlign: 'left' }} />
        </Field>
        <Field label="نقش">
          <select className="input" value={f.role} onChange={e => set('role', e.target.value)}>
            <option value="employee">کارمند</option>
            <option value="manager">سرگروه</option>
            <option value="admin">مدیر سامانه</option>
          </select>
        </Field>
        <Field label="واحد سازمانی">
          <select className="input" value={f.department_id} onChange={e => set('department_id', e.target.value)}>
            <option value="">— بدون واحد —</option>
            {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </Field>
        <Field label="سمت"><input className="input" value={f.position} onChange={e => set('position', e.target.value)} /></Field>
        <Field label="تلفن"><input className="input" value={f.phone} onChange={e => set('phone', e.target.value)} dir="ltr" style={{ textAlign: 'left' }} /></Field>
        <Field label="ایمیل"><input className="input" value={f.email} onChange={e => set('email', e.target.value)} dir="ltr" style={{ textAlign: 'left' }} /></Field>
      </div>
      <Field label="مدیرِ کدام واحدها؟ (دسترسی کامل به آن واحدها)"
        hint="کاربر روی واحدهای انتخاب‌شده مدیر محسوب می‌شود؛ درخواست‌ها و اعضای همان واحدها را می‌بیند و در گردش‌کار «سرگروه واحد» به‌حساب می‌آید.">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {departments.map(d => {
            const on = f.managed_dept_ids.map(Number).includes(d.id);
            return (
              <button key={d.id} type="button" className={`btn btn-sm ${on ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => set('managed_dept_ids', on
                  ? f.managed_dept_ids.filter(x => Number(x) !== d.id)
                  : [...f.managed_dept_ids, d.id])}>
                {d.name}
              </button>
            );
          })}
        </div>
      </Field>
      {u && canGrant && (
        <Field label="می‌تواند درخواست‌های این کاربران را ببیند"
          hint="علاوه بر درخواست‌های خودش، درخواست‌های کاربران انتخاب‌شده را هم می‌بیند (تنظیم دستی فردی).">
          <UserPicker value={viewTargets} onChange={setViewTargets} multi exclude={[u.id]} />
        </Field>
      )}
      <Field label="دسترسی‌های ویژه (ACL)">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {EXTRA_PERMS.map(([key, label]) => {
            const has = f.permissions.includes(key);
            return (
              <button key={key} type="button" className={`btn btn-sm ${has ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => set('permissions', has ? f.permissions.filter(p => p !== key) : [...f.permissions, key])}>
                {label}
              </button>
            );
          })}
        </div>
      </Field>
      {u && (
        <Field label="وضعیت حساب">
          <Segmented value={f.is_active ? 1 : 0} onChange={v => set('is_active', !!v)}
            options={[
              { value: 1, label: 'فعال', tone: 'success' },
              { value: 0, label: 'غیرفعال', tone: 'danger', hint: 'کاربر غیرفعال نمی‌تواند وارد شود' },
            ]} />
        </Field>
      )}
      {cropAvatar && (
        <ImageCropper
          file={cropAvatar}
          title="برش عکس پروفایل"
          aspects={[{ label: 'مربع', value: 1 }]}
          round
          outputType="image/jpeg"
          outputMaxW={512}
          onCancel={() => setCropAvatar(null)}
          onDone={async (file) => { setCropAvatar(null); await uploadAvatar(file); }}
        />
      )}
    </Modal>
  );
}
