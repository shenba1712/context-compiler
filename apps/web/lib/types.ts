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
  max_file_bytes?: number;
  rate_limit?: number;
  rate_window_minutes?: number;
  rate_cost_answer?: number;
  rate_cost_agent?: number;
  max_concurrent_llm?: number;
  answer_context_cap?: number;
};

export type ExpandApiResult = {
  markdown: string;
  tokens_used: number;
  cache_hit: boolean;
  error?: string;
};

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
