const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:4000';

function getFilenameFromContentDisposition(value) {
  if (!value) return null;
  const match = /filename\s*=\s*"?([^";]+)"?/i.exec(value);
  return match?.[1] || null;
}

export async function uploadSchedule(file) {
  const fd = new FormData();
  fd.append('file', file);
  const res = await fetch(`${API_BASE}/upload`, { method: 'POST', body: fd });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error || `Upload failed: ${res.statusText}`);
  }

  const contentDisposition = res.headers.get('content-disposition');
  const headerName = res.headers.get('x-output-filename');
  const fileName = headerName || getFilenameFromContentDisposition(contentDisposition) || 'output.xlsx';
  const blob = await res.blob();

  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    URL.revokeObjectURL(url);
  }

  return { outputFileName: fileName };
}

export async function fetchWeeks() {
  const res = await fetch(`${API_BASE}/allocation/weeks`);
  if (!res.ok) throw new Error(`fetchWeeks failed: ${res.statusText}`);
  return res.json();
}

export async function fetchWeekDetail(weekColumn) {
  const res = await fetch(`${API_BASE}/allocation/week/${encodeURIComponent(weekColumn)}`);
  if (!res.ok) throw new Error(`fetchWeekDetail failed: ${res.statusText}`);
  return res.json();
}
