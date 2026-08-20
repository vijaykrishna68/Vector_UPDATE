const XLSX = require('xlsx');

// Helper: convert column letter to zero-based index
function colLetterToIndex(letter) {
  let col = 0;
  for (let i = 0; i < letter.length; i++) {
    col = col * 26 + (letter.charCodeAt(i) - 64);
  }
  return col - 1; // zero-based
}

// Helper: actual populated extent of a sheet, derived from its cell keys.
//
// PERF: planner workbooks routinely declare a '!ref' spanning the entire
// 1,048,576-row sheet (observed: "A2:DS1048576" while real data ends at row
// 1434). Serialising that declared range makes XLSX.write() walk ~1M empty
// rows, measured at 67s versus 0.47s for the true extent. Parsing pays the
// same cost. Returns null when the sheet holds no cells.
function getPopulatedExtent(sheet) {
  let minR = Infinity;
  let minC = Infinity;
  let maxR = -1;
  let maxC = -1;

  // Object.keys rather than for..in: own enumerable keys only, so a polluted
  // Object.prototype cannot inject a phantom "cell" (xlsx@0.18.5 carries a known
  // prototype-pollution advisory).
  for (const key of Object.keys(sheet)) {
    if (key.charCodeAt(0) === 33) continue; // skip '!ref', '!merges', ... metadata
    const cell = XLSX.utils.decode_cell(key);
    if (!Number.isFinite(cell.r) || !Number.isFinite(cell.c)) continue;
    if (cell.r < minR) minR = cell.r;
    if (cell.c < minC) minC = cell.c;
    if (cell.r > maxR) maxR = cell.r;
    if (cell.c > maxC) maxC = cell.c;
  }

  if (maxR < 0) return null;
  return { minR, minC, maxR, maxC };
}

// Helper: sequence of date columns starting at CU until blank
function collectDateColumns(sheet) {
  const startIdx = colLetterToIndex('CU');
  const range = XLSX.utils.decode_range(sheet['!ref']);
  const dateCols = [];
  const headerRow = 2; // zero-based row index for Excel row 3
  for (let c = startIdx; c <= range.e.c; c++) {
    const addr = XLSX.utils.encode_cell({ r: headerRow, c });
    const cell = sheet[addr];
    if (!cell || cell.v === undefined || String(cell.v).trim() === '') break; // stop at first blank
    dateCols.push({ colIndex: c, header: cell.v });
  }
  return dateCols;
}

// The working-days sheet identifies itself: column I of its header row carries
// this label, with the three week rows immediately beneath it (Excel rows 4/5/6,
// matching WEEK_COLUMNS.rowActualDays).
//
// Verified against every distinct workbook in uploads/: the label appears in
// column I row 3 of exactly ONE sheet per workbook —
//   "JUNE SUMMARY " (30-sheet production workbooks)
//   "SHEET 3"       (4-sheet prototype workbook, the one algorithm.txt describes)
// and in that sheet I4/I5/I6 already hold per-week working days.
const WORKING_DAYS_HEADER = 'Working Days As Per Plan';
const WORKING_DAYS_HEADER_ROW = 2; // zero-based -> Excel row 3
const WORKING_DAYS_COLUMN = 'I';

function normaliseLabel(value) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

class AllocationEngine {
  /**
   * @param {object} [options]
   * @param {string} [options.workingDaysSheetName] Explicit sheet name for the
   *   working-days summary. Overrides label-based identification; use it when a
   *   workbook does not carry the standard header. Also settable via the
   *   WORKING_DAYS_SHEET environment variable.
   */
  constructor(options = {}) {
    this.workingDaysSheetName =
      options.workingDaysSheetName || process.env.WORKING_DAYS_SHEET || null;
    this.MINUTES_PER_PERSON = 475;
    this.LINE_CAPACITY = { 1: 3 * 475, 2: 4 * 475, 3: 2 * 475, 4: 3 * 475 };
    this.WEEK_COLUMNS = [
      { letter: 'BU', rowActualDays: 3 }, // Excel row 4 (zero-based 3)
      { letter: 'BV', rowActualDays: 4 }, // row 5
      { letter: 'BW', rowActualDays: 5 }  // row 6
    ];
    this.TOLERANCE = 20; // ±20 parts per line
    this.FACTORY_DAILY_CAP = 3000; // used for actualWorkingDays calc
  }

