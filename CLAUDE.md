# CLAUDE.md — Vector Scheduler handoff

Durable context for future Claude Code sessions. Facts only; verified against the
repository at the time of writing. Update it when the state below changes.

---

## 1. PROJECT OVERVIEW

**Vector Scheduler** allocates weekly manufacturing demand across four production
lines, respecting per-line daily capacity, and writes the resulting plan back into
the planner's Excel workbook.

**Business problem.** Planners receive demand for hundreds of parts per week. Each
line has different capacity, some lines can back up others, and demand can exceed
capacity. Manual planning is slow and error-prone.

**Workbook model.**
- Input: the planner's `.xlsx` (real ones have ~30 sheets, ~1,400 rows, ~1.9 MB).
- The **schedule sheet** ("Sheet1") is detected by the presence of `BU4`/`BV5`/`BW6`.
  Columns: `B` = spec, `D` = designated line, `H` = cycle time (minutes/part),
  `J` = component unit (only rows equal to `PC` are processed),
  `BU`/`BV`/`BW` = demand buckets, `CU` onward = production-date columns
  (row 3 holds the date headers, usually Excel serial numbers).
- The **working-days sheet** is identified by the label
  `"Working Days As Per Plan"` in cell `I3`. Column `I` rows 4/5/6 receive the
  computed working days for BU/BV/BW.
- Output: the same workbook with quantities written into the `CU+` date columns,
  returned as a download. **The output workbook is not persisted anywhere.**

---

## 2. CURRENT ARCHITECTURE

```
server/
  server.js        process entry: env, DB connect, listen (46 lines)
  app.js           Express app factory — exported so tests mount the real app
  allocation.js    the allocation engine (protected asset)
  routes/index.js  paths and methods only
  controllers/     allocation, runs, health, upload (thin, 20-43 lines each)
  services/        summary, workbook, runPersistence, runQuery
  middleware/      errors.js (AppError + handler), uploadValidation.js
  models/          Run, Job, Machine, Allocation
  test/            10 suites   test-support/  fixtures + golden helper
client/scheduler-fe/src/
  App.jsx          shell: routing + active run
  api.js           fetch layer (AbortSignal, ApiError, shape validation)
  components/      AppHeader, Dashboard, ScheduleView, WeekSummaryList,
                   WeekDetail, RunHistory, IssuesPanel, FileUpload,
                   ProductionLineCard, ErrorBoundary, ui.jsx (visual system)
  lib/             format, status, useRoute, useAsync
```

**API** (no auth; only `/upload` is rate limited):

| Method | Path | Notes |
|---|---|---|
| POST | `/upload` | validate → parse → allocate → persist → return workbook. Sets `X-Run-Id`. |
| GET | `/allocation/weeks` | `{run, weeks, summary, issuesSummary}` — the dashboard payload |
| GET | `/allocation/week/:weekColumn` | `{run, week, dateHeaders, parts, issuesSummary}` |
| GET | `/runs` | paginated run history, metadata only |
| GET | `/runs/:runId` | one run + week summaries |
| GET | `/runs/:runId/issues` | paginated diagnostics, filters: `code`, `week` |
| GET | `/health`, `/health/ready` | liveness / readiness |

Errors always return `{ error, code, requestId }`. `error` is deliberately a
**string** — the frontend does `throw new Error(body?.error)`.

**Client routing** is a ~40-line History-API router (`lib/useRoute.js`), not
react-router. Routes: `/dashboard`, `/schedule`, `/schedule/:week`, `/upload`,
`/history`. Note the run-history client route is **`/history`**, because
`GET /runs` is a real API endpoint and would otherwise return JSON to a browser.

**Persistence.** Two-phase guard, because the target deployment is a standalone
mongod which rejects transactions (verified: `IllegalOperation`):
1. create `Run` as `status:'pending'` (invisible to all readers)
2. write Machine / Job / Allocation
3. promote to `status:'complete'`
On failure: mark `'failed'` and delete children. A transaction is used
additionally when the deployment supports one (`withOptionalTransaction`).
Readers filter `status:'complete'` OR `status` absent (legacy compatibility).

---

## 3. CONFIRMED BUSINESS RULES

Confirmed with the planner. **Do not change these without a new confirmation.**

- `BU` = Week 1 demand
- `BV` = Week 2 demand
- `BW` = Week 3 + Week 4 demand
- `CU` onward = actual production-date columns; each cell is the quantity of that
  part scheduled for production **on that specific date**
