export type Sample = {
  key: string;
  file: string;
  fmt: string;
  nm: string;
  mt: string;
  q: string[];
  tok: number | null;
};

export type SectionInfo = {
  id: string;
  section: string;
  tokens: number;
  relevance: number | null;
  truncated?: boolean;
  full_tokens?: number;
  remainder_tokens?: number;
  matched_queries?: number[];
  text?: string;
};

export type BudgetOmitSection = SectionInfo & {
  gap_queries?: number[];
  suggested_budget?: number;
};

export type CompileApiResult = {
  markdown: string;
  raw_tokens: number;
  tokens_used: number;
  selected_content_tokens: number;
  tokens_saved: number;
  reduction_pct: number;
  cache_hit: boolean;
  token_budget: number;
  queries: string[];
  selected_sections: SectionInfo[];
  omitted_sections: SectionInfo[];
  budget_omitted_sections: BudgetOmitSection[];
  relevance_omitted_sections: SectionInfo[];
  next_section_hint: {
    id: string;
    section: string;
    tokens: number;
    relevance: number;
    suggested_budget: number;
  } | null;
  compile_hints?: {
    multi_part_nudge: boolean;
    omit_action: boolean;
    named_omit: SectionInfo | null;
    early_stopped?: boolean;
  };
  cost_raw_usd: number;
  cost_compiled_usd: number;
  price_per_mtok: number;
  handle: string;
  llm_available: boolean;
  error?: string;
};

export type ServerConfig = {
  llm_available: boolean;
  llm_disabled_reason?: string | null;
  max_file_bytes?: number;
  web_budget_min?: number;
  web_budget_max?: number;
  rate_limit?: number;
  rate_window_minutes?: number;
  rate_cost_answer?: number;
  rate_cost_agent?: number;
  max_concurrent_llm?: number;
  answer_context_cap?: number;
};

export type MeasureApiResult = {
  raw_tokens: number;
  handle: string;
  error?: string;
};

export type ExpandApiResult = {
  markdown: string;
  tokens_used: number;
  cache_hit: boolean;
  error?: string;
};

export type AgentParityResult = {
  model: string;
  full: { answer: string; context_tokens: number };
  agent: { answer: string; context_tokens: number };
  error?: string;
};

export type AgentRunStatus = "running" | "succeeded" | "failed" | "cancelled";

export type AgentRunSourceIdentity = Readonly<{
  documentName: string;
  sampleKey: string | null;
  size: number;
  type: string;
  lastModified: number;
}>;

export type AgentRunStep = Readonly<{
  kind?: string;
  title?: string;
  detail?: string;
  action?: string;
  n?: number;
  section_id?: string;
  tokens_added?: number;
  truncated?: boolean;
  [key: string]: unknown;
}>;

export type AgentRunMeta = Readonly<{
  tokensRead: number;
  rawTokens: number;
  finalTokens: number;
  stoppedReason: string;
  unreadRemaining: boolean;
}>;

export type AgentRunSnapshot = Readonly<{
  id: string;
  task: string;
  budget: number;
  source: AgentRunSourceIdentity;
  sourceFile: File;
  status: AgentRunStatus;
  steps: readonly AgentRunStep[];
  answer: string;
  meta: AgentRunMeta | null;
  parityHandle: string | null;
  parityResult: AgentParityResult | null;
  error: string | null;
  submittedAt: string;
  completedAt: string | null;
}>;

export type AnswerApiResult = {
  model: string;
  full: { answer: string; context_tokens: number };
  compiled: {
    answer: string;
    context_tokens: number;
    selected_content_tokens?: number;
    expand_content_tokens?: number;
    reduction_pct: number;
    expanded_ids?: string[];
  };
  error?: string;
};

export type ProveRunStatus = "running" | "succeeded" | "failed" | "cancelled";

export type ProveRunSourceIdentity = Readonly<{
  documentName: string;
  sampleKey: string | null;
  size: number;
  type: string;
  lastModified: number;
}>;

export type ProveRunSnapshot = Readonly<{
  id: string;
  retryOf: string | null;
  task: string;
  budget: number;
  compileHandle: string | null;
  expandedIds: readonly string[];
  expandedTokenSum: number;
  source: ProveRunSourceIdentity;
  sourceFile: File;
  status: ProveRunStatus;
  result: AnswerApiResult | null;
  error: string | null;
  submittedAt: string;
  completedAt: string | null;
}>;
