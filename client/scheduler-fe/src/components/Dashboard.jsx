import { ArrowRight, Upload } from 'lucide-react';
import ProductionLineCard from './ProductionLineCard';
import IssuesPanel from './IssuesPanel';
import {
  Button,
  Card,
  CapacityRail,
  EmptyState,
  ErrorState,
  FOCUS_RING,
  Label,
  LoadingState,
  SectionHeader,
  StatusBadge,
  Stat
} from './ui';
import { formatDateRange, formatInt, formatTimestamp, shortId } from '../lib/format';
import {
  decorateIssueGroups,
  issueGroupsForWeek,
  lineStatus,
  statusForHealth,
  totalAllocated,
  totalRemaining,
  weekStatus
} from '../lib/status';

/**
 * "What is the current production situation?"
 *
 * The page tells one story top to bottom: did the run succeed, how much
 * capacity did it take, which lines and weeks need a look, then the
 * supporting detail. Every figure comes from the backend; nothing here is
 * derived beyond summing or grouping values the engine already reported.
 */
export default function Dashboard({ weeksQuery, navigate }) {
  if (weeksQuery.isLoading && !weeksQuery.data) {
    return (
      <Card>
        <LoadingState label="Loading planning run…" />
      </Card>
    );
  }

  if (weeksQuery.isError) {
    return (
      <Card>
        <ErrorState
          title="Unable to load the planning run"
          error={weeksQuery.error}
          onRetry={weeksQuery.retry}
        />
      </Card>
    );
  }

  const { run, weeks = [], summary, issuesSummary = [] } = weeksQuery.data || {};

  if (!run || weeks.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={Upload}
          title="No planning run yet"
          description="Upload a production schedule workbook to generate an allocation plan."
          action={
            <Button variant="primary" icon={Upload} onClick={() => navigate('/upload')}>
              Upload a schedule
            </Button>
          }
        />
      </Card>
    );
  }

  // Run-level totals come from the backend (GET /allocation/weeks -> summary), so
  // the dashboard does not re-derive figures the engine already owns.
  const demand = summary?.demand ?? 0;
  const allocated = summary?.allocated ?? 0;
  const remaining = summary?.remaining ?? 0;
  const usedMinutes = summary?.usedMinutes ?? 0;
  const capacityMinutes = summary?.capacityMinutes ?? 0;
  const lines = aggregateLines(weeks);
  // The date columns are shared by all three weeks in the source workbook, so this
  // is the run's overall production window — NOT a per-week range. See BUG-1.
  const productionWindow = formatDateRange(weeks[0]?.dateHeaders);

  // run.health already encodes the full precedence the backend applies (no
  // demand -> unmet demand -> worst issue severity -> healthy), so the headline
  // reuses it rather than re-deriving the same rule on the client.
  const runStatus = statusForHealth(run.health);
  const headline =
    runStatus.key === 'critical'
      ? remaining > 0
        ? `${formatInt(remaining)} parts unallocated`
        : 'Attention required'
      : runStatus.key === 'warning'
        ? 'Run complete — warnings reported'
        : runStatus.key === 'nodata'
          ? 'No demand in this run'
          : 'Run complete';

  return (
    <div className="space-y-6">
      {/* Run summary — the whole story, top to bottom, in a few seconds. */}
      <Card>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1 border-b border-paper-200 px-4 py-2.5 text-xs text-paper-500">
          <span>
            Run <span className="font-mono text-paper-700">{shortId(run.id)}</span>
          </span>
          <span>{formatTimestamp(run.createdAt)}</span>
          <span>
            Weeks <span className="font-mono text-paper-700">{weeks.map((w) => w.weekColumn).join(' · ')}</span>
          </span>
          <span>
            Lines <span className="font-mono text-paper-700">{lines.length}</span>
          </span>
          {productionWindow && <span>{productionWindow}</span>}
          <Button variant="ghost" className="ml-auto" icon={ArrowRight} onClick={() => navigate('/schedule')}>
            Open schedule
          </Button>
        </div>

        <div className="grid grid-cols-1 gap-6 p-4 lg:grid-cols-[1.1fr_1fr]">
          <div>
            <p className={`text-xs font-semibold tracking-widest uppercase ${runStatus.text}`}>{headline}</p>
            <div className="mt-1.5 flex items-baseline gap-2">
              <Stat
                label="Allocated of total demand"
                value={
                  <>
                    {formatInt(allocated)} <span className="text-paper-300">/</span> {formatInt(demand)}
                  </>
                }
                unit="parts"
                size="lg"
              />
            </div>
          </div>

          <div className="flex flex-col justify-center border-paper-200 lg:border-l lg:pl-6">
            <CapacityRail
              label="Capacity utilisation"
              usedMinutes={usedMinutes}
              capacityMinutes={capacityMinutes}
              size="lg"
            />
          </div>
        </div>

        <dl className="grid grid-cols-2 divide-y divide-paper-200 border-t border-paper-200 sm:grid-cols-4 sm:divide-x sm:divide-y-0">
          <SupportingStat label="Total demand" value={formatInt(demand)} />
          <SupportingStat label="Allocated" value={formatInt(allocated)} />
          <SupportingStat
            label="Unallocated"
            value={formatInt(remaining)}
            tone={remaining > 0 ? 'text-critical-700' : undefined}
          />
          <SupportingStat label="Capacity used" value={formatInt(usedMinutes)} hint={`of ${formatInt(capacityMinutes)} min`} />
        </dl>
      </Card>

      <AttentionSummary issuesSummary={issuesSummary} lines={lines} />

      {/* Production lines */}
      <section aria-labelledby="lines-heading">
        <SectionHeader
          title="Production lines"
          description="Aggregated across every planning week in this run."
        />
        <h2 id="lines-heading" className="sr-only">
          Production line overview
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {lines.map((line) => (
            <ProductionLineCard key={line.line} line={line} />
          ))}
        </div>
      </section>

      {/* Planning weeks — a sequence, not three unrelated cards: BU then BV then
          BW share one production calendar (see CLAUDE.md's confirmed rules). */}
      <section aria-labelledby="weeks-heading">
        <SectionHeader
          title="Planning weeks"
          description="BU → BV → BW — demand buckets processed in order against one shared production calendar."
        />
        <h2 id="weeks-heading" className="sr-only">
          Planning weeks
        </h2>
        <div className="flex flex-col gap-3 md:flex-row md:items-start">
          {weeks.map((week, i) => (
            <div key={week.weekColumn} className="flex flex-1 items-start gap-2">
              <div className="min-w-0 flex-1">
                <WeekTile
                  week={week}
                  issueGroups={issueGroupsForWeek(issuesSummary, week.weekColumn)}
                  onOpen={() => navigate(`/schedule/${encodeURIComponent(week.weekColumn)}`)}
                />
              </div>
              {i < weeks.length - 1 && (
                <ArrowRight
                  className="mt-16 hidden h-4 w-4 shrink-0 text-paper-300 md:block"
                  aria-hidden="true"
                />
              )}
            </div>
          ))}
        </div>
        {weeks.every((w) => (Number(w.SUM) || 0) === 0) && (
          <p className="mt-3 text-sm text-paper-500">
            No week in this run carried any demand after filtering.
          </p>
        )}
      </section>

      {/* Issues — the full, browsable diagnostic list. AttentionSummary above
          links here; the id is the jump target, not a visual change to the panel. */}
      <div id="schedule-health">
        <IssuesPanel issuesSummary={issuesSummary} runId={run.id} />
      </div>
    </div>
  );
}

