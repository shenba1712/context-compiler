# Context Compiler — Architecture & Design

This is the engineering companion to the [README](./README.md): why the system looks the way it does, what we traded away, and where the sharp edges still are. If the README is the story you tell a new user, this is the story you tell the next person who has to change the code.

---

## The problem we actually set out to solve

AI agents read files the way a tired intern photocopies an entire binder for one clause. For a twenty-thousand-token document and a task that touches five percent of it, roughly ninety-five percent of the input spend is waste — paid again on every read. Context Compiler is a deliberately small answer to that: a stateless preparation layer that turns `(file, task, token_budget)` into task-relevant markdown of a guaranteed size.

Three principles shaped every decision after that.

Conversion is commodity; selection is the product. We buy MarkItDown the way apps buy ffmpeg, and we spend our complexity budget on chunking, ranking, and packing.

Trimming must be transparent, never silent. Any lossy step has to announce what was lost and offer a recovery path. That is why every compiled response ends with an omitted-sections manifest, and why `expand_section` exists.

Local-first is the default, not a marketing line. With no API key configured, the system makes zero network calls. Sending content to an LLM — for answer parity or the agent loop — is strictly opt-in. Ranking stays BM25.

## The shape of the system

Two thin entry points share one pipeline. The MCP server (`server.ts`) speaks JSON-RPC over stdio to Claude Code, Cursor, Codex, and friends. The demo (`web.ts`) is an Express app that accepts uploads, never caller-supplied paths. Both call into `pipeline.ts`, which is convert → chunk → rank → pack, with a content-addressed disk cache under the convert step and an optional LLM surface for demos (answer parity, agent).

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

There is no database, no session store, no background worker. The pipeline is a pure function of its inputs plus the cache. Horizontal scaling is mostly “run more copies,” because there is almost nothing to coordinate.

A compile request hashes the file bytes, looks up converted markdown, converts on a miss (size-checked, time-boxed `execFile`, atomic cache write), chunks on headings, short-circuits if the whole document already fits the budget, ranks with BM25 (`tokenizeQuery` strips stopwords/fillers and expands honorific name forms), packs under the budget with document order restored, and returns markdown plus stats plus the omission manifest. That last piece is not a nicety. It is what turns a recall miss into something an agent can fix.

## How the pieces earn their keep

Token counting lives in `tokens.ts` behind js-tiktoken’s cl100k encoder, with a four-characters-per-token fallback if the encoder ever fails. Budgets are contracts of intent with the caller, not cryptographic guarantees. A couple of percent of drift versus another model’s tokenizer is expected and documented.

`convert.ts` treats markitdown as an external binary. We use `execFile`, not a shell, so filenames cannot inject commands. Files are size-checked before spawn, stdout is capped, and the process is killed on timeout. Failures collapse into a single `ConversionError` whose public message is deliberately boring — no Python traceback, no absolute server paths — while the real detail goes to the logger. Empty converter output fails loudly; we learned the hard way that markitdown can exit zero with nothing on stdout for a bare image when no OCR backend is configured. A quiet empty compile would be worse than an error. The same module also answers `converterAvailable()` for `/metrics`, with a short TTL so a probe does not spawn a process on every hit.

`chunk.ts` walks the markdown once, keeping a heading trail so every section carries a breadcrumb like `Contract > Termination > Notice`. Tables are atomic: a boundary never lands inside a `|...|` run, because dropping rows silently changes answers — the worst failure class for a tool whose pitch is “same answer.” Oversized sections split on paragraph blocks; heading-less PDFs fall back to paragraph windows with `(no heading)` breadcrumbs rather than refusing to work. Eight hundred tokens per chunk is a deliberate default: a four-thousand-token budget then fits a handful of sections plus the manifest, which is enough diversity for multi-facet questions without shredding clauses.

`rank.ts` is Okapi BM25 — literature defaults, untuned, zero dependencies — with one domain twist: query terms that appear in a chunk’s breadcrumb get a heading boost, because business documents put the truth in their titles. The tokenizer is Unicode-aware on purpose; a Latin-only split would score every chunk of a Hindi document at zero. CJK runs (no spaces) emit character unigrams and bigrams, and Latin tokens get a tiny stem (`returning` → `return`) so light paraphrases hit without a stemmer dependency. Queries go through `tokenizeQuery`: stopwords and filler noise are stripped, and Title-Case name pairs expand to honorific forms (Miss/Mr/Mrs Lastname) so novels that say “Miss Bennet” still match “Jane Bennet.” Compound tasks are split into sub-questions for BM25 and interleaved round-robin so each facet sees the budget. (An LLM shortlist rerank is a possible future opt-in; it is not shipped — compile must stay free of model quota.)

