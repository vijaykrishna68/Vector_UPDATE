'use strict';

/**
 * Integration tests for the Phase 1 upload validation and error handling.
 *
 * These drive a real Express app over real HTTP (no DB required) so the middleware
 * is exercised the way production does: multer limits, fileFilter, magic-byte
 * checks, and the terminal error handler's response shape.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const XLSX = require('xlsx');

const { AppError, requestId, asyncHandler, apiNotFound, errorHandler } = require('../middleware/errors');
const { upload, validateUploadedFile, matchesSignature, MAX_UPLOAD_BYTES } = require('../middleware/uploadValidation');

/** A small but genuinely valid .xlsx buffer. */
function validXlsxBuffer() {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['a', 1], ['b', 2]]), 'S1');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

let server;
let baseUrl;

before(async () => {
  const app = express();
  app.use(requestId);
  app.use(express.json({ limit: '100kb' }));

  app.post('/upload', upload.single('file'), validateUploadedFile, (req, res) => {
    res.json({ ok: true, bytes: req.file.buffer.length });
  });

  // Route that throws an unexpected (non-AppError) failure.
  app.get('/boom', asyncHandler(async () => {
    throw new Error('INTERNAL SECRET: connection string mongodb://user:pw@host/db');
  }));

  app.get('/allocation/weeks', (req, res) => res.json({ allocations: [], errors: [] }));

  app.use(apiNotFound);
  app.use(errorHandler);

  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
});

async function postFile({ buffer, filename, type }) {
  const form = new FormData();
  if (buffer) {
    form.append('file', new Blob([buffer], { type: type || 'application/octet-stream' }), filename);
  }
  const res = await fetch(`${baseUrl}/upload`, { method: 'POST', body: form });
  const body = await res.json().catch(() => ({}));
  return { res, body };
}

describe('magic-byte signature check', () => {
  it('accepts a ZIP container (xlsx)', () => {
    assert.equal(matchesSignature(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00])), true);
  });

  it('accepts an OLE2 container (legacy xls)', () => {
    assert.equal(matchesSignature(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])), true);
  });

  it('rejects a script, an image and plain text', () => {
    assert.equal(matchesSignature(Buffer.from('#!/bin/sh\necho hi')), false);
    assert.equal(matchesSignature(Buffer.from([0x89, 0x50, 0x4e, 0x47])), false, 'PNG');
    assert.equal(matchesSignature(Buffer.from('spec,qty\nA,1')), false, 'CSV');
  });

  it('rejects a buffer shorter than any signature', () => {
    assert.equal(matchesSignature(Buffer.from([0x50, 0x4b])), false);
  });
});

describe('POST /upload validation', () => {
  it('accepts a genuine xlsx workbook', async () => {
    const { res, body } = await postFile({
      buffer: validXlsxBuffer(),
      filename: 'plan.xlsx',
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });
    assert.equal(res.status, 200);
    assert.equal(body.ok, true);
  });

  it('rejects a request with no file at all', async () => {
    const res = await fetch(`${baseUrl}/upload`, { method: 'POST', body: new FormData() });
    const body = await res.json();
    assert.equal(res.status, 400);
    assert.equal(body.code, 'NO_FILE');
  });

  it('rejects a disallowed extension before reading the payload', async () => {
    const { res, body } = await postFile({
      buffer: Buffer.from('#!/bin/sh\nrm -rf /'),
      filename: 'evil.sh',
      type: 'text/x-shellscript'
    });
    assert.equal(res.status, 415);
    assert.equal(body.code, 'UNSUPPORTED_FILE_TYPE');
  });

  it('rejects a non-Excel payload wearing an .xlsx name', async () => {
    // This is the case the client-side `accept` attribute cannot catch.
    // Padded past MIN_UPLOAD_BYTES so it reaches the signature check rather than
    // being caught earlier as truncated.
    const { res, body } = await postFile({
      buffer: Buffer.from('this is definitely not a workbook, '.repeat(8)),
      filename: 'disguised.xlsx',
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });
    assert.equal(res.status, 415);
    assert.equal(body.code, 'NOT_AN_EXCEL_FILE');
  });

  it('rejects a PNG renamed to .xlsx', async () => {
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(200)]);
    const { res, body } = await postFile({ buffer: png, filename: 'chart.xlsx' });
    assert.equal(res.status, 415);
    assert.equal(body.code, 'NOT_AN_EXCEL_FILE');
  });

  it('rejects a truncated file that only has the right first bytes', async () => {
    const { res, body } = await postFile({
      buffer: Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x01, 0x02]),
      filename: 'tiny.xlsx'
    });
    assert.equal(res.status, 400);
    assert.equal(body.code, 'FILE_EMPTY');
  });

  it('rejects a file over the configured size limit with 413', async () => {
    const oversized = Buffer.concat([
      Buffer.from([0x50, 0x4b, 0x03, 0x04]),
      Buffer.alloc(MAX_UPLOAD_BYTES + 1024)
    ]);
    const { res, body } = await postFile({ buffer: oversized, filename: 'huge.xlsx' });
    assert.equal(res.status, 413);
    assert.equal(body.code, 'FILE_TOO_LARGE');
  });

  it('accepts a legacy .xls OLE2 container', async () => {
    const ole = Buffer.concat([
      Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
      Buffer.alloc(512)
    ]);
    const { res } = await postFile({ buffer: ole, filename: 'legacy.xls', type: 'application/vnd.ms-excel' });
    assert.equal(res.status, 200, '.xls remains accepted, as the client offers it');
  });
});

