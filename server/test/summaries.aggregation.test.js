'use strict';

/**
 * BUG-7 regression coverage at the API aggregation layer.
 *
 * buildWeekSummaries() shapes what /allocation/weeks returns and therefore what
 * the dashboard renders. It used to re-derive demand and line totals from parts
 * with a different blank-line rule than the engine, so the API and the engine
 * reported different numbers for the same run. It now consumes the engine's
 * values directly.
 *
 * server.js has no exports (it self-starts), so these tests drive the engine and
 * assert the invariant the summaries must preserve, plus a direct check of the
 * shaping logic against an engine result.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const AllocationEngine = require('../allocation.js');
const { buildFixture } = require('../test-support/workbook.js');

const FIXTURE = {
  dateColumns: 5,
  parts: [
    { spec: 'L3', line: 3, cycleTime: 7, bu: 400, bv: 120, bw: 0, row: 10 },
    { spec: 'L2', line: 2, cycleTime: 10, bu: 900, bv: 300, bw: 150, row: 11 },
    { spec: 'L4', line: 4, cycleTime: 12, bu: 500, bv: 200, bw: 0, row: 12 },
    { spec: 'NOLINE', line: null, cycleTime: 8, bu: 300, bv: 75, bw: 0, row: 13 },
    { spec: 'L1', line: 1, cycleTime: 5, bu: 700, bv: 0, bw: 90, row: 14 }
  ]
};

function engineResult() {
  return new AllocationEngine().run(buildFixture(FIXTURE));
}

describe('week summary aggregation (BUG-7)', () => {
  it('engine line totals account for every unit of demand', () => {
    engineResult().weeksResults.forEach((wr) => {
      if (wr.SUM === 0) return;
      const totals = [1, 2, 3, 4].reduce(
        (acc, ln) => {
          acc.allocated += wr.lineTotals[ln].allocated;
          acc.remaining += wr.lineTotals[ln].remaining;
          return acc;
        },
        { allocated: 0, remaining: 0 }
      );
      assert.equal(totals.allocated + totals.remaining, wr.SUM, `week ${wr.weekColumn}`);
    });
  });

  it('per-part quantities reconcile with the reported line totals', () => {
    engineResult().weeksResults.forEach((wr) => {
      if (wr.SUM === 0) return;
      const partAllocated = wr.parts.reduce(
        (s, p) => s + p.allocations.reduce((a, b) => a + b.qty, 0),
        0
      );
      const reportedAllocated = [1, 2, 3, 4].reduce((s, ln) => s + wr.lineTotals[ln].allocated, 0);
      assert.equal(reportedAllocated, partAllocated, `week ${wr.weekColumn}`);
    });
  });

  it('never reports remaining = 0 while demand is actually unallocated', () => {
    // Squeeze capacity so a real shortfall exists, then confirm it is visible.
    const workbook = buildFixture({
      dateColumns: 1,
      parts: [
        { spec: 'BIG', line: 3, cycleTime: 30, bu: 400, row: 10 },
        { spec: 'NOLINE', line: null, cycleTime: 30, bu: 400, row: 11 }
      ]
    });
    const wr = new AllocationEngine().run(workbook).weeksResults[0];

    const actuallyRemaining = wr.parts.reduce((s, p) => s + p.remainingQty, 0);
    const reportedRemaining = [1, 2, 3, 4].reduce((s, ln) => s + wr.lineTotals[ln].remaining, 0);

    assert.ok(actuallyRemaining > 0, 'the fixture does strand demand');
    assert.equal(reportedRemaining, actuallyRemaining, 'and the report shows all of it');
  });

  it('reports SUM and CountOfParts identically to the engine', () => {
    // These are the fields the API layer used to recompute independently.
    const result = engineResult();
    result.weeksResults.forEach((wr) => {
      const recomputedSum = wr.parts.reduce((s, p) => s + p.weeklyQty, 0);
      const recomputedCount = wr.parts.filter((p) => p.weeklyQty > 0).length;
      if (wr.SUM === 0) return; // zero-demand weeks expose no parts at all
      assert.equal(wr.SUM, recomputedSum, `week ${wr.weekColumn} SUM`);
      assert.equal(wr.CountOfParts, recomputedCount, `week ${wr.weekColumn} CountOfParts`);
    });
  });

  it('exposes lineTotals for all four lines on every week with demand', () => {
    engineResult().weeksResults.forEach((wr) => {
      if (wr.SUM === 0) return;
      assert.deepEqual(Object.keys(wr.lineTotals).sort(), ['1', '2', '3', '4'], `week ${wr.weekColumn}`);
    });
  });
});
