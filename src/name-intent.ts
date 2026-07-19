/**
 * Name-intent retrieval: queries asking for a person's first/given name
 * (e.g. "What is Ms. Bingley's first name?") often BM25-rank honorific-only
 * passages ("Miss Bingley") above signature-style "CAROLINE BINGLEY" spans.
 * Boost given-name + surname hits and reorder split-heading siblings so pack
 * sees the answer-bearing half of a chapter.
 */
import { Chunk } from "./chunk.js";
import { maxOf } from "./util.js";

export interface NameIntent {
  surname: string;
}

const HONORIFIC = "(?:Mr|Mrs|Ms|Miss|Dr|Sir|Lady|Lord|Dame|Rev|Capt|Col)\\.?";
const HONORIFIC_WORDS = new Set([
  "mr",
  "mrs",
  "ms",
  "miss",
  "dr",
  "sir",
  "lady",
  "lord",
  "dame",
  "rev",
  "capt",
  "col",
]);

/** Title-case words that precede a surname but are not given names. */
const NOT_GIVEN_NAME_WORDS = new Set([
  ...HONORIFIC_WORDS,
  "the",
  "a",
  "an",
  "young",
  "elder",
  "older",
  "old",
  "little",
  "dear",
  "poor",
  "good",
  "late",
  "new",
]);

/** True when the task asks for someone's first or given name. */
export function detectNameIntent(task: string): NameIntent | null {
  const t = task.trim();
  if (!/\b(?:first|given)\s+name\b/i.test(t)) return null;

  const poss = new RegExp(`\\b${HONORIFIC}\\s+([A-Za-z][A-Za-z'-]{1,38})['']s\\b`, "i").exec(t);
  if (poss) return { surname: poss[1]!.toLowerCase() };

  const plain = new RegExp(`\\b${HONORIFIC}\\s+([A-Za-z][A-Za-z'-]{1,38})\\b`, "i").exec(t);
  if (plain) return { surname: plain[1]!.toLowerCase() };
  return null;
}

/** True when `text` contains a likely given-name span for `surname`, not honorific-only. */
export function chunkHasGivenNameSpan(text: string, surname: string): boolean {
  const sur = surname.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  // Signature / emphasis style: CAROLINE BINGLEY
  if (new RegExp(`\\b[A-Z]{2,30}\\s+${sur.toUpperCase()}\\b`).test(text)) return true;

  // Title Case: Caroline Bingley — reject honorific + surname only
  const titleRe = new RegExp(
    `\\b([A-Z][a-z]{1,30})\\s+${surname.charAt(0).toUpperCase()}${surname.slice(1)}\\b`,
    "g"
  );
  let m: RegExpExecArray | null;
  while ((m = titleRe.exec(text))) {
    if (!NOT_GIVEN_NAME_WORDS.has(m[1]!.toLowerCase())) return true;
  }
  return false;
}

/** Question-shaped tasks where a split heading's next sibling may hold the answer. */
export function isAnswerShapedQuery(task: string): boolean {
  if (detectNameIntent(task)) return true;
  return /^\s*(?:what|who|whose|which|when|where|how)\b/im.test(task.trim());
}

/** Fraction of the top BM25 score added to given-name + surname chunks. */
export const NAME_INTENT_BOOST_RATIO = 0.6;

/** Boost chunks that contain surname + given name for name-intent queries. */
export function applyNameIntentBoost(task: string, chunks: Chunk[], scores: number[]): number[] {
  const intent = detectNameIntent(task);
  if (!intent) return scores;
  const top = maxOf(scores);
  if (top <= 0) return scores;
  const boost = top * NAME_INTENT_BOOST_RATIO;
  return scores.map((s, i) => (chunkHasGivenNameSpan(chunks[i]!.text, intent.surname) ? s + boost : s));
}

function dedupeRanked(ranked: Chunk[]): Chunk[] {
  const seen = new Set<string>();
  const out: Chunk[] = [];
  for (const c of ranked) {
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    out.push(c);
  }
  return out;
}

/**
 * For split headings: when a high-ranked chunk lacks the given-name answer but
 * its document-order successor under the same breadcrumb has it, promote the
 * successor ahead of the predecessor in pack order.
 */
export function prepareRankedForPack(
  ranked: Chunk[],
  allChunks: Chunk[],
  task: string,
  scoreMap?: Map<string, number>
): Chunk[] {
  if (!isAnswerShapedQuery(task)) return ranked;

  const intent = detectNameIntent(task);
  const byOrder = new Map(allChunks.map((c) => [c.order, c]));
  const out = [...ranked];
  const indexOf = (id: string) => out.findIndex((c) => c.id === id);

  for (const chunk of ranked.slice(0, 20)) {
    const next = byOrder.get(chunk.order + 1);
    if (!next || next.breadcrumb !== chunk.breadcrumb) continue;

    const nextHas = intent ? chunkHasGivenNameSpan(next.text, intent.surname) : false;
    const curHas = intent ? chunkHasGivenNameSpan(chunk.text, intent.surname) : false;
    if (intent && (!nextHas || curHas)) continue;

    // Non-name answer-shaped: still surface the next sibling when the pair is split.
    if (!intent && indexOf(next.id) >= 0) continue;

    const ci = indexOf(chunk.id);
    if (ci < 0) continue;
    const ni = indexOf(next.id);
    if (ni < 0) {
      out.splice(ci, 0, next);
      if (scoreMap && intent && nextHas) {
        const top = maxOf([...scoreMap.values()]);
        scoreMap.set(next.id, Math.max(scoreMap.get(next.id) ?? 0, top * 0.85));
      }
      continue;
    }
    if (ni > ci) {
      out.splice(ni, 1);
      out.splice(ci, 0, next);
    }
  }

  return dedupeRanked(out);
}
