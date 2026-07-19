import { earlyStopSpareThreshold } from "./config.js";

/**
 * Pure compile-result note hints for UX (server → client). Tested in test.ts;
 * app.ts wraps these in HTML floor-note markup.
 */

export interface NoteSection {
  id: string;
  section: string;
  tokens: number;
  relevance: number | null;
  matched_queries?: number[];
}

export interface CompileNoteInput {
  reduction_pct: number;
  token_budget: number;
  tokens_used: number;
  queries: string[];
  selected_sections: NoteSection[];
  omitted_sections: NoteSection[];
  next_section_hint: {
    id: string;
    section: string;
    tokens: number;
    relevance: number;
    suggested_budget: number;
  } | null;
}

export interface CompileNoteHints {
  /** Multi-part task with omissions under budget. */
  multi_part_nudge: boolean;
  /** Generic actionable omit framing (lower-rel omits included). */
  omit_action: boolean;
  /** Section to name in omit-action copy (top omit or next_section_hint). */
  named_omit: NoteSection | null;
  /** Packer stopped before filling the budget — weaker sections skipped. */
  early_stopped: boolean;
}

export function lastCrumbLabel(section: string): string {
  const parts = section.split(" > ");
  return parts[parts.length - 1] ?? section;
}

export function isMultiPartCompile(d: CompileNoteInput): boolean {
  return (d.queries?.length ?? 0) >= 2;
}

export function topOmittedByRelevance(omitted: NoteSection[]): NoteSection | null {
  return omitted.reduce<NoteSection | null>(
    (a, s) => ((s.relevance ?? 0) > (a?.relevance ?? 0) ? s : a),
    null
  );
}

export function namedOmitSection(d: CompileNoteInput): NoteSection | null {
  // Omit-action copy names a fully omitted section. next_section_hint may point
  // at a truncated *selected* section (raise budget for the rest) — don't use
  // that here when an omitted section exists (multi-facet gaps).
  const topOmit = topOmittedByRelevance(d.omitted_sections);
  if (topOmit) return topOmit;
  if (d.next_section_hint) {
    const match = d.omitted_sections.find((s) => s.id === d.next_section_hint!.id);
    if (match) return match;
  }
  return null;
}

/** Plain floor-note body when coverage is met with budget headroom left. */
export const EARLY_STOPPED_FLOOR_TEXT =
  "Packed enough for this question under your token ceiling. Spare budget was left unused. " +
  "Raise the budget only if the answer looks incomplete.";

export interface EarlyStoppedHintInput {
  early_stopped?: boolean;
  token_budget: number;
  tokens_used: number;
  selected_sections: Array<{ id: string }>;
  omitted_sections: Array<{ id: string }>;
  next_section_hint: unknown;
}

/** True when the packer left meaningful budget headroom on purpose. */
export function isEarlyStoppedCompile(d: EarlyStoppedHintInput): boolean {
  if (d.early_stopped) return true;
  if (!d.selected_sections.length || !d.omitted_sections.length || d.next_section_hint) return false;
  const spare = d.token_budget - d.tokens_used;
  return spare > d.token_budget * earlyStopSpareThreshold();
}

/** Plain-text fragments (app.ts adds HTML wrapper). */
export const MULTI_PART_NUDGE_TEXT =
  "This may need more than one section. Check omitted sections below or raise the budget if the answer looks incomplete.";

export interface CompileNoteInputWithEarlyStop extends CompileNoteInput {
  early_stopped?: boolean;
}

export function compileNoteHints(d: CompileNoteInputWithEarlyStop): CompileNoteHints {
  const multi_part_nudge = isMultiPartCompile(d) && d.reduction_pct > 0 && d.omitted_sections.length > 0;
  const omit_action = d.reduction_pct > 0 && d.omitted_sections.length > 0 && d.selected_sections.length > 0;
  const named_omit = omit_action ? namedOmitSection(d) : null;
  const early_stopped = isEarlyStoppedCompile(d);
  return { multi_part_nudge, omit_action, named_omit, early_stopped };
}

/** next_section_hint points at a truncated section already shown under Included. */
export function isTruncatedSelectedHint(
  hintId: string,
  selected: Array<{ id: string; truncated?: boolean }>
): boolean {
  return selected.some((s) => s.truncated && s.id === hintId);
}

/** Hint id appears in a budget-omit card or relevance-omit chip row. */
export function hintSectionInOmitUi(
  hintId: string,
  budgetOmits?: Array<{ id: string }>,
  relevanceOmits?: Array<{ id: string }>
): boolean {
  return Boolean(budgetOmits?.some((s) => s.id === hintId) || relevanceOmits?.some((s) => s.id === hintId));
}

export interface BudgetBoundHintCopyInput {
  token_budget: number;
  next_section_hint: {
    id: string;
    section: string;
    tokens: number;
    relevance: number;
    suggested_budget: number;
  };
  selected_sections: Array<{ id: string; truncated?: boolean }>;
  budget_omitted_sections?: Array<{ id: string }>;
  relevance_omitted_sections?: Array<{ id: string }>;
}

export type BudgetBoundHintKind = "truncated_selected" | "omitted_with_chip" | "omitted_no_chip";

export function budgetBoundHintKind(d: BudgetBoundHintCopyInput): BudgetBoundHintKind {
  const hint = d.next_section_hint;
  if (isTruncatedSelectedHint(hint.id, d.selected_sections)) return "truncated_selected";
  if (hintSectionInOmitUi(hint.id, d.budget_omitted_sections, d.relevance_omitted_sections)) {
    return "omitted_with_chip";
  }
  return "omitted_no_chip";
}

/** Plain floor-note body when budget-bound with next_section_hint (app.ts adds HTML). */
export function budgetBoundHintBodyPlain(d: BudgetBoundHintCopyInput): string {
  const hint = d.next_section_hint;
  const leaf = lastCrumbLabel(hint.section);
  const budget = d.token_budget;
  const kind = budgetBoundHintKind(d);

  if (kind === "truncated_selected") {
    return (
      `"${leaf}" (${hint.relevance}% relevant) is included only in part under your ` +
      `${budget.toLocaleString()}-token ceiling. Raise the budget to about ` +
      `${hint.suggested_budget.toLocaleString()} tokens for the full section, or use ` +
      `Peek rest or Include rest in Prove on that included card below.`
    );
  }

  const base =
    `Selection stopped at your ${budget.toLocaleString()}-token ceiling. Also left out: ` +
    `"${leaf}" (${hint.relevance}% relevant, ${hint.tokens.toLocaleString()} tokens). ` +
    `Raise the budget to about ${hint.suggested_budget.toLocaleString()} tokens to keep what's selected and add it`;

  if (kind === "omitted_with_chip") {
    return base + `, or fetch it below with expand_section (${hint.id}).`;
  }
  return base + ".";
}

export function budgetBoundHintMentionsExpand(d: BudgetBoundHintCopyInput): boolean {
  return budgetBoundHintKind(d) === "omitted_with_chip";
}