  addError(errors, err) {
    if (!Array.isArray(errors)) return;
    if (!err || typeof err !== 'object') return;
    if (!err.type || !err.message) return;
    errors.push(err);
  }

  generateOutputFilename() {
    const now = new Date();
    const timestamp = now.toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '_');
    return `Allocated_${timestamp}.xlsx`;
  }

  // Detect sheet1 (weekly schedule) heuristically: choose first sheet having BU/BV/BW cells
  detectSheet1(workbook) {
    for (const name of workbook.SheetNames) {
      const sheet = workbook.Sheets[name];
      if (sheet['BU4'] || sheet['BV5'] || sheet['BW6']) return name;
    }
    return workbook.SheetNames[0];
  }

  /**
   * Identify the working-days summary sheet.
   *
   * Previously this returned the first non-Sheet1 sheet containing ANY of
   * I4/I5/I6. In the production workbook 17 sheets satisfy that, so it selected
   * "AXLE JUNE MPS" — a pivot-table output area — and silently overwrote three
   * of the planner's cells on every run.
   *
   * It now identifies the sheet by the workbook's own column header (see
   * WORKING_DAYS_HEADER), or by an explicitly configured sheet name. If the
   * sheet cannot be identified unambiguously it THROWS rather than guessing:
   * writing to the wrong sheet destroys planner data, so refusing to run is
   * strictly safer than picking a candidate.
   */
  detectSheet3(workbook, sheet1Name) {
    const names = workbook.SheetNames || [];

    // 1. Explicit configuration always wins.
    if (this.workingDaysSheetName) {
      if (!workbook.Sheets[this.workingDaysSheetName]) {
        throw new Error(
          `Configured working-days sheet "${this.workingDaysSheetName}" was not found in the workbook`
        );
      }
      return this.workingDaysSheetName;
    }

    // 2. Identify by the header label the workbook itself declares.
    const headerAddr = `${WORKING_DAYS_COLUMN}${WORKING_DAYS_HEADER_ROW + 1}`;
    const target = normaliseLabel(WORKING_DAYS_HEADER);
    const matches = names.filter((name) => {
      const sheet = workbook.Sheets[name];
      if (!sheet) return false;
      const cell = sheet[headerAddr];
      return cell && normaliseLabel(cell.v) === target;
    });

    if (matches.length === 1) return matches[0];

    if (matches.length > 1) {
      throw new Error(
        `Ambiguous working-days sheet: ${matches.length} sheets declare "${WORKING_DAYS_HEADER}" ` +
        `in ${headerAddr} (${matches.join(', ')}). Set WORKING_DAYS_SHEET to choose one.`
      );
    }

    throw new Error(
      `Could not identify the working-days sheet: no sheet declares "${WORKING_DAYS_HEADER}" in ${headerAddr}. ` +
      `Set WORKING_DAYS_SHEET to name it explicitly.`
    );
  }

  // Parse parts for a given week column (BU/BV/BW)
  // Includes basic input validation and merges duplicates by (spec + week).
  parseWeekParts(sheet1, weekLetter, errors, extent) {
    const range = XLSX.utils.decode_range(sheet1['!ref']);
    // PERF: stop at the last row that actually holds a cell. Rows beyond the
    // populated extent contain no column J, so the 'PC' filter already skipped
    // them — this changes only how many empty rows we walk, never which rows
    // are parsed.
    const populated = extent === undefined ? getPopulatedExtent(sheet1) : extent;
    const lastRow = populated ? Math.min(range.e.r, populated.maxR) : range.e.r;
    const weekColIdx = colLetterToIndex(weekLetter);
    const specColIdx = colLetterToIndex('B');
    const lineColIdx = colLetterToIndex('D');
    const cycleColIdx = colLetterToIndex('H');
    const compUnitColIdx = colLetterToIndex('J');
    const partsByKey = new Map();
    for (let r = 0; r <= lastRow; r++) {
      // Component Unit filter (Column J == 'PC')
      const compAddr = XLSX.utils.encode_cell({ r, c: compUnitColIdx });
      const compCell = sheet1[compAddr];
      if (!compCell || String(compCell.v).trim() !== 'PC') continue;

      const specCell = sheet1[XLSX.utils.encode_cell({ r, c: specColIdx })];
      const lineCell = sheet1[XLSX.utils.encode_cell({ r, c: lineColIdx })];
      const cycleCell = sheet1[XLSX.utils.encode_cell({ r, c: cycleColIdx })];
      const weekCell = sheet1[XLSX.utils.encode_cell({ r, c: weekColIdx })];

      const spec = specCell ? String(specCell.v).trim() : null;
      if (!spec) {
        this.addError(errors, {
          type: 'INVALID_INPUT',
          week: weekLetter,
          message: `Missing spec (required) at row ${r + 1}`
        });
        continue;
      }
      const originalLineRaw = lineCell ? lineCell.v : null;
      const originalLineNum = originalLineRaw === null || originalLineRaw === undefined ? null : Number(originalLineRaw);
      const originalLine = (originalLineNum === null || isNaN(originalLineNum)) ? null : originalLineNum;

      const cycleTime = cycleCell ? Number(cycleCell.v) : NaN;
      const weeklyQty = weekCell ? Number(weekCell.v) : 0;

      if (!Number.isFinite(cycleTime) || cycleTime <= 0) {
        this.addError(errors, {
          type: 'INVALID_INPUT',
          spec,
          week: weekLetter,
          message: `Invalid cycleTime (<= 0) for spec "${spec}" at row ${r + 1}`
        });
        continue;
      }

      if (!Number.isFinite(weeklyQty) || weeklyQty < 0) {
        this.addError(errors, {
          type: 'INVALID_INPUT',
          spec,
          week: weekLetter,
          message: `Invalid weeklyQty (negative) for spec "${spec}" at row ${r + 1}`
        });
        continue;
      }

      const key = `${spec}__${weekLetter}`;
      const existing = partsByKey.get(key);
      if (existing) {
        existing.weeklyQty += weeklyQty;
        existing.remainingQty += weeklyQty;
        if (existing.cycleTime !== cycleTime) {
          this.addError(errors, {
            type: 'DUPLICATE_MERGED',
            spec,
            week: weekLetter,
            message: `Merged duplicate (spec + week) for "${spec}". Kept cycleTime=${existing.cycleTime}, ignored cycleTime=${cycleTime} from row ${r + 1}`
          });
        }
        continue;
      }

      partsByKey.set(key, {
        rowIndex: r,
        spec,
        originalLine,
        cycleTime,
        weeklyQty,
        remainingQty: weeklyQty,
        allocations: [] // { dayIndex, qty, lineUsed }
      });
    }
    return Array.from(partsByKey.values());
  }

  // Compute SUM & CountOfParts
  summarizeWeek(parts) {
    const SUM = parts.reduce((sum, p) => sum + (p.weeklyQty || 0), 0);
    const CountOfParts = parts.filter(p => (p.weeklyQty || 0) > 0).length;
    return { SUM, CountOfParts };
  }

  /**
   * Which line a part is attributed to — the SINGLE source of truth used by both
   * allocation and reporting.
   *
   * A part with a usable line (1-4) keeps it. Anything else (blank column D, or
   * a non-numeric value such as "ALL") takes the first line of its fallback
   * chain. Allocation and aggregation previously disagreed here: allocateWeek
   * dropped such parts, buildLineTotals omitted them, and the API layer mapped
   * them to line 1, so the three views reported different totals.
   */
  resolveGroupLine(originalLine) {
    return Object.prototype.hasOwnProperty.call(this.LINE_CAPACITY, originalLine)
      ? Number(originalLine)
      : this.getFallbackChain(originalLine)[0];
  }

  // Fallback chains per original line
  getFallbackChain(originalLine) {
    switch (originalLine) {
      case 3: return [3];
      case 2: return [2, 4];
      case 4: return [4, 1];
      case 1: return [1];
      default: return [1];
    }
  }

  /**
   * Allocate one demand bucket (BU, BV or BW) against SHARED scheduling state.
   *
   * BUG-1 fix. BU/BV/BW are demand buckets, not separate production windows: the
   * planner confirmed that total demand for a part is BU + BV + BW, spread across
   * the production dates from CU onward. Previously each bucket was allocated as
   * an independent problem with its own capacity model starting at day 0, so the
   * same physical day could be filled three times over and every bucket wrote
   * from CU. On a capacity-bound example that produced 3,000 minutes of work on a
   * 1,425-minute day.
   *
   * Now all three buckets share one capacity model and one date cursor:
   *   - `shared.lineDayMinutes` is created once per run and never reset. A day is
   *     initialised the first time any bucket reaches it.
   *   - `shared.startDay` is where this bucket begins. It is the last day the
   *     previous bucket touched, so this bucket first consumes that day's
   *     leftover capacity and then flows forward into later dates.
   *
   * Line priority, fallback chains, capacity constants, the tolerance-driven
   * extension and the working-day formula are all unchanged.
   *
   * @param {object} shared { lineDayMinutes: [], startDay: number }
   */
  allocateWeek(parts, dateCols, actualWorkingDays, shared) {
    // Group weekly totals by original line.
    //
    // A part whose column D is blank or non-numeric has originalLine === null.
    // getFallbackChain() has always answered [1] for such a part, but the
    // grouping below never reached it, so the part joined no group and was
    // silently dropped: its demand still counted toward SUM (and therefore
    // working days) while receiving zero allocation. On the real workbook that
    // stranded 4,602 units in week BU alone.
    //
    // Grouping onto the first line of the part's own fallback chain routes it
    // through the existing default. No chain is redefined here.
    const lineGroups = { 1: [], 2: [], 3: [], 4: [] };
    parts.forEach(p => {
      const groupLine = this.resolveGroupLine(p.originalLine);
      if (lineGroups[groupLine]) lineGroups[groupLine].push(p);
    });

    const lineTotals = {};
    [1,2,3,4].forEach(l => {
      lineTotals[l] = lineGroups[l].reduce((s, p) => s + p.weeklyQty, 0);
    });

    const pqtyPerLine = {};
    [3,2,4,1].forEach(l => {
      if (actualWorkingDays > 0) {
        pqtyPerLine[l] = Math.ceil(lineTotals[l] / actualWorkingDays);
      } else {
        pqtyPerLine[l] = 0;
      }
    });

    const daysToUse = actualWorkingDays; // may extend later if leftover
    const maxDaysAvailable = dateCols.length;
    const dailyCapacityTemplate = { 1: this.LINE_CAPACITY[1], 2: this.LINE_CAPACITY[2], 3: this.LINE_CAPACITY[3], 4: this.LINE_CAPACITY[4] };

    // SHARED across BU/BV/BW — never reset between buckets.
    const state = shared || { lineDayMinutes: [], startDay: 0 };
    const lineDayMinutes = state.lineDayMinutes; // index day -> { line -> { used, remaining } }
    const startDay = Math.max(0, Number(state.startDay) || 0);

    // A day is opened once, by whichever bucket reaches it first.
    const openedHere = new Set();
    const openDay = (dayIdx) => {
      if (!lineDayMinutes[dayIdx]) {
        lineDayMinutes[dayIdx] = {};
        [1, 2, 3, 4].forEach(l => lineDayMinutes[dayIdx][l] = {
          used: 0,
          remaining: dailyCapacityTemplate[l]
        });
        openedHere.add(dayIdx);
      }
      return lineDayMinutes[dayIdx];
    };

    // This bucket's own consumption, so per-bucket reporting stays meaningful
    // even though the underlying capacity model is shared.
    const bucketMinutes = [];
    const recordBucketUse = (dayIdx, line, minutes) => {
      if (!bucketMinutes[dayIdx]) {
        bucketMinutes[dayIdx] = {};
        [1, 2, 3, 4].forEach(l => bucketMinutes[dayIdx][l] = { used: 0, remaining: 0 });
      }
      bucketMinutes[dayIdx][line].used += minutes;
    };

    let lastDayTouched = startDay;

    // Allocation pass — window begins at the shared cursor.
    const mainEnd = Math.min(startDay + daysToUse, maxDaysAvailable);
    for (let dayIdx = startDay; dayIdx < mainEnd; dayIdx++) {
      openDay(dayIdx);

      // Line priority order 3 -> 2 -> 4 -> 1
      for (const priorityLine of [3,2,4,1]) {
        let targetDaily = pqtyPerLine[priorityLine];
        if (targetDaily <= 0) continue;
        let allocatedThisLineToday = 0;
        const groupParts = lineGroups[priorityLine];
        if (!groupParts || groupParts.length === 0) continue;

        // Sequential part allocation
        for (const part of groupParts) {
          if (allocatedThisLineToday >= targetDaily) break;
          if (part.remainingQty <= 0) continue;
          let remainingDailyForLine = targetDaily - allocatedThisLineToday;
          let qtyNeededForPart = Math.min(part.remainingQty, remainingDailyForLine);
          if (qtyNeededForPart <= 0) continue;

          // Attempt allocation across fallback chain
          const chain = this.getFallbackChain(part.originalLine);
          let qtyToAllocate = qtyNeededForPart;
          for (const lineCandidate of chain) {
            if (qtyToAllocate <= 0) break;
            const lineCapacity = lineDayMinutes[dayIdx][lineCandidate];
            if (!lineCapacity || lineCapacity.remaining <= 0) continue;
            const maxByMinutes = Math.floor(lineCapacity.remaining / part.cycleTime);
            if (maxByMinutes <= 0) continue;
            const allocQty = Math.min(qtyToAllocate, maxByMinutes);
            if (allocQty > 0) {
              const minutesUsed = allocQty * part.cycleTime;
              lineCapacity.used += minutesUsed;
              lineCapacity.remaining -= minutesUsed;
              part.remainingQty -= allocQty;
              allocatedThisLineToday += allocQty; // counts toward original line's daily target
              qtyToAllocate -= allocQty;
              part.allocations.push({ dayIndex: dayIdx, qty: allocQty, lineUsed: lineCandidate });
              recordBucketUse(dayIdx, lineCandidate, minutesUsed);
              if (dayIdx > lastDayTouched) lastDayTouched = dayIdx;
            }
          }
        }
      }
    }

    // Extension into extra days if leftover beyond tolerance
    const leftoverTotals = {};
    [1,2,3,4].forEach(l => {
      leftoverTotals[l] = lineGroups[l].reduce((s, p) => s + p.remainingQty, 0);
    });
    const needExtension = [1,2,3,4].some(l => leftoverTotals[l] > this.TOLERANCE);
    if (needExtension) {
      // Extension continues past this bucket's own window, still on shared state.
      for (let dayIdx = mainEnd; dayIdx < maxDaysAvailable; dayIdx++) {
        let anyAllocated = false;
        openDay(dayIdx);
        for (const priorityLine of [3,2,4,1]) {
          const groupParts = lineGroups[priorityLine];
          if (!groupParts) continue;
          for (const part of groupParts) {
            if (part.remainingQty <= 0) continue;
            let qtyToAllocate = part.remainingQty;
            const chain = this.getFallbackChain(part.originalLine);
            for (const lineCandidate of chain) {
              if (qtyToAllocate <= 0) break;
              const lineCapacity = lineDayMinutes[dayIdx][lineCandidate];
              if (!lineCapacity || lineCapacity.remaining <= 0) continue;
              const maxByMinutes = Math.floor(lineCapacity.remaining / part.cycleTime);
              if (maxByMinutes <= 0) continue;
              const allocQty = Math.min(qtyToAllocate, maxByMinutes);
              if (allocQty > 0) {
                const minutesUsed = allocQty * part.cycleTime;
                lineCapacity.used += minutesUsed;
                lineCapacity.remaining -= minutesUsed;
                part.remainingQty -= allocQty;
                qtyToAllocate -= allocQty;
                part.allocations.push({ dayIndex: dayIdx, qty: allocQty, lineUsed: lineCandidate });
                recordBucketUse(dayIdx, lineCandidate, minutesUsed);
                if (dayIdx > lastDayTouched) lastDayTouched = dayIdx;
                anyAllocated = true;
              }
            }
          }
        }
        // Recompute leftover; break early if all lines within tolerance
        [1,2,3,4].forEach(l => {
          leftoverTotals[l] = lineGroups[l].reduce((s, p) => s + p.remainingQty, 0);
        });
        const stillNeed = [1,2,3,4].some(l => leftoverTotals[l] > this.TOLERANCE);
        if (!stillNeed || !anyAllocated) break;
      }
    }

    // Advance the shared cursor to the last day this bucket touched. The next
    // bucket resumes ON that day so it consumes the leftover capacity there
    // before moving forward.
    state.startDay = lastDayTouched;

    /*
     * Per-bucket view of the shared model.
     *
     * `used` is this bucket's own consumption, so summing usedMinutes across
     * BU/BV/BW gives the run's true total. A day's spare capacity is attributed
     * once, to whichever bucket opened that day; later buckets report 0 there.
     * Summed across buckets a day therefore reconciles to exactly its capacity:
     *
     *   opener: used_a + (capacity - totalUsed)
     *   others: used_b + 0, used_c + 0
     *   total : capacity
     *
     * Without this, three buckets sharing one model would each report the whole
     * cumulative figure and the dashboard would treble-count capacity.
     */
    const reported = [];
    for (let dayIdx = 0; dayIdx <= lastDayTouched; dayIdx++) {
      const mine = bucketMinutes[dayIdx];
      const openedByThisBucket = openedHere.has(dayIdx);
      if (!mine && !openedByThisBucket) {
        reported[dayIdx] = { 1: { used: 0, remaining: 0 }, 2: { used: 0, remaining: 0 }, 3: { used: 0, remaining: 0 }, 4: { used: 0, remaining: 0 } };
        continue;
      }
      reported[dayIdx] = {};
      [1, 2, 3, 4].forEach((l) => {
        reported[dayIdx][l] = {
          used: mine ? mine[l].used : 0,
          remaining: openedByThisBucket ? lineDayMinutes[dayIdx][l].remaining : 0
        };
      });
    }

    return { parts, lineDayMinutes: reported, sharedLineDayMinutes: lineDayMinutes, dateCols };
  }

  writeActualWorkingDays(sheet3, weekIndex, value) {
    const row = this.WEEK_COLUMNS[weekIndex].rowActualDays; // zero-based
    const addr = XLSX.utils.encode_cell({ r: row, c: colLetterToIndex('I') });
    sheet3[addr] = { v: value, t: 'n' };
    // Expand range if needed
    if (sheet3['!ref']) {
      const range = XLSX.utils.decode_range(sheet3['!ref']);
      if (row > range.e.r) range.e.r = row;
      if (colLetterToIndex('I') > range.e.c) range.e.c = colLetterToIndex('I');
      sheet3['!ref'] = XLSX.utils.encode_range(range);
    }
  }

  writeWeekAllocations(sheet1, parts, dateCols, startDateCount) {
    parts.forEach(p => {
      p.allocations.forEach(a => {
        const colIdx = dateCols[a.dayIndex].colIndex;
        const addr = XLSX.utils.encode_cell({ r: p.rowIndex, c: colIdx });
        const existing = sheet1[addr];
        const prev = existing && typeof existing.v === 'number' ? existing.v : 0;
        sheet1[addr] = { v: prev + a.qty, t: 'n' };
      });
    });
    // The declared range must cover every populated cell, including the cells
    // just written. Previously this grew the *declared* range, which inherited
    // the workbook's inflated 1M-row ref and carried it into the output.
    // Recomputing from the real cells after each write keeps the range exact and
    // is order-independent across the three week passes.
    this.normalizeSheetRange(sheet1);
  }

  // Shrink a sheet's declared '!ref' to the cells it actually contains.
  // Purely metadata: no cell is added, removed or altered. The declared start is
  // widened rather than narrowed so a cell can never fall outside the range.
  normalizeSheetRange(sheet) {
    if (!sheet) return;
    const extent = getPopulatedExtent(sheet);
    if (!extent) return;

    const declared = sheet['!ref'] ? XLSX.utils.decode_range(sheet['!ref']) : null;
    const startR = declared ? Math.min(declared.s.r, extent.minR) : extent.minR;
    const startC = declared ? Math.min(declared.s.c, extent.minC) : extent.minC;

    sheet['!ref'] = XLSX.utils.encode_range({
      s: { r: startR, c: startC },
      e: { r: extent.maxR, c: extent.maxC }
    });
  }

  run(workbook) {
    const errors = [];
    const sheet1Name = this.detectSheet1(workbook);
    const sheet3Name = this.detectSheet3(workbook, sheet1Name);
    const sheet1 = workbook.Sheets[sheet1Name];
    const sheet3 = workbook.Sheets[sheet3Name];
    if (!sheet1) throw new Error('Sheet1 not found');
    if (!sheet3) throw new Error('Sheet3 not found');

    const dateCols = collectDateColumns(sheet1);
    if (dateCols.length === 0) throw new Error('No date columns starting at CU in header row 3');

    // Computed once and reused by all three week passes. Writes only ever touch
    // rows that already exist, so the row bound stays valid across passes.
    const sheet1Extent = getPopulatedExtent(sheet1);

    // BUG-1 fix: one capacity model and one date cursor for the whole run.
    // BU, BV and BW are demand buckets against the same production calendar, so
    // capacity is never reset between them and each bucket resumes where the
    // previous one left off.
    const schedule = { lineDayMinutes: [], startDay: 0 };

    const weeksResults = [];
    this.WEEK_COLUMNS.forEach((wk, wkIdx) => {
      const parts = this.parseWeekParts(sheet1, wk.letter, errors, sheet1Extent);
      const { SUM, CountOfParts } = this.summarizeWeek(parts);
      let actualWorkingDaysRaw = SUM / this.FACTORY_DAILY_CAP;
      let actualWorkingDays = SUM === 0 ? 0 : Math.ceil(actualWorkingDaysRaw);
      this.writeActualWorkingDays(sheet3, wkIdx, actualWorkingDays);
      let allocation = null;
      if (SUM > 0) {
        allocation = this.allocateWeek(parts, dateCols, actualWorkingDays, schedule);
        this.writeWeekAllocations(sheet1, allocation.parts, dateCols, actualWorkingDays);

        // NO_CAPACITY: any remaining quantity after allocation.
        allocation.parts.forEach((p) => {
          if ((Number(p.remainingQty) || 0) > 0) {
            this.addError(errors, {
              type: 'NO_CAPACITY',
              spec: p.spec,
              week: wk.letter,
              message: `Remaining quantity could not be allocated for spec "${p.spec}" (remaining=${p.remainingQty})`
            });
          }
        });

        // OVERLOAD: total demand minutes exceeds total available minutes.
        const demandMinutes = allocation.parts.reduce(
          (s, p) => s + (Number(p.weeklyQty) || 0) * (Number(p.cycleTime) || 0),
          0
        );
        const capacityMinutes = (allocation.lineDayMinutes || []).reduce((daySum, day) => {
          const lines = day || {};
          return (
            daySum +
            Object.keys(lines).reduce((ls, k) => {
              const used = Number(lines[k]?.used) || 0;
              const remaining = Number(lines[k]?.remaining) || 0;
              return ls + used + remaining;
            }, 0)
          );
        }, 0);
        const overloadMinutes = demandMinutes - capacityMinutes;
        if (overloadMinutes > 0) {
          this.addError(errors, {
            type: 'OVERLOAD',
            week: wk.letter,
            overloadMinutes: Math.ceil(overloadMinutes),
            message: `Total demand exceeds total capacity by ${Math.ceil(overloadMinutes)} minutes for week ${wk.letter}`
          });
        }
      }
      weeksResults.push({
        weekColumn: wk.letter,
        SUM,
        CountOfParts,
        actualWorkingDays,
        dateHeaders: dateCols.map(dc => dc.header),
        lineDayMinutes: allocation ? allocation.lineDayMinutes.map((ld, idx) => ({ dayIndex: idx, lines: ld })) : [],
        lineTotals: allocation ? this.buildLineTotals(allocation.parts) : {},
        parts: allocation ? allocation.parts.map(p => ({
          spec: p.spec,
          originalLine: p.originalLine,
          weeklyQty: p.weeklyQty,
          remainingQty: p.remainingQty,
          allocations: p.allocations,
          rowIndex: p.rowIndex,
          cycleTime: p.cycleTime
        })) : []
      });
    });

    // Normalise both mutated sheets before returning. writeWeekAllocations
    // already does this for sheet1, but it is skipped entirely when a week has
    // no demand, so an inflated range would otherwise survive into the output.
    this.normalizeSheetRange(sheet1);
    this.normalizeSheetRange(sheet3);

    return { sheet1Name, sheet3Name, weeksResults, errors };
  }

  // Allocated/remaining per line. Attribution uses resolveGroupLine(), the same
  // rule allocateWeek() groups by, so totals always reconcile to SUM: a part can
  // no longer be allocated without appearing in any line's totals.
  buildLineTotals(parts) {
    const totals = { 1: { allocated: 0, remaining: 0 }, 2: { allocated: 0, remaining: 0 }, 3: { allocated: 0, remaining: 0 }, 4: { allocated: 0, remaining: 0 } };
    parts.forEach(p => {
      const allocated = p.allocations.reduce((s,a)=> s + a.qty, 0);
      const line = this.resolveGroupLine(p.originalLine);
      if (totals[line]) {
        totals[line].allocated += allocated;
        totals[line].remaining += p.remainingQty;
      }
    });
    return totals;
  }
}

module.exports = AllocationEngine;
