const express = require('express');
const multer  = require('multer') 
const cors = require('cors');
const path = require('path');
var XLSX = require("xlsx");

// Local dev convenience. In production (Render/Fly/etc), env vars are injected by the platform.
try {
  require('dotenv').config();
} catch (_) {
  // dotenv is optional; ignore if not installed.
}

const AllocationEngine = require('./allocation.js');
const { connectDB } = require('./db');

const Run = require('./models/Run');
const Job = require('./models/Job');
const Machine = require('./models/Machine');
const Allocation = require('./models/Allocation');


const app = express();
// Needed so req.protocol reflects https behind Render/Fly reverse proxies.
app.set('trust proxy', true);

// In-memory cache of the most recently processed upload.
// NOTE: This is NOT persisted and will reset on deploy/restart.
let lastRunId = null;

function toObjectIdString(value) {
  try {
    return value ? String(value) : null;
  } catch (_) {
    return null;
  }
}

async function resolveRunId(requestedRunId) {
  if (requestedRunId) {
    const found = await Run.findById(requestedRunId).select('_id').lean();
    if (found?._id) return found._id;
  }

  // Prefer the most recent persisted Run.
  const latest = await Run.findOne({}).sort({ createdAt: -1 }).select('_id').lean();
  if (latest?._id) return latest._id;

  // Fallback to last in-memory run id (mainly for local dev during transition).
  return lastRunId;
}

function buildWeekSummaries(weeksResults) {
  if (!Array.isArray(weeksResults)) return [];

  return weeksResults.map((wr) => {
    const parts = wr.parts || [];
    const SUM = parts.reduce((s, p) => s + (Number(p.weeklyQty) || 0), 0);
    const CountOfParts = parts.filter((p) => (Number(p.weeklyQty) || 0) > 0).length;
    const actualWorkingDays = Number(wr.actualWorkingDays) || 0;

    const lineTotals = { 1: { allocated: 0, remaining: 0 }, 2: { allocated: 0, remaining: 0 }, 3: { allocated: 0, remaining: 0 }, 4: { allocated: 0, remaining: 0 } };
    parts.forEach((p) => {
      const allocated = (p.allocations || []).reduce((s, a) => s + (Number(a.qty) || 0), 0);
      const ol = (p.originalLine === null || p.originalLine === undefined || isNaN(Number(p.originalLine))) ? 1 : Number(p.originalLine);
      if (!lineTotals[ol]) lineTotals[ol] = { allocated: 0, remaining: 0 };
      lineTotals[ol].allocated += allocated;
      lineTotals[ol].remaining += (Number(p.remainingQty) || 0);
    });

    const perLineMinutes = { 1: { used: 0, capacity: 0 }, 2: { used: 0, capacity: 0 }, 3: { used: 0, capacity: 0 }, 4: { used: 0, capacity: 0 } };
    (wr.lineDayMinutes || []).forEach((day) => {
      const lines = day.lines || {};
      Object.keys(lines).forEach((k) => {
        const ln = Number(k);
        if (!perLineMinutes[ln]) perLineMinutes[ln] = { used: 0, capacity: 0 };
        const used = Number(lines[k]?.used) || 0;
        const remaining = Number(lines[k]?.remaining) || 0;
        perLineMinutes[ln].used += used;
        perLineMinutes[ln].capacity += used + remaining;
      });
    });

    const lines = [1, 2, 3, 4].map((ln) => {
      const allocParts = lineTotals[ln]?.allocated || 0;
      const remainingParts = lineTotals[ln]?.remaining || 0;
      const usedMin = perLineMinutes[ln]?.used || 0;
      const capMin = perLineMinutes[ln]?.capacity || 0;
      const efficiency = capMin > 0 ? +((usedMin / capMin) * 100).toFixed(2) : 0;
      const avgPartsPerDay = actualWorkingDays > 0 ? +(allocParts / actualWorkingDays).toFixed(2) : 0;
      return {
        line: ln,
        allocatedParts: allocParts,
        remainingParts,
        capacityMinutes: capMin,
        usedMinutes: usedMin,
        efficiency,
        workingDays: actualWorkingDays,
        avgPartsPerDay
      };
    });

    return { weekColumn: wr.weekColumn, SUM, CountOfParts, actualWorkingDays, lineTotals, lines };
  });
}

