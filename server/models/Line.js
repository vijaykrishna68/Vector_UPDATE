const mongoose = require('mongoose');

const lineSchema = new mongoose.Schema({
  lineName: String,     // e.g., Line 1
  date: Date,           // specific date for this line data
  availableMinutes: Number,   // daily available minutes
  manpower: Number,     // workers
  efficiency: Number,   // track usage %
  targetEfficiency: Number
});

module.exports = mongoose.model('Line', lineSchema);