`pack.ts` is where the budget contract becomes real. An early version reserved a fixed number of tokens for the manifest and still overshot on large documents, because the manifest grows with the outline. The honest fix is to assemble the actual artifact — selected chunks in document order, breadcrumb comments, omission list — measure it, and evict the lowest-ranked selected chunk until the output fits. Manifest detail can also degrade in steps (forty lines, then twenty, then ten…) before content is sacrificed. A relative relevance floor stops the packer from padding a sharp query with weakly related runners-up; on flat score distributions nothing falls below the floor, so vague questions still fill the budget as insurance. Document order matters here too: models follow narrative better than a relevance-sorted collage, and the packet stops looking like a shuffled scrapbook.

`cache.ts` keys on sha256 of file bytes. No TTL, no invalidation logic, no staleness class of bugs — edit the file and you get a new key. Writes go through a temp file and rename so concurrent compiles cannot interleave partial markdown. Only conversion is cached; chunk, rank, and pack are milliseconds and depend on the task.

`pipeline.ts` orchestrates and enforces the passthrough rule. If the raw document fits the budget, ranking can only lose information, so we return everything. Results carry more than markdown now: the applied budget, the sub-queries we split into, selected and omitted sections with relevance percentages, and optional query attribution for the demo UI. MCP strips the duplicate section text before responding so the payload does not double in size.

`llm.ts` is the entire provider surface. Providers are detected from the environment and tried in fixed priority — Gemini, OpenRouter, Anthropic, then a generic OpenAI-compatible endpoint — with automatic failover. Gemini expands into a short model-id list on the same key (defaults: `gemini-flash-lite-latest` → `gemini-3-flash-preview` → `gemini-flash-latest`) so a retired free-tier id does not kill the slot. Soft 404 / “model not found” responses for Gemini are remembered in a short process-local TTL cache (`CC_GEMINI_DEAD_MODEL_TTL_MS`, default 15 minutes) so the next `complete()` skips that id without an HTTP call; 429/quota does not blacklist, but Gemini soft 429/quota waits briefly before the next chain entry (`CC_LLM_FAILOVER_COOLDOWN_MS`, default 1500ms, capped at 10s; prefers `Retry-After` when present). One free-tier wall should not take the feature down while another key still works. `answerModel()` reports the model that actually succeeded on the last `complete()` (when it is still in the chain), so UI badges do not stick on a dead primary after failover. If every provider fails, callers degrade: the answer panel reports the error, counters record the failover story.

`agent.ts` is the demo’s controlled agent loop over the same two tools the MCP surface exposes. The web demo passes the user’s token-budget slider as both the first compile budget and a soft reading ceiling (capped at file size). The model may expand omitted sections; the loop stops *starting* new expands once `tokens_read` reaches that ceiling (an in-flight expand may finish slightly over). When start budget already equals the ceiling — the web path — recompile is omitted from the decide prompt so the model cannot waste a turn on a no-op. If the whole file already fits, it short-circuits to a single full-file answer. Unusable decisions collapse to “answer with what we have.” The omitted-sections manifest is the map it navigates by. That is not a metaphor we added for the pitch; it is the reason the manifest exists in the product at all.

`server.ts` registers exactly two tools. Path access goes through `path-guard.ts`, which realpaths both the root and the target before the prefix check — closing the symlink-escape hole that a string-only comparison would leave open. Errors return as in-band JSON `{error: ...}` payloads; agents handle data better than protocol faults.

`web.ts` is the hosted surface: upload-only, rate-limited per IP (default pool 30 / 5 min; agent cost 12; answer/parity cost 4; `CC_MAX_CONCURRENT_LLM` default 2), with `/api/compile`, `/api/expand`, `/api/answer` (parity + optional `expanded_ids`), `/api/measure`, `/api/samples`, `/api/config`, `/api/agent` (SSE; aborts LLM work on client disconnect), and `/api/agent-parity` (one-shot opaque handle after an agent run). The demo is intentionally open for public judging (no shared passphrase); abuse posture is rate limits, size caps, and LLM concurrency. Request logging is selective on purpose — API traffic, non-GETs, and errors — so static asset noise does not drown the signal. Upload validation lives in `upload-guard.ts`: extension allowlists, magic-byte checks, and a decompression-bomb limit on archives before markitdown ever sees them. The browser UI is vanilla HTML and CSS plus a typed client compiled to plain scripts (`tsconfig.client.json`), deliberately free of a frontend framework. Compile packs strictly under the slider; omitted-section clicks are peeks by default (dismiss with ×); only **Include in Prove** populates `expanded_ids` for parity. Dual Prove buttons (quiet top vs results) compare full file vs compile(+included expands) — not Agent. Waiting states use a spinner banner, not buried status text. The page is an instrument for proving the pipeline, not a product surface that needs a design system.

