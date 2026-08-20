'use strict';

/**
 * Server-side upload validation.
 *
 * The client's `accept=".xlsx,.xls"` is a file-picker hint only — it is trivially
 * bypassed by any direct HTTP request. This adds the checks that actually hold:
 *
 *   1. size      — enforced by multer before the body is buffered
 *   2. extension — cheap reject in fileFilter, before reading the payload
 *   3. MIME type — advisory (browsers and proxies are inconsistent), so an
 *                  unknown/generic type is tolerated but a clearly wrong one is not
 *   4. signature — magic bytes, the check that actually proves the container type
 *
 * Deliberately NOT validated here: workbook semantics (sheets, columns, headers).
 * That stays the allocation engine's responsibility, as specified.
 *
 * Both .xlsx (ZIP) and .xls (OLE2) are accepted because the existing client
 * offers both; narrowing that would change what users can upload.
 */

const path = require('path');
const multer = require('multer');
const { AppError } = require('./errors');

const DEFAULT_MAX_BYTES = 25 * 1024 * 1024; // 25MB, unchanged from the original default
const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES || DEFAULT_MAX_BYTES);

// A valid workbook cannot be smaller than a minimal ZIP/OLE2 container.
const MIN_UPLOAD_BYTES = 64;

const ALLOWED_EXTENSIONS = new Set(['.xlsx', '.xls']);

const ALLOWED_MIME_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
  'application/vnd.ms-excel', // .xls
  'application/vnd.ms-excel.sheet.macroEnabled.12', // .xlsm, still readable
  // Generic types various browsers/proxies send instead of the specific one.
  'application/octet-stream',
  'application/zip',
  'application/x-zip-compressed',
  ''
]);

/**
 * Container signatures. The magic bytes prove the file really is what its
 * extension claims, which is what stops a renamed script or image getting
 * through to the parser.
 */
const SIGNATURES = [
  { label: 'ZIP (xlsx/xlsm)', bytes: [0x50, 0x4b, 0x03, 0x04] },
  { label: 'ZIP (empty archive)', bytes: [0x50, 0x4b, 0x05, 0x06] },
  { label: 'ZIP (spanned archive)', bytes: [0x50, 0x4b, 0x07, 0x08] },
  { label: 'OLE2 (legacy xls)', bytes: [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1] }
];

function matchesSignature(buffer) {
  return SIGNATURES.some(
    (sig) => buffer.length >= sig.bytes.length && sig.bytes.every((b, i) => buffer[i] === b)
  );
}

/** Cheap pre-buffer rejection on extension and obviously-wrong MIME type. */
function fileFilter(req, file, cb) {
  const ext = path.extname(file.originalname || '').toLowerCase();

  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return cb(
      new AppError(
        415,
        'UNSUPPORTED_FILE_TYPE',
        'Only Excel workbooks (.xlsx or .xls) can be uploaded.',
        { extension: ext || '(none)', originalname: file.originalname }
      )
    );
  }

  const mime = String(file.mimetype || '').toLowerCase();
  if (!ALLOWED_MIME_TYPES.has(mime)) {
    return cb(
      new AppError(
        415,
        'UNSUPPORTED_FILE_TYPE',
        'Only Excel workbooks (.xlsx or .xls) can be uploaded.',
        { mimetype: mime }
      )
    );
  }

  return cb(null, true);
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_UPLOAD_BYTES,
    files: 1,
    parts: 12
  },
  fileFilter
});

/**
 * Post-upload checks: presence, minimum size, and container signature.
 * Runs after multer has buffered the file.
 */
function validateUploadedFile(req, res, next) {
  const file = req.file;

  if (!file || !file.buffer) {
    return next(
      new AppError(400, 'NO_FILE', 'No file was uploaded. Attach the workbook using the field name "file".')
    );
  }

  if (file.buffer.length < MIN_UPLOAD_BYTES) {
    return next(
      new AppError(400, 'FILE_EMPTY', 'The uploaded file is empty or truncated.', { bytes: file.buffer.length })
    );
  }

  if (!matchesSignature(file.buffer)) {
    return next(
      new AppError(
        415,
        'NOT_AN_EXCEL_FILE',
        'The uploaded file is not a valid Excel workbook. Re-save it as .xlsx and try again.',
        { firstBytes: file.buffer.subarray(0, 8).toString('hex') }
      )
    );
  }

  return next();
}

module.exports = {
  upload,
  validateUploadedFile,
  matchesSignature,
  MAX_UPLOAD_BYTES,
  ALLOWED_EXTENSIONS,
  ALLOWED_MIME_TYPES
};
