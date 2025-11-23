const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:4000';

export async function uploadSchedule(file, onProgress) {
  const fd = new FormData();
  fd.append('file', file);
  const res = await fetch(`${API_BASE}/upload`, { method: 'POST', body: fd });
  if (!res.ok) throw new Error(`Upload failed: ${res.statusText}`);
  return res.json();
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