describe('error response shape', () => {
  it('uses a consistent { error, code, requestId } shape', async () => {
    const { res, body } = await postFile({ buffer: Buffer.from('nope'), filename: 'x.txt' });
    assert.equal(res.status, 415);
    assert.deepEqual(Object.keys(body).sort(), ['code', 'error', 'requestId']);
    assert.equal(typeof body.error, 'string', 'error stays a string for the existing frontend');
    assert.equal(typeof body.code, 'string');
    assert.match(body.requestId, /^[0-9a-f]{12}$/);
  });

  it('echoes the request id in a header as well as the body', async () => {
    const { res, body } = await postFile({ buffer: Buffer.from('nope'), filename: 'x.txt' });
    assert.equal(res.headers.get('x-request-id'), body.requestId);
  });

  it('never leaks an internal exception message on a 500', async () => {
    const res = await fetch(`${baseUrl}/boom`);
    const body = await res.json();
    assert.equal(res.status, 500);
    assert.equal(body.code, 'INTERNAL_ERROR');
    assert.equal(body.error, 'An unexpected server error occurred.');

    const serialised = JSON.stringify(body);
    assert.ok(!serialised.includes('INTERNAL SECRET'), 'exception text must not reach the client');
    assert.ok(!serialised.includes('mongodb://'), 'connection string must not reach the client');
    assert.ok(!/\bat \w+/.test(serialised), 'no stack frames in the response');
  });

  it('returns JSON 404 for an unknown API path instead of the SPA shell', async () => {
    const res = await fetch(`${baseUrl}/allocation/does-not-exist`);
    const body = await res.json();
    assert.equal(res.status, 404);
    assert.equal(body.code, 'NOT_FOUND');
  });

  it('lets a browser navigation to an SPA route pass through, even on an API prefix', async () => {
    // /upload is both an API endpoint (POST) and a client route (GET). A document
    // request must reach the SPA fallback, or the upload screen 404s on refresh.
    const res = await fetch(`${baseUrl}/upload`, {
      headers: { accept: 'text/html,application/xhtml+xml' }
    });
    assert.equal(res.status, 404, 'no SPA is mounted in this test app');
    const contentType = res.headers.get('content-type') || '';
    assert.ok(!contentType.includes('application/json'), 'must not be claimed as an API 404');
  });

  it('still returns JSON 404 for a fetch/XHR call to an unknown API path', async () => {
    const res = await fetch(`${baseUrl}/allocation/nope`, { headers: { accept: '*/*' } });
    const body = await res.json();
    assert.equal(res.status, 404);
    assert.equal(body.code, 'NOT_FOUND');
  });

  it('leaves non-API paths for the SPA fallback to handle', async () => {
    // apiNotFound must not claim '/dashboard'; with no SPA mounted here it 404s
    // as HTML from Express's default handler, not as our JSON error.
    const res = await fetch(`${baseUrl}/dashboard`);
    assert.equal(res.status, 404);
    assert.ok(!(res.headers.get('content-type') || '').includes('application/json'));
  });

  it('keeps AppError status codes intact', () => {
    const err = new AppError(422, 'UNSUPPORTED_WORKBOOK_LAYOUT', 'safe message', 'internal detail');
    assert.equal(err.status, 422);
    assert.equal(err.isSafe, true);
    assert.equal(err.details, 'internal detail');
  });
});
