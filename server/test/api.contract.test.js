'use strict';

/**
 * API contract tests against the REAL app (app.js), with a real MongoDB.
 *
 * These mount the actual routes, middleware and error handler, so they cover the
 * wiring an isolated unit test cannot: status codes, error shape, projections,
 * pagination and the run-history flow.
 *
 * The suite SKIPS when no MongoDB is reachable, so a fresh clone and CI without a
 * database still pass. Point TEST_MONGODB_URI at an instance to run it.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const XLSX = require('xlsx');

const { buildFixture } = require('../test-support/workbook.js');

const { execFileSync } = require('child_process');

const TEST_URI =
  process.env.TEST_MONGODB_URI || 'mongodb://127.0.0.1:27096/vector_api_contract_test';

/**
 * Synchronous reachability probe, so `describe` can be skipped declaratively.
 * A CommonJS module cannot use top-level await, and node:test needs the skip
 * decision before the suite body runs.
 */
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
  'API contract',
  { skip: available ? false : 'no MongoDB reachable — set TEST_MONGODB_URI to run' },
  () => {
    let server;
    let baseUrl;
    let uploadedRunId;

    /** A small but genuinely valid workbook the engine can process. */
    function workbookBuffer(overrides = {}) {
      const wb = buildFixture({
        dateColumns: 4,
        parts: [
          { spec: 'API-L1', line: 1, cycleTime: 10, bu: 120, bv: 40, bw: 0, row: 10 },
          { spec: 'API-L3', line: 3, cycleTime: 7, bu: 200, bv: 0, bw: 30, row: 11 },
          { spec: 'API-NOLINE', line: null, cycleTime: 8, bu: 90, bv: 0, bw: 0, row: 12 },
          { spec: 'API-DUP', line: 2, cycleTime: 5, bu: 50, bv: 0, bw: 0, row: 13 },
          { spec: 'API-DUP', line: 2, cycleTime: 9, bu: 60, bv: 0, bw: 0, row: 14 },
          { spec: 'API-BAD', line: 2, cycleTime: 0, bu: 999, bv: 0, bw: 0, row: 15 }
        ],
        ...overrides
      });
      return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    }

    async function upload(buffer, filename = 'plan.xlsx') {
      const form = new FormData();
      form.append(
        'file',
        new Blob([buffer], {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        }),
        filename
      );
      return fetch(`${baseUrl}/upload`, { method: 'POST', body: form });
    }

    const json = async (path) => {
      const res = await fetch(`${baseUrl}${path}`);
      return { res, body: await res.json() };
    };

    before(async () => {
      await mongoose.connect(TEST_URI, { serverSelectionTimeoutMS: 3000 });
      await mongoose.connection.dropDatabase();

      // Rate limiting would trip across the uploads this suite performs.
      process.env.UPLOAD_RATE_MAX = '500';
      const { createApp } = require('../app');
      const app = createApp({ serveClient: false });

      await new Promise((resolve) => {
        server = app.listen(0, '127.0.0.1', resolve);
      });
      baseUrl = `http://127.0.0.1:${server.address().port}`;

      const res = await upload(workbookBuffer(), 'first-plan.xlsx');
      assert.equal(res.status, 200, 'seed upload succeeded');
      uploadedRunId = res.headers.get('x-run-id');
      await res.arrayBuffer();
    });

    after(async () => {
      if (server) await new Promise((resolve) => server.close(resolve));
      await mongoose.connection.dropDatabase();
      await mongoose.disconnect();
    });

    /* ------------------------------------------------------------- health */

    describe('health', () => {
      it('GET /health reports liveness without touching the database', async () => {
        const { res, body } = await json('/health');
        assert.equal(res.status, 200);
        assert.equal(body.status, 'ok');
        assert.ok(Number.isFinite(body.uptimeSeconds));
        assert.equal(body.db, undefined, 'liveness must not depend on the database');
      });

      it('GET /health/ready reports dependency readiness', async () => {
        const { res, body } = await json('/health/ready');
        assert.equal(res.status, 200);
        assert.equal(body.status, 'ready');
        assert.equal(body.db, 'connected');
      });
    });

    /* -------------------------------------------------------------- upload */

    describe('POST /upload', () => {
      it('returns the workbook and a complete, readable run', async () => {
        const res = await upload(workbookBuffer(), 'second-plan.xlsx');
        assert.equal(res.status, 200);
        assert.match(
          res.headers.get('content-type'),
          /spreadsheetml\.sheet/,
          'responds with a workbook'
        );
        const runId = res.headers.get('x-run-id');
        assert.match(runId, /^[0-9a-f]{24}$/);
        await res.arrayBuffer();

        // A 200 must mean the run is immediately usable.
        const { res: runRes, body: run } = await json(`/runs/${runId}`);
        assert.equal(runRes.status, 200);
        assert.equal(run.status, 'complete');
        assert.equal(run.sourceFilename, 'second-plan.xlsx');
      });
    });

    /* ---------------------------------------------------- issue payload size */

    describe('issue payload', () => {
      it('GET /allocation/weeks returns a SUMMARY, not the full diagnostic list', async () => {
        const { res, body } = await json('/allocation/weeks');
        assert.equal(res.status, 200);

        assert.deepEqual(
          Object.keys(body).sort(),
          ['issuesSummary', 'run', 'summary', 'weeks'],
          'documented response shape'
        );
        assert.equal(body.errors, undefined, 'the flat error array is no longer shipped');
        assert.equal(body.allocations, undefined, 'renamed to weeks');

        assert.ok(Array.isArray(body.issuesSummary));
        body.issuesSummary.forEach((group) => {
          assert.deepEqual(
            Object.keys(group).sort(),
            ['affectedWeeks', 'code', 'count', 'examples', 'severity']
          );
          assert.ok(['critical', 'warning', 'info'].includes(group.severity));
          assert.ok(group.count >= 1);
          assert.ok(group.examples.length <= 3, 'examples are capped');
        });
      });

      it('reports run-level totals so the client does not re-derive them', async () => {
        const { body } = await json('/allocation/weeks');
        assert.ok(body.summary);
        assert.equal(
          body.summary.allocated + body.summary.remaining,
          body.summary.demand,
          'totals reconcile'
        );
        assert.equal(body.summary.weekCount, body.weeks.length);
      });

      it('keeps the summary payload far smaller than the full diagnostic list', async () => {
        const { body: weeks } = await json('/allocation/weeks');
        const { body: issues } = await json(`/runs/${uploadedRunId}/issues?pageSize=500`);

        const summaryBytes = Buffer.byteLength(JSON.stringify(weeks.issuesSummary));
        const fullBytes = Buffer.byteLength(JSON.stringify(issues.issues));

        assert.ok(issues.total > weeks.issuesSummary.length, 'there really are more diagnostics');
        assert.ok(
          summaryBytes < fullBytes,
          `summary (${summaryBytes}B) must be smaller than the full list (${fullBytes}B)`
        );
      });

      it('discards no diagnostic information: summary counts equal the full total', async () => {
        const { body: weeks } = await json('/allocation/weeks');
        const { body: issues } = await json(`/runs/${uploadedRunId}/issues?pageSize=500`);
        const summed = weeks.issuesSummary.reduce((s, g) => s + g.count, 0);
        assert.equal(summed, issues.total, 'nothing is dropped, only aggregated');
      });
    });

    /* ---------------------------------------------------------- run history */

    describe('GET /runs', () => {
      it('lists runs newest first with lightweight metadata only', async () => {
        const { res, body } = await json('/runs');
        assert.equal(res.status, 200);
        assert.ok(body.runs.length >= 2);

        const [newest, older] = body.runs;
        assert.ok(new Date(newest.createdAt) >= new Date(older.createdAt), 'newest first');

        assert.deepEqual(
          Object.keys(newest).sort(),
          [
            'completedAt', 'createdAt', 'health', 'issueCount', 'issueSummary',
            'runId', 'sourceFilename', 'status', 'totals', 'weeks'
          ]
        );
        // The heavy fields must not appear.
        assert.equal(newest.errors, undefined);
        assert.equal(newest.weekSummaries, undefined);
        assert.equal(newest.parts, undefined);
        assert.equal(newest.allocations, undefined);
      });

      it('paginates', async () => {
        const { body: firstPage } = await json('/runs?page=1&pageSize=1');
        assert.equal(firstPage.runs.length, 1);
        assert.equal(firstPage.pageSize, 1);
        assert.ok(firstPage.total >= 2);
        assert.ok(firstPage.totalPages >= 2);

        const { body: secondPage } = await json('/runs?page=2&pageSize=1');
        assert.notEqual(secondPage.runs[0].runId, firstPage.runs[0].runId);
      });

      it('clamps an absurd pageSize instead of trusting it', async () => {
        const { body } = await json('/runs?pageSize=99999');
        assert.ok(body.pageSize <= 100);
      });

      it('exposes week identifiers and reconciling totals per run', async () => {
        const { body } = await json('/runs');
        body.runs.forEach((run) => {
          assert.deepEqual(run.weeks, ['BU', 'BV', 'BW']);
          assert.equal(run.totals.allocated + run.totals.remaining, run.totals.demand);
          assert.ok(['healthy', 'warning', 'critical', 'nodata'].includes(run.health));
        });
      });
    });

    describe('GET /runs/:runId', () => {
      it('returns one run with its week summaries', async () => {
        const { res, body } = await json(`/runs/${uploadedRunId}`);
        assert.equal(res.status, 200);
        assert.equal(body.runId, uploadedRunId);
        assert.equal(body.weekSummaries.length, 3);
        assert.equal(body.errors, undefined, 'still no full diagnostic list');
      });

      it('404s for a well-formed but unknown run id', async () => {
        const { res, body } = await json('/runs/0123456789abcdef01234567');
        assert.equal(res.status, 404);
        assert.equal(body.code, 'RUN_NOT_FOUND');
      });

      it('400s for a malformed run id', async () => {
        const { res, body } = await json('/runs/not-an-object-id');
        assert.equal(res.status, 400);
        assert.equal(body.code, 'INVALID_RUN_ID');
      });
    });

    /* ------------------------------------------------------- issue endpoint */

    describe('GET /runs/:runId/issues', () => {
      it('paginates diagnostics', async () => {
        const { res, body } = await json(`/runs/${uploadedRunId}/issues?page=1&pageSize=2`);
        assert.equal(res.status, 200);
        assert.equal(body.issues.length, 2);
        assert.equal(body.pageSize, 2);
        assert.ok(body.total >= 2);

        const { body: page2 } = await json(`/runs/${uploadedRunId}/issues?page=2&pageSize=2`);
        assert.notDeepEqual(page2.issues, body.issues, 'page 2 differs from page 1');
      });

      it('filters by code', async () => {
        const { body } = await json(`/runs/${uploadedRunId}/issues?code=DUPLICATE_MERGED&pageSize=500`);
        assert.ok(body.total >= 1);
        body.issues.forEach((i) => assert.equal(i.code, 'DUPLICATE_MERGED'));
        assert.equal(body.filters.code, 'DUPLICATE_MERGED');
      });

      it('filters by week', async () => {
        const { body } = await json(`/runs/${uploadedRunId}/issues?week=BU&pageSize=500`);
        assert.ok(body.total >= 1);
        body.issues.forEach((i) => assert.equal(i.week, 'BU'));
      });

      it('combines code and week filters', async () => {
        const { body } = await json(
          `/runs/${uploadedRunId}/issues?code=INVALID_INPUT&week=BV&pageSize=500`
        );
        body.issues.forEach((i) => {
          assert.equal(i.code, 'INVALID_INPUT');
          assert.equal(i.week, 'BV');
        });
      });

      it('returns an empty page rather than an error for an unmatched filter', async () => {
        const { res, body } = await json(`/runs/${uploadedRunId}/issues?code=NO_SUCH_CODE`);
        assert.equal(res.status, 200);
        assert.deepEqual(body.issues, []);
        assert.equal(body.total, 0);
      });

      it('carries severity on every diagnostic', async () => {
        const { body } = await json(`/runs/${uploadedRunId}/issues?pageSize=50`);
        body.issues.forEach((i) => {
          assert.ok(['critical', 'warning', 'info'].includes(i.severity));
          assert.equal(typeof i.message, 'string');
        });
      });
    });

    /* ------------------------------------------------------- week detail */

    describe('GET /allocation/week/:weekColumn', () => {
      it('returns part rows with reconciling quantities', async () => {
        const { res, body } = await json(`/allocation/week/BU?runId=${uploadedRunId}`);
        assert.equal(res.status, 200);
        assert.deepEqual(
          Object.keys(body).sort(),
          ['dateHeaders', 'issuesSummary', 'parts', 'run', 'week']
        );
        assert.equal(body.week, 'BU');
        assert.ok(body.parts.length > 0);

        body.parts.forEach((p) => {
          assert.equal(p.allocated + p.remainingQty, p.weeklyQty, `${p.spec} reconciles`);
        });
      });

      it('accepts a lowercase week and normalises it', async () => {
        const { res, body } = await json(`/allocation/week/bu?runId=${uploadedRunId}`);
        assert.equal(res.status, 200);
        assert.equal(body.week, 'BU');
      });

      it('returns an empty part list for a week the run does not contain', async () => {
        const { res, body } = await json(`/allocation/week/ZZ?runId=${uploadedRunId}`);
        assert.equal(res.status, 200);
        assert.deepEqual(body.parts, []);
        assert.deepEqual(body.dateHeaders, []);
      });

      it('400s for a malformed runId', async () => {
        const { res, body } = await json('/allocation/week/BU?runId=nope');
        assert.equal(res.status, 400);
        assert.equal(body.code, 'INVALID_RUN_ID');
      });
    });

    /* ------------------------------------------------- run isolation */

    describe('run isolation', () => {
      it('serves each run independently', async () => {
        const { body: list } = await json('/runs?pageSize=100');
        assert.ok(list.runs.length >= 2);
        const [newest, older] = list.runs;

        const { body: newestWeeks } = await json(`/allocation/weeks?runId=${newest.runId}`);
        const { body: olderWeeks } = await json(`/allocation/weeks?runId=${older.runId}`);

        assert.equal(newestWeeks.run.id, newest.runId);
        assert.equal(olderWeeks.run.id, older.runId);
        assert.notEqual(newestWeeks.run.id, olderWeeks.run.id);
      });

      it('defaults to the most recent run when no runId is given', async () => {
        const { body: list } = await json('/runs?pageSize=1');
        const { body: weeks } = await json('/allocation/weeks');
        assert.equal(weeks.run.id, list.runs[0].runId);
      });

      it('keeps each run\'s parts separate', async () => {
        const { body: list } = await json('/runs?pageSize=100');
        const [newest, older] = list.runs;

        const { body: a } = await json(`/allocation/week/BU?runId=${newest.runId}`);
        const { body: b } = await json(`/allocation/week/BU?runId=${older.runId}`);

        const idsA = new Set(a.parts.map((p) => p.jobId));
        const idsB = new Set(b.parts.map((p) => p.jobId));
        const shared = [...idsA].filter((id) => idsB.has(id));
        assert.equal(shared.length, 0, 'no job document is shared between runs');
      });
    });

    /* ------------------------------------------------------ error contract */

    describe('error contract', () => {
      it('uses one shape for every failure', async () => {
        const cases = [
          { path: '/runs/not-valid', status: 400, code: 'INVALID_RUN_ID' },
          { path: '/runs/0123456789abcdef01234567', status: 404, code: 'RUN_NOT_FOUND' },
          { path: '/allocation/nope', status: 404, code: 'NOT_FOUND' }
        ];

        for (const expected of cases) {
          const { res, body } = await json(expected.path);
          assert.equal(res.status, expected.status, expected.path);
          assert.equal(body.code, expected.code, expected.path);
          assert.deepEqual(Object.keys(body).sort(), ['code', 'error', 'requestId'], expected.path);
          assert.equal(typeof body.error, 'string');
          assert.match(body.requestId, /^[0-9a-f]{12}$/);
        }
      });

      it('never leaks internals in an error body', async () => {
        const { body } = await json('/runs/not-valid');
        const serialised = JSON.stringify(body);
        assert.ok(!/at \w+ \(/.test(serialised), 'no stack frames');
        assert.ok(!/mongodb:\/\//.test(serialised), 'no connection string');
        assert.ok(!/node_modules/.test(serialised), 'no internal paths');
      });
    });
  }
);
