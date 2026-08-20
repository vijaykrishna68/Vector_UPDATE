/**
 * SINGLE source of truth for status presentation.
 *
 * Severity now comes from the BACKEND: it owns the diagnostic codes, so it also
 * decides whether a code is critical, a warning, or informational. This file maps
 * that severity onto visual treatment and planner-facing wording — it no longer
 * maintains a parallel severity table.
 *
 * Status itself is derived only from facts the backend states directly:
 *
 *   critical  remaining > 0        demand the allocator could not place
 *   warning   warnings present     issues raised, but all demand was placed
 *   healthy   all demand placed, no warnings
 *   nodata    no demand at all
 *
 * Utilisation deliberately does NOT drive status: the workbook's own
 * "WORKING HOURS" sheet sets Target Efficiency = 1 (100%), so high utilisation is
 * the goal rather than a problem, and no authoritative threshold exists.
 */

export const STATUS = {
  healthy: {
    key: 'healthy',
    label: 'Healthy',
    // Status is never conveyed by colour alone: every badge renders this symbol
    // and a text label alongside the colour.
    symbol: '●',
    badge: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
    dot: 'bg-emerald-600',
    bar: 'bg-emerald-600'
  },
  warning: {
    key: 'warning',
    label: 'Warning',
    symbol: '▲',
    badge: 'bg-amber-50 text-amber-900 ring-amber-200',
    dot: 'bg-amber-500',
    bar: 'bg-amber-500'
  },
  critical: {
    key: 'critical',
    label: 'Critical',
    symbol: '■',
    badge: 'bg-red-50 text-red-800 ring-red-200',
    dot: 'bg-red-600',
    bar: 'bg-red-600'
  },
  nodata: {
    key: 'nodata',
    label: 'No data',
    symbol: '○',
    badge: 'bg-slate-100 text-slate-600 ring-slate-200',
    dot: 'bg-slate-400',
    bar: 'bg-slate-300'
  },
  info: {
    key: 'info',
    label: 'Information',
    symbol: '□',
    badge: 'bg-sky-50 text-sky-800 ring-sky-200',
    dot: 'bg-sky-500',
    bar: 'bg-sky-500'
  }
};

/** Backend severity string -> visual status. */
export function statusForSeverity(severity) {
  return STATUS[severity] || STATUS.info;
}

/** Backend health string -> visual status. */
export function statusForHealth(health) {
  return STATUS[health] || STATUS.nodata;
}

/** Status for one production line (aggregated or per week). */
export function lineStatus({ allocatedParts = 0, remainingParts = 0 } = {}) {
  if (remainingParts > 0) return STATUS.critical;
  if (allocatedParts <= 0) return STATUS.nodata;
  return STATUS.healthy;
}

/**
 * Status for a planning week.
 * @param {object} week           A week summary from the API.
 * @param {object[]} issueGroups  That week's issue summary groups.
 */
export function weekStatus(week, issueGroups = []) {
  const demand = Number(week?.SUM) || 0;
  if (demand <= 0) return STATUS.nodata;

  if (totalRemaining(week) > 0) return STATUS.critical;

  const severities = issueGroups.map((g) => g.severity);
  if (severities.includes('critical')) return STATUS.critical;
  if (severities.includes('warning')) return STATUS.warning;
  return STATUS.healthy;
}

export function totalAllocated(week) {
  return (week?.lines || []).reduce((sum, l) => sum + (Number(l.allocatedParts) || 0), 0);
}

export function totalRemaining(week) {
  return (week?.lines || []).reduce((sum, l) => sum + (Number(l.remainingParts) || 0), 0);
}

/**
 * Planner-facing wording per diagnostic code.
 *
 * Descriptions restate what the engine actually reports and nothing more — no
 * inferred cause, no remedy the data cannot support.
 */
const ISSUE_TEXT = {
  NO_CAPACITY: {
    title: 'Demand could not be scheduled',
    description:
      'The allocator ran out of capacity on every line available to these parts, so some quantity is left unplanned.'
  },
  OVERLOAD: {
    title: 'Demand exceeds counted capacity',
    description: 'Total demand minutes exceeded the capacity the allocator counted for this week.'
  },
  DUPLICATE_MERGED: {
    title: 'Duplicate rows merged',
    description:
      'The same specification appeared more than once in this week with a different cycle time. Quantities were added together and the first cycle time was kept.'
  },
  INVALID_INPUT: {
    title: 'Rows skipped',
    description:
      'These rows were excluded from the plan because a required value was missing or invalid (specification, cycle time, or quantity).'
  }
};

const UNKNOWN_ISSUE_TEXT = {
  title: 'Reported by the allocator',
  description: 'The allocator reported an issue of a type this view does not recognise.'
};

export function issueText(code) {
  return ISSUE_TEXT[code] || UNKNOWN_ISSUE_TEXT;
}

const SEVERITY_ORDER = { critical: 0, warning: 1, info: 2 };

/**
 * Decorate the backend's issue summary groups for display. The backend supplies
 * code, severity, count, affectedWeeks and examples; this adds wording and
 * visual status, and sorts by severity.
 */
export function decorateIssueGroups(groups = []) {
  return groups
    .map((group) => ({
      ...group,
      status: statusForSeverity(group.severity),
      ...issueText(group.code)
    }))
    .sort(
      (a, b) =>
        (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9) || b.count - a.count
    );
}

/** Total issue count across summary groups. */
export function totalIssueCount(groups = []) {
  return groups.reduce((sum, g) => sum + (Number(g.count) || 0), 0);
}

/** Issue groups that apply to a given week. */
export function issueGroupsForWeek(groups = [], weekColumn) {
  return groups.filter(
    (g) =>
      !g.affectedWeeks ||
      g.affectedWeeks.length === 0 ||
      g.affectedWeeks.includes(String(weekColumn))
  );
}
