'use strict';

/**
 * Run persistence integrity.
 *
 * The audit found that a run was written in several independent steps, so a
 * mid-way failure left a Run document that the "latest run" lookup would serve
 * with missing children. These tests drive real failures through the persistence
 * service and assert the two-phase status guard holds:
 *
 *   - a failed run is marked 'failed'
 *   - its child documents are removed
 *   - it can never become the active/latest run
 *   - an earlier good run stays intact and current
 *
 * Skips when no MongoDB is reachable.
 */

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const mongoose = require('mongoose');

const AllocationEngine = require('../allocation.js');
const { buildFixture } = require('../test-support/workbook.js');

const TEST_URI =
  process.env.TEST_MONGODB_URI || 'mongodb://127.0.0.1:27096/vector_persistence_test';

function mongoReachable(uri) {
  const match = /mongodb:\/\/([^/:,]+)(?::(\d+))?/.exec(uri);
  if (!match) return false;
  const host = match[1];
  const port = Number(match[2] || 27017);
  try {
    execFileSync(
      process.execPath,
      [
        '-e',
        `const n=require('net');const s=n.connect(${port},${JSON.stringify(host)},()=>{s.destroy();process.exit(0);});` +
          `s.on('error',()=>process.exit(1));setTimeout(()=>process.exit(1),1500);`
      ],
      { stdio: 'ignore', timeout: 5000 }
    );
    return true;
  } catch {
    return false;
  }
}

const available = mongoReachable(TEST_URI);

describe(
  'run persistence integrity',
  { skip: available ? false : 'no MongoDB reachable — set TEST_MONGODB_URI to run' },
  () => {
    let Run;
    let Job;
    let Machine;
    let Allocation;
    let persistRun;
    let runQuery;
    let RUN_STATUS;

    /** Engine output for a small valid workbook. */
    function engineOutput() {
      const workbook = buildFixture({
        dateColumns: 4,
        parts: [
          { spec: 'P-L1', line: 1, cycleTime: 10, bu: 120, bv: 40, bw: 0, row: 10 },
          { spec: 'P-L3', line: 3, cycleTime: 7, bu: 200, bv: 0, bw: 30, row: 11 }
        ]
      });
      const engine = new AllocationEngine();
      return { engine, result: engine.run(workbook) };
    }

    before(async () => {
      await mongoose.connect(TEST_URI, { serverSelectionTimeoutMS: 3000 });
      Run = require('../models/Run');
      Job = require('../models/Job');
      Machine = require('../models/Machine');
      Allocation = require('../models/Allocation');
      RUN_STATUS = Run.RUN_STATUS;
      persistRun = require('../services/runPersistence.service').persistRun;
      runQuery = require('../services/runQuery.service');
    });

    beforeEach(async () => {
      await mongoose.connection.dropDatabase();
    });

    after(async () => {
      await mongoose.connection.dropDatabase();
      await mongoose.disconnect();
    });

    it('marks a successful run complete with its totals and summaries', async () => {
      const { engine, result } = engineOutput();
      const { run } = await persistRun({
        runResult: result,
        lineCapacity: engine.LINE_CAPACITY,
        sourceFilename: 'good.xlsx'
      });

      const stored = await Run.findById(run._id).lean();
      assert.equal(stored.status, RUN_STATUS.COMPLETE);
      assert.ok(stored.completedAt instanceof Date);
      assert.equal(stored.sourceFilename, 'good.xlsx');
      assert.equal(stored.weekSummaries.length, 3);
      assert.equal(stored.totals.allocated + stored.totals.remaining, stored.totals.demand);

      assert.equal(await Machine.countDocuments({ runId: run._id }), 4);
      assert.ok((await Job.countDocuments({ runId: run._id })) > 0);
      assert.ok((await Allocation.countDocuments({ runId: run._id })) > 0);
    });

    it('marks the run failed and removes its children when a child write fails', async () => {
      const { engine, result } = engineOutput();

      // Force the last and largest child write to fail.
      const original = Allocation.insertMany;
      Allocation.insertMany = async () => {
        throw new Error('simulated allocation write failure');
      };

      let thrown = null;
      try {
        await persistRun({ runResult: result, lineCapacity: engine.LINE_CAPACITY });
      } catch (err) {
        thrown = err;
      } finally {
        Allocation.insertMany = original;
      }

      assert.ok(thrown, 'the failure propagates to the caller');
      assert.match(thrown.message, /simulated allocation write failure/);

      const runs = await Run.find({}).lean();
      assert.equal(runs.length, 1, 'the reserved run document still exists');
      assert.equal(runs[0].status, RUN_STATUS.FAILED, 'and is marked failed');
      assert.match(runs[0].failureReason, /simulated allocation write failure/);

      // Children are cleaned up so no orphans linger.
      assert.equal(await Machine.countDocuments({ runId: runs[0]._id }), 0);
      assert.equal(await Job.countDocuments({ runId: runs[0]._id }), 0);
      assert.equal(await Allocation.countDocuments({ runId: runs[0]._id }), 0);
    });

    it('never lets a failed run become the active run', async () => {
      const { engine, result } = engineOutput();

      // A good run first.
      const { run: goodRun } = await persistRun({
        runResult: result,
        lineCapacity: engine.LINE_CAPACITY,
        sourceFilename: 'good.xlsx'
      });

      // Then a failing one, which is newer.
      const original = Job.insertMany;
      Job.insertMany = async () => {
        throw new Error('simulated job write failure');
      };
      try {
        await persistRun({ runResult: result, lineCapacity: engine.LINE_CAPACITY });
      } catch {
        // expected
      } finally {
        Job.insertMany = original;
      }

      // Latest-run resolution must still return the good run.
      const resolved = await runQuery.resolveRunId(undefined);
      assert.equal(String(resolved), String(goodRun._id), 'latest run skips the failed one');

      // The run list must not show it either.
      const list = await runQuery.listRuns({});
      assert.equal(list.total, 1);
      assert.equal(list.runs[0].runId, String(goodRun._id));

      // And the good run is untouched.
      const stored = await Run.findById(goodRun._id).lean();
      assert.equal(stored.status, RUN_STATUS.COMPLETE);
      assert.ok((await Job.countDocuments({ runId: goodRun._id })) > 0);
    });

    it('hides a run that is still pending', async () => {
      // Simulates a process crash between phase 1 and phase 3.
      const pending = await Run.create({ status: RUN_STATUS.PENDING, createdAt: new Date() });

      const resolved = await runQuery.resolveRunId(undefined);
      assert.equal(resolved, null, 'a pending run is not servable');

      const list = await runQuery.listRuns({});
      assert.equal(list.total, 0);

      await assert.rejects(() => runQuery.getRun(String(pending._id)), /RUN_NOT_FOUND|does not exist/);
    });

    it('refuses to resolve an explicitly requested failed run, falling back to a good one', async () => {
      const { engine, result } = engineOutput();
      const { run: goodRun } = await persistRun({
        runResult: result,
        lineCapacity: engine.LINE_CAPACITY
      });
      const failed = await Run.create({ status: RUN_STATUS.FAILED, createdAt: new Date() });

      const resolved = await runQuery.resolveRunId(String(failed._id));
      assert.equal(String(resolved), String(goodRun._id));
    });

    it('keeps two successful runs fully independent', async () => {
      const first = engineOutput();
      const { run: runA } = await persistRun({
        runResult: first.result,
        lineCapacity: first.engine.LINE_CAPACITY,
        sourceFilename: 'a.xlsx'
      });
      const second = engineOutput();
      const { run: runB } = await persistRun({
        runResult: second.result,
        lineCapacity: second.engine.LINE_CAPACITY,
        sourceFilename: 'b.xlsx'
      });

      const jobsA = await Job.find({ runId: runA._id }).lean();
      const jobsB = await Job.find({ runId: runB._id }).lean();
      assert.ok(jobsA.length > 0 && jobsB.length > 0);

      const idsA = new Set(jobsA.map((j) => String(j._id)));
      assert.equal(jobsB.filter((j) => idsA.has(String(j._id))).length, 0);

      const list = await runQuery.listRuns({});
      assert.equal(list.total, 2);
      assert.deepEqual(
        list.runs.map((r) => r.sourceFilename),
        ['b.xlsx', 'a.xlsx'],
        'newest first'
      );
    });
  }
);

