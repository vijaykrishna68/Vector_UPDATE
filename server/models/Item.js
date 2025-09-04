const mongoose = require('mongoose');

const itemSchema = new mongoose.Schema({
  itemId: String,
  customer: String,
  componentUnit: String,
  feasibility: Number,
  feasibilityPending: Number,
  cycleTime: Number,
  specType: String,   // e.g., Hybrid/Non-Hybrid
  dashSize: Number,   // if available
  lineHint: String,   // suggested line from Excel
  dailyAllocations: [Number], // 10 days worth of allocations (BI-BR columns)
  lineAssignments: [  // to store how it's split across lines
    {
      line: String,
      quantity: Number,
      minutesUsed: Number
    }
  ]
});

module.exports = mongoose.model('Item', itemSchema);
