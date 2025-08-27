const express = require('express');
const mongoose = require('mongoose');  
const multer  = require('multer') 
const cors = require('cors');
var XLSX = require("xlsx");

const Item = require('./models/Item.js');

mongoose.connect('mongodb://127.0.0.1:27017/hoseSchedulerDB')
.then(() => console.log("✅ MongoDB connected"))
.catch(err => console.error("❌ Connection error:", err));


const app = express();
app.use(cors());
//app.use(express.json());

app.get('/',(req,res)=>{
  res.send('server running')  
})


const path = require('path');
const storage = multer.diskStorage({
  destination: path.join(__dirname, '../uploads'),
});
const upload = multer({ storage });

app.post('/upload',upload.single('file'),async(req,res)=>{
  try{
  const workbook = XLSX.readFile(req.file.path);
  const sheetNames = workbook.SheetNames 
  
  const sheet2 = XLSX.utils.sheet_to_json(workbook.Sheets['SHEET 2'])
  const sheet4 = XLSX.utils.sheet_to_json(workbook.Sheets['SHEET 4'])

  function excelDateToJS(serial){
    const base = new Date(1900,0,serial-1)
    return base.toISOString().split('T')[0];
  }

  const items = sheet2.map(row =>({
    itemId: row['__EMPTY'],
    lineHint: row['__EMPTY_1'],
    componentUnit: row['__EMPTY_2'],
    customer: row['__EMPTY_3'],
    cycleTime: row['__EMPTY_4'],
    feasibility: row['__EMPTY_6'] || row['WEEKLY FESABLE GIVEN'],
    feasibilityPending: row['WEEKLY FESABLE PENDING'],
    lineAssignments: []
  }))

    const lines = sheet4.map(row => ({
      lineName: `Line ${row['Line ']}`,
      manpower: row['Manpower'],
      availableMinutes: row['Working Minutes Total'],
      efficiency: row['Efficiency'],
      targetEfficiency: row['Target Efficiency'],
      date: typeof row['Date'] === 'number' ? excelDateToJS(row['Date']) : null
    }));

    console.log("Mapped Items:", items.slice(0, 3));
    console.log("Mapped Lines:", lines.slice(0, 3));

    res.json({
      message: "File processed successfully",
      itemsPreview: items.slice(0, 5),
      linesPreview: lines.slice(0, 5)
    });
  } catch(err){
    console.error("❌ Error processing file:", err);
    res.status(500).json({ error: "Error processing Excel file" });
  }
})


const PORT = 5000
app.listen(PORT, ()=>console.log(`server running at port ${PORT}`))