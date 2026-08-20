import { useMemo, useState } from 'react';
import { Filter } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  StatusBadge,
  TableShell,
  Td,
  Th
} from './ui';
import IssuesPanel from './IssuesPanel';
import { fetchWeekDetail } from '../api';
import { useAsync } from '../lib/useAsync';
import { formatDayHeaderShort, formatInt, formatNumber } from '../lib/format';
import { STATUS } from '../lib/status';

/**
 * The allocation table — the core planning artefact.
 *
 * One row per part, one column per production day. Because the day columns make
 * the table wider than any screen, the part identity column and the header row
 * are sticky inside a bounded scroll container.
 *
 * Row counts on real workbooks are ~160 parts × ~25 days, which renders fine
 * without virtualisation.
 */
export default function WeekDetail({ week, runId }) {
  const query = useAsync(
    (signal) => fetchWeekDetail(week, { runId, signal }),
    `week:${week}:${runId || 'latest'}`,
    { enabled: Boolean(week) }
  );
  const [onlyUnmet, setOnlyUnmet] = useState(false);

  if (query.isLoading && !query.data) {
    return (
      <Card>
        <LoadingState label={`Loading week ${week}…`} rows={6} />
      </Card>
    );
  }

  if (query.isError) {
    return (
      <Card>
        <ErrorState
          title={`Unable to load week ${week}`}
          error={query.error}
          onRetry={query.retry}
        />
      </Card>
    );
  }

  const { parts = [], dateHeaders = [], issuesSummary = [], run } = query.data || {};

  if (parts.length === 0) {
    return (
      <div className="space-y-6">
        <Card>
          <EmptyState
            title={`No allocations for week ${week}`}
            description="This week has no scheduled parts. It may have carried no demand, or every row was excluded during validation."
          />
        </Card>
        <IssuesPanel
          issuesSummary={issuesSummary}
          runId={run?.id}
          week={week}
          title={`Week ${week} health`}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <WeekTable
        week={week}
        parts={parts}
        dateHeaders={dateHeaders}
        onlyUnmet={onlyUnmet}
        onToggleUnmet={() => setOnlyUnmet((v) => !v)}
        refreshing={query.isLoading}
      />
      <IssuesPanel
        issuesSummary={issuesSummary}
        runId={run?.id}
        week={week}
        title={`Week ${week} health`}
      />
    </div>
  );
}

function WeekTable({ week, parts, dateHeaders, onlyUnmet, onToggleUnmet, refreshing }) {
  const unmetCount = useMemo(() => parts.filter((p) => p.remainingQty > 0).length, [parts]);
  const rows = useMemo(
    () => (onlyUnmet ? parts.filter((p) => p.remainingQty > 0) : parts),
    [parts, onlyUnmet]
  );

  // Day columns actually used, so an unscheduled tail of the date range does not
  // pad the table with empty columns.
  const lastUsedDay = useMemo(() => {
    let last = -1;
    parts.forEach((p) => p.allocations.forEach((a) => { if (a.dayIndex > last) last = a.dayIndex; }));
    return last;
  }, [parts]);
  const dayCount = Math.max(lastUsedDay + 1, 0);
  const days = Array.from({ length: dayCount }, (_, i) => i);

  const totals = useMemo(
    () =>
      parts.reduce(
        (acc, p) => {
          acc.demand += p.weeklyQty;
          acc.allocated += p.allocated;
          acc.remaining += p.remainingQty;
          return acc;
        },
        { demand: 0, allocated: 0, remaining: 0 }
      ),
    [parts]
  );

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold tracking-wide text-slate-900 uppercase">
            Week {week} allocation
          </h2>
          <p className="mt-0.5 text-sm text-slate-500">
            <span className="font-mono tabular-nums">{formatInt(parts.length)}</span> parts ·{' '}
            <span className="font-mono tabular-nums">{formatInt(totals.demand)}</span> demand ·{' '}
            <span className="font-mono tabular-nums">{formatInt(totals.allocated)}</span> allocated
            {totals.remaining > 0 && (
              <>
                {' · '}
                <span className="font-mono tabular-nums text-red-700">
                  {formatInt(totals.remaining)}
                </span>{' '}
                unallocated
              </>
            )}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {refreshing && <span className="text-xs text-slate-500">Refreshing…</span>}
          {unmetCount > 0 && (
            <Button
              icon={Filter}
              onClick={onToggleUnmet}
              aria-pressed={onlyUnmet}
              className={onlyUnmet ? 'ring-slate-900' : ''}
            >
              {onlyUnmet ? 'Show all parts' : `Only unallocated (${formatInt(unmetCount)})`}
            </Button>
          )}
        </div>
      </div>

      <TableShell className="max-h-[70vh]">
        <caption className="sr-only">
          Allocation for week {week}: one row per part, one column per production day.
        </caption>
        <thead>
          <tr>
            <Th sticky className="left-0 z-30 min-w-[190px]">
              Specification
            </Th>
            <Th align="center" className="z-20">
              Designated
            </Th>
            <Th align="center" className="z-20">
              Lines used
            </Th>
            <Th align="right" className="z-20">
              Cycle
            </Th>
            <Th align="right" className="z-20">
              Demand
            </Th>
            <Th align="right" className="z-20">
              Allocated
            </Th>
            <Th align="right" className="z-20">
              Remaining
            </Th>
            <Th align="center" className="z-20">
              Status
            </Th>
            {days.map((dayIndex) => (
              <Th key={dayIndex} align="right" className="z-20 min-w-[68px] whitespace-nowrap">
                {dateHeaders[dayIndex] !== undefined
                  ? formatDayHeaderShort(dateHeaders[dayIndex])
                  : `Day ${dayIndex + 1}`}
              </Th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((part) => (
            <PartRow key={part.jobId} part={part} days={days} />
          ))}
        </tbody>
        <tfoot>
          <tr className="bg-slate-50">
            <Td sticky className="left-0 z-10 bg-slate-50 font-medium">
              Total
            </Td>
            <Td colSpan={3} className="bg-slate-50" />
            <Td numeric align="right" className="bg-slate-50 font-medium">
              {formatInt(totals.demand)}
            </Td>
            <Td numeric align="right" className="bg-slate-50 font-medium">
              {formatInt(totals.allocated)}
            </Td>
            <Td
              numeric
              align="right"
              className={`bg-slate-50 font-medium ${totals.remaining > 0 ? 'text-red-700' : ''}`}
            >
              {formatInt(totals.remaining)}
            </Td>
            <Td className="bg-slate-50" />
            {days.map((dayIndex) => {
              const dayTotal = parts.reduce(
                (sum, p) =>
                  sum + p.allocations.filter((a) => a.dayIndex === dayIndex).reduce((s, a) => s + a.qty, 0),
                0
              );
              return (
                <Td key={dayIndex} numeric align="right" className="bg-slate-50 font-medium">
                  {dayTotal > 0 ? formatInt(dayTotal) : ''}
                </Td>
              );
            })}
          </tr>
        </tfoot>
      </TableShell>

      {rows.length === 0 && (
        <div className="border-t border-slate-200">
          <EmptyState
            title="No parts match this filter"
            description="Every part in this week was fully allocated."
            action={<Button onClick={onToggleUnmet}>Show all parts</Button>}
          />
        </div>
      )}
    </Card>
  );
}

function PartRow({ part, days }) {
  const linesUsed = [...new Set(part.allocations.map((a) => a.line).filter((l) => l !== null))].sort();
  const ranElsewhere = linesUsed.some((l) => part.originalLine !== null && l !== part.originalLine);

  // A part listed with zero demand for this week is neither met nor unmet.
  const noDemand = part.weeklyQty === 0;
  const status = noDemand ? STATUS.nodata : part.remainingQty > 0 ? STATUS.critical : STATUS.healthy;
  const statusLabel = noDemand
    ? 'No demand'
    : part.remainingQty > 0
      ? 'Unmet'
      : ranElsewhere
        ? 'Fallback'
        : 'Met';

  const byDay = new Map();
  part.allocations.forEach((a) => {
    if (!byDay.has(a.dayIndex)) byDay.set(a.dayIndex, []);
    byDay.get(a.dayIndex).push(a);
  });

  return (
    <tr className="hover:bg-slate-50">
      <Td sticky className="left-0 z-10 font-medium whitespace-nowrap">
        {part.spec}
      </Td>
      <Td align="center">
        {part.originalLine === null ? (
          <span className="text-slate-400" title="No line designated in the source workbook">
            —
          </span>
        ) : (
          <span className="font-mono tabular-nums">{part.originalLine}</span>
        )}
      </Td>
      <Td align="center">
        <span className="inline-flex flex-wrap justify-center gap-1">
          {linesUsed.length === 0 ? (
            <span className="text-slate-400">—</span>
          ) : (
            linesUsed.map((line) => (
              <Badge
                key={line}
                className={`font-mono tabular-nums ${
                  part.originalLine !== null && line !== part.originalLine
                    ? 'bg-amber-50 text-amber-900 ring-amber-200'
                    : ''
                }`}
              >
                {line}
              </Badge>
            ))
          )}
        </span>
      </Td>
      <Td numeric align="right" className="text-slate-500">
        {formatNumber(part.cycleTime, 2)}
      </Td>
      <Td numeric align="right">
        {formatInt(part.weeklyQty)}
      </Td>
      <Td numeric align="right">
        {formatInt(part.allocated)}
      </Td>
      <Td numeric align="right" className={part.remainingQty > 0 ? 'font-medium text-red-700' : 'text-slate-400'}>
        {formatInt(part.remainingQty)}
      </Td>
      <Td align="center">
        <StatusBadge status={status}>{statusLabel}</StatusBadge>
      </Td>
      {days.map((dayIndex) => {
        const entries = byDay.get(dayIndex) || [];
        const qty = entries.reduce((s, a) => s + a.qty, 0);
        const title = entries.map((a) => `Line ${a.line}: ${a.qty}`).join(', ');
        return (
          <Td key={dayIndex} numeric align="right" title={title || undefined}>
            {qty > 0 ? formatInt(qty) : <span className="text-slate-200">·</span>}
          </Td>
        );
      })}
    </tr>
  );
}

export function WeekDetailPlaceholder({ onSelectFirst, weekCount }) {
  return (
    <Card>
      <EmptyState
        title="Select a week"
        description={`Choose one of the ${weekCount} planning weeks above to see its allocation detail.`}
        action={onSelectFirst && <Button variant="primary" onClick={onSelectFirst}>Open first week</Button>}
      />
    </Card>
  );
}