function parseCsvList(value) {
  return String(value || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

const allowedOrigins = parseCsvList(process.env.CORS_ORIGINS || process.env.CORS_ORIGIN);
if (allowedOrigins.length > 0) {
  app.use(cors({
    exposedHeaders: ['Content-Disposition', 'X-Output-Filename', 'X-Run-Id'],
    origin: (origin, cb) => {
      // Allow non-browser clients or same-origin requests with no Origin header.
      if (!origin) return cb(null, true);
      if (allowedOrigins.includes(origin)) return cb(null, true);
      return cb(new Error(`CORS blocked for origin: ${origin}`));
    }
  }));
} else {
  // Default to permissive CORS for local dev.
  app.use(cors({ exposedHeaders: ['Content-Disposition', 'X-Output-Filename', 'X-Run-Id'] }));
}
app.use(express.json());

function safeAttachmentFilename(name) {
  const raw = String(name || 'output.xlsx');
  // Avoid path traversal and control chars.
  const cleaned = raw.replace(/[\r\n\\/]/g, '_').replace(/\.+/g, (m) => (m === '..' ? '_' : m));
  return cleaned || 'output.xlsx';
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: Number(process.env.MAX_UPLOAD_BYTES || 25 * 1024 * 1024) // default 25MB
  }
});

app.post('/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ error: 'Missing uploaded file (field name: file)' });
    }

    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const allocationEngine = new AllocationEngine();
    const runResult = allocationEngine.run(workbook);

    // Persist this upload as a Run.
    const run = await Run.create({
      createdAt: new Date(),
      weekSummaries: buildWeekSummaries(runResult.weeksResults),
      errors: []
    });

    // Machines: represent the allocator's fixed lines 1..4.
    const machineDocs = [1, 2, 3, 4].map((ln) => ({
      runId: run._id,
      machineNumber: String(ln),
      capacity: Number(allocationEngine.LINE_CAPACITY?.[ln]) || 0
    }));
    const machines = await Machine.insertMany(machineDocs);
    const machineIdByNumber = new Map(machines.map((m) => [String(m.machineNumber), m._id]));

    // Jobs: one per (spec + week).
    const jobByKey = new Map();
    (runResult.weeksResults || []).forEach((wr) => {
      const week = String(wr.weekColumn);
      (wr.parts || []).forEach((p) => {
        const spec = String(p.spec);
        const key = `${spec}__${week}`;
        const existing = jobByKey.get(key);
        if (existing) {
          existing.weeklyQty += Number(p.weeklyQty) || 0;
          return;
        }
        jobByKey.set(key, {
          runId: run._id,
          spec,
          weeklyQty: Number(p.weeklyQty) || 0,
          cycleTime: Number(p.cycleTime) || 0,
          week
        });
      });
    });
    const jobs = await Job.insertMany(Array.from(jobByKey.values()));
    const jobIdByKey = new Map(jobs.map((j) => [`${j.spec}__${j.week}`, j._id]));

    // Allocations
    const allocationDocs = [];
    (runResult.weeksResults || []).forEach((wr) => {
      const week = String(wr.weekColumn);
      (wr.parts || []).forEach((p) => {
        const key = `${String(p.spec)}__${week}`;
        const jobId = jobIdByKey.get(key);
        if (!jobId) return;
        (p.allocations || []).forEach((a) => {
          const machineId = machineIdByNumber.get(String(a.lineUsed));
          if (!machineId) return;
          allocationDocs.push({
            runId: run._id,
            jobId,
            machineId,
            assignedQty: Number(a.qty) || 0,
            dayIndex: a.dayIndex
          });
        });
      });
    });
    if (allocationDocs.length > 0) {
      await Allocation.insertMany(allocationDocs);
    }

    // Persist structured errors on the Run (attach jobId when possible).
    const persistedErrors = (runResult.errors || []).map((e) => {
      const week = e.week ? String(e.week) : undefined;
      const key = e.spec && week ? `${String(e.spec)}__${week}` : null;
      const jobId = key ? jobIdByKey.get(key) : undefined;
      return {
        type: String(e.type),
        jobId,
        week,
        overloadMinutes: e.overloadMinutes != null ? Number(e.overloadMinutes) : undefined,
        message: String(e.message)
      };
    });
    run.errors = persistedErrors;
    await run.save();

    lastRunId = run._id;

    // Write updated workbook with allocations & actualWorkingDays
    const outputFileName = allocationEngine.generateOutputFilename();
    const outputBuffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    // Return the processed XLSX directly (downloadable response).
    const downloadName = safeAttachmentFilename(outputFileName);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${downloadName}"`);
    res.setHeader('X-Output-Filename', downloadName);
    res.setHeader('X-Run-Id', toObjectIdString(run._id));
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).send(outputBuffer);
  } catch (err) {
    console.error('❌ Error processing file (new allocator):', err);
    res.status(500).json({ error: 'Error processing Excel file', details: err.message });
  }
});

