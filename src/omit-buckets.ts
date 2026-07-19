/**
 * Split omitted sections into budget-relevant gaps vs lower-relevance omits.
 * Used by pipeline (server) and tested directly — client stays thin.
 */
import { type NextSectionHint } from "./budget-hint.js";
import { topOmittedByRelevance, type NoteSection } from "./compile-notes.js";

export interface OmitBucketSection extends NoteSection {
  /** Multi-query: sub-question indices this section best answers among uncovered aspects. */
  gap_queries?: number[];
  /** When this omit matches next_section_hint. */
  suggested_budget?: number;
}

export interface OmitBuckets {
  budget_omitted_sections: OmitBucketSection[];
  relevance_omitted_sections: NoteSection[];
}

export interface ClassifyOmitInput {
  token_budget: number;
  tokens_used: number;
  queries: string[];
  selected_sections: NoteSection[];
  omitted_sections: NoteSection[];
  next_section_hint: NextSectionHint | null;
  /** Per sub-query, the id of the highest-scoring section (multi-query only). */
  query_best_ids?: string[];
}

function gapQueriesForSection(section: NoteSection, uncoveredQueries: number[]): number[] {
  if (!section.matched_queries?.length || !uncoveredQueries.length) return [];
  const uncovered = new Set(uncoveredQueries);
  return section.matched_queries.filter((qi) => uncovered.has(qi));
}

/** True when this omitted section is the overall top omit that lost primarily on size. */
function isTopOmittedForSize(
  section: NoteSection,
  omitted: NoteSection[],
  selected: NoteSection[],
  tokenBudget: number,
  tokensUsed: number,
  nextHint: NextSectionHint | null
): boolean {
  if (nextHint?.id === section.id) return true;

  const topOmit = topOmittedByRelevance(omitted);
  if (!topOmit || topOmit.id !== section.id) return false;

  if (selected.length === 0) return true;

  const selRel = Math.max(0, ...selected.map((s) => s.relevance ?? 0));
  const omitRel = section.relevance ?? 0;
  if (omitRel <= selRel) return false;

  const spare = tokenBudget - tokensUsed;
  const budgetBound = spare < tokenBudget * 0.12;
  if (section.tokens + 80 > tokenBudget) return true;
  if (budgetBound && section.tokens + 20 > spare) return true;
  return false;
}

export function classifyOmitBuckets(input: ClassifyOmitInput): OmitBuckets {
  const { omitted_sections, selected_sections } = input;
  if (!omitted_sections.length) {
    return { budget_omitted_sections: [], relevance_omitted_sections: [] };
  }

  const selectedIds = new Set(selected_sections.map((s) => s.id));
  const hintTargetsOmit =
    input.next_section_hint &&
    !selectedIds.has(input.next_section_hint.id) &&
    omitted_sections.some((s) => s.id === input.next_section_hint!.id)
      ? input.next_section_hint.id
      : null;

  const uncoveredQueries: number[] = [];
  if (input.query_best_ids) {
    input.query_best_ids.forEach((bestId, qi) => {
      if (!selectedIds.has(bestId)) uncoveredQueries.push(qi);
    });
  }

  const budgetIds = new Set<string>();
  const gapMap = new Map<string, number[]>();

  for (const s of omitted_sections) {
    const gaps = gapQueriesForSection(s, uncoveredQueries);
    if (gaps.length > 0) {
      budgetIds.add(s.id);
      gapMap.set(s.id, gaps);
    }
  }

  if (hintTargetsOmit) budgetIds.add(hintTargetsOmit);

  for (const s of omitted_sections) {
    if (budgetIds.has(s.id)) continue;
    if (
      isTopOmittedForSize(
        s,
        omitted_sections,
        selected_sections,
        input.token_budget,
        input.tokens_used,
        input.next_section_hint
      )
    ) {
      budgetIds.add(s.id);
    }
  }

  const budget_omitted_sections: OmitBucketSection[] = [];
  const relevance_omitted_sections: NoteSection[] = [];

  for (const s of omitted_sections) {
    if (budgetIds.has(s.id)) {
      const entry: OmitBucketSection = { ...s };
      const gaps = gapMap.get(s.id);
      if (gaps?.length) entry.gap_queries = gaps;
      if (input.next_section_hint?.id === s.id) {
        entry.suggested_budget = input.next_section_hint.suggested_budget;
      }
      budget_omitted_sections.push(entry);
    } else {
      relevance_omitted_sections.push(s);
    }
  }

  budget_omitted_sections.sort((a, b) => (b.relevance ?? 0) - (a.relevance ?? 0));
  relevance_omitted_sections.sort((a, b) => (b.relevance ?? 0) - (a.relevance ?? 0));

  return { budget_omitted_sections, relevance_omitted_sections };
}