describe(
  'stored run backwards compatibility',
  { skip: available ? false : 'no MongoDB reachable' },
  () => {
    let Run;
    let runQuery;

    before(async () => {
      await mongoose.connect(TEST_URI, { serverSelectionTimeoutMS: 3000 });
      Run = require('../models/Run');
      runQuery = require('../services/runQuery.service');
      await mongoose.connection.dropDatabase();
    });

    after(async () => {
      await mongoose.connection.dropDatabase();
      await mongoose.disconnect();
    });

    it('still reads a legacy run written before the status field existed', async () => {
      // Insert through the driver so no Mongoose default supplies `status`.
      const legacy = {
        createdAt: new Date('2026-01-01T00:00:00Z'),
        weekSummaries: [
          {
            weekColumn: 'BU',
            SUM: 100,
            CountOfParts: 2,
            actualWorkingDays: 1,
            lineTotals: { 1: { allocated: 100, remaining: 0 } },
            lines: [
              {
                line: 1,
                allocatedParts: 100,
                remainingParts: 0,
                capacityMinutes: 1425,
                usedMinutes: 1000,
                efficiency: 70.18,
                workingDays: 1,
                avgPartsPerDay: 100
              }
            ]
          }
        ],
        errors: [{ type: 'INVALID_INPUT', message: 'legacy row skipped', week: 'BU' }]
      };
      const { insertedId } = await mongoose.connection.db.collection('runs').insertOne(legacy);

      // Readable despite having no status field.
      const resolved = await runQuery.resolveRunId(undefined);
      assert.equal(String(resolved), String(insertedId), 'legacy run resolves as latest');

      const run = await runQuery.getRun(String(insertedId));
      assert.equal(run.status, 'complete', 'absent status is treated as complete');
      assert.equal(run.weekSummaries.length, 1);

      const list = await runQuery.listRuns({});
      assert.equal(list.total, 1);

      // Its diagnostics are still served, and get a severity assigned on read.
      const issues = await runQuery.getRunIssues(String(insertedId), {});
      assert.equal(issues.total, 1);
      assert.equal(issues.issues[0].code, 'INVALID_INPUT');
      assert.equal(issues.issues[0].severity, 'info');
    });

    it('reads a legacy run that has no totals or issueSummary', async () => {
      await mongoose.connection.db.collection('runs').deleteMany({});
      const { insertedId } = await mongoose.connection.db.collection('runs').insertOne({
        createdAt: new Date('2026-01-02T00:00:00Z'),
        weekSummaries: [],
        errors: []
      });

      const run = await runQuery.getRun(String(insertedId));
      assert.deepEqual(run.totals, { demand: 0, allocated: 0, remaining: 0 });
      assert.deepEqual(run.issueSummary, []);
      assert.equal(run.health, 'nodata', 'no demand -> nodata rather than a crash');
    });
  }
);
