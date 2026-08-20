'use strict';

/**
 * HTTP surface: paths and methods only. Handlers live in controllers/.
 */

const express = require('express');

const allocationController = require('../controllers/allocation.controller');
const runsController = require('../controllers/runs.controller');
const healthController = require('../controllers/health.controller');
const uploadController = require('../controllers/upload.controller');
const { upload, validateUploadedFile } = require('../middleware/uploadValidation');

function buildRouter({ uploadRateLimit }) {
  const router = express.Router();

  // Operations
  router.get('/health', healthController.getHealth);
  router.get('/health/ready', healthController.getReadiness);

  // Upload
  router.post(
    '/upload',
    uploadRateLimit,
    upload.single('file'),
    validateUploadedFile,
    uploadController.uploadWorkbook
  );

  // Planning-run history
  router.get('/runs', runsController.listRuns);
  router.get('/runs/:runId', runsController.getRun);
  router.get('/runs/:runId/issues', runsController.getRunIssues);

  // Allocation views for the active run
  router.get('/allocation/weeks', allocationController.getWeeks);
  router.get('/allocation/week/:weekColumn', allocationController.getWeekDetail);

  return router;
}

module.exports = { buildRouter };
