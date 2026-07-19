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
  truncated?: boolean;
  full_tokens?: number;
}

/** Absolute relevance % below which we don't bother naming an omitted section. */
const MIN_RELEVANCE = 40;

/**
 * Returns a hint when the compile nearly filled the budget and a strong
 * omitted section still wouldn't fit in the spare room, or when a selected
 * section was included only as a budget partial. Otherwise null
 * (relevance-bound runs, or only weak leftovers remain).
 */
export function nextSectionHint(
  tokenBudget: number,
  tokensUsed: number,
  omitted: HintSection[],
  selected: HintSection[] = []
): NextSectionHint | null {
  if (tokenBudget <= 0 || tokensUsed <= 0) return null;
  const spare = tokenBudget - tokensUsed;
  // Same threshold as the demo's "budget-bound" floor note (~12% unused).
  const budgetBound = spare < tokenBudget * 0.12;

  const truncated = selected
    .filter((s) => s.truncated && (s.relevance ?? 0) >= MIN_RELEVANCE)
    .sort((a, b) => (b.relevance ?? 0) - (a.relevance ?? 0))[0];
  if (truncated && truncated.relevance != null) {
    const full = truncated.full_tokens ?? truncated.tokens;
    const remainder = Math.max(0, full - truncated.tokens);
    const reasonablyFull = tokensUsed >= tokenBudget * 0.85;
    if (remainder > 0 && (budgetBound || reasonablyFull)) {
      const suggested_budget = Math.ceil((tokensUsed + remainder + 40) / 100) * 100;
      return {
        id: truncated.id,
        section: truncated.section,
        tokens: full,
        relevance: truncated.relevance,
        suggested_budget,
      };
    }
  }

  if (!budgetBound) return null;

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
