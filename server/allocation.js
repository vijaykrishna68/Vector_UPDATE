const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

class AllocationEngine {
  constructor() {
    this.FACTORY_DAILY_CAP = 3000;
    this.LINE_DAILY_CAP = 750;
    this.TOTAL_LINES = 4;
  }

  // Determine line eligibility based on specType and dashSize
  getEligibleLines(item) {
    const { specType, dashSize, lineHint } = item;
    
    // If lineHint is provided, respect it if valid
    if (lineHint && lineHint.match(/Line [1-4]/)) {
      return [lineHint];
    }

    // Apply business rules for line eligibility
    const eligibleLines = [];
    
    // Line 1: All specs except Non-Hybrid
    if (specType !== 'Non-Hybrid') {
      eligibleLines.push('Line 1');
    }
    
    // Line 2: All specs except Non-Hybrid and dashSize > 16
    if (specType !== 'Non-Hybrid' && (!dashSize || dashSize <= 16)) {
      eligibleLines.push('Line 2');
    }
    
    // Line 3: Only Non-Hybrid
    if (specType === 'Non-Hybrid') {
      eligibleLines.push('Line 3');
    }
    
    // Line 4: Same as Line 2
    if (specType !== 'Non-Hybrid' && (!dashSize || dashSize <= 16)) {
      eligibleLines.push('Line 4');
    }

    // If no eligible lines found, default to Line 1 and log warning
    if (eligibleLines.length === 0) {
      console.warn(`No eligible lines for item ${item.itemId}, defaulting to Line 1`);
      return ['Line 1'];
    }

    return eligibleLines;
  }

  // Calculate working days and average parts per day
  calculateWorkingDays(items) {
    const totalFeasibility = items.reduce((sum, item) => sum + (item.feasibility || 0), 0);
    const workingDays = Math.ceil(totalFeasibility / this.FACTORY_DAILY_CAP);
    const avgPartsPerDay = Math.ceil(totalFeasibility / workingDays);
    
    return { workingDays, avgPartsPerDay, totalFeasibility };
  }

  // Allocate items across lines and days
  allocateItems(items, lines, dayKeys) {
    const { workingDays, totalFeasibility } = this.calculateWorkingDays(items);
    
    // Initialize line utilization tracking
    const lineUtilization = {};
    const dailyAllocations = {};
    
    // Initialize daily allocations for each item
    items.forEach(item => {
      dailyAllocations[item.itemId] = new Array(10).fill(0);
      item.dailyAllocations = new Array(10).fill(0);
      item.lineAssignments = [];
    });

    // Initialize line utilization for each day
    dayKeys.forEach((day, dayIndex) => {
      lineUtilization[day] = {};
      lines.forEach(line => {
        if (line.date === day) {
          lineUtilization[day][line.lineName] = {
            plannedMinutes: 0,
            remainingMinutes: line.availableMinutes,
            efficiency: 0,
            plannedQty: 0,
            originalAvailableMinutes: line.availableMinutes
          };
        }
      });
    });

    // Sort items by feasibility (highest first) for allocation priority
    const sortedItems = [...items].sort((a, b) => (b.feasibility || 0) - (a.feasibility || 0));

    // Allocate each item
    for (const item of sortedItems) {
      if (!item.feasibility || item.feasibility <= 0) continue;

      const eligibleLines = this.getEligibleLines(item);
      let remainingQty = item.feasibility;
      let currentDayIndex = 0;

      // Distribute across days and lines
      while (remainingQty > 0 && currentDayIndex < dayKeys.length) {
        const currentDay = dayKeys[currentDayIndex];
        const dayUtilization = lineUtilization[currentDay];
        
        if (!dayUtilization) {
          currentDayIndex++;
          continue;
        }

        // Try to allocate to eligible lines for this day
        for (const lineName of eligibleLines) {
          if (remainingQty <= 0) break;
          
          const lineData = dayUtilization[lineName];
          if (!lineData) continue;

          // Calculate how much we can allocate to this line
          const maxQtyByLineCap = Math.min(remainingQty, this.LINE_DAILY_CAP - lineData.plannedQty);
          const plannedMinutes = maxQtyByLineCap * (item.cycleTime || 0);
          const maxQtyByMinutes = Math.floor(lineData.remainingMinutes / (item.cycleTime || 1));
          
          const allocatableQty = Math.min(maxQtyByLineCap, maxQtyByMinutes);
          
          if (allocatableQty > 0) {
            // Allocate to this line
            const actualMinutes = allocatableQty * (item.cycleTime || 0);
            
            lineData.plannedQty += allocatableQty;
            lineData.plannedMinutes += actualMinutes;
            lineData.remainingMinutes -= actualMinutes;
            lineData.efficiency = (lineData.plannedMinutes / lineData.originalAvailableMinutes) * 100;
            
            // Update item allocations
            dailyAllocations[item.itemId][currentDayIndex] += allocatableQty;
            item.dailyAllocations[currentDayIndex] += allocatableQty;
            
            // Add to line assignments
            item.lineAssignments.push({
              line: lineName,
              quantity: allocatableQty,
              minutesUsed: actualMinutes
            });
            
            remainingQty -= allocatableQty;
          }
        }
        
        currentDayIndex++;
      }
    }

    return {
      dailyAllocations,
      lineUtilization,
      workingDays,
      totalFeasibility
    };
  }

  // Write allocations back to Excel file
  writeAllocationsToExcel(filePath, items, dayKeys, outputPath) {
    try {
      const workbook = XLSX.readFile(filePath);
      const sheet2 = workbook.Sheets['SHEET 2'];
      
      // Get the range of the sheet to find BI-BR columns
      const range = XLSX.utils.decode_range(sheet2['!ref']);
      
      // Find BI-BR columns (columns 61-70, 0-indexed)
      const biColumn = 61; // BI column
      const brColumn = 70; // BR column
      
      // Update each item's daily allocations
      items.forEach((item, itemIndex) => {
        // Find the row for this item (assuming items start from row 2, 0-indexed)
        const rowIndex = itemIndex + 1; // +1 for header row
        
        // Write daily allocations to BI-BR columns
        for (let dayIndex = 0; dayIndex < 10; dayIndex++) {
          const columnIndex = biColumn + dayIndex;
          const cellAddress = XLSX.utils.encode_cell({ r: rowIndex, c: columnIndex });
          const qty = item.dailyAllocations[dayIndex] || 0;
          sheet2[cellAddress] = { v: qty, t: 'n' };
        }
      });
      
      // Save the modified workbook
      XLSX.writeFile(workbook, outputPath);
      console.log(`✅ Allocations written to ${outputPath}`);
      
    } catch (error) {
      console.error('❌ Error writing allocations to Excel:', error);
      throw error;
    }
  }

  // Generate output filename with timestamp
  generateOutputFilename() {
    const now = new Date();
    const timestamp = now.toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '_');
    return `Allocated_${timestamp}.xlsx`;
  }
}

module.exports = AllocationEngine;
