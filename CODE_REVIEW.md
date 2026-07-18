# Context Compiler — Code & Design Analysis

**Scope:** the whole TypeScript codebase (`src/**`, `src/client/**`) plus build/config.
**Method:** stricter `tsc` passes (`--noUnusedLocals --noUnusedParameters
--noImplicitReturns --noFallthroughCasesInSwitch --exactOptionalPropertyTypes`),
grep-based duplication/magic-number scans, manual review, and an independent
second-pass logic review of the core algorithm files. Findings that were traced to
concrete triggering inputs are marked "verified".

**Overall:** the code is in good shape — no `any`, no `TODO`/dead blocks, no stray
`console.log` (only the startup banner), atomic cache writes, thoughtful comments,
and the security/UX passes already hardened the edges. What remains is mostly
**DRY/consistency debt from features landing in layers**, a handful of **real
edge-case logic bugs**, **no linter/formatter**, and a few **system-design gaps**
(unbounded cache, wasted recomputation) that matter once this runs hosted at scale.

Severity: **High** = wrong results or crash on plausible input; **Medium** = wrong
under misconfig/edge input or notable maintainability risk; **Low** = polish.

---

## A. Logical errors & corner cases

### A1. `CC_RELEVANCE_FLOOR` NaN silently changes behavior — two different ways — **Medium** (verified)
`rank.ts:127` and `pack.ts:186` both do `Number(process.env.CC_RELEVANCE_FLOOR ?? 0.15)`.
A non-numeric value (`0.2x`, a trailing space, `15%`) → `NaN`:
- `pack.ts:192` gate is `… && floor > 0`; `NaN > 0` is `false` → the **relevance floor
  silently turns off** (budget fills with low-relevance chunks).
- `rank.ts:132` uses `x.s >= floor`; `x.s >= NaN` is always `false` → **every chunk gets
  `matched_queries: []`** (attribution collapses).

Same misconfig, two divergent silent failures. This is the exact NaN footgun the
security pass fixed for `CC_RATE_LIMIT` — but `env.ts`'s `numEnv` was never applied here.
**Fix:** read it once via `numEnv("CC_RELEVANCE_FLOOR", 0.15, 0, 1)` in a single shared
location (see C1) and pass it down.

### A2. Relevance floor is bypassed while nothing is selected — an oversized top section can ship an irrelevant chunk — **Medium** (verified)
`pack.ts:192`: `if (scores && top > 0 && selected.length > 0 && floor > 0)`. The
`selected.length > 0` guard skips the floor until something is selected. Normally the
top-scored chunk is selected first, so it's harmless — but if the top chunks are all
**oversized** (each `tokens > usable`), the loop keeps seeing `selected.length === 0`
and skips the floor for every subsequent chunk, so a tiny **below-floor, irrelevant**
chunk gets admitted and becomes the only content.
Trigger: a large highly-relevant section (bigger than the budget) followed by a small
irrelevant one. Impact: compiled output is a single irrelevant chunk. The oversized
notice mitigates the *messaging* but the delivered content is still wrong.
**Fix:** apply the floor independent of `selected.length` (a chunk below `floor*top`
should be skipped even as the first candidate); rely on the oversized-notice path to
explain the empty/near-empty result.

### A3. Cache temp-file collision under concurrent compiles of the same new file — **Medium** (verified)
`cache.ts:27` uses a fixed temp name `${key}.md.tmp`. Two concurrent `compileContext`
calls on the same *uncached* file write the same temp path simultaneously; their bytes
interleave and the `renameSync` can publish a truncated/corrupted `.md`. The rename is
atomic but the shared temp name defeats it.
**Fix:** unique suffix, e.g. `${key}.${process.pid}.${randomBytes(4).hex}.tmp`.

### A4. `Math.max(0, ...array)` can overflow the stack on a huge chunk count — **Low** (verified)
`rank.ts:53,105,116,154`, `pipeline.ts:71`, `pack.ts:187` spread the full per-chunk
array into `Math.max`. A document that chunks into tens/hundreds of thousands of
sections throws `RangeError: Maximum call stack size exceeded`, crashing the compile
instead of degrading. **Fix:** a small `maxOf(arr)` reduce helper, used everywhere.

### A5. `splitBlocks` merges blank-separated tables and bakes blanks into the table — **Low** (verified)
`chunk.ts:30-46`: once `inTable`, a blank line falls through to the `else` and is pushed
into the table block (staying `inTable`). Two blank-separated tables under one heading
become one "atomic" block with embedded blank lines — not what the doc comment implies.
**Fix:** treat a blank line as a table terminator when `inTable`.

