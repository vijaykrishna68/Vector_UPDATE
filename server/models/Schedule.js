const mongoose = require('mongoose');

const scheduleSchema = new mongoose.Schema({
  date: Date,
  itemsPlanned: [
    {
      itemId: String,
      line: String,
      quantity: Number,
      plannedMinutes: Number
    }
  ],
  lineUtilization: [
    {
      line: String,
      plannedMinutes: Number,
      remainingMinutes: Number,
      efficiency: Number
    }
  ],
  totalPlanned: Number,
  notes: String
});

module.exports = mongoose.model('Schedule', scheduleSchema);
