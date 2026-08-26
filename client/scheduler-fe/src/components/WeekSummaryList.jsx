import { ArrowRight } from 'lucide-react';
import { Card, FOCUS_RING, Label, StatusBadge } from './ui';
import { formatInt } from '../lib/format';
import { decorateIssueGroups, issueGroupsForWeek, totalAllocated, totalRemaining, weekStatus } from '../lib/status';

/**
 * Week selector. Rendered as a tablist so keyboard users get the expected
 * semantics, and the selected week is unmistakable. Laid out as a connected
 * BU -> BV -> BW sequence (not three unrelated cards) since the weeks share
 * one production calendar — see CLAUDE.md's confirmed business rules.
 */
export default function WeekSummaryList({ weeks, issuesSummary = [], selectedWeek, onSelect }) {
  return (
    <div role="tablist" aria-label="Planning weeks" className="flex flex-col gap-3 md:flex-row md:items-start">
      {weeks.map((week, i) => {
        const weekIssueGroups = issueGroupsForWeek(issuesSummary, week.weekColumn);
        const status = weekStatus(week, weekIssueGroups);
        const selected = String(selectedWeek) === String(week.weekColumn);
        const allocated = totalAllocated(week);
        const remaining = totalRemaining(week);
        const topReason = decorateIssueGroups(weekIssueGroups).filter((g) => g.severity !== 'info')[0];

        return (
          <div key={week.weekColumn} className="flex flex-1 items-start gap-2">
            <Card
              as="button"
              type="button"
              role="tab"
              aria-selected={selected}
              selected={selected}
              onClick={() => onSelect(week.weekColumn)}
              className={`w-full p-4 text-left transition-colors ${FOCUS_RING} ${
                selected ? '' : 'hover:border-paper-400'
              }`}
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
                  {remaining > 0 && !topReason ? 'Demand could not be fully allocated' : topReason?.title}
                </p>
              )}

              <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
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
                <div>
                  <dt>
                    <Label>Working days</Label>
                  </dt>
                  <dd className="font-mono tabular-nums text-paper-900">
                    {formatInt(week.actualWorkingDays)}
                  </dd>
                </div>
              </dl>

              <div className="mt-3 flex flex-wrap gap-1.5 border-t border-paper-200 pt-2">
                {(week.lines || []).map((line) => (
                  <span
                    key={line.line}
                    className="inline-flex items-baseline gap-1 rounded-[3px] bg-paper-150 px-1.5 py-0.5 text-xs ring-1 ring-inset ring-paper-300"
                    title={`Line ${line.line}: ${formatInt(line.allocatedParts)} allocated, ${formatInt(
                      line.remainingParts
                    )} remaining`}
                  >
                    <span className="text-paper-500">L{line.line}</span>
                    <span className="font-mono tabular-nums text-paper-800">
                      {formatInt(line.allocatedParts)}
                    </span>
                    {line.remainingParts > 0 && (
                      <span className="font-mono tabular-nums text-critical-700">
                        +{formatInt(line.remainingParts)}
                      </span>
                    )}
                  </span>
                ))}
              </div>
            </Card>
            {i < weeks.length - 1 && (
              <ArrowRight className="mt-16 hidden h-4 w-4 shrink-0 text-paper-300 md:block" aria-hidden="true" />
            )}
          </div>
        );
      })}
    </div>
  );
}
