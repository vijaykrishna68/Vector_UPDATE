'use strict';

/**
 * Express app assembly.
 *
 * Separated from server.js so tests can mount the real app (with real routes,
 * middleware and error handling) without starting a listener or a process. The
 * only thing server.js still owns is the database connection and app.listen.
 */

const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');

const { AppError, requestId, apiNotFound, errorHandler } = require('./middleware/errors');
const { MAX_UPLOAD_BYTES } = require('./middleware/uploadValidation');
const { buildRouter } = require('./routes');

function parseCsvList(value) {
  return String(value || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

const CORS_EXPOSED_HEADERS = [
  'Content-Disposition',
  'X-Output-Filename',
  'X-Run-Id',
  'X-Request-Id'
];

function buildCors({ allowedOrigins, isProduction }) {
  if (allowedOrigins.length > 0) {
    return cors({
      exposedHeaders: CORS_EXPOSED_HEADERS,
      origin: (origin, cb) => {
        // No Origin header means a non-browser client or a same-origin request.
        if (!origin) return cb(null, true);
        if (allowedOrigins.includes(origin)) return cb(null, true);
        // Omit CORS headers rather than erroring: the browser blocks the response
        // and a policy decision does not become a 500.
        return cb(null, false);
      }
    });
  }

  if (isProduction) {
    // FAIL CLOSED: with no allowlist in production, permit only same-origin
    // requests (all the bundled SPA needs) instead of allowing every origin.
    console.warn(
      '⚠️  CORS_ORIGINS is not set. Running fail-closed: cross-origin requests are refused. ' +
        'Set CORS_ORIGINS to a comma-separated allowlist if a separate frontend origin needs access.'
    );
    return cors({
      exposedHeaders: CORS_EXPOSED_HEADERS,
      origin: (origin, cb) => cb(null, !origin)
    });
  }

  // Local development only, so `vite dev` on another port works.
  return cors({ exposedHeaders: CORS_EXPOSED_HEADERS });
}

function buildUploadRateLimit() {
  return rateLimit({
    windowMs: Number(process.env.UPLOAD_RATE_WINDOW_MS || 15 * 60 * 1000),
    limit: Number(process.env.UPLOAD_RATE_MAX || 20),
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    // 'trust proxy' is true for req.protocol behind Render's proxy, which
    // express-rate-limit flags as permissive. Accepted: this limiter is abuse
    // dampening, not an authorization control.
    validate: { trustProxy: false },
    handler: (req, res, next) =>
      next(
        new AppError(429, 'RATE_LIMITED', 'Too many uploads from this client. Please wait and try again.')
      )
  });
}

/**
 * @param {object} [options]
 * @param {boolean} [options.serveClient] Mount the built SPA and its fallback.
 *        Disabled in tests so a missing dist/ cannot affect API assertions.
 */
function createApp(options = {}) {
  const { serveClient = true } = options;

  const app = express();
  // Needed so req.protocol reflects https behind Render/Fly reverse proxies.
  app.set('trust proxy', true);
  app.disable('x-powered-by');

  const isProduction = process.env.NODE_ENV === 'production';
  const allowedOrigins = parseCsvList(process.env.CORS_ORIGINS || process.env.CORS_ORIGIN);

  app.use(requestId);
  app.use(
    helmet({
      crossOriginEmbedderPolicy: false,
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:'],
          fontSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          baseUri: ["'self'"]
        }
      }
    })
  );
  app.use(buildCors({ allowedOrigins, isProduction }));

  // JSON bodies here are tiny; uploads travel as multipart and are capped by multer.
  app.use(express.json({ limit: '100kb' }));

  app.use(buildRouter({ uploadRateLimit: buildUploadRateLimit() }));

  // JSON 404 for API paths, so a mistyped route does not fall through to the SPA.
  app.use(apiNotFound);

  if (serveClient) {
    const clientDistPath = path.join(__dirname, '../client/scheduler-fe/dist');
    app.use(express.static(clientDistPath));

    // SPA fallback (must be AFTER the API routes).
    app.get(/.*/, (req, res) => {
      res.sendFile(path.join(clientDistPath, 'index.html'), (err) => {
        if (err) res.status(404).send('Not found');
      });
    });
  }

  // Terminal error handler. Must be registered last.
  app.use(errorHandler);

  app.locals.config = { isProduction, allowedOrigins, maxUploadBytes: MAX_UPLOAD_BYTES };

  return app;
}

module.exports = { createApp, parseCsvList, CORS_EXPOSED_HEADERS };
