const express = require('express');
const mongoose = require('mongoose');  
const multer  = require('multer') 
const cors = require('cors');
const fs = require('fs');
const path = require('path');
var XLSX = require("xlsx");

const Item = require('./models/Item.js');
const Line = require('./models/Line.js');
const Schedule = require('./models/Schedule.js');
const Part = require('./models/Part.js');
const LineDay = require('./models/LineDay.js');
const AllocationEngine = require('./allocation.js');

mongoose.connect('mongodb://127.0.0.1:27017/hoseSchedulerDB')
.then(() => console.log("✅ MongoDB connected"))
.catch(err => console.error("❌ Connection error:", err));


const app = express();
app.use(cors());
app.use(express.json());

app.get('/',(req,res)=>{
  res.send('server running')  
})



const storage = multer.diskStorage({
  destination: path.join(__dirname, '../uploads'),
});
const upload = multer({ storage });

app.post('/upload', upload.single('file'), async (req, res) => {
  try {
    const workbook = XLSX.readFile(req.file.path);
    const allocationEngine = new AllocationEngine();
    const runResult = allocationEngine.run(workbook);

    // Write updated workbook with allocations & actualWorkingDays
    const outputFileName = allocationEngine.generateOutputFilename();
    const outputPath = path.join(__dirname, '../output', outputFileName);
    const outputDir = path.join(__dirname, '../output');
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
    XLSX.writeFile(workbook, outputPath);

    // Build response
    const responseWeeks = runResult.weeksResults.map(w => ({
      weekColumn: w.weekColumn,
      SUM: w.SUM,
      CountOfParts: w.CountOfParts,
      actualWorkingDays: w.actualWorkingDays,
      lineTotals: w.lineTotals,
      parts: w.parts.slice(0, 25) // preview limit
    }));

    // Persist to Mongo (parts + line/day minutes)
    await saveNewAllocationToMongo(runResult);

    res.json({
      message: 'File processed with new week-based allocation',
      sheet1: runResult.sheet1Name,
      sheet3: runResult.sheet3Name,
      weeks: responseWeeks,
      outputFileName,
      outputPath
    });
  } catch (err) {
    console.error('❌ Error processing file (new allocator):', err);
    res.status(500).json({ error: 'Error processing Excel file', details: err.message });
  }
});

async function saveNewAllocationToMongo(runResult) {
  try {
    for (const w of runResult.weeksResults) {
      const headers = w.dateHeaders || [];
      // Upsert parts
      for (const p of w.parts) {
        try {
          // sanitize numeric fields to avoid NaN being written to Number schema fields
          const safeOriginalLine = (p.originalLine === null || p.originalLine === undefined || isNaN(Number(p.originalLine))) ? null : Number(p.originalLine);
          const safeCycleTime = (p.cycleTime === null || p.cycleTime === undefined || isNaN(Number(p.cycleTime))) ? 1 : Number(p.cycleTime);
          const safeWeeklyQty = (p.weeklyQty === null || p.weeklyQty === undefined || isNaN(Number(p.weeklyQty))) ? 0 : Number(p.weeklyQty);
          const safeRemaining = (p.remainingQty === null || p.remainingQty === undefined || isNaN(Number(p.remainingQty))) ? 0 : Number(p.remainingQty);

          const doc = {
            spec: p.spec,
            weekColumn: w.weekColumn,
            rowIndex: (p.rowIndex === null || p.rowIndex === undefined || isNaN(Number(p.rowIndex))) ? -1 : Number(p.rowIndex),
            originalLine: safeOriginalLine,
            cycleTime: safeCycleTime,
            weeklyQty: safeWeeklyQty,
            remainingQty: safeRemaining,
            allocations: (p.allocations || []).map(a => ({
              dayIndex: a.dayIndex,
              dateHeader: headers[a.dayIndex] != null ? String(headers[a.dayIndex]) : String(a.dayIndex),
              line: (a.lineUsed === null || a.lineUsed === undefined || isNaN(Number(a.lineUsed))) ? null : Number(a.lineUsed),
              qty: (a.qty === null || a.qty === undefined || isNaN(Number(a.qty))) ? 0 : Number(a.qty),
              minutes: ((a.qty || 0) * safeCycleTime)
            }))
          };
          await Part.findOneAndUpdate(
            { spec: doc.spec, weekColumn: doc.weekColumn, rowIndex: doc.rowIndex },
            doc,
            { upsert: true, new: true }
          );
        } catch (e) {
          console.error('❌ Part upsert failed:', {
            weekColumn: w.weekColumn,
            spec: p.spec,
            rowIndex: p.rowIndex,
            error: e?.message
          });
        }
      }
      // Upsert line/day minutes
      for (const day of (w.lineDayMinutes || [])) {
        const di = day.dayIndex;
        for (const lineKey of Object.keys(day.lines)) {
          try {
            const lineNum = Number(lineKey);
            const minutes = day.lines[lineKey];
            await LineDay.findOneAndUpdate(
              { weekColumn: w.weekColumn, dayIndex: di, line: lineNum },
              {
                weekColumn: w.weekColumn,
                dayIndex: di,
                dateHeader: headers[di] != null ? String(headers[di]) : String(di),
                line: lineNum,
                capacityMinutes: (minutes.used || 0) + (minutes.remaining || 0),
                usedMinutes: minutes.used || 0,
                remainingMinutes: minutes.remaining || 0
              },
              { upsert: true, new: true }
            );
          } catch (e) {
            console.error('❌ LineDay upsert failed:', {
              weekColumn: w.weekColumn,
              dayIndex: di,
              line: lineKey,
              error: e?.message
            });
          }
        }
      }
    }
    console.log('✅ New allocation data saved to MongoDB');
  } catch (err) {
    console.error('❌ Error saving new allocation to MongoDB:', err);
    // Do not throw: persistence failure shouldn’t block the upload flow
  }
}

