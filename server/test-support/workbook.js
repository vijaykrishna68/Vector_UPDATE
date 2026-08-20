'use strict';

/**
 * Sanitized fixture builder for AllocationEngine tests.
 *
 * IMPORTANT: every fixture here is fully synthetic. No real part numbers,
 * customer names, models or volumes from uploads/ are reproduced, so these
 * fixtures are safe to commit.
 *
 * The builder reproduces only the *layout* the engine depends on:
 *   Sheet1 : col B = spec, col D = line, col H = cycleTime, col J = component
 *            unit ('PC' filter), cols BU/BV/BW = weekly demand,
 *            row 3 = date headers starting at column CU.
 *   Sheet3 : col I rows 4/5/6 = "actual working days" write target.
 */

const XLSX = require('xlsx');

const DATE_START_COL = XLSX.utils.decode_col('CU'); // 98
const HEADER_ROW = 2; // zero-based -> Excel row 3

/** Sentinels written into Sheet3 I4:I6 so tests can prove they were overwritten. */
const SHEET3_SENTINELS = { I4: -101, I5: -102, I6: -103 };

/**
 * The header the real workbooks use to identify their working-days sheet, in
 * column I of the header row. Verified present in exactly one sheet of every
 * workbook in uploads/ ("JUNE SUMMARY " in production, "SHEET 3" in the
 * prototype). The engine identifies the sheet by this label.
 */
const WORKING_DAYS_HEADER = 'Working Days As Per Plan';

function toCell(value) {
  if (typeof value === 'number') return { v: value, t: 'n' };
  return { v: String(value), t: 's' };
}

/**
 * Build a worksheet from an { address: value } map.
 * `value === null | undefined` means "leave this cell truly blank".
 * endRow/endCol force the declared !ref to extend beyond the populated cells.
 */
function makeSheet(cells, opts = {}) {
  const sheet = {};
  let maxR = 0;
  let maxC = 0;

  for (const [addr, value] of Object.entries(cells)) {
    if (value === undefined || value === null) continue;
    const d = XLSX.utils.decode_cell(addr);
    sheet[addr] = toCell(value);
    if (d.r > maxR) maxR = d.r;
    if (d.c > maxC) maxC = d.c;
  }

  const endRow = opts.endRow !== undefined ? Math.max(opts.endRow, maxR) : maxR;
  const endCol = opts.endCol !== undefined ? Math.max(opts.endCol, maxC) : maxC;

  sheet['!ref'] = XLSX.utils.encode_range({
    s: { r: opts.startRow !== undefined ? opts.startRow : 0, c: opts.startCol !== undefined ? opts.startCol : 0 },
    e: { r: endRow, c: endCol }
  });
  return sheet;
}

/**
 * @param {object} spec
 * @param {Array<object>} spec.parts  Each: { row?, spec, line, cycleTime, bu, bv, bw, componentUnit }
 *        - `spec: null`          -> column B left blank (missing-spec case)
 *        - `line: null`          -> column D left blank (BUG-2 case)
 *        - `bu/bv/bw: undefined` -> written as numeric 0
 *        - `bu/bv/bw: null`      -> cell left truly blank
 *        - `componentUnit`       -> defaults to 'PC'
 * @param {number} spec.dateColumns How many date header columns from CU onward.
 * @param {Array<{name:string, cells:object}>} spec.decoySheets
 *        Sheets inserted between Sheet1 and Sheet3 (used for the BUG-3 fixture).
 */
