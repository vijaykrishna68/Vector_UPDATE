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


const path = require('path');
const storage = multer.diskStorage({
  destination: path.join(__dirname, '../uploads'),
});
const upload = multer({ storage });

app.post('/upload', upload.single('file'), async (req, res) => {
  try {
    const workbook = XLSX.readFile(req.file.path);
    const sheetNames = workbook.SheetNames;
    
    const sheet2 = XLSX.utils.sheet_to_json(workbook.Sheets['SHEET 2']);
    const sheet4 = XLSX.utils.sheet_to_json(workbook.Sheets['SHEET 4']);

    function excelDateToJS(serial) {
      const base = new Date(1900, 0, serial - 1);
      return base.toISOString().split('T')[0];
    }

    // Parse items from SHEET 2
    const items = sheet2.map(row => ({
      itemId: row['__EMPTY'],
      lineHint: row['__EMPTY_1'],
      componentUnit: row['__EMPTY_2'],
      customer: row['__EMPTY_3'],
      cycleTime: row['__EMPTY_4'],
      feasibility: row['__EMPTY_6'] || row['WEEKLY FESABLE GIVEN'],
      feasibilityPending: row['WEEKLY FESABLE PENDING'],
      specType: row['__EMPTY_5'] || 'Hybrid', // Default to Hybrid if not specified
      dashSize: row['__EMPTY_7'] || null,
      lineAssignments: [],
      dailyAllocations: new Array(10).fill(0)
    }));

    // Parse lines from SHEET 4
    const lines = sheet4.map(row => ({
      lineName: `Line ${row['Line ']}`,
      manpower: row['Manpower'],
      availableMinutes: row['Working Minutes Total'],
      efficiency: row['Efficiency'],
      targetEfficiency: row['Target Efficiency'],
      date: typeof row['Date'] === 'number' ? excelDateToJS(row['Date']) : null
    }));

    // Generate day keys for BI-BR columns (10 days)
    const today = new Date();
    const dayKeys = [];
    for (let i = 0; i < 10; i++) {
      const date = new Date(today);
      date.setDate(today.getDate() + i);
      dayKeys.push(date.toISOString().split('T')[0]);
    }

    console.log("Mapped Items:", items.slice(0, 3));
    console.log("Mapped Lines:", lines.slice(0, 3));
    console.log("Day Keys:", dayKeys);

    // Initialize allocation engine
    const allocationEngine = new AllocationEngine();
    
    // Perform allocation
    const allocationResult = allocationEngine.allocateItems(items, lines, dayKeys);
    
    // Generate output filename and path
    const outputFileName = allocationEngine.generateOutputFilename();
    const outputPath = path.join(__dirname, '../output', outputFileName);
    
    // Ensure output directory exists
    const outputDir = path.join(__dirname, '../output');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    
    // Write allocations back to Excel
    allocationEngine.writeAllocationsToExcel(req.file.path, items, dayKeys, outputPath);
    
    // Save to MongoDB
    await saveToDatabase(items, lines, dayKeys, allocationResult);
    
    // Prepare response
    const itemsPreview = items.slice(0, 5).map(item => ({
      itemId: item.itemId,
      customer: item.customer,
      feasibility: item.feasibility,
      dailyAllocations: item.dailyAllocations
    }));
    
    const lineUtilization = {};
    dayKeys.forEach(day => {
      if (allocationResult.lineUtilization[day]) {
        lineUtilization[day] = Object.keys(allocationResult.lineUtilization[day]).map(lineName => ({
          line: lineName,
          plannedMinutes: allocationResult.lineUtilization[day][lineName].plannedMinutes,
          remainingMinutes: allocationResult.lineUtilization[day][lineName].remainingMinutes,
          efficiency: allocationResult.lineUtilization[day][lineName].efficiency
        }));
      }
    });

    res.json({
      message: "File processed and allocated successfully",
      itemsPreview,
      lineUtilization,
      outputFileName,
      workingDays: allocationResult.workingDays,
      totalFeasibility: allocationResult.totalFeasibility
    });

  } catch (err) {
    console.error("❌ Error processing file:", err);
    res.status(500).json({ error: "Error processing Excel file" });
  }
});

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

const PORT = 5000
app.listen(PORT, ()=>console.log(`server running at port ${PORT}`))