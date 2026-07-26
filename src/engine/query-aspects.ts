/**
 * Multi-part task detection and aspect splitting for compile ranking and UX.
 *
 * Heuristic (deterministic, testable):
 * 1. Hard splits: newlines, semicolons, and question-mark boundaries
 *    (Latin ?, Arabic ؟, Spanish inverted marks stripped from edges).
 * 2. Soft splits on conjunctions (and/also/y/и/और/و/…) when the join looks
 *    like two asks:
 *    - comma immediately before the conjunction ("FY25, and which…")
 *    - the right clause starts with a question word (which, qué, какой, क्या…)
 *    - both sides contain a question mark
 * 3. Comma-joined asks: "…?, …" or two clauses each with a question word.
 *
 * NOT split: noun lists ("batteries and air travel"), "terms and conditions".
 *
 * Word boundaries use a Unicode letter/mark/number lookahead — JS `\b` is
 * unreliable on Devanagari / Cyrillic / Arabic (matras and marks break it).
 */

const HARD_SPLIT_RE = /[\n;]+/;
const Q_BOUNDARY_RE = /(?<=[?؟])\s+/;
const CONJ_SPLIT_RE = /\s+(?:and|also|y|и|und|et|और)\s+|،\s*و/iu;
const COMMA_SPLIT_RE = /[,،]\s+/;

/**
 * End of a word for any script: next char is not a letter, mark, or number.
 * Prefer this over `\b`, which fails after Devanagari matras.
 */
const WORD_END = /(?![\p{L}\p{M}\p{N}])/u;

/** Question word at the start of a clause (after trim). */
const CLAUSE_Q_RE = new RegExp(
  "^(?:" +
    // English
    "what|which|who|whom|whose|where|when|why|how|can|could|would|should|" +
    "is|are|was|were|did|do|does|" +
    // Spanish
    "qué|que|quién|quien|cuál|cual|cuáles|cuales|dónde|donde|cuándo|cuando|" +
    "cómo|como|por\\s+qué|por\\s+que|" +
    // Russian
    "что|кто|какой|какая|какие|какое|где|когда|почему|как|" +
    // Hindi
    "क्या|कौन|किस|किसे|किसके|किसकी|किसका|कहाँ|कहां|क्यों|कैसे|" +
    // Arabic (longer forms first so ماذا wins over ما)
    "ماذا|لماذا|أين|اين|كيف|هل|ما|من" +
    ")" +
    WORD_END.source,
  "iu"
);

const MAX_ASPECTS = 6;
const MIN_ASPECT_LEN = 3;

function dedupeAspects(parts: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of parts) {
    const t = p
      .trim()
      .replace(/^[¿¡]+/, "")
      .trim();
    if (t.length < MIN_ASPECT_LEN) continue;
    const k = t.toLowerCase();
    if (!seen.has(k)) {
      seen.add(k);
      out.push(t);
    }
  }
  return out;
}

function hardSplit(task: string): string[] {
  const raw = task
    .split(HARD_SPLIT_RE)
    .flatMap((seg) => seg.split(Q_BOUNDARY_RE))
    .map((s) => s.trim())
    .filter((s) => s.length >= MIN_ASPECT_LEN);
  return raw.length ? raw : [task.trim()];
}

/** True when a conjunction joins two distinct asks, not a noun list. */
function shouldSplitConjunction(left: string, right: string, full: string, idx: number): boolean {
  const l = left.trim();
  const r = right
    .trim()
    .replace(/^[¿¡]+/, "")
    .trim();
  if (!l || !r) return false;
  if (CLAUSE_Q_RE.test(r)) return true;
  if (/[?؟]/.test(l) && /[?؟]/.test(r)) return true;
  // Comma-joined: "…FY25, and which…" / Hindi "…, और …"
  const before = full.slice(0, idx).trimEnd();
  if (/[,،]$/.test(before)) return true;
  return false;
}

function softSplitConjunctions(segment: string): string[] {
  const m = CONJ_SPLIT_RE.exec(segment);
  if (!m || m.index === undefined) return [segment];
  const left = segment.slice(0, m.index).replace(/[,،]\s*$/, "");
  const right = segment.slice(m.index + m[0].length);
  if (!shouldSplitConjunction(left, right, segment, m.index)) return [segment];
  return [...softSplitConjunctions(left), ...softSplitConjunctions(right)];
}

/** Comma between two question-like clauses ("net profit…, gross margin…"). */
function splitCommaJoined(segment: string): string[] {
  if (!/[,،]/.test(segment)) return [segment];
  const parts = segment
    .split(COMMA_SPLIT_RE)
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length < 2) return [segment];
  const qParts = parts.filter((p) => CLAUSE_Q_RE.test(p.replace(/^[¿¡]+/, "").trim()) || /[?؟]/.test(p));
  if (qParts.length >= 2 && qParts.length === parts.length) return parts;
  return [segment];
}

/**
 * Split a task into distinct aspects for per-aspect BM25 and round-robin pack order.
 * Returns the original task (trimmed) when nothing splits.
 */
export function splitTaskAspects(task: string): string[] {
  const trimmed = task.trim();
  if (!trimmed) return [""];
  let parts = hardSplit(trimmed);
  parts = parts.flatMap((p) => softSplitConjunctions(p));
  parts = parts.flatMap((p) => splitCommaJoined(p));
  const out = dedupeAspects(parts).slice(0, MAX_ASPECTS);
  return out.length ? out : [trimmed];
}

/** True when the task looks multi-part under the heuristic above. */
export function isMultiPartTask(task: string): boolean {
  return splitTaskAspects(task).length > 1;
}