/** A KPI without its own bordered box — one of four columns sharing dividers. */
function SupportingStat({ label, value, hint, tone }) {
  return (
    <div className="px-4 py-3">
      <Label>{label}</Label>
      <p className={`mt-1 font-mono text-lg font-medium tabular-nums ${tone || 'text-paper-900'}`}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-paper-500">{hint}</p>}
    </div>
  );
}

/**
 * Consolidates the run's real issue groups and any line with genuine unmet
 * demand into a short, actionable preview. Renders nothing when there is
 * nothing to flag — a healthy run does not need an empty "all clear" box on
 * top of the headline that already says so. Purely informational issue
 * severities (e.g. skipped/duplicate rows) are left for the full panel below;
 * this layer is for what actually needs a decision.
 */
function AttentionSummary({ issuesSummary, lines }) {
  const topIssues = decorateIssueGroups(issuesSummary).filter((g) => g.severity !== 'info').slice(0, 2);
  const attentionLines = lines.filter((l) => l.remainingParts > 0);

  if (topIssues.length === 0 && attentionLines.length === 0) return null;

  const critical = attentionLines.length > 0 || topIssues.some((g) => g.severity === 'critical');

  return (
    <div className={`border-l-2 px-4 py-3 ${critical ? 'border-critical-600 bg-critical-50' : 'border-warning-600 bg-warning-50'}`}>
      <p className={`text-xs font-semibold tracking-widest uppercase ${critical ? 'text-critical-800' : 'text-warning-900'}`}>
        Attention required
      </p>
      <ul className="mt-2 space-y-1 text-sm text-paper-700">
        {attentionLines.map((l) => (
          <li key={`line-${l.line}`}>
            <span className="font-medium text-paper-900">Line {l.line}</span> — {formatInt(l.remainingParts)} parts
            unmet
          </li>
        ))}
        {topIssues.map((g) => (
          <li key={g.code}>
            <span className="font-medium text-paper-900">{g.title}</span>
            {g.affectedWeeks?.length > 0 && (
              <span className="text-paper-500"> · weeks {g.affectedWeeks.join(', ')}</span>
            )}
          </li>
        ))}
      </ul>
      <a
        href="#schedule-health"
        className={`mt-2 inline-block text-sm font-medium underline underline-offset-2 hover:no-underline ${FOCUS_RING} ${
          critical ? 'text-critical-800' : 'text-warning-900'
        }`}
      >
        View issues →
      </a>
    </div>
  );
}