### A6. Split oversized section: part 0 exceeds `MAX_CHUNK_TOKENS` — **Low** (verified)
`chunk.ts:120-123`: blocks are packed to `MAX_CHUNK_TOKENS`, then the heading is
prepended to part 0 *after* packing, so part 0 = `limit + heading tokens`. The
"≤ MAX_CHUNK_TOKENS" invariant isn't actually held (also when a single table block
alone exceeds the limit). Low impact (downstream handles oversized chunks) but the
invariant is documented and relied on mentally. **Fix:** account for the heading before
packing part 0, or document that the cap is soft.

### A7. `reduction_pct` can be `NaN`/negative on degenerate budgets — **Low** (verified)
`pipeline.ts:117-118`: with a pathological `tokenBudget` (e.g. negative) and an
empty-ish file, `rawTokens` can be `0` while the `else` branch runs → `0/0` → `NaN`;
`tokens_saved` can go negative when wrapper+manifest exceed raw content. Only reachable
with degenerate input (the web/MCP clamps mostly prevent it), but a guard (`rawTokens > 0
? … : 0`) is cheap.

---

## B. Clean-code / DRY violations

### B1. The 50 MB file limit is hard-coded in 3 independent places — **Medium**
`convert.ts:21` (`CC_MAX_FILE_BYTES`, env-driven), `web.ts:38` (multer
`fileSize: 50*1024*1024`, literal), `app.ts:97` (`MAX_FILE_BYTES`, literal). They can
drift: raising the env limit wouldn't lift multer's cap, so uploads would still be cut
at 50 MB with a confusing error. **Fix:** single server constant (multer reads the same
`CC_MAX_FILE_BYTES`); the client copy is unavoidable (no shared module) but should be
commented as "must match server" like `ALLOWED_EXT_RE` already is.

