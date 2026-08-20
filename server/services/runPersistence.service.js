'use strict';

/**
 * Run persistence with an all-or-nothing guarantee.
 *
 * The audit found that a run was written in four independent steps (Run, Machines,
 * Jobs, Allocations, then a Run update). A failure part-way left a Run document
 * that the "latest run" lookup would happily serve, with missing children.
 *
 * MongoDB transactions would solve this, but they require a replica set. The local
 * and CI deployment here is a standalone mongod, which rejects them outright
 * (verified: IllegalOperation). Shipping code that only works on Atlas would be a
 * silent trap, so the guarantee is built on a two-phase status flag that works on
 * every topology, and a transaction is used ADDITIONALLY when the deployment
 * supports one:
 *
 *   1. create the Run as status:'pending' — readers filter it out
 *   2. write Machines, Jobs, Allocations
 *   3. promote the Run to status:'complete' with its summaries
 *   x. on any failure: mark 'failed' and delete the children
 *
 * A pending or failed run can never become the active run, so the outcome is
 * always "complete and usable" or "clearly not usable".
 */

const mongoose = require('mongoose');
const Run = require('../models/Run');
const Job = require('../models/Job');
const Machine = require('../models/Machine');
const Allocation = require('../models/Allocation');
const { RUN_STATUS } = require('../models/Run');
const { buildWeekSummaries, buildRunTotals, summariseIssues } = require('./summary.service');

/**
 * Run `work` inside a transaction when the deployment supports one, otherwise run
 * it directly. Returns { usedTransaction }.
 */
async function withOptionalTransaction(work) {
  let session = null;
  try {
    session = await mongoose.startSession();
  } catch {
    // Deployment has no session support at all.
    return { result: await work(null), usedTransaction: false };
  }

  try {
    session.startTransaction();
  } catch {
    await session.endSession();
    return { result: await work(null), usedTransaction: false };
  }

  try {
    const result = await work(session);
    await session.commitTransaction();
    return { result, usedTransaction: true };
  } catch (err) {
    try {
      await session.abortTransaction();
    } catch {
      // ignore: the transaction may never have started
    }

    // Standalone mongod rejects transactions with IllegalOperation. That is a
    // capability signal, not a failure of the work itself, so retry without one.
    const unsupported =
      err?.codeName === 'IllegalOperation' ||
      err?.code === 20 ||
      /Transaction numbers are only allowed|transactions are not supported/i.test(String(err?.message));

    if (unsupported) {
      return { result: await work(null), usedTransaction: false };
    }
    throw err;
  } finally {
    await session.endSession();
  }
}

/** Build the Job documents for a run, merging by spec + week as the engine does. */
function buildJobDocs(runId, weeksResults) {
  const jobByKey = new Map();

  (weeksResults || []).forEach((wr) => {
    const week = String(wr.weekColumn);
    (wr.parts || []).forEach((p) => {
      const spec = String(p.spec);
      const key = `${spec}__${week}`;
      const existing = jobByKey.get(key);
      if (existing) {
        existing.weeklyQty += Number(p.weeklyQty) || 0;
        return;
      }
      jobByKey.set(key, {
        runId,
        spec,
        weeklyQty: Number(p.weeklyQty) || 0,
        cycleTime: Number(p.cycleTime) || 0,
        week,
        originalLine:
          p.originalLine === null || p.originalLine === undefined ? null : Number(p.originalLine)
      });
    });
  });

  return [...jobByKey.values()];
}

function buildAllocationDocs(runId, weeksResults, jobIdByKey, machineIdByNumber) {
  const docs = [];

  (weeksResults || []).forEach((wr) => {
    const week = String(wr.weekColumn);
    (wr.parts || []).forEach((p) => {
      const jobId = jobIdByKey.get(`${String(p.spec)}__${week}`);
      if (!jobId) return;
      (p.allocations || []).forEach((a) => {
        const machineId = machineIdByNumber.get(String(a.lineUsed));
        if (!machineId) return;
        docs.push({
          runId,
          jobId,
          machineId,
          assignedQty: Number(a.qty) || 0,
          dayIndex: a.dayIndex
        });
      });
    });
  });

  return docs;
}

