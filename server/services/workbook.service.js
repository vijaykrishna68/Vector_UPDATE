'use strict';

/**
 * Workbook processing: read the upload, run the allocation engine, serialise the
 * result. The engine itself stays untouched and independently testable — this
 * layer only orchestrates it and maps failures to client-safe errors.
 */

const XLSX = require('xlsx');
const AllocationEngine = require('../allocation.js');
const { AppError } = require('../middleware/errors');

/** Parse an uploaded buffer into a workbook. */
function readWorkbook(buffer) {
  try {
    return XLSX.read(buffer, { type: 'buffer' });
  } catch (err) {
    throw new AppError(
      400,
      'UNREADABLE_WORKBOOK',
      'The workbook could not be read. It may be corrupt or password-protected.',
      err.message
    );
  }
}

/**
 * Run the allocation engine over a workbook, mutating it with the allocation
 * results. A layout the engine cannot handle is the client's input problem, so it
 * maps to 422 rather than a 500.
 */
function allocate(workbook) {
  const engine = new AllocationEngine();
  try {
    return { engine, result: engine.run(workbook) };
  } catch (err) {
    throw new AppError(
      422,
      'UNSUPPORTED_WORKBOOK_LAYOUT',
      'The workbook does not match the expected production schedule layout.',
      err.message
    );
  }
}

/** Serialise the mutated workbook for download. */
function writeWorkbook(workbook) {
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
}

function generateOutputFilename() {
  return new AllocationEngine().generateOutputFilename();
}

/** Strip path separators and control characters from a Content-Disposition name. */
function safeAttachmentFilename(name) {
  const raw = String(name || 'output.xlsx');
  const cleaned = raw.replace(/[\r\n\\/]/g, '_').replace(/\.\.+/g, '_');
  return cleaned || 'output.xlsx';
}

/** Sanitised original upload name, stored so a run can be identified later. */
function safeSourceFilename(name) {
  if (!name) return undefined;
  return String(name).replace(/[\r\n\\/]/g, '_').slice(0, 200);
}

module.exports = {
  readWorkbook,
  allocate,
  writeWorkbook,
  generateOutputFilename,
  safeAttachmentFilename,
  safeSourceFilename
};
