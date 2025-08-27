const mongoose = require('mongoose');

const itemSchema = new mongoose.Schema({
  itemId: String,
  customer: String,
  componentUnit: String,
  feasibility: Number,
  cycleTime: Number,
  specType: String,   // e.g., Hybrid/Non-Hybrid
  dashSize: Number,   // if available
  lineAssignments: [  // to store how it's split across lines
    {
      line: String,
      quantity: Number,
      minutesUsed: Number
    }
  ]
});

module.exports = mongoose.model('Item', itemSchema);
