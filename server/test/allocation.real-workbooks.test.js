'use strict';

/**
 * GOLDEN MASTER — real workbooks in uploads/ (LOCAL ONLY).
 *
 * ---------------------------------------------------------------------------
 * DATA HANDLING
 * ---------------------------------------------------------------------------
 * uploads/ holds real production planning workbooks containing customer names,
 * part numbers and volumes. Per the audit (finding F1) that data should not be
 * spread further, so this suite:
 *
 *   - reads uploads/ IN PLACE and never copies or rewrites those files
 *   - stores its golden as *.local.json, which .gitignore excludes
 *   - records only aggregate figures plus a sha256 digest of the detailed
 *     allocation, so no spec / part number is ever written to disk
 *
 * The digest still detects any change to per-part allocation, so this remains a
 * strict regression net over real-world input without persisting the input.
 *
 * The suite SKIPS cleanly when uploads/ is absent, so CI and fresh clones pass.
 * It also skips XLSX.write() entirely: writing one of these workbooks currently
 * takes ~67s (audit BUG-5), so the snapshot inspects the mutated in-memory
 * workbook instead.
 * ---------------------------------------------------------------------------
 */

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const XLSX = require('xlsx');

const AllocationEngine = require('../allocation.js');
const { assertMatchesGolden, digest } = require('../test-support/golden.js');
const { DATE_START_COL } = require('../test-support/workbook.js');

const UPLOADS_DIR = path.join(__dirname, '..', '..', 'uploads');

/** Distinct workbooks in uploads/, de-duplicated by content hash. */
function discoverWorkbooks() {
  if (!fs.existsSync(UPLOADS_DIR)) return [];
  const seen = new Map();
  for (const name of fs.readdirSync(UPLOADS_DIR).sort()) {
    const full = path.join(UPLOADS_DIR, name);
    if (!fs.statSync(full).isFile()) continue;
    const buf = fs.readFileSync(full);
    // Excel files are ZIP containers: verify the magic bytes before parsing.
    if (!(buf[0] === 0x50 && buf[1] === 0x4b)) continue;
    const hash = crypto.createHash('sha256').update(buf).digest('hex');
    if (!seen.has(hash)) seen.set(hash, { hash, buffer: buf, bytes: buf.length });
  }
  return [...seen.values()].sort((a, b) => a.hash.localeCompare(b.hash));
}

/**
 * Aggregate + digest summary of one workbook run.
 * Deliberately contains NO spec strings, part numbers or sheet content.
 */
function summarise(entry) {
  const workbook = XLSX.read(entry.buffer, { type: 'buffer' });
  const engine = new AllocationEngine();

  let result;
  try {
    result = engine.run(workbook);
  } catch (err) {
    // CURRENT BEHAVIOR: some real uploads are rejected outright. In production
    // this surfaces as HTTP 500 "Error processing Excel file". Recorded here so
    // the failure mode is pinned rather than hidden.
    return {
      sourceBytes: entry.bytes,
      sourceSha256: entry.hash.slice(0, 32),
      sheetCount: workbook.SheetNames.length,
      engineThrew: err.message
    };
  }

  const sheet1 = workbook.Sheets[result.sheet1Name];
  const sheet3 = workbook.Sheets[result.sheet3Name];

  const weeks = result.weeksResults.map((w) => {
    const allocated = w.parts.reduce((s, p) => s + p.allocations.reduce((a, b) => a + b.qty, 0), 0);
    const remaining = w.parts.reduce((s, p) => s + p.remainingQty, 0);

    const partsByLine = {};
    w.parts.forEach((p) => {
      const key = p.originalLine === null ? 'null' : String(p.originalLine);
      partsByLine[key] = (partsByLine[key] || 0) + 1;
    });

    // Canonical per-part detail, hashed rather than stored.
    const detail = w.parts
      .map((p) => [p.spec, p.originalLine, p.cycleTime, p.rowIndex, p.weeklyQty, p.remainingQty,
        p.allocations.map((a) => [a.dayIndex, a.lineUsed, a.qty])])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0])));

    return {
      weekColumn: w.weekColumn,
      SUM: w.SUM,
      CountOfParts: w.CountOfParts,
      actualWorkingDays: w.actualWorkingDays,
      partCount: w.parts.length,
      partsByOriginalLine: partsByLine,
      dateColumnCount: w.dateHeaders.length,
      daysOpened: w.lineDayMinutes.length,
      totalAllocated: allocated,
      totalRemaining: remaining,
      lineTotals: w.lineTotals,
      minutesByLine: w.lineDayMinutes.reduce((acc, d) => {
        Object.keys(d.lines || {}).forEach((ln) => {
          acc[ln] = acc[ln] || { used: 0, capacity: 0 };
          acc[ln].used += d.lines[ln].used;
          acc[ln].capacity += d.lines[ln].used + d.lines[ln].remaining;
        });
        return acc;
      }, {}),
      partDetailDigest: digest(detail)
    };
  });

  // Count populated cells in the date-column band, and digest their values.
  const range = XLSX.utils.decode_range(sheet1['!ref']);
  const dateCells = {};
  for (let r = range.s.r; r <= Math.min(range.e.r, 5000); r++) {
    for (let i = 0; i < (result.weeksResults[0].dateHeaders.length || 0); i++) {
      const addr = XLSX.utils.encode_cell({ r, c: DATE_START_COL + i });
      if (sheet1[addr] !== undefined) dateCells[addr] = sheet1[addr].v;
    }
  }

  return {
    sourceBytes: entry.bytes,
    sourceSha256: entry.hash.slice(0, 32),
    sheetCount: workbook.SheetNames.length,
    detectedSheet1Index: workbook.SheetNames.indexOf(result.sheet1Name),
    detectedSheet3Index: workbook.SheetNames.indexOf(result.sheet3Name),
    sheet1DeclaredRef: sheet1['!ref'],
    weeks,
    errorCountsByType: result.errors.reduce((acc, e) => {
      acc[e.type] = (acc[e.type] || 0) + 1;
      return acc;
    }, {}),
    errorMessageDigest: digest(result.errors.map((e) => `${e.type}|${e.week || ''}|${e.message}`).sort()),
    output: {
      dateCellCount: Object.keys(dateCells).length,
      dateCellDigest: digest(dateCells),
      sheet3WorkingDays: { I4: sheet3.I4 && sheet3.I4.v, I5: sheet3.I5 && sheet3.I5.v, I6: sheet3.I6 && sheet3.I6.v }
    }
  };
}

