'use strict';

/**
 * Allocation rules: line priority, fallback chains, capacity ceilings,
 * tolerance/extension, no-capacity and overload reporting.
 *
 * These tests document CURRENT behavior as of the safety-net phase.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const AllocationEngine = require('../allocation.js');
const { buildFixture, findPart, errorsOfType, allocatedByLine, totalAllocated } = require('../test-support/workbook.js');

function run(spec) {
  const workbook = buildFixture(spec);
  const engine = new AllocationEngine();
  const result = engine.run(workbook);
  return { workbook, engine, result, week: result.weeksResults[0] };
}

describe('fallback chains', () => {
  it('exposes the documented chains, defaulting an unknown line to [1]', () => {
    const e = new AllocationEngine();
    assert.deepEqual(e.getFallbackChain(3), [3]);
    assert.deepEqual(e.getFallbackChain(2), [2, 4]);
    assert.deepEqual(e.getFallbackChain(4), [4, 1]);
    assert.deepEqual(e.getFallbackChain(1), [1]);
    assert.deepEqual(e.getFallbackChain(null), [1], 'null falls back to line 1');
    assert.deepEqual(e.getFallbackChain(99), [1]);
  });

  it('line 2 overflow spills onto line 4', () => {
    // capacity: L2 1900/10 = 190 units, remainder goes to L4
    const { week } = run({ dateColumns: 1, parts: [{ spec: 'P2', line: 2, cycleTime: 10, bu: 250 }] });
    const part = findPart(week, 'P2');
    assert.deepEqual(allocatedByLine(part), { 2: 190, 4: 60 });
    assert.equal(part.remainingQty, 0);
  });

  it('line 4 overflow spills onto line 1', () => {
    // capacity: L4 1425/10 = 142 units, remainder goes to L1
    const { week } = run({ dateColumns: 1, parts: [{ spec: 'P4', line: 4, cycleTime: 10, bu: 200 }] });
    const part = findPart(week, 'P4');
    assert.deepEqual(allocatedByLine(part), { 4: 142, 1: 58 });
    assert.equal(part.remainingQty, 0);
  });

  it('line 3 never spills — excess stays unallocated', () => {
    const { week } = run({ dateColumns: 1, parts: [{ spec: 'P3', line: 3, cycleTime: 10, bu: 150 }] });
    const part = findPart(week, 'P3');
    assert.deepEqual(allocatedByLine(part), { 3: 95 }, 'only line 3 is ever used');
    assert.equal(part.remainingQty, 55);
  });

  it('line 1 never spills — excess stays unallocated', () => {
    const { week } = run({ dateColumns: 1, parts: [{ spec: 'P1', line: 1, cycleTime: 10, bu: 200 }] });
    const part = findPart(week, 'P1');
    assert.deepEqual(allocatedByLine(part), { 1: 142 });
    assert.equal(part.remainingQty, 58);
  });
});

describe('line priority order 3 -> 2 -> 4 -> 1', () => {
  it('lets a line-2 overflow consume line 4 before line 4 schedules its own parts', () => {
    const { week } = run({
      dateColumns: 1,
      parts: [
        { spec: 'BIG2', line: 2, cycleTime: 10, bu: 400, row: 10 },
        { spec: 'OWN4', line: 4, cycleTime: 10, bu: 200, row: 11 }
      ]
    });
    const big2 = findPart(week, 'BIG2');
    const own4 = findPart(week, 'OWN4');

    // Line 2 is processed before line 4, so BIG2 takes all of line 4's capacity.
    assert.deepEqual(allocatedByLine(big2), { 2: 190, 4: 142 });
    // OWN4 then finds line 4 exhausted and falls through to line 1.
    assert.deepEqual(allocatedByLine(own4), { 1: 142 });
    assert.equal(own4.remainingQty, 58);
  });

  it('credits allocation to the ORIGINAL line, not the line that ran it', () => {
    const { week } = run({ dateColumns: 1, parts: [{ spec: 'P2', line: 2, cycleTime: 10, bu: 250 }] });
    // 190 ran on line 2 and 60 ran on line 4, but all 250 is credited to line 2.
    assert.equal(week.lineTotals[2].allocated, 250);
    assert.equal(week.lineTotals[4].allocated, 0);
  });
});

describe('capacity limits', () => {
  it('never exceeds a line\'s daily minutes', () => {
    const { week } = run({ dateColumns: 1, parts: [{ spec: 'P3', line: 3, cycleTime: 10, bu: 500 }] });
    const day0 = week.lineDayMinutes[0].lines;
    assert.equal(day0[3].used, 950);
    assert.equal(day0[3].remaining, 0);
    assert.ok(day0[3].used <= 950);
  });

  it('floors partial units — leftover minutes below one cycle go unused', () => {
    // L3 = 950 minutes, cycleTime 7 -> floor(950/7) = 135 units (945 min), 5 min idle
    const { week } = run({ dateColumns: 1, parts: [{ spec: 'F', line: 3, cycleTime: 7, bu: 200 }] });
    assert.equal(totalAllocated(findPart(week, 'F')), 135);
    assert.equal(week.lineDayMinutes[0].lines[3].used, 945);
    assert.equal(week.lineDayMinutes[0].lines[3].remaining, 5, 'cannot fit a 136th unit');
  });

  it('resets capacity to the full daily template on each day', () => {
    const { week } = run({ dateColumns: 3, parts: [{ spec: 'T2', line: 1, cycleTime: 10, bu: 175 }] });
    assert.equal(week.lineDayMinutes[0].lines[1].used + week.lineDayMinutes[0].lines[1].remaining, 1425);
    assert.equal(week.lineDayMinutes[1].lines[1].used + week.lineDayMinutes[1].lines[1].remaining, 1425);
  });

  it('records per-day capacity for all four lines even when only one is used', () => {
    const { week } = run({ dateColumns: 1, parts: [{ spec: 'P3', line: 3, cycleTime: 10, bu: 50 }] });
    assert.deepEqual(Object.keys(week.lineDayMinutes[0].lines).sort(), ['1', '2', '3', '4']);
  });
});

describe('daily target (pqty = ceil(lineTotal / workingDays))', () => {
  it('spreads demand across the calculated working days', () => {
    // SUM 6000 -> awd 2; cycleTime 1 keeps capacity out of the way
    const { week } = run({ dateColumns: 6, parts: [{ spec: 'S', line: 2, cycleTime: 1, bu: 6000 }] });
    assert.equal(week.actualWorkingDays, 2);
    const part = findPart(week, 'S');
    const perDay = {};
    part.allocations.forEach((a) => { perDay[a.dayIndex] = (perDay[a.dayIndex] || 0) + a.qty; });
    assert.deepEqual(perDay, { 0: 3000, 1: 3000 });
  });

  it('caps a day at the target even when spare capacity exists', () => {
    const { week } = run({ dateColumns: 6, parts: [{ spec: 'S', line: 2, cycleTime: 1, bu: 6000 }] });
    // Line 2 could do 1900 minutes = 1900 units/day, but the target is what binds.
    assert.equal(week.lineDayMinutes[0].lines[2].used, 1900);
    assert.equal(findPart(week, 'S').allocations.filter((a) => a.dayIndex === 0).reduce((s, a) => s + a.qty, 0), 3000);
  });
});

describe('tolerance and extension days', () => {
  it('does NOT extend when leftover is within the tolerance of 20', () => {
    // L1 142 units/day, demand 152 -> leftover 10 (<= 20)
    const { week, result } = run({ dateColumns: 3, parts: [{ spec: 'T', line: 1, cycleTime: 10, bu: 152 }] });
    assert.equal(week.actualWorkingDays, 1);
    assert.equal(week.lineDayMinutes.length, 1, 'no extra day is opened');
    assert.equal(findPart(week, 'T').remainingQty, 10);
    assert.equal(errorsOfType(result.errors, 'NO_CAPACITY', 'BU').length, 1, 'leftover still reported');
  });

  // Boundary pair: the extension trigger is `leftover > 20`, strictly greater.
  // These two cases sit either side of that edge and will fail if TOLERANCE moves.
  it('does not extend at a leftover of exactly 20 (the tolerance boundary)', () => {
    // L1 = 142 units/day at cycleTime 10; demand 162 -> leftover exactly 20
    const { week } = run({ dateColumns: 4, parts: [{ spec: 'EDGE20', line: 1, cycleTime: 10, bu: 162 }] });
    assert.equal(findPart(week, 'EDGE20').remainingQty, 20);
    assert.equal(week.lineDayMinutes.length, 1, '20 is NOT > 20, so no extension');
  });

  it('extends at a leftover of exactly 21 (one past the boundary)', () => {
    // demand 163 -> leftover exactly 21
    const { week } = run({ dateColumns: 4, parts: [{ spec: 'EDGE21', line: 1, cycleTime: 10, bu: 163 }] });
    assert.equal(week.lineDayMinutes.length, 2, '21 > 20 triggers one extension day');
    const part = findPart(week, 'EDGE21');
    assert.equal(part.remainingQty, 0);
    assert.deepEqual(part.allocations.filter((a) => a.dayIndex === 1), [{ dayIndex: 1, qty: 21, lineUsed: 1 }]);
  });

  it('extends into extra date columns when leftover exceeds the tolerance', () => {
    // demand 175 -> leftover 33 (> 20)
    const { week, result } = run({ dateColumns: 3, parts: [{ spec: 'T2', line: 1, cycleTime: 10, bu: 175 }] });
    assert.equal(week.actualWorkingDays, 1);
    assert.equal(week.lineDayMinutes.length, 2, 'one extension day was opened');
    const part = findPart(week, 'T2');
    assert.deepEqual(part.allocations, [
      { dayIndex: 0, qty: 142, lineUsed: 1 },
      { dayIndex: 1, qty: 33, lineUsed: 1 }
    ]);
    assert.equal(part.remainingQty, 0);
    assert.equal(errorsOfType(result.errors, 'NO_CAPACITY').length, 0);
  });

  it('keeps opening extension days until the remainder is exhausted', () => {
    // L3 (chain [3] only) = 950 units/day at cycleTime 1. SUM 4000 -> awd 2.
    // Main pass covers days 0-1; extension continues on days 2..n.
    const { week } = run({ dateColumns: 8, parts: [{ spec: 'E', line: 3, cycleTime: 1, bu: 4000 }] });
    const part = findPart(week, 'E');
    assert.equal(week.actualWorkingDays, 2);
    const perDay = {};
    part.allocations.forEach((a) => { perDay[a.dayIndex] = (perDay[a.dayIndex] || 0) + a.qty; });
    assert.deepEqual(perDay, { 0: 950, 1: 950, 2: 950, 3: 950, 4: 200 });
    assert.equal(part.remainingQty, 0);
    assert.equal(week.lineDayMinutes.length, 5);
  });

  it('cannot extend when no spare date columns remain', () => {
    const { week, result } = run({ dateColumns: 1, parts: [{ spec: 'X', line: 1, cycleTime: 10, bu: 300 }] });
    assert.equal(week.lineDayMinutes.length, 1);
    assert.equal(findPart(week, 'X').remainingQty, 158);
    assert.equal(errorsOfType(result.errors, 'NO_CAPACITY', 'BU').length, 1);
  });
});

describe('NO_CAPACITY reporting', () => {
  it('raises one error per part that still has a remaining quantity', () => {
    const { result } = run({
      dateColumns: 1,
      parts: [
        { spec: 'A', line: 3, cycleTime: 10, bu: 200, row: 10 },
        { spec: 'B', line: 1, cycleTime: 10, bu: 200, row: 11 }
      ]
    });
    const errs = errorsOfType(result.errors, 'NO_CAPACITY', 'BU');
    assert.deepEqual(errs.map((e) => e.spec).sort(), ['A', 'B']);
    errs.forEach((e) => assert.match(e.message, /Remaining quantity could not be allocated/));
  });

  it('raises nothing when every part is fully allocated', () => {
    const { result } = run({ dateColumns: 2, parts: [{ spec: 'A', line: 1, cycleTime: 10, bu: 100 }] });
    assert.equal(errorsOfType(result.errors, 'NO_CAPACITY').length, 0);
  });
});

describe('OVERLOAD reporting', () => {
  it('reports the minute shortfall when demand exceeds counted capacity', () => {
    // demand = 100 units x 100 min = 10000; counted capacity = day 0 across all 4 lines = 5700
    const { result } = run({ dateColumns: 1, parts: [{ spec: 'OV', line: 3, cycleTime: 100, bu: 100 }] });
    const errs = errorsOfType(result.errors, 'OVERLOAD', 'BU');
    assert.equal(errs.length, 1);
    assert.equal(errs[0].overloadMinutes, 4300);
    assert.match(errs[0].message, /exceeds total capacity by 4300 minutes/);
  });

  it('does not report overload when demand fits', () => {
    const { result } = run({ dateColumns: 2, parts: [{ spec: 'A', line: 1, cycleTime: 10, bu: 100 }] });
    assert.equal(errorsOfType(result.errors, 'OVERLOAD').length, 0);
  });
});

describe('fatal error conditions', () => {
  it('refuses to fall back to Sheet1 when no working-days sheet exists', () => {
    // FIXED in Phase 2 (was BUG-3): this previously wrote working days into
    // Sheet1 itself at I4:I6, silently corrupting the schedule sheet.
    const workbook = buildFixture({ dateColumns: 1, parts: [{ spec: 'A', line: 1, cycleTime: 10, bu: 10 }] });
    const onlySheet1 = { SheetNames: ['WORKSHEET'], Sheets: { WORKSHEET: workbook.Sheets.WORKSHEET } };

    assert.throws(
      () => new AllocationEngine().run(onlySheet1),
      /Could not identify the working-days sheet/
    );
    assert.equal(onlySheet1.Sheets.WORKSHEET.I4, undefined, 'Sheet1 was not written to');
  });

  it('crashes with a TypeError when a named sheet is absent from the Sheets map', () => {
    // KNOWN ISSUE: allocation.js:340 has a `throw new Error('Sheet1 not found')`
    // guard, but detectSheet1() dereferences the missing sheet first, so that
    // guard is unreachable and the caller sees an opaque TypeError instead.
    assert.throws(
      () => new AllocationEngine().run({ SheetNames: ['GONE'], Sheets: {} }),
      (err) => err instanceof TypeError && /reading 'BU4'/.test(err.message)
    );
  });
});

describe('allocation record shape', () => {
  it('emits { dayIndex, qty, lineUsed } entries', () => {
    const { week } = run({ dateColumns: 1, parts: [{ spec: 'P2', line: 2, cycleTime: 10, bu: 250 }] });
    const part = findPart(week, 'P2');
    part.allocations.forEach((a) => {
      assert.deepEqual(Object.keys(a).sort(), ['dayIndex', 'lineUsed', 'qty']);
      assert.ok(Number.isInteger(a.dayIndex) && a.dayIndex >= 0);
      assert.ok(a.qty > 0);
      assert.ok([1, 2, 3, 4].includes(a.lineUsed));
    });
  });

  it('preserves the parsed part fields the API and Excel writer depend on', () => {
    const { week } = run({ dateColumns: 1, parts: [{ spec: 'P2', line: 2, cycleTime: 10, bu: 250, row: 12 }] });
    const part = findPart(week, 'P2');
    assert.deepEqual(Object.keys(part).sort(), [
      'allocations', 'cycleTime', 'originalLine', 'remainingQty', 'rowIndex', 'spec', 'weeklyQty'
    ]);
    assert.equal(part.rowIndex, 11, 'zero-based row index of Excel row 12');
  });
});
