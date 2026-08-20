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

// Matches the only query this collection serves:
//   Allocation.find({ runId, jobId: { $in: jobIds } })
// The single-field indexes above are now redundant as a prefix of this one, but
// dropping an existing index needs a deliberate migration, so they stay for now.
AllocationSchema.index({ runId: 1, jobId: 1 });

module.exports = mongoose.model('Allocation', AllocationSchema);
