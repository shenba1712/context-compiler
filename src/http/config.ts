import { MAX_FILE_BYTES } from "../engine/config.js";
import { intEnv } from "../engine/env.js";
import { hasLlm } from "../engine/llm.js";

const RATE_LIMIT = intEnv("CC_RATE_LIMIT", 100, 1);
const RATE_COST_AGENT = intEnv("CC_RATE_COST_AGENT", 12, 1, 100);
const RATE_COST_ANSWER = intEnv("CC_RATE_COST_ANSWER", 4, 1, 100);
const WINDOW_MS = 5 * 60_000;

/** Public host limits for GET /api/config (Nest + Express). */
export function getApiConfig() {
  return {
    llm_available: hasLlm(),
    max_file_bytes: MAX_FILE_BYTES,
    rate_limit: RATE_LIMIT,
    rate_window_minutes: Math.round(WINDOW_MS / 60_000),
    rate_cost_answer: RATE_COST_ANSWER,
    rate_cost_agent: RATE_COST_AGENT,
    max_concurrent_llm: intEnv("CC_MAX_CONCURRENT_LLM", 2, 1, 32),
    answer_context_cap: intEnv("CC_ANSWER_CONTEXT_CAP", 60_000, 1000),
  };
}

export { RATE_LIMIT, RATE_COST_AGENT, RATE_COST_ANSWER, WINDOW_MS };
