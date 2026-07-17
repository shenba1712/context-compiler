# Context Compiler — Architecture & Design

Engineering documentation: system design, ADRs, trade-offs, threat model,
and known limitations. Companion to the README (usage) and DEMO_SCRIPT.md.

---

## 1. Problem statement & design philosophy

AI agents ingest whole files to answer narrow questions. For a 20k-token
document and a task touching 5% of it, ~95% of input spend is waste, paid on
every read. Context Compiler is a **stateless context-preparation layer**:
`(file, task, token_budget) → task-relevant markdown of guaranteed size`.

Three principles drove every decision:

1. **Conversion is commodity; selection is the product.** We buy conversion
   (MarkItDown) and spend our complexity budget on chunk/rank/pack.
2. **Trimming must be transparent, never silent.** Any lossy step announces
   what was lost and provides a recovery path (`expand_section`).
3. **Local-first.** The default configuration makes zero network calls.
   Sending content to an LLM (rerank, answer panel) is strictly opt-in.

## 2. High-level design

```
                 ┌──────────────────────────────────────────────┐
  MCP client ───►│ server.ts (stdio, path allowlist)            │
  (Claude/Cursor)│                                              │
                 │        pipeline.ts (orchestrator)            │
  Browser ──────►│ web.ts │  convert → chunk → rank → pack      │
  (demo/judges)  │(Express)│     │                    ▲         │
                 │         │     ▼                    │         │
                 │         │  cache.ts (sha256 → md on disk)    │
                 │         │  llm.ts (optional Claude calls)    │
                 └─────────┴────────────┬─────────────┴─────────┘
                                        ▼
                          markitdown (Python subprocess)
```

Two thin entry points share one pipeline. The pipeline is a pure function of
its inputs plus a content-addressed cache — no database, no session state,
no background jobs. Horizontal scaling is trivial because there is nothing
to coordinate (see §12).

### Request flow (compile_context)

1. `fileKey()` — sha256 of file bytes → cache lookup.
2. Miss → `convertToMarkdown()` spawns `markitdown <path>` (`execFile`, no
   shell), 50MB pre-check, 120s timeout → cache write (tmp + atomic rename).
3. `chunkMarkdown()` — heading-split with breadcrumbs; tables atomic.
4. Short-circuit: if `raw_tokens ≤ budget`, return everything (§5, ADR-007).
5. `rank()` — BM25 + heading boost; optional Haiku rerank of top-20.
6. `pack()` — greedy fill → document-order restore → manifest append →
   measure assembled output → evict-worst loop until `≤ budget`.
7. Return `{markdown, stats, omitted_sections[]}`.

## 3. Low-level design

### tokens.ts
`js-tiktoken` (cl100k_base, pure JS, no network). Fallback: `len/4` chars if
the encoder fails. Budgets are advisory contracts with the caller, not
cryptographic guarantees; a ±2% counting mismatch vs. a given model's
tokenizer is acceptable and documented.

### convert.ts
`execFile` (not `exec` — no shell, no injection via filenames), 64MB stdout
buffer, size check *before* spawning. Failure taxonomy: not-a-file, too
large, timeout, converter error, empty output — all mapped to a single
`ConversionError` with a truncated (500 char) reason to avoid log injection.

### chunk.ts
Single pass over lines. State machine tracks a heading trail
(`[{level,title}]`) so each section carries a breadcrumb
(`"Doc > H2 > H3"`). Invariants:

- **Tables are atomic.** A boundary never lands inside `|...|` runs.
  Rationale: dropping rows silently changes answers — the worst failure
  class for a tool whose pitch is "same answer."
- Sections > `MAX_CHUNK_TOKENS` (800) split on paragraph blocks; heading
  line attaches to the first fragment only (breadcrumbs cover the rest).
- No headings at all (common for text-layer PDFs) → paragraph windows with
  `"(no heading)"` breadcrumbs. Ranking still functions; UX degrades
  gracefully rather than failing.
- 800 was chosen so a default 4k budget fits ~4–6 chunks plus manifest —
  enough diversity for multi-facet questions, big enough to keep clauses
  intact.

