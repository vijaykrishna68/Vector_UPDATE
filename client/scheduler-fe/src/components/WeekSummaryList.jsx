import { Card, FOCUS_RING, Label, StatusBadge } from './ui';
import { formatInt } from '../lib/format';
import { issueGroupsForWeek, totalAllocated, totalIssueCount, totalRemaining, weekStatus } from '../lib/status';

/**
 * Week selector. Rendered as a tablist so keyboard users get the expected
 * semantics, and the selected week is unmistakable.
 */
export default function WeekSummaryList({ weeks, issuesSummary = [], selectedWeek, onSelect }) {
  return (
    <div role="tablist" aria-label="Planning weeks" className="grid grid-cols-1 gap-3 md:grid-cols-3">
      {weeks.map((week) => {
        const weekIssueGroups = issueGroupsForWeek(issuesSummary, week.weekColumn);
        const weekIssueCount = totalIssueCount(weekIssueGroups);
        const status = weekStatus(week, weekIssueGroups);
        const selected = String(selectedWeek) === String(week.weekColumn);
        const allocated = totalAllocated(week);
        const remaining = totalRemaining(week);

        return (
          <Card
            key={week.weekColumn}
            as="button"
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onSelect(week.weekColumn)}
            className={`p-4 text-left transition-colors ${FOCUS_RING} ${
              selected
                ? 'border-slate-900 ring-1 ring-slate-900'
                : 'hover:border-slate-400'
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <Label>Week</Label>
                <p className="font-mono text-lg font-semibold text-slate-900">{week.weekColumn}</p>
              </div>
              <StatusBadge status={status} />
            </div>

            <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
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
                <dd className={`font-mono tabular-nums ${remaining > 0 ? 'text-red-700' : 'text-slate-400'}`}>
                  {formatInt(remaining)}
                </dd>
              </div>
              <div>
                <dt>
                  <Label>Working days</Label>
                </dt>
                <dd className="font-mono tabular-nums text-slate-900">
                  {formatInt(week.actualWorkingDays)}
                </dd>
              </div>
            </dl>

            <div className="mt-3 flex flex-wrap gap-1.5 border-t border-slate-100 pt-2">
              {(week.lines || []).map((line) => (
                <span
                  key={line.line}
                  className="inline-flex items-baseline gap-1 bg-slate-50 px-1.5 py-0.5 text-xs ring-1 ring-inset ring-slate-200"
                  title={`Line ${line.line}: ${formatInt(line.allocatedParts)} allocated, ${formatInt(
                    line.remainingParts
                  )} remaining`}
                >
                  <span className="text-slate-500">L{line.line}</span>
                  <span className="font-mono tabular-nums text-slate-800">
                    {formatInt(line.allocatedParts)}
                  </span>
                  {line.remainingParts > 0 && (
                    <span className="font-mono tabular-nums text-red-700">
                      +{formatInt(line.remainingParts)}
                    </span>
                  )}
                </span>
              ))}
            </div>

            {weekIssueCount > 0 && (
              <p className="mt-2 text-xs text-slate-500">
                {formatInt(weekIssueCount)} {weekIssueCount === 1 ? 'issue' : 'issues'} reported
              </p>
            )}
          </Card>
        );
      })}
    </div>
  );
}
