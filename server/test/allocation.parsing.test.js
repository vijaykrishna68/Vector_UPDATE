'use strict';

/**
 * Parsing / validation / summarisation behavior of AllocationEngine.
 *
 * These tests document CURRENT behavior as of the safety-net phase.
 * They are deliberately NOT a statement of what the rules *should* be.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const AllocationEngine = require('../allocation.js');
const { buildFixture, findPart, errorsOfType, SHEET3_SENTINELS, readCell } = require('../test-support/workbook.js');

function run(spec) {
  const workbook = buildFixture(spec);
  const engine = new AllocationEngine();
  const result = engine.run(workbook);
  return { workbook, engine, result, week: result.weeksResults[0] };
}

describe('engine constants', () => {
  it('exposes the documented capacity model (manpower x 475 minutes)', () => {
    const e = new AllocationEngine();
    assert.equal(e.MINUTES_PER_PERSON, 475);
    assert.deepEqual(e.LINE_CAPACITY, { 1: 1425, 2: 1900, 3: 950, 4: 1425 });
    assert.equal(e.TOLERANCE, 20);
    assert.equal(e.FACTORY_DAILY_CAP, 3000);
  });

  it('processes exactly the three week columns BU, BV, BW', () => {
    const { result } = run({ dateColumns: 2, parts: [{ spec: 'A', line: 1, cycleTime: 10, bu: 10 }] });
    assert.deepEqual(result.weeksResults.map((w) => w.weekColumn), ['BU', 'BV', 'BW']);
  });
});

describe('component unit filter (column J)', () => {
  it('keeps only rows where column J is exactly "PC"', () => {
    const { week } = run({
      dateColumns: 2,
      parts: [
        { spec: 'KEEP', line: 1, cycleTime: 10, bu: 10, row: 10 },
        { spec: 'DROP_SET', line: 1, cycleTime: 10, bu: 999, row: 11, componentUnit: 'SET' },
        { spec: 'DROP_LOWER', line: 1, cycleTime: 10, bu: 999, row: 12, componentUnit: 'pc' }
      ]
    });
    assert.deepEqual(week.parts.map((p) => p.spec), ['KEEP']);
    assert.equal(week.SUM, 10, 'non-PC demand is excluded from SUM');
  });

  it('drops non-PC rows silently, without raising any error', () => {
    const { result } = run({
      dateColumns: 2,
      parts: [
        { spec: 'OK', line: 1, cycleTime: 10, bu: 10, row: 10 },
        { spec: 'NOTPC', line: 1, cycleTime: 10, bu: 50, row: 11, componentUnit: 'SET' }
      ]
    });
    assert.equal(result.errors.length, 0);
  });
});

describe('input validation', () => {
  it('reports a missing spec and skips the row', () => {
    const { week, result } = run({
      dateColumns: 2,
      parts: [{ spec: null, line: 1, cycleTime: 10, bu: 50, row: 10 }]
    });
    assert.equal(week.parts.length, 0);
    const errs = errorsOfType(result.errors, 'INVALID_INPUT', 'BU');
    assert.equal(errs.length, 1);
    assert.match(errs[0].message, /Missing spec \(required\) at row 10/);
  });

  it('rejects cycleTime of zero, negative, and non-numeric', () => {
    const { week, result } = run({
      dateColumns: 2,
      parts: [
        { spec: 'ZERO', line: 1, cycleTime: 0, bu: 50, row: 10 },
        { spec: 'NEG', line: 1, cycleTime: -5, bu: 50, row: 11 },
        { spec: 'TEXT', line: 1, cycleTime: 'abc', bu: 50, row: 12 }
      ]
    });
    assert.equal(week.parts.length, 0, 'all three rows are skipped');
    const errs = errorsOfType(result.errors, 'INVALID_INPUT', 'BU');
    assert.equal(errs.length, 3);
    errs.forEach((e) => assert.match(e.message, /Invalid cycleTime \(<= 0\)/));
  });

  it('rejects a negative weekly quantity', () => {
    const { week, result } = run({
      dateColumns: 2,
      parts: [{ spec: 'NEGQTY', line: 1, cycleTime: 10, bu: -5, row: 10 }]
    });
    assert.equal(week.parts.length, 0);
    const errs = errorsOfType(result.errors, 'INVALID_INPUT', 'BU');
    assert.equal(errs.length, 1);
    assert.match(errs[0].message, /Invalid weeklyQty \(negative\)/);
  });

  it('treats a blank weekly quantity as zero and KEEPS the part', () => {
    // A second part supplies demand so SUM > 0; parts are only surfaced on the
    // week result when the week has demand (see the "zero demand" suite).
    const { week, result } = run({
      dateColumns: 2,
      parts: [
        { spec: 'BLANK', line: 1, cycleTime: 10, bu: null, row: 10 },
        { spec: 'HASQTY', line: 1, cycleTime: 10, bu: 30, row: 11 }
      ]
    });
    const part = findPart(week, 'BLANK');
    assert.ok(part, 'part is retained rather than skipped');
    assert.equal(part.weeklyQty, 0);
    assert.deepEqual(part.allocations, []);
    assert.equal(errorsOfType(result.errors, 'INVALID_INPUT', 'BU').length, 0, 'blank is not an error');
    assert.equal(week.SUM, 30);
    assert.equal(week.CountOfParts, 1, 'the blank part is not counted');
  });

  it('excludes invalid rows from SUM, so SUM is not a plain Excel column sum', () => {
    const { week } = run({
      dateColumns: 2,
      parts: [
        { spec: 'GOOD', line: 1, cycleTime: 10, bu: 30, row: 10 },
        { spec: 'BADCT', line: 1, cycleTime: 0, bu: 500, row: 11 }
      ]
    });
    // NOTE (audit D9): the Excel column really totals 530; the engine reports 30.
    assert.equal(week.SUM, 30);
  });

  it('repeats row-level validation errors once per week column', () => {
    const { result } = run({
      dateColumns: 2,
      parts: [{ spec: 'BADCT', line: 1, cycleTime: 0, bu: 50, row: 10 }]
    });
    assert.deepEqual(
      errorsOfType(result.errors, 'INVALID_INPUT').map((e) => e.week),
      ['BU', 'BV', 'BW'],
      'parsing runs per week, so the same bad row is reported three times'
    );
  });

  it('parses originalLine as null when column D is blank', () => {
    const { week } = run({
      dateColumns: 2,
      parts: [{ spec: 'NOLINE', line: null, cycleTime: 10, bu: 50, row: 10 }]
    });
    assert.equal(findPart(week, 'NOLINE').originalLine, null);
  });
});

describe('duplicate merging (spec + week)', () => {
  it('merges duplicate rows into one part and sums the quantity', () => {
    const { week } = run({
      dateColumns: 2,
      parts: [
        { spec: 'DUP', line: 1, cycleTime: 10, bu: 100, row: 10 },
        { spec: 'DUP', line: 1, cycleTime: 10, bu: 50, row: 11 }
      ]
    });
    assert.equal(week.parts.length, 1);
    const part = findPart(week, 'DUP');
    assert.equal(part.weeklyQty, 150);
    assert.equal(part.rowIndex, 9, 'the FIRST row wins, so output is written to row 10');
  });

  it('keeps the first cycleTime and reports DUPLICATE_MERGED when they differ', () => {
    const { week, result } = run({
      dateColumns: 2,
      parts: [
        { spec: 'DUP', line: 1, cycleTime: 10, bu: 100, row: 10 },
        { spec: 'DUP', line: 1, cycleTime: 20, bu: 200, row: 11 }
      ]
    });
    assert.equal(findPart(week, 'DUP').cycleTime, 10);
    const errs = errorsOfType(result.errors, 'DUPLICATE_MERGED', 'BU');
    assert.equal(errs.length, 1);
    assert.match(errs[0].message, /Kept cycleTime=10, ignored cycleTime=20 from row 11/);
  });

  it('does not report DUPLICATE_MERGED when cycle times agree', () => {
    const { result } = run({
      dateColumns: 2,
      parts: [
        { spec: 'SAME', line: 1, cycleTime: 10, bu: 100, row: 10 },
        { spec: 'SAME', line: 1, cycleTime: 10, bu: 50, row: 11 }
      ]
    });
    assert.equal(errorsOfType(result.errors, 'DUPLICATE_MERGED').length, 0);
  });

  it('reports DUPLICATE_MERGED for every week, even weeks with zero demand', () => {
    const { result } = run({
      dateColumns: 2,
      parts: [
        { spec: 'DUP', line: 1, cycleTime: 10, bu: 100, bv: 0, bw: 0, row: 10 },
        { spec: 'DUP', line: 1, cycleTime: 20, bu: 200, bv: 0, bw: 0, row: 11 }
      ]
    });
    assert.deepEqual(errorsOfType(result.errors, 'DUPLICATE_MERGED').map((e) => e.week), ['BU', 'BV', 'BW']);
  });
});

describe('SUM / CountOfParts', () => {
  it('counts only parts with a quantity greater than zero', () => {
    const { week } = run({
      dateColumns: 2,
      parts: [
        { spec: 'A', line: 1, cycleTime: 10, bu: 10, row: 10 },
        { spec: 'B', line: 1, cycleTime: 10, bu: 0, row: 11 },
        { spec: 'C', line: 1, cycleTime: 10, bu: 5, row: 12 }
      ]
    });
    assert.equal(week.SUM, 15);
    assert.equal(week.CountOfParts, 2, 'the zero-quantity part is parsed but not counted');
    assert.equal(week.parts.length, 3);
  });
});

describe('working-day calculation (ceil(SUM / 3000))', () => {
  const cases = [
    { qty: 0, awd: 0 },
    { qty: 1, awd: 1 },
    { qty: 2999, awd: 1 },
    { qty: 3000, awd: 1 },
    { qty: 3001, awd: 2 },
    { qty: 7200, awd: 3 }
  ];

  for (const { qty, awd } of cases) {
    it(`SUM=${qty} yields ${awd} working day(s)`, () => {
      const { week } = run({ dateColumns: 12, parts: [{ spec: 'W', line: 1, cycleTime: 1, bu: qty }] });
      assert.equal(week.SUM, qty);
      assert.equal(week.actualWorkingDays, awd);
    });
  }

  it('writes working days into Sheet3 column I rows 4/5/6, overwriting prior values', () => {
    const { workbook, result } = run({
      dateColumns: 12,
      parts: [{ spec: 'W', line: 1, cycleTime: 1, bu: 3001, bv: 1, bw: 0 }]
    });
    const sheet3 = workbook.Sheets[result.sheet3Name];
    assert.equal(readCell(sheet3, 'I4'), 2, 'BU -> I4');
    assert.equal(readCell(sheet3, 'I5'), 1, 'BV -> I5');
    assert.equal(readCell(sheet3, 'I6'), 0, 'BW -> I6');
    assert.notEqual(readCell(sheet3, 'I4'), SHEET3_SENTINELS.I4, 'sentinel was overwritten');
  });
});

describe('zero demand', () => {
  it('skips allocation entirely and returns an empty week shape', () => {
    const { week, result } = run({ dateColumns: 2, parts: [{ spec: 'Z', line: 1, cycleTime: 10, bu: 0 }] });
    assert.equal(week.SUM, 0);
    assert.equal(week.CountOfParts, 0);
    assert.equal(week.actualWorkingDays, 0);
    assert.deepEqual(week.parts, [], 'parts are NOT surfaced when SUM is 0');
    assert.deepEqual(week.lineDayMinutes, []);
    assert.deepEqual(week.lineTotals, {});
    assert.equal(result.errors.length, 0);
  });

  it('still reports date headers when there is no demand', () => {
    const { week } = run({ dateColumns: 4, parts: [{ spec: 'Z', line: 1, cycleTime: 10, bu: 0 }] });
    assert.deepEqual(week.dateHeaders, ['D1', 'D2', 'D3', 'D4']);
  });
});

describe('sheet and date-column detection', () => {
  it('detects Sheet1 by the presence of BU4 / BV5 / BW6', () => {
    const { result } = run({ dateColumns: 2, parts: [{ spec: 'A', line: 1, cycleTime: 10, bu: 10 }] });
    assert.equal(result.sheet1Name, 'WORKSHEET');
  });

  it('collects date columns from CU up to the first blank header on row 3', () => {
    const { week } = run({ dateColumns: 5, parts: [{ spec: 'A', line: 1, cycleTime: 10, bu: 10 }] });
    assert.deepEqual(week.dateHeaders, ['D1', 'D2', 'D3', 'D4', 'D5']);
  });

  it('throws when no date column exists at CU', () => {
    const workbook = buildFixture({ dateColumns: 1, parts: [{ spec: 'A', line: 1, cycleTime: 10, bu: 10 }] });
    delete workbook.Sheets.WORKSHEET.CU3;
    assert.throws(() => new AllocationEngine().run(workbook), /No date columns starting at CU/);
  });
});
