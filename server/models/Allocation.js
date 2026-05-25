const mongoose = require('mongoose');

const { Schema } = mongoose;

const AllocationSchema = new Schema(
  {
    runId: { type: Schema.Types.ObjectId, ref: 'Run', required: true, index: true },
    jobId: { type: Schema.Types.ObjectId, ref: 'Job', required: true, index: true },
    machineId: { type: Schema.Types.ObjectId, ref: 'Machine', required: true },
    assignedQty: { type: Number, required: true },
    dayIndex: { type: Number }
  },
  { versionKey: false }
);

module.exports = mongoose.model('Allocation', AllocationSchema);
