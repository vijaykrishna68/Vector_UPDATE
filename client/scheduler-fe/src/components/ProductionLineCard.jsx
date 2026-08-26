import { CapacityRail, Card, Label, StatusBadge } from './ui';
import { formatInt } from '../lib/format';
import { lineStatus } from '../lib/status';

/**
 * One production line, aggregated across the run's weeks — an operational
 * status panel, not a generic metric card: line identity and status come
 * first, then the one figure that matters most (parts actually allocated),
 * then capacity. Remaining (unmet) demand only takes up space when it is
 * non-zero, since a healthy line has none and showing "0" everywhere just
 * adds noise to the common case.
 *
 * Utilisation drives the capacity rail but NOT the status badge — see
 * lib/status.js for why (the workbook targets 100%, so "high" is the goal).
 * Status comes from unmet demand, which is unambiguous.
 */
export default function ProductionLineCard({ line }) {
  const status = lineStatus(line);

  return (
    <Card as="section" aria-labelledby={`line-${line.line}-heading`} className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <Label>Line</Label>
          <h3
            id={`line-${line.line}-heading`}
            className="font-mono text-2xl leading-none font-semibold tabular-nums text-paper-900"
          >
            {String(line.line).padStart(2, '0')}
          </h3>
        </div>
        <StatusBadge status={status} />
      </div>

      <div className="mt-4">
        <Label>Parts allocated</Label>
        <p className="mt-1 font-mono text-2xl font-semibold tabular-nums tracking-tight text-paper-900">
          {formatInt(line.allocatedParts)}
        </p>
        {line.remainingParts > 0 && (
          <p className="mt-0.5 text-xs font-medium text-critical-700">
            {formatInt(line.remainingParts)} unmet
          </p>
        )}
      </div>

      <div className="mt-4 border-t border-paper-200 pt-3">
        <CapacityRail label="Capacity" usedMinutes={line.usedMinutes} capacityMinutes={line.capacityMinutes} />
      </div>
    </Card>
  );
}