function buildFixture(spec = {}) {
  const {
    parts = [],
    dateColumns = 3,
    dateHeaders = null,
    sheet1Name = 'WORKSHEET',
    sheet3Name = 'SUMMARY',
    firstPartRow = 10,
    decoySheets = []
  } = spec;

  const s1 = {};

  // Sheet1 detection marker. detectSheet1() looks for BU4 | BV5 | BW6.
  // Row 4 carries no 'PC' in column J, so parseWeekParts ignores it entirely.
  s1.BU4 = 0;

  // Date headers on row 3 starting at CU.
  for (let i = 0; i < dateColumns; i++) {
    const addr = XLSX.utils.encode_cell({ r: HEADER_ROW, c: DATE_START_COL + i });
    s1[addr] = dateHeaders ? dateHeaders[i] : `D${i + 1}`;
  }

  parts.forEach((p, idx) => {
    const row = p.row !== undefined ? p.row : firstPartRow + idx; // 1-based Excel row
    if (row === 4) throw new Error('fixture rows must not use Excel row 4 (reserved detection marker)');

    s1[`J${row}`] = p.componentUnit !== undefined ? p.componentUnit : 'PC';
    if (p.spec !== null && p.spec !== undefined) s1[`B${row}`] = p.spec;
    if (p.line !== null && p.line !== undefined) s1[`D${row}`] = p.line;
    if (p.cycleTime !== null && p.cycleTime !== undefined) s1[`H${row}`] = p.cycleTime;

    s1[`BU${row}`] = p.bu === null ? null : (p.bu === undefined ? 0 : p.bu);
    s1[`BV${row}`] = p.bv === null ? null : (p.bv === undefined ? 0 : p.bv);
    s1[`BW${row}`] = p.bw === null ? null : (p.bw === undefined ? 0 : p.bw);
  });

  // One blank column past the last date header so collectDateColumns() exercises
  // its documented "stop at first blank header" path.
  const sheet1 = makeSheet(s1, { endCol: DATE_START_COL + dateColumns });

  // The working-days sheet carries its identifying header in I3, exactly as the
  // real workbooks do, plus sentinel values in I4:I6 so tests can prove the
  // engine overwrote them.
  const sheet3Cells = { ...SHEET3_SENTINELS };
  if (spec.workingDaysHeader !== null) {
    sheet3Cells.I3 = spec.workingDaysHeader || WORKING_DAYS_HEADER;
  }
  const sheet3 = makeSheet(sheet3Cells);

  const SheetNames = [sheet1Name];
  const Sheets = { [sheet1Name]: sheet1 };

  for (const d of decoySheets) {
    SheetNames.push(d.name);
    Sheets[d.name] = makeSheet(d.cells);
  }

  SheetNames.push(sheet3Name);
  Sheets[sheet3Name] = sheet3;

  return { SheetNames, Sheets };
}

/** Address of the Nth date column (dayIndex 0 => CU) for a 1-based Excel row. */
function dateCellAddr(row1Based, dayIndex) {
  return XLSX.utils.encode_cell({ r: row1Based - 1, c: DATE_START_COL + dayIndex });
}

/** Raw value of a cell, or undefined when blank. */
function readCell(sheet, addr) {
  const c = sheet[addr];
  return c ? c.v : undefined;
}

/** Total quantity allocated to a part across every day and line. */
function totalAllocated(part) {
  return (part.allocations || []).reduce((s, a) => s + a.qty, 0);
}

/** Allocated quantity grouped by the line that actually ran it. */
function allocatedByLine(part) {
  const out = {};
  (part.allocations || []).forEach((a) => {
    out[a.lineUsed] = (out[a.lineUsed] || 0) + a.qty;
  });
  return out;
}

/** Find a parsed part by spec within a week result. */
function findPart(weekResult, specName) {
  return (weekResult.parts || []).find((p) => p.spec === specName);
}

/** Errors of a given type, optionally filtered to a week column. */
function errorsOfType(errors, type, week) {
  return errors.filter((e) => e.type === type && (week === undefined || e.week === week));
}

module.exports = {
  DATE_START_COL,
  HEADER_ROW,
  SHEET3_SENTINELS,
  WORKING_DAYS_HEADER,
  makeSheet,
  buildFixture,
  dateCellAddr,
  readCell,
  totalAllocated,
  allocatedByLine,
  findPart,
  errorsOfType
};
