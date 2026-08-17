'use strict';

/**
 * Read-side queries for planning runs.
 *
 * Every query filters to runs that are safe to read and uses a projection, so no
 * endpoint pulls a whole run document (which carries thousands of diagnostics)
 * when it only needs summary fields.
 */

const Run = require('../models/Run');
const Job = require('../models/Job');
const Allocation = require('../models/Allocation');
const { RUN_STATUS } = require('../models/Run');
const { AppError } = require('../middleware/errors');
const { deriveRunHealth, severityFor } = require('./summary.service');

const OBJECT_ID_PATTERN = /^[0-9a-fA-F]{24}$/;

/**
 * Runs a client may read.
 *
 * Backwards compatibility: runs written before the status field existed have no
 * `status` at all. They were complete when written, so they are still readable.
 * New partial writes are 'pending' and therefore excluded.
 */
const READABLE_RUN = {
  $or: [{ status: RUN_STATUS.COMPLETE }, { status: { $exists: false } }]
};

/** Projection for list rows — deliberately excludes errors and weekSummaries. */
const RUN_LIST_PROJECTION = 'createdAt completedAt status sourceFilename totals issueSummary issueCount';

function assertValidRunId(runId) {
  if (!OBJECT_ID_PATTERN.test(String(runId))) {
    throw new AppError(400, 'INVALID_RUN_ID', 'The runId parameter is not a valid identifier.');
  }
}

/**
 * Resolve which run to serve: the requested one when given and readable,
 * otherwise the most recent readable run. Returns null when none exists.
 */
async function resolveRunId(requestedRunId) {
  if (requestedRunId) {
    assertValidRunId(requestedRunId);
    const found = await Run.findOne({ _id: requestedRunId, ...READABLE_RUN }).select('_id').lean();
    if (found?._id) return found._id;
    // Fall through to the latest run rather than 404ing, matching prior behavior.
  }

  const latest = await Run.findOne(READABLE_RUN).sort({ createdAt: -1 }).select('_id').lean();
  return latest?._id || null;
}

function toRunSummary(run) {
  const totals = run.totals || {};
  const issueSummary = (run.issueSummary || []).map((g) => ({
    code: g.code,
    severity: g.severity || severityFor(g.code),
    count: g.count,
    affectedWeeks: g.affectedWeeks || []
  }));

  return {
    runId: String(run._id),
    createdAt: run.createdAt,
    completedAt: run.completedAt,
    status: run.status || RUN_STATUS.COMPLETE,
    sourceFilename: run.sourceFilename || null,
    weeks: (run.weekSummaries || []).map((w) => w.weekColumn),
    totals: {
      demand: totals.demand || 0,
      allocated: totals.allocated || 0,
      remaining: totals.remaining || 0
    },
    issueCount: run.issueCount || 0,
    issueSummary,
    health: deriveRunHealth(totals, issueSummary)
  };
}

/**
 * Paginated run history. Lightweight metadata only — no allocations, parts or
 * diagnostics.
 */
async function listRuns({ page = 1, pageSize = 20 } = {}) {
  const safePage = Math.max(1, Number(page) || 1);
  const safePageSize = Math.min(100, Math.max(1, Number(pageSize) || 20));

  const [runs, total] = await Promise.all([
    Run.find(READABLE_RUN)
      // weekSummaries is needed only for the week identifiers, so pull just those.
      .select(`${RUN_LIST_PROJECTION} weekSummaries.weekColumn`)
      .sort({ createdAt: -1 })
      .skip((safePage - 1) * safePageSize)
      .limit(safePageSize)
      .lean(),
    Run.countDocuments(READABLE_RUN)
  ]);

  return {
    runs: runs.map(toRunSummary),
    page: safePage,
    pageSize: safePageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / safePageSize))
  };
}

/** One run's metadata plus its week summaries. Still excludes the full error list. */
async function getRun(runId) {
  assertValidRunId(runId);
  const run = await Run.findOne({ _id: runId, ...READABLE_RUN })
    .select(`${RUN_LIST_PROJECTION} weekSummaries`)
    .lean();

  if (!run) throw new AppError(404, 'RUN_NOT_FOUND', 'That planning run does not exist.');

  return { ...toRunSummary(run), weekSummaries: run.weekSummaries || [] };
}

/**
 * Week summaries + issue SUMMARY for a run. This is the dashboard payload: it
 * carries no individual diagnostics.
 */
async function getRunWeeks(requestedRunId) {
  const runId = await resolveRunId(requestedRunId);
  if (!runId) return null;

  const run = await Run.findById(runId)
    .select(`${RUN_LIST_PROJECTION} weekSummaries`)
    .lean();
  if (!run) return null;

  const summary = toRunSummary(run);
  return {
    run: {
      id: String(run._id),
      createdAt: run.createdAt,
      status: run.status || RUN_STATUS.COMPLETE,
      sourceFilename: run.sourceFilename || null,
      health: summary.health
    },
    weeks: run.weekSummaries || [],
    summary: {
      demand: run.totals?.demand || 0,
      allocated: run.totals?.allocated || 0,
      remaining: run.totals?.remaining || 0,
      usedMinutes: run.totals?.usedMinutes || 0,
      capacityMinutes: run.totals?.capacityMinutes || 0,
      weekCount: (run.weekSummaries || []).length,
      lineCount: (run.weekSummaries?.[0]?.lines || []).length,
      issueCount: run.issueCount || 0
    },
    issuesSummary: summary.issueSummary.map((g) => ({
      ...g,
      examples: (run.issueSummary || []).find((x) => x.code === g.code)?.examples || []
    }))
  };
}

