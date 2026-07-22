# Context Compiler — Future work

Working roadmap for what comes after the current ship. Companion to [ARCHITECTURE.md](../ARCHITECTURE.md) and [specs/01-prd.md](./specs/01-prd.md). Relative phases only — no calendar dates.

**North star:** Stay the local-first preparation layer between agents and long documents: `(file, task, token_budget) → task-relevant markdown + omit manifest`, with recovery via `expand_section`. Make that loop trustworthy enough that real IDE/MCP agents prefer it over dumping the whole file.

---

## Principles (constraints)

These bound every item below. If a proposal fights them, it waits or dies.

1. **Local-first compile.** Convert → chunk → rank → pack must work with no API key and no network. LLM remains opt-in (Prove / Agent).
2. **Transparent loss.** Never silently drop content. Omission stays named and recoverable.
3. **Budget is a ceiling.** Coverage-first packing; pointed queries may leave spare headroom. Do not reintroduce whole-file dump shortcuts.
4. **Minimal tool surface.** Prefer composing `compile_context` + `expand_section` over adding MCP verbs.
5. **Selection over conversion.** Buy MarkItDown; spend complexity on ranking, packing, eval, and agent UX.
6. **Demo honesty.** Hosted UI proves the claim; it is not multi-tenant SaaS. Metrics for adoption come from intentional instrumentation, not vanity counters.

---

## Phase 0 — Shipped (baseline)

What already exists and should not be re-litigated as “future”:

| Area | Reality |
| --- | --- |
| Core pipeline | Single-file convert → heading chunk → BM25 rank → coverage-first pack; content-token metering |
| Surfaces | MCP (`compile_context`, `expand_section`) + web demo (Compile / Prove / Agent) |
| Recovery | Omit buckets + expand; Agent demo reuses the same two tools |
| Quality gate | Offline recall@budget fixtures in `src/eval/`; CI without LLM secrets |
| Hosting | Docker + Render free demo; `/healthz`, optional `/metrics`; rate limits, no accounts |
| Known limits (accepted) | BM25 paraphrase misses; heading-less PDFs; no OCR; cl100k drift; single-instance in-memory handles/metrics |

---

## Phase 1 — Near-term (harden the claim)

Concrete gaps in the current product. Ship these before expanding scope.

### Packing / ranking quality

| What | Why |
| --- | --- |
| Grow `src/eval/` with more paraphrase-miss and multi-facet fixtures (incl. deliberate expandable misses) | CI already guards curated cases; the Known limits list still outruns coverage |
| Tunable or lightly swept BM25 / floor / cluster knobs with eval as the judge | Defaults are literature + heuristics, not a sweep ([ARCHITECTURE](../ARCHITECTURE.md)) |
| Improve multi-hop “compare §A with §B” under one budget (facet budget caps or second-pass hints) | Compound split helps; one facet can still starve another |
| Stronger chunks for heading-less PDFs (structure heuristics beyond paragraph windows) | Weak breadcrumbs hurt rank and demo aesthetics |

### MCP / agent UX (real clients, not only the web loop)

| What | Why |
| --- | --- |
| Better MCP tool descriptions and example prompts for Cursor / Claude / Codex | Agent in the UI is an in-app demo; production value is IDE MCP |
| Document and test the expand-after-miss loop as the recommended agent pattern | Operators need a clear “compile → read manifest → expand” playbook |
| Surface next-budget / packaging hints consistently on MCP if the web already thinks in those terms | `budget-hint` and unused UI packaging notes show the contract is half-exposed ([AUDIT-UI](./AUDIT-UI.md) O1) |

### Demo UI (small, grounded)

| What | Why |
| --- | --- |
| Cap or lazy-load bulk omit peek / “rest” expands | Huge omit lists can flood UI and the rate-limit pool (AUDIT-UI O7) |
| Optional single client retry on 503 converter busy | Messaging exists; auto-retry does not (AUDIT-UI O8) |
| Keep Prove vs Agent copy sharp for first-time judges | Two LLM surfaces still confuse; product intent is already separate |

### Hosting / ops