### rank.ts
Okapi BM25, k1=1.5, b=0.75 (literature defaults; untuned — see §11).
~40 lines, zero deps. One domain addition: if any query term appears in a
chunk's breadcrumb, add `0.35 × max_score` — headings are high-precision
signals in business documents. Optional rerank: BM25 top-20 → Haiku returns
a JSON id ordering; ids validated against the shortlist, dropped ids keep
BM25 position, *any* failure (network, parse, model) silently falls back to
BM25 order. The rerank prompt explicitly marks chunk content as untrusted
data (§9).

### pack.ts
Greedy fill against `budget − 250` (manifest reserve estimate), then the
real invariant is enforced empirically: assemble the *actual* output —
selected chunks restored to document order, breadcrumb comments, omitted-
sections manifest (≤40 itemized lines + summarized tail) — measure it, and
evict the lowest-ranked selected chunk until `countTokens(output) ≤ budget`.
This eviction loop exists because the manifest's size grows with document
size; a fixed reserve under-counted on a 30-section doc and shipped 1,890
tokens against a 1,500 budget in testing. Enforcing on the assembled
artifact is the only honest contract. Worst case O(n²) token counts; n is
chunks-selected (single digits), immaterial in practice.

Document-order restoration matters: models comprehend narrative order
better than relevance order, and it prevents the packet from reading as a
shuffled collage.

### cache.ts
Key = sha256(bytes) → `$CC_CACHE_DIR/<hex>.md`. Immutable by construction:
no TTL, no invalidation logic, no staleness class of bugs — an edited file
is a different key. Write is tmp-file + `rename()` (atomic on POSIX same-fs)
so concurrent compiles can't interleave partial writes. Only conversion is
cached: it's the seconds-scale stage; chunk/rank/pack are ms-scale and
task-dependent. A side effect proved useful: the key scheme is
language-portable (the TS build transparently reused a cache written by the
earlier Python prototype).

### pipeline.ts
Orchestration + the passthrough rule: if the whole document fits the
budget, return all of it in document order with an empty manifest. Ranking
is a lossy operation — never run it when lossless is affordable.

### llm.ts
The entire provider surface is one file: `hasLlm()`, `complete(prompt,
{model, maxTokens})`. Two backends auto-detected from env: Anthropic SDK
(`ANTHROPIC_API_KEY`) or any OpenAI-compatible endpoint via plain fetch
(`OPENAI_API_KEY`, or `CC_LLM_API_KEY` + `CC_LLM_BASE_URL` — covers OpenAI,
Gemini, Groq, Ollama, OpenRouter with zero added dependencies). Model
defaults per provider; `CC_RERANK_MODEL`/`CC_ANSWER_MODEL` override. The
generic path is covered by a mock-endpoint test.

### server.ts (MCP)
`@modelcontextprotocol/sdk`, stdio transport, zod schemas. Two tools only
(ADR-009). Path guard: resolve (incl. `~`), require prefix under `CC_ROOT`
(default `$HOME`), require regular file. Budgets clamped (500–200k /
200–200k). All errors return as JSON `{error}` payloads rather than
protocol errors — agents handle data better than faults.

### web.ts + public/index.html (demo)
Express + multer (50MB cap, memory storage → random-hex filename with
original extension preserved, since markitdown sniffs by extension).
Endpoints: `POST /api/compile`, `POST /api/answer` (parity), static UI.
The hosted surface **never accepts a caller-supplied path** — uploads only;
the path-based API exists only on the local MCP surface. Single HTML file,
zero frontend deps: vanilla JS, ~200 lines. UI decisions in §8.

## 4. Architecture decision records

**ADR-001 — TypeScript core, Python as converter subprocess.**
Context: TS preferred by the builder and the judge audience; best-in-class
conversion (MarkItDown) is Python; pure-TS conversion is weak for pdf/pptx.
Decision: TS owns everything; Python appears only as an external binary
(`execFile markitdown`), like shelling to ffmpeg. Zero custom Python code.
Consequences: two runtimes required — dissolved by Docker for hosting and
acceptable (node + uv) for local MCP; converter swappable via
`CC_MARKITDOWN_CMD`.

**ADR-002 — Buy conversion (MarkItDown), build selection.**
Rebuilding parsers is the mistake this product's thesis warns against.
Consequences: full docx/xlsx/pptx/pdf coverage on day one; inherit upstream
improvements; also inherit upstream parsing bugs (accepted; mitigated by
subprocess isolation).

