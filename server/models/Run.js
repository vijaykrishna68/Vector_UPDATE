const mongoose = require('mongoose');

const { Schema } = mongoose;

const RunErrorSchema = new Schema(
  {
    type: { type: String, required: true },
    jobId: { type: Schema.Types.ObjectId, ref: 'Job' },
    message: { type: String, required: true },
    week: { type: String },
    overloadMinutes: { type: Number }
  },
  { _id: false }
);

const RunSchema = new Schema(
  {
    createdAt: { type: Date, default: Date.now },
    weekSummaries: { type: Schema.Types.Mixed },
    errors: { type: [RunErrorSchema], default: [] }
  },
  { versionKey: false, suppressReservedKeysWarning: true }
);

module.exports = mongoose.model('Run', RunSchema);