- **BU/BV/BW are demand buckets, not hard production deadlines**
- Total demand for a part = `BU + BV + BW`
- Demand is processed in order **BU → BV → BW**
- A bucket that cannot fit within its initial window **must spill into later
  production dates** when capacity exists
- The three buckets **share one capacity model and one production-date cursor**;
  capacity is never reset between them

---

## 4. ALLOCATION ENGINE (`server/allocation.js`)

Constants — **do not change**:
- `MINUTES_PER_PERSON = 475`
- `LINE_CAPACITY = { 1: 1425, 2: 1900, 3: 950, 4: 1425 }` (manpower × 475)
- `TOLERANCE = 20` parts
- `FACTORY_DAILY_CAP = 3000` (used only for the working-day calculation)

**Processing.** `run()` creates one shared `schedule = { lineDayMinutes: [], startDay: 0 }`
and passes it to `allocateWeek()` for BU, then BV, then BW.

- **Shared capacity model**: a day is opened once by whichever bucket reaches it
  first (`openDay`); consumed minutes persist across buckets.
- **Shared date cursor**: after each bucket, `state.startDay = lastDayTouched`.
  The next bucket resumes *on that same day*, consumes its leftover capacity,
  then flows forward. Each bucket's planned window is
  `[startDay, startDay + actualWorkingDays)`.
- **Working days**: `actualWorkingDays = SUM === 0 ? 0 : ceil(SUM / 3000)`,
  computed per bucket, written to the working-days sheet `I4`/`I5`/`I6`.
- **Daily target**: `pqty = ceil(lineTotal / actualWorkingDays)` per line.
- **Line priority**: `3 → 2 → 4 → 1`.
- **Fallback chains**: `3→[3]`, `2→[2,4]`, `4→[4,1]`, `1→[1]`, unknown/null→`[1]`.
  Quantity run on a fallback line is still credited to the **original** line.
- **Attribution**: `resolveGroupLine()` is the single source of truth used by both
  allocation and reporting.
- **Tolerance/extension**: after the planned window, if any line's leftover
  is `> 20`, allocation extends into later date columns until the leftover is
  within tolerance or no further progress is made.
- **Capacity is never exceeded**: `maxByMinutes = floor(remaining / cycleTime)`.

**Diagnostics**: `INVALID_INPUT`, `DUPLICATE_MERGED`, `NO_CAPACITY`, `OVERLOAD`.
Duplicates are merged by `spec + week`; the **first** row's cycle time and row
index win.

**Parsing notes**: rows whose cycle time is invalid are excluded from `SUM`, so
`SUM` is not a plain Excel column total. `!ref` is normalised to the real data
extent (planner workbooks declare ~1,048,576 rows).

---

## 5. BUG HISTORY

### Fixed
- **BUG-1 — week/date-column collision.** All three buckets restarted at `CU`
  with a *fresh capacity model*, then their outputs were summed into the same
  cells; capacity was effectively counted three times and the written schedule
  was physically unexecutable. **Fixed and committed** (`e4399ce`) via the
  shared capacity model + date cursor described above. Background:
  `PHASE-2-BUG-1-INVESTIGATION.md`.
- **BUG-2 — blank-line parts dropped.** Parts with a blank/non-numeric column D
  (`originalLine === null`) counted toward demand but were never allocated
  (4,602 units stranded in week BU alone). Now routed through the existing
  default chain `[1]` via `resolveGroupLine()`.
- **BUG-3 — wrong working-days sheet.** The sheet was chosen as the first
  non-Sheet1 sheet containing any of `I4`/`I5`/`I6`; 17 sheets matched in the
  real workbook, so it overwrote a pivot-table area every run. Now identified by
  the `"Working Days As Per Plan"` header in `I3`; **throws rather than guessing**
  if it cannot be identified uniquely. Override with `WORKING_DAYS_SHEET`.
- **BUG-5 — 1M-row range.** Retained `!ref` made `XLSX.write` take ~75 s. Now
  normalised: ~0.54 s, byte-identical output (315,070 cells compared).
- **BUG-7 — line totals hid demand.** Allocation and reporting used different
  attribution rules. Both now use `resolveGroupLine()`; totals reconcile to `SUM`.