**ADR-003 — BM25 default; LLM rerank opt-in; embeddings deferred.**
BM25 is deterministic, offline, free, and ~zero-latency; it makes
local-first (principle 3) possible and keeps the demo reproducible. Haiku
rerank recovers paraphrase matches on the top-20 shortlist at bounded cost.
Embeddings rejected for MVP: heavy install or mandatory network, and BM25 +
heading boost was empirically sufficient on test corpora. Revisit as
roadmap (§13).

**ADR-004 — Heading-based chunking with atomic tables.**
Alternatives: fixed-size windows (destroy semantic boundaries), semantic/
embedding chunking (cost, nondeterminism). Headings are the author's own
segmentation; trust them, fall back to paragraphs when absent.

**ADR-005 — Budget enforced on assembled output via eviction loop.**
See pack.ts above. The contract users rely on is "output ≤ budget," not
"selected chunk sum ≤ budget − constant."

**ADR-006 — Content-hash cache, no TTL.**
Correctness by construction beats freshness heuristics. Cost: orphaned
entries accumulate (no eviction) — acceptable for MVP, `du`-able, roadmap
item.

**ADR-007 — Small-file passthrough.**
If `raw ≤ budget`, ranking can only lose information. Skip it. This also
gives a safe demo fallback for any file under the budget.

**ADR-008 — Local-first; network strictly opt-in.**
No `ANTHROPIC_API_KEY` → no network calls at all. Privacy is a feature
(“your contract never leaves the machine”), not a limitation.

**ADR-010 — Relevance floor: the budget is a ceiling, not a target.**
Context: greedy fill-to-budget pads sharp queries with weakly-related
runner-up sections (paying for insurance the query doesn't need). Absolute
score thresholds don't exist for BM25 (scores aren't calibrated), but a
RELATIVE floor works: omit chunks scoring < 0.15 × top score, always keep
the top chunk. Key property: on flat score distributions (vague queries,
no ranker signal) nothing falls below a relative floor, so the packer
fills the budget — the insurance stays exactly where it's needed.
Disabled under LLM rerank, since a lexical floor would evict sections the
reranker promoted for semantic relevance. Env: `CC_RELEVANCE_FLOOR`
(0 disables).

**ADR-009 — API surface: exactly two tools.**
`compile_context` + `expand_section` form a closed loop (compress →
inspect manifest → recover). Every additional tool dilutes agent tool-choice
accuracy and expands the threat surface. Rejected: `list_cache`,
`convert_only`, `search` (all expressible via the two).

## 5. Product decisions

- **The manifest is the product's conscience.** Recall failure is the
  category-killing risk of any compression layer. We chose *transparent*
  lossiness: every response enumerates omissions with ids and token sizes.
  This converts "the tool hid something" into "the agent chose not to
  fetch it" — a fundamentally better failure.
- **Scope cuts, stated not hidden:** video/audio (transcription pipeline —
  roadmap), OCR for scanned PDFs, multi-file corpora, embeddings, cache
  eviction. Cut for a 4-day solo build; each has a slot in the design
  (video = new converter head; embeddings = second scorer in rank.ts).
- **Model-agnostic core with model-optional intelligence** — the product
  must be excellent with zero API keys and better with one.

## 6. API specification

### MCP tools (stdio)

`compile_context(file_path: string, task: string, token_budget: int = 4000) → JSON`

```json
{
  "markdown": "<compiled context with UNTRUSTED markers + manifest>",
  "raw_tokens": 20364, "tokens_used": 591, "tokens_saved": 19773,
  "reduction_pct": 97.1, "cache_hit": true, "rerank_used": false,
  "omitted_sections": [{ "id": "s3", "section": "Ch 3 > …", "tokens": 412 }]
}
```

`expand_section(file_path: string, section_id: string, token_budget: int = 2000) → JSON`
→ `{markdown, tokens_used, cache_hit}` or `{error, outline}` (unknown id
returns the full outline so the agent can self-correct without a retry
loop).

Errors: always `{"error": "..."}` in-band. Budget clamps: 500–200,000 and
200–200,000 respectively.

### HTTP (demo)

