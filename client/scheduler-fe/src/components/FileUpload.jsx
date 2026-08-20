import { useCallback, useRef, useState } from 'react';
import { AlertTriangle, ArrowRight, CheckCircle2, Download, FileSpreadsheet, Loader2, Upload, X } from 'lucide-react';
import { Button, Card, FOCUS_RING, Label, SectionHeader } from './ui';
import { ApiError, saveBlob, uploadSchedule } from '../api';
import { formatBytes } from '../lib/format';

const ACCEPTED_EXTENSIONS = ['.xlsx', '.xls'];
const MAX_BYTES = 25 * 1024 * 1024; // mirrors the server's MAX_UPLOAD_BYTES default

/** Client-side pre-check. The server re-validates, including magic bytes. */
function validateFile(file) {
  if (!file) return 'No file selected.';
  const name = file.name || '';
  const dot = name.lastIndexOf('.');
  const ext = dot === -1 ? '' : name.slice(dot).toLowerCase();

  if (!ACCEPTED_EXTENSIONS.includes(ext)) {
    return `Only Excel workbooks are accepted (${ACCEPTED_EXTENSIONS.join(', ')}).`;
  }
  if (file.size === 0) return 'That file is empty.';
  if (file.size > MAX_BYTES) {
    return `That file is ${formatBytes(file.size)}. The limit is ${formatBytes(MAX_BYTES)}.`;
  }
  return null;
}

/**
 * Upload workflow: choose a file, review it, then explicitly start processing.
 *
 * Previously processing began the instant a file was picked and the button was
 * decorative. Now the button is the action, and drag-and-drop works as the copy
 * has always claimed.
 *
 * No progress percentage is shown: the backend reports no progress, so a bar
 * would be fabricated. A duration counter is shown instead, which is real.
 */