/**
 * Paginated diagnostics for a run, optionally filtered by code and week.
 *
 * Diagnostics live in an embedded array on the run, so filtering and slicing
 * happen in memory after a single document read. That is acceptable at the
 * observed scale (~2,800 per run); if runs ever carry materially more, they
 * should move to their own collection with a compound index.
 */
async function getRunIssues(runId, { page = 1, pageSize = 50, code, week } = {}) {
  assertValidRunId(runId);

  const run = await Run.findOne({ _id: runId, ...READABLE_RUN })
    .select('errors issueSummary issueCount')
    .lean();
  if (!run) throw new AppError(404, 'RUN_NOT_FOUND', 'That planning run does not exist.');

  const safePage = Math.max(1, Number(page) || 1);
  const safePageSize = Math.min(500, Math.max(1, Number(pageSize) || 50));

  let issues = run.errors || [];
  if (code) issues = issues.filter((e) => String(e.type) === String(code));
  if (week) issues = issues.filter((e) => String(e.week || '') === String(week));

  const total = issues.length;
  const start = (safePage - 1) * safePageSize;

  return {
    runId: String(runId),
    filters: { code: code || null, week: week || null },
    issues: issues.slice(start, start + safePageSize).map((e) => ({
      code: e.type,
      severity: severityFor(e.type),
      message: e.message,
      week: e.week || null,
      spec: e.spec || null,
      jobId: e.jobId ? String(e.jobId) : null,
      overloadMinutes: e.overloadMinutes ?? null
    })),
    page: safePage,
    pageSize: safePageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / safePageSize))
  };
}

/** Part-level allocation detail for one week of a run. */
async function getWeekDetail(requestedRunId, week) {
  const runId = await resolveRunId(requestedRunId);
  const empty = { run: null, week, dateHeaders: [], parts: [], issuesSummary: [] };
  if (!runId) return empty;

  const run = await Run.findById(runId)
    .select('createdAt status sourceFilename issueSummary weekSummaries')
    .lean();
  if (!run) return empty;

  const runInfo = {
    id: String(run._id),
    createdAt: run.createdAt,
    status: run.status || RUN_STATUS.COMPLETE,
    sourceFilename: run.sourceFilename || null
  };

  const summary = (run.weekSummaries || []).find((w) => String(w.weekColumn) === week);
  const dateHeaders = (summary && summary.dateHeaders) || [];

  // Counts scoped to this week. Falls back to filtering the run-level summary for
  // runs persisted before per-week summaries were stored.
  const issuesSummary = (
    summary?.issueSummary?.length
      ? summary.issueSummary
      : (run.issueSummary || []).filter(
          (g) => (g.affectedWeeks || []).length === 0 || (g.affectedWeeks || []).includes(week)
        )
  ).map((g) => ({
    code: g.code,
    severity: g.severity || severityFor(g.code),
    count: g.count,
    affectedWeeks: g.affectedWeeks || [],
    examples: g.examples || []
  }));

  const jobs = await Job.find({ runId, week })
    .select('_id spec weeklyQty cycleTime originalLine')
    .lean();

  if (jobs.length === 0) {
    return { run: runInfo, week, dateHeaders, parts: [], issuesSummary };
  }

  const allocs = await Allocation.find({ runId, jobId: { $in: jobs.map((j) => j._id) } })
    .populate('machineId', 'machineNumber')
    .lean();

  const byJob = new Map(jobs.map((j) => [String(j._id), []]));
  allocs.forEach((a) => {
    const bucket = byJob.get(String(a.jobId));
    if (bucket) {
      bucket.push({
        dayIndex: a.dayIndex,
        qty: a.assignedQty,
        line: Number(a.machineId?.machineNumber) || null
      });
    }
  });

  const parts = jobs
    .map((job) => {
      const partAllocations = (byJob.get(String(job._id)) || []).sort(
        (x, y) => x.dayIndex - y.dayIndex || (x.line || 0) - (y.line || 0)
      );
      const allocated = partAllocations.reduce((s, a) => s + (Number(a.qty) || 0), 0);
      const weeklyQty = Number(job.weeklyQty) || 0;
      return {
        jobId: String(job._id),
        spec: job.spec,
        originalLine: job.originalLine === undefined ? null : job.originalLine,
        cycleTime: Number(job.cycleTime) || 0,
        weeklyQty,
        allocated,
        // Same arithmetic the engine performs, kept server-side so the client
        // does not re-derive a business metric.
        remainingQty: Math.max(0, weeklyQty - allocated)
      , allocations: partAllocations };
    })
    .sort((a, b) => String(a.spec).localeCompare(String(b.spec)));

  return { run: runInfo, week, dateHeaders, parts, issuesSummary };
}

module.exports = {
  READABLE_RUN,
  assertValidRunId,
  resolveRunId,
  listRuns,
  getRun,
  getRunWeeks,
  getRunIssues,
  getWeekDetail,
  toRunSummary
};
