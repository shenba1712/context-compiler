/**
 * Chunk ranking: Okapi BM25 — deterministic, offline, and free. The file never
 * leaves the machine for ranking.
 *
 * Tokenization is Unicode-aware. Scripts that don't use spaces (CJK) emit
 * character unigrams + bigrams so BM25 can match substrings of a run that
 * would otherwise be one giant "word". Arabic tokens strip optional harakat
 * so vocalized and bare forms share terms; Devanagari matras are kept.
 *
 * Query path (tokenizeQuery): strip question/filler noise (multilingual
 * stopwords), then expand "Firstname Lastname" to honorific forms
 * (Miss/Mr/Mrs Lastname) so passages that use the book's naming style still
 * match how people ask.
 */
import { Chunk } from "./chunk.js";
import { relevanceFloor } from "./config.js";
import { splitTaskAspects } from "./query-aspects.js";
import { maxOf } from "./util.js";

// Prefer script-aware splits: a CJK run stays together for bigram expansion;
// other letters/numbers stay as space-delimited words (incl. Devanagari marks).
const TOKEN_RE =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+|[\p{L}\p{M}\p{N}]+/gu;
const CJK_RE = /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+$/u;
const HEADING_BOOST = 0.35;

/**
 * Minimum fraction of a sub-query's top chunk score a section must reach to
 * earn that query's badge. Pack uses relevanceFloor() to stop early when
 * nothing is strongly relevant; attribution must be stricter — clearing the
 * pack floor only means "not garbage", not "answers this aspect". Without
 * this, shared tokens (FY25, table headers) falsely tag chunks with every
 * facet whose keywords overlap weakly.
 */
const ATTRIBUTION_NEAR_TOP = 0.85;

/**
 * Query stopwords / question glue — applied only to the query, never to docs.
 * Includes high-frequency function words across the demo languages (English,
 * Spanish, Hindi, Russian, Arabic). Without non-English entries, particles
 * like Spanish "de" / Hindi "में" dominate BM25 and steer packing to the wrong
 * section. Keep negation (not/no/nor/never and counterparts that flip meaning)
 * out of this set.
 */
