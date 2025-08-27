const mongoose = require('mongoose');

const lineSchema = new mongoose.Schema({
  lineName: String,     // e.g., Line 1
  maxMinutes: Number,   // daily available minutes
  manpower: Number,     // workers
  efficiency: Number    // track usage %
});

module.exports = mongoose.model('Line', lineSchema);
