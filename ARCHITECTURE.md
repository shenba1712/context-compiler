# Context Compiler — Architecture

Engineering companion to the [README](./README.md): system model, design decisions, invariants, and known limits. For install and operator setup, see the README.

---

## Problem and principles

Agents often ingest entire documents when only a fraction is relevant. Context Compiler is a **stateless preparation layer**: `(file, task, token_budget) → task-relevant markdown under a hard token budget`, plus an **omitted-sections manifest** so misses are visible and recoverable via `expand_section`.

Three principles constrain the design:

1. **Conversion is commodity; selection is the product.** MarkItDown is treated like an external binary (ffmpeg-style). Complexity budget goes to chunking, ranking, and packing.
2. **Trimming is transparent, never silent.** Lossy steps announce what was dropped and offer a recovery path — hence the omission manifest and `expand_section`.
3. **Local-first by default.** With no API key, the system makes zero network calls. LLM use (answer parity, agent loop) is opt-in. Ranking stays BM25.

---

## System model

Two thin entry points share one pipeline:

| Surface | Module | Trust model |
| --- | --- | --- |
| MCP (stdio JSON-RPC) | `server.ts` | Semi-trusted caller; paths confined to `CC_ROOT` via realpath |
| Web demo (Express) | `web.ts` | Untrusted uploader; upload handles only — never caller-supplied paths |

Both call `pipeline.ts`: convert → chunk → rank → pack. Conversion is content-addressed on disk; LLM features sit beside the pipeline for demos.

```
  MCP client ──► server.ts (stdio, path allowlist)
                        │
  Browser    ──► web.ts ─┤
                 (demo)  │
                         ▼
                   pipeline.ts
              convert → chunk → rank → pack
                    │              ▲
                    ▼              │
              cache.ts        log.ts / metrics.ts
                    │
                    ▼
              markitdown (Python subprocess)
```

No database, session store, or background worker. The pipeline is a pure function of its inputs plus the conversion cache. Horizontal scaling is mostly “run more copies.”

**Compile request (happy path):** hash file bytes → cache lookup → convert on miss (size-checked, time-boxed `execFile`, atomic write) → chunk on headings → BM25 rank (`tokenizeQuery` strips multilingual stopwords/fillers and expands honorific name forms; compound tasks split via `query-aspects`) → coverage-first pack under a content-token ceiling (document order restored) → return markdown, stats, omit buckets, and the omission manifest.

---

## Module responsibilities

### Tokens — `tokens.ts`

js-tiktoken cl100k, with a ~4 characters/token fallback if the encoder fails. Budgets are contracts of intent, not cryptographic guarantees; a few percent of drift versus another model’s tokenizer is expected. Demo metering uses `countContentTokens` (HTML comments / wrappers stripped) so omit-manifest ballast does not inflate Compile / Prove / Agent numbers.

### Convert — `convert.ts`

MarkItDown as an external binary via `execFile` (not a shell). Files are size-checked before spawn; stdout is capped; the process is killed on timeout. Failures collapse to `ConversionError` with a generic public message (no Python traceback, no absolute paths); detail goes to the logger. Empty converter output is a hard failure — markitdown can exit zero with empty stdout for a bare image when no OCR backend is configured. `converterAvailable()` probes `--version` with a short TTL for `/metrics` (never for `/healthz`).

### Chunk — `chunk.ts`

Single pass over markdown with a heading trail so each section carries a breadcrumb (`Contract > Termination > Notice`). Tables are atomic — a boundary never lands inside a `|...|` run. Oversized sections split on paragraph blocks; heading-less PDFs fall back to paragraph windows with `(no heading)` breadcrumbs. Default ~800 tokens per chunk so a 4k budget fits a handful of sections plus the manifest.

### Rank — `rank.ts`

Okapi BM25 (literature defaults, untuned, zero dependencies) plus a heading boost when query terms hit the breadcrumb. Unicode-aware tokenization: CJK runs emit character unigrams and bigrams; Latin tokens get a light stem; Arabic / Devanagari / Cyrillic stay script-aware. Queries go through `tokenizeQuery` (multilingual stopword/filler cleanup; Title-Case name pairs expand to honorific forms). Compound tasks split into sub-questions (`query-aspects.ts`, including non-English conjunctions) and interleave round-robin so each facet sees budget. An LLM shortlist rerank is deferred — compile must stay free of model quota.

### Pack — `pack.ts`

