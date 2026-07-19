# Context Compiler — AUDIT-CURRENT

**Date:** 2026-07-19  
**Scope:** Full Jul-18 principal-engineer break-test suite replayed on the **current working tree** (coverage-first packing rewrite + prior hardenings), plus packing/product matrix streams.  
**Method:** Static review + live HTTP probes (`PORT=18765`) + unit/integration suite (`npm test`) + pack-matrix.  
**Reference:** Jul-18 canvas findings P1–P16 (`break-test-audit.canvas.tsx`).

**Companion audits:** [UI / UX](./AUDIT-UI.md) · [Security / Chaos / Config](./AUDIT-SECURITY.md)

**Verdict:** Jul-18 ship blockers (P0) and most P1/P2 hardenings **still hold** after the packing rewrite. One **new P1 DR hole** found and fixed this pass (corrupt conversion cache served as truth). Residual risk is mostly economic (no auth), prompt injection by design, and single-instance demo ops — not path escape.

---

## Jul-18 findings: status after packing rewrite

| ID | Sev | Title | Status 2026-07-19 |
|----|-----|-------|-------------------|
| P1 | P0 | Agent/answer under-metered LLM spend | **FIXED (holds)** — weighted costs (agent 12, answer 4), `CC_MAX_CONCURRENT_LLM`, disconnect abort |
| P2 | P0 | Large upload RAM before converter queue | **FIXED (holds)** — `multer.diskStorage`, fieldSize 32kb |
| P3 | P1 | `/api/answer` raw `Error.message` leak | **FIXED (holds)** — `errorResponse()` on answer/parity/compile |
| P4 | P1 | Budget contract when nothing fits | **FIXED (holds)** — stub ≤ budget; live probe `pack@80 → 74 tok` |
| P5 | P1 | Memory bomb mitigation Linux-only | **OPEN (accepted)** — documented; ZIP precheck + refuse unreadable Office ZIPs |
| P6 | P1 | `CC_TRUST_PROXY=true` kills rate limits | **FIXED (holds)** — ignored unless `CC_ALLOW_INSECURE_TRUST_PROXY=1` |
| P7 | P2 | `/healthz` recon | **FIXED (holds)** — liveness only `{status,uptime_s}`; `/metrics` token-gated |
| P8 | P2 | Unbounded rate-limit Map | **FIXED (holds)** — `CC_RATE_MAP_MAX` + sweep |
| P9 | P2 | Agent ignores client disconnect | **FIXED (holds)** — `AbortSignal` on SSE close |
| P10 | P2 | Docker drops ARCHITECTURE.md | **FIXED (holds)** — `.dockerignore` `!ARCHITECTURE.md`; live 200 |
| P11 | P2 | Prompt injection + filename reflection | **MITIGATED (holds)** — UNTRUSTED markers + `sanitizeSourceName`; residual model steering |
| P12 | P2 | Compile JSON duplicates section text | **OPEN (accepted for web UI)** — MCP strips; web keeps text for cards (tested) |
| P13 | P3 | CI without `NODE_ENV=test` | **FIXED (holds)** — workflow runs `npm test` |
| P14 | P3 | Handles/rate limits die with process | **OPEN (accepted)** — single-instance demo assumption |
| P15 | P3 | Client ignores 429/503 | **FIXED (holds)** — `apiFailureMessage` + Retry-After hints |
| P16 | P3 | No LLM fetch timeout | **FIXED (holds)** — `CC_LLM_TIMEOUT_MS` + AbortSignal |

**Regressions of Jul-18 hardenings:** none found.

**New this pass:**

| ID | Sev | Area | Title | Status |
|----|-----|------|-------|--------|
| N1 | P1 | DR / cache | Corrupt `.md` cache payload served without integrity check → wrong/missing answers | **FIXED now** — `${key}.sha` sidecar; miss + delete on mismatch; legacy unverified miss |
| N2 | P2 | Docs / UX | Floor note “whole file fit” assumed old short-circuit; packing is coverage-first | **FIXED now** — only when `omitted_sections.length === 0` |
| N3 | P2 | MCP honesty | Tool text said “fitted under budget” but wire markdown includes omit manifest | **FIXED now** — description clarifies content ceiling vs wire |
| N4 | P3 | Config honesty | `earlyStopRatio` / `saturationStopRatio` documented as active but unused | **FIXED now** — marked legacy/ignored |
| N5 | P3 | Pack comments | “no second partials” contradicted Policy B facet partials | **FIXED now** |

---

## 1. Load & stress

