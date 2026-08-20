'use strict';

const { asyncHandler } = require('../middleware/errors');
const runQuery = require('../services/runQuery.service');

/**
 * Week summaries for the dashboard.
 *
 * Returns an issue SUMMARY rather than the full diagnostic list: a real workbook
 * produces ~2,800 diagnostics (~400KB). The full list is available, paginated,
 * from GET /runs/:runId/issues.
 */
const getWeeks = asyncHandler(async (req, res) => {
  const payload = await runQuery.getRunWeeks(req.query.runId);
  if (!payload) {
    return res.json({ run: null, weeks: [], summary: null, issuesSummary: [] });
  }
  return res.json(payload);
});

/** Part-level allocation detail for one week. */
const getWeekDetail = asyncHandler(async (req, res) => {
  const week = String(req.params.weekColumn).toUpperCase();
  const payload = await runQuery.getWeekDetail(req.query.runId, week);
  return res.json(payload);
});

module.exports = { getWeeks, getWeekDetail };