/** Attach jobIds to engine diagnostics so issues can be traced to a part. */
function buildRunErrors(engineErrors, jobIdByKey) {
  return (engineErrors || []).map((e) => {
    const week = e.week ? String(e.week) : undefined;
    const key = e.spec && week ? `${String(e.spec)}__${week}` : null;
    return {
      type: String(e.type),
      jobId: key ? jobIdByKey.get(key) : undefined,
      week,
      spec: e.spec ? String(e.spec) : undefined,
      overloadMinutes: e.overloadMinutes != null ? Number(e.overloadMinutes) : undefined,
      message: String(e.message)
    };
  });
}

/** Best-effort removal of a failed run's children. */
async function discardRunChildren(runId) {
  await Promise.allSettled([
    Allocation.deleteMany({ runId }),
    Job.deleteMany({ runId }),
    Machine.deleteMany({ runId })
  ]);
}

/**
 * Persist one allocation run.
 *
 * @param {object} params
 * @param {object} params.runResult   Engine output.
 * @param {object} params.lineCapacity Engine LINE_CAPACITY map.
 * @param {string} [params.sourceFilename]
 * @returns {Promise<{ run: object, usedTransaction: boolean }>}
 */
async function persistRun({ runResult, lineCapacity, sourceFilename }) {
  const weekSummariesBase = buildWeekSummaries(runResult.weeksResults);
  const totals = buildRunTotals(weekSummariesBase);
  const issueSummary = summariseIssues(runResult.errors);

  // Per-week issue summaries so week views report exact counts for their own week.
  const weekSummaries = weekSummariesBase.map((week) => ({
    ...week,
    issueSummary: summariseIssues(
      (runResult.errors || []).filter((e) => String(e.week || '') === String(week.weekColumn))
    )
  }));

  // Phase 1: reserve the run. 'pending' keeps it invisible to every reader.
  const run = await Run.create({
    createdAt: new Date(),
    status: RUN_STATUS.PENDING,
    sourceFilename
  });

  try {
    const { usedTransaction } = await withOptionalTransaction(async (session) => {
      const options = session ? { session } : {};

      // Phase 2: children.
      const machineDocs = [1, 2, 3, 4].map((ln) => ({
        runId: run._id,
        machineNumber: String(ln),
        capacity: Number(lineCapacity?.[ln]) || 0
      }));
      const machines = await Machine.insertMany(machineDocs, options);
      const machineIdByNumber = new Map(machines.map((m) => [String(m.machineNumber), m._id]));

      const jobs = await Job.insertMany(buildJobDocs(run._id, runResult.weeksResults), options);
      const jobIdByKey = new Map(jobs.map((j) => [`${j.spec}__${j.week}`, j._id]));

      const allocationDocs = buildAllocationDocs(
        run._id,
        runResult.weeksResults,
        jobIdByKey,
        machineIdByNumber
      );
      if (allocationDocs.length > 0) {
        // ordered:false parallelises thousands of inserts. Safe here because
        // Allocation has no unique index, so there is no duplicate-key case to
        // swallow; a genuine write failure still rejects.
        await Allocation.insertMany(allocationDocs, { ...options, ordered: false });
      }

      // Phase 3: promote. Only now does the run become visible to readers.
      await Run.updateOne(
        { _id: run._id },
        {
          $set: {
            status: RUN_STATUS.COMPLETE,
            completedAt: new Date(),
            totals,
            weekSummaries,
            issueSummary,
            issueCount: (runResult.errors || []).length,
            errors: buildRunErrors(runResult.errors, jobIdByKey)
          }
        },
        options
      );

      return true;
    });

    return { run, usedTransaction };
  } catch (err) {
    // Mark the run unusable and remove its children. Both are best-effort: even
    // if they fail, the run stays 'pending' and is therefore still invisible.
    try {
      await Run.updateOne(
        { _id: run._id },
        { $set: { status: RUN_STATUS.FAILED, failureReason: String(err?.message || err).slice(0, 500) } }
      );
    } catch (markErr) {
      console.error(`Could not mark run ${run._id} as failed:`, markErr.message);
    }
    await discardRunChildren(run._id);
    throw err;
  }
}

module.exports = {
  persistRun,
  withOptionalTransaction,
  buildJobDocs,
  buildAllocationDocs,
  buildRunErrors,
  discardRunChildren
};
