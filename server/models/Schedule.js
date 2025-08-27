const mongoose = require('mongoose');

const scheduleSchema = new mongoose.Schema({
  date: Date,
  itemsPlanned: [
    {
      itemId: String,
      line: String,
      quantity: Number
    }
  ],
  totalPlanned: Number,
  notes: String
});

module.exports = mongoose.model('Schedule', scheduleSchema);
