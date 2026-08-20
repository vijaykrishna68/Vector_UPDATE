const mongoose = require('mongoose');

const { Schema } = mongoose;

const RunErrorSchema = new Schema(
  {
    type: { type: String, required: true },
    jobId: { type: Schema.Types.ObjectId, ref: 'Job' },
    message: { type: String, required: true },
    week: { type: String },
    spec: { type: String },
    overloadMinutes: { type: Number }
  },
  { _id: false }
);

/** Per-line figures inside a week summary. Produced by buildWeekSummaries(). */
const LineSummarySchema = new Schema(
  {
    line: { type: Number, required: true },
    allocatedParts: { type: Number, default: 0 },
    remainingParts: { type: Number, default: 0 },
    capacityMinutes: { type: Number, default: 0 },
    usedMinutes: { type: Number, default: 0 },
    efficiency: { type: Number, default: 0 },
    workingDays: { type: Number, default: 0 },
    avgPartsPerDay: { type: Number, default: 0 }
  },
  { _id: false }
);

/** Aggregated issue counts, precomputed so the run list stays cheap. */
const IssueSummarySchema = new Schema(
  {
    code: { type: String, required: true },
    severity: { type: String, required: true },
    count: { type: Number, default: 0 },
    affectedWeeks: { type: [String], default: [] },
    examples: { type: [String], default: [] }
  },
  { _id: false }
);

/**
 * Week summary — was Schema.Types.Mixed.
 *
 * The structure has been stable since Phase 1 and is produced in exactly one
 * place (services/summary.service.js), so it is now typed. Two fields stay
 * loose on purpose:
 *
 *   dateHeaders  the workbook stores day headers as Excel serial numbers, but
 *                other workbooks use strings, so the element type is Mixed.
 *   lineTotals   an object keyed '1'..'4'. Typing it as a Map would change the
 *                JSON serialisation and therefore the API wire format, so it
 *                stays Mixed. It duplicates `lines` and is a candidate for
 *                removal once no consumer reads it.
 *
 * Backwards compatibility: documents written before this change already match
 * this shape, and reads use .lean() (raw BSON, no casting), so older runs load
 * unchanged. No migration is required.
 */
const WeekSummarySchema = new Schema(
  {
    weekColumn: { type: String, required: true },
    SUM: { type: Number, default: 0 },
    CountOfParts: { type: Number, default: 0 },
    actualWorkingDays: { type: Number, default: 0 },
    daysOpened: { type: Number, default: 0 },
    dateHeaders: { type: [Schema.Types.Mixed], default: [] },
    lineTotals: { type: Schema.Types.Mixed },
    lines: { type: [LineSummarySchema], default: [] },
    // Issue counts scoped to THIS week, so week views show exact numbers rather
    // than the run-wide count for the same code.
    issueSummary: { type: [IssueSummarySchema], default: [] }
  },
  { _id: false }
);

const RunTotalsSchema = new Schema(
  {
    demand: { type: Number, default: 0 },
    allocated: { type: Number, default: 0 },
    remaining: { type: Number, default: 0 },
    usedMinutes: { type: Number, default: 0 },
    capacityMinutes: { type: Number, default: 0 }
  },
  { _id: false }
);

/** A run is only readable once it reaches 'complete'. See RUN_STATUS below. */
const RUN_STATUS = { PENDING: 'pending', COMPLETE: 'complete', FAILED: 'failed' };

const RunSchema = new Schema(
  {
    createdAt: { type: Date, default: Date.now, index: true },
    // Two-phase persistence guard: a run starts 'pending' and is only promoted
    // to 'complete' after every child document is written. Readers filter on
    // this, so a partially written run can never become the active/latest run.
    status: {
      type: String,
      enum: Object.values(RUN_STATUS),
      default: RUN_STATUS.PENDING,
      required: true
    },
    // Sanitised original upload name, for identifying a run in the history list.
    sourceFilename: { type: String },
    failureReason: { type: String },
    completedAt: { type: Date },
    totals: { type: RunTotalsSchema, default: () => ({}) },
    weekSummaries: { type: [WeekSummarySchema], default: [] },
    issueSummary: { type: [IssueSummarySchema], default: [] },
    issueCount: { type: Number, default: 0 },
    errors: { type: [RunErrorSchema], default: [] }
  },
  { versionKey: false, suppressReservedKeysWarning: true }
);

// The run list and "latest complete run" lookup both filter by status and sort
// by createdAt, which this index serves directly.
RunSchema.index({ status: 1, createdAt: -1 });

const Run = mongoose.model('Run', RunSchema);

module.exports = Run;
module.exports.RUN_STATUS = RUN_STATUS;
