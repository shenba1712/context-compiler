# Compatibility Matrix

**Status:** Current  
**Legend:** ✅ Supported · ⚠️ Degraded / partial · ❌ Out of scope

---

## 1. Document formats

Conversion is MarkItDown; web upload allowlist is stricter (magic-byte checked).

| Format | Extensions | Status | Notes |
| --- | --- | --- | --- |
| Word | `.docx` | ✅ | Happiest path for headings/tables |
| Excel | `.xlsx` | ✅ | Sheets → markdown tables/text |
| PowerPoint | `.pptx` | ✅ | Slide text kept; layout lost |
| PDF (text layer) | `.pdf` | ⚠️ | Often heading-less → paragraph windows; weaker demos |
| PDF (scanned) / bare image | — | ❌ | No OCR backend; empty/failed convert by design |
| Markdown | `.md`, `.markdown` | ✅ | Near-lossless |
| HTML | `.html`, `.htm` | ✅ | Near-lossless |
| CSV / plain text | `.csv`, `.txt` | ✅ | Near-lossless |
| Other (`.doc`, images, audio, …) | — | ❌ | Upload rejected (415) on demo |

Office ZIP containers are checked for decompression bombs before spawn.

---

## 2. Browsers (demo UI)

| Browser | Status |
| --- | --- |
| Chromium (Chrome, Edge, recent) | ✅ |
| Firefox (recent) | ✅ |
| Safari (recent) | ✅ |
| IE / very old mobile WebViews | ❌ |

Requires `fetch` + ReadableStream for Agent SSE over POST, AbortController, CSS custom properties. No IE support target.

---

## 3. MCP clients

Any client that speaks MCP over **stdio** and can spawn `node dist/server.js`.

| Client | Status | Notes |
| --- | --- | --- |
| Codex (config.toml) | ✅ | Documented in README |
| Claude Desktop / Claude Code style JSON | ✅ | `mcpServers` block |
| Cursor MCP | ✅ | Same stdio pattern |
| HTTP/SSE MCP transports | ❌ | Not implemented; stdio only |

---

## 4. LLM providers (opt-in)

Compile never needs a provider. Prove / Agent use a failover chain when keys are present:

| Priority | Provider | Env | Status |
| --- | --- | --- | --- |
| 1 | Gemini (OpenAI-compat endpoint) | `GEMINI_API_KEY` / `GOOGLE_API_KEY` | ✅ Primary; multi-model list on same key |
| 2 | OpenRouter | `OPENROUTER_API_KEY` | ✅ |
| 3 | Anthropic | `ANTHROPIC_API_KEY` | ✅ Messages API |
| 4 | OpenAI-compatible | `OPENAI_API_KEY` or `CC_LLM_API_KEY` + `CC_LLM_BASE_URL` | ✅ |

Default Gemini model ids (overridable): `gemini-flash-lite-latest` → `gemini-3-flash-preview` → `gemini-flash-latest`. Soft “model not found” ids are skipped for a TTL (process-local). Free-tier 429/quota may still fail the request after the chain is exhausted.

---

## 5. OS / Node / Python

| Layer | Supported | Notes |
| --- | --- | --- |
| Node | 20+ | Engine field; CI 20; Docker 22 |
| Python | 3.10+ (CI 3.12) | Only for markitdown binary |
| Linux | ✅ | Convert VM cap via `ulimit -v` |
| macOS | ✅ | Local dev; mem cap no-op |
| Windows | ⚠️ | Possible with Node+Python on PATH; less exercised; ZIP verify stricter when mem cap off |
| Architecture | x86_64 / arm64 | No special casing beyond runtime availability |

---

## 6. Hosting

| Target | Status | Notes |
| --- | --- | --- |
| Docker (`Dockerfile`) | ✅ | Node + markitdown in one image; `CMD node dist/web.js` |
| Render Blueprint (`render.yaml`) | ✅ | Free plan cold-starts ~30–60s after idle |
| Railway / Fly-style container | ✅ | Same image assumptions; set `CC_TRUST_PROXY` carefully |
| Serverless (Lambda/Vercel functions) | ❌ | Subprocess + in-memory handles + long convert timeouts unfit |
| Pure static hosting | ❌ | Needs Node API |

---

## 7. Tokenization

| Tokenizer | Status |
| --- | --- |
| js-tiktoken cl100k | ✅ Contract of intent for budgets |
| Other vendor tokenizers | ⚠️ Few-percent drift expected |

---

## 8. Language / script support (ranking)

| Script | Status | Notes |
| --- | --- | --- |
| Latin | ✅ | Light stemming; honorific name expansion |
| CJK | ✅ | Character unigrams/bigrams |
| Hindi / Cyrillic / Arabic samples | ✅ | Demo + eval coverage; RTL display in browser for Arabic sample |

BM25 remains lexical; paraphrase hardness varies by language and wording.
