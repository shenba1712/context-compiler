/**
 * Client-side mirrors of the server's API shapes (src/pipeline.ts, src/web.ts).
 * Duplicated rather than imported: this file compiles for the browser (DOM
 * lib, no Node types), while the server compiles for Node — sharing a source
 * file across those two lib/module targets isn't worth the build complexity
 * for a handful of small interfaces. Keep these in sync with pipeline.ts.
 *
 * Deliberately NOT an ES module (no import/export): tsconfig.client.json
 * compiles with module "none" for a plain global <script>, and a module-ized
 * file (any top-level import/export, even type-only) makes tsc emit a
 * CommonJS `exports` object that doesn't exist in a browser and throws on
 * load. These interfaces are ambient globals, visible to app.ts without an
 * import because both files compile together as scripts, not modules.
 */

interface Sample {
  key: string;
  file: string;
  fmt: string;
  nm: string;
  mt: string;
  q: string[];
  /** Raw token count, measured server-side from the real file (GET /api/samples
   *  in web.ts), so budget presets can scale to the document's actual size
   *  before the first compile. Null if the server couldn't measure it. */
  tok: number | null;
}

interface BudgetPresets {
  quick: number;
  standard: number;
  deep: number;
}

interface SectionInfo {
  id: string;
  section: string;
  tokens: number;
  relevance: number | null;
  truncated?: boolean;
  full_tokens?: number;
  /** Content tokens still unread when truncated — for Prove “Include rest”. */
  remainder_tokens?: number;
  matched_queries?: number[];
  text?: string;
}

interface BudgetOmitSection extends SectionInfo {
  gap_queries?: number[];
  suggested_budget?: number;
}

/** Response body of POST /api/compile (CompileResult + web.ts's added fields). */
interface CompileApiResult {
  markdown: string;
  raw_tokens: number;
  tokens_used: number;
  /** Content tokens of selected sections only (no omit manifest). */
  selected_content_tokens: number;
  tokens_saved: number;
  reduction_pct: number;
  cache_hit: boolean;
  token_budget: number;
  queries: string[];
  selected_sections: SectionInfo[];
  omitted_sections: SectionInfo[];
  /** Task-relevant omits left out primarily for token budget. */
  budget_omitted_sections: BudgetOmitSection[];
  /** Lower-relevance omits for this task. */
  relevance_omitted_sections: SectionInfo[];
  /** Set when budget-bound and a strong omitted section still didn't fit. */
  next_section_hint: {
    id: string;
    section: string;
    tokens: number;
    relevance: number;
    suggested_budget: number;
  } | null;
  /** UX hints for multi-part nudge and omitted-section framing. */
  compile_hints?: {
    multi_part_nudge: boolean;
    omit_action: boolean;
    named_omit: SectionInfo | null;
    early_stopped?: boolean;
  };
  cost_raw_usd: number;
  cost_compiled_usd: number;
  price_per_mtok: number;
  /** Opaque server-minted reference to the uploaded file, passed back to
   *  /api/expand. Not a filesystem path (the old file_path leaked the server's
   *  layout and let a client name arbitrary paths). */
  handle: string;
  llm_available: boolean;
  error?: string;
}

/** Response body of POST /api/measure — a real, server-measured token count
 *  for a freshly uploaded file, ahead of Compile, via the same convert+cache
 *  pipeline a real compile uses. Not a guess: works identically for text and
 *  binary formats (xlsx, pptx, images, ...) since it's the real conversion. */
interface MeasureApiResult {
  raw_tokens: number;
  handle: string;
  error?: string;
}

/** Response body of POST /api/expand. */
interface ExpandApiResult {
  markdown: string;
  tokens_used: number;
  cache_hit: boolean;
  error?: string;
}

/** Response body of POST /api/answer. */
interface AnswerApiResult {
  model: string;
  full: { answer: string; context_tokens: number };
  compiled: {
    answer: string;
    context_tokens: number;
    /** Content tokens of compile selection (no omit manifest). */
    selected_content_tokens?: number;
    /** Content tokens added by included expands. */
    expand_content_tokens?: number;
    reduction_pct: number;
    /** Section ids from the demo UI that were merged into the compiled side. */
    expanded_ids?: string[];
  };
  error?: string;
}

/** One step in an agent run (mirrors AgentStep in src/agent.ts). Streamed over
 *  /api/agent as an SSE "step" event while the agent works. */
interface AgentStep {
  n: number;
  action: "compile" | "expand" | "recompile" | "answer";
  detail: string;
  reasoning?: string;
  section_id?: string;
  truncated?: boolean;
  tokens_added: number;
}

/** The final "done" event from /api/agent (mirrors AgentResult in agent.ts). */
interface AgentRunResult {
  answer: string;
  steps: AgentStep[];
  tokens_read: number;
  raw_tokens: number;
  final_context_tokens: number;
  stopped_reason: "confident" | "max_steps" | "token_ceiling" | "whole_file";
  /** True when omitted sections or a truncated expand left content unread. */
  unread_remaining?: boolean;
  /** Opaque handle for optional POST /api/agent-parity (server holds the context). */
  parity_handle?: string;
}

/** Response from POST /api/agent-parity. */
interface AgentParityResult {
  model: string;
  full: { answer: string; context_tokens: number };
  agent: { answer: string; context_tokens: number };
  error?: string;
}
