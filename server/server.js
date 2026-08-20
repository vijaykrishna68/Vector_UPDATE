'use strict';

/**
 * Process entry point: environment, database connection, listener.
 * The Express app itself is assembled in app.js.
 */

// Local dev convenience. In production (Render/Fly/etc) the platform injects env vars.
try {
  require('dotenv').config();
} catch (_) {
  // dotenv is optional; ignore if not installed.
}

const { createApp } = require('./app');
const { connectDB } = require('./db');

const PORT = Number(process.env.PORT || 4000);

async function start() {
  await connectDB();

  const app = createApp();
  const { isProduction, allowedOrigins, maxUploadBytes } = app.locals.config;

  app.listen(PORT, () => {
    console.log(`server running on port ${PORT}`);
    console.log(
      `  env=${process.env.NODE_ENV || 'development'} maxUpload=${Math.round(maxUploadBytes / 1024 / 1024)}MB`
    );
    console.log(
      `  cors=${
        allowedOrigins.length > 0
          ? allowedOrigins.join(', ')
          : isProduction
            ? 'same-origin only (fail-closed)'
            : 'permissive (dev)'
      }`
    );
  });
}

start().catch((err) => {
  console.error('❌ Failed to start server:', err.message);
  process.exit(1);
});