- `POST /api/compile` multipart `{file, task, token_budget}` → compile
  result + `cost_raw_usd`, `cost_compiled_usd`, `price_per_mtok`,
  `llm_available`.
- `POST /api/answer` multipart, requires API key → asks the answer model
  the same question with full vs compiled context (parallel calls) →
  `{model, full: {answer, context_tokens}, compiled: {answer,
  context_tokens, reduction_pct}}`.
- `POST /api/expand` JSON `{file_path, section_id}` → one omitted section.
  Path must resolve inside the demo's own upload directory (403 otherwise),
  preserving the invariant that the hosted surface never reads arbitrary
  paths — it can only re-read files it created from uploads.
- Status codes: 400 (missing input), 403 (path outside upload dir),
  422 (conversion failure), 429 (rate limit), 500 (other).

## 7. User flows

1. **Agent flow (primary):** dev adds one MCP config entry → agent
   discovers tools → on file questions calls `compile_context` with its
   task and headroom-derived budget → optionally `expand_section` after
   reading the manifest. Zero workflow change for the human.
2. **Judge/demo flow:** open hosted URL → upload → question → slider →
   Compile (bars, cost meter, session savings counter) → "Prove answer
   parity" (side-by-side answers).
3. **Recovery flow (rehearsed in demo):** vague question or tiny budget →
   incomplete answer → manifest names the missing section → expand → correct
   answer. Failure → detection → recovery, all in-band.

## 8. UI/UX decisions

- **One screen, no navigation.** The demo makes one argument; every pixel
  serves it. Upload → question → slider → two bars.
- **The budget is a slider, not an input** — dragging it and re-compiling
  is the interactive proof that the budget is a hard contract.
- **Red/green horizontal bars** for raw vs compiled: the entire pitch,
  preattentively legible in one glance from the back of a room.
- **Cost meter with an explicit price assumption** (`@$3/Mtok`,
  configurable): honest unit economics, judges can recompute.
- **Session savings counter** (cumulative $, tokens, per-1,000-reads
  projection): converts an abstract percentage into money, and grows as
  judges play — the longer they try to break it, the better it looks.
- **Badges (cache hit / rerank mode / omissions count)** expose internal
  state instead of hiding it — infrastructure credibility.
- **Parity panel** is the trust closer: cheap context is worthless if the
  answer changes, so we show the answers, not just the numbers.
- Dark theme matches the deck; zero frontend frameworks (one HTML file)
  keeps the hosted demo cold-start fast and unbreakable by dependency drift.

## 9. Security & threat model

| Threat | Vector | Mitigation | Residual |
|---|---|---|---|
| Malicious document exploits parser | Crafted pdf/docx | Subprocess isolation (`execFile`, no shell), 50MB pre-check, 120s timeout, 64MB stdout cap | In-process memory abuse inside converter; full sandbox (container/seccomp) is roadmap |
| Prompt injection via document content | "Ignore instructions…" inside a file, or injection crafted to *rank well* | Output wrapped in `UNTRUSTED DOCUMENT CONTENT` markers; rerank + answer prompts explicitly instruct model to treat content as data | Markers are convention, not enforcement — final defense is the consuming agent's; stated honestly |
| Path traversal / file probing | Agent passes `/etc/passwd`, `../..`, `~` tricks | `resolve()` incl. `~` expansion, prefix check under `CC_ROOT`, regular-file check; hosted surface accepts uploads only, never paths | Symlinks inside CC_ROOT pointing out (accepted for MVP; `realpath` both sides to close) |
| Data exfiltration | Rerank/answer calls send content to API | Off by default; single opt-in env var; one-file LLM surface auditable in 30 lines | User trust in provider once opted in |
| DoS (hosted demo) | Huge/many uploads, conversion CPU | Size caps, timeouts, stdout cap | **No rate limiting or auth on demo** — known gap; front with a rate limiter for anything beyond judging |
| Cache poisoning | Writing forged cache entries | Key = content hash (preimage-resistant); atomic writes; local FS trust boundary | Anyone with FS write access owns the box anyway |
| Log injection | Converter stderr into logs | Error reasons truncated to 500 chars | Low |

