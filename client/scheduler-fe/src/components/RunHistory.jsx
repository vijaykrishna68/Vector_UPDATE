import { useState } from 'react';
import { Check, FileSpreadsheet, Upload } from 'lucide-react';
import { Button, Card, EmptyState, ErrorState, FOCUS_RING, Label, LoadingState, StatusBadge, TableShell, Td, Th } from './ui';
import { fetchRuns } from '../api';
import { useAsync } from '../lib/useAsync';
import { formatInt, formatTimestamp, shortId } from '../lib/format';
import { statusForHealth } from '../lib/status';

const PAGE_SIZE = 15;

/**
 * Planning-run history.
 *
 * Deliberately a compact table rather than a second dashboard: the point is to
 * see previous runs, tell which one is active, and switch to one. All figures come
 * from GET /runs, which returns metadata only — no allocations, parts or
 * diagnostics.
 */
export default function RunHistory({ activeRunId, onSelectRun, navigate }) {
  const [page, setPage] = useState(1);
  const query = useAsync(
    (signal) => fetchRuns({ page, pageSize: PAGE_SIZE, signal }),
    `runs:${page}`
  );

  if (query.isLoading && !query.data) {
    return (
      <Card>
        <LoadingState label="Loading planning runs…" />
      </Card>
    );
  }

  if (query.isError) {
    return (
      <Card>
        <ErrorState title="Unable to load planning runs" error={query.error} onRetry={query.retry} />
      </Card>
    );
  }

  const { runs = [], total = 0, totalPages = 1 } = query.data || {};

  if (runs.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={Upload}
          title="No planning runs yet"
          description="Upload a production schedule workbook to create the first run."
          action={
            <Button variant="primary" icon={Upload} onClick={() => navigate('/upload')}>
              Upload a schedule
            </Button>
          }
        />
      </Card>
    );
  }

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-paper-300 px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold tracking-wide text-paper-900 uppercase">Planning runs</h2>
          <p className="mt-0.5 text-sm text-paper-500">
            Select a run to load its dashboard and schedule.
          </p>
        </div>
        <span className="text-xs text-paper-500">
          <span className="font-mono tabular-nums">{formatInt(total)}</span> total
        </span>
      </div>

      <TableShell>
        <caption className="sr-only">Planning runs, newest first</caption>
        <thead>
          <tr>
            <Th>Run</Th>
            <Th>Processed</Th>
            <Th>Source file</Th>
            <Th align="center">Weeks</Th>
            <Th align="right">Demand</Th>
            <Th align="right">Allocated</Th>
            <Th align="right">Unallocated</Th>
            <Th align="right">Issues</Th>
            <Th align="center">Status</Th>
            <Th align="right">
              <span className="sr-only">Actions</span>
            </Th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => {
            const isActive = String(run.runId) === String(activeRunId);
            return (
              <tr key={run.runId} className={isActive ? 'bg-paper-150' : 'hover:bg-paper-150'}>
                <Td>
                  <span className="flex items-center gap-2">
                    {isActive && (
                      <span
                        className="inline-flex items-center gap-1 text-xs font-medium text-paper-900"
                        title="Currently active run"
                      >
                        <Check className="h-3.5 w-3.5" aria-hidden="true" />
                        <span className="sr-only">Active run:</span>
                      </span>
                    )}
                    <span className="font-mono text-paper-800" title={run.runId}>
                      {shortId(run.runId)}
                    </span>
                  </span>
                </Td>
                <Td className="whitespace-nowrap">{formatTimestamp(run.createdAt)}</Td>
                <Td className="max-w-[220px]">
                  {run.sourceFilename ? (
                    <span className="flex items-center gap-1.5">
                      <FileSpreadsheet className="h-3.5 w-3.5 shrink-0 text-paper-400" aria-hidden="true" />
                      <span className="truncate" title={run.sourceFilename}>
                        {run.sourceFilename}
                      </span>
                    </span>
                  ) : (
                    <span className="text-paper-400">—</span>
                  )}
                </Td>
                <Td align="center" className="font-mono text-xs whitespace-nowrap">
                  {run.weeks?.length ? run.weeks.join(' ') : '—'}
                </Td>
                <Td numeric align="right">
                  {formatInt(run.totals?.demand)}
                </Td>
                <Td numeric align="right">
                  {formatInt(run.totals?.allocated)}
                </Td>
                <Td
                  numeric
                  align="right"
                  className={run.totals?.remaining > 0 ? 'font-medium text-critical-700' : 'text-paper-400'}
                >
                  {formatInt(run.totals?.remaining)}
                </Td>
                <Td numeric align="right" className="text-paper-600">
                  {formatInt(run.issueCount)}
                </Td>
                <Td align="center">
                  <StatusBadge status={statusForHealth(run.health)} />
                </Td>
                <Td align="right">
                  {isActive ? (
                    <span className="text-xs font-medium text-paper-500">Active</span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onSelectRun(run.runId)}
                      className={`text-sm font-medium text-paper-900 underline underline-offset-2 hover:no-underline ${FOCUS_RING}`}
                    >
                      Select
                    </button>
                  )}
                </Td>
              </tr>
            );
          })}
        </tbody>
      </TableShell>

      {totalPages > 1 && (
        <div className="flex items-center gap-2 border-t border-paper-300 px-4 py-3">
          <Button disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
            Previous
          </Button>
          <span className="text-xs text-paper-500">
            Page <span className="font-mono">{page}</span> of <span className="font-mono">{totalPages}</span>
          </span>
          <Button disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
            Next
          </Button>
        </div>
      )}

      <div className="border-t border-paper-300 px-4 py-2">
        <Label>
          Selecting a run changes only what this browser tab shows. Other runs are untouched.
        </Label>
      </div>
    </Card>
  );
}
