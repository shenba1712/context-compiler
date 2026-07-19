# Architecture Decision Records

**Status:** Living set  
**Companion:** High-level table also summarized in `ARCHITECTURE.md`  
**Format:** Context → Decision → Consequences (amendments noted where shipping behavior evolved)

---

## ADR-001 — Buy conversion (MarkItDown)

**Context:** Supporting PDF/Office well enough for demos would consume the entire complexity budget if built in-house.

**Decision:** Treat MarkItDown as an external converter binary (ffmpeg-style) via `execFile`, not a shell pipeline and not a custom Python package in-tree.

**Consequences:** Node owns selection; ops must install Python + markitdown (or use Docker). Converter failures and empty stdout become hard errors with sanitized messages. Format quality tracks MarkItDown.

---

## ADR-002 — Build selection (chunk → rank → pack)

**Context:** Conversion alone does not solve token waste; the product is task-aware packing under a budget.

**Decision:** Invest engineering in `chunk.ts`, `rank.ts`, `pack.ts`, and `pipeline.ts` rather than parser fidelity.

**Consequences:** Clear module boundaries; ranking/packing are testable without network. Conversion cache is the only expensive stage worth disk persistence.

---

## ADR-003 — BM25 ranking; embeddings deferred

**Context:** Embeddings imply a heavy local model or mandatory network — both conflict with local-first demos and CI without secrets.

**Decision:** Okapi BM25 with literature defaults, heading boost, Unicode-aware tokenization, and query cleanup. No LLM shortlist on the compile path.

**Consequences:** Offline, reproducible, free compile. Paraphrase misses remain possible; mitigation is the omission manifest + `expand_section` (and Agent). Local embeddings stay a future option if they remain local-first.

---

## ADR-004 — Heading-based chunking; atomic tables

**Context:** Fixed-size windows destroy section meaning; splitting markdown tables silently changes answers.

**Decision:** Single-pass heading trail with breadcrumbs; never place a boundary inside a table run; oversized sections split on paragraphs; heading-less PDFs fall back to paragraph windows.

**Consequences:** Better narrative packs for structured docs; weaker aesthetics/recall for heading-less PDFs (accepted).

---

## ADR-005 — Enforce budget on assembled output

**Context:** Sum-of-chunk-tokens minus a constant overshot once the omission manifest and wrappers grew.

**Decision:** Count tokens on the fully assembled artifact; evict lowest-ranked selected chunks until it fits; degrade manifest detail in steps before sacrificing content. Regression tests lock the contract.

**Consequences:** `tokens_used` can exceed the sum of section bodies (documented in UI). Pack never returns over budget when tests pass.

---

## ADR-006 — Content-hash cache keys + age-out sweep

**Context:** Initially, content-addressing alone was enough for correctness (edits → new key → no stale hit). Long-lived servers still accumulated `.md` files forever.

**Decision:** Key conversions by sha256(file bytes); atomic temp+rename writes. **Amendment:** age out by mtime (`CC_CACHE_MAX_AGE_MS`, default 30 days) via a sweep triggered from `cachePut` at most once per hour — disk hygiene, not freshness logic.

**Consequences:** Correctness stays hash-based; operators can bound disk without inventing TTL-as-freshness. Short CLI runs rarely pay for sweeps.

---

## ADR-007 — Small-file passthrough

**Context:** Ranking is lossy. If the whole document already fits the budget, loss is unjustified.

**Decision:** When `raw_tokens ≤ token_budget`, skip rank/pack loss and return everything assembled.

**Consequences:** 0% reduction is a valid success; UI must not treat it as failure. Agent can short-circuit to a whole-file answer in the same spirit.

---

## ADR-008 — Local-first networking

**Context:** The headline product path must work without API keys or cloud accounts.

**Decision:** No API key → no LLM network calls. Compile/MCP always offline. Prove and Agent are opt-in.

**Consequences:** CI can prove the core path with zero secrets. Hosted demos degrade gracefully when keys are absent (`llm_available: false`).

---

## ADR-009 — Exactly two MCP tools

**Context:** More tools dilute agent choice and expand security/UX surface.

**Decision:** Expose only `compile_context` and `expand_section`, closing compress → inspect → recover.

**Consequences:** Agent demo reuses the same two tools. New capabilities prefer composing these rather than adding a third MCP verb without strong need.

---

## ADR-010 — Relative relevance floor

**Context:** Absolute BM25 thresholds are uncalibrated across documents and languages.

**Decision:** Relative floor (`CC_RELEVANCE_FLOOR`, default 0.4 × top score) stops packing weak runners-up when scores have a clear peak; on flat distributions the floor does nothing so recall is preserved.

**Consequences:** Sharp queries pack tighter; vague queries still fill budget. Same ratio feeds multi-query attribution.

---

## ADR-011 — Provider failover chain *(amendment)*

**Context:** Early demos often assumed a single provider. Free-tier outages, retired model ids, and 429s made Prove/Agent brittle.

**Decision:** Detect providers from env and try in fixed priority: Gemini (expanded model-id list on one key) → OpenRouter → Anthropic → generic OpenAI-compatible. Soft Gemini “model not found” ids are remembered process-locally (`CC_GEMINI_DEAD_MODEL_TTL_MS`). Soft 429/quota is not blacklisted; a short cooldown may apply before the next chain entry (`CC_LLM_FAILOVER_COOLDOWN_MS`, prefers `Retry-After`).

**Consequences:** Better uptime for opt-in features without making compile depend on any provider. Operators can pin models via env overrides. Process-local dead-model cache resets on restart.

---

## ADR-012 — Soft agent reading ceiling *(amendment)*

**Context:** An unbounded expand loop can burn tokens and free-tier quota. A hard cut mid-expand is awkward.

**Decision:** On the web path, the token-budget slider is both the first compile budget and a soft ceiling on cumulative `tokens_read`. The loop stops *starting* new expands once at/over the ceiling; an in-flight expand may finish slightly over. When start budget already equals the ceiling, omit recompile from the decide prompt. Unusable model decisions collapse to “answer with what we have.”

**Consequences:** Aligns Agent with Compile UX; predictable cost vs unbounded exploration. Slight overshoot is documented in UI copy.

---

## ADR-013 — Opaque upload handles (not `file_path`) *(amendment)*

**Context:** Returning server filesystem paths to the browser leaked layout and invited arbitrary path probing.

**Decision:** Mint unguessable handles mapped in memory to upload paths; expand and parity resolve only through that map with a directory prefix check.

**Consequences:** Clients cannot name paths. Handles are ephemeral (TTL / restart). Measure and compile both mint handles for the same content-addressed bytes when possible.

---

## ADR-014 — Peek vs Include in Prove *(amendment)*

**Context:** UI expands were first used for human inspection. Folding every peek into Prove silently inflated the “compiled” side and muddied the demo claim.

**Decision:** Peeks load section text for reading only. Only sections marked **Include in Prove** are sent as `expanded_ids` and merged into the compiled parity context (capped).

**Consequences:** Prove stays honest to “compile + deliberate includes.” Agent remains a separate path that expands on its own.

---

## ADR-015 — NaN-safe env parsing and cautious trust proxy *(amendment)*

**Context:** `Number("off")` is NaN; comparisons against NaN silently disable rate limits. Blanket `trust proxy: true` lets clients spoof IPs.

**Decision:** Centralize `intEnv` / `numEnv` with fallbacks; default trust proxy false; ignore `CC_TRUST_PROXY=true` unless an explicit insecure override is set; prefer hop count `1` behind Render.

**Consequences:** Deploy typos fail safe; rate limits remain meaningful on public URLs when proxy is configured correctly.