| What | Why |
| --- | --- |
| Operator notes for cold-start mitigation (health ping vs paid always-on) without pretending free tier is HA | Render free sleeps ~15 min; 30–60s wake is documented reality |
| Persist conversion cache across redeploys when an operator attaches a volume | Cache is ephemeral on default `/tmp`; correct but slow on every boot |
| Optional export or scrape-friendly `/metrics` for a single demo instance | Counters exist but reset on restart and are not multi-replica |

### Evals / honesty

| What | Why |
| --- | --- |
| Keep answer-parity out of CI hard asserts; add optional offline “gold substring survives pack” growth instead | Prove is nondeterministic demo, not an invariant |
| Record pack-matrix / hero numbers from fixtures when ranking changes | Hero is a fixed example; drift is a known UX footgun (AUDIT-UI O5) |

---

## Phase 2 — Mid (expand the unit of work)

Still local-first. Bigger product surface, still not SaaS.

### Multi-file / corpus

| What | Why |
| --- | --- |
| Compile over a small allowlisted set of files (or a folder under `CC_ROOT`) with one shared budget | Today the unit is one file; agents often need a short doc set |
| Cross-file omit manifest (file id + section id) and expand that resolves both | Recovery must stay transparent when the corpus is >1 file |
| Ranking that does not pretend a directory is one novel (per-file then interleave, or explicit file facets) | Naive concat breaks breadcrumbs and BM25 IDF |

### Optional local second scorer

| What | Why |
| --- | --- |
| Optional local embeddings (or similar) as a **second** rank signal, off by default | ADR-003: paraphrase misses are real; network or heavy install must not become required for compile |
| Keep BM25 as the always-on floor so CI and keyless demos stay green | Local-first and reproducible beats “embeddings or nothing” |

### Agent / product clarity

| What | Why |
| --- | --- |
| Thin “recommended MCP config” packages or snippets per major client | Setup friction blocks adoption more than missing features |
| Soft reading ceiling and stop reasons documented as the contract agents should mirror | Web Agent already implements this; MCP callers reinvent it poorly |

### Chunk / format quality (without OCR)

| What | Why |
| --- | --- |
| Better table/spreadsheet sectioning where MarkItDown output is noisy | Financials demos depend on atomic tables surviving pack |
| Clearer failure taxonomy for empty convert vs timeout vs unsupported | Operators and agents need actionable errors, not one generic 422 |

---

## Phase 3 — Later (only if Phase 1–2 stay true)

Do not start these while paraphrase recovery, single-file limits, or MCP docs are still weak.

| What | Why (and why later) |
| --- | --- |
| Adoption / quality telemetry that respects local-first (opt-in, aggregate, no document content) | No production adoption metrics today; guessing is worse than silence |
| Shared rate-limit / handle store for multi-replica demo hosts | In-memory maps are accepted single-instance demo scope |
| OCR / scanned-PDF path behind an explicit opt-in with loud quality warnings | Deferred so bad transcripts cannot silently corrupt answers |
| Tokenizer adapters beyond cl100k (or clearer “contract of intent” labeling per provider) | Drift is a few percent; not the main recall problem |
| Third MCP tool only if compose-of-two is proven insufficient | ADR-009: more verbs dilute choice and expand surface |
| Accounts, billing, durable libraries | Explicit non-goal for the prep-layer product; revisit only with a different product brief |

---

## Non-goals (for this roadmap)

Aligned with [specs/01-prd.md](./specs/01-prd.md) unless a later phase explicitly reopens them:

- Multi-tenant SaaS, user accounts, billing, or team document libraries.
- Replacing the user’s chat/IDE; we prepare context, we do not own the long-term chat UX.
- Guaranteed semantic recall under arbitrary paraphrase (manifest + expand remain the safety net).
- Making embeddings a hard dependency of compile.
- Treating the hosted Render demo as production HA or a source of adoption SLAs.
- Asserting Prove answer-parity as a CI invariant.
- Silent OCR / media transcription that can invent text.

---

## How to use this doc

- Prefer Phase 1 items when choosing the next PR; they close documented holes.
- Phase 2 needs a short design note (especially multi-file manifest shape) before code.
- Phase 3 stays speculative until evals and MCP usage feedback say the claim is solid.
- When an ADR or audit closes an item, move it to Phase 0 or delete the row — do not leave stale wishlist text.
