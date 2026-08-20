/** Presentation-only formatting. No business calculations live here. */

const numberFormat = new Intl.NumberFormat('en-US');

export function formatInt(value) {
  const n = Number(value);
  return Number.isFinite(n) ? numberFormat.format(Math.round(n)) : '—';
}

export function formatNumber(value, digits = 1) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function formatPercent(value, digits = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return `${n.toFixed(digits)}%`;
}

/** Minutes -> "1,425 min" (the unit the workbook itself uses). */
export function formatMinutes(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return `${numberFormat.format(Math.round(n))} min`;
}

export function formatBytes(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n)) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Excel serial dates (the schedule sheet stores its day headers as serials, e.g.
 * 45810 = 2025-06-02). Converted only when the value is plausibly a serial;
 * anything else is shown verbatim rather than guessed at.
 */
const EXCEL_EPOCH_UTC = Date.UTC(1899, 11, 30);
const DAY_MS = 86400000;
const MIN_SERIAL = 20000; // ~1954
const MAX_SERIAL = 80000; // ~2119

export function excelSerialToDate(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < MIN_SERIAL || n > MAX_SERIAL) return null;
  const date = new Date(EXCEL_EPOCH_UTC + n * DAY_MS);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** "Mon 2 Jun" for a date header, or the raw value when it is not a serial. */
export function formatDayHeader(value) {
  const date = excelSerialToDate(value);
  if (!date) return String(value ?? '');
  return date.toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC'
  });
}

export function formatDayHeaderShort(value) {
  const date = excelSerialToDate(value);
  if (!date) return String(value ?? '');
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' });
}

export function formatDateRange(values) {
  if (!Array.isArray(values) || values.length === 0) return null;
  const first = excelSerialToDate(values[0]);
  const last = excelSerialToDate(values[values.length - 1]);
  if (!first || !last) return null;
  const opts = { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' };
  return `${first.toLocaleDateString('en-GB', opts)} – ${last.toLocaleDateString('en-GB', opts)}`;
}

export function formatTimestamp(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

/** Short, human reference for a run id (full id stays available in a title). */
export function shortId(id) {
  if (!id) return '—';
  const s = String(id);
  return s.length <= 8 ? s : s.slice(-8);
}
