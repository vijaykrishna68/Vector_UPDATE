const mongoose = require('mongoose');

const { Schema } = mongoose;

const JobSchema = new Schema(
  {
    runId: { type: Schema.Types.ObjectId, ref: 'Run', required: true, index: true },
    spec: { type: String, required: true, trim: true },
    weeklyQty: { type: Number, required: true },
    cycleTime: { type: Number, required: true },
    week: { type: String, required: true },
    // The line the part is DESIGNATED for (Sheet1 column D), as opposed to the
    // line that actually ran it (Allocation.machineId). Null when column D is
    // blank or non-numeric. Additive and optional: needed so the schedule view
    // can show designated vs actual line, which is how fallback is read.
    originalLine: { type: Number, default: null }
  },
  { versionKey: false }
);

JobSchema.index({ runId: 1, spec: 1, week: 1 }, { unique: true });

// The week-detail endpoint queries Job.find({ runId, week }). The unique index
// above cannot serve that efficiently because `spec` sits between the two keys.
JobSchema.index({ runId: 1, week: 1 });

module.exports = mongoose.model('Job', JobSchema);