### Intentionally NOT fixed
- **BUG-8 — OVERLOAD capacity basis.** `overloadMinutes = demandMinutes - capacityMinutes`
  where capacity is counted only over days the allocator opened, and across all
  four lines even when a part can reach only one. `algorithm.txt` never defines
  OVERLOAD, and the candidate bases differ by >2×. **Needs a business decision.**
  Its inputs changed with the BUG-1 fix (capacity is no longer treble-counted),
  which should make it easier to define. Pinned by characterisation tests in
  `test/allocation.known-bugs.test.js`.

---

## 6. TEST SAFETY NET

- **Runner**: Node's built-in `node:test` (`npm test` → `node --test test/`).
  No test framework dependency.
- **Golden masters**: `test-support/golden.js` — stable key-sorted JSON, compared
  exactly but **line-ending agnostic**. Regenerate deliberately with
  `npm run test:update-golden`.
  - `test/__golden__/synthetic-workbook.json` — **committed**, fully synthetic,
    safe for CI.
  - `test/__golden__/real-workbooks.local.json` — **gitignored**. Derived from
    `uploads/`; stores aggregates plus sha256 digests, never spec strings.
- **Characterisation-test protocol**: bugs are pinned by tests that assert the
  *broken* behaviour, then **inverted (not deleted)** in the fix commit.
- **Real-workbook suite** reads `uploads/` in place, never copies it, and **skips
  cleanly when `uploads/` is absent**.
- **Mongo-dependent suites** (`api.contract`, `run.persistence`) skip when no
  MongoDB is reachable; default `mongodb://127.0.0.1:27096`, override with
  `TEST_MONGODB_URI`.

**Known limitations**: `uploads/` holds only 4 distinct workbooks (3 share one
layout); one of them is rejected outright (`No date columns starting at CU`) and
that rejection is pinned as current behaviour. The Excel *serialisation* step is
not covered by the real-workbook suite (it is slow). There is **no CI**.

---

## 7. RECENT COMPLETED WORK

- **Phase 0** — safety net: golden masters + characterisation tests, zero
  production changes.
- **Phase 1** — performance & hardening: range fix (141×), upload validation
  (extension/MIME/magic bytes/size), centralised errors, helmet, CORS fail-closed,
  rate limiting, `/health`, indexes, dead-code removal.
- **Phase 2** — correctness: BUG-3, BUG-2, BUG-7 fixed with evidence.
- **Phase 3** — frontend: fixed the API shape mismatch that left the read views
  non-functional; redesigned dashboard/schedule/upload; error boundary; routing.
- **Phase 4** — backend architecture: routes/controllers/services + app factory;
  issue payload ~741 KB → ~6.8 KB plus a paginated issues endpoint; run history
  API + UI; two-phase persistence; typed `Run.weekSummaries` (was `Mixed`).
- **Git history cleanup** — `uploads/` and `node_modules/` removed from all
  history with `git-filter-repo`; pack 13.37 MiB → 3.13 MiB. Backups kept:
  local tag `backup/pre-history-rewrite` **and** the external mirror
  `D:/Projects/vector2.0/Vector_UPDATE-backup-pre-rewrite.git` (**do not delete**;
  it is the only copy of the pre-rewrite history).
- **Cross-platform golden fix** (`c271cc4`) — CRLF normalisation + `.gitattributes`.
- **BUG-1 fix** — implemented and **committed** (`e4399ce`), not yet pushed (see §8).

---

## 8. CURRENT LOCAL COMMIT STATE (unpushed)

Branch: **`cleanup/remove-generated-history`** at `e4399ce`.

**Committed locally, not pushed** — the BUG-1 fix (`e4399ce fix: share allocation
capacity across demand buckets`):
```
server/allocation.js                            (the fix; production code)
server/test/allocation.known-bugs.test.js       (BUG-1 tests inverted + new)
server/test/allocation.golden.test.js           (error-type guard widened)
server/test/__golden__/synthetic-workbook.json  (regenerated deliberately)
```
`test/__golden__/real-workbooks.local.json` was also regenerated (gitignored, never
committed).

**BUG-1 is committed locally; nothing has been pushed.**

**⚠️ Remote drift:** `origin/updatedbranch` is now `4b873a1`. It was `c416746`
when last recorded, so it has moved — most likely the cleanup PR was merged, but
**this was not verified** (no fetch was performed). Confirm before assuming.
`origin/cleanup/remove-generated-history` is still `c271cc4`; local is now
**1 commit ahead** (`e4399ce`, unpushed).

---

## 9. CURRENT TEST STATE

