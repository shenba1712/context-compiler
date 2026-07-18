# Context Compiler

![tests](https://github.com/shenba1712/context-compiler/actions/workflows/test.yml/badge.svg)

Task-aware, token-budgeted file-to-markdown for AI agents. Plug it into any
MCP client — or use the hosted demo — and your agent stops paying for pages
it doesn't need.

> The demo ships a sample library in real formats — novels and a science
> text as PDF/DOCX, a business report (DOCX), a financials spreadsheet
> (XLSX), a drone manual (PDF), plus English and Hindi short-story sets
> (Markdown) — so you can watch conversion + compression on genuinely
> different file types. Hero numbers: a ~90-page novel compiles to a
> single question's answer at **92–93% fewer tokens**.

**The problem:** agents burn tokens reading whole files when the task needs
5% of the content. **The product:** `compile_context(file, task, budget)`
returns only the relevant sections as markdown, plus a manifest of what was
omitted so the agent can fetch more. Measured: **91–97% token reduction with
the answer intact.**

## How it works

```
compile_context(file, task, budget)
   ├─ Convert   markitdown subprocess → markdown (cached by content hash)
   ├─ Chunk     heading-aware; tables are never split
   ├─ Rank      own BM25 (offline, deterministic) + optional Claude Haiku rerank
   └─ Pack      greedy fill under budget, document order restored,
                omitted-sections manifest appended
```

TypeScript owns the pipeline; Python appears only as the `markitdown`
converter binary (the way apps ship ffmpeg) — full docx/xlsx/pptx/pdf/image
coverage with zero custom Python code.

## Quick start

**Easiest — Docker** (no local Node or Python needed; this is what the
hosted URL runs):

```bash
docker build -t context-compiler .
docker run -p 8000:8000 -e GEMINI_API_KEY=$GEMINI_API_KEY context-compiler
# open http://localhost:8000
```

Deploy anywhere that runs a Dockerfile (Render / Railway / Fly.io). A
[`render.yaml`](./render.yaml) blueprint is included: in Render, choose
**New + → Blueprint**, point it at this repo, and enter `GEMINI_API_KEY` /
`OPENROUTER_API_KEY` when prompted (both optional). Note this app needs a
container/VM host, **not** a serverless platform like Vercel — it shells out to
the Python markitdown converter and keeps upload handles in memory, neither of
which survive serverless invocations.

**Bare metal** — prerequisites: Node ≥ 20 and Python ≥ 3.10:

```bash
npm install && npm run build
python3 -m pip install "markitdown[docx,pdf,xlsx,pptx]"   # converter binary
export GEMINI_API_KEY=...              # optional: enables rerank + answer-parity panel (free tier)
npm run web                            # http://localhost:8000
```

If `python3 -m pip` isn't available, install the converter with
[uv](https://docs.astral.sh/uv/) instead — no pip required:
`uv tool install "markitdown[docx,pdf,xlsx,pptx]"` — or skip Python
entirely and use Docker.

### About API keys (optional — bring any provider's)

**No key yet? Nothing is blocked.** An LLM API key unlocks exactly two optional
upgrades: the reranker (better section selection on paraphrased questions) and
the demo's answer-parity panel. **Without any key, everything else works** —
conversion, chunking, BM25 ranking, packing, both MCP tools (`compile_context`
and `expand_section`), the full web demo — fully offline; that's the local-first
design, and it's verified in CI on every commit with no keys set at all.

**Providers and automatic failover.** Configure one or more of the keys below.
They're tried in priority order, and a request automatically fails over to the
next configured provider on any error (rate limit, quota, outage) — so one
provider hitting its free-tier limit never takes the feature down while another
key still works. If every provider fails, the reranker quietly falls back to
BM25 and the answer panel reports the error.

| Priority | Env var | Provider | Default model |
|---|---|---|---|
| 1 | `GEMINI_API_KEY` | Google Gemini (free tier, no card) | `gemini-2.5-flash` |
| 2 | `OPENROUTER_API_KEY` | OpenRouter (many models) | `meta-llama/llama-3.3-70b-instruct:free` |
| 3 | `ANTHROPIC_API_KEY` | Claude | `claude-haiku-4-5` |
| 4 | `OPENAI_API_KEY`, or `CC_LLM_API_KEY` + `CC_LLM_BASE_URL` | Any OpenAI-compatible endpoint (OpenAI, Groq, Ollama, ...) | `gpt-4o-mini` |

Recommended setup: **Gemini as the free primary, OpenRouter as the fallback,
BM25 as the final safety net** — set `GEMINI_API_KEY` and `OPENROUTER_API_KEY`
and you're done.

Per-provider model overrides (optional): `CC_GEMINI_MODEL`,
`CC_OPENROUTER_MODEL`, `CC_ANTHROPIC_MODEL`, `CC_LLM_MODEL`. OpenRouter's `:free`
model IDs change without notice — if the default stops working, set
`CC_OPENROUTER_MODEL` to any current model from <https://openrouter.ai/models>.
`CC_GEMINI_BASE_URL` / `CC_OPENROUTER_BASE_URL` override the endpoints (proxies,
regional). `CC_ANSWER_MODEL` overrides the model label shown in the answer panel.

Who supplies it depends on where it runs: on a **hosted deployment**, the
operator sets it as a server environment variable and end users never see
or need it (it is never sent to the browser). For **local/MCP use**, it's
your own key in your own environment. Typical costs are small — reranks
are fractions of a cent; a parity comparison is ~$0.10 worst case (the
demo rate-limits requests and caps context size to keep a public
deployment's bill bounded).

## Use as an MCP server

Works with any MCP client — Codex, Claude Desktop, Claude Code, Cursor.

**OpenAI Codex** (`~/.codex/config.toml`, or `codex mcp add context-compiler -- node /path/to/context-compiler/dist/server.js`):

```toml
[mcp_servers.context-compiler]
command = "node"
args = ["/path/to/context-compiler/dist/server.js"]

[mcp_servers.context-compiler.env]
CC_ROOT = "/path/agents/may/read"
```

**Claude Desktop / Cursor** (JSON config):

```json
{
  "mcpServers": {
    "context-compiler": {
      "command": "node",
      "args": ["/path/to/context-compiler/dist/server.js"],
      "env": { "CC_ROOT": "/path/agents/may/read" }
    }
  }
}
```

**Claude Code:** `claude mcp add context-compiler -- node /path/to/context-compiler/dist/server.js`

Tools:

- `compile_context(file_path, task, token_budget=4000)` → compiled markdown + stats + omitted-sections manifest
- `expand_section(file_path, section_id, token_budget=2000)` → one omitted section by id

No file handy? The demo's "load the sample handbook" link seeds a document
and question. The API is rate-limited per IP (`CC_RATE_LIMIT`, default 30
req / 5 min) and the parity endpoint caps the full-file context
(`CC_ANSWER_CONTEXT_CAP`, default 60k tokens) to protect the demo's API
budget. Design details, ADRs, and the threat model: [ARCHITECTURE.md](ARCHITECTURE.md).

## What the demo proves — with and without a key

Without any API key the demo shows the full pipeline: your file converted,
sections ranked against your question (relevance % shown per section), and
a compiled context guaranteed under your budget — which you can verify *by
reading it*: the human-inspection proof. The token bars and cost meter are
objective math, no model required.

An API key adds the automated version of that proof: **answer parity** —
the model answers your question from the full file and from the compiled
context, side by side. That panel simulates the product's real consumer,
which is not a human reading a box but an AI agent receiving compiled
context through MCP.

## Choosing a token budget

Budget by **question breadth, not file size**: a factual lookup ~1,000
tokens, synthesis across sections ~4,000, "summarize everything" needs
budget ≥ file size (the compiler then returns the whole file — lossless
passthrough). The budget is a **ceiling, not a target**: when ranking
shows a clear relevance drop-off, the compiler stops early and returns
less than you allowed (relative relevance floor, `CC_RELEVANCE_FLOOR`,
default 0.15 × top score; disabled under LLM rerank so a lexical floor
never evicts the reranker's semantic rescues). On vague questions with no
clear signal, it fills the budget as recall insurance. So the default
4,000 is a safe place to leave the slider.

## The answer-parity proof

The demo's "Prove answer parity" button asks Claude the same question twice —
once with the full converted file as context, once with the compiled context —
and shows both answers side by side with token counts. Same answer, ~95%
fewer tokens: that's the pitch in one click.

## Configuration

| Env var | Default | Purpose |
|---|---|---|
| `GEMINI_API_KEY` | unset | Enables rerank + answer panel via Gemini (free tier); primary provider. Without any key, fully local |
| `OPENROUTER_API_KEY` | unset | Fallback provider; used automatically if Gemini errors |
| `ANTHROPIC_API_KEY` | unset | Next fallback, via Claude |
| `OPENAI_API_KEY` / `CC_LLM_API_KEY` / `CC_LLM_BASE_URL` | unset | Last fallback, via any OpenAI-compatible endpoint (OpenAI, Groq, Ollama, ...) |
| `CC_GEMINI_MODEL` / `CC_OPENROUTER_MODEL` / `CC_ANTHROPIC_MODEL` / `CC_LLM_MODEL` | per provider | Per-provider model overrides |
| `CC_GEMINI_BASE_URL` / `CC_OPENROUTER_BASE_URL` | provider default | Endpoint overrides (proxy / regional) |
| `CC_ANSWER_MODEL` | primary provider's model | Model label shown in the answer panel |
| `CC_ROOT` | `~` | Path allowlist root for the MCP server |
| `CC_CACHE_DIR` | `~/.cache/context-compiler` | Converted-markdown cache |
| `CC_MAX_FILE_BYTES` | 50 MB | Refuse larger files |
| `CC_CONVERT_TIMEOUT_S` | 120 | Conversion subprocess timeout |
| `CC_MARKITDOWN_CMD` | `markitdown` | Converter binary override |
| `CC_DEMO_PRICE_PER_MTOK` | 3.0 | $/Mtok for the demo cost meter |

## Tests

```bash
npm test
```

## Troubleshooting

**`Conversion failed: spawn markitdown ENOENT`** — the converter binary
isn't installed or isn't on PATH. Install it (see Quick start), open a
fresh terminal, and confirm with `which markitdown`. If it lives somewhere
unusual, point at it directly: `CC_MARKITDOWN_CMD=/full/path/to/markitdown`.

**pip installs markitdown `0.0.1a1` with "does not provide the extra"
warnings** — your default Python is < 3.10, so pip silently picked an
ancient stub release. Don't fight it: `python3 -m pip uninstall -y
markitdown`, then install with a modern Python:
`uv tool install --python 3.12 "markitdown[docx,pdf,xlsx,pptx]"`
(uv installer: `curl -LsSf https://astral.sh/uv/install.sh | sh`).

**`externally-managed-environment` error from pip** — Homebrew/system
Python protecting itself. Use `uv tool install` or `pipx install` instead
of pip.

**Installed but still "not found"** — pip's `--user` installs land in
`~/Library/Python/3.x/bin` (macOS) or `~/.local/bin` (Linux), which may
not be on PATH. `uv`/`pipx` manage PATH for you; otherwise add that
directory to your shell profile and open a new terminal.

**Build errors or crashes on startup** — check `node --version`: this
project needs Node ≥ 20.

**`EADDRINUSE: port 8000`** — something else owns the port. Run with
`PORT=8080 npm run web`.

**Docker build fails at `npm ci`** — `package-lock.json` is missing from
the build context. Commit it; `npm ci` requires it by design.

**"Prove answer parity" returns an error about API keys** — the server has
no LLM key. Set `GEMINI_API_KEY` (free tier) or any other provider key from
the Configuration table. Everything except the rerank and parity panel works
without any key.

**HTTP 429 from the demo API** — per-IP rate limit (default 30 requests /
5 min). Wait, or raise `CC_RATE_LIMIT` on your own deployment.

**"Conversion produced empty output"** — usually a scanned/image-only PDF
(no text layer). OCR is out of scope for now; see Known limitations.

**File refused as too large** — default cap is 50 MB (`CC_MAX_FILE_BYTES`).

**Hosted demo takes ~40s on the first request** — free-tier hosts sleep on
idle; the container cold-starts and the first conversion is uncached. Keep
it warm with an uptime pinger or a paid instance.

## Security model

Untrusted-file parsing is size-capped, time-boxed, and runs in a subprocess
(`execFile`, no shell). Compiled output is wrapped in `UNTRUSTED DOCUMENT
CONTENT` markers — a prompt-injection mitigation — and the reranker is
instructed to ignore instructions found inside chunks. MCP file access is
restricted to `CC_ROOT`. Without an API key the tool is fully local: the
file never leaves the machine.

## Known limitations — what we do today, what's planned, why deferred

**Recall risk** — lexical ranking can miss a paraphrased-but-relevant
section. *Today:* every response ends with the omitted-sections manifest,
and `expand_section` recovers any miss — failure is visible and repairable,
never silent. *Planned:* local embeddings as a second scorer beside BM25.
*Why deferred:* embeddings add a heavy install or a mandatory network call,
and BM25 + heading boost was sufficient on our test corpora — we ship the
mitigation now and the improvement when it can stay local-first.

**Multi-hop questions** ("compare §2 with appendix C") — single-shot
ranking splits its budget poorly across facets. *Today:* the agent can make
two calls or expand sections by id. *Planned:* query decomposition — split
the task into sub-queries, rank per facet, merge under one budget.
*Why deferred:* it multiplies latency and rank complexity for a minority of
queries; the two-call workaround is honest and available.

**Scanned/image-only PDFs** — no text layer, nothing to rank. *Today:*
conversion returns empty and we fail with a clear error rather than
pretending. *Planned:* OCR (e.g. tesseract) as a converter fallback.
*Why deferred:* OCR quality is a product in itself; a bad transcript
silently corrupts answers, which violates our "never silently lossy" rule.

**Video/audio** — *Planned:* transcription (audio track → text) feeding the
same chunk/rank/pack pipeline; the convert stage is the only new code.
*Why deferred:* transcription pipelines add API cost, latency, and demo
risk for a format few document workflows need on day one. A scope decision,
not a feasibility one.

**Token-count drift** — budgets are counted with cl100k; other models'
tokenizers differ by a few percent. *Today:* documented; budgets are
contracts of intent, and callers can set a margin. *Planned:* per-model
tokenizer selection. *Why deferred:* ±2–3% doesn't change the economics.

**No auth on the hosted demo** — *Today:* per-IP rate limiting + upload
size caps + answer-context cost cap. *Planned:* API keys/quotas if this
becomes a real service. *Why deferred:* judging traffic doesn't warrant an
auth system; the bill is already bounded.

**Vanilla web UI, no framework** — *Today:* dependency-free `index.html` +
`style.css`, and a typed `src/client/app.ts` (compiled to `public/app.js` via
`tsconfig.client.json`, a separate build target from the server): sample
library, live token bars, clickable expand_section, parity panel. *Planned:*
a proper front-end (framework, design system, streaming results, auth) if the
web app becomes a product rather than a demo instrument. *Why deferred:* the
product is the pipeline + MCP server; the page is one form and two result
panels — below the complexity threshold where a framework pays for its build
step, dependency surface, and cold-start cost. Polish is a design problem,
not a framework problem — but "no framework" doesn't mean "no types or
structure," hence the split files and the typed client build.

**CJK languages (Japanese, Chinese)** — *Today:* the tokenizer is
Unicode-aware and handles all space-delimited scripts (tested with
Devanagari, incl. combining marks). CJK text has no word boundaries, so
BM25 quality degrades. *Planned:* character-bigram tokenization for CJK
runs — a standard, compact fix. *Why deferred:* correct support deserves
its own test corpus, not a guess shipped untested.

## Demo script

See [DEMO_SCRIPT.md](DEMO_SCRIPT.md) — the 3-minute arc is: money (live
cost meter + session savings counter) → proof (answer-parity button) →
the model at the center (Claude Code calling the MCP tool autonomously) →
controlled failure (a deliberate recall miss recovered via the
omitted-sections manifest and `expand_section`).