// Helper function to save data to MongoDB
async function saveToDatabase(items, lines, dayKeys, allocationResult) {
  try {
    // Upsert items
    for (const item of items) {
      await Item.findOneAndUpdate(
        { itemId: item.itemId },
        item,
        { upsert: true, new: true }
      );
    }
    
    // Upsert lines
    for (const line of lines) {
      if (line.date) {
        await Line.findOneAndUpdate(
          { lineName: line.lineName, date: line.date },
          line,
          { upsert: true, new: true }
        );
      }
    }
    
    // Replace schedules for the date range
    const startDate = new Date(dayKeys[0]);
    const endDate = new Date(dayKeys[dayKeys.length - 1]);
    
    // Remove existing schedules in the date range
    await Schedule.deleteMany({
      date: { $gte: startDate, $lte: endDate }
    });
    
    // Create new schedules for each day
    for (let i = 0; i < dayKeys.length; i++) {
      const day = dayKeys[i];
      const dayUtilization = allocationResult.lineUtilization[day];
      
      if (dayUtilization) {
        const itemsPlanned = [];
        const lineUtilization = [];
        
        // Collect items planned for this day
        items.forEach(item => {
          if (item.dailyAllocations[i] > 0) {
            item.lineAssignments.forEach(assignment => {
              if (assignment.quantity > 0) {
                itemsPlanned.push({
                  itemId: item.itemId,
                  line: assignment.line,
                  quantity: assignment.quantity,
                  plannedMinutes: assignment.minutesUsed
                });
              }
            });
          }
        });
        
        // Collect line utilization for this day
        Object.keys(dayUtilization).forEach(lineName => {
          const lineData = dayUtilization[lineName];
          lineUtilization.push({
            line: lineName,
            plannedMinutes: lineData.plannedMinutes,
            remainingMinutes: lineData.remainingMinutes,
            efficiency: lineData.efficiency
          });
        });
        
        // Create schedule document
        const schedule = new Schedule({
          date: new Date(day),
          itemsPlanned,
          lineUtilization,
          totalPlanned: itemsPlanned.reduce((sum, item) => sum + item.quantity, 0),
          notes: `Generated allocation for ${day}`
        });
        
        await schedule.save();
      }
    }
    
    console.log("✅ Data saved to MongoDB successfully");
  } catch (error) {
    console.error("❌ Error saving to MongoDB:", error);
    throw error;
  }
}

// GET endpoints
app.get('/items', async (req, res) => {
  try {
    const items = await Item.find({}, 'itemId customer componentUnit feasibility dailyAllocations lineAssignments');
    res.json(items);
  } catch (error) {
    console.error("❌ Error fetching items:", error);
    res.status(500).json({ error: "Error fetching items" });
  }
});

app.get('/lines', async (req, res) => {
  try {
    const lines = await Line.find({}, 'lineName date availableMinutes manpower efficiency targetEfficiency');
    res.json(lines);
  } catch (error) {
    console.error("❌ Error fetching lines:", error);
    res.status(500).json({ error: "Error fetching lines" });
  }
});

app.get('/schedule', async (req, res) => {
  try {
    const { date } = req.query;
    
    if (!date) {
      return res.status(400).json({ error: "Date parameter is required (YYYY-MM-DD)" });
    }
    
    const startDate = new Date(date);
    const endDate = new Date(startDate);
    endDate.setDate(startDate.getDate() + 9); // 10-day range
    
    const schedules = await Schedule.find({
      date: { $gte: startDate, $lte: endDate }
    }).sort({ date: 1 });
    
    // Format response for 10-day grid
    const response = {
      dateRange: {
        start: startDate.toISOString().split('T')[0],
        end: endDate.toISOString().split('T')[0]
      },
      dailySchedules: schedules.map(schedule => ({
        date: schedule.date.toISOString().split('T')[0],
        itemsPlanned: schedule.itemsPlanned,
        lineUtilization: schedule.lineUtilization,
        totalPlanned: schedule.totalPlanned
      }))
    };
    
    res.json(response);
  } catch (error) {
    console.error("❌ Error fetching schedule:", error);
    res.status(500).json({ error: "Error fetching schedule" });
  }
});

const PORT = 4000
app.listen(PORT, ()=>console.log(`server running at port ${PORT}`))