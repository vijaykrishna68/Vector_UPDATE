'use strict';

const { asyncHandler } = require('../middleware/errors');
const runQuery = require('../services/runQuery.service');

/** Planning-run history: lightweight metadata, newest first. */
const listRuns = asyncHandler(async (req, res) => {
  const result = await runQuery.listRuns({ page: req.query.page, pageSize: req.query.pageSize });
  return res.json(result);
});

/** One run's metadata plus its week summaries. */
const getRun = asyncHandler(async (req, res) => {
  const run = await runQuery.getRun(req.params.runId);
  return res.json(run);
});

/** Full diagnostics for a run, paginated and filterable. */
const getRunIssues = asyncHandler(async (req, res) => {
  const result = await runQuery.getRunIssues(req.params.runId, {
    page: req.query.page,
    pageSize: req.query.pageSize,
    code: req.query.code,
    week: req.query.week ? String(req.query.week).toUpperCase() : undefined
  });
  return res.json(result);
});

module.exports = { listRuns, getRun, getRunIssues };
