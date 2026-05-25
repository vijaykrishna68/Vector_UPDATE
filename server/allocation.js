const XLSX = require('xlsx');

// Helper: convert column letter to zero-based index
function colLetterToIndex(letter) {
  let col = 0;
  for (let i = 0; i < letter.length; i++) {
    col = col * 26 + (letter.charCodeAt(i) - 64);
  }
  return col - 1; // zero-based
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

class AllocationEngine {
  constructor() {
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

  // Detect sheet3 (actual working days summary) by presence of I4/I5/I6
  detectSheet3(workbook, sheet1Name) {
    for (const name of workbook.SheetNames) {
      if (name === sheet1Name) continue;
      const sheet = workbook.Sheets[name];
      if (sheet['I4'] || sheet['I5'] || sheet['I6']) return name;
    }
    return workbook.SheetNames.find(n => n !== sheet1Name) || sheet1Name;
  }

  // Parse parts for a given week column (BU/BV/BW)
  // Includes basic input validation and merges duplicates by (spec + week).
  parseWeekParts(sheet1, weekLetter, errors) {
    const range = XLSX.utils.decode_range(sheet1['!ref']);
    const weekColIdx = colLetterToIndex(weekLetter);
    const specColIdx = colLetterToIndex('B');
    const lineColIdx = colLetterToIndex('D');
    const cycleColIdx = colLetterToIndex('H');
    const compUnitColIdx = colLetterToIndex('J');
    const partsByKey = new Map();
    for (let r = 0; r <= range.e.r; r++) {
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

  // Allocate for one week
  allocateWeek(parts, dateCols, actualWorkingDays) {
    // Group weekly totals by original line
    const lineGroups = { 1: [], 2: [], 3: [], 4: [] };
    parts.forEach(p => {
      if (lineGroups[p.originalLine]) lineGroups[p.originalLine].push(p);
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

    // Track line minute usage per day
    const lineDayMinutes = [];// index day -> { line -> { used, remaining } }

    // Allocation pass
    for (let dayIdx = 0; dayIdx < Math.min(daysToUse, maxDaysAvailable); dayIdx++) {
      lineDayMinutes[dayIdx] = {};
      [1,2,3,4].forEach(l => lineDayMinutes[dayIdx][l] = {
        used: 0,
        remaining: dailyCapacityTemplate[l]
      });

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
      for (let dayIdx = daysToUse; dayIdx < maxDaysAvailable; dayIdx++) {
        let anyAllocated = false;
        lineDayMinutes[dayIdx] = {};
        [1,2,3,4].forEach(l => lineDayMinutes[dayIdx][l] = { used: 0, remaining: dailyCapacityTemplate[l] });
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

    return { parts, lineDayMinutes, dateCols };
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
    // Ensure sheet range covers date columns
    const range = XLSX.utils.decode_range(sheet1['!ref']);
    let maxRow = range.e.r;
    let maxCol = range.e.c;
    parts.forEach(p => {
      if (p.rowIndex > maxRow) maxRow = p.rowIndex;
      p.allocations.forEach(a => {
        const colIdx = dateCols[a.dayIndex].colIndex;
        if (colIdx > maxCol) maxCol = colIdx;
        const addr = XLSX.utils.encode_cell({ r: p.rowIndex, c: colIdx });
        const existing = sheet1[addr];
        const prev = existing && typeof existing.v === 'number' ? existing.v : 0;
        sheet1[addr] = { v: prev + a.qty, t: 'n' };
      });
    });
    sheet1['!ref'] = XLSX.utils.encode_range({ s: { r: range.s.r, c: range.s.c }, e: { r: maxRow, c: maxCol } });
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

    const weeksResults = [];
    this.WEEK_COLUMNS.forEach((wk, wkIdx) => {
      const parts = this.parseWeekParts(sheet1, wk.letter, errors);
      const { SUM, CountOfParts } = this.summarizeWeek(parts);
      let actualWorkingDaysRaw = SUM / this.FACTORY_DAILY_CAP;
      let actualWorkingDays = SUM === 0 ? 0 : Math.ceil(actualWorkingDaysRaw);
      this.writeActualWorkingDays(sheet3, wkIdx, actualWorkingDays);
      let allocation = null;
      if (SUM > 0) {
        allocation = this.allocateWeek(parts, dateCols, actualWorkingDays);
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

    return { sheet1Name, sheet3Name, weeksResults, errors };
  }

  buildLineTotals(parts) {
    const totals = { 1: { allocated: 0, remaining: 0 }, 2: { allocated: 0, remaining: 0 }, 3: { allocated: 0, remaining: 0 }, 4: { allocated: 0, remaining: 0 } };
    parts.forEach(p => {
      const allocated = p.allocations.reduce((s,a)=> s + a.qty, 0);
      if (totals[p.originalLine]) {
        totals[p.originalLine].allocated += allocated;
        totals[p.originalLine].remaining += p.remainingQty;
      }
    });
    return totals;
  }
}

module.exports = AllocationEngine;
