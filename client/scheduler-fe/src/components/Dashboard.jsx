import { ArrowRight, Upload } from 'lucide-react';
import ProductionLineCard from './ProductionLineCard';
import IssuesPanel from './IssuesPanel';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  FOCUS_RING,
  Label,
  LoadingState,
  SectionHeader,
  StatusBadge,
  Stat
} from './ui';
import { formatDateRange, formatInt, formatPercent, formatTimestamp, shortId } from '../lib/format';
import {
  issueGroupsForWeek,
  lineStatus,
  totalAllocated,
  totalRemaining,
  weekStatus
} from '../lib/status';

/**
 * "What is the current production situation?"
 *
 * Hierarchy: run context -> key metrics -> line capacity -> weeks -> issues.
 * Every figure comes from the backend; nothing is derived beyond summing the
 * per-line values the engine already reported.
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

  const weeksWithDemand = weeks.filter((w) => (Number(w.SUM) || 0) > 0);
  // Run-level totals come from the backend (GET /allocation/weeks -> summary), so
  // the dashboard does not re-derive figures the engine already owns.
  const demand = summary?.demand ?? 0;
  const allocated = summary?.allocated ?? 0;
  const remaining = summary?.remaining ?? 0;
  const usedMinutes = summary?.usedMinutes ?? 0;
  const capacityMinutes = summary?.capacityMinutes ?? 0;
  const utilisation = capacityMinutes > 0 ? (usedMinutes / capacityMinutes) * 100 : null;
  const lines = aggregateLines(weeks);
  const attention = weeks.filter(
    (w) => weekStatus(w, issueGroupsForWeek(issuesSummary, w.weekColumn)).key !== 'healthy'
  );
  // The date columns are shared by all three weeks in the source workbook, so this
  // is the run's overall production window — NOT a per-week range. See BUG-1.
  const productionWindow = formatDateRange(weeks[0]?.dateHeaders);

  return (
    <div className="space-y-6">
      {/* 1 — planning context */}
      <Card className="px-4 py-3">
        <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
          <div>
            <Label>Planning run</Label>
            <p className="font-mono text-sm text-slate-900" title={run.id}>
              {shortId(run.id)}
            </p>
          </div>
          <div>
            <Label>Processed</Label>
            <p className="text-sm text-slate-900">{formatTimestamp(run.createdAt)}</p>
          </div>
          <div>
            <Label>Planning weeks</Label>
            <p className="font-mono text-sm text-slate-900">
              {weeks.map((w) => w.weekColumn).join(' · ')}
            </p>
          </div>
          <div>
            <Label>Production lines</Label>
            <p className="font-mono text-sm text-slate-900">{lines.length}</p>
          </div>
          {productionWindow && (
            <div>
              <Label>Production window</Label>
              <p className="text-sm text-slate-900">{productionWindow}</p>
            </div>
          )}
          <Button
            variant="secondary"
            className="ml-auto"
            icon={ArrowRight}
            onClick={() => navigate('/schedule')}
          >
            Open schedule
          </Button>
        </div>
      </Card>

      {/* 2 — key metrics */}
      <section aria-labelledby="metrics-heading">
        <h2 id="metrics-heading" className="sr-only">
          Key production metrics
        </h2>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Card className="p-4">
            <Stat label="Total demand" value={formatInt(demand)} unit="parts" emphasis />
          </Card>
          <Card className="p-4">
            <Stat
              label="Allocated"
              value={formatInt(allocated)}
              unit="parts"
              emphasis
              hint={demand > 0 ? `${formatPercent((allocated / demand) * 100)} of demand` : undefined}
            />
          </Card>
          <Card className="p-4">
            <div className="flex items-start justify-between gap-2">
              <Stat label="Unallocated" value={formatInt(remaining)} unit="parts" emphasis />
              {remaining > 0 && <StatusBadge status={weekStatus({ SUM: 1, lines: [{ remainingParts: 1 }] })} />}
            </div>
          </Card>
          <Card className="p-4">
            <Stat
              label="Capacity used"
              value={utilisation === null ? '—' : formatPercent(utilisation)}
              emphasis
              hint={`${formatInt(usedMinutes)} of ${formatInt(capacityMinutes)} min scheduled`}
            />
          </Card>
        </div>
      </section>

      {/* 3 — line capacity */}
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

      {/* 4 — weeks */}
      <section aria-labelledby="weeks-heading">
        <SectionHeader
          title="Planning weeks"
          description={
            attention.length > 0
              ? `${attention.length} of ${weeks.length} weeks need attention.`
              : 'All weeks scheduled without unmet demand.'
          }
        />
        <h2 id="weeks-heading" className="sr-only">
          Weeks requiring attention
        </h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {weeks.map((week) => (
            <WeekTile
              key={week.weekColumn}
              week={week}
              issueGroups={issueGroupsForWeek(issuesSummary, week.weekColumn)}
              onOpen={() => navigate(`/schedule/${encodeURIComponent(week.weekColumn)}`)}
            />
          ))}
        </div>
        {weeksWithDemand.length === 0 && (
          <p className="mt-3 text-sm text-slate-500">
            No week in this run carried any demand after filtering.
          </p>
        )}
      </section>

      {/* 5 — issues */}
      <IssuesPanel issuesSummary={issuesSummary} runId={run.id} />
    </div>
  );
}

function WeekTile({ week, issueGroups, onOpen }) {
  const status = weekStatus(week, issueGroups);
  const allocated = totalAllocated(week);
  const remaining = totalRemaining(week);

  return (
    <Card
      as="button"
      type="button"
      onClick={onOpen}
      className={`p-4 text-left transition-colors hover:border-slate-400 ${FOCUS_RING}`}
      aria-label={`Open week ${week.weekColumn}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <Label>Week</Label>
          <p className="font-mono text-lg font-semibold text-slate-900">{week.weekColumn}</p>
        </div>
        <StatusBadge status={status} />
      </div>

      <dl className="mt-3 grid grid-cols-3 gap-2 text-sm">
        <div>
          <dt>
            <Label>Demand</Label>
          </dt>
          <dd className="font-mono tabular-nums text-slate-900">{formatInt(week.SUM)}</dd>
        </div>
        <div>
          <dt>
            <Label>Allocated</Label>
          </dt>
          <dd className="font-mono tabular-nums text-slate-900">{formatInt(allocated)}</dd>
        </div>
        <div>
          <dt>
            <Label>Remaining</Label>
          </dt>
          <dd
            className={`font-mono tabular-nums ${remaining > 0 ? 'text-red-700' : 'text-slate-400'}`}
          >
            {formatInt(remaining)}
          </dd>
        </div>
      </dl>

      <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-2 text-xs text-slate-500">
        <span>
          Working days <span className="font-mono text-slate-700">{formatInt(week.actualWorkingDays)}</span>
        </span>
        <span>
          Parts <span className="font-mono text-slate-700">{formatInt(week.CountOfParts)}</span>
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
