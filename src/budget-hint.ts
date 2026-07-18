/**
 * When packing is budget-bound, point at the next high-relevance omitted
 * section that did not fit beside the selection, and suggest a budget that
 * would keep what we have and add it.
 */
export interface NextSectionHint {
  id: string;
  section: string;
  tokens: number;
  relevance: number;
  suggested_budget: number;
}

export interface HintSection {
  id: string;
  section: string;
  tokens: number;
  relevance: number | null;
}

/** Absolute relevance % below which we don't bother naming an omitted section. */
const MIN_RELEVANCE = 40;

/**
 * Returns a hint when the compile nearly filled the budget and a strong
 * omitted section still wouldn't fit in the spare room. Otherwise null
 * (relevance-bound runs, or only weak leftovers remain).
 */
export function nextSectionHint(
  tokenBudget: number,
  tokensUsed: number,
  omitted: HintSection[]
): NextSectionHint | null {
  if (tokenBudget <= 0 || tokensUsed <= 0) return null;
  const spare = tokenBudget - tokensUsed;
  // Same threshold as the demo's "budget-bound" floor note (~12% unused).
  if (spare >= tokenBudget * 0.12) return null;

  const next = omitted
    .filter((s) => (s.relevance ?? 0) >= MIN_RELEVANCE)
    .sort((a, b) => (b.relevance ?? 0) - (a.relevance ?? 0))[0];
  if (!next || next.relevance == null) return null;
  // Still room for this section → packing left it out for another reason.
  if (next.tokens + 20 <= spare) return null;

  // Keep current compiled size and add the section, plus a little wrapper slack.
  const suggested_budget = Math.ceil((tokensUsed + next.tokens + 40) / 100) * 100;
  return {
    id: next.id,
    section: next.section,
    tokens: next.tokens,
    relevance: next.relevance,
    suggested_budget,
  };
}
