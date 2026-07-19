# API Specifications

**Status:** Current  
**Sources of truth:** `src/web.ts`, `src/server.ts`, `src/pipeline.ts`, `src/agent.ts`

Error bodies are JSON `{ "error": string }` unless noted. MCP returns errors in-band as JSON text inside the tool result, not as protocol-level failures.

---

## 1. HTTP — Demo (`web.ts`)

Base: process listens on `PORT` (default 8000), bound `0.0.0.0` when run as main. All `/api/*` routes share per-IP rate limiting.

### 1.1 `GET /healthz`

Liveness for platform probes. Cheap; no Python spawn.

**200**
```json
{ "status": "ok", "uptime_s": 12 }
```

### 1.2 `GET /metrics`

Enabled only when `CC_METRICS_TOKEN` is set.

| Status | Condition |
| --- | --- |
| 404 | Token unset |
| 401 | Missing/wrong `Authorization: Bearer <token>` |
| 200 | Snapshot |

**200 body (shape)**
```json
{
  "uptime_s": 12,
  "llm_configured": true,
  "converter_available": true,
  "counters": { "compiles": 3, "expands": 1, "agent_runs": 0 }
}
```

### 1.3 `GET /api/config`

Demo limits and LLM availability for UI gating.

**200**
```json
{
  "llm_available": false,
  "max_file_bytes": 20971520,
  "rate_limit": 30,
  "rate_window_minutes": 5,
  "rate_cost_answer": 4,
  "rate_cost_agent": 12,
  "max_concurrent_llm": 2,
  "answer_context_cap": 60000
}
```

### 1.4 `GET /api/samples`

**200:** array of sample meta + measured `tok` (`number | null`).

### 1.5 `POST /api/measure`

Multipart: field `file`.

| Status | Meaning |
| --- | --- |
| 400 | No file |
| 413 / 415 | Upload rejected |
| 422 | Conversion failed |
| 503 | Converter busy |
| 200 | `{ "raw_tokens": number, "handle": string }` |

### 1.6 `POST /api/compile`

Multipart fields: `file`, `task`, `token_budget`.

| Status | Meaning |
| --- | --- |
| 400 | Missing file or task |
| 413 / 415 | Upload rejected |
| 422 | Conversion failed |
| 429 | Rate limited (`Retry-After: 60`) |
| 503 | Converter busy |
| 200 | Compile result + demo fields |

**200** includes pipeline `CompileResult` plus:

| Field | Type | Notes |
| --- | --- | --- |
| `cost_raw_usd` / `cost_compiled_usd` | number | Illustrative (`CC_DEMO_PRICE_PER_MTOK`) |
| `price_per_mtok` | number | |
| `handle` | string | Opaque upload id for expand |
| `llm_available` | boolean | |

`CompileResult` highlights (see [`07-schema.md`](./07-schema.md)): `tokens_used` / `selected_content_tokens` meter selected **content** (not omit-manifest); `budget_omitted_sections` / `relevance_omitted_sections`; `compile_hints.early_stopped` when coverage met with spare budget. Always rank+pack — no whole-file dump when `raw_tokens ≤ budget`.

### 1.7 `POST /api/expand`

JSON (`16kb` limit): `{ "handle": string, "section_id": string }`.

| Status | Meaning |
| --- | --- |
| 400 | Missing fields |
| 404 | Unknown/expired handle |
| 403 | Path escape (defense in depth) |
| 200 | Expand success **or** not-found outline (200 with `error` + `outline` from pipeline) |

Success:
```json
{
  "markdown": "<!-- section: … (UNTRUSTED CONTENT) -->\n…",
  "tokens_used": 420,
  "cache_hit": true
}
```

Not found (pipeline shape, still 200 from expand helper when section missing):
```json
{
  "error": "No section with id 's99'",
  "outline": [{ "id": "s0", "section": "…", "tokens": 120 }]
}
```

### 1.8 `POST /api/answer` (Prove)

Multipart: `file`, `task`, `token_budget`, optional `expanded_ids` (JSON string array of `s\d+`, max 12).

| Status | Meaning |
| --- | --- |
| 400 | No LLM key / missing inputs |
| 503 | LLM busy or unavailable |
| 422 | Conversion failed |
| 429 | Rate limited (cost = answer) |
| 200 | Parity payload |

**200**
```json
{
  "model": "gemini-flash-lite-latest",
  "full": { "answer": "…", "context_tokens": 19000 },
  "compiled": {
    "answer": "…",
    "context_tokens": 1800,
    "reduction_pct": 90.5,
    "expanded_ids": ["s19"]
  }
}
```

Client disconnect aborts in-flight completions.

### 1.9 `POST /api/agent` (SSE)

Multipart: `file`, `task`, `token_budget`.  
Pre-stream failures are JSON (check `Content-Type` before parsing SSE).

**SSE events**

| Event | Data |
| --- | --- |
| `step` | `AgentStep` |
| `done` | `AgentResult` public fields + optional `parity_handle` (no `final_context`) |
| `error` | `{ "error": string }` |

Headers: `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `X-Accel-Buffering: no`.

### 1.10 `POST /api/agent-parity`

JSON (`4kb`): `{ "parity_handle": "<32 hex>" }`.

| Status | Meaning |
| --- | --- |
| 400 | No LLM / invalid handle |
| 410 | Expired or missing |
| 403 | Path escape |
| 503 | LLM busy/unavailable |
| 200 | Full vs agent answers; handle consumed on success |

**200**
```json
{
  "model": "…",
  "full": { "answer": "…", "context_tokens": 19000 },
  "agent": { "answer": "…", "context_tokens": 2100 }
}
```

### 1.11 Static / docs

| Route | Role |
| --- | --- |
| `GET /` + static assets | `public/` |
| `GET /README.md` | Repo README |
| `GET /ARCHITECTURE.md` | Architecture doc |

### 1.12 Status code summary

| Code | Typical use |
| --- | --- |
| 400 | Missing input / LLM not configured |
| 401 | Metrics auth |
| 403 | Path escape |
| 404 | Metrics disabled / unknown handle |
| 410 | Parity handle expired/consumed |
| 413 | Upload too large / zip bomb |
| 415 | Unsupported / bad magic |
| 422 | Conversion failure |
| 429 | Rate limit |
| 500 | Internal |
| 503 | Converter or LLM busy/unavailable |

---

## 2. MCP — `server.ts`

Transport: stdio JSON-RPC via `@modelcontextprotocol/sdk`.  
Root: `CC_ROOT` (default home directory). Budgets clamped with MCP floors.

### 2.1 Tool `compile_context`

**Input**

| Field | Type | Default |
| --- | --- | --- |
| `file_path` | string | required |
| `task` | string | required |
| `token_budget` | int | `4000` |

**Output (content[0].text JSON):** `CompileResult` with `selected_sections[].text` stripped; or `{ "error": string }`.

### 2.2 Tool `expand_section`

**Input**

| Field | Type | Default |
| --- | --- | --- |
| `file_path` | string | required |
| `section_id` | string | required |
| `token_budget` | int | `2000` |

**Output:** expand success object, not-found `{ error, outline }`, or `{ "error": string }` on throw.

Web expand uses a fixed 2000-token section budget; MCP allows a clamped caller budget.