### Solid
- Converter admission: 8 parallel xlsx compiles → **4×200 + 4×503** with `CC_MAX_CONCURRENT_CONVERSIONS=2` / queue 2.
- Rate limit: 20 compiles under `CC_RATE_LIMIT=15` → **5×200 + 15×429**, `Retry-After` set.
- Oversized form field (40k task) → **413** JSON, no HTML stack.
- Budget clamps: `0`/`neg`/`1` → floor; `1e9` → `MAX_TOKEN_BUDGET`; NaN/str → default.
- Huge budget does **not** dump 0% sections (FY25@200k → 1 sel, early_stopped).

### Fixed now
- (none beyond Jul-18 disk uploads)

### Still fragile
- Pathological **encode cost**: packing / tiktoken on multi‑10k-char synthetic blobs can stall a worker for a long time (local probe hung on `x.repeat(50000)`). Upload size limits help; malicious huge *converted* markdown still expensive.
- In-memory rate limits / handles: multi-replica undercount (P14).

### Out of scope
- Distributed load test / k6 against Render production.

---

## 2. Chaos engineering

### Solid
- Malformed multipart / no file → 400.
- Client abort on Prove/Agent → server abort (signal wired).
- Missing LLM keys → 400 with key guidance, no secret leak.
- Converter busy → 503, not hang forever.

### Still fragile
- Mid-convert kill leaves orphan upload files until TTL sweep (expected).
- LLM upstream hang mitigated by timeout, but free-tier provider 429s still confuse judges (copy acknowledges this).

### Out of scope
- Kill -9 during rename of cache tmp (atomic rename already reduces window).

---

## 3. Disaster recovery

### Solid
- Cache keyed by source sha256; edit source → new key.
- Atomic put (`renameSync` + pid-scoped tmp).
- Missing sample/file → ENOENT / ConversionError (sanitized on HTTP).
- Process restart: handles/parity expire (documented single-instance).

### Fixed now
- **Cache integrity (N1):** corrupted or legacy unverified `.md` → miss + delete; next compile reconverts.

### Still fragile
- Disk-full during convert: best-effort; may 500. No dedicated disk-pressure admission beyond upload size.
- Wipe of `CC_CACHE_DIR` is the operator recovery path (now also auto on integrity fail).

### Out of scope
- Multi-AZ shared Redis for handles.

---

## 4. Config & env

### Solid
- `intEnv`/`numEnv` NaN-safe with warn + default.
- `trustProxyFromEnv` refuses blanket `true`.
- Knobs: `CC_RATE_*`, `CC_MAX_CONCURRENT_*`, `CC_LLM_*`, `CC_METRICS_TOKEN`, `CC_ROOT`, `CC_CACHE_DIR`, `CC_MAX_FILE_BYTES`, floors.
- `/api/config` exposes rate costs for UI honesty.

### Fixed now
- Dead pack knobs labeled legacy (N4).

### Still fragile
- `CC_CACHE_DIR` must be set **before** long-lived process assumptions elsewhere; cache now re-reads dir live (improved).

---

## 5. Agentic testing

### Solid
- Soft ceiling = start budget; expands repack under content metric.
- `maxSteps` / bad JSON → answer; query_miss expand rolls back.
- Substance-only context (no omit-manifest ballast) for Prove parity metering.
- Disconnect abort; weighted rate cost.

### Still fragile
- Prompt injection via document → model may still expand attacker-chosen ids (UNTRUSTED is advisory).
- Agent “whole_file” path only when pack selects everything — rare under coverage-first (good); copy must not imply short-circuit dump.
- Adversarial empty/vague queries → recall insurance (≤2 sections); not a dump, but not “zero work” either.

### Out of scope
- Red-team LLM jailbreak scoring.

---

## 6. Security

### Solid
- MCP `checkPathWithin` realpath confinement + symlink escape tests.
- Upload magic / ZIP bomb heuristics; content-type mismatch reject.
- Opaque upload handles; expand path confined to upload dir.
- CSP / nosniff / frame deny; static sample traversal → 404.
- Webhook path redaction; conversion errors path-free.
- `sanitizeSourceName` blocks comment/XSS breakout in headers.

### Still fragile
- **No auth** on public demo — rate limits only.
- Prompt injection residual (P11).
- markitdown subprocess is not a full sandbox (Linux ulimit helps).
- SSRF: no user URL fetch in app code (good); webhook URL is operator-controlled.
- Deep dive: [AUDIT-SECURITY.md](./AUDIT-SECURITY.md).

### Out of scope
- Attacking hosted production; writing exploit PoCs.

---

## 7. Penetration / hacking (local, defensive)

