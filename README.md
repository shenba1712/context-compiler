# Context Compiler

![tests](https://github.com/shenba1712/context-compiler/actions/workflows/test.yml/badge.svg)

Every time an AI agent opens a file, it usually pays for the whole thing — even when the answer lives in a single paragraph. A ninety-page novel read a thousand times at a few dollars per million tokens is not a rounding error. It is a bill you keep replaying.

Context Compiler is a local-first layer in front of that habit. You give it a file, a task, and a token budget. It returns only the sections that look relevant as markdown, plus a manifest of everything it left out so the agent can fetch more if it was wrong. On the documents we care about — novels, manuals, reports, spreadsheets — that routinely means ninety-one to ninety-seven percent fewer tokens with the answer still intact.

The demo ships a sample library so you can feel that claim: novels and a science text as PDF or DOCX, a business report, a financials spreadsheet, a pitch deck, a drone manual, and short-story sets in English, Hindi, Spanish, Russian, and Arabic.

**Live demo:** [https://context-compiler.onrender.com](https://context-compiler.onrender.com)

## Current behavior (short)

- **Coverage-first packing.** Budget is a hard ceiling, not a fill quota. Multi-facet questions cover each aspect first; then discriminative terms / name-intent; then stop when marginal gain ≈ 0. Pointed queries leave spare budget unused instead of padding with weak sections.
- **Always rank + pack.** Even when the raw file is smaller than the budget, compile does not dump the whole document — zero-relevance fillers stay omitted.
- **Content metering.** Compile / Prove / Agent report *selected section* tokens (omit-manifest ballast is not counted toward the ceiling). Small HTML wrappers may ride on the wire; the meter strips them.
- **Multilingual ranking.** BM25 tokenization and query splitting cover the demo languages (Latin, Devanagari, Cyrillic, Arabic, CJK bigrams). Suggested sample questions are checked against converted sample text.
- **Honest recovery.** Misses stay in the omitted-sections manifest (budget vs lower-relevance buckets in the UI); `expand_section` / Agent recover them.

For engineering depth, see [ARCHITECTURE.md](./ARCHITECTURE.md) and [docs/EXPERT-WALKTHROUGH.md](./docs/EXPERT-WALKTHROUGH.md).

**Audits** (2026-07-19): [current / pack](./docs/AUDIT-CURRENT.md) · [UI / UX](./docs/AUDIT-UI.md) · [security / chaos](./docs/AUDIT-SECURITY.md).

## How it works

The pipeline is convert → chunk → rank → pack:

1. Convert the file to markdown via MarkItDown (docx, xlsx, pptx, pdf, and friends).
2. Split into heading-aware chunks (tables stay whole).
3. Rank against your question with local BM25 (compound tasks split into sub-questions and interleave).
4. Pack under the budget with **coverage-first** priorities, then restore document order. Manifest detail degrades before content is sacrificed.

Compile itself never calls a model — BM25 only, free and offline. An LLM key is optional and only unlocks Prove and Agent. Conversion results are cached by content hash.

## Compile, Prove, and Agent

| Mode | What it does | Needs an LLM key? |
| --- | --- | --- |
| **Compile** | Packs task-relevant sections under your budget; returns markdown + an omitted-sections manifest. | No |
| **Prove** | Asks the model the same question from the full file and from the compiled slice, side by side. | Yes |
| **Agent** | Lets the model compile, read the manifest, expand sections, and answer under the same budget as a soft reading ceiling. | Yes |

On the demo UI, **Compile once** is the default path. **Prove…** / **Prove answer parity** check answer quality for that compile (optionally including sections you marked **Include in Prove**). **Run agent** is a separate retrieval loop — not Prove.

Budget by question breadth, not file size: ~1k tokens for a factual lookup, ~4k for synthesis across a few sections. A pointed question at 4,000 often stops early with spare headroom — that is intentional. “Summarize everything” still needs a budget large enough to hold the sections you care about; the packer will not invent coverage it cannot score. Leaving the slider at 4,000 is almost always fine for demos.

## Install

### Docker

```bash
docker build -t context-compiler .
docker run -p 8000:8000 -e GEMINI_API_KEY=$GEMINI_API_KEY context-compiler
# open http://localhost:8000
```

Point Render, Railway, or Fly at [`render.yaml`](./render.yaml) for a blueprint. This needs a real container or VM — it shells out to Python and keeps upload handles in memory.

**Free-tier hosts (Render Free, etc.):** the service sleeps after roughly fifteen minutes idle. The next request wakes it — expect a **30–60 second cold start** before `/healthz` or the UI responds. Ping `/healthz` every few minutes (UptimeRobot or similar) to keep it warm, or use a paid always-on plan.

### Local

Node 20+ and Python 3.10+:

```bash
npm install && npm run build
python3 -m pip install "markitdown[docx,pdf,xlsx,pptx]"
export GEMINI_API_KEY=...   # optional
npm run web                 # http://localhost:8000
```

If pip fights Homebrew’s externally-managed Python, use `uv tool install "markitdown[docx,pdf,xlsx,pptx]"`. Or skip Python entirely and stay on Docker.

## API keys

Keys are **optional**. Without any key, conversion, chunking, BM25, packing, both MCP tools, and the full web demo still run. CI verifies that path on every commit with no secrets set.

A key unlocks **Prove** and **Agent** only. Compile stays on BM25 either way.

When keys are set, providers are tried in this order and fail over automatically (rate limit, quota, outage, retired model id):

1. **Gemini** (primary) — `GEMINI_API_KEY` or `GOOGLE_API_KEY`
2. **OpenRouter** — `OPENROUTER_API_KEY`
3. **Anthropic** — `ANTHROPIC_API_KEY`
4. **OpenAI-compatible** — `OPENAI_API_KEY`, or `CC_LLM_API_KEY` + `CC_LLM_BASE_URL`

On Gemini, several model ids are tried on the same key before leaving that provider:

`gemini-flash-lite-latest` → `gemini-3-flash-preview` → `gemini-flash-latest`

**Overrides:**

- Pin one Gemini model: `CC_GEMINI_MODEL`
- Custom Gemini list: `CC_GEMINI_MODELS` (comma-separated)
- OpenRouter model: `CC_OPENROUTER_MODEL` (free `:free` ids churn; set this if the default stops answering)

On a hosted deploy, set keys as server env vars — they never reach the browser. Locally or over MCP, they live in your environment.

### Advanced failover

Most operators can ignore these. Soft “model not found” / 404 responses for Gemini are skipped briefly in-process; 429/quota is not blacklisted but may pause briefly before the next chain entry (prefers `Retry-After` when present). Knobs: `CC_GEMINI_DEAD_MODEL_TTL_MS`, `CC_LLM_FAILOVER_COOLDOWN_MS`, `CC_LLM_TIMEOUT_MS`. Details live in [ARCHITECTURE.md](./ARCHITECTURE.md).

## MCP setup

Two tools: `compile_context` (budgeted, task-relevant markdown + omitted-sections manifest) and `expand_section` (fetch one omitted section by id). Together they form a closed loop: compress, inspect, recover.

Point the client at `node /path/to/context-compiler/dist/server.js` and set `CC_ROOT` to the directory agents may read. Paths are resolved with realpath before the allowlist check, so a symlink inside the root that points outside cannot escape. The hosted demo never accepts a caller-supplied path — uploads only.

```toml
# ~/.codex/config.toml
[mcp_servers.context-compiler]
command = "node"
args = ["/path/to/context-compiler/dist/server.js"]

[mcp_servers.context-compiler.env]
CC_ROOT = "/path/agents/may/read"
```

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

Claude Code: `claude mcp add context-compiler -- node /path/to/context-compiler/dist/server.js`.

## Gotchas

- **Cold start on free-tier hosts** — first hit after idle can take 30–60s (see Install).
- **`spawn markitdown ENOENT`** — converter not on PATH; install it or set `CC_MARKITDOWN_CMD`. If pip gives you markitdown `0.0.1a1`, your Python is older than 3.10; reinstall with uv on 3.12.
- **Empty conversion** — usually a scanned PDF with no text layer. We fail loudly rather than invent text.
- **Port 8000 taken** — `PORT=8080 npm run web`.
- **Behind a reverse proxy** — set `CC_TRUST_PROXY` to a hop count like `1`, not the string `true` (that trusts any client `X-Forwarded-For` and weakens rate limits).
- **OpenRouter free models** — ids come and go; override with `CC_OPENROUTER_MODEL` when needed.

## Useful env vars

| Variable | Role |
| --- | --- |
| `CC_ROOT` | MCP read confine (default: home directory) |
| `CC_CACHE_DIR` | Converted-markdown cache (default: `~/.cache/context-compiler`) |
| `CC_MAX_FILE_BYTES` | Upload size cap (default 20 MB) |
| `CC_CONVERT_TIMEOUT_S` | Converter timeout (default 120s) |
| `CC_MARKITDOWN_CMD` | Non-PATH markitdown binary |
| `CC_LOG_LEVEL` | `error` / `warn` / `info` / `debug` / `silent` (default `info`) |
| `CC_METRICS_TOKEN` | Enables `GET /metrics` with `Authorization: Bearer …` |
| `CC_DEMO_PRICE_PER_MTOK` | Demo cost-meter assumption (default 3.0) |

Rate limits, concurrency, and other ops knobs are documented in [ARCHITECTURE.md](./ARCHITECTURE.md). Logs always go to stderr (stdout is reserved for MCP JSON-RPC). `GET /healthz` is a cheap liveness probe.

## Tests

```bash
npm test
```

Builds the server and typed browser client, then runs a plain `node:assert` suite (chunking, ranking, packing, cache, expand, conversion, guards, failover, agent loop, and more). No test framework — the file is readable top to bottom.

## Security, briefly

Untrusted files are size-capped, time-boxed, and parsed in a subprocess. Uploads are sniffed for content that does not match the claimed extension; zip bombs are rejected by declared uncompressed size. MCP reads are confined to `CC_ROOT` after realpath. Without an API key, the file never leaves the machine.

Compiled output is wrapped in `UNTRUSTED DOCUMENT CONTENT` markers, and answer/agent prompts treat document text as data. That is mitigation, not a sandbox — a crafted document can still try to steer the model. The omitted-sections manifest keeps loss visible; `expand_section` recovers.

## Try it (demo)

Suggested questions come from the sample chips (they are grounded in the converted files — ask what is *in* the abridged text):

| Sample | Strong question | What to watch |
| --- | --- | --- |
| Pride and Prejudice | What does Mr. Darcy say about Elizabeth at the Meryton assembly? | Huge cut at ~2k–4k; hero-style bars |
| Meridian Annual Report | Which R&D programs were cancelled and why? | Early-stop: spare budget left unused once coverage is met |
| Meridian Financials | What was net profit in FY25, and which quarter had the best gross margin? | Multi-facet pack under one budget |
| Sherlock Holmes | What salary does the Red-Headed League offer, and what hours must Wilson keep? | Compound in-doc ask on a partial text |
| छोटी कहानियाँ / Cuentos / … | Use a chip in that language | Multilingual BM25 + script-aware tokenize |

Budget tips: **2,000** for a single-fact money shot; **4,000** default (often early-stops on pointed asks); drop to **~800** to force a controlled miss → peek / Include / expand.

Timed walkthrough: [DEMO_SCRIPT.md](./DEMO_SCRIPT.md).

## Known limits

Lexical BM25 can miss a paraphrased-but-relevant section. The mitigation is the omitted-sections manifest plus `expand_section` (or Agent mode). An offline recall@budget suite in `src/eval/` guards those claims in CI. Local embeddings as a second scorer are planned when they can stay local-first.

Coverage-first packing can still under-serve a multi-hop “compare §2 with appendix C” if one facet dominates the budget — split the question or raise the budget. Heading-less PDFs get weaker chunks. Scanned image-only PDFs have nothing to rank; OCR is deferred so a bad transcript cannot silently corrupt answers. Token budgets use cl100k; other tokenizers may drift by a couple of percent.

The hosted demo has rate limits and cost caps but no user accounts — fine for a public demo link, not a multi-tenant SaaS.

## License

[MIT](./LICENSE)
