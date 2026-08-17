'use strict';

/**
 * Range normalisation (Phase 1 fix for audit BUG-5).
 *
 * Planner workbooks declare a '!ref' spanning the whole 1,048,576-row sheet.
 * Before the fix the engine carried that inflated range into its output, making
 * XLSX.write() serialise ~1M empty rows (~67s instead of ~0.5s) and making the
 * parser walk 3.1M rows instead of ~1,400.
 *
 * These tests are deterministic — no timing — so they protect the fix even when
 * uploads/ is absent. The timed guard lives in allocation.real-workbooks.test.js.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const XLSX = require('xlsx');

const AllocationEngine = require('../allocation.js');
const { buildFixture, findPart, dateCellAddr, readCell } = require('../test-support/workbook.js');

const BLOATED_REF = 'A1:DS1048576';

function fixture() {
  return {
    dateColumns: 4,
    parts: [
      { spec: 'R1', line: 1, cycleTime: 10, bu: 100, bv: 50, bw: 0, row: 10 },
      { spec: 'R2', line: 3, cycleTime: 7, bu: 200, bv: 0, bw: 25, row: 11 }
    ]
  };
}

/** Largest row/column actually holding a cell. */
function populatedExtent(sheet) {
  let maxR = -1;
  let maxC = -1;
  for (const key of Object.keys(sheet)) {
    if (key.startsWith('!')) continue;
    const d = XLSX.utils.decode_cell(key);
    if (d.r > maxR) maxR = d.r;
    if (d.c > maxC) maxC = d.c;
  }
  return { maxR, maxC };
}

describe('declared range normalisation', () => {
  it('shrinks an inflated 1M-row range to the real data extent', () => {
    const workbook = buildFixture(fixture());
    workbook.Sheets.WORKSHEET['!ref'] = BLOATED_REF;

    const result = new AllocationEngine().run(workbook);
    const sheet1 = workbook.Sheets[result.sheet1Name];
    const range = XLSX.utils.decode_range(sheet1['!ref']);
    const extent = populatedExtent(sheet1);

    assert.equal(range.e.r, extent.maxR, 'last row matches the last populated row');
    assert.equal(range.e.c, extent.maxC, 'last column matches the last populated column');
    assert.ok(range.e.r < 1000, `expected a tight range, got ${sheet1['!ref']}`);
  });

  it('keeps the declared range covering every populated cell', () => {
    const workbook = buildFixture(fixture());
    workbook.Sheets.WORKSHEET['!ref'] = BLOATED_REF;
    const result = new AllocationEngine().run(workbook);
    const sheet1 = workbook.Sheets[result.sheet1Name];
    const range = XLSX.utils.decode_range(sheet1['!ref']);

    for (const key of Object.keys(sheet1)) {
      if (key.startsWith('!')) continue;
      const d = XLSX.utils.decode_cell(key);
      assert.ok(
        d.r >= range.s.r && d.r <= range.e.r && d.c >= range.s.c && d.c <= range.e.c,
        `cell ${key} falls outside the declared range ${sheet1['!ref']}`
      );
    }
  });

  it('produces identical allocations whether or not the range is inflated', () => {
    const tight = buildFixture(fixture());
    const bloated = buildFixture(fixture());
    bloated.Sheets.WORKSHEET['!ref'] = BLOATED_REF;

    const a = new AllocationEngine().run(tight);
    const b = new AllocationEngine().run(bloated);

    // Everything except the declared range must be identical.
    assert.deepEqual(
      a.weeksResults.map((w) => ({ ...w, parts: w.parts })),
      b.weeksResults.map((w) => ({ ...w, parts: w.parts }))
    );
    assert.deepEqual(a.errors, b.errors);
  });

  it('writes the same cell values regardless of the incoming range', () => {
    const tight = buildFixture(fixture());
    const bloated = buildFixture(fixture());
    bloated.Sheets.WORKSHEET['!ref'] = BLOATED_REF;

    const ra = new AllocationEngine().run(tight);
    const rb = new AllocationEngine().run(bloated);

    const cellsOf = (wb, name) => {
      const s = wb.Sheets[name];
      return Object.keys(s)
        .filter((k) => !k.startsWith('!'))
        .sort()
        .reduce((acc, k) => { acc[k] = s[k].v; return acc; }, {});
    };

    assert.deepEqual(cellsOf(tight, ra.sheet1Name), cellsOf(bloated, rb.sheet1Name));
    assert.deepEqual(cellsOf(tight, ra.sheet3Name), cellsOf(bloated, rb.sheet3Name));
  });

  it('normalises the range even when no week has any demand', () => {
    // writeWeekAllocations never runs in this path, so run() must normalise too.
    const workbook = buildFixture({
      dateColumns: 3,
      parts: [{ spec: 'Z', line: 1, cycleTime: 10, bu: 0, bv: 0, bw: 0, row: 10 }]
    });
    workbook.Sheets.WORKSHEET['!ref'] = BLOATED_REF;

    const result = new AllocationEngine().run(workbook);
    const range = XLSX.utils.decode_range(workbook.Sheets[result.sheet1Name]['!ref']);
    assert.ok(range.e.r < 1000, 'range normalised on the zero-demand path');
  });

  it('still parses rows that sit near the end of a large sheet', () => {
    // Guards against over-shrinking: a part far down the sheet must still parse.
    const workbook = buildFixture({
      dateColumns: 3,
      parts: [
        { spec: 'NEAR', line: 1, cycleTime: 10, bu: 60, row: 10 },
        { spec: 'FAR', line: 1, cycleTime: 10, bu: 40, row: 900 }
      ]
    });
    const result = new AllocationEngine().run(workbook);
    const week = result.weeksResults[0];

    assert.equal(week.SUM, 100);
    assert.ok(findPart(week, 'FAR'), 'the row at Excel 900 is still parsed');
    assert.equal(findPart(week, 'FAR').rowIndex, 899);
    assert.equal(readCell(workbook.Sheets[result.sheet1Name], dateCellAddr(900, 0)), 40);
  });

  it('leaves sheets the engine does not touch untouched', () => {
    const workbook = buildFixture({
      dateColumns: 3,
      parts: [{ spec: 'A', line: 1, cycleTime: 10, bu: 50, row: 10 }],
      decoySheets: []
    });
    // An unrelated sheet with its own inflated range is not the engine's business.
    workbook.SheetNames.push('UNRELATED');
    workbook.Sheets.UNRELATED = { A1: { v: 1, t: 'n' }, '!ref': BLOATED_REF };

    new AllocationEngine().run(workbook);
    assert.equal(workbook.Sheets.UNRELATED['!ref'], BLOATED_REF, 'untouched sheets keep their range');
  });
});
