'use strict';

/**
 * ============================================================================
 * KNOWN BUGS — CHARACTERISATION TESTS
 * ============================================================================
 *
 * Every test in this file asserts behavior that the audit identified as a BUG.
 * They PASS today on purpose: they pin the broken behavior so that a later fix
 * produces a loud, intentional, reviewable failure rather than a silent change.
 *
 * WHEN YOU FIX ONE OF THESE BUGS, THE MATCHING TEST HERE IS EXPECTED TO FAIL.
 * Invert the assertion as part of the fix commit — do not delete the test.
 *
 * STILL PINNED (current behavior is the bug):
 *   BUG-1  all three weeks write into the same date columns and are summed
 *          — deliberately unfixed: the correct per-week offset is a planner
 *            decision. See PHASE-2-BUG-1-INVESTIGATION.md.
 *   BUG-8  OVERLOAD counts capacity on lines a part can never reach, over only
 *          the days the allocator happened to open
 *          — deliberately unfixed: the intended capacity basis is undefined.
 *
 * FIXED IN PHASE 2 (tests below were inverted, not deleted):
 *   BUG-2  blank-line parts are now allocated via the default chain [1]
 *   BUG-3  the working-days sheet is identified by its own column header
 *   BUG-7  line totals now reconcile to SUM for every week
 * ============================================================================
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const AllocationEngine = require('../allocation.js');
const {
  buildFixture,
  findPart,
  errorsOfType,
  dateCellAddr,
  readCell,
  totalAllocated,
  WORKING_DAYS_HEADER
} = require('../test-support/workbook.js');

function run(spec) {
  const workbook = buildFixture(spec);
  const engine = new AllocationEngine();
  const result = engine.run(workbook);
  return { workbook, engine, result };
}

describe('BUG-1: every week writes into the same date columns starting at CU', () => {
  it('sums BU + BV + BW into a single date cell instead of separating weeks', () => {
    const { workbook, result } = run({
      dateColumns: 6,
      parts: [{ spec: 'M', line: 1, cycleTime: 1, bu: 50, bv: 30, bw: 20, row: 10 }]
    });

    const sheet1 = workbook.Sheets[result.sheet1Name];

    // Each week independently allocates day 0, and writeWeekAllocations
    // accumulates (prev + qty) into the SAME cell.
    assert.equal(readCell(sheet1, dateCellAddr(10, 0)), 100, 'CU10 = 50 + 30 + 20');

    // The three weeks parsed distinct demand, proving the collision is in the writer.
    assert.deepEqual(result.weeksResults.map((w) => w.SUM), [50, 30, 20]);

    // Nothing was written to any later date column.
    assert.equal(readCell(sheet1, dateCellAddr(10, 1)), undefined);
    assert.equal(readCell(sheet1, dateCellAddr(10, 2)), undefined);
  });

  it('gives every week a day index starting at 0, with no per-week offset', () => {
    const { result } = run({
      dateColumns: 6,
      parts: [{ spec: 'M', line: 1, cycleTime: 1, bu: 50, bv: 30, bw: 20, row: 10 }]
    });
    result.weeksResults.forEach((w) => {
      const days = [...new Set(w.parts.flatMap((p) => p.allocations.map((a) => a.dayIndex)))];
      assert.deepEqual(days, [0], `week ${w.weekColumn} starts at day 0`);
    });
  });

  it('overlaps weeks across multiple days when demand spans several days', () => {
    // BU needs 2 days on line 1 (1425/day at cycleTime 1); BV needs 1 day.
    const { workbook, result } = run({
      dateColumns: 8,
      parts: [{ spec: 'W', line: 1, cycleTime: 1, bu: 2000, bv: 500, bw: 0, row: 10 }]
    });
    const sheet1 = workbook.Sheets[result.sheet1Name];

    // Day 0 holds BU's first 1425 plus all 500 of BV.
    assert.equal(readCell(sheet1, dateCellAddr(10, 0)), 1925);
    // Day 1 holds only BU's remainder.
    assert.equal(readCell(sheet1, dateCellAddr(10, 1)), 575);
  });
});

// FIXED in Phase 2. Inverted from the Phase 0 characterisation, which asserted
// that blank-line parts received zero allocation.
describe('BUG-2 FIXED: blank-line parts are allocated via the default chain [1]', () => {
  it('allocates a blank-line part alongside an explicit line-1 part', () => {
    const { result } = run({
      dateColumns: 6,
      parts: [
        { spec: 'NOLINE', line: null, cycleTime: 10, bu: 100, row: 10 },
        { spec: 'HASLINE', line: 1, cycleTime: 10, bu: 100, row: 11 }
      ]
    });
    const week = result.weeksResults[0];
    const noline = findPart(week, 'NOLINE');
    const hasline = findPart(week, 'HASLINE');

    assert.equal(week.SUM, 200);
    assert.equal(week.CountOfParts, 2);

    // The blank-line part now runs on line 1, the first entry of its chain.
    assert.equal(totalAllocated(noline), 100);
    assert.equal(noline.remainingQty, 0);
    assert.deepEqual(noline.allocations, [{ dayIndex: 0, qty: 100, lineUsed: 1 }]);

    // The explicit line-1 part shares that capacity and spills to the next day.
    assert.equal(totalAllocated(hasline), 100);
    assert.equal(hasline.remainingQty, 0);

    // Demand reconciles exactly.
    assert.equal(totalAllocated(noline) + totalAllocated(hasline), week.SUM);
  });

  it('honours getFallbackChain(null) === [1] and uses only line 1', () => {
    const engine = new AllocationEngine();
    assert.deepEqual(engine.getFallbackChain(null), [1], 'chain itself is unchanged');

    const { result } = run({
      dateColumns: 6,
      parts: [{ spec: 'NOLINE', line: null, cycleTime: 10, bu: 100, row: 10 }]
    });
    const week = result.weeksResults[0];

    assert.equal(week.lineDayMinutes[0].lines[1].used, 1000, 'line 1 did the work');
    [2, 3, 4].forEach((ln) => {
      assert.equal(week.lineDayMinutes[0].lines[ln].used, 0, `line ${ln} is not used`);
    });
    assert.deepEqual(
      [...new Set(findPart(week, 'NOLINE').allocations.map((a) => a.lineUsed))],
      [1],
      'never spills beyond line 1'
    );
  });

  it('writes the allocated quantity into the Excel date columns', () => {
    const { workbook, result } = run({
      dateColumns: 6,
      parts: [{ spec: 'NOLINE', line: null, cycleTime: 10, bu: 100, row: 10 }]
    });
    assert.equal(readCell(workbook.Sheets[result.sheet1Name], dateCellAddr(10, 0)), 100);
  });

  it('no longer raises a spurious NO_CAPACITY when capacity exists', () => {
    const { result } = run({
      dateColumns: 6,
      parts: [{ spec: 'NOLINE', line: null, cycleTime: 10, bu: 100, row: 10 }]
    });
    assert.equal(errorsOfType(result.errors, 'NO_CAPACITY').length, 0);
  });

  it('still reports NO_CAPACITY when line 1 genuinely cannot absorb the demand', () => {
    // 300 units at cycleTime 10 needs 3000 minutes; line 1 offers 1425 per day
    // and only one date column exists, so 158 legitimately remain.
    const { result } = run({
      dateColumns: 1,
      parts: [{ spec: 'NOLINE', line: null, cycleTime: 10, bu: 300, row: 10 }]
    });
    const week = result.weeksResults[0];
    assert.equal(findPart(week, 'NOLINE').remainingQty, 158);
    assert.equal(errorsOfType(result.errors, 'NO_CAPACITY', 'BU').length, 1);
  });

  it('uses the working days it reserved instead of leaving them idle', () => {
    const { result } = run({
      dateColumns: 10,
      parts: [{ spec: 'NOLINE', line: null, cycleTime: 1, bu: 6000, row: 10 }]
    });
    const week = result.weeksResults[0];
    assert.equal(week.actualWorkingDays, 2, 'working-day calculation is unchanged');
    assert.equal(totalAllocated(findPart(week, 'NOLINE')), 6000, 'and the demand is now produced');
    assert.equal(findPart(week, 'NOLINE').remainingQty, 0);
  });

  it('treats a non-numeric line value (e.g. "ALL") the same way', () => {
    // Column D in the prototype workbook contains "ALL" for some parts, which
    // parses to originalLine === null.
    const { result } = run({
      dateColumns: 6,
      parts: [{ spec: 'ALLLINE', line: 'ALL', cycleTime: 10, bu: 100, row: 10 }]
    });
    const week = result.weeksResults[0];
    assert.equal(findPart(week, 'ALLLINE').originalLine, null);
    assert.equal(totalAllocated(findPart(week, 'ALLLINE')), 100);
  });

  it('leaves explicit line assignments and their fallbacks unchanged', () => {
    // Regression guard: the grouping change must not alter lines 2/3/4 routing.
    const { result } = run({
      dateColumns: 1,
      parts: [
        { spec: 'P2', line: 2, cycleTime: 10, bu: 250, row: 10 },
        { spec: 'P3', line: 3, cycleTime: 10, bu: 150, row: 11 },
        { spec: 'P4', line: 4, cycleTime: 10, bu: 200, row: 12 }
      ]
    });
    const week = result.weeksResults[0];
    const byLine = (spec) => {
      const out = {};
      findPart(week, spec).allocations.forEach((a) => { out[a.lineUsed] = (out[a.lineUsed] || 0) + a.qty; });
      return out;
    };
    assert.deepEqual(byLine('P2'), { 2: 190, 4: 60 }, 'line 2 still spills to line 4');
    assert.deepEqual(byLine('P3'), { 3: 95 }, 'line 3 still never spills');
    assert.deepEqual(byLine('P4'), { 4: 82, 1: 118 }, 'line 4 still spills to line 1');
  });
});

// FIXED in Phase 2. Inverted from the Phase 0 characterisation, which asserted
// that line totals under-reported demand from blank-line parts.
describe('BUG-7 FIXED: line totals always reconcile to SUM', () => {
  const sumTotals = (week) =>
    [1, 2, 3, 4].reduce(
      (acc, ln) => {
        acc.allocated += week.lineTotals[ln].allocated;
        acc.remaining += week.lineTotals[ln].remaining;
        return acc;
      },
      { allocated: 0, remaining: 0 }
    );

  it('includes blank-line demand in the per-line totals', () => {
    const { result } = run({
      dateColumns: 6,
      parts: [
        { spec: 'NOLINE', line: null, cycleTime: 10, bu: 100, row: 10 },
        { spec: 'HASLINE', line: 1, cycleTime: 10, bu: 100, row: 11 }
      ]
    });
    const week = result.weeksResults[0];

    assert.equal(week.lineTotals[1].allocated, 200, 'both parts are attributed to line 1');
    const totals = sumTotals(week);
    assert.equal(totals.allocated + totals.remaining, week.SUM, 'totals reconcile to SUM');
  });

  it('reports remaining quantity that genuinely cannot be allocated', () => {
    // One date column, 300 units at cycleTime 10 -> 158 cannot be produced.
    const { result } = run({
      dateColumns: 1,
      parts: [{ spec: 'NOLINE', line: null, cycleTime: 10, bu: 300, row: 10 }]
    });
    const week = result.weeksResults[0];

    assert.equal(findPart(week, 'NOLINE').remainingQty, 158);
    assert.equal(week.lineTotals[1].remaining, 158, 'the shortfall is visible, not hidden as 0');
    assert.equal(week.lineTotals[1].allocated, 142);

    const totals = sumTotals(week);
    assert.equal(totals.allocated + totals.remaining, week.SUM);
  });

  it('reconciles for every week of a mixed workbook', () => {
    const { result } = run({
      dateColumns: 4,
      parts: [
        { spec: 'A', line: 3, cycleTime: 7, bu: 400, bv: 120, bw: 0, row: 10 },
        { spec: 'B', line: 2, cycleTime: 10, bu: 900, bv: 300, bw: 150, row: 11 },
        { spec: 'C', line: 4, cycleTime: 12, bu: 500, bv: 200, bw: 0, row: 12 },
        { spec: 'D', line: null, cycleTime: 8, bu: 300, bv: 75, bw: 0, row: 13 },
        { spec: 'E', line: 1, cycleTime: 5, bu: 700, bv: 0, bw: 90, row: 14 }
      ]
    });

    result.weeksResults.forEach((week) => {
      if (week.SUM === 0) return;
      const totals = sumTotals(week);
      assert.equal(
        totals.allocated + totals.remaining,
        week.SUM,
        `week ${week.weekColumn}: allocated + remaining must equal SUM`
      );
    });
  });

  it('attributes a part to the line that its chain starts from', () => {
    const engine = new AllocationEngine();
    assert.equal(engine.resolveGroupLine(1), 1);
    assert.equal(engine.resolveGroupLine(2), 2);
    assert.equal(engine.resolveGroupLine(3), 3);
    assert.equal(engine.resolveGroupLine(4), 4);
    assert.equal(engine.resolveGroupLine(null), 1, 'blank line -> default chain head');
    assert.equal(engine.resolveGroupLine(99), 1, 'unknown line -> default chain head');
  });

  it('credits a fallback allocation to the ORIGINAL line, unchanged', () => {
    // Regression guard: BUG-7 must not alter existing attribution semantics.
    const { result } = run({
      dateColumns: 1,
      parts: [{ spec: 'P2', line: 2, cycleTime: 10, bu: 250, row: 10 }]
    });
    const week = result.weeksResults[0];
    assert.equal(week.lineTotals[2].allocated, 250, '190 on line 2 + 60 on line 4, all credited to line 2');
    assert.equal(week.lineTotals[4].allocated, 0);
  });
});

// FIXED in Phase 2. Inverted from the Phase 0 characterisation, which asserted
// that the first sheet containing any of I4/I5/I6 was hijacked.
describe('BUG-3 FIXED: the working-days sheet is identified by its own header', () => {
  const decoy = { name: 'DECOY_PIVOT', cells: { A1: 'pivot output', I4: 111, I5: 222, I6: 333 } };

  it('ignores a decoy sheet and selects the sheet declaring the header', () => {
    const { result } = run({
      dateColumns: 2,
      parts: [{ spec: 'S', line: 1, cycleTime: 10, bu: 100, row: 10 }],
      decoySheets: [decoy]
    });
    assert.equal(result.sheet3Name, 'SUMMARY', 'header wins over sheet position');
    assert.notEqual(result.sheet3Name, 'DECOY_PIVOT');
  });

  it('leaves the decoy sheet completely untouched', () => {
    const { workbook } = run({
      dateColumns: 2,
      parts: [{ spec: 'S', line: 1, cycleTime: 10, bu: 100, bv: 0, bw: 0, row: 10 }],
      decoySheets: [decoy]
    });
    const pivot = workbook.Sheets.DECOY_PIVOT;

    // These are the planner's values that used to be destroyed on every run.
    assert.equal(readCell(pivot, 'I4'), 111);
    assert.equal(readCell(pivot, 'I5'), 222);
    assert.equal(readCell(pivot, 'I6'), 333);
    assert.equal(readCell(pivot, 'A1'), 'pivot output');
  });

  it('writes working days into the correct sheet', () => {
    const { workbook } = run({
      dateColumns: 2,
      parts: [{ spec: 'S', line: 1, cycleTime: 10, bu: 100, bv: 0, bw: 0, row: 10 }],
      decoySheets: [decoy]
    });
    const summary = workbook.Sheets.SUMMARY;
    assert.equal(readCell(summary, 'I4'), 1, 'BU working days');
    assert.equal(readCell(summary, 'I5'), 0, 'BV working days');
    assert.equal(readCell(summary, 'I6'), 0, 'BW working days');
    assert.equal(readCell(summary, 'I3'), WORKING_DAYS_HEADER, 'the header itself is preserved');
  });

  it('is not fooled by a sheet holding only I4/I5/I6 values', () => {
    const { result } = run({
      dateColumns: 2,
      parts: [{ spec: 'S', line: 1, cycleTime: 10, bu: 100, row: 10 }],
      decoySheets: [{ name: 'BARELY_MATCHES', cells: { I6: 7 } }]
    });
    assert.equal(result.sheet3Name, 'SUMMARY');
  });

  it('matches the header case-insensitively and ignores surrounding whitespace', () => {
    const { result } = run({
      dateColumns: 2,
      parts: [{ spec: 'S', line: 1, cycleTime: 10, bu: 100, row: 10 }],
      workingDaysHeader: '  working DAYS   as per plan '
    });
    assert.equal(result.sheet3Name, 'SUMMARY');
  });

  it('REFUSES to run when no sheet declares the header', () => {
    // Safety property: refusing is strictly better than picking a candidate and
    // destroying planner data.
    const workbook = buildFixture({
      dateColumns: 2,
      parts: [{ spec: 'S', line: 1, cycleTime: 10, bu: 100, row: 10 }],
      workingDaysHeader: null
    });
    assert.throws(
      () => new AllocationEngine().run(workbook),
      /Could not identify the working-days sheet/
    );
  });

  it('REFUSES to run when two sheets declare the header', () => {
    const workbook = buildFixture({
      dateColumns: 2,
      parts: [{ spec: 'S', line: 1, cycleTime: 10, bu: 100, row: 10 }],
      decoySheets: [{ name: 'ALSO_CLAIMS', cells: { I3: WORKING_DAYS_HEADER, I4: 1 } }]
    });
    assert.throws(
      () => new AllocationEngine().run(workbook),
      /Ambiguous working-days sheet: 2 sheets declare/
    );
  });

  it('accepts an explicitly configured sheet name, overriding the header', () => {
    const workbook = buildFixture({
      dateColumns: 2,
      parts: [{ spec: 'S', line: 1, cycleTime: 10, bu: 100, bv: 0, bw: 0, row: 10 }],
      decoySheets: [{ name: 'CHOSEN', cells: { A1: 'x', I4: 111 } }]
    });
    const result = new AllocationEngine({ workingDaysSheetName: 'CHOSEN' }).run(workbook);

    assert.equal(result.sheet3Name, 'CHOSEN');
    assert.equal(readCell(workbook.Sheets.CHOSEN, 'I4'), 1, 'working days went to the configured sheet');
    assert.equal(readCell(workbook.Sheets.SUMMARY, 'I4'), -101, 'header sheet untouched when overridden');
  });

  it('REFUSES when the configured sheet name is absent', () => {
    const workbook = buildFixture({
      dateColumns: 2,
      parts: [{ spec: 'S', line: 1, cycleTime: 10, bu: 100, row: 10 }]
    });
    assert.throws(
      () => new AllocationEngine({ workingDaysSheetName: 'NO_SUCH_SHEET' }).run(workbook),
      /Configured working-days sheet "NO_SUCH_SHEET" was not found/
    );
  });
});

describe('BUG-8: OVERLOAD counts capacity on unreachable lines', () => {
  it('offsets a line-3 shortfall against lines 1, 2 and 4 that line 3 can never use', () => {
    // Line 3 can only ever run on line 3 (chain [3]) = 950 minutes on day 0.
    // Demand is 100 x 100 = 10000 minutes.
    const { result } = run({ dateColumns: 1, parts: [{ spec: 'OV', line: 3, cycleTime: 100, bu: 100 }] });
    const errs = errorsOfType(result.errors, 'OVERLOAD', 'BU');
    assert.equal(errs.length, 1);

    // Reported shortfall is 10000 - 5700 (all four lines) = 4300.
    // Against reachable capacity alone it would be 10000 - 950 = 9050.
    assert.equal(errs[0].overloadMinutes, 4300, 'understates the true line-3 shortfall');
  });

  it('counts capacity only for days the allocator happened to open', () => {
    // Line 1, cycleTime 500 -> floor(1425/500) = 2 units/day. Demand 22 leaves a
    // remainder of exactly 20, which is NOT > TOLERANCE, so extension never runs
    // and only day 0 is opened — even though 5 date columns are available.
    const { result } = run({ dateColumns: 5, parts: [{ spec: 'OV', line: 1, cycleTime: 500, bu: 22 }] });
    const week = result.weeksResults[0];

    assert.equal(week.dateHeaders.length, 5, 'five days of capacity exist');
    assert.equal(week.lineDayMinutes.length, 1, 'but only one day is opened');

    // Capacity counted = day 0 across all lines = 5700. Demand = 22 x 500 = 11000.
    const errs = errorsOfType(result.errors, 'OVERLOAD', 'BU');
    assert.equal(errs.length, 1);
    assert.equal(errs[0].overloadMinutes, 5300, '11000 - 5700, ignoring 4 unopened days');

    // Had the 4 remaining days been counted, total capacity would be 28500 and no
    // overload would be reported at all.
    assert.ok(5 * 5700 > 11000, 'available capacity actually exceeds demand');
  });
});
