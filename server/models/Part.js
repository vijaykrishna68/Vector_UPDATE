const mongoose = require('mongoose');

const allocationSchema = new mongoose.Schema({
  dayIndex: Number,
  dateHeader: String,
  line: Number,
  qty: Number,
  minutes: Number
}, { _id: false });

const partSchema = new mongoose.Schema({
  spec: String,            // Column B in Sheet 1
  weekColumn: String,      // 'BU' | 'BV' | 'BW'
  rowIndex: Number,        // row index in Sheet 1 (zero-based)
  originalLine: Number,    // Column D
  cycleTime: Number,       // Column H
  weeklyQty: Number,       // from week column
  remainingQty: Number,    // after allocation
  allocations: [allocationSchema]
});

module.exports = mongoose.model('Part', partSchema);