Trust boundaries: (1) file content — never trusted, at parse time or in
model context; (2) MCP caller — semi-trusted, path-restricted; (3) demo
uploader — untrusted, upload-only surface; (4) Anthropic API — trusted
once explicitly enabled.

## 10. Testing

- **Unit:** chunking (count, table atomicity, breadcrumbs), rank (target
  section wins for its query), pack (answer survives, `UNTRUSTED` +
  manifest present, **measured output ≤ budget** — the regression test for
  the manifest-overflow bug found during development).
- **Integration:** synthetic 30-section corpus e2e (>50% reduction, answer
  survives, cache hit on 2nd call, task-sensitivity of selection,
  expand_section round-trip); real .docx through the actual markitdown
  subprocess (92.4% reduction, answer intact); raw MCP stdio handshake
  (initialize → tools/list → tools/call → allowlist rejection); HTTP
  compile endpoint against a running server.
- **Deliberately untested:** rerank quality (nondeterministic; contract
  tested via fallback path), conversion fidelity (upstream's domain),
  answer parity as an assertion (it's a demonstration, not an invariant —
  asserting LLM equivalence in CI is flaky theater).
- Style: plain `node:assert` scripts, no framework — the suite is readable
  top-to-bottom in two minutes, which for a judged repo is a feature.

## 11. Performance characteristics

Conversion dominates: seconds, once per file *content*, then O(1) via
cache. Chunk: O(n) single pass. BM25: O(chunks × query terms) after O(n)
indexing — ms at document scale (BM25 is built per call; fine at n≈10²,
would be cached at corpus scale). Rerank adds one Haiku round-trip
(~1–2s, opt-in). Pack: ms (eviction loop is n_selected² token counts,
single digits). Cold demo request ≈ conversion cost; warm ≈ <100ms + any
rerank. Untuned: k1/b, heading boost 0.35, chunk size 800 — all defensible
defaults, none validated by sweep (honest answer if asked).

## 12. Deployment & scaling path

Stateless app + content-addressed cache ⇒ N replicas need nothing shared
(worst case: duplicate conversions per replica; fix = shared cache volume
or S3-backed cache). Docker image = node:22-slim + python3 + markitdown.
Scale story, in order: shared cache → per-IP rate limits → conversion
worker pool with queue → corpus mode (persistent chunk index + incremental
BM25/embeddings). None needed at demo scale.

## 13. Compatibility matrix

| Input | Engine | Quality | Notes |
|---|---|---|---|
| .docx | mammoth via markitdown | ★★★ | headings preserved — best case |
| .xlsx | markitdown | ★★★ | sheets → tables; atomic-table rule critical |
| .pptx | markitdown | ★★☆ | slide text; layout semantics lost |
| .pdf (text layer) | markitdown | ★★☆ | often heading-less → paragraph fallback, "(no heading)" breadcrumbs |
| .pdf (scanned) | — | ✗ | needs OCR — declared out of scope |
| .html/.md/.csv/.txt | markitdown | ★★★ | near-lossless |
| images | markitdown | ★☆☆ | metadata; captioning/OCR not wired |
| video/audio | — | ✗ | roadmap (transcription → same pipeline) |

Clients: any stdio MCP client (Codex, Claude Desktop, Claude Code, Cursor
via config; protocol handshake integration-tested). Runtimes: Node ≥ 20,
Python ≥ 3.10 (converter only). LLM: Anthropic native, or any
OpenAI-compatible provider (OpenAI, Gemini, Groq, Ollama) via env — the
product is provider-agnostic by design.

## 14. Known limitations (ranked by real risk)

1. **Recall**: BM25 can miss paraphrased relevance; the manifest converts
   silent failure into visible, recoverable omission — mitigation, not
   guarantee.
2. **Multi-hop tasks** ("compare §2 with appendix C"): single-shot ranking
   splits its budget poorly across facets. Workaround: two calls or
   expand_section; fix: query decomposition (roadmap).
3. **Heading-less PDFs** degrade chunk quality and demo aesthetics — choose
   demo files accordingly.
4. **Token counting drift** vs non-cl100k tokenizers: ±few %, budgets are
   contracts of intent.
5. **expand_section truncation** is char-ratio approximate, flagged in
   output with a truncation comment.
6. **No auth/rate limiting on the hosted demo** — acceptable for judging,
   not for production.