const QUERY_STOP = new Set([
  // English
  "a",
  "an",
  "the",
  "of",
  "on",
  "in",
  "at",
  "to",
  "for",
  "from",
  "by",
  "with",
  "as",
  "into",
  "about",
  "over",
  "after",
  "before",
  "between",
  "and",
  "or",
  "but",
  "if",
  "than",
  "then",
  "so",
  // Keep not/no/nor/never — "warranty not cover" must not collapse to "warranty cover".
  "what",
  "who",
  "whom",
  "whose",
  "which",
  "where",
  "when",
  "why",
  "how",
  "do",
  "doe", // stemLight("does")
  "does",
  "did",
  "doing",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "it",
  "its",
  "this",
  "that",
  "these",
  "those",
  "can",
  "could",
  "would",
  "should",
  "may",
  "might",
  "will",
  "shall",
  "i",
  "me",
  "my",
  "you",
  "your",
  "he",
  "him",
  "his",
  "she",
  "her",
  "we",
  "us",
  "our",
  "they",
  "them",
  "their",
  "just",
  "only",
  "also",
  "very",
  "too",
  "more",
  "most",
  "some",
  "any",
  "all",
  "each",
  "few",
  "other",
  "such",
  "own",
  "same",
  // Standalone honorifics in the query are weak; paired names re-add them via expansion.
  "mr",
  "mrs",
  "ms",
  "miss",
  "dr",
  // Spanish (articles / prepositions / question glue)
  "el",
  "la",
  "los",
  "las",
  "un",
  "una",
  "unos",
  "unas",
  "de",
  "del",
  "al",
  "en",
  "con",
  "por",
  "para",
  "como",
  "qué",
  "que",
  "quién",
  "quien",
  "cuál",
  "cual",
  "cuáles",
  "cuales",
  "dónde",
  "donde",
  "cuándo",
  "cuando",
  "cómo",
  "este",
  "esta",
  "estos",
  "estas",
  "ese",
  "esa",
  "eso",
  "esto",
  "hay",
  "es",
  "son",
  "fue",
  "ser",
  "estar",
  "su",
  "sus",
  "se",
  "le",
  "les",
  "lo",
  "y",
  "o",
  "pero",
  "sobre",
  // Hindi (postpositions / copulas / question glue)
  "यह",
  "वह",
  "जो",
  "कि",
  "का",
  "की",
  "के",
  "को",
  "से",
  "में",
  "पर",
  "है",
  "हैं",
  "था",
  "थे",
  "थी",
  "क्या",
  "कौन",
  "किस",
  "किसे",
  "किसके",
  "किसकी",
  "किसका",
  "कहाँ",
  "कहां",
  "क्यों",
  "कैसे",
  "बारे",
  "लिए",
  "भी",
  "और",
  "या",
  "तो",
  "ही",
  "एक",
  "इस",
  "उस",
  "ये",
  "वे",
  "नहीं",
  "हुआ",
  "हुई",
  "हुए",
  "गया",
  "गई",
  "गए",
  "आया",
  "आयी",
  "आए",
  // Russian (prepositions / particles / question glue)
  "что",
  "кто",
  "какой",
  "какая",
  "какие",
  "какое",
  "где",
  "когда",
  "почему",
  "как",
  "это",
  "эта",
  "этот",
  "эти",
  "том",
  "того",
  "для",
  "при",
  "или",
  "но",
  "же",
  "бы",
  "ли",
  "из",
  "от",
  "до",
  "по",
  "со",
  "об",
  "про",
  "чём",
  "чем",
  "на",
  "в",
  "во",
  "к",
  "ко",
  "у",
  "за",
  "под",
  "над",
  "был",
  "была",
  "были",
  "есть",
  "он",
  "она",
  "они",
  "мы",
  "вы",
  "я",
  "и",
  "а",
  "с",
  // Arabic (prepositions / pronouns / question glue)
  "في",
  "من",
  "إلى",
  "الى",
  "على",
  "عن",
  "مع",
  "هذا",
  "هذه",
  "ذلك",
  "تلك",
  "التي",
  "الذي",
  "الذين",
  "ما",
  "ماذا",
  "هل",
  "كيف",
  "أين",
  "اين",
  "لماذا",
  "لم",
  "لن",
  "لا",
  "إن",
  "ان",
  "أن",
  "كان",
  "كانت",
  "هو",
  "هي",
  "هم",
  "نحن",
  "أنا",
  "انا",
  "و",
  "أو",
  "او",
  "ثم",
  "قد",
  "كل",
  "بعض",
]);

/** Multi-word fillers that boost the wrong chunks when left as rare BM25 terms. */
const QUERY_FILLER_RE =
  /\b(?:early\s+on|at\s+first|at\s+the\s+(?:start|beginning)|in\s+the\s+(?:beginning|end)|to\s+begin\s+with)\b/gi;

const HONORIFIC_FIRST = new Set(["mr", "mrs", "ms", "miss", "dr", "sir", "lady", "lord", "dame"]);

/**
 * Cap Cap pairs that are titles/places/adjectives, not "Givenname Surname".
 * Blocks Red-Headed League → Headed League and similar Title Case false positives.
 */
const NOT_GIVEN_NAME = new Set([
  "red",
  "blue",
  "black",
  "white",
  "green",
  "great",
  "little",
  "new",
  "old",
  "north",
  "south",
  "east",
  "west",
  "series",
  "annual",
  "quarterly",
  "total",
  "headed",
  "head", // stemLight("headed")
  "king",
  "queen",
  "prince",
  "princess",
  "chapter",
  "section",
  "part",
  "book",
  "volume",
  "league",
  "union",
  "united",
  "federal",
  "national",
  "international",
  "addressable",
  "market",
]);