**Coverage-first** packing under a hard token ceiling (compile path meters **content** tokens of selected sections, not omit-manifest ballast). Priority order (never invert): multi-facet coverage → discriminative / name-intent goals → prefer a query-aware partial of a needed section over a weak whole that merely fits → stop when coverage is met (spare budget left unused) → vague/flat scores get capped recall insurance, never whole-corpus fill. After selection, assemble restores document order; manifest detail degrades in steps (40 → 20 → 10 → …) before content is sacrificed (**content beats metadata**). Relative floor / early-stop ratios still reject clear padding; they do not force fill-to-budget. Oversized rank-#1 gets a compact notice through degradation.

### Cache — `cache.ts`

Keys on sha256 of file bytes. Content-addressing means an edit never produces a stale hit (new bytes → new key). Writes use temp file + rename. Only conversion is cached; chunk/rank/pack are cheap and task-dependent.

Entries also age out by mtime (default 30 days) via a sweep triggered from `cachePut` (at most once per hour). That is disk hygiene for long-lived servers, not freshness logic — see ADR-006.

### Pipeline — `pipeline.ts`

Orchestrates stages. **Always ranks and packs** — there is no “raw ≤ budget → dump whole file” short-circuit (that path used to re-admit zero-relevance sections after a pointed query was already answerable). Results include applied budget, sub-queries, selected/omitted sections with relevance percentages, omit buckets (`budget_omitted_sections` / `relevance_omitted_sections`), compile hints (`early_stopped`, etc.), and optional query attribution for the demo. MCP strips duplicate section text before responding.

### LLM — `llm.ts`

Provider surface for opt-in features. Detection from env, tried in fixed priority: Gemini → OpenRouter → Anthropic → generic OpenAI-compatible, with automatic failover. Gemini expands into a short model-id list on the same key (defaults: `gemini-flash-lite-latest` → `gemini-3-flash-preview` → `gemini-flash-latest`). Soft 404 / “model not found” for Gemini is remembered in a process-local TTL (`CC_GEMINI_DEAD_MODEL_TTL_MS`, default 15 min). Soft 429/quota does not blacklist; a brief cooldown may run before the next chain entry (`CC_LLM_FAILOVER_COOLDOWN_MS`, default 1500 ms, capped at 10 s; prefers `Retry-After` when present). `answerModel()` reports the model that last succeeded on `complete()` when it is still in the chain.

### Agent — `agent.ts`

Demo-controlled loop over the same two tools MCP exposes. The web path uses the token-budget slider as both the first compile budget and a soft **content-token** reading ceiling (capped at file size). The loop stops *starting* new expands once `tokens_read` reaches that ceiling (an in-flight expand may finish slightly over). When start budget already equals the ceiling, recompile is omitted from the decide prompt. If pack left nothing omitted (tiny / fully covered docs), the agent answers once with `stopped_reason: "whole_file"`. Unusable decisions collapse to “answer with what we have.”

### Surfaces — `server.ts`, `web.ts`, guards

`server.ts` registers exactly two tools. `path-guard.ts` realpaths both root and target before the prefix check (closes symlink escape). Errors return in-band as `{error: ...}` JSON.

`web.ts` is upload-only and rate-limited per IP. Routes: `/api/compile`, `/api/expand`, `/api/answer`, `/api/measure`, `/api/samples`, `/api/config`, `/api/agent` (SSE; aborts LLM work on disconnect), `/api/agent-parity` (one-shot opaque handle after an agent run). Upload validation lives in `upload-guard.ts` (extension allowlist, magic bytes, archive decompression-bomb limit). Shared clamps live in `config.ts`; `env.ts` parses numbers safely so bad env cannot become NaN and silently disable rate limiting.

---

## Design decisions (ADRs)

