'use strict';

/**
 * GOLDEN MASTER — synthetic sanitized workbook.
 *
 * This is the primary regression net for the allocation engine. The fixture is
 * fully synthetic (no production data), so both the fixture and its golden file
 * are safe to commit and run in CI.
 *
 * It captures, in one snapshot:
 *   - weekly demand (SUM, CountOfParts)
 *   - working days
 *   - per-part allocated / remaining quantity
 *   - every individual allocation (day + line + qty)
 *   - line totals
 *   - per-line-per-day minute usage
 *   - the full error list
 *   - the resulting Excel cell values (date columns + Sheet3 working days)
 *
 * Any behavior change anywhere in the engine will surface here as a diff.
 * Update deliberately with: npm run test:update-golden
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const XLSX = require('xlsx');

const AllocationEngine = require('../allocation.js');
const { buildFixture, DATE_START_COL } = require('../test-support/workbook.js');
const { assertMatchesGolden } = require('../test-support/golden.js');

/**
 * A deliberately broad fixture that exercises, together:
 *   - all four production lines
 *   - a line-2 overflow (spills to line 4) and a line-4 overflow (spills to line 1)
 *   - a line-3 part that cannot spill anywhere
 *   - a blank-line part (BUG-2)
 *   - a duplicate spec pair with conflicting cycle times
 *   - an invalid row (cycleTime 0) and a non-PC row
 *   - a zero-quantity part
 *   - demand across all three weeks (BUG-1)
 *   - enough demand to trigger tolerance-based extension days
 */
const GOLDEN_FIXTURE = {
  dateColumns: 6,
  dateHeaders: ['DAY-1', 'DAY-2', 'DAY-3', 'DAY-4', 'DAY-5', 'DAY-6'],
  parts: [
    { spec: 'SPEC-L3-A', line: 3, cycleTime: 7, bu: 400, bv: 120, bw: 0, row: 10 },
    { spec: 'SPEC-L2-A', line: 2, cycleTime: 10, bu: 900, bv: 300, bw: 150, row: 11 },
    { spec: 'SPEC-L2-B', line: 2, cycleTime: 4, bu: 250, bv: 0, bw: 60, row: 12 },
    { spec: 'SPEC-L4-A', line: 4, cycleTime: 12, bu: 500, bv: 200, bw: 0, row: 13 },
    { spec: 'SPEC-L1-A', line: 1, cycleTime: 5, bu: 700, bv: 0, bw: 90, row: 14 },
    { spec: 'SPEC-NOLINE', line: null, cycleTime: 8, bu: 300, bv: 75, bw: 0, row: 15 },
    { spec: 'SPEC-DUP', line: 1, cycleTime: 6, bu: 100, bv: 50, bw: 0, row: 16 },
    { spec: 'SPEC-DUP', line: 1, cycleTime: 9, bu: 200, bv: 25, bw: 0, row: 17 },
    { spec: 'SPEC-BADCT', line: 2, cycleTime: 0, bu: 999, bv: 0, bw: 0, row: 18 },
    { spec: 'SPEC-NOTPC', line: 2, cycleTime: 10, bu: 888, bv: 0, bw: 0, row: 19, componentUnit: 'SET' },
    { spec: 'SPEC-ZERO', line: 3, cycleTime: 10, bu: 0, bv: 0, bw: 0, row: 20 }
  ]
};

/** Capture every populated cell in the date-column region of Sheet1. */
function captureDateCells(sheet, dateColumnCount) {
  const out = {};
  const range = XLSX.utils.decode_range(sheet['!ref']);
  for (let r = range.s.r; r <= Math.min(range.e.r, 200); r++) {
    for (let i = 0; i < dateColumnCount; i++) {
      const addr = XLSX.utils.encode_cell({ r, c: DATE_START_COL + i });
      if (sheet[addr]) out[addr] = sheet[addr].v;
    }
  }
  return out;
}

function captureSnapshot() {
  const workbook = buildFixture(GOLDEN_FIXTURE);
  const engine = new AllocationEngine();
  const result = engine.run(workbook);

  const sheet1 = workbook.Sheets[result.sheet1Name];
  const sheet3 = workbook.Sheets[result.sheet3Name];

  return {
    detectedSheets: { sheet1: result.sheet1Name, sheet3: result.sheet3Name },
    weeks: result.weeksResults.map((w) => ({
      weekColumn: w.weekColumn,
      SUM: w.SUM,
      CountOfParts: w.CountOfParts,
      actualWorkingDays: w.actualWorkingDays,
      dateHeaders: w.dateHeaders,
      lineTotals: w.lineTotals,
      daysOpened: w.lineDayMinutes.length,
      lineDayMinutes: w.lineDayMinutes,
      totals: {
        allocated: w.parts.reduce((s, p) => s + p.allocations.reduce((a, b) => a + b.qty, 0), 0),
        remaining: w.parts.reduce((s, p) => s + p.remainingQty, 0)
      },
      parts: w.parts.map((p) => ({
        spec: p.spec,
        originalLine: p.originalLine,
        cycleTime: p.cycleTime,
        rowIndex: p.rowIndex,
        weeklyQty: p.weeklyQty,
        remainingQty: p.remainingQty,
        allocated: p.allocations.reduce((s, a) => s + a.qty, 0),
        allocations: p.allocations
      }))
    })),
    errors: result.errors,
    errorCountsByType: result.errors.reduce((acc, e) => {
      acc[e.type] = (acc[e.type] || 0) + 1;
      return acc;
    }, {}),
    workbookOutput: {
      sheet1Ref: sheet1['!ref'],
      dateCells: captureDateCells(sheet1, GOLDEN_FIXTURE.dateColumns),
      sheet3WorkingDays: { I4: sheet3.I4 && sheet3.I4.v, I5: sheet3.I5 && sheet3.I5.v, I6: sheet3.I6 && sheet3.I6.v }
    }
  };
}

describe('golden master: synthetic workbook', () => {
  it('matches the recorded engine output', (t) => {
    const res = assertMatchesGolden('synthetic-workbook', captureSnapshot());
    if (res.created) t.diagnostic(`baseline created at ${res.file} — commit this file`);
    if (res.updated) t.diagnostic(`baseline UPDATED at ${res.file} — review the diff`);
  });

  it('is deterministic across repeated runs', () => {
    assert.deepEqual(captureSnapshot(), captureSnapshot());
  });

  it('exercises every error type the engine can emit for a parsed workbook', () => {
    const snap = captureSnapshot();
    // OVERLOAD joined this set with the Phase 6 BUG-1 fix. The fixture's demand
    // (~35,980 minutes) genuinely exceeds the capacity of its 6 date columns
    // (6 x 5,700 = 34,200 minutes). Previously each bucket was allocated against
    // its own fresh capacity model, so the fixture appeared to fit; with one
    // shared model the real over-subscription surfaces. The fixture is unchanged
    // — its reported outcome is now honest.
    assert.deepEqual(
      Object.keys(snap.errorCountsByType).sort(),
      ['DUPLICATE_MERGED', 'INVALID_INPUT', 'NO_CAPACITY', 'OVERLOAD'],
      'fixture coverage guard — update intentionally if the fixture changes'
    );
  });

  it('exercises allocation on every line and at least one fallback', () => {
    const snap = captureSnapshot();
    const linesUsed = new Set();
    snap.weeks.forEach((w) => w.parts.forEach((p) => p.allocations.forEach((a) => linesUsed.add(a.lineUsed))));
    assert.deepEqual([...linesUsed].sort(), [1, 2, 3, 4]);
  });
});
