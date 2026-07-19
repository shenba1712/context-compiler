# Test Plan

**Status:** Current  
**Runner:** plain `node:assert` via `npm test` → `dist/tests/test.js`  
**Eval:** offline recall suite in `src/eval/` (loaded by tests)

Answer-parity equivalence is **deliberately not asserted** in CI — nondeterministic demonstration, not an invariant. Fallback contracts when the LLM path fails are asserted.

---

## 1. Scope

| Layer | Covered |
| --- | --- |
| Unit-ish | Chunking, ranking, packing, query split/cleanup, budget hint, env parse, path/upload guards |
| Integration | `compileContext` / `expandSection`, cache hits, convert via real markitdown on small fixtures |
| HTTP | Express app imported; bind random port; compile/expand/measure/agent/parity/healthz/metrics |
| LLM | Mock OpenAI-compat server; failover chain; dead-model / busy / unavailable |
| Agent | Loop decisions with injectable `complete`; SSE abort paths |
| Eval | `cases.json` gold substrings + expand recovery |

---

## 2. Regression themes (from real tests)

These are the contracts CI is meant to protect:

### Packing and budget

- Content-meter ceiling: `tokens_used` ≈ `selected_content_tokens`; omit-manifest not counted toward the budget.
- Coverage-first: facets / discriminative terms before padding; `early_stopped` when spare budget left unused.
- No whole-file dump when `raw_tokens ≤ budget` after a pointed query (zero-relevance fillers stay out).
- Assembled fit checks + manifest degradation before sacrificing content; never ship manifest-only when content can fit.
- Relative floor / early-stop / capped recall insurance (not floor-greedy fill-to-budget).
- Oversized top section at tiny budget omits cleanly without overshoot; partials of needed sections beat weak wholes.
- `next_section_hint` when a strong omitted / truncated section remains.
- Omit buckets: budget-blocked vs lower-relevance.

### Ranking and multilingual

- Lexical hits (e.g. Irene Adler / Scandal) rank correctly.
- CJK / Hindi / Spanish / Russian / Arabic packing keeps answer substrings.
- Honorific / Title-Case name expansion in `tokenizeQuery`; name-intent boost for given-name asks.
- Multi-query split (`query-aspects`, incl. non-English conjunctions) + interleave; attribution tags the right sub-questions.
- Compound “warranty + rain” / FY25 multi-facet keeps both needles under a shared budget.

### Offline recall eval

Fixtures under `src/eval/fixtures/` with cases in `cases.json`:

- Lexical and paraphrase policies (EN and localized).
- Manual / compare / headingless documents.
- Intentional hard paraphrase miss with `must_omit` + `expand_recover` so the miss stays expandable.
- Multi-query and honorific cases.

### Cache and convert

- Second compile hits content-hash cache.
- Real pptx/csv through markitdown where exercised.
- Empty converter output / image-without-OCR fails clearly.
- Conversion errors sanitized (no absolute paths in public message).

### Security guards

- Path realpath confinement (symlink escape closed).
- Upload extension + magic bytes + zip-bomb rejection.
- Safe env parsing (non-numeric rate limit does not become NaN-disable).

### Web / agent / LLM

- Opaque handles; expand 404 on unknown handle.
- Rate limit and LLM concurrency busy responses.
- Agent step streaming; cancel/abort; parity one-shot 410 after consume.
- Provider failover updates `answerModel()` to the model that actually answered.
- Logger webhook gating; metrics auth; healthz shape.
- MCP path: no stray stdout pollution (scan/guard in tests).

---

## 3. Explicitly not asserted

| Area | Why |
| --- | --- |
| Full-file answer == compiled answer | Model nondeterminism; Prove is a demo |
| Exact BM25 score values | Untuned literature defaults; assert ranking outcomes / needles instead |
| Cross-tokenizer token equality | cl100k is contract of intent |
| Multi-replica rate-limit fairness | In-memory, single-instance demo scope |
| OCR quality | Out of product scope |

---

## 4. How to run

```bash
# Requires Node 20+ and markitdown on PATH for conversion tests
npm test
```

CI mirrors this after lint and format check (see [09-devops.md](./09-devops.md)).

---

## 5. Manual / exploratory (not CI)

- Hosted cold start UX on Render free.
- Live Gemini/OpenRouter free-tier quota exhaustion messaging.
- Browser Cancel mid-Prove / mid-Agent.
- Sample library Prove paths across DOCX/PDF/XLSX/PPTX/MD.
- MCP from a real client with a tight `CC_ROOT`.

---

## 6. Exit criteria for changes

A PR that touches pipeline, guards, web routes, or agent should:

1. Keep `npm test` green (including recall eval).  
2. Not introduce stdout writes on the MCP import path.  
3. Preserve budget non-overshoot and expand recovery for intentional misses.  
4. Avoid asserting LLM answer string equality.
