# Product Requirements — Context Compiler

**Status:** Current (shipping)  
**Surfaces:** MCP stdio server · hosted / local web demo  
**Version context:** `package.json` `0.1.0`

---

## 1. Problem

Agents and chat tools routinely ingest entire documents when only a fraction of the text is relevant to the task. Token cost and context-window pressure scale with file size, not with answer size. Silent truncation (or opaque retrieval) makes misses hard to detect and harder to recover from.

Context Compiler addresses the preparation step: given a file, a natural-language task, and a hard token budget, return **task-relevant markdown** under that budget, plus a **manifest of omitted sections** so missing material stays visible and fetchable.

---

## 2. Goals

| ID | Goal |
| --- | --- |
| G1 | Reduce tokens sent to downstream models for factual / section-local tasks on long documents, while keeping the answer-bearing text intact when BM25 can find it. |
| G2 | Make loss transparent: never silently drop content without naming what was omitted and how to recover it. |
| G3 | Stay local-first: convert → chunk → rank → pack must work with **no API key and no network**. |
| G4 | Expose a minimal agent tool surface: exactly two MCP tools that close the loop (compile → inspect → expand). |
| G5 | Provide a demo that makes reduction and (optionally) answer parity tangible without requiring accounts. |

### Success metrics (product)

Measured qualitatively in the demo and quantitatively in offline eval / tests — not as SLA SLIs:

- **Token reduction** on representative docs at practical budgets (~1k–4k): routinely high double-digit to mid-90s percent when the packer can stop at coverage (not when forced to “summarize everything”).
- **Early stop honesty:** pointed queries leave spare budget unused rather than padding with weak sections.
- **Answer intact:** gold substrings survive packing for curated fixtures (`src/eval/`); pack must not return over budget.
- **Offline compile:** CI and local runs succeed with no LLM secrets; Prove/Agent remain opt-in.
- **Recovery path:** omitted sections remain expandable by id after a deliberate miss.

---

## 3. Non-goals

- Multi-tenant SaaS accounts, billing, or durable user storage.
- Replacing the user’s LLM; the product prepares context, it does not own chat UX long-term.
- Guaranteed semantic recall under arbitrary paraphrase (BM25 limits are accepted; recovery is the safety net).
- OCR / scanned-PDF / image captioning as a first-class path.
- Embedding-based ranking as a hard dependency (deferred while keeping local-first).
- Cryptographic token accounting across every vendor tokenizer (cl100k is the contract of intent).

---

## 4. Users

| Persona | Needs |
| --- | --- |
| **Agent builder / MCP operator** | Point Codex, Claude Desktop, Cursor, or similar at `compile_context` / `expand_section` with a confined `CC_ROOT`. |
| **Demo visitor** | Upload or pick a sample, set a budget and question, see compiled context and optional Prove / Agent. |
| **Operator (self-host)** | Docker or Node+Python deploy; optional LLM keys for Prove/Agent; rate limits and health checks for a public URL. |

---

## 5. Primary flows

### 5.1 Compile (core, offline)

**Input:** file + task + token budget.  
**Output:** packed markdown, token stats, selected/omitted section manifests, optional next-section budget hint.

Pipeline: convert (MarkItDown) → chunk → BM25 rank → **coverage-first** pack under a content-token ceiling (document order restored). Always rank+pack — no whole-file dump when `raw_tokens ≤ budget`. Budget is a ceiling; pointed queries may early-stop with spare headroom.

### 5.2 Expand

Fetch one section by id from a previously compiled file (MCP: `file_path`; web: opaque upload `handle`). Used when the manifest shows a plausible miss.

### 5.3 Prove answer parity (web, LLM opt-in)

Same question answered from the **full converted file** and from the **compiled context** (plus optional UI “Include in Prove” expands). Side-by-side comparison for demos — not an invariant asserted in CI.

**Amendment note:** Prove was layered after Compile as an opt-in quality check. It is intentionally separate from Agent: Prove validates a human-driven compile (+ includes); Agent is its own retrieval loop.

### 5.4 Agent (web, LLM opt-in)

Model-driven loop over the same two tools: compile under the slider budget, read the omission manifest, expand / optionally recompile when the ceiling allows headroom, then answer. Soft reading ceiling equals the start budget on the web path.

### 5.5 MCP

Stdio JSON-RPC: `compile_context` and `expand_section` only. Paths confined to `CC_ROOT` via realpath. Errors returned in-band as `{ error: ... }` JSON in the tool content.

---

## 6. Constraints

| Constraint | Rationale |
| --- | --- |
| Local-first ranking (BM25) | Reproducible demos; no quota on the critical path |
| Exactly two MCP tools | Closed compress → inspect → recover loop; smaller decision surface |
| No database | Stateless prep layer; ephemeral uploads/handles/cache |
| Demo is upload-only | Untrusted callers never supply filesystem paths |
| Untrusted document markers | Prompt-injection hygiene for consumers of compiled text |

---

## 7. Feature layering (amendments)

These reflect normal iteration, not a rewrite:

1. **Omission manifest → expand** — recovery was part of the original compress contract; expand stays first-class on both surfaces.
2. **Peek vs Include (web)** — Initially, expanding an omitted section was for human inspection. Shipping behavior: peeks do not inflate Prove context; only sections marked **Include in Prove** are merged into the compiled side of parity.
3. **Prove vs Agent** — Prove checks a fixed compile; Agent decides its own expands. UI copy and rate costs keep them distinct.
4. **Soft agent ceiling** — Agent uses the token-budget slider as both start budget and soft `tokens_read` ceiling (in-flight expand may finish slightly over).
5. **Sample library + measure** — Samples and `/api/measure` exist so budget UX reflects real converted token counts, not client guesses.

---

## 8. Out-of-scope product surfaces

- Persistent workspaces or shared team libraries.
- Automatic OCR pipeline for scans.
- Guaranteed multi-hop “compare distant sections” in one pack (compound queries help; two compiles remain valid).

---

## 9. Acceptance summary

A release is product-complete for this scope when:

- Offline compile + expand work via MCP and web without keys.
- Pack respects budget; manifest + expand recover intentional misses in eval.
- With keys, Prove and Agent run under concurrency and rate limits; without keys, those controls disable cleanly in the UI.
- Hosted demo remains abuse-bounded (size, timeouts, per-IP costs) without accounts.
