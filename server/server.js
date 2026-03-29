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


const app = express();
// Needed so req.protocol reflects https behind Render/Fly reverse proxies.
app.set('trust proxy', true);

// In-memory cache of the most recently processed upload.
// NOTE: This is NOT persisted and will reset on deploy/restart.
let lastRun = null;

function parseCsvList(value) {
  return String(value || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

const allowedOrigins = parseCsvList(process.env.CORS_ORIGINS || process.env.CORS_ORIGIN);
if (allowedOrigins.length > 0) {
  app.use(cors({
    exposedHeaders: ['Content-Disposition', 'X-Output-Filename'],
    origin: (origin, cb) => {
      // Allow non-browser clients or same-origin requests with no Origin header.
      if (!origin) return cb(null, true);
      if (allowedOrigins.includes(origin)) return cb(null, true);
      return cb(new Error(`CORS blocked for origin: ${origin}`));
    }
  }));
} else {
  // Default to permissive CORS for local dev.
  app.use(cors({ exposedHeaders: ['Content-Disposition', 'X-Output-Filename'] }));
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

    // Store last run in memory for the schedule views (no persistence).
    lastRun = {
      createdAt: new Date().toISOString(),
      sheet1: runResult.sheet1Name,
      sheet3: runResult.sheet3Name,
      weeksResults: runResult.weeksResults
    };

    // Write updated workbook with allocations & actualWorkingDays
    const outputFileName = allocationEngine.generateOutputFilename();
    const outputBuffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    // Return the processed XLSX directly (downloadable response).
    const downloadName = safeAttachmentFilename(outputFileName);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${downloadName}"`);
    res.setHeader('X-Output-Filename', downloadName);
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
app.get('/allocation/weeks', (req, res) => {
  try {
    if (!lastRun || !Array.isArray(lastRun.weeksResults)) return res.json({ weeks: [] });

    const results = lastRun.weeksResults.map(wr => {
      const parts = wr.parts || [];
      const SUM = parts.reduce((s, p) => s + (Number(p.weeklyQty) || 0), 0);
      const CountOfParts = parts.filter(p => (Number(p.weeklyQty) || 0) > 0).length;
      const actualWorkingDays = Number(wr.actualWorkingDays) || 0;

      const lineTotals = { 1: { allocated: 0, remaining: 0 }, 2: { allocated: 0, remaining: 0 }, 3: { allocated: 0, remaining: 0 }, 4: { allocated: 0, remaining: 0 } };
      parts.forEach(p => {
        const allocated = (p.allocations || []).reduce((s, a) => s + (Number(a.qty) || 0), 0);
        const ol = (p.originalLine === null || p.originalLine === undefined || isNaN(Number(p.originalLine))) ? 1 : Number(p.originalLine);
        if (!lineTotals[ol]) lineTotals[ol] = { allocated: 0, remaining: 0 };
        lineTotals[ol].allocated += allocated;
        lineTotals[ol].remaining += (Number(p.remainingQty) || 0);
      });

      const perLineMinutes = { 1: { used: 0, capacity: 0 }, 2: { used: 0, capacity: 0 }, 3: { used: 0, capacity: 0 }, 4: { used: 0, capacity: 0 } };
      (wr.lineDayMinutes || []).forEach(day => {
        const lines = day.lines || {};
        Object.keys(lines).forEach(k => {
          const ln = Number(k);
          if (!perLineMinutes[ln]) perLineMinutes[ln] = { used: 0, capacity: 0 };
          const used = Number(lines[k]?.used) || 0;
          const remaining = Number(lines[k]?.remaining) || 0;
          perLineMinutes[ln].used += used;
          perLineMinutes[ln].capacity += used + remaining;
        });
      });

      const lines = [1, 2, 3, 4].map(ln => {
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

    return res.json({ weeks: results });
  } catch (err) {
    console.error('❌ Error fetching allocation weeks (in-memory):', err);
    return res.status(500).json({ error: 'Error fetching allocation weeks' });
  }
});

// GET detailed allocation for a single week
app.get('/allocation/week/:weekColumn', (req, res) => {
  try {
    const { weekColumn } = req.params;
    if (!lastRun || !Array.isArray(lastRun.weeksResults)) {
      return res.json({ weekColumn, parts: [], lineDays: [] });
    }

    const wr = lastRun.weeksResults.find(w => String(w.weekColumn) === String(weekColumn));
    if (!wr) return res.json({ weekColumn, parts: [], lineDays: [] });

    const parts = (wr.parts || []).map(p => ({
      spec: p.spec,
      weekColumn: wr.weekColumn,
      rowIndex: p.rowIndex,
      originalLine: p.originalLine,
      cycleTime: p.cycleTime,
      weeklyQty: p.weeklyQty,
      remainingQty: p.remainingQty,
      allocations: p.allocations || []
    }));

    const headers = wr.dateHeaders || [];
    const lineDays = [];
    (wr.lineDayMinutes || []).forEach(day => {
      const di = Number(day.dayIndex) || 0;
      const dateHeader = headers[di] != null ? String(headers[di]) : String(di);
      const lines = day.lines || {};
      Object.keys(lines).forEach(k => {
        const ln = Number(k);
        const used = Number(lines[k]?.used) || 0;
        const remaining = Number(lines[k]?.remaining) || 0;
        lineDays.push({
          weekColumn: wr.weekColumn,
          dayIndex: di,
          dateHeader,
          line: ln,
          capacityMinutes: used + remaining,
          usedMinutes: used,
          remainingMinutes: remaining
        });
      });
    });

    lineDays.sort((a, b) => (a.dayIndex - b.dayIndex) || (a.line - b.line));
    return res.json({ weekColumn, parts, lineDays });
  } catch (err) {
    console.error('❌ Error fetching allocation week detail (in-memory):', err);
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
app.listen(PORT, () => console.log(`server running on port ${PORT}`));