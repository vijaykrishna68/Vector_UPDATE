'use strict';

const { asyncHandler } = require('../middleware/errors');
const workbookService = require('../services/workbook.service');
const { persistRun } = require('../services/runPersistence.service');

/**
 * POST /upload — process a workbook and return it.
 *
 * Order matters: the run is persisted BEFORE the response is serialised, so a
 * client that receives a 200 and an X-Run-Id can rely on that run being complete
 * and readable.
 */
const uploadWorkbook = asyncHandler(async (req, res) => {
  const workbook = workbookService.readWorkbook(req.file.buffer);
  const { engine, result } = workbookService.allocate(workbook);

  const { run, usedTransaction } = await persistRun({
    runResult: result,
    lineCapacity: engine.LINE_CAPACITY,
    sourceFilename: workbookService.safeSourceFilename(req.file.originalname)
  });

  if (!usedTransaction) {
    // Recorded once per upload so operators can see which guarantee was in play.
    console.info(
      `[${req.id}] run ${run._id} persisted without a transaction (standalone deployment); ` +
        'two-phase status guard applied'
    );
  }

  const outputBuffer = workbookService.writeWorkbook(workbook);
  const downloadName = workbookService.safeAttachmentFilename(workbookService.generateOutputFilename());

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${downloadName}"`);
  res.setHeader('X-Output-Filename', downloadName);
  res.setHeader('X-Run-Id', String(run._id));
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).send(outputBuffer);
});

module.exports = { uploadWorkbook };
