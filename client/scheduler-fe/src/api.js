/**
 * API layer.
 *
 * Every function:
 *   - accepts an AbortSignal so views can cancel stale requests
 *   - throws ApiError on failure (never returns an empty result to mask an error)
 *   - validates the response shape, so a malformed payload fails loudly
 *
 * API_BASE is empty by default: in production the Express server serves this
 * bundle from the same origin, and in development vite.config.js proxies the API
 * paths to the backend. Set VITE_API_URL only when the backend lives elsewhere.
 */

const API_BASE = import.meta.env.VITE_API_URL || '';

export class ApiError extends Error {
  constructor(message, { status = 0, code = 'UNKNOWN', requestId = null } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.requestId = requestId;
  }

  /** True when retrying could plausibly succeed. */
  get isRetryable() {
    return this.status === 0 || this.status >= 500 || this.status === 429;
  }
}

const NETWORK_MESSAGE = 'Could not reach the server. Check that the backend is running.';

async function request(path, { signal, method = 'GET', body, headers } = {}) {
  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, { method, body, headers, signal });
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    throw new ApiError(NETWORK_MESSAGE, { status: 0, code: 'NETWORK_ERROR' });
  }

  if (!res.ok) {
    // The backend returns { error, code, requestId } for every handled failure.
    const payload = await res.json().catch(() => null);
    throw new ApiError(payload?.error || `Request failed (${res.status})`, {
      status: res.status,
      code: payload?.code || 'HTTP_ERROR',
      requestId: payload?.requestId || res.headers.get('x-request-id')
    });
  }

  return res;
}

async function requestJson(path, options) {
  const res = await request(path, options);
  const data = await res.json().catch(() => {
    throw new ApiError('The server returned a response that could not be read.', {
      status: res.status,
      code: 'MALFORMED_RESPONSE'
    });
  });
  return data;
}

function withRunId(path, runId) {
  return runId ? `${path}${path.includes('?') ? '&' : '?'}runId=${encodeURIComponent(runId)}` : path;
}

function assertShape(condition, code) {
  if (!condition) {
    throw new ApiError('The server returned data in an unexpected format.', {
      status: 200,
      code
    });
  }
}

/**
 * Week summaries for a planning run.
 *
 * The response carries an issue SUMMARY (counts, affected weeks, a few examples)
 * rather than every diagnostic — a real workbook produces ~2,800 of them. Use
 * fetchRunIssues() for the full, paginated list.
 *
 * @returns {{ run: object|null, weeks: object[], summary: object|null, issuesSummary: object[] }}
 */
export async function fetchWeeks({ runId, signal } = {}) {
  const data = await requestJson(withRunId('/allocation/weeks', runId), { signal });

  assertShape(data && typeof data === 'object', 'MALFORMED_WEEKS');
  assertShape(Array.isArray(data.weeks), 'MALFORMED_WEEKS');
  assertShape(Array.isArray(data.issuesSummary), 'MALFORMED_WEEKS');

  return {
    run: data.run || null,
    weeks: data.weeks,
    summary: data.summary || null,
    issuesSummary: data.issuesSummary
  };
}

/** Planning-run history. Lightweight metadata only. */
export async function fetchRuns({ page = 1, pageSize = 20, signal } = {}) {
  const data = await requestJson(`/runs?page=${page}&pageSize=${pageSize}`, { signal });
  assertShape(data && Array.isArray(data.runs), 'MALFORMED_RUNS');
  return data;
}

/** Full diagnostics for a run, paginated and optionally filtered. */
export async function fetchRunIssues(runId, { page = 1, pageSize = 50, code, week, signal } = {}) {
  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  if (code) params.set('code', code);
  if (week) params.set('week', week);

  const data = await requestJson(`/runs/${encodeURIComponent(runId)}/issues?${params}`, { signal });
  assertShape(data && Array.isArray(data.issues), 'MALFORMED_ISSUES');
  return data;
}

/**
 * Per-part allocation detail for one week.
 * @returns {{ run: object|null, week: string, dateHeaders: (string|number)[], parts: object[], issuesSummary: object[] }}
 */
export async function fetchWeekDetail(weekColumn, { runId, signal } = {}) {
  const path = withRunId(`/allocation/week/${encodeURIComponent(weekColumn)}`, runId);
  const data = await requestJson(path, { signal });

  assertShape(data && typeof data === 'object', 'MALFORMED_WEEK_DETAIL');
  assertShape(Array.isArray(data.parts), 'MALFORMED_WEEK_DETAIL');
  assertShape(Array.isArray(data.issuesSummary), 'MALFORMED_WEEK_DETAIL');

  return {
    run: data.run || null,
    week: data.week || weekColumn,
    dateHeaders: Array.isArray(data.dateHeaders) ? data.dateHeaders : [],
    parts: data.parts,
    issuesSummary: data.issuesSummary
  };
}

export async function fetchHealth({ signal } = {}) {
  return requestJson('/health', { signal });
}

function filenameFromContentDisposition(value) {
  if (!value) return null;
  const match = /filename\s*=\s*"?([^";]+)"?/i.exec(value);
  return match?.[1] || null;
}

/**
 * Upload a workbook. Returns the processed file as a blob plus the new run id,
 * WITHOUT triggering a download — the caller decides when to save it.
 * @returns {{ runId: string|null, outputFileName: string, blob: Blob }}
 */
export async function uploadSchedule(file, { signal } = {}) {
  const form = new FormData();
  form.append('file', file);

  const res = await request('/upload', { method: 'POST', body: form, signal });

  const outputFileName =
    res.headers.get('x-output-filename') ||
    filenameFromContentDisposition(res.headers.get('content-disposition')) ||
    'Allocated.xlsx';

  const blob = await res.blob();
  if (!blob || blob.size === 0) {
    throw new ApiError('The server returned an empty workbook.', { status: 200, code: 'EMPTY_WORKBOOK' });
  }

  return {
    runId: res.headers.get('x-run-id') || null,
    outputFileName,
    blob
  };
}

/** Save a blob to disk. Kept separate from uploadSchedule so the user controls it. */
export function saveBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();

  // Revoking synchronously races the browser: Firefox and Safari read the blob
  // asynchronously and cancel the download if the URL is already gone.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