### Probes run
| Probe | Result |
|-------|--------|
| Forged expand handle | 404 |
| Sample path `../package.json` | 404 |
| XSS-ish filename | Sanitized to safe basename |
| Burn $ via agent under rate limit | Weighted cost blocks cheap multi-agent |
| OOM via many memory uploads | Mitigated by disk storage |
| Escape `CC_ROOT` via symlink | Denied (tests) |
| Metrics without token | 404 |
| healthz spam | 200 liveness only (no llm_configured) |

### Still scares you
- Determined abuser with many IPs / spoofed proxy if operator sets insecure trust.
- Bill drain if `CC_RATE_LIMIT` raised carelessly with a live key.
- Cache poisoning **was** real until N1 — treat disk cache as adversarial surface.

---

## 8. UI/UX adversarial

### Solid
- Question soft-stale vs budget stale vs doc-change hard clear (`client-ux.ts` contracts + app mirrors).
- Peek kept on Include uncheck; Prove/Agent disabled when question-stale.
- Prove errors local (`.prove-err`); 429/503 hints.
- Omit buckets: budget vs relevance; truncated “Include rest / Peek rest”.
- Hero Pride numbers match pack-matrix (`19612 → 775`, ~96%).
- Skip link, aria-live regions, focus to results heading.

### Fixed now
- Whole-file floor note gated on no omissions (N2).
- Pipeline copy: “Pack under a token ceiling” (not fill-quota language).

### Still fragile
- Prove vs Agent conceptual confusion for first-time judges (copy helps; still two LLM surfaces).
- `selected_sections[].text` doubles payload on mobile (P12 accepted).
- See [AUDIT-UI.md](./AUDIT-UI.md) for open UX items (O1–O10).

---

## 9. AI / pack quality streams

### Solid
- Coverage-first, early-stop, no whole-doc dump, budget = ceiling.
- Multi-facet: aspect split, `query_best_ids` uniqueness heuristics, Policy B partials, omit buckets.
- Tiny budgets: FY25/revenue @100 prefer 100% partial over mid-score wholes.
- Metering: `tokens_used` ≈ `selected_content_tokens`; Prove/Agent parity within slack.
- Multilingual pointed/vague matrix: `whole_doc=0 short_circuit=0 unstable_rows=0/17`.
- `npm test` coverage pack matrix + recall 22/22 (as of last green run).

### Fixed now
- Stale pack/MCP/config comments (N3–N5).

### Still fragile
- Sherlock pointed ids can shift between budgets while count stays stable (matrix “stable_ids” allows that).
- `queryBestIds` uniqueness not hard-guaranteed for all corpora — facet collision remains a quality risk.
- Empty query → recall insurance selects top cluster (not crash; not empty).

---

## 10. Live probe snapshot (this session)

```
healthz                 200 {"status":"ok","uptime_s":…}
metrics (no token)      404
ARCHITECTURE.md         200
forged expand           404
field too long          413
sample traversal        404
8 parallel compiles     {200:4, 503:4}
rate burn 20            ok=5 limited=15
pack nothing-fits @80   under budget (74)
FY25@200k               1 section, 0% fillers omitted
trustProxy true alone   false
```

---

## Fixes landed in this audit pass

1. **`src/cache.ts`** — integrity `.sha` sidecar; live `CC_CACHE_DIR`; purge on mismatch.
2. **`src/tests/test.ts`** — real corruption regression test.
3. **`src/client/app.ts`** — whole-file floor note only if nothing omitted; honest 0% comment.
4. **`src/server.ts`** — MCP budget/content honesty in tool description.
5. **`src/config.ts`** — legacy early/saturation stop knobs labeled unused.
6. **`src/pack.ts`** — Policy B second-partial comment corrected.
7. **`public/index.html`** — pack step copy = ceiling, not fill.
8. **`README.md`** — one-line link to this audit.

---

## What still scares (blunt)

1. **Hosted demo = shared key + no auth.** Rate weights help; they do not make it safe to leave unlocked with a paid key.
2. **Prompt injection** will always be a demo narrative risk; markers are not enforcement.
3. **tiktoken / pack CPU** on huge converted text can still stall a free-tier dyno.
4. **Multi-instance** rate limits and handles remain process-local.

---

## How to re-run

```bash
npm test
npm run lint && npm run format:check
# pack matrix:
npm run build && node --eval "import('./dist/eval/pack-matrix.js').then(m=>m.printPackMatrix())"
# optional live probes: start web on a high PORT with low CC_RATE_LIMIT / converter caps
```

Do not treat this file as a commitment to bank-grade security. It is an honest break-test ledger for the current tree.
