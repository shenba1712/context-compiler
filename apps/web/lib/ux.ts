/** Mirrors of src/http/client-ux.ts used by the Next workspace (keep in sync). */

export function applyProveIncludeChange(
  state: { expandedIds: Set<string>; expandedTokens: Map<string, number> },
  id: string,
  tokens: number,
  included: boolean
): { expandedIds: Set<string>; expandedTokens: Map<string, number> } {
  const expandedIds = new Set(state.expandedIds);
  const expandedTokens = new Map(state.expandedTokens);
  if (included) {
    expandedIds.add(id);
    expandedTokens.set(id, tokens);
  } else {
    expandedIds.delete(id);
    expandedTokens.delete(id);
  }
  return { expandedIds, expandedTokens };
}

export function includeRestHint(remainderTokens: number, sectionLeaf?: string): string {
  if (remainderTokens <= 0) return "";
  if (sectionLeaf) {
    return `Include the rest of ${sectionLeaf} (~${remainderTokens.toLocaleString()} tokens)`;
  }
  return `+${remainderTokens.toLocaleString()} content tokens in Prove`;
}

export function truncatedSectionMeta(
  packedTokens: number,
  fullTokens: number,
  remainderTokens: number,
  relevance?: number | null
): string {
  const rel = relevance != null ? `relevance ${relevance}% · ` : "";
  const rest =
    remainderTokens > 0
      ? ` · +${remainderTokens.toLocaleString()} tokens still unread in this section`
      : "";
  return `${rel}${packedTokens.toLocaleString()} content tokens (truncated from ${fullTokens.toLocaleString()}${rest})`;
}

export type BudgetPresets = { quick: number; standard: number; deep: number };

export const DEFAULT_PRESETS: BudgetPresets = { quick: 1000, standard: 4000, deep: 8000 };
export const SLIDER_MIN = 100;
export const SLIDER_MAX = 20_000;

export function computePresets(rawTokens: number | null): BudgetPresets {
  if (!rawTokens || rawTokens >= DEFAULT_PRESETS.deep) return DEFAULT_PRESETS;
  const round50 = (n: number) => Math.round(n / 50) * 50;
  const clamp = (n: number) => Math.min(SLIDER_MAX, Math.max(SLIDER_MIN, round50(n)));
  const deep = clamp(Math.max(rawTokens, SLIDER_MIN));
  const standard = clamp(Math.min(deep, Math.max(SLIDER_MIN * 2, rawTokens * 0.5)));
  const quick = clamp(Math.min(standard - 50, Math.max(SLIDER_MIN, rawTokens * 0.2)));
  return {
    quick: Math.min(quick, standard),
    standard: Math.min(standard, deep),
    deep,
  };
}

export function sectionLeaf(section: string): string {
  const parts = section.split(/\s*[>›/]\s*/);
  return (parts[parts.length - 1] || section).trim();
}
