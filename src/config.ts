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
//  - the web demo has a slider that goes down to 200, so its floor (100)
//    just needs to stay at or below that — it should never be the thing
//    that overrides what the slider says.
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
 * as relevant — used both to stop packing early and to decide which
 * sub-questions a chunk "answers" in multi-question attribution. This is a
 * RATIO, not a fixed score, so it only kicks in once the ranker actually
 * found something clearly better than the rest; a vague query where every
 * chunk scores about the same won't trigger it.
 */
export function relevanceFloor(): number {
  return numEnv("CC_RELEVANCE_FLOOR", 0.15, 0, 1);
}

// Kept in one place so raising it can't accidentally lift the file-picker's
// limit but not the actual upload limit (or vice versa) — see web.ts and
// convert.ts, which both read this.
export const MAX_FILE_BYTES = intEnv("CC_MAX_FILE_BYTES", 20 * 1024 * 1024, 1);
