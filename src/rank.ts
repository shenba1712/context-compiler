/**
 * Chunk ranking: Okapi BM25 — deterministic, offline, and free. The file never
 * leaves the machine for ranking.
 *
 * Tokenization is Unicode-aware. Scripts that don't use spaces (CJK) emit
 * character unigrams + bigrams so BM25 can match substrings of a run that
 * would otherwise be one giant "word".
 */
import { Chunk } from "./chunk.js";
import { relevanceFloor } from "./config.js";
import { maxOf } from "./util.js";

// Prefer script-aware splits: a CJK run stays together for bigram expansion;
// other letters/numbers stay as space-delimited words (incl. Devanagari marks).
const TOKEN_RE =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+|[\p{L}\p{M}\p{N}]+/gu;
const CJK_RE = /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+$/u;
const HEADING_BOOST = 0.35;

function isCjkRun(s: string): boolean {
  return CJK_RE.test(s);
}

/** Tiny Latin stem — return/returned, refunds/refund — without a stemmer dep. */
function stemLight(t: string): string {
  // Non-ASCII → leave alone (avoid control-char regex that trips eslint).
  if ([...t].some((c) => c.charCodeAt(0) > 127) || t.length < 4) return t;
  if (t.length >= 5 && t.endsWith("ing")) return t.slice(0, -3);
  if (t.length >= 4 && t.endsWith("ed")) return t.slice(0, -2);
  if (t.length >= 4 && t.endsWith("s") && !t.endsWith("ss")) return t.slice(0, -1);
  return t;
}

/**
 * Lexical tokens for BM25. Exported for unit tests and the recall eval.
 * CJK runs → overlapping char unigrams + bigrams; Latin words get a light stem.
 */
export function tokenize(text: string): string[] {
  const parts = text.toLowerCase().match(TOKEN_RE) ?? [];
  const tokens: string[] = [];
  for (const part of parts) {
    if (isCjkRun(part)) {
      for (let i = 0; i < part.length; i++) {
        tokens.push(part[i]!);
        if (i + 1 < part.length) tokens.push(part.slice(i, i + 2));
      }
    } else {
      tokens.push(stemLight(part));
    }
  }
  return tokens;
}

/** Okapi BM25, k1=1.5, b=0.75. ~40 lines, zero deps. */
export function bm25Scores(task: string, chunks: Chunk[]): number[] {
  const k1 = 1.5;
  const b = 0.75;
  const docs = chunks.map((c) => tokenize(c.text));
  const N = docs.length;
  if (N === 0) return [];
  const avgLen = docs.reduce((s, d) => s + d.length, 0) / N || 1;

  // Document frequency per term
  const df = new Map<string, number>();
  for (const doc of docs) {
    for (const term of new Set(doc)) df.set(term, (df.get(term) ?? 0) + 1);
  }

  const query = tokenize(task);
  const scores = docs.map((doc) => {
    const tf = new Map<string, number>();
    for (const t of doc) tf.set(t, (tf.get(t) ?? 0) + 1);
    let score = 0;
    for (const q of query) {
      const f = tf.get(q) ?? 0;
      if (!f) continue;
      const n = df.get(q) ?? 0;
      const idf = Math.log((N - n + 0.5) / (n + 0.5) + 1);
      score += (idf * f * (k1 + 1)) / (f + k1 * (1 - b + (b * doc.length) / avgLen));
    }
    return score;
  });

  // Heading boost: task words in the breadcrumb are a strong signal.
  const top = maxOf(scores);
  const taskWords = new Set(query);
  chunks.forEach((c, i) => {
    if (tokenize(c.breadcrumb).some((w) => taskWords.has(w))) {
      scores[i] += top * HEADING_BOOST;
    }
  });
  return scores;
}

/**
 * Split a free-text task into distinct sub-questions.
 *
 * Users often ask several things at once ("What voids the warranty? Can it
 * fly in rain?"). Treated as one BM25 query, the term pool is dominated by
 * whichever question has the rarer keywords, and the other can get starved
 * out of a tight budget. Splitting lets us rank each question on its own and
 * guarantee every one is represented.
 *
 * Separators: newlines, semicolons, and question-mark boundaries. We do NOT
 * split on " and " — that shreds legitimate single questions ("batteries and
 * air travel"). Capped at 6 sub-queries to bound cost; if nothing splits, the
 * result is just the original task (identical to single-query behaviour).
 */