| ID | Decision | Why |
| --- | --- | --- |
| ADR-001 / 002 | Buy conversion (MarkItDown); build selection | Rebuilding PDF/Office parsers would consume the entire complexity budget |
| ADR-003 | BM25 for ranking; embeddings deferred | Local-first and reproducible demos; embeddings imply heavy local install or mandatory network |
| ADR-004 | Heading-based chunking; atomic tables | Trust author segmentation; fixed windows destroy meaning; splitting tables silently changes answers |
| ADR-005 | Enforce budget on assembled output; compile meters content | Sum-of-chunks minus a constant overshot when the manifest grew; content metric keeps omit UX out of the ceiling |
| ADR-006 | Content-hash keys + age-out sweep | Edits cannot stale-hit; mtime sweep (`CC_CACHE_MAX_AGE_MS`) bounds disk on long-lived hosts without inventing freshness heuristics |
| ADR-007 | Coverage-first pack; no whole-file dump | Budget is a ceiling; pointed queries must not re-admit zero-relevance fillers when raw ≤ budget |
| ADR-008 | Local-first networking | No API key → no network; LLM features are opt-in |
| ADR-009 | Exactly two MCP tools | `compile_context` + `expand_section` close compress → inspect → recover; more tools dilute choice and expand surface |
| ADR-010 | Relative relevance floor + early stop | Absolute BM25 thresholds are uncalibrated; floor/early-stop bite only when scores have signal; flat scores use capped recall insurance |

**Provider failover as a chain** (newer than the numbered ADRs, same spirit): stay useful when a free tier fails; BM25 remains the offline floor.

---

## API contracts

### MCP

- **`compile_context`** — compiled markdown in untrusted-content markers; token stats; cache hit flag; applied budget; sub-queries; selected + omitted sections with relevance.
- **`expand_section`** — one section by id, or error plus full outline so the agent can self-correct. Budgets clamped; errors stay in-band as JSON.

### HTTP (demo)

| Route | Role |
| --- | --- |
| `POST /api/compile`, `/api/answer` | Multipart uploads |
| `POST /api/expand` | Re-reads only paths under the demo upload directory |
| `POST /api/measure` | Token counts for the budget slider |
| `GET /api/config` | Demo limits and LLM availability |
| `POST /api/agent` | SSE steps then final answer (optional `parity_handle` on `done`) |
| `POST /api/agent-parity` | Full file vs agent final context; one-shot (410 after consume or TTL) |
| `GET /healthz` | Cheap liveness (uptime only — no Python) |
| `GET /metrics` | Counters when `CC_METRICS_TOKEN` is set |

Status codes: 400 missing input, 403 path escape, 410 expired/consumed parity handle, 413 rejected upload, 422 conversion failure, 429 rate limit, 503 busy converter/LLM, 500 otherwise.

---

## Observability

`log.ts` writes only to stderr — MCP owns stdout; a test scan guards against stray stdout on the MCP path. Levels live-read from `CC_LOG_LEVEL`. Default human-readable lines; `CC_LOG_JSON=1` for one object per line. Error-level events may POST to `CC_LOG_WEBHOOK` (best-effort, never fails the request).

`metrics.ts` keeps in-process counters (compiles, expands, agent/parity runs, rate-limit hits, conversion failures, LLM failovers). Counters reset on restart and are not shared across replicas. Multi-replica deployments should push the same events to a metrics backend.

---

## Security model

| Actor | Trust | Constraint |
| --- | --- | --- |
| File content | Untrusted | Subprocess boundary, size/timeout/stdout caps |
| MCP caller | Semi-trusted | `CC_ROOT` after realpath |
| Demo uploader | Untrusted | Upload-only; magic-byte / zip-bomb checks |
| LLM provider | Trusted only after explicit key | Opt-in; keys stay server-side |

Prompt injection is mitigated by untrusted-content markers and prompt instructions, not a sandbox — the consuming agent remains the last line of defense. If injection or recall fails, the omission manifest and `expand_section` are the recovery path. Data leaves the machine only when an LLM feature is used. Public error messages stay generic; converter stderr is truncated before logging.

The hosted demo has no user accounts. Abuse posture is size caps, timeouts, per-IP rate limits, and LLM concurrency — appropriate for a public demo link, not multi-tenant SaaS.

---

## Failure modes and recovery

| Failure | Behavior |
| --- | --- |
| Converter missing / timeout / empty stdout | Hard error; generic client message |
| Converter busy (queue full) | 503-style busy |
| BM25 paraphrase miss | Manifest names omitted sections; expand / agent recover |
| Pack overshoot | Eviction loop + tests; must not return over budget |
| All LLM providers down | Prove / Agent fail; compile and MCP still run offline |
| Process restart | Uploads, parity handles, in-memory rate limits/metrics, and instance-local cache are ephemeral; next compile converts on miss |

**Disaster recovery.** GitHub is source of truth; Docker image + `render.yaml` rebuild the host. Secrets live in the host dashboard, not the repo. There is no database to back up. Not multi-region HA — intentional demo scope. Attach a volume if conversion cache should survive redeploys.

---

## Formats and clients

| Format | Behavior |
| --- | --- |
| DOCX / XLSX | Happiest paths — headings and tables survive |
| PPTX | Slide text kept; layout lost |
| Text-layer PDF | Often heading-less → paragraph windows |
| Scanned PDF / bare image without OCR | Out of scope; fail clearly |
| HTML / markdown / CSV / plain text | Near-lossless |

Any stdio MCP client works. Runtimes: Node 20+, Python 3.10+ for the converter only. LLM support is provider-agnostic; BM25 never needs a key.

---

## Known limits and deferred work

- **Recall** — BM25 can miss paraphrased relevance; mitigation is the manifest + `expand_section` (and Agent). Offline fixtures under `src/eval/` guard scenarios we care about, including a deliberate paraphrase miss that must remain expandable. Local embeddings as a second scorer are planned when they stay local-first.
- **Multi-hop compare** — compound queries split and interleave with facet-first packing, but a single pack can still under-serve “compare §2 with appendix C” when one facet dominates. Two calls remain a valid workaround.
- **Heading-less PDFs** — weaker chunks and weaker demo aesthetics.
- **Token drift** — cl100k vs other tokenizers: a few percent.
- **`expand_section` truncation** — character-ratio approximation, flagged in output.
- **OCR / media transcription** — deferred so a bad transcript cannot silently corrupt answers.
- **Hosted demo** — rate limits and cost caps, no accounts.

Untuned knobs (BM25 k1/b, heading boost, chunk size, relevance floor / early-stop / cluster ratios) are defensible defaults, not the output of a sweep.

---

## Testing posture

Plain `node:assert`, no framework. Coverage includes chunking invariants, multilingual/CJK ranking, query cleanup, packing under budget, offline recall@budget fixtures (`src/eval/`), cache, expand round-trips, real pptx/csv through markitdown, image-empty failure, path/upload guards, sanitized conversion errors, safe env parsing, OpenAI-compat and failover paths, agent loop + SSE, logger/webhook gating, metrics, and healthz.

Answer-parity equivalence is deliberately **not** asserted in CI — nondeterministic demonstration, not an invariant. Fallback contracts when the LLM path fails are asserted.

Conversion dominates latency and runs once per content hash. Chunk and BM25 are milliseconds at document scale. Pack eviction is negligible because the selected set is small.

---

## Ops knobs

Defaults operators most often care about. Full install and key setup live in the README.

| Variable | Default | Role |
| --- | --- | --- |
| `CC_CACHE_DIR` | `~/.cache/context-compiler` | Conversion cache root |
| `CC_CACHE_MAX_AGE_MS` | 30 days | Age-out for cached `.md` by mtime |
| `CC_CACHE_SWEEP_INTERVAL_MS` | 1 hour | Max sweep frequency (on `cachePut`) |
| `CC_MAX_FILE_BYTES` | 20 MB | Refuse before convert / upload |
| `CC_CONVERT_TIMEOUT_S` | 120 | Converter spawn timeout |
| `CC_MAX_CONCURRENT_CONVERSIONS` | 3 | Parallel Python procs |
| `CC_MAX_QUEUED_CONVERSIONS` | 12 | Queue depth before busy |
| `CC_RATE_LIMIT` | 100 / 5 min | Per-IP point pool (demo) |
| `CC_RATE_COST_AGENT` | 12 | Agent route cost |
| `CC_RATE_COST_ANSWER` | 4 | Answer / agent-parity cost |
| `CC_MAX_CONCURRENT_LLM` | 2 | Concurrent Prove/Agent jobs |
| `CC_GEMINI_DEAD_MODEL_TTL_MS` | 15 min | Skip soft-404 Gemini model ids |
| `CC_LLM_FAILOVER_COOLDOWN_MS` | 1500 (cap 10s) | Pause before next chain entry on soft 429 |
| `CC_METRICS_TOKEN` | unset | Enables Bearer-gated `/metrics` |
| `CC_RELEVANCE_FLOOR` | 0.4 | Relative pack / attribution floor |
| `CC_CLUSTER_RATIO` | 0.98 | Top-score cluster for early stop / recall insurance |
| `CC_EARLY_STOP_RATIO` | 0.5 | Legacy — ignored (coverage-first stop owns early-stop) |

Shared budget floors and the upload size cap live in `config.ts` so web slider and MCP clamps cannot drift.
