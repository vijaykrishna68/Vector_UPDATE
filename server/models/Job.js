const mongoose = require('mongoose');

const { Schema } = mongoose;

const JobSchema = new Schema(
  {
    runId: { type: Schema.Types.ObjectId, ref: 'Run', required: true, index: true },
    spec: { type: String, required: true, trim: true },
    weeklyQty: { type: Number, required: true },
    cycleTime: { type: Number, required: true },
    week: { type: String, required: true }
  },
  { versionKey: false }
);

JobSchema.index({ runId: 1, spec: 1, week: 1 }, { unique: true });

module.exports = mongoose.model('Job', JobSchema);
