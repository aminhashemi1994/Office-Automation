import React, { useState } from 'react';
import { Plus, Pencil, Trash2, Crown, Search, UserCog, AlertTriangle, X } from 'lucide-react';
import { api } from '../api.js';
import { useStore } from '../store.jsx';
import { Modal, Field, Segmented } from '../components/common.jsx';
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
        <div>
          <h2>واحدهای سازمانی</h2>
          <p style={{ fontSize: 12.5, color: 'var(--text-3)', margin: '4px 0 0', maxWidth: 620, lineHeight: 1.85 }}>
            هر واحد دو سِمَت دارد: <b>سرگروه</b> (سطح اول تایید) و <b>مدیر</b> (بالادستِ سرگروه).
            یک نفر می‌تواند هر دو را داشته باشد. تا وقتی واحدی هیچ‌کدام را نداشته باشد،
            درخواست‌هایش روی میز مدیر سامانه می‌افتد.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <div style={{ position: 'relative' }}>
            <Search size={15} style={{ position: 'absolute', right: 11, top: 11, color: 'var(--text-3)' }} />
            <input className="input" style={{ paddingRight: 34, width: 220 }} placeholder="جستجوی واحد…"
              value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <button className="btn btn-primary" onClick={() => setEditing('new')}><Plus size={17} /> واحد جدید</button>
        </div>
      </div>
      {(() => {
        const missing = departments.filter(d => !(d.heads || []).length && !(d.directors || []).length);
        return missing.length ? (
          <div className="card card-pad" style={{ marginBottom: 16, borderInlineStart: '4px solid var(--red)' }}>
            <b style={{ fontSize: 13.3, color: 'var(--red)' }}>
              {fa(missing.length)} واحد هنوز سرگروه یا مدیر ندارد
            </b>
            <div style={{ fontSize: 12.5, color: 'var(--text-2)', marginTop: 4, lineHeight: 1.85 }}>
              {missing.map(d => d.name).join('، ')} — درخواست‌های این واحدها به مدیر سامانه می‌رود.
              روی هر واحد «ویرایش» بزنید و مسئولش را مشخص کنید.
            </div>
          </div>
        ) : null;
      })()}

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
              {(d.directors || []).map(m => (
                <span key={`dir${m.id}`} className="badge badge-red" title="مدیر واحد">
                  <Crown size={12} /> مدیر: {m.full_name}
                </span>
              ))}
              {(d.heads || []).map(m => (
                <span key={`h${m.id}`} className="badge badge-amber" title="سرگروه واحد">
                  <UserCog size={12} /> سرگروه: {m.full_name}
                </span>
              ))}
              {/* بدونِ مسئول یعنی درخواست‌های این واحد روی میز کسی نمی‌نشیند — باید تو چشم بزند */}
              {!(d.directors || []).length && !(d.heads || []).length && (
                <span className="badge badge-red" title="درخواست‌های این واحد به مدیر سامانه می‌روند">
                  <AlertTriangle size={12} /> سرگروه/مدیر ندارد
                </span>
              )}
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

// انتخابگرِ چندنفره برای یک سِمَت. عمداً بیرون از کامپوننتِ مودال تعریف شده تا با
// هر تایپ در فیلدهای دیگر، از نو ساخته نشود.
function PositionPicker({ value, onChange, hint, users }) {
  return (
    <>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
        {value.length === 0 && <span style={{ fontSize: 12, color: 'var(--text-3)' }}>کسی انتخاب نشده است.</span>}
        {value.map(id => (
          <span key={id} className="badge badge-sky" style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            {users.find(u => u.id === id)?.full_name || '—'}
            <X size={12} style={{ cursor: 'pointer' }} onClick={() => onChange(value.filter(x => x !== id))} />
          </span>
        ))}
      </div>
      <select className="input" value="" onChange={e => {
        const id = Number(e.target.value);
        if (id && !value.includes(id)) onChange([...value, id]);
      }}>
        <option value="">+ افزودن…</option>
        {users.filter(u => u.is_active && !value.includes(u.id))
          .map(u => <option key={u.id} value={u.id}>{u.full_name}{u.department_name ? ` (${u.department_name})` : ''}</option>)}
      </select>
      {hint && <div style={{ fontSize: 11.5, color: 'var(--text-3)', marginTop: 5, lineHeight: 1.75 }}>{hint}</div>}
    </>
  );
}

function DeptModal({ dept, onClose, onDone }) {
  const { toast, users } = useStore();
  const [name, setName] = useState(dept?.name || '');
  const [description, setDescription] = useState(dept?.description || '');
  const [isManagement, setIsManagement] = useState(!!dept?.is_management);
  // سرگروه و مدیر، دو سِمَتِ جدا. یک نفر می‌تواند در هر دو فهرست باشد.
  const [heads, setHeads] = useState(() => (dept?.heads || []).map(m => m.id));
  const [directors, setDirectors] = useState(() => (dept?.directors || []).map(m => m.id));
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      const body = { name, description, is_management: isManagement };
      const id = dept ? dept.id : (await api('/departments', { method: 'POST', body })).id;
      if (dept) await api(`/departments/${dept.id}`, { method: 'PUT', body });
      await api(`/departments/${id}/positions`, { method: 'POST', body: { head_ids: heads, director_ids: directors } });
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
      <Field label="سرگروهِ واحد">
        <PositionPicker value={heads} onChange={setHeads} users={users}
          hint="سرگروه، سطح اولِ تایید است. در تعریف فرآیند می‌توانید مرحله‌ای بگذارید که فقط سرگروه تایید کند." />
      </Field>
      <Field label="مدیرِ واحد">
        <PositionPicker value={directors} onChange={setDirectors} users={users}
          hint="مدیر بالادستِ سرگروه است. یک نفر می‌تواند هم‌زمان سرگروه و مدیر باشد — کافی است در هر دو فهرست بیاید." />
      </Field>
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
