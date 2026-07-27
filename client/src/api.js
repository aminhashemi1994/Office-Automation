let token = localStorage.getItem('token') || '';

export function setToken(t) {
  token = t || '';
  if (t) localStorage.setItem('token', t);
  else localStorage.removeItem('token');
}
export function getToken() { return token; }

export async function api(path, { method = 'GET', body, formData } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(`/api${path}`, {
    method,
    headers,
    body: formData ? formData : body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch {}
  if (!res.ok) {
    if (res.status === 401) { setToken(''); window.location.href = '/login'; }
    throw new Error(data?.error || 'خطا در ارتباط با سرور');
  }
  return data;
}

export function fileUrl(id) {
  return `/api/chat/files/${id}?token=${encodeURIComponent(token)}`;
}

// فایلِ ضمیمهٔ فرآیند/درخواست — عکس و PDF داخل مرورگر باز می‌شوند،
// بقیهٔ اسناد (Word/Excel/…) توسط سرور به‌صورت دانلود ارائه می‌شوند.
export function workflowFileUrl(id) {
  return `/api/workflows/files/${id}?token=${encodeURIComponent(token)}`;
}

// همیشه دانلود (برای دکمهٔ «دریافت فایل»)
export function workflowFileDownloadUrl(id) {
  return `/api/workflows/files/${id}?download=1&token=${encodeURIComponent(token)}`;
}

// آپلود یک فایل ضمیمه (هر نوع سند یا عکس) → { id, original_name, mime, size }
export async function uploadWorkflowFile(file) {
  const fd = new FormData();
  fd.append('file', file);
  const res = await api('/workflows/upload', { method: 'POST', formData: fd });
  return { id: res.id, original_name: res.original_name || file.name, mime: res.mime || file.type || '', size: res.size ?? file.size ?? 0 };
}

// سازگاری با کدهای قبلی — فقط id را برمی‌گرداند
export async function uploadWorkflowImage(file) {
  return (await uploadWorkflowFile(file)).id;
}

// اطلاعات (نام/نوع/حجم) چند فایل با یک درخواست
export async function fetchWorkflowFilesMeta(ids) {
  const list = [...new Set((ids || []).map(Number).filter(Boolean))];
  if (!list.length) return [];
  const res = await api(`/workflows/files-meta?ids=${list.join(',')}`);
  return res.files || [];
}

export function recordingStreamUrl(id) {
  return `/api/chat/recordings/${id}/stream?token=${encodeURIComponent(token)}`;
}

export function recordingDownloadUrl(id) {
  return `/api/chat/recordings/${id}?token=${encodeURIComponent(token)}`;
}

// عکس پروفایل عمومی سرو می‌شود
export function avatarUrl(pathName) {
  return pathName ? `/avatars/${pathName}` : '';
}