export default function FileUpload({ onRunCreated, navigate }) {
  const inputRef = useRef(null);
  const [file, setFile] = useState(null);
  const [validationError, setValidationError] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [status, setStatus] = useState('idle'); // idle | processing | success | error
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [elapsed, setElapsed] = useState(0);

  const selectFile = useCallback((nextFile) => {
    setResult(null);
    setError(null);
    setStatus('idle');
    setFile(nextFile || null);
    setValidationError(nextFile ? validateFile(nextFile) : null);
  }, []);

  const clear = useCallback(() => {
    selectFile(null);
    if (inputRef.current) inputRef.current.value = '';
  }, [selectFile]);

  const onDrop = useCallback(
    (event) => {
      event.preventDefault();
      setDragging(false);
      const dropped = event.dataTransfer?.files?.[0];
      if (dropped) selectFile(dropped);
    },
    [selectFile]
  );

  const process = useCallback(async () => {
    if (!file || validationError) return;

    setStatus('processing');
    setError(null);
    setElapsed(0);

    const startedAt = Date.now();
    const timer = setInterval(() => setElapsed(Math.round((Date.now() - startedAt) / 1000)), 1000);

    try {
      const uploaded = await uploadSchedule(file);
      setResult({ ...uploaded, seconds: Math.round((Date.now() - startedAt) / 1000) });
      setStatus('success');
      if (uploaded.runId) onRunCreated(uploaded.runId);
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(err?.message || 'Upload failed.'));
      setStatus('error');
    } finally {
      clearInterval(timer);
    }
  }, [file, validationError, onRunCreated]);

  const busy = status === 'processing';
  const canProcess = Boolean(file) && !validationError && !busy;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Card className="p-5">
        <SectionHeader
          title="Upload production schedule"
          description="The workbook is processed on the server; the original file is not modified."
        />

        {/* Drop zone */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={`mt-2 border-2 border-dashed p-8 text-center transition-colors ${
            dragging ? 'border-slate-900 bg-slate-50' : 'border-slate-300'
          }`}
        >
          <FileSpreadsheet className="mx-auto h-8 w-8 text-slate-400" aria-hidden="true" />
          <p className="mt-3 text-sm text-slate-700">
            Drag a workbook here, or{' '}
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className={`font-medium text-slate-900 underline underline-offset-2 hover:no-underline ${FOCUS_RING}`}
            >
              browse for a file
            </button>
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Excel workbooks only ({ACCEPTED_EXTENSIONS.join(', ')}), up to {formatBytes(MAX_BYTES)}
          </p>
          <input
            ref={inputRef}
            type="file"
            className="sr-only"
            accept={ACCEPTED_EXTENSIONS.join(',')}
            onChange={(e) => selectFile(e.target.files?.[0])}
          />
        </div>

        {/* Selected file */}
        {file && (
          <div className="mt-4 border border-slate-200">
            <div className="flex items-start gap-3 p-3">
              <FileSpreadsheet className="mt-0.5 h-5 w-5 shrink-0 text-slate-500" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-slate-900">{file.name}</p>
                <dl className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                  <div className="flex gap-1">
                    <dt>Size</dt>
                    <dd className="font-mono tabular-nums text-slate-700">{formatBytes(file.size)}</dd>
                  </div>
                  <div className="flex gap-1">
                    <dt>Type</dt>
                    <dd className="text-slate-700">{file.type || 'unknown'}</dd>
                  </div>
                </dl>
                {validationError ? (
                  <p className="mt-2 flex items-start gap-1.5 text-sm text-red-700">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                    {validationError}
                  </p>
                ) : (
                  <p className="mt-2 flex items-center gap-1.5 text-sm text-emerald-800">
                    <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                    Ready to process
                  </p>
                )}
              </div>
              {!busy && (
                <button
                  type="button"
                  onClick={clear}
                  aria-label="Remove selected file"
                  className={`p-1 text-slate-400 hover:text-slate-700 ${FOCUS_RING}`}
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              )}
            </div>
          </div>
        )}

        <div className="mt-4 flex items-center gap-3">
          <Button variant="primary" onClick={process} disabled={!canProcess} icon={busy ? undefined : Upload}>
            {busy ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                Processing…
              </>
            ) : (
              'Process & generate schedule'
            )}
          </Button>
          {busy && (
            <span className="text-sm text-slate-500" role="status" aria-live="polite">
              {elapsed}s elapsed — allocating and writing the workbook
            </span>
          )}
        </div>
      </Card>

      {/* Failure */}
      {status === 'error' && error && (
        <Card className="border-red-200 p-5" role="alert">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" aria-hidden="true" />
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-slate-900">Processing failed</h3>
              <p className="mt-1 text-sm text-slate-700">{error.message}</p>
              {(error.code || error.requestId) && (
                <p className="mt-2 font-mono text-xs text-slate-400">
                  {error.code}
                  {error.requestId ? ` · request ${error.requestId}` : ''}
                </p>
              )}
              <div className="mt-4 flex gap-2">
                <Button onClick={process} disabled={!canProcess}>
                  Try again
                </Button>
                <Button variant="ghost" onClick={clear}>
                  Choose another file
                </Button>
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* Success */}
      {status === 'success' && result && (
        <Card className="border-emerald-200 p-5">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-semibold text-slate-900">Schedule generated</h3>
              <p className="mt-1 text-sm text-slate-600">
                Processed in {result.seconds}s. The allocation plan is stored as a planning run and the
                updated workbook is ready to download.
              </p>

              <dl className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <dt>
                    <Label>Output file</Label>
                  </dt>
                  <dd className="truncate font-mono text-sm text-slate-900">{result.outputFileName}</dd>
                </div>
                <div>
                  <dt>
                    <Label>Planning run</Label>
                  </dt>
                  <dd className="font-mono text-sm text-slate-900">{result.runId || '—'}</dd>
                </div>
              </dl>

              <div className="mt-4 flex flex-wrap gap-2">
                <Button
                  variant="primary"
                  icon={Download}
                  onClick={() => saveBlob(result.blob, result.outputFileName)}
                >
                  Download workbook
                </Button>
                <Button icon={ArrowRight} onClick={() => navigate('/schedule')}>
                  View schedule
                </Button>
                <Button variant="ghost" onClick={() => navigate('/dashboard')}>
                  Go to dashboard
                </Button>
              </div>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