export function splitQueries(task: string): string[] {
  const raw = task
    .split(/[\n;]+/) // hard separators
    .flatMap((seg) => seg.split(/(?<=\?)\s+/)) // "a? b?" -> ["a?","b?"]
    .map((s) => s.trim())
    .filter((s) => s.length >= 3);

  const seen = new Set<string>();
  const out: string[] = [];
  for (const q of raw) {
    const k = q.toLowerCase();
    if (!seen.has(k)) {
      seen.add(k);
      out.push(q);
    }
  }
  return out.length ? out.slice(0, 6) : [task.trim()];
}

/**
 * Per-query, per-chunk relevance on a 0..1 scale: row = sub-query, column =
 * chunk, each row normalized to ITS OWN top. This is the shared basis for
 * both the merged score (max down each column) and attribution (argmax).
 */
export function perQueryScores(queries: string[], chunks: Chunk[]): number[][] {
  return queries.map((q) => {
    const s = bm25Scores(q, chunks);
    const top = maxOf(s);
    return top > 0 ? s.map((x) => x / top) : s.map(() => 0);
  });
}

/**
 * Per-chunk merged relevance (0..1): the max across per-query-normalized
 * scores. A chunk that best answers ANY one question scores ~1, so it clears
 * the relevance floor even if it's irrelevant to the others.
 *
 * The "FromRows" variant takes pre-computed `perQueryScores`; the wrapper
 * computes them. This split lets compileContext() run BM25 once and share the
 * result across the three things that need it (this score, attribution, and
 * the round-robin ranking) instead of recomputing it three times.
 */
export function multiScoresFromRows(rows: number[][], chunks: Chunk[]): number[] {
  return chunks.map((_, i) => maxOf(rows.map((r) => r[i])));
}
export function multiScores(queries: string[], chunks: Chunk[]): number[] {
  return multiScoresFromRows(perQueryScores(queries, chunks), chunks);
}

/**
 * Attribution: for each chunk, the sub-queries it is relevant to, best first.
 * A section often answers MORE than one question (e.g. a quarterly table that
 * covers both "net profit" and "gross margin"), so this returns every query
 * whose normalized score clears the relevance floor — not just the argmax.
 * Demo-only signal that makes shared-section coverage visible.
 */
export function queryAttributionFromRows(rows: number[][], chunks: Chunk[]): number[][] {
  const floor = relevanceFloor();
  return chunks.map((_, i) =>
    rows
      .map((row, qi) => ({ qi, s: row[i] }))
      .filter((x) => x.s >= floor)
      .sort((a, b) => b.s - a.s)
      .map((x) => x.qi)
  );
}
export function queryAttribution(queries: string[], chunks: Chunk[]): number[][] {
  return queryAttributionFromRows(perQueryScores(queries, chunks), chunks);
}

/**
 * Rank for multiple sub-queries by round-robin interleave: take each query's
 * #1, then each query's #2, and so on, de-duplicating. This front-loads every
 * question's best section so a greedy budget fill can't spend everything on
 * one question before reaching another.
 *
 * Sorting by the normalized `perQueryScores` gives the same order as sorting
 * by raw BM25 scores would (dividing every score in a row by that row's own
 * positive top doesn't change their order), so this can reuse the rows
 * instead of recomputing BM25 from scratch.
 */
export function rankMultiFromRows(rows: number[][], chunks: Chunk[]): Chunk[] {
  const perQuery = rows.map((row) =>
    chunks
      .map((c, i) => ({ c, s: row[i] }))
      .sort((a, b) => b.s - a.s)
      .map((x) => x.c)
  );
  const seen = new Set<string>();
  const out: Chunk[] = [];
  const maxLen = maxOf(perQuery.map((l) => l.length));
  for (let r = 0; r < maxLen; r++) {
    for (const list of perQuery) {
      const c = list[r];
      if (c && !seen.has(c.id)) {
        seen.add(c.id);
        out.push(c);
      }
    }
  }
  return out;
}
export function rankMulti(queries: string[], chunks: Chunk[]): Chunk[] {
  return rankMultiFromRows(perQueryScores(queries, chunks), chunks);
}

/** Return chunks in descending BM25 relevance order. */
export function rank(task: string, chunks: Chunk[]): Chunk[] {
  const scores = bm25Scores(task, chunks);
  return chunks
    .map((c, i) => ({ c, s: scores[i]! }))
    .sort((a, b) => b.s - a.s)
    .map((x) => x.c);
}