Shared numbers — budget floors, relevance floor, max upload size — live in `config.ts` so the web slider and the MCP clamps cannot drift apart. `env.ts` parses numbers safely: non-numeric values warn and fall back instead of becoming NaN and silently disabling the rate limiter, which is a bug we found once and never want again.

## Logs and the light kind of observability

`log.ts` writes only to stderr. The MCP transport owns stdout; a stray `console.log` would corrupt JSON-RPC, and a source scan in the test suite guards that invariant on the MCP module path. Levels are live-read from `CC_LOG_LEVEL` so tests and deploys can change them without restarting a process graph. Human-readable lines are the default; `CC_LOG_JSON=1` emits one object per line for a drain. Error-level events may also POST to `CC_LOG_WEBHOOK` — best-effort, fire-and-forget, never able to fail the request they are describing. That is the whole alert path: one env var, no SDK, errors only.

`metrics.ts` keeps in-process counters — compiles, expands, agent runs, parity runs, rate-limit hits, conversion failures, LLM failovers. `GET /healthz` is a cheap liveness probe (uptime only) so platform health checks never wait on Python. Counters, `llm_configured`, and `converter_available` live behind `GET /metrics` when `CC_METRICS_TOKEN` is set. The counters reset on restart and are not shared across replicas; for a single-instance demo that is honest scope. A real multi-replica deployment would push the same events to a metrics backend instead of pretending process memory is a fleet view.

## Decisions we are willing to defend

Buying conversion and building selection (ADR-001, ADR-002) is the thesis of the project. Rebuilding PDF and Office parsers would have spent the entire complexity budget on someone else’s problem.

BM25 for ranking, embeddings deferred (ADR-003) is what makes local-first possible and demos reproducible. Embeddings either mean a heavy local install or a mandatory network call; BM25 plus a heading boost was enough on the corpora we ship.

Heading-based chunking with atomic tables (ADR-004) trusts the author’s own segmentation. Fixed windows destroy meaning; embedding chunking adds cost and nondeterminism we did not want on day one.

Enforcing the budget on the assembled output (ADR-005), not on a sum of chunk sizes minus a constant, is the only contract users can trust. The eviction loop exists because we shipped an overshoot once and wrote a regression test so it cannot quietly return.

Content-hash caching without TTL (ADR-006) chooses correctness by construction over freshness heuristics. Orphans accumulate; that is acceptable at this scale and visible with `du`.

Small-file passthrough (ADR-007) and local-first networking (ADR-008) are the same instinct: never do a lossy or privacy-touching step when you do not have to.

Exactly two MCP tools (ADR-009) is a product decision disguised as an API one. `compile_context` and `expand_section` form a closed compress → inspect → recover loop. Extra tools dilute agent tool choice and expand the threat surface.

The relevance floor (ADR-010) treats the budget as a ceiling. Absolute BM25 thresholds do not exist — scores are not calibrated — but a relative floor works, and it wisely does nothing when every chunk scores about the same.

Provider failover as a chain rather than a single-vendor bet is newer than the original ADRs, but it belongs with them: the product must stay useful when a free tier melts, and BM25 remains the final safety net.

## What the APIs promise

`compile_context` returns compiled markdown wrapped in untrusted-content markers, token stats, whether the cache fired, the budget actually applied, the sub-queries we split into, and selected plus omitted sections with relevance. `expand_section` returns one section by id, or an error plus the full outline so an agent can self-correct without a blind retry. Budgets are clamped into sane ranges; errors stay in-band as JSON.

On HTTP, `/api/compile` and `/api/answer` take multipart uploads; `/api/expand` re-reads only paths inside the demo’s own upload directory; `/api/measure` returns token counts for the budget slider; `/api/config` exposes demo limits and LLM availability; `/api/agent` streams SSE steps then a final answer (optional `parity_handle` on `done`); `/api/agent-parity` compares full file vs the agent’s final context once per handle (410 after consume or TTL); `/healthz` is the cheap probe. Status codes mean what you expect: 400 for missing input, 403 for path escape, 410 for expired/consumed parity handles, 413 for rejected uploads, 422 for conversion failure, 429 for rate limit, 503 for busy converter / LLM, 500 for the rest.

## How people actually use it

A developer adds one MCP config entry. Their agent discovers the tools and, on file questions, calls `compile_context` with a task and a budget derived from remaining context headroom. If the answer is thin, it reads the manifest and expands. The human’s workflow does not change.

A judge opens the hosted URL, picks a sample or uploads a file, asks a real question, and watches the bars and cost meter (spinner banner while Compile/Prove/Agent wait). With a key they prove parity on the compile path or run the agent (soft reading ceiling, SSE, optional Compare). With a rehearsed miss — vague question, tiny budget, or a lexical paraphrase — the manifest names the missing section; peek to inspect, Include in Prove if you want it in parity, or let Agent walk the same map. Failure, detection, recovery, all in band.