// No persistent storage endpoints (kept for compatibility)
app.get('/items', (req, res) => res.status(410).json({ error: 'Not available (no persistent storage enabled)' }));
app.get('/lines', (req, res) => res.status(410).json({ error: 'Not available (no persistent storage enabled)' }));
app.get('/schedule', (req, res) => res.status(410).json({ error: 'Not available (no persistent storage enabled)' }));

// GET allocation summaries for frontend
app.get('/allocation/weeks', async (req, res) => {
  try {
    const runId = await resolveRunId(req.query.runId);
    if (!runId) return res.json({ allocations: [], errors: [] });

    const run = await Run.findById(runId).select('weekSummaries errors').lean();
    return res.json({ allocations: run?.weekSummaries || [], errors: run?.errors || [] });
  } catch (err) {
    console.error('❌ Error fetching allocation weeks (db):', err);
    return res.status(500).json({ error: 'Error fetching allocation weeks' });
  }
});

// GET detailed allocation for a single week
app.get('/allocation/week/:weekColumn', async (req, res) => {
  try {
    const { weekColumn } = req.params;
    const runId = await resolveRunId(req.query.runId);
    if (!runId) return res.json({ allocations: [], errors: [] });

    const run = await Run.findById(runId).select('errors').lean();
    const jobs = await Job.find({ runId, week: String(weekColumn) }).select('_id').lean();
    const jobIds = jobs.map((j) => j._id);
    if (jobIds.length === 0) {
      const errs = (run?.errors || []).filter((e) => !e.week || String(e.week) === String(weekColumn));
      return res.json({ allocations: [], errors: errs });
    }

    const allocs = await Allocation.find({ runId, jobId: { $in: jobIds } })
      .populate('jobId', 'spec week weeklyQty cycleTime')
      .populate('machineId', 'machineNumber capacity')
      .lean();

    const allocations = allocs.map((a) => ({
      id: toObjectIdString(a._id),
      jobId: toObjectIdString(a.jobId?._id || a.jobId),
      spec: a.jobId?.spec,
      week: a.jobId?.week,
      machineId: toObjectIdString(a.machineId?._id || a.machineId),
      machineNumber: a.machineId?.machineNumber,
      assignedQty: a.assignedQty,
      dayIndex: a.dayIndex
    }));

    const errs = (run?.errors || []).filter((e) => !e.week || String(e.week) === String(weekColumn));
    return res.json({ allocations, errors: errs });
  } catch (err) {
    console.error('❌ Error fetching allocation week detail (db):', err);
    return res.status(500).json({ error: 'Error fetching allocation week detail' });
  }
});

// Serve the built frontend (Vite build output) from the same local server.
const clientDistPath = path.join(__dirname, '../client/scheduler-fe/dist');
app.use(express.static(clientDistPath));

// SPA fallback (must be AFTER API routes)
app.get(/.*/, (req, res) => {
  const indexPath = path.join(clientDistPath, 'index.html');
  res.sendFile(indexPath, (err) => {
    if (err) res.status(404).send('Not found');
  });
});

const PORT = Number(process.env.PORT || 4000);

async function start() {
  await connectDB();
  app.listen(PORT, () => console.log(`server running on port ${PORT}`));
}

start().catch((err) => {
  console.error('❌ Failed to start server:', err.message);
  process.exit(1);
});