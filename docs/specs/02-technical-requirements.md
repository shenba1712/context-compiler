# Technical Requirements

**Status:** Current  
**Applies to:** `src/server.ts` (MCP), `src/web.ts` (demo), shared pipeline modules

---

## 1. Runtime

| Component | Requirement |
| --- | --- |
| Node.js | `>=20` (`package.json` `engines`); CI uses 20; Docker image uses Node 22 slim |
| TypeScript | Built with `tsc` (+ client project `tsconfig.client.json`) |
| Python | 3.10+ with `markitdown[docx,pdf,xlsx,pptx]` on `PATH` (or `CC_MARKITDOWN_CMD`) |
| Process model | Single Node process; converter via `execFile` subprocess; no DB, no worker queue service |

MCP and web share `pipeline.ts`. Horizontal scale = more replicas (in-memory rate limits / metrics / handles are per-instance).

---

## 2. Functional requirements

| ID | Requirement |
| --- | --- |
| F1 | Convert supported office/text formats to markdown via MarkItDown; cache by content hash. |
| F2 | Chunk markdown with heading breadcrumbs; keep tables atomic; split oversized sections. |
| F3 | Rank with BM25 (+ heading boost, multilingual query cleanup, multi-query interleave); no LLM on compile path. |
| F4 | Pack **coverage-first** under a content-token ceiling; assemble restores document order; manifest degrades before content eviction. |
| F5 | Never whole-file-dump when `raw_tokens ≤ budget` — zero-relevance fillers stay omitted after a pointed query. |
| F6 | MCP: path confinement under `CC_ROOT` with realpath. |
| F7 | Web: multipart upload only; opaque handles for expand; never accept caller paths. |
| F8 | Optional LLM chain for Prove / Agent with concurrency gate and AbortSignal on disconnect. |
| F9 | Split omitted sections into budget-relevant vs lower-relevance buckets for demo UX. |

---

## 3. Performance and abuse budgets

Budgets are contracts of intent for a public demo / local tool — not cloud SLOs.

| Control | Default | Notes |
| --- | --- | --- |
| Max upload / convert file | 20 MB (`CC_MAX_FILE_BYTES`) | Enforced before convert and in multer |
| Convert timeout | 120 s (`CC_CONVERT_TIMEOUT_S`) | Process killed on timeout |
| Convert concurrency | 3 active / 12 queued | Excess → busy (HTTP 503) |
| Convert memory cap | ~1.5 GB virtual (Linux `ulimit -v`) | Zip-bomb backstop |
| ZIP uncompressed / ratio | 150 MB / 200× | Pre-spawn upload guard |
| Token budget clamp | web floor 100; MCP compile 500; expand 200; ceiling 200k | Shared in `config.ts` |
| LLM timeout | 30 s (`CC_LLM_TIMEOUT_MS`) | Merged with client abort |
| Concurrent LLM jobs | 2 (`CC_MAX_CONCURRENT_LLM`) | Prove / Agent / agent-parity |
| Answer context cap | 60k tokens (`CC_ANSWER_CONTEXT_CAP`) | Full-file side of parity truncated |
| Rate limit pool | 30 points / 5 min / IP | Agent cost 12; answer/parity 4; else 1 |
| Upload TTL | 30 min (`CC_UPLOAD_TTL_MS`) | Disk + handle sweep |
| Agent parity handle TTL | 15 min; max 200 entries | One-shot consume on success |
| Conversion cache age-out | 30 days mtime; sweep ≤1/hour on put | Disk hygiene, not freshness |

Latency expectations (informal): conversion dominates first hit; chunk/BM25/pack are milliseconds at document scale; cache hit makes re-compile near-instant for the same bytes.

---

## 4. Reliability

| Concern | Behavior |
| --- | --- |
| Converter missing / empty stdout / timeout | Hard `ConversionError`; generic client message |
| Converter saturated | `ConverterBusyError` → 503 + `Retry-After` |
| LLM soft failures | Failover along Gemini → OpenRouter → Anthropic → OpenAI-compat; Gemini dead-model TTL; short cooldown on soft 429 |
| All LLM providers down | Prove/Agent fail; compile/MCP remain offline |
| Client disconnect mid-Prove/Agent | AbortController cancels in-flight `complete()` |
| Process restart | Uploads, handles, rate maps, metrics, instance cache under `/tmp` are ephemeral |

---

## 5. Observability

| Channel | Behavior |
| --- | --- |
| Logging | stderr only (`log.ts`); MCP must not pollute stdout. Levels via `CC_LOG_LEVEL`; optional `CC_LOG_JSON=1`; optional error webhook `CC_LOG_WEBHOOK` |
| Request log (web) | API paths, non-GET, or status ≥400 |
| Metrics | In-process counters (`metrics.ts`); `GET /metrics` Bearer-gated when `CC_METRICS_TOKEN` set |
| Liveness | `GET /healthz` — uptime only; **never** spawns Python |

---

## 6. Security baselines

See also [11-threat-model.md](./11-threat-model.md).

- Upload: extension allowlist + magic-byte / ZIP bomb checks (`upload-guard.ts`).
- MCP: `checkPathWithin` realpath before prefix check.
- Web: CSP, `X-Frame-Options: DENY`, nosniff, COOP; `x-powered-by` disabled.
- Trust proxy: default false; Render sets hop `1`; blanket `true` requires explicit insecure override.
- Public errors sanitized (no Python traceback, no absolute paths).
- API keys server-side only; never returned to the browser.
- Document content treated as untrusted in LLM prompts (`UNTRUSTED` markers / instructions).

---

## 7. Configuration classes

Group env vars by role (defaults live in code / Dockerfile / `render.yaml`; not every knob needs operator attention).

| Class | Examples | Purpose |
| --- | --- | --- |
| **Core paths** | `CC_ROOT`, `CC_CACHE_DIR`, `CC_MARKITDOWN_CMD` | Confinement and converter |
| **Abuse / capacity** | `CC_MAX_FILE_BYTES`, convert concurrency/queue, rate costs, LLM concurrency | Demo hardening |
| **Pack / rank** | `CC_RELEVANCE_FLOOR`, budget floors in `config.ts` | Selection quality |
| **Cache hygiene** | `CC_CACHE_MAX_AGE_MS`, `CC_CACHE_SWEEP_INTERVAL_MS` | Long-lived disk |
| **LLM** | Provider keys, model overrides, failover TTL/cooldown, timeout | Opt-in Prove/Agent |
| **Ops** | `PORT`, `CC_TRUST_PROXY`, `CC_METRICS_TOKEN`, `CC_LOG_*` | Hosting |
| **Demo economics** | `CC_DEMO_PRICE_PER_MTOK` | Illustrative cost labels only |

`env.ts` rejects non-numeric values (NaN-safe) so a typo cannot silently disable rate limiting.

---

## 8. Compatibility requirements

Summarized in [04-compatibility-matrix.md](./04-compatibility-matrix.md): Node 20+, Python 3.10+, Docker/Render for hosted demo, stdio MCP clients, modern evergreen browsers for the demo UI.