## Security, as we model it

File content is never trusted, at parse time or inside a model prompt. The MCP caller is semi-trusted and path-restricted. The demo uploader is untrusted and upload-only. LLM providers are trusted only after an explicit key is set.

Malicious documents hit a size cap (20 MB on the public demo), a timeout, a stdout cap, and a subprocess boundary; residual risk is memory abuse inside the converter, which a tighter sandbox would shrink. Prompt injection is mitigated by markers and prompt instructions, not by magic — the consuming agent is still the last line of defense, and we say so. If injection wins a round, the omitted-sections manifest and `expand_section` are the same recovery path as a recall miss. Path escape through symlinks is closed by realpath on both sides. Data leaves the machine only when someone opts into an LLM feature. The demo’s DoS posture is size caps, timeouts, per-IP rate limits, and an answer-context cost cap. There is still no user auth — the public URL is open by design for hackathon judging. Cache entries are content-addressed and locally trusted. Converter stderr is truncated before it becomes a log-injection vector; public error messages stay generic.

## Testing and performance, honestly

The suite uses plain `node:assert` and no framework so it stays readable. It covers chunking invariants, ranking (including multilingual scripts, CJK bigrams, light Latin stem, query stopword/filler cleanup, and honorific expansion), packing under budget, an offline recall@budget fixture suite under `src/eval/` (lexical hits, paraphrases that should hit, a paraphrase miss that must still expand-recover, multi-query, heading-less text, compare questions, and a tiny-budget miss that must still be recoverable via expand), cache hits, expand round-trips, real pptx and csv through markitdown, image-empty failure, path and upload guards, sanitized conversion errors, safe env parsing, OpenAI-compat and failover paths, the agent loop and its SSE endpoint, logger level gating and error-only webhooks, metrics snapshot semantics, and healthz. We deliberately do not assert answer-parity equivalence in CI — that is a nondeterministic demonstration, not an invariant — but we do assert the fallback contracts when the LLM path fails.

Conversion dominates latency and happens once per content hash. Chunk and BM25 are milliseconds at document scale. Pack’s eviction loop is negligible because the selected set is small. Untuned knobs (BM25 k1/b, heading boost, chunk size, relevance floor) are defensible defaults, not the output of a sweep. If someone asks whether we tuned them, the honest answer is no.

## Deployment and what “scale” would mean next

A Docker image with Node and markitdown is enough for the demo. Stateless app plus content-addressed cache means N replicas need nothing shared except, eventually, a shared cache volume if duplicate conversions bother you. The honest scale path, in order, is shared cache, the rate limits we already have, a conversion worker pool if CPU becomes the bottleneck, then corpus mode with a persistent chunk index. None of that is required at demo traffic. Observability today is stderr, an optional error webhook, `/healthz`, and token-gated `/metrics`; tomorrow it would be the same events pushed to a real metrics backend once more than one replica matters.

## Formats and clients

DOCX and XLSX are the happiest paths — headings and tables survive. PPTX keeps slide text and loses layout. Text-layer PDFs often arrive heading-less and fall back to paragraph windows. Scanned PDFs and bare images without OCR are out of scope and fail clearly. HTML, markdown, CSV, and plain text are near-lossless. Video and audio would be a transcription head on the same pipeline when we choose to spend that complexity.

Any stdio MCP client works. Runtimes are Node 20+ and Python 3.10+ for the converter only. LLM support is provider-agnostic by design: Gemini and OpenRouter as the recommended free pair, Anthropic and OpenAI-compatible endpoints as further links in the chain, BM25 as the floor that never needs a key.

## Known limitations, ranked by real risk

Recall is still the category risk. BM25 can miss paraphrased relevance (query “falling ill” vs passage “unwell” / “wet through”); the manifest makes that miss visible and `expand_section` makes it repairable, which is mitigation rather than a guarantee. An offline fixture suite under `src/eval/` guards the scenarios we care about — including a deliberate paraphrase miss that must remain expandable, plus honorific/filler query-cleanup hits. Embeddings remain the planned second scorer when they can stay local-first without blowing free-tier RAM.

Multi-hop comparison questions are better than they were — compound queries split and interleave, and the agent loop can expand on purpose — but a single greedy pack can still under-serve a “compare §2 with appendix C” task. Two calls remain an honest workaround.

Heading-less PDFs still degrade chunk quality and demo aesthetics; pick headed demo files when you can. Token-count drift versus non-cl100k tokenizers is a few percent. `expand_section` truncation is a character-ratio approximation, flagged in the output. The hosted demo has no user accounts. CJK ranking uses character bigrams now; residual weakness is mostly domain paraphrase and heading-less layout, not “CJK is unscored.”

None of those are secrets. They are the edges of a system that chose transparent lossiness, local-first defaults, and a two-tool API over the temptation to look larger than it is.
