import { useState } from 'react';
import { ChevronDown, ChevronRight, List } from 'lucide-react';
import { Badge, Button, Card, EmptyState, ErrorState, FOCUS_RING, Label, LoadingState, StatusBadge } from './ui';
import { fetchRunIssues } from '../api';
import { useAsync } from '../lib/useAsync';
import { formatInt } from '../lib/format';
import { decorateIssueGroups, totalIssueCount } from '../lib/status';

/**
 * Schedule health.
 *
 * The backend sends an issue SUMMARY (code, severity, count, affected weeks and a
 * few examples) instead of ~2,800 individual diagnostics. Expanding a group loads
 * that group's full, paginated diagnostics on demand from
 * GET /runs/:runId/issues, so nothing is hidden — it is just not shipped upfront.
 */
export default function IssuesPanel({ issuesSummary, runId, week, title = 'Schedule health' }) {
  const groups = decorateIssueGroups(issuesSummary);
  const total = totalIssueCount(groups);

  if (groups.length === 0) {
    return (
      <Card>
        <div className="border-b border-paper-300 px-4 py-3">
          <h2 className="text-sm font-semibold tracking-wide text-paper-900 uppercase">{title}</h2>
        </div>
        <EmptyState
          title="No issues reported"
          description={
            week
              ? `The allocator processed week ${week} without raising any warnings.`
              : 'The allocator processed this run without raising any warnings.'
          }
        />
      </Card>
    );
  }

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-paper-300 px-4 py-3">
        <h2 className="text-sm font-semibold tracking-wide text-paper-900 uppercase">{title}</h2>
        <span className="text-xs text-paper-500">
          {formatInt(total)} {total === 1 ? 'issue' : 'issues'} reported
        </span>
      </div>
      <ul className="divide-y divide-paper-200">
        {groups.map((group) => (
          <IssueGroup key={group.code} group={group} runId={runId} week={week} />
        ))}
      </ul>
    </Card>
  );
}

function IssueGroup({ group, runId, week }) {
  const [open, setOpen] = useState(false);
  const Chevron = open ? ChevronDown : ChevronRight;

  return (
    <li>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={`flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-paper-150 ${FOCUS_RING}`}
      >
        <Chevron className="mt-0.5 h-4 w-4 shrink-0 text-paper-400" aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge status={group.status} />
            <span className="text-sm font-medium text-paper-900">{group.title}</span>
            <Badge className="font-mono tabular-nums">{formatInt(group.count)}</Badge>
          </span>
          <span className="mt-1 block text-sm text-paper-600">{group.description}</span>
          <span className="mt-1.5 flex flex-wrap items-center gap-2">
            <Label>{group.code}</Label>
            {group.affectedWeeks?.length > 0 && (
              <span className="text-xs text-paper-500">
                Weeks: <span className="font-mono">{group.affectedWeeks.join(', ')}</span>
              </span>
            )}
          </span>
        </span>
      </button>

      {open && (
        <div className="border-t border-paper-200 bg-paper-150 px-4 py-3 pl-11">
          <IssueExamples group={group} runId={runId} week={week} />
        </div>
      )}
    </li>
  );
}

/** Shows the summary examples immediately, then offers the full paginated list. */
function IssueExamples({ group, runId, week }) {
  const [showAll, setShowAll] = useState(false);

  return (
    <div>
      <Label>Examples reported by the allocator</Label>
      <ul className="mt-2 space-y-1">
        {(group.examples || []).map((message, i) => (
          <li key={i} className="font-mono text-xs break-words text-paper-700">
            {message}
          </li>
        ))}
      </ul>

      {!showAll && group.count > (group.examples?.length || 0) && (
        <div className="mt-3">
          {runId ? (
            <Button icon={List} onClick={() => setShowAll(true)}>
              Load all {formatInt(group.count)}
            </Button>
          ) : (
            <p className="text-xs text-paper-500">
              Showing {group.examples?.length || 0} of {formatInt(group.count)}.
            </p>
          )}
        </div>
      )}

      {showAll && <FullIssueList runId={runId} code={group.code} week={week} />}
    </div>
  );
}

const PAGE_SIZE = 100;

function FullIssueList({ runId, code, week }) {
  const [page, setPage] = useState(1);
  const query = useAsync(
    (signal) => fetchRunIssues(runId, { page, pageSize: PAGE_SIZE, code, week, signal }),
    `issues:${runId}:${code}:${week || 'all'}:${page}`
  );

  if (query.isLoading && !query.data) return <LoadingState label="Loading diagnostics…" rows={2} />;
  if (query.isError) return <ErrorState title="Unable to load diagnostics" error={query.error} onRetry={query.retry} />;

  const { issues = [], total = 0, totalPages = 1 } = query.data || {};

  return (
    <div className="mt-3">
      <ol className="space-y-1" start={(page - 1) * PAGE_SIZE + 1}>
        {issues.map((issue, i) => (
          <li key={i} className="font-mono text-xs break-words text-paper-700">
            {issue.week && <span className="mr-1 text-paper-400">[{issue.week}]</span>}
            {issue.message}
          </li>
        ))}
      </ol>

      <div className="mt-3 flex items-center gap-2">
        <Button disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
          Previous
        </Button>
        <span className="text-xs text-paper-500">
          Page <span className="font-mono">{page}</span> of <span className="font-mono">{totalPages}</span>
          {' · '}
          <span className="font-mono">{formatInt(total)}</span> total
        </span>
        <Button disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
          Next
        </Button>
      </div>
    </div>
  );
}
