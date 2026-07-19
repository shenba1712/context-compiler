# Schema

**Status:** Current  
**Note:** There is no SQL/database schema. Shapes below are TypeScript / JSON contracts for pipeline results, HTTP bodies, and in-memory stores.

Primary definitions: `src/pipeline.ts`, `src/agent.ts`, `src/client/types.ts`, `src/web.ts`.

---

## 1. Section and compile

### `SectionInfo`

```ts
{
  id: string;              // e.g. "s0"
  section: string;         // breadcrumb, e.g. "Warranty > Exclusions"
  tokens: number;
  relevance: number | null; // % of top BM25 score; null if no signal
  matched_queries?: number[]; // multi-query attribution indices
  text?: string;           // selected sections on web; stripped on MCP compile
}
```

### `NextSectionHint`

```ts
{
  id: string;
  section: string;
  tokens: number;
  relevance: number;
  suggested_budget: number;
} | null
```

Present when budget-bound and a strong omitted section still did not fit.

### `CompileResult` (pipeline)

```ts
{
  markdown: string;
  raw_tokens: number;
  tokens_used: number;
  tokens_saved: number;
  reduction_pct: number;     // one decimal place style (e.g. 92.6)
  cache_hit: boolean;
  token_budget: number;      // applied after clamp
  queries: string[];         // split sub-questions; length 1 if single
  selected_sections: SectionInfo[];
  omitted_sections: SectionInfo[];
  next_section_hint: NextSectionHint;
}
```

### Web compile response

`CompileResult` plus:

```ts
{
  cost_raw_usd: number;
  cost_compiled_usd: number;
  price_per_mtok: number;
  handle: string;            // 32 hex chars typical (randomBytes)
  llm_available: boolean;
}
```

---

## 2. Expand

### Success

```ts
{
  markdown: string;
  tokens_used: number;
  cache_hit: boolean;
}
```

### Not found

```ts
{
  error: string;
  outline: Array<{ id: string; section: string; tokens: number }>;
}
```

---

## 3. Measure / config / samples

### Measure

```ts
{ raw_tokens: number; handle: string }
```

### Config

```ts
{
  llm_available: boolean;
  max_file_bytes: number;
  rate_limit: number;
  rate_window_minutes: number;
  rate_cost_answer: number;
  rate_cost_agent: number;
  max_concurrent_llm: number;
  answer_context_cap: number;
}
```

### Sample (API)

```ts
{
  key: string;
  file: string;
  fmt: string;
  nm: string;
  mt: string;
  q: string[];
  tok: number | null;
}
```

---

## 4. Answer parity (Prove)

```ts
{
  model: string;
  full: { answer: string; context_tokens: number };
  compiled: {
    answer: string;
    context_tokens: number;
    reduction_pct: number;
    expanded_ids?: string[];
  };
}
```

Request field `expanded_ids`: JSON string of string array; server keeps only `/^s\d+$/`, unique, max 12.

---

## 5. Agent

### `AgentStep`

```ts
{
  n: number;
  action: "compile" | "expand" | "recompile" | "answer";
  detail: string;
  reasoning?: string;
  section_id?: string;
  tokens_added: number;
}
```

### `StopReason`

`"confident" | "max_steps" | "token_ceiling" | "whole_file"`

### `AgentResult` (server-internal may include `final_context`)

```ts
{
  answer: string;
  steps: AgentStep[];
  tokens_read: number;
  raw_tokens: number;
  final_context_tokens: number;
  stopped_reason: StopReason;
  final_context?: string;      // server-only; not sent on SSE done
}
```

### SSE `done` public payload

`AgentResult` without `final_context`, plus optional:

```ts
{ parity_handle?: string }  // /^[a-f0-9]{32}$/
```

### Agent parity response

```ts
{
  model: string;
  full: { answer: string; context_tokens: number };
  agent: { answer: string; context_tokens: number };
}
```

---

## 6. Error envelope

HTTP JSON:

```ts
{ error: string }
```

MCP tool failure / conversion failure:

```ts
{ error: string }
```

---

## 7. In-memory / ephemeral stores (not durable)

### Upload handles (`web.ts`)

```ts
Map<string, { path: string; ts: number }>
```

- Key: unguessable handle (hex).
- Value path must resolve under upload dir.
- Swept by `CC_UPLOAD_TTL_MS` (default 30 min).

### Agent parity store

```ts
Map<string, {
  path: string;
  task: string;
  agentContext: string;
  agentContextTokens: number;
  ts: number;
}>
```

- TTL `CC_AGENT_PARITY_TTL_MS` (default 15 min).
- Cap `CC_AGENT_PARITY_MAX` (default 200); oldest dropped.
- Deleted after successful `/api/agent-parity`.

### Rate limit map

```ts
Map<string /* ip */, number[] /* hit timestamps */>
```

Point pool over a 5-minute window; not shared across replicas.

### Conversion cache (disk)

Files `{sha256}.md` under `CC_CACHE_DIR`. Content-addressed; mtime age-out. Not a relational schema.

### Gemini dead-model cache (process)

```ts
Map<string /* model id */, number /* expiry epoch ms */>
```

---

## 8. IDs

| ID | Format / rules |
| --- | --- |
| Section id | `s` + integer (`s0`, `s19`) |
| Upload / parity handle | 32 lowercase hex from `randomBytes(16)` |
| Cache key | sha256 hex of file bytes |
