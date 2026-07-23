import React, { useState } from 'react';
import { Plus, Pencil, Trash2, Crown, Search } from 'lucide-react';
import { api } from '../api.js';
import { useStore } from '../store.jsx';
import { Modal, Field, UserPicker, Segmented } from '../components/common.jsx';
import { fa } from '../utils.js';

export default function Departments() {
  const { departments, refreshDirectory, toast } = useStore();
  const [editing, setEditing] = useState(null);
  const [search, setSearch] = useState('');
  const filtered = departments.filter(d => !search || d.name.includes(search)
    || (d.description || '').includes(search) || (d.manager_name || '').includes(search));

  const remove = async (d) => {
    if (!window.confirm(`واحد «${d.name}» حذف شود؟ اعضای آن بدون واحد می‌شوند.`)) return;
    try { await api(`/departments/${d.id}`, { method: 'DELETE' }); await refreshDirectory(); toast('حذف شد'); }
    catch (e) { toast(e.message, 'error'); }
  };

  return (
    <div className="content">
      <div className="page-head">
        <h2>واحدهای سازمانی</h2>
        <div style={{ display: 'flex', gap: 10 }}>
          <div style={{ position: 'relative' }}>
            <Search size={15} style={{ position: 'absolute', right: 11, top: 11, color: 'var(--text-3)' }} />
            <input className="input" style={{ paddingRight: 34, width: 220 }} placeholder="جستجوی واحد…"
              value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <button className="btn btn-primary" onClick={() => setEditing('new')}><Plus size={17} /> واحد جدید</button>
        </div>
      </div>
      <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
        {filtered.map(d => (
          <div key={d.id} className="card card-pad">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: 8 }}>
              <b style={{ fontSize: 15 }}>{d.name}</b>
              <div style={{ display: 'flex', gap: 4 }}>
                <button className="icon-btn" style={{ width: 30, height: 30 }} onClick={() => setEditing(d)}><Pencil size={14} /></button>
                <button className="icon-btn" style={{ width: 30, height: 30, color: 'var(--red)' }} onClick={() => remove(d)}><Trash2 size={14} /></button>
              </div>
            </div>
            {d.description && <p style={{ fontSize: 12.8, color: 'var(--text-2)', marginBottom: 10 }}>{d.description}</p>}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {!!d.is_management && <span className="badge badge-red">واحد مدیریت</span>}
              <span className="badge badge-amber"><Crown size={12} /> {d.manager_name || 'بدون سرگروه'}</span>
              <span className="badge badge-gray">{fa(d.member_count)} عضو</span>
            </div>
          </div>
        ))}
      </div>
      {editing && (
        <DeptModal dept={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onDone={async () => { setEditing(null); await refreshDirectory(); toast('ذخیره شد'); }} />
      )}
    </div>
  );
}

function DeptModal({ dept, onClose, onDone }) {
  const { toast } = useStore();
  const [name, setName] = useState(dept?.name || '');
  const [description, setDescription] = useState(dept?.description || '');
  const [manager, setManager] = useState(dept?.manager_id || null);
  const [isManagement, setIsManagement] = useState(!!dept?.is_management);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      const body = { name, description, manager_id: manager, is_management: isManagement };
      if (dept) await api(`/departments/${dept.id}`, { method: 'PUT', body });
      else await api('/departments', { method: 'POST', body });
      onDone();
    } catch (e) { toast(e.message, 'error'); }
    setBusy(false);
  };

  return (
    <Modal title={dept ? `ویرایش ${dept.name}` : 'واحد جدید'} onClose={onClose}
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>انصراف</button>
        <button className="btn btn-primary" disabled={!name.trim() || busy} onClick={save}>ذخیره</button>
      </>}>
      <Field label="نام واحد"><input className="input" value={name} onChange={e => setName(e.target.value)} autoFocus /></Field>
      <Field label="توضیحات"><textarea className="input" value={description} onChange={e => setDescription(e.target.value)} /></Field>
      <Field label="سرگروه / مدیر واحد"><UserPicker value={manager} onChange={setManager} /></Field>
      <Field label="نوع واحد">
        <Segmented value={isManagement ? 1 : 0} onChange={v => setIsManagement(!!v)}
          options={[
            { value: 0, label: 'واحد عادی' },
            { value: 1, label: 'واحد مدیریت', tone: 'danger', hint: 'اعضای این واحد می‌توانند به همه واحدها تسک بدهند' },
          ]} />
        <div style={{ fontSize: 11.5, color: 'var(--text-3)', marginTop: 6 }}>
          {isManagement ? 'اعضای این واحد به همه واحدها تسک می‌دهند.' : 'اعضای این واحد فقط در همین واحد تسک می‌دهند.'}
        </div>
      </Field>
    </Modal>
  );
}
