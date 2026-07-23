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

// تصویرِ ضمیمهٔ فرآیند/درخواست (نمایش inline)
export function workflowFileUrl(id) {
  return `/api/workflows/files/${id}?token=${encodeURIComponent(token)}`;
}

// آپلود تصویر برای فرآیند/درخواست → id فایل را برمی‌گرداند
export async function uploadWorkflowImage(file) {
  const fd = new FormData();
  fd.append('image', file);
  const res = await api('/workflows/upload', { method: 'POST', formData: fd });
  return res.id;
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
