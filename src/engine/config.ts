/**
 * One home for the project's shared numbers — token budget limits, the
 * relevance floor, and the upload size cap. Defining each once here keeps every
 * file that uses it in agreement, instead of parsing the same env var in a few
 * places and risking them drifting apart.
 */
import { intEnv, numEnv } from "./env.js";

export const DEFAULT_TOKEN_BUDGET = 4000;
export const MAX_TOKEN_BUDGET = 200_000;

// Different callers deliberately use different floors:
//  - the web demo slider mins at 100 (same as BUDGET_FLOORS.web); presets clamp
//    to that range so quick/standard/deep stay on the slider.
//  - the MCP tools have no slider to defer to, so their floors are chosen to
//    keep results useful: 500 for a full compile, 200 for pulling one
//    already-identified section (which is naturally smaller).
export const BUDGET_FLOORS = { web: 100, mcpCompile: 500, mcpExpand: 200 } as const;

/** Clamp a requested token budget into a safe range for the given floor. */
export function clampBudget(v: unknown, floor: number, ceiling = MAX_TOKEN_BUDGET): number {
  const n = Number(v);
  const safe = Number.isFinite(n) ? n : DEFAULT_TOKEN_BUDGET;
  return Math.max(floor, Math.min(Math.trunc(safe), ceiling));
}

/**
 * How much a chunk's score can trail the best chunk's score and still count
 * as relevant for early pack termination. Attribution uses a stricter
 * near-top rule (see rank.ts ATTRIBUTION_NEAR_TOP). This is a RATIO, not a
 * fixed score, so it only kicks in once the ranker actually found something
 * clearly better than the rest; a vague query where every chunk scores about
 * the same won't trigger it.
 */
export function relevanceFloor(): number {
  return numEnv("CC_RELEVANCE_FLOOR", 0.4, 0, 1);
}

/**
 * Legacy env knob — NOT read by pack/pipeline anymore.
 * Coverage-first packing stops on facet/term/name coverage (and limited recall
 * insurance), not on this ratio. Kept so old deployments setting
 * `CC_EARLY_STOP_RATIO` do not crash on import; changing it has no effect.
 */
export function earlyStopRatio(): number {
  return numEnv("CC_EARLY_STOP_RATIO", 0.5, 0, 1);
}

/**
 * Legacy env knob — NOT read by pack/pipeline anymore.
 * Saturation-style early stop was replaced by coverage-complete + cluster
 * recall insurance. `CC_SATURATION_STOP_RATIO` is ignored; see `clusterRatio()`.
 */
export function saturationStopRatio(): number {
  return numEnv("CC_SATURATION_STOP_RATIO", 0.88, 0, 1);
}

/**
 * Top-score cluster for pack early stop: once every candidate scoring at least
 * this fraction of the top has been considered and at least one is selected,
 * skip lower tiers unless mustInclude, uncovered facets, or narrow in-cluster
 * truncation/sibling needs still apply.
 */
export function clusterRatio(): number {
  return numEnv("CC_CLUSTER_RATIO", 0.98, 0, 1);
}

/** Spare budget fraction (vs ceiling) above which the UI shows early-stop copy. */
export function earlyStopSpareThreshold(): number {
  return numEnv("CC_EARLY_STOP_SPARE_THRESHOLD", 0.22, 0, 1);
}

// Kept in one place so raising it can't accidentally lift the file-picker's
// limit but not the actual upload limit (or vice versa) — see web.ts and
// convert.ts, which both read this.
export const MAX_FILE_BYTES = intEnv("CC_MAX_FILE_BYTES", 20 * 1024 * 1024, 1);
