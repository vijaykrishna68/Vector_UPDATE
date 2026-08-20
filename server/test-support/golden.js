'use strict';

/**
 * Minimal golden-master ("snapshot") helper.
 *
 * Node 20 has no built-in snapshot support (--experimental-test-snapshots is
 * Node 22+), so this implements the same idea with a stable JSON encoding:
 *
 *   - object keys are sorted, so key ordering can never cause a false failure
 *   - a missing golden file is written on first run and reported, not silently passed
 *   - UPDATE_GOLDEN=1 rewrites goldens deliberately (`npm run test:update-golden`)
 *
 * A golden mismatch means engine behavior changed. During the safety-net phase
 * that should only ever happen on purpose.
 */

const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const crypto = require('crypto');

const GOLDEN_DIR = path.join(__dirname, '..', 'test', '__golden__');
const SHOULD_UPDATE = process.env.UPDATE_GOLDEN === '1';

/** JSON.stringify with deterministically sorted object keys. */
function stableStringify(value, indent = 2) {
  const seen = new WeakSet();
  const normalize = (v) => {
    if (v === null || typeof v !== 'object') {
      return typeof v === 'number' && !Number.isFinite(v) ? String(v) : v;
    }
    if (seen.has(v)) throw new Error('circular reference in golden payload');
    seen.add(v);
    if (Array.isArray(v)) return v.map(normalize);
    return Object.keys(v)
      .sort()
      .reduce((acc, k) => {
        if (v[k] !== undefined) acc[k] = normalize(v[k]);
        return acc;
      }, {});
  };
  return JSON.stringify(normalize(value), null, indent);
}

/** sha256 of the stable encoding — lets us detect change without storing the data. */
function digest(value) {
  return crypto.createHash('sha256').update(stableStringify(value, 0)).digest('hex').slice(0, 32);
}

/**
 * Normalise line endings before comparing.
 *
 * Golden files are always WRITTEN with '\n', but Git for Windows checks them out
 * with CRLF when core.autocrlf=true (its default). An exact string comparison
 * therefore failed on any fresh Windows clone even though the content was
 * identical — measured as an 854-byte difference on a 18,836-byte golden, exactly
 * the number of CR characters.
 *
 * This does NOT weaken the verification: line endings are not part of the golden's
 * semantic content, and every real difference (values, keys, ordering, additions,
 * removals) still fails the comparison. .gitattributes pins these files to LF as
 * well, so this is the second layer of the same guarantee.
 */
function normaliseEol(text) {
  return String(text).replace(/\r\n/g, '\n');
}

/**
 * Compare `actual` against the stored golden for `name`.
 * @param {string} name  Golden file basename (no extension).
 * @param {unknown} actual
 * @param {{ local?: boolean }} opts  local:true marks a gitignored golden
 *        (used for real-workbook goldens that must never be committed).
 */
function assertMatchesGolden(name, actual, opts = {}) {
  const file = path.join(GOLDEN_DIR, `${name}${opts.local ? '.local' : ''}.json`);
  const encoded = stableStringify(actual);

  fs.mkdirSync(GOLDEN_DIR, { recursive: true });

  if (SHOULD_UPDATE) {
    fs.writeFileSync(file, encoded + '\n', 'utf8');
    return { created: false, updated: true, file };
  }

  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, encoded + '\n', 'utf8');
    return { created: true, updated: false, file };
  }

  // Both sides are normalised identically, so the comparison stays deterministic
  // and depends only on content — never on how git checked the file out.
  const expected = normaliseEol(fs.readFileSync(file, 'utf8')).trim();
  const actualEncoded = normaliseEol(encoded).trim();
  assert.equal(
    actualEncoded,
    expected,
    `Golden mismatch for "${name}".\n` +
      `Engine behavior changed relative to ${path.relative(process.cwd(), file)}.\n` +
      `If this change is intentional, re-run with: npm run test:update-golden`
  );
  return { created: false, updated: false, file };
}

module.exports = { assertMatchesGolden, stableStringify, digest, GOLDEN_DIR, SHOULD_UPDATE };
