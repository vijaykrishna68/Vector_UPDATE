import { Card, Label, Meter, StatusBadge } from './ui';
import { formatInt, formatMinutes, formatPercent } from '../lib/format';
import { lineStatus, STATUS } from '../lib/status';

/**
 * One production line, aggregated across the run's weeks.
 *
 * Utilisation is shown as a figure and a meter but does NOT drive the status —
 * see lib/status.js for why (the workbook targets 100%, so "high" is the goal).
 * Status comes from unmet demand, which is unambiguous.
 */
export default function ProductionLineCard({ line }) {
  const status = lineStatus(line);
  const utilisation = line.capacityMinutes > 0 ? (line.usedMinutes / line.capacityMinutes) * 100 : null;
  const availableMinutes = Math.max(0, line.capacityMinutes - line.usedMinutes);

  return (
    <Card as="section" aria-labelledby={`line-${line.line}-heading`} className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <Label>Line</Label>
          <h3
            id={`line-${line.line}-heading`}
            className="font-mono text-2xl leading-none font-semibold tabular-nums text-slate-900"
          >
            {line.line}
          </h3>
        </div>
        <StatusBadge status={status} />
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3">
        <div>
          <dt>
            <Label>Allocated</Label>
          </dt>
          <dd className="font-mono text-lg font-medium tabular-nums text-slate-900">
            {formatInt(line.allocatedParts)}
          </dd>
        </div>
        <div>
          <dt>
            <Label>Remaining</Label>
          </dt>
          <dd
            className={`font-mono text-lg font-medium tabular-nums ${
              line.remainingParts > 0 ? 'text-red-700' : 'text-slate-400'
            }`}
          >
            {formatInt(line.remainingParts)}
          </dd>
        </div>
      </dl>

      <div className="mt-4">
        <div className="flex items-baseline justify-between">
          <Label>Utilisation</Label>
          <span className="font-mono text-sm font-medium tabular-nums text-slate-900">
            {utilisation === null ? '—' : formatPercent(utilisation)}
          </span>
        </div>
        <div className="mt-1.5">
          <Meter
            value={utilisation ?? 0}
            tone={utilisation === null ? STATUS.nodata.bar : 'bg-slate-700'}
            label={`Line ${line.line} utilisation`}
          />
        </div>
        <dl className="mt-2 flex justify-between text-xs text-slate-500">
          <div className="flex gap-1">
            <dt>Used</dt>
            <dd className="font-mono tabular-nums text-slate-700">{formatMinutes(line.usedMinutes)}</dd>
          </div>
          <div className="flex gap-1">
            <dt>Available</dt>
            <dd className="font-mono tabular-nums text-slate-700">{formatMinutes(availableMinutes)}</dd>
          </div>
        </dl>
      </div>
    </Card>
  );
}