- **Backend: 167/167 passing**, 0 failed, 0 skipped (with MongoDB running).
  Without MongoDB: **130 pass**, the 37 Mongo-dependent tests skip.
- **Frontend lint: clean.** **Build: passes** (~247 kB JS / ~74 kB gzip).
- **Real-workbook validation** after the BUG-1 fix:
  ```
  BU 27,123 allocated, 0 remaining, days 0..10
  BV 12,898 allocated, 0 remaining, days 10..15
  BW 11,253 allocated, 0 remaining, days 15..19
  TOTAL 51,274 demand = 51,274 allocated + 0 remaining
  0 over-capacity line-days · 0 days over factory capacity · 20 of 25 dates used
  ```

---

## 10. OPEN QUESTIONS / NEXT STEPS

1. **Tolerance at bucket boundaries** (business decision). The `TOLERANCE = 20`
   rule can strand ≤20 units at a BU→BV→BW boundary even when later dates are
   free. This is the pre-existing rule applying at a new boundary, and it did not
   trigger on the real workbook. Decide whether "must spill" should override
   tolerance there.
2. **BUG-8** — define the intended capacity basis, now easier post-BUG-1.
3. **README is stale** (608 lines): no mention of tests, architecture, API, run
   history or the performance work; still documents pre-Phase-2 behaviour as
   correct. Highest-value fix for portfolio/onboarding.
4. **No `server/.env.example`** — 9 app env vars undocumented: `MONGODB_URI`,
   `PORT`, `NODE_ENV`, `CORS_ORIGINS`/`CORS_ORIGIN`, `MAX_UPLOAD_BYTES`,
   `UPLOAD_RATE_MAX`, `UPLOAD_RATE_WINDOW_MS`, `WORKING_DAYS_SHEET`.
5. **No CI** — 167 tests run only manually.
6. **Dependencies**: `xlsx@0.18.5` has two high advisories with **no npm fix**
   (registry frozen; patched builds only on the SheetJS CDN). `multer` and
   `mongoose` have fixes available and sit on the request path. See
   `PHASE-4-SECURITY-AND-LIBRARY-REVIEW.md` — recommendation is patched-CDN
   SheetJS now, in-place zip patching later, not ExcelJS.
7. **Generated workbook is not re-downloadable** — it lives only in component
   state; leaving the upload screen loses it. Needs a store + download route.
8. **Read endpoints are not rate limited** (only `/upload` is).
9. **Vector visual identity / colour pass** — deliberately deferred. The current
   neutral system is intentional; do not restyle without being asked.
10. **Latent**: when `actualWorkingDays` exceeds available date columns, the daily
    target throttles output (measured 31% utilisation while reporting demand
    unschedulable). Real data has ~2.8× headroom, so it is not active.

---

## 11. SAFETY RULES FOR FUTURE CLAUDE SESSIONS

1. **Do not change allocation business rules without explicit confirmation** —
   line priority, fallback chains, capacity constants, tolerance, the working-day
   formula, and the BU/BV/BW→date mapping. They are business decisions.
2. **Never update a golden master just to make a test pass.** Diff it
   field-by-field first and explain *why* each change is correct business
   behaviour. An unexplained golden diff means stop and investigate.
3. **Investigate before fixing a suspected business-rule issue.** Produce
   evidence and ask; BUG-1, BUG-3 and BUG-8 were all resolved (or deferred) that
   way. Do not guess at intent.
4. **Preserve the existing API** unless explicitly asked to change it. The
   frontend, DB and tests depend on the documented shapes; `error` must stay a
   string.
5. **Run the full test suite after any allocation-engine change**, with MongoDB
   running so nothing skips. Expect **167/167**.
6. **Verify against the real workbooks in `uploads/`** for engine changes, and
   check the capacity invariant: no (date, line) may exceed `LINE_CAPACITY`, and
   no date may exceed 5,700 factory minutes.
7. **Do not commit or push unless explicitly instructed.** Do not force-push, do
   not delete `backup/pre-history-rewrite`, and do not delete the external mirror
   backup.
8. **Keep `uploads/` out of git.** It contains real production data; it is
   gitignored and must stay untracked. Never copy it into test fixtures — use the
   synthetic fixture builder in `test-support/workbook.js`.
9. **When a characterisation test fails after a fix, invert it — do not delete
   it.** That is the established protocol.
10. **`sample/sample.xlsx` is an intentional committed fixture** — do not remove it.