const workbooks = discoverWorkbooks();

describe('golden master: real workbooks in uploads/ (local only)', { skip: workbooks.length === 0 ? 'uploads/ not present — skipping real-workbook golden' : false }, () => {
  let snapshot;

  before(() => {
    snapshot = {
      workbookCount: workbooks.length,
      workbooks: workbooks.map(summarise)
    };
  });

  it('matches the recorded engine output for every distinct workbook', (t) => {
    const res = assertMatchesGolden('real-workbooks', snapshot, { local: true });
    if (res.created) t.diagnostic(`local baseline created at ${res.file} (gitignored)`);
    if (res.updated) t.diagnostic(`local baseline UPDATED at ${res.file}`);
    t.diagnostic(`${workbooks.length} distinct workbook(s) covered`);
  });

  it('records which real workbooks the engine currently rejects outright', (t) => {
    // KNOWN ISSUE (new, found while building this net): at least one real upload
    // throws instead of producing a schedule. Pinned as current behavior.
    const rejected = snapshot.workbooks.filter((wb) => wb.engineThrew);
    rejected.forEach((wb) => t.diagnostic(`rejected (${wb.sheetCount} sheets): ${wb.engineThrew}`));
    assert.equal(
      rejected.length,
      1,
      'exactly one of the bundled workbooks is currently rejected — investigate if this count changes'
    );
    assert.match(rejected[0].engineThrew, /No date columns starting at CU/);
  });

  it('confirms the audit findings still reproduce on real input', () => {
    // These are characterisation assertions over real data, kept coarse so they
    // do not encode any customer specifics.
    const parsed = snapshot.workbooks.filter((wb) => !wb.engineThrew);
    assert.ok(parsed.length > 0, 'at least one workbook parses');

    const anyNullLine = parsed.some((wb) =>
      wb.weeks.some((w) => (w.partsByOriginalLine.null || 0) > 0)
    );
    assert.ok(anyNullLine, 'BUG-2: real workbooks contain blank-line parts');

    parsed.forEach((wb) => {
      wb.weeks.forEach((w) => {
        const strandedByLine = [1, 2, 3, 4].reduce((s, ln) => s + ((w.lineTotals[ln] || {}).remaining || 0), 0);
        assert.equal(
          w.totalAllocated + w.totalRemaining,
          w.SUM,
          'allocated + remaining must always reconcile to SUM'
        );
        if ((w.partsByOriginalLine.null || 0) > 0 && w.totalRemaining > 0) {
          // BUG-7: stranded blank-line demand is invisible in per-line totals.
          assert.ok(w.totalRemaining >= strandedByLine);
        }
      });
    });
  });

  // FIXED in Phase 1 (was BUG-5). This test was inverted from its Phase 0 form,
  // which asserted the declared range still spanned ~1M rows.
  it('normalises the declared sheet range to the real data extent (BUG-5 fixed)', () => {
    snapshot.workbooks
      .filter((wb) => !wb.engineThrew)
      .forEach((wb) => {
        const range = XLSX.utils.decode_range(wb.sheet1DeclaredRef);
        assert.ok(
          range.e.r < 100000,
          `declared range must no longer span the full sheet, got ${wb.sheet1DeclaredRef}`
        );
        // Still large enough to hold the real data (~1434 rows in these files).
        assert.ok(range.e.r > 100, `range looks truncated: ${wb.sheet1DeclaredRef}`);
      });
  });

  it('serialises a real workbook in well under the pre-fix 67 seconds', () => {
    // Regression guard for BUG-5. Measured after the fix: ~0.5s (was ~67-75s).
    // The threshold is deliberately loose so slow CI hardware cannot flake it,
    // while still catching a reintroduction of the full-sheet range.
    const entry = workbooks.find((w) => {
      const wb = XLSX.read(w.buffer, { type: 'buffer' });
      try {
        new AllocationEngine().run(wb);
        return true;
      } catch {
        return false;
      }
    });
    assert.ok(entry, 'at least one workbook parses');

    const wb = XLSX.read(entry.buffer, { type: 'buffer' });
    new AllocationEngine().run(wb);

    const started = Date.now();
    const out = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const elapsed = Date.now() - started;

    assert.ok(out.length > 0, 'produced a non-empty workbook');
    assert.ok(elapsed < 15000, `XLSX.write took ${elapsed}ms, expected well under 15000ms`);
  });
});