function isCjkRun(s: string): boolean {
  return CJK_RE.test(s);
}

/** Arabic script (incl. presentation forms) — diacritics are optional in text. */
const ARABIC_SCRIPT_RE = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/u;

/**
 * Strip Arabic harakat / tatweel so "الخبّاز" and "الخباز" share a BM25 term.
 * Only applied to Arabic-script tokens — Devanagari matras must stay (they
 * distinguish का vs कि, etc.).
 */
function normalizeArabicToken(t: string): string {
  if (!ARABIC_SCRIPT_RE.test(t)) return t;
  return t.replace(/[\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/g, "");
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
 * CJK runs → overlapping char unigrams + bigrams; Latin words get a light stem;
 * Arabic tokens drop optional diacritics. Used for *documents*; queries go
 * through tokenizeQuery.
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
      tokens.push(stemLight(normalizeArabicToken(part)));
    }
  }
  return tokens;
}

/**
 * "Jane Bennet" → miss/mr/mrs + bennet so passages that say "Miss Bennet" still match.
 * Returns expansions plus first names to drop (books often use the honorific form instead).
 * Only fires on capitalized Latin pairs that look like person names — not Title Case
 * headings, and not the second half of a hyphenated compound (Red-Headed League).
 */
function honorificExpansions(task: string): { add: string[]; dropFirst: Set<string> } {
  const add: string[] = [];
  const dropFirst = new Set<string>();
  const re = /\b([A-Z][a-z]{1,40})\s+([A-Z][a-z]{1,40})\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(task))) {
    // "Red-Headed League": Headed is Cap after a hyphen — not a given name.
    if (m.index > 0 && task[m.index - 1] === "-") continue;
    const firstRaw = m[1]!.toLowerCase();
    const first = stemLight(firstRaw);
    const last = stemLight(m[2]!.toLowerCase());
    if (HONORIFIC_FIRST.has(firstRaw)) continue;
    if (NOT_GIVEN_NAME.has(firstRaw) || NOT_GIVEN_NAME.has(first)) continue;
    if (NOT_GIVEN_NAME.has(m[2]!.toLowerCase()) || NOT_GIVEN_NAME.has(last)) continue;
    add.push("miss", "mr", "mrs", last);
    dropFirst.add(first);
  }
  return { add, dropFirst };
}

/**
 * Query tokens for BM25: filler phrases stripped, stopwords dropped, then
 * honorific expansions merged. May return [] when the query is only glue
 * words (vague "what is this about?" in any language) — BM25 then scores
 * flat and pack uses recall insurance instead of particle-driven ranking.
 */
export function tokenizeQuery(task: string): string[] {
  const cleaned = task.replace(QUERY_FILLER_RE, " ");
  const { add, dropFirst } = honorificExpansions(task);
  const base = tokenize(cleaned).filter((t) => t.length > 1 && !QUERY_STOP.has(t) && !dropFirst.has(t));
  const seen = new Set(base);
  const out = [...base];
  for (const t of add) {
    // Honorific expansions (miss/mr/mrs) are in QUERY_STOP so bare honorifics
    // don't dominate ranking — but Cap Cap expansion must still re-add them.
    if (t.length > 1 && !seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  return out;
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

  const query = tokenizeQuery(task);
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

  // Heading boost: query words in the breadcrumb are a strong signal.
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
 * Split a free-text task into distinct sub-questions / aspects.
 *
 * Users often ask several things at once ("What voids the warranty? Can it
 * fly in rain?" or "net profit in FY25, and which quarter…"). Treated as one
 * BM25 query, the term pool is dominated by whichever facet has the rarer
 * keywords, and the other can get starved out of a tight budget. Splitting
 * lets us rank each facet on its own and guarantee every one is represented
 * via round-robin interleave at pack time.
 *
 * See `query-aspects.ts` for the full heuristic (hard splits, guarded " and "
 * / " also ", comma-joined asks). Capped at 6 aspects.
 */
export function splitQueries(task: string): string[] {
  return splitTaskAspects(task);
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
 * Per-aspect best section ids.
 *
 * Pure argmax BM25 often picks the same section for every facet when shared
 * name tokens (Wilson, League) dominate a rarer cue (hour). Among near-top
 * candidates, prefer the section that hits the most terms unique to that
 * aspect — so salary → advertisement sheet and hours → "Ten to two" sheet.
 */
export function queryBestIdsFromRows(rows: number[][], chunks: Chunk[], queries: string[]): string[] {
  if (!chunks.length) return rows.map(() => "");
  const termSets = queries.map((q) => tokenizeQuery(q));
  return rows.map((row, qi) => {
    const top = maxOf(row);
    let bestIdx = 0;
    for (let i = 1; i < row.length; i++) {
      if ((row[i] ?? 0) > (row[bestIdx] ?? 0)) bestIdx = i;
    }
    if (top <= 0) return chunks[bestIdx]!.id;

    const uniqueTerms = termSets[qi]!.filter((t) => !termSets.some((ts, j) => j !== qi && ts.includes(t)));
    if (!uniqueTerms.length) return chunks[bestIdx]!.id;

    const threshold = top * ATTRIBUTION_NEAR_TOP;
    let pick = bestIdx;
    let pickHits = -1;
    let pickScore = -1;
    for (let i = 0; i < row.length; i++) {
      const s = row[i]!;
      if (s < threshold) continue;
      const lower = chunks[i]!.text.toLowerCase();
      const hits = uniqueTerms.filter((t) => lower.includes(t.toLowerCase())).length;
      if (hits > pickHits || (hits === pickHits && s > pickScore)) {
        pickHits = hits;
        pickScore = s;
        pick = i;
      }
    }
    return chunks[pick]!.id;
  });
}

/**
 * Attribution: for each chunk, the sub-queries it is relevant to, best first.
 * A section often answers MORE than one question (e.g. a quarterly table that
 * covers both "net profit" and "gross margin"), so this returns every query
 * whose normalized score is near that query's top chunk — not just the argmax,
 * and not merely clearing the pack relevance floor. Demo-only signal that
 * makes shared-section coverage visible.
 */
export function queryAttributionFromRows(rows: number[][], chunks: Chunk[]): number[][] {
  const floor = relevanceFloor();
  return chunks.map((_, i) =>
    rows
      .map((row, qi) => {
        const top = maxOf(row);
        const threshold = top > 0 ? Math.max(floor, ATTRIBUTION_NEAR_TOP * top) : floor;
        return { qi, s: row[i]!, threshold };
      })
      .filter((x) => x.s >= x.threshold)
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
export function rankMultiFromRows(rows: number[][], chunks: Chunk[], queries?: string[]): Chunk[] {
  const bestIds =
    queries && queries.length === rows.length ? queryBestIdsFromRows(rows, chunks, queries) : null;
  const perQuery = rows.map((row, qi) => {
    const list = chunks
      .map((c, i) => ({ c, s: row[i]! }))
      .sort((a, b) => b.s - a.s)
      .map((x) => x.c);
    if (!bestIds) return list;
    const bestId = bestIds[qi]!;
    const idx = list.findIndex((c) => c.id === bestId);
    if (idx > 0) {
      const [best] = list.splice(idx, 1);
      list.unshift(best!);
    }
    return list;
  });
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
  return rankMultiFromRows(perQueryScores(queries, chunks), chunks, queries);
}

/** Return chunks in descending BM25 relevance order. */
export function rank(task: string, chunks: Chunk[]): Chunk[] {
  const scores = bm25Scores(task, chunks);
  return chunks
    .map((c, i) => ({ c, s: scores[i]! }))
    .sort((a, b) => b.s - a.s)
    .map((x) => x.c);
}