### B2. `clampBudget` has three different floors for the same tool — **Medium**
`web.ts:161` floors at **100**; `server.ts:20/38` floors MCP compile at **500** and
expand at **200**; the UI slider min is **200**. So the minimum budget silently depends
on which entrypoint you use, and the web path (100) contradicts the slider (200).
There are also two separate `clampBudget` implementations with different signatures and
NaN behavior (`server.ts`'s `Math.max(lo, Math.min(Math.trunc(NaN), …))` → `NaN`).
**Fix:** one `clampBudget(v, floor)` in a shared module with one documented floor.

### B3. Relevance-floor logic duplicated across `rank.ts` and `pack.ts` — **Medium**
Both read the env var independently (see A1) and both encode the `floor * top`
semantics. **Fix:** export a single `relevanceFloor()` (or pass the value through
`pipeline.ts`, which already owns the multi/rerank decision).

### B4. `env.ts` helpers exist but aren't used consistently — **Medium**
The security pass added `intEnv`/`numEnv` and applied them in `web.ts`/`convert.ts`, but
`rank.ts`/`pack.ts` still use raw `Number(process.env…)`. Inconsistent parsing is how
A1 survives. **Fix:** route every numeric env var through `env.ts`.

### B5. The `4000` default budget appears in 5 places — **Low**
`pipeline.ts:47`, `web.ts:162`, `server.ts:33`, `app.ts:222`, `app.ts:234`. Mostly
benign, but a "default budget" constant would keep them honest. (Client copies are
unavoidable; server-side ones can share.)

### B6. Repeated `section.split(" > ").pop()` idiom — **Low**
Appears ~8× in `app.ts` and `pack.ts` to get the leaf heading. A `leafHeading(bc)`
helper would de-duplicate and centralize the empty/`(no heading)` handling.

---

## C. Simplification opportunities

### C1. Centralize configuration. A small `config.ts` (or extending `env.ts`) holding
budget floors/defaults, the file-size limit, and the relevance floor would collapse
B1–B5 into one source of truth and remove the raw `Number(env)` calls.

### C2. `web.ts` `errorResponse` already maps `UploadRejected`, but `guardUpload` also
maps it separately (`web.ts:138`). Once `guardUpload` runs before every handler, the
`UploadRejected` branch inside `errorResponse` is dead defensive code — either keep it
and drop the one in `guardUpload`, or vice versa, but not both.

### C3. `pack.ts` recomputes `manifestLines(ranked, 0)` and re-`countTokens` the whole
manifest on every eviction iteration; the reserve estimate could be computed once and
the loop could binary-search the degrade steps rather than rebuild+re-tokenize the full
output up to O(n) times (see D2).

---

## D. Architecture & system design

### D1. The conversion cache grows unbounded forever — **Medium (design)**
`cache.ts` is content-addressed and explicitly "no TTL, no invalidation." The security
pass added a TTL sweeper for the *upload* dir but not for the *conversion cache*
(`~/.cache/context-compiler`, `/tmp/cc-cache` in Docker). On a long-lived hosted demo
every distinct file ever uploaded leaves a permanent `.md` — slow disk exhaustion, the
same class of issue #5 in the security audit but for the other directory.
**Fix:** an LRU/size cap or a TTL sweep on the cache dir too (or accept it and document
that the cache dir must be on ephemeral storage with a cap).

### D2. Packing is O(n·T) in the worst case, and multi-query recomputes BM25 ~3× — **Medium (perf)**
- `pack.ts` eviction loop pops one chunk per iteration (up to n) and each iteration
  rebuilds the full assembled string across 5 degrade steps and `countTokens` it — so
  ~O(n · total_chars) for a pathological tight-budget/large-doc case.
- `pipeline.ts:69,75,106`: `multiScores`, `queryAttribution`, and `rankMulti` each walk
  the sub-queries calling `bm25Scores`, which re-tokenizes every chunk and rebuilds the
  `df` map from scratch. A 6-way split = ~18 full BM25 passes; the `perQueryScores`
  computed at line 69 is thrown away and recomputed at 75.
**Fix:** compute `perQueryScores` once and derive `multiScores`/`queryAttribution`/rank
from it; memoize tokenization per chunk. Bounded today by the 120 s timeout, but it's
avoidable work on the hot path.

### D3. In-process state doesn't survive multiple replicas — **Low (design, documented)**
Rate-limit `hits`, the converter concurrency gate, the `handles` map, and `samplesCache`
are all per-process. Correct for one replica (already noted in comments), but horizontal
scaling needs shared state (Redis) — flag in the deploy docs so it isn't a surprise.

### D4. `app.ts` is a 760-line single module — **Low (design)**
By design it's a no-bundler global script, so it can't `import`. Still, it mixes samples,
budget presets, rendering, API calls, and the compile lifecycle. If a bundler ever gets
added, split into modules; until then, section headers/region comments would help
navigation. Acceptable given the stated constraint.

### D5. Capability description drift — **Low**
`server.ts:35` describes `compile_context` as accepting "pdf/docx/xlsx/pptx/html/csv/
images/…", and `index.html` hero pipeline still says "PDF, docx, xlsx, pptx, **images**"
— but images are now explicitly rejected (no OCR backend). The MCP tool description and
that one hero line should drop "images" to match reality.

### D6. `expandSection` returns `Record<string, unknown>` — **Low**
`pipeline.ts:128` is loosely typed while everything around it is precise; the client
even has an `ExpandApiResult` interface it could mirror. A shared/echoed return type
would catch drift between server and client.

---

## E. Lint / type-strictness / tooling

### E1. No linter or formatter configured — **Medium**
No `eslint`/`prettier` config or `lint` script. For a codebase this careful, a linter is
cheap insurance and would have caught A4/E2 automatically. **Fix:** add ESLint
(`@typescript-eslint`) + Prettier and a `npm run lint` step in CI (`.github/workflows`).

### E2. `--noImplicitReturns` fails in `web.ts` — **Low**
Handlers/middleware at `web.ts:82,210,221,243,264` mix `return res.json(...)` in some
branches with a bare `res.json(...)` fall-through. Not a bug (Express ignores the return)
but inconsistent and flagged by strict settings. **Fix:** `return` consistently, and
consider enabling `noImplicitReturns` in `tsconfig.json`.

### E3. Consider enabling the stricter flags permanently — **Low**
`noUnusedLocals`/`noUnusedParameters` already pass; `noImplicitReturns` and
`noFallthroughCasesInSwitch` are free wins once E2 is fixed.

---

## F. Dead code / errors / warnings

- **No dead code found** — strict unused-locals/params passes clean; no `TODO`/`FIXME`,
  no commented-out blocks, no unused exports of note. Good.
- **Warnings handled well** — swallowed catches were already given `console.warn` in the
  earlier pass; the tokenizer/rerank fallbacks log once. No regressions here.
- **Minor:** `tokens.ts:32` returns `1` for `""` via the fallback path but `0` via the
  encoder path — harmless inconsistency.

---

## Prioritized fixes

1. **A1 + B3 + B4** — route `CC_RELEVANCE_FLOOR` through `numEnv` in one place (kills a
   silent-wrong-results footgun and three duplications at once).
2. **A2** — floor bypass on oversized top chunks (silent wrong content).
3. **A3** — unique cache temp name (concurrency corruption).
4. **B1 + B2** — unify the file-size limit and `clampBudget` floors (one config module).
5. **D1** — cap/sweep the conversion cache dir.
6. **E1 + E2** — add ESLint/Prettier + fix the return consistency; wire into CI.
7. **D2** — compute `perQueryScores` once; memoize tokenization.
8. **A4–A7, B5, B6, D5, D6** — polish as time allows.

## Strengths (don't regress)

No `any`; atomic cache writes; content-addressed dedupe; Unicode-aware tokenization;
relevance floor as recall-safe (relative, not absolute); the "content beats metadata"
packing invariant with a regression test; provider-agnostic LLM layer; sanitized errors;
and a genuinely thorough test suite (17 tests) that already locks in the trickiest
behaviors. The issues above are refinements on a solid base, not rework.
