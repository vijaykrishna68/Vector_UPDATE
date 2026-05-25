const mongoose = require('mongoose');

const { Schema } = mongoose;

const MachineSchema = new Schema(
  {
    runId: { type: Schema.Types.ObjectId, ref: 'Run', required: true, index: true },
    machineNumber: { type: String, required: true, trim: true },
    capacity: { type: Number, required: true }
  },
  { versionKey: false }
);

MachineSchema.index({ runId: 1, machineNumber: 1 }, { unique: true });

module.exports = mongoose.model('Machine', MachineSchema);
