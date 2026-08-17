# Phase 4 — Security Findings & Library Review

Two investigations, both **inspection only**. No history was rewritten and no
library was changed.

---

# Part 8 — Repository data exposure

## 1. What sensitive or oversized files are tracked

| Path | Tracked files | Notes |
|---|---|---|
| `uploads/` | **14** | Real production planning workbooks, ~21 MB on disk |
| `server/node_modules/` | **1,277** | Vendored dependencies |
| `client/node_modules/` | 1 | A single stray file |

The `uploads/` workbooks are the serious item. They contain customer names, part
specifications, cycle times and production volumes — the same data the audit
found in `JUNE SUMMARY`, `SPEC` and the `CONSIST` sheets.

Note: all 14 files are **not** 14 distinct workbooks. Several share a blob hash
(e.g. `028b6bae…`, `0ac4d598…` and `21409929…` all point at git object
`642057e7…`), so git stores 4 unique workbooks.

## 2. Are they in current history?

Yes, and they are **already pushed to a remote**.

```
origin  https://github.com/vijaykrishna68/Vector_UPDATE
```

| Ref | Upload files present |
|---|---|
| `origin/updatedbranch` (default) | 14 |
| `origin/ai-integration` | 14 |
| `origin/copilot/mongo-db-schema-explanation` | 14 |
| `origin/HEAD` | 14 |