function WeekTile({ week, issueGroups, onOpen }) {
  const status = weekStatus(week, issueGroups);
  const allocated = totalAllocated(week);
  const remaining = totalRemaining(week);
  const topReason = decorateIssueGroups(issueGroups).filter((g) => g.severity !== 'info')[0];
  const weekMinutes = (week.lines || []).reduce(
    (acc, l) => ({
      used: acc.used + (Number(l.usedMinutes) || 0),
      capacity: acc.capacity + (Number(l.capacityMinutes) || 0)
    }),
    { used: 0, capacity: 0 }
  );

  return (
    <Card
      as="button"
      type="button"
      onClick={onOpen}
      className={`w-full p-4 text-left transition-colors hover:border-paper-400 ${FOCUS_RING}`}
      aria-label={`Open week ${week.weekColumn}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <Label>Week</Label>
          <p className="font-mono text-lg font-semibold text-paper-900">{week.weekColumn}</p>
        </div>
        <StatusBadge status={status} />
      </div>

      {status.key !== 'healthy' && status.key !== 'nodata' && (
        <p className={`mt-1.5 text-xs font-medium ${status.text}`}>
          {remaining > 0 && !topReason
            ? 'Demand could not be fully allocated'
            : topReason?.title || 'Reported by the allocator'}
        </p>
      )}

      <dl className="mt-3 grid grid-cols-3 gap-2 text-sm">
        <div>
          <dt>
            <Label>Demand</Label>
          </dt>
          <dd className="font-mono tabular-nums text-paper-900">{formatInt(week.SUM)}</dd>
        </div>
        <div>
          <dt>
            <Label>Allocated</Label>
          </dt>
          <dd className="font-mono tabular-nums text-paper-900">{formatInt(allocated)}</dd>
        </div>
        <div>
          <dt>
            <Label>Remaining</Label>
          </dt>
          <dd className={`font-mono tabular-nums ${remaining > 0 ? 'text-critical-700' : 'text-paper-400'}`}>
            {formatInt(remaining)}
          </dd>
        </div>
      </dl>

      <div className="mt-3 border-t border-paper-200 pt-3">
        <CapacityRail usedMinutes={weekMinutes.used} capacityMinutes={weekMinutes.capacity} />
      </div>

      <div className="mt-3 flex items-center justify-between text-xs text-paper-500">
        <span>
          Working days <span className="font-mono text-paper-700">{formatInt(week.actualWorkingDays)}</span>
        </span>
        <span>
          Parts <span className="font-mono text-paper-700">{formatInt(week.CountOfParts)}</span>
        </span>
      </div>
    </Card>
  );
}

/**
 * Sum the engine's per-line figures across weeks. This is addition of values the
 * backend already computed, not a re-derivation of business logic.
 */
function aggregateLines(weeks) {
  const map = new Map();

  weeks.forEach((week) => {
    (week.lines || []).forEach((line) => {
      const key = Number(line.line);
      if (!map.has(key)) {
        map.set(key, {
          line: key,
          allocatedParts: 0,
          remainingParts: 0,
          usedMinutes: 0,
          capacityMinutes: 0
        });
      }
      const entry = map.get(key);
      entry.allocatedParts += Number(line.allocatedParts) || 0;
      entry.remainingParts += Number(line.remainingParts) || 0;
      entry.usedMinutes += Number(line.usedMinutes) || 0;
      entry.capacityMinutes += Number(line.capacityMinutes) || 0;
    });
  });

  return [...map.values()].sort((a, b) => a.line - b.line).map((line) => ({
    ...line,
    status: lineStatus(line)
  }));
}
