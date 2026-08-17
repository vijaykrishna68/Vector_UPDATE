'use strict';

/**
 * Turns engine output into the summaries the API serves.
 *
 * This is the ONLY place week summaries and issue summaries are built, so the
 * engine remains the single source of truth for figures and this layer only
 * reshapes them.
 */

/**
 * Severity for each engine diagnostic code. The backend owns this mapping because
 * it owns the codes; the client renders whatever severity it is given rather than
 * maintaining a parallel table.
 */
const ISSUE_SEVERITY = {
  NO_CAPACITY: 'critical',
  OVERLOAD: 'critical',
  DUPLICATE_MERGED: 'warning',
  INVALID_INPUT: 'info'
};

const DEFAULT_SEVERITY = 'info';
const MAX_EXAMPLES = 3;

function severityFor(code) {
  return ISSUE_SEVERITY[code] || DEFAULT_SEVERITY;
}

/**
 * Per-week summary rows. Demand and line attribution come straight from the
 * engine (see the Phase 2 BUG-7 fix); nothing is re-derived here.
 */
function buildWeekSummaries(weeksResults) {
  if (!Array.isArray(weeksResults)) return [];

  return weeksResults.map((wr) => {
    const SUM = Number(wr.SUM) || 0;
    const CountOfParts = Number(wr.CountOfParts) || 0;
    const actualWorkingDays = Number(wr.actualWorkingDays) || 0;

    const lineTotals = {
      1: { allocated: 0, remaining: 0 },
      2: { allocated: 0, remaining: 0 },
      3: { allocated: 0, remaining: 0 },
      4: { allocated: 0, remaining: 0 }
    };
    Object.keys(wr.lineTotals || {}).forEach((ln) => {
      if (!lineTotals[ln]) lineTotals[ln] = { allocated: 0, remaining: 0 };
      lineTotals[ln].allocated = Number(wr.lineTotals[ln].allocated) || 0;
      lineTotals[ln].remaining = Number(wr.lineTotals[ln].remaining) || 0;
    });

    const perLineMinutes = {
      1: { used: 0, capacity: 0 },
      2: { used: 0, capacity: 0 },
      3: { used: 0, capacity: 0 },
      4: { used: 0, capacity: 0 }
    };
    (wr.lineDayMinutes || []).forEach((day) => {
      const lines = day.lines || {};
      Object.keys(lines).forEach((k) => {
        const ln = Number(k);
        if (!perLineMinutes[ln]) perLineMinutes[ln] = { used: 0, capacity: 0 };
        const used = Number(lines[k]?.used) || 0;
        const remaining = Number(lines[k]?.remaining) || 0;
        perLineMinutes[ln].used += used;
        perLineMinutes[ln].capacity += used + remaining;
      });
    });

    const lines = [1, 2, 3, 4].map((ln) => {
      const allocParts = lineTotals[ln]?.allocated || 0;
      const remainingParts = lineTotals[ln]?.remaining || 0;
      const usedMin = perLineMinutes[ln]?.used || 0;
      const capMin = perLineMinutes[ln]?.capacity || 0;
      const efficiency = capMin > 0 ? +((usedMin / capMin) * 100).toFixed(2) : 0;
      const avgPartsPerDay = actualWorkingDays > 0 ? +(allocParts / actualWorkingDays).toFixed(2) : 0;
      return {
        line: ln,
        allocatedParts: allocParts,
        remainingParts,
        capacityMinutes: capMin,
        usedMinutes: usedMin,
        efficiency,
        workingDays: actualWorkingDays,
        avgPartsPerDay
      };
    });

    return {
      weekColumn: wr.weekColumn,
      SUM,
      CountOfParts,
      actualWorkingDays,
      lineTotals,
      lines,
      dateHeaders: Array.isArray(wr.dateHeaders) ? wr.dateHeaders : [],
      daysOpened: Array.isArray(wr.lineDayMinutes) ? wr.lineDayMinutes.length : 0
    };
  });
}

/** Run-level totals, summed from the per-week summaries. */
function buildRunTotals(weekSummaries) {
  return (weekSummaries || []).reduce(
    (acc, week) => {
      acc.demand += Number(week.SUM) || 0;
      (week.lines || []).forEach((line) => {
        acc.allocated += Number(line.allocatedParts) || 0;
        acc.remaining += Number(line.remainingParts) || 0;
        acc.usedMinutes += Number(line.usedMinutes) || 0;
        acc.capacityMinutes += Number(line.capacityMinutes) || 0;
      });
      return acc;
    },
    { demand: 0, allocated: 0, remaining: 0, usedMinutes: 0, capacityMinutes: 0 }
  );
}

/**
 * Collapse a diagnostic list into one row per code.
 *
 * A real workbook produces ~2,800 diagnostics (~400KB of JSON). The dashboard
 * only needs counts, affected weeks and a few representative messages, so this
 * is what the summary endpoints return. Nothing is discarded: the full list stays
 * on the run and is served, paginated, by GET /runs/:runId/issues.
 */
function summariseIssues(issues, { maxExamples = MAX_EXAMPLES } = {}) {
  const groups = new Map();

  (issues || []).forEach((issue) => {
    const code = issue?.type || 'UNKNOWN';
    if (!groups.has(code)) {
      groups.set(code, {
        code,
        severity: severityFor(code),
        count: 0,
        affectedWeeks: new Set(),
        examples: []
      });
    }
    const group = groups.get(code);
    group.count += 1;
    if (issue.week) group.affectedWeeks.add(String(issue.week));
    if (group.examples.length < maxExamples && issue.message) group.examples.push(String(issue.message));
  });

  const order = { critical: 0, warning: 1, info: 2 };
  return [...groups.values()]
    .map((g) => ({ ...g, affectedWeeks: [...g.affectedWeeks].sort() }))
    .sort((a, b) => (order[a.severity] ?? 9) - (order[b.severity] ?? 9) || b.count - a.count);
}

/** Highest severity present, or null when there are no issues. */
function worstSeverity(issueSummary) {
  const ranked = ['critical', 'warning', 'info'];
  for (const severity of ranked) {
    if ((issueSummary || []).some((g) => g.severity === severity)) return severity;
  }
  return null;
}

/**
 * Run status for display: derived from unmet demand first, then issue severity.
 * Mirrors the rule the UI applies per week (see client lib/status.js).
 */
function deriveRunHealth(totals, issueSummary) {
  if ((Number(totals?.demand) || 0) <= 0) return 'nodata';
  if ((Number(totals?.remaining) || 0) > 0) return 'critical';
  const worst = worstSeverity(issueSummary);
  if (worst === 'critical') return 'critical';
  if (worst === 'warning') return 'warning';
  return 'healthy';
}

module.exports = {
  ISSUE_SEVERITY,
  severityFor,
  buildWeekSummaries,
  buildRunTotals,
  summariseIssues,
  worstSeverity,
  deriveRunHealth
};
