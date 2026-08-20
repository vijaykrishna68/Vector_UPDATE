'use strict';

/**
 * Small centralised error handling.
 *
 * Design constraints (Phase 1):
 *   - ONE consistent JSON error shape across every endpoint
 *   - the top-level `error` stays a STRING, because the existing frontend does
 *     `throw new Error(body?.error)`; changing it to an object would render
 *     "[object Object]" to users. `code` and `requestId` are added alongside.
 *   - client-facing messages are always author-written; raw exception text and
 *     stacks never leave the process
 *   - every error is logged server-side with a requestId the client also sees,
 *     so a user-reported failure can be traced to a log line
 *
 * Shape:
 *   { "error": "<safe message>", "code": "<STABLE_CODE>", "requestId": "<hex>" }
 */

const crypto = require('crypto');

/** An error whose message is safe to show a client. */
class AppError extends Error {
  /**
   * @param {number} status HTTP status to return.
   * @param {string} code   Stable machine-readable code.
   * @param {string} message Client-safe message.
   * @param {unknown} [details] Server-side only context; never serialised to the client.
   */
  constructor(status, code, message, details) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.isSafe = true;
  }
}

/** Attach a short request id used in both the log line and the response. */
function requestId(req, res, next) {
  req.id = crypto.randomBytes(6).toString('hex');
  res.setHeader('X-Request-Id', req.id);
  next();
}

/** Wrap an async handler so rejections reach the error middleware. */
function asyncHandler(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

/**
 * JSON 404 for unmatched API paths.
 *
 * Without this, the SPA catch-all returns index.html with status 200 for a
 * misspelled API route, which silently masks client bugs.
 *
 * It must NOT claim a browser navigation, because some API paths double as SPA
 * routes: the client routes /upload for its upload screen while the API only
 * defines POST /upload. A document request (Accept: text/html) therefore falls
 * through to the SPA, while an XHR/fetch call (Accept: * / *) still gets JSON.
 */
const API_PREFIXES = ['/upload', '/allocation', '/health'];

function wantsHtml(req) {
  return String(req.headers?.accept || '').includes('text/html');
}

function apiNotFound(req, res, next) {
  const isApiPath = API_PREFIXES.some((p) => req.path === p || req.path.startsWith(`${p}/`));
  if (!isApiPath) return next();
  if (req.method === 'GET' && wantsHtml(req)) return next(); // SPA navigation
  return next(new AppError(404, 'NOT_FOUND', `No API route matches ${req.method} ${req.path}`));
}

/** Translate multer's own errors into AppErrors with useful status codes. */
function normaliseMulterError(err) {
  if (err.name !== 'MulterError') return null;

  switch (err.code) {
    case 'LIMIT_FILE_SIZE':
      return new AppError(413, 'FILE_TOO_LARGE', 'The uploaded file is larger than the allowed limit.', err.code);
    case 'LIMIT_FILE_COUNT':
    case 'LIMIT_UNEXPECTED_FILE':
      return new AppError(400, 'UNEXPECTED_FILE', 'Upload exactly one file using the field name "file".', err.code);
    case 'LIMIT_FIELD_COUNT':
    case 'LIMIT_FIELD_KEY':
    case 'LIMIT_FIELD_VALUE':
    case 'LIMIT_PART_COUNT':
      return new AppError(400, 'MALFORMED_UPLOAD', 'The upload request was malformed.', err.code);
    default:
      return new AppError(400, 'UPLOAD_FAILED', 'The file could not be uploaded.', err.code);
  }
}

/**
 * Terminal error middleware. Must be registered last.
 * Express identifies it by its four-parameter signature, so `next` stays.
 */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const resolved = (err && err.isSafe ? err : normaliseMulterError(err || {})) || null;

  const status = resolved ? resolved.status : 500;
  const code = resolved ? resolved.code : 'INTERNAL_ERROR';
  // Anything unrecognised gets a generic message: never surface err.message.
  const message = resolved ? resolved.message : 'An unexpected server error occurred.';

  const id = req.id || 'no-request-id';

  // Full detail stays server-side.
  const logPrefix = `[${id}] ${req.method} ${req.originalUrl} -> ${status} ${code}`;
  if (status >= 500) {
    console.error(logPrefix, err && err.stack ? err.stack : err);
  } else {
    const detail = resolved && resolved.details !== undefined ? ` details=${JSON.stringify(resolved.details)}` : '';
    console.warn(`${logPrefix}${detail}`);
  }

  if (res.headersSent) return;

  res.status(status).json({ error: message, code, requestId: id });
}

module.exports = {
  AppError,
  requestId,
  asyncHandler,
  apiNotFound,
  errorHandler,
  normaliseMulterError
};
