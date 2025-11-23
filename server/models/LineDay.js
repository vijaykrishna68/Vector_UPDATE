const mongoose = require('mongoose');

const lineDaySchema = new mongoose.Schema({
  weekColumn: String,   // 'BU' | 'BV' | 'BW'
  dayIndex: Number,     // 0-based
  dateHeader: String,   // header from row 3 (CU, CV, ...)
  line: Number,         // 1..4
  capacityMinutes: Number,
  usedMinutes: Number,
  remainingMinutes: Number
});

module.exports = mongoose.model('LineDay', lineDaySchema);
