# Context Compiler

![tests](https://github.com/shenba1712/context-compiler/actions/workflows/test.yml/badge.svg)

Every time an AI agent opens a file, it usually pays for the whole thing — even when the answer lives in a single paragraph. A ninety-page novel read a thousand times at a few dollars per million tokens is not a rounding error. It is a bill you keep replaying.

Context Compiler is a small, local-first layer that sits in front of that habit. You give it a file, a task, and a token budget. It returns only the sections that look relevant as markdown, plus a manifest of everything it left out so the agent can fetch more if it was wrong. On the documents we care about — novels, manuals, reports, spreadsheets — that routinely means ninety-one to ninety-seven percent fewer tokens with the answer still intact.

The demo ships a real sample library so you can feel that claim with your hands: novels and a science text as PDF or DOCX, a business report, a financials spreadsheet, a drone manual, and short-story sets in English and Hindi. Watch a long novel compress to a single question’s worth of context and you stop needing the pitch deck.

## What actually happens

Under the hood the path is deliberately boring. The file is converted to markdown, split into heading-aware chunks (tables stay whole — we refuse to drop rows quietly), ranked against your question with our own BM25, and packed under the budget with document order restored. When the whole file already fits, we skip ranking entirely. Ranking is a lossy step; if lossless is affordable, we take it.

TypeScript owns that pipeline. Python shows up only as the `markitdown` converter binary — the same way apps ship ffmpeg — so you get docx, xlsx, pptx, pdf, and friends without writing a single custom parser. Conversion results are cached by content hash: same bytes, same markdown, no TTL games.

If you have an LLM key, answer parity and agent mode can call the model. Compile itself stays on BM25 — free, local, no quota. Without a key, everything else still works offline. That is not a degraded mode. That is the default.

## Getting it running

The easiest path is Docker, which is also what a hosted deploy looks like:

```bash
docker build -t context-compiler .
docker run -p 8000:8000 -e GEMINI_API_KEY=$GEMINI_API_KEY context-compiler
# open http://localhost:8000
```

Point Render, Railway, or Fly at the included [`render.yaml`](./render.yaml) if you want a blueprint. This needs a real container or VM, not a serverless function — it shells out to Python and keeps upload handles in memory, neither of which survives a cold invoke.

**Free-tier hosts (Render Free, etc.):** the service sleeps after roughly fifteen minutes idle. The next request wakes it — expect a **30–60 second cold start** before `/healthz` or the UI responds. Ping `/healthz` every few minutes (UptimeRobot or similar) to keep it warm, or use a paid always-on plan for a live judging week.

On a machine you already live in, you need Node 20+ and Python 3.10+:

```bash
npm install && npm run build
python3 -m pip install "markitdown[docx,pdf,xlsx,pptx]"
export GEMINI_API_KEY=...   # optional
npm run web                 # http://localhost:8000
```

If pip is awkward on your system, `uv tool install "markitdown[docx,pdf,xlsx,pptx]"` does the same job without fighting Homebrew’s externally-managed Python. Or skip Python entirely and stay on Docker.

## About API keys

No key yet? Nothing is blocked. An LLM key unlocks the demo’s answer-parity panel and agent mode (which need a model to answer or decide the next hop). Compile is always BM25 — no model call. Without any key, conversion, chunking, BM25, packing, both MCP tools, and the full web demo still run. CI verifies that path on every commit with no secrets set.

When you do configure keys, they are tried in priority order and fail over automatically — rate limit, quota, outage, whatever — so one free-tier wall does not take the feature down while another key still works. Gemini is the intended free primary (`GEMINI_API_KEY`), OpenRouter the natural fallback (`OPENROUTER_API_KEY`), then Anthropic, then any OpenAI-compatible endpoint via `OPENAI_API_KEY` or `CC_LLM_API_KEY` plus `CC_LLM_BASE_URL`. Per-provider model overrides live in `CC_GEMINI_MODEL`, `CC_OPENROUTER_MODEL`, and friends. OpenRouter’s `:free` model IDs come and go; if the default stops answering, set `CC_OPENROUTER_MODEL` to whatever is current on their models page.

On a hosted deployment the operator sets the key as a server env var. It never reaches the browser. Locally or over MCP, it is simply your key in your environment. Compile is free of model cost by default; a parity comparison is roughly a dime at worst, and the demo rate-limits plus caps the full-file side of that comparison so a public instance cannot silently burn a bill.

## Plugging it into an agent

The product surface is two MCP tools on purpose. `compile_context` turns a file into budgeted, task-relevant markdown. `expand_section` pulls back one omitted section by id. Together they form a closed loop: compress, inspect the manifest, recover. Extra tools would only dilute an agent’s ability to choose the right one.

Wire it into Codex, Claude Desktop, Claude Code, or Cursor the usual way — point the client at `node /path/to/context-compiler/dist/server.js` and set `CC_ROOT` to the directory agents are allowed to read. Paths are resolved with realpath before the allowlist check, so a symlink inside the root that points outside it cannot escape.

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

Claude Code is one line: `claude mcp add context-compiler -- node /path/to/context-compiler/dist/server.js`.

The hosted demo never accepts a caller-supplied path. Uploads only. The path-based API lives on the local MCP surface, where confinement belongs.

## What the demo is trying to prove

Without an API key, the page already shows the whole argument. Upload a file, ask a question, drag the budget slider. You get relevance percentages per section, red and green token bars, a cost meter at an explicit dollars-per-million assumption, and a compiled context you can literally read. That human inspection is the first proof. The numbers are just math.

With a key, “Prove answer parity” asks the model the same question twice — once from the full converted file, once from the compiled slice — and puts the answers side by side. Cheap context is worthless if the answer changes. The panel is there so you do not have to take our word for it.

## Agent mode, or watching the model drive retrieval

A one-shot compile is a human picking a budget. The point of the tool, though, is an agent using it.

The demo’s “Run agent” button is the controlled version of that story. You ask a question; there is no slider. The model compiles a small slice, reads the omitted-sections manifest, and decides what to do next — expand a specific section, recompile at a larger budget, or answer. Each step streams live. A token meter climbs as it reads, next to the crossed-out whole-file count. The loop is bounded on purpose: a max-steps cap, a total token ceiling, and a fail-safe that turns any unusable decision (bad JSON, unknown section, a recompile that would not grow) into “answer with what we have” rather than a spin. It needs an LLM key and rides the same Gemini → OpenRouter failover chain as everything else.

Separately, any real coding agent over MCP can call the same two tools in its own loop. That is the credibility shot for a recording; the in-repo button is the dependable one. Both share one design idea: the omitted-sections manifest is not decoration. It is the map. Design notes and a capture recipe live in [DEMO_SCRIPT.md](DEMO_SCRIPT.md); the deeper engineering story is in [ARCHITECTURE.md](ARCHITECTURE.md).

## Choosing a budget

Budget by question breadth, not file size. A factual lookup is happy around a thousand tokens. Synthesis across a few sections wants something like four thousand. “Summarize everything” needs a budget at least as large as the file — at which point the compiler returns the whole document as lossless passthrough.

The budget is a ceiling, not a target. When ranking shows a clear relevance drop-off, packing stops early and returns less than you allowed (`CC_RELEVANCE_FLOOR`, default 0.4 × the top score). On vague questions with no clear signal, the packer fills the budget as recall insurance. Leaving the slider at four thousand is almost always fine.

Compound questions (“What voids the warranty? Can it fly in rain?”) get split into sub-queries for BM25 and interleaved round-robin so each facet gets a fair shot at the budget.

## Logs, health, and a quiet alert path

A tool that sits on the hot path of agents needs to be boring to operate. Logs always go to stderr — never stdout — because the MCP server speaks JSON-RPC on stdout and a single stray print would corrupt the protocol. Levels are gated by `CC_LOG_LEVEL` (`error`, `warn`, `info`, `debug`, or `silent`; default `info`, and tests mute themselves via `NODE_ENV=test`). Set `CC_LOG_JSON=1` if you want one JSON object per line for a log drain.

Error-level events can also POST to `CC_LOG_WEBHOOK` if you set it — a one-env-var path to Better Stack or a tiny collector of your own, with no SDK dependency. Delivery is best-effort and never throws; monitoring must not be able to break the request it is reporting on. Paths inside webhook payloads are redacted. Warns and infos stay in the log stream. Only errors fan out as alerts.

`GET /healthz` is a cheap liveness probe (uptime only) so free-tier hosts can pass platform health checks without spawning Python. Deeper counters, `llm_configured`, and `converter_available` live at `GET /metrics`, which is disabled until you set `CC_METRICS_TOKEN` and call it with `Authorization: Bearer <token>`. Agent and answer routes cost more against the per-IP rate limit (`CC_RATE_COST_AGENT` / `CC_RATE_COST_ANSWER`) and share a concurrency cap (`CC_MAX_CONCURRENT_LLM`) so one enthusiastic client cannot melt the API bill. LLM calls time out (`CC_LLM_TIMEOUT_MS`) and abort when the browser disconnects.

Behind a reverse proxy, set `CC_TRUST_PROXY` to a hop count like `1` — not the string `true` (that trusts any client `X-Forwarded-For` and disables rate limits). Blanket `true` only works if you also set `CC_ALLOW_INSECURE_TRUST_PROXY=1`.

## Configuration, in plain language

LLM keys and model overrides are described above. Beyond those: `CC_ROOT` confines the MCP server (default home), `CC_CACHE_DIR` holds converted markdown (default `~/.cache/context-compiler`), `CC_MAX_FILE_BYTES` refuses oversized uploads (default **20 MB** on the public demo), `CC_CONVERT_TIMEOUT_S` time-boxes the converter (120s), and `CC_MARKITDOWN_CMD` points at a non-PATH binary if you need to. The demo’s cost meter assumes `CC_DEMO_PRICE_PER_MTOK` (default 3.0). Rate limiting is `CC_RATE_LIMIT` requests per five minutes (default 30), with higher costs for agent/answer calls. Behind a reverse proxy, set `CC_TRUST_PROXY=1` (hop count) — never the string `true` unless you also set `CC_ALLOW_INSECURE_TRUST_PROXY=1`. The hosted demo is open (no accounts); abuse is handled with rate limits, size caps, and LLM concurrency — not a shared passphrase.

## Tests and troubleshooting

`npm test` builds both the server and the typed browser client, then runs a plain `node:assert` suite — chunking, ranking, packing, cache, expand, multilingual BM25, CJK bigrams, a curated offline recall@budget eval in `src/eval/`, format conversion through real markitdown, upload and path guards, provider failover, the agent loop, logger and webhook behavior, and `/healthz`. No test framework, on purpose; the file is readable top to bottom.

If you see `spawn markitdown ENOENT`, the converter is not on PATH — install it or set `CC_MARKITDOWN_CMD`. If pip quietly gives you markitdown `0.0.1a1`, your default Python is older than 3.10; uninstall and reinstall with uv on 3.12. Empty conversion output usually means a scanned PDF with no text layer. Port 8000 already taken? `PORT=8080 npm run web`. First request on a free-tier host hanging for half a minute? That is usually the platform cold start (service waking up), sometimes followed by an uncached conversion — ping `/healthz` or open the page a minute early before a live demo.

## Security, briefly

Untrusted files are size-capped, time-boxed, and parsed in a subprocess with no shell. Uploads are sniffed for content that does not match the claimed extension, and zip bombs are rejected by declared uncompressed size before they ever reach the converter. MCP reads are confined to `CC_ROOT` after realpath. Without an API key, the file never leaves the machine.

Prompt injection is a known game on this stage. Compiled output is wrapped in `UNTRUSTED DOCUMENT CONTENT` markers, and answer/agent prompts tell the model to treat document text as data. That is mitigation, not a sandbox — a clever PDF can still try to steer the model. The product answer is the same as for recall misses: the omitted-sections manifest makes loss visible, and `expand_section` (or a second compile) recovers. If you are judging this demo, try to break parity with an injected doc; then watch whether the agent can still navigate the manifest. That is the design under stress, not a bug we pretend away.

## What we know we do not do yet

Lexical ranking can still miss a paraphrased-but-relevant section. The mitigation is the manifest plus `expand_section` — failure is visible and repairable, never silent. An offline recall@budget suite in `src/eval/` (lexical, paraphrase, multi-query, heading-less, compare, and miss→expand cases) guards regressions in CI. Local embeddings as a second scorer are still planned for when they can stay local-first without free-tier RAM blowups.

Scanned, image-only PDFs have nothing to rank; we fail loudly rather than invent text. OCR is deferred because a bad transcript silently corrupts answers, which violates the “never silently lossy” rule. Video and audio would plug in as a transcription head on the same pipeline; they are a scope cut, not a feasibility one.

Token budgets are counted with cl100k. Other model tokenizers drift by a couple of percent; budgets are contracts of intent. The hosted demo has rate limits and cost caps but no user accounts — fine for judging traffic from a public GitHub link, not for a public SaaS. CJK ranking uses character bigrams plus a light Latin stem; the eval suite is how we keep those claims honest.

The web UI stays vanilla HTML, CSS, and a typed `src/client` build compiled to plain scripts. The product is the pipeline and the MCP server. The page is an instrument for proving them — and that is enough for now.
