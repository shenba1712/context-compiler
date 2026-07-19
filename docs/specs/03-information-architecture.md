# Information Architecture

**Status:** Current  
**Surfaces:** MCP tools · web demo (`public/index.html` + `src/client/app.ts`)

---

## 1. Product surfaces

```
┌─────────────────────┐     ┌──────────────────────────────┐
│  MCP client         │     │  Browser (demo UI)           │
│  (Codex / Claude /  │     │  static public/ + /api/*     │
│   Cursor / …)       │     └──────────────┬───────────────┘
└──────────┬──────────┘                    │
           │ stdio JSON-RPC                │ HTTP / SSE
           ▼                               ▼
    server.ts                         web.ts
           │                               │
           └──────────► pipeline.ts ◄──────┘
                    convert → chunk → rank → pack
```

| Surface | Trust | Path model | LLM |
| --- | --- | --- | --- |
| MCP | Semi-trusted caller | Real paths under `CC_ROOT` | Not required for tools |
| Web demo | Untrusted uploader | Opaque upload handles only | Optional (Prove / Agent) |

There is no shared session store or user identity. The “document” for the demo is an upload (or sample fetch) bound to a server-minted handle for the lifetime of the process / TTL.

---

## 2. Content object model

Objects are ephemeral pipeline artifacts, not persisted entities.

| Object | Description |
| --- | --- |
| **Source file** | Bytes on disk (MCP path or demo upload under OS temp). |
| **Converted markdown** | MarkItDown output; content-addressed cache key = sha256(bytes). |
| **Chunk / section** | Heading-aware unit with id (`s0`, `s1`, …), breadcrumb, token count, text. Tables are atomic. |
| **Rank scores** | Per-chunk BM25 (and per-sub-query rows for compound tasks). |
| **Pack** | Selected chunks in document order + wrapper comments + omission manifest, ≤ budget. |
| **Compile result** | Markdown + stats + `selected_sections` / `omitted_sections` + optional `next_section_hint`. |
| **Upload handle** | 32-hex id → upload path (web only). |
| **Parity handle** | One-shot id → agent final context for optional full-file compare. |

```
file bytes
   │
   ▼
converted markdown ──► cache (.md by hash)
   │
   ▼
chunks (sections)
   │
   ▼
ranked list ──► packed artifact + omission manifest
```

---

## 3. Demo UI navigation (single page)

One scrolling page; progressive disclosure rather than multi-route app.

| Region | Anchor / id | Role |
| --- | --- | --- |
| Hero | `.hero` | Brand, lede, animated reduction mock, CTA into try |
| Pipeline strip | `.pipe` | Convert → Rank → Pack explanation |
| Compile form | `#try` | File / samples, task, budget, Compile / Agent / Prove… |
| Loading banner | `#loadingNote` | In-progress wait outside results |
| Results | `#resultsSec` | Stats, section cards / exact markdown, omitted chips, Prove |
| Answer parity | `#parity` | Full vs compiled answers |
| Agent panel | (agent section in page) | SSE step stream + answer + optional compare |
| Footer / docs links | README & ARCHITECTURE served as static markdown routes |

### Form → results mental model

1. Choose **source** (upload or sample card).
2. Choose **task** (free text or suggested chips).
3. Choose **budget** (slider + Quick / Standard / Deep presets scaled to doc size).
4. **Compile once** → results. Or **Run agent** → agent panel. Or **Prove…** → skip results and run parity from form inputs.
5. In results: **peek** omitted sections; optionally **Include in Prove**; **Prove answer parity**.

---

## 4. Sample library

Canonical metadata: `src/samples-manifest.ts`. Files live under `public/samples/` (binary office samples may also ship alongside; markdown samples are in-repo).

| Role | Detail |
| --- | --- |
| Discovery | Grid of format-tagged cards; selecting fills task chips and file |
| Truthful sizing | `GET /api/samples` measures tokens via real `fullMarkdown` + tokenizer — not hardcoded sizes |
| Coverage | Novels/PDF/DOCX, report, spreadsheet, pitch deck, drone manual, multilingual short stories |
| Suggested questions | Curated per sample so Prove/Agent demos ask for content that exists in the abridged file |

Samples are demo content, not a product CMS. A failed measure for one sample degrades that card’s size hint only.

---

## 5. MCP information architecture

Agents see two tools and JSON text payloads (not a UI tree):

1. **`compile_context`** — returns packed context + manifests (section `text` stripped to avoid duplication).
2. **`expand_section`** — returns one section or `{ error, outline }` for self-correction.

The omission manifest is the navigation map: section ids are the only selectors.

---

## 6. Labels that must stay distinct

| Term | Means |
| --- | --- |
| Compile | One-shot pack under budget |
| Peek / expand (UI) | Load omitted section text for the human |
| Include in Prove | Merge that expand into parity’s compiled side |
| Prove | Full-file vs compile(+includes) answers |
| Agent | Autonomous compile/expand/answer loop |
| Compare to full file | Post-agent parity via `parity_handle` |