First introduced in commits `7cb6454` ("altered and properly working algorithm
and Mongodb save") and `2d82449` ("Refactor code structure…"). Four commits touch
`uploads/`; three touch `server/node_modules/`. Total pack size is 13.4 MiB, most
of which is these two directories.

**⚠️ Verify the repository's visibility before anything else.** If
`github.com/vijaykrishna68/Vector_UPDATE` is public, this data is already
disclosed and the response is a disclosure process, not just a history rewrite.
That determination has to come from whoever owns the GitHub account — I cannot
establish it from inside the repository.

## 3. What would have to be removed

- every blob under `uploads/` across all history
- every blob under `server/node_modules/` and `client/node_modules/`
- the rewrite must cover **all four remote branches**, not just `updatedbranch`

`.gitignore` already prevents *new* additions — verified:

```
uploads/newfile.xlsx          -> ignored (.gitignore:15)
server/node_modules/x/y.js    -> ignored (.gitignore:2)
server/.env                   -> ignored (.gitignore:9)
```

So this is purely a history problem; the working tree is correctly configured.

## 4. Do credentials need rotating?

**No credentials were found in tracked source.** A scan of every tracked
non-lockfile file for connection strings, `password=`, `api_key`, `secret=` and
PEM headers returned nothing. `.env` is untracked; only `.env.example` is
committed, and it contains placeholders.

Two caveats:
- The scan covers the **current tree**, not every historical revision. Before
  declaring this clear, run a history-wide scan (`gitleaks detect`, or
  `git log -p -S 'mongodb+srv'`).
- The workbooks themselves are the sensitive asset. They cannot be "rotated" —
  the only remedies are removal from history and, if the repo was public,
  notifying whoever owns that data.

## 5. Proposed remediation (requires explicit approval — NOT executed)

1. **Determine repository visibility.** Public means treat as disclosed: involve
   the data owner and follow their disclosure process. Private means the exposure
   is limited to collaborators, which is materially less severe.
2. **Inventory collaborators and forks.** A rewrite cannot reach forks or clones
   that already exist. If the repo is public, assume copies exist.
3. **Take a full backup** — `git clone --mirror` to offline storage — before
   touching history.
4. **Run a history-wide secret scan** so the rewrite removes everything needed in
   one pass rather than requiring a second one.
5. **Rewrite with `git-filter-repo`** (not `filter-branch`), removing
   `uploads/`, `server/node_modules/`, `client/node_modules/` from all refs.
6. **Force-push every branch and tag**, then ask GitHub Support to garbage-collect
   the unreachable objects — otherwise the blobs stay reachable by SHA through the
   web UI and API even after the rewrite.
7. **Every collaborator must re-clone.** A `git pull` after a rewrite will
   reintroduce the old objects via their local refs. Their old clones must be
   deleted, not merged. Any open PR will need recreating against the rewritten
   history.
8. **Add a pre-commit guard** (e.g. a size/path check) so a workbook cannot be
   committed again.
9. **Keep test fixtures synthetic.** The Phase 0 test suite already reads
   `uploads/` in place and never copies it, and its golden file is gitignored — so
   removing `uploads/` only causes that optional suite to skip.

**Sequencing note:** step 6 (force-push) invalidates every open branch. Coordinate
it as a scheduled operation, not an ad-hoc one.

---

# Part 9 — `xlsx@0.18.5`: options review (no change made)

## The current situation

`xlsx` is the **only** dependency with no fix available:

```
xlsx  high  fixAvailable: false
  - Prototype Pollution in sheetJS   (GHSA-4r6h-8v6p-xvw6)
  - SheetJS ReDoS                    (GHSA-5pgg-2g8v-p4x9)
```

Both are fixed upstream in 0.19.3+ / 0.20.x, but **SheetJS stopped publishing to
npm after 0.18.5**. The npm registry version is permanently vulnerable; releases
moved to `https://cdn.sheetjs.com`.

## The decisive constraint: pivot tables are ALREADY lost

Re-verified on the current code against a real workbook — SheetJS rebuilds the
file rather than patching it, so a round-trip drops:

```
input part types: 22   ->   output part types: 11
LOST: xl/pivotTables/*, xl/pivotCache/*, xl/calcChain.xml,
      xl/sharedStrings.xml, xl/printerSettings/*, customXml/*,
      xl/worksheets/_rels/*
```

This reframes the whole decision. **Pivot-table preservation is not something a
library swap would protect — it is something already broken that only a different
*writing strategy* can fix.** Any library that parses to a model and re-serialises
will lose the same parts.

## Options

### A. Patched SheetJS from the vendor CDN

| | |
|---|---|
| Pivot preservation | ❌ No change — same rebuild-on-write model |
| Workbook fidelity | Same as today |
| Code compatibility | ✅ Near-zero: same API, `allocation.js` untouched |
| Performance | ✅ Same or better |
| Security | ✅ Fixes both advisories |
| Complexity | 🟡 Low-medium: install from a URL, not the registry |

The registry-free install (`npm i https://cdn.sheetjs.com/xlsx-0.20.x/xlsx-0.20.x.tgz`)
means `npm audit` no longer tracks it, CI must reach that host, and Dependabot
cannot see it. **This is the cheapest way to close the two advisories.**

### B. ExcelJS

| | |
|---|---|
| Pivot preservation | ❌ Not supported — ExcelJS does not model pivot tables |
| Workbook fidelity | 🟡 Better styles; still loses unmodelled parts |
| Code compatibility | ❌ Full rewrite of parse/write: different cell addressing, async API, and `allocation.js` depends on `XLSX.utils` and the `sheet['A1']`/`!ref` model throughout |
| Performance | 🟡 Streaming reader is good; whole-workbook mode is heavier |
| Security | ✅ Actively maintained on npm |
| Complexity | 🔴 High — and the golden masters would need careful re-verification |

Buys maintained-on-npm status at the cost of touching the one file that must not
change behavior. **Not justified by security alone.**

### C. Patch the XLSX zip in place

Treat the workbook as a zip, rewrite only the sheet XML parts the allocator
touches, leave every other part byte-identical.

| | |
|---|---|
| Pivot preservation | ✅ **The only option that preserves them** |
| Workbook fidelity | ✅ Highest possible — untouched parts are copied verbatim |
| Code compatibility | 🟡 Keep SheetJS for *reading*; replace only the write path |
| Performance | ✅ Likely faster than a full rebuild |
| Security | 🟡 Reading still needs a patched parser (so pairs with A) |
| Complexity | 🔴 High — hand-editing sheet XML, shared strings and calcChain invalidation |

The correct long-term answer for workbook fidelity, and the only one that solves
the pivot loss planners actually feel. Deserves its own phase.

### D. Retain 0.18.5 with the current hardening

Current state. Phase 1 added magic-byte validation, extension and MIME checks, a
size ceiling, rate limiting and `Object.keys` iteration in the extent scan (so a
polluted prototype cannot inject a phantom cell). Uploads are also
planner-supplied rather than anonymous.

Residual risk: both advisories are reachable by any user who can upload, and
"trusted users" is a weak control.

## Recommendation

**A now, C later, not B.**

1. **Short term:** adopt the patched CDN build (A). It closes both advisories with
   essentially no code change and no risk to `allocation.js`. Document the
   non-registry install and pin the tarball hash.
2. **Separate phase:** implement in-place zip patching (C) to stop destroying
   pivot tables, printer settings and `customXml`. This is a *data-fidelity*
   project, not a security one, and should be scoped with the planner — they
   should confirm how much they rely on those pivots.
3. **Reject B:** ExcelJS costs a rewrite of the highest-risk file and does not
   solve pivot preservation either.

## Related dependency finding (outside Part 9's scope)

`xlsx` is the only dependency **without** a fix. Several others have fixes
available and are worth a routine patch bump:

| Package | Severity | Fix available |
|---|---|---|
| `multer` | high | ✅ (5 DoS advisories) |
| `path-to-regexp` | high | ✅ |
| `brace-expansion`, `minimatch`, `picomatch` | high | ✅ (dev-tree) |
| `mongoose` | moderate | ✅ (prototype pollution in update casting) |
| `body-parser`, `qs` | moderate | ✅ |

`multer` and `mongoose` sit directly on the request path. I did **not** run
`npm audit fix` — bumping them is a dependency decision that was not part of this
phase's brief and needs its own verification pass against the test suite.
