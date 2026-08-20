# BUG-1 Investigation — Week/Date-Column Collision

**Status: NOT FIXED. Deliberately left unchanged — the correct mapping is a planner decision.**

This document records what the code does today, the evidence that a per-week
offset was intended, a concrete example from a real workbook, and the exact
questions that must be answered before the fix can be written.

---

## 1. What the current code does

`AllocationEngine.run()` processes the three week columns **BU, BV, BW** in a
loop. For each week it:

1. parses that week's demand,
2. allocates it against a **freshly initialised** daily capacity model
   (`lineDayMinutes` is rebuilt per week, every line back to full capacity),
3. calls `writeWeekAllocations(sheet1, parts, dateCols, startDateCount)`.

`writeWeekAllocations` writes each allocation to:

```
row    = part.rowIndex                    (the part's own row)
column = dateCols[allocation.dayIndex]    (dayIndex 0 => column CU)
```

Every week's `dayIndex` starts at **0**, and `dateCols` is the *same* array for
all three weeks. The write accumulates rather than replaces:

```js
const prev = existing && typeof existing.v === 'number' ? existing.v : 0;
sheet1[addr] = { v: prev + a.qty, t: 'n' };
```

So all three weeks write into the same columns starting at CU, and their
quantities are **summed** into one cell.

## 2. Evidence that a per-week offset was intended

**a. A dead parameter that carries exactly the needed value.**
`writeWeekAllocations(sheet1, parts, dateCols, startDateCount)` is called as:

```js
this.writeWeekAllocations(sheet1, allocation.parts, dateCols, actualWorkingDays);
```

`startDateCount` is never read in the function body. Its name ("start date
count") and its argument (`actualWorkingDays`, the length of the preceding
week's schedule) are consistent with a running column offset that was planned
and never implemented.

**b. Each week resets capacity, which only makes sense on distinct days.**
The allocator enforces per-line daily minutes, but rebuilds that model from
scratch for each week. If all three weeks genuinely shared the same physical
days, the capacity check would have to be cumulative across weeks. It is not.

**c. The output is physically impossible.** See §3.

**d. The date columns are wide enough for a sequential layout.**
25 date columns exist; the three weeks need 21 (days actually opened) or 19
(`actualWorkingDays`). A sequential layout fits with room to spare.

**e. The week columns are calendar-labelled and distinct.**
Row 3 of the schedule sheet labels the week columns:

| Column | Label (row 3) |
|---|---|
| BS | JUNE WK3 |
| BT | JUNE WK4 |
| **BU** | **JUNE WK3&4** |
| **BV** | **JULY WK1** |
| **BW** | **JULY WK2** |
| BX | JULY WK3 |
| BY | JULY WK4 |

These are three different calendar periods, not three views of one period.

## 3. Concrete example (real workbook `028b6bae…`, 30 sheets)

Date columns run **2025-06-02 → 2025-07-02** (25 working days; weekends absent).

Per-week day usage, all starting at day 0:

| Week | Label | SUM | actualWorkingDays | day indexes written |
|---|---|---|---|---|
| BU | JUNE WK3&4 | 27,123 | 10 | 0–10 |
| BV | JULY WK1 | 12,898 | 5 | 0–5 |
| BW | JULY WK2 | 11,253 | 4 | 0–3 |

**50 of 335 written cells receive quantities from more than one week.** Examples:

```
CU7  (row 7,  2025-06-02, spec 1E0736-16): BU=232 + BV=243 + BW=74  -> cell reads 549
CU10 (row 10, 2025-06-02, spec 1E0743-5) : BU=316 + BV=111 + BW=115 -> cell reads 542
CU11 (row 11, 2025-06-02, spec 1E02786-12): BU=16 + BV=21           -> cell reads  37
CU13 (row 13, 2025-06-02, spec 1E0716-20): BU=109 + BV=133 + BW=8   -> cell reads 250
```

All four cells were empty before the run, so the planner sees a single blended
number per date with no way to tell which week it came from.

**The resulting schedule cannot be executed.** Total factory capacity is
5,700 minutes/day (1425 + 1900 + 950 + 1425). Summing the three weeks' minutes
onto shared days gives:

| day | date | minutes committed | vs 5,700 capacity |
|---|---|---|---|
| 0 | 2025-06-02 | 9,103 | **over by 3,403** |
| 1 | 2025-06-03 | 8,656 | **over by 2,956** |
| 2 | 2025-06-04 | 9,399 | **over by 3,699** |
| 3 | 2025-06-05 | 10,985 | **over by 5,285** |
| 4 | 2025-06-06 | 6,682 | **over by 982** |
| 5–10 | 06-07 … 06-13 | 32–4,819 | ok |

**5 of 11 scheduled days are over capacity**, one by nearly a full extra day of
factory output. Each week individually respects capacity; the collision is
introduced purely by the writer.

## 4. What is needed from the planner

The fix is a few lines. Choosing *which* few lines is a business decision, and
these are the open questions:

1. **Which rule places each week's first day?**
   - **(a) Sequential:** BV starts where BU finished, BW where BV finished.
     Offset by `actualWorkingDays` (19 total) or by days actually opened,
     including tolerance-extension days (21 total)? These differ whenever a week
     extends past its planned days, which BU and BV both do here.
   - **(b) Calendar-aligned:** each week starts at the date column matching its
     label ("JUNE WK3&4" → the first working day of June week 3, i.e. ~2025-06-16).
     This conflicts with the observed data: the date block starts 2025-06-02,
     which is June **week 1**, and it ends 2025-07-02 — too early to hold
     "JULY WK2" at all.

2. **Why does the date block start 2025-06-02 when the first week column is
   "JUNE WK3&4"?** Is production deliberately scheduled ahead of the demand
   week, or is the date block simply a rolling production window that is not
   meant to align with the week labels?

3. **What happens when the weeks do not fit?** 21 days fit in 25 columns here,
   but if a sequential layout overflowed, should the last week be truncated,
   overlapped, or reported as an error?

4. **Should the other week columns be handled?** The sheet also carries BS
   (JUNE WK3), BT (JUNE WK4), BX (JULY WK3), BY (JULY WK4), and the summary
   sheet has a fourth row "JULY WEEK 3 & 4" with no engine mapping. The engine
   currently handles exactly BU/BV/BW. Is that the intended scope?

Until questions 1 and 2 are answered, any offset implementation would be a
guess, and a wrong guess writes a wrong production plan.

## 5. Related finding (not BUG-1)

The identified working-days sheet ("JUNE SUMMARY ", column I) stores
**fractional** working days computed as `Total Schedule / 3000`:

| row | week | Total Schedule | planner's value | engine writes |
|---|---|---|---|---|
| 4 | JUNE WEEK 3 & 4 | 28,348 | 9.449 | **10** |
| 5 | JULY WEEK 1 | 12,995 | 4.332 | **5** |
| 6 | JULY WEEK 2 | 13,289 | 4.430 | **4** |

The engine writes `ceil(SUM/3000)` and so overwrites the planner's fractional
figure with a rounded one. The working-day calculation was explicitly out of
scope for this phase, so it is unchanged — but the planner should confirm
whether the rounded value is wanted in that cell.

The engine's own `SUM` also differs from the sheet's "Total Schedule" for the
same week — e.g. JULY WEEK 2 (BW): sheet 13,289 vs engine 11,253 — because the
engine excludes rows whose cycle time is invalid (270 such rows across the three
weeks). That difference is documented in the test suite and is likewise
unchanged; it is worth confirming with the planner whether those rows should
count toward demand.
