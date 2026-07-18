/**
 * Offline recall@budget eval — curated fixtures, no LLM, $0.
 *
 * Each case packs a document under a token budget for a task and asserts
 * that gold substrings survive in the compiled markdown. Optional fields
 * cover transparent misses (must_omit) and expand_section recovery.
 * CI treats any miss as a regression of the ranker/packer contract.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { chunkMarkdown } from "../chunk.js";
import { pack } from "../pack.js";
import {
  bm25Scores,
  multiScoresFromRows,
  perQueryScores,
  rank,
  rankMultiFromRows,
  splitQueries,
} from "../rank.js";

const HERE = dirname(fileURLToPath(import.meta.url));
// Fixtures stay under src/eval (tsc does not copy JSON/md). Resolve from repo
// root so this works when the runner is loaded from dist/eval/recall.js.
const EVAL_DIR = join(HERE, "..", "..", "src", "eval");
const FIXTURES = join(EVAL_DIR, "fixtures");

export interface RecallCase {
  id: string;
  doc: string;
  task: string;
  budget: number;
  /** Substrings that must appear in the packed markdown. */
  must_include?: string[];
  /** Substrings that must NOT appear in the packed body (intentional miss). */
  must_omit?: string[];
  /**
   * After a miss: the omitted chunk containing this needle must exist, and
   * expanding it (returning that chunk's text) must recover the needle.
   * Models the manifest → expand_section recovery path without an LLM.
   */
  expand_recover?: string;
}

export interface RecallCaseResult {
  id: string;
  ok: boolean;
  missing: string[];
  unexpected: string[];
  expand_ok: boolean | null;
  tokens_used: number;
  budget: number;
  selected: number;
}

export interface RecallReport {
  total: number;
  passed: number;
  failed: RecallCaseResult[];
  results: RecallCaseResult[];
}

export function loadRecallCases(): RecallCase[] {
  const raw = JSON.parse(readFileSync(join(EVAL_DIR, "cases.json"), "utf-8")) as RecallCase[];
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error("recall eval: cases.json must be a non-empty array");
  }
  return raw;
}

/** Pack one case the same way the BM25 (non-rerank) path does in compileContext. */
export async function runRecallCase(c: RecallCase): Promise<RecallCaseResult> {
  const markdown = readFileSync(join(FIXTURES, c.doc), "utf-8");
  const chunks = chunkMarkdown(markdown);
  const queries = splitQueries(c.task);
  const multi = queries.length > 1;

  let ranked;
  let scores: Map<string, number>;
  if (multi) {
    const rows = perQueryScores(queries, chunks);
    ranked = rankMultiFromRows(rows, chunks);
    const merged = multiScoresFromRows(rows, chunks);
    scores = new Map(chunks.map((ch, i) => [ch.id, merged[i]!]));
  } else {
    ranked = await rank(c.task, chunks, false);
    const raw = bm25Scores(c.task, chunks);
    scores = new Map(chunks.map((ch, i) => [ch.id, raw[i]!]));
  }

  const { text, selected, omitted } = pack(ranked, c.budget, c.doc, scores);
  const mustInclude = c.must_include ?? [];
  const mustOmit = c.must_omit ?? [];
  const missing = mustInclude.filter((s) => !text.includes(s));
  const unexpected = mustOmit.filter((s) => text.includes(s));

  let expandOk: boolean | null = null;
  if (c.expand_recover) {
    const needle = c.expand_recover;
    const target =
      omitted.find((ch) => ch.text.includes(needle)) ??
      ranked.find((ch) => ch.text.includes(needle));
    // Recovery contract: gold lives in an omitted (or at least findable) chunk,
    // and "expand" returns that chunk's full text containing the needle.
    expandOk = Boolean(target && target.text.includes(needle) && omitted.some((ch) => ch.id === target.id));
    if (!expandOk) missing.push(`expand_recover:${needle}`);
  }

  return {
    id: c.id,
    ok: missing.length === 0 && unexpected.length === 0 && expandOk !== false,
    missing,
    unexpected,
    expand_ok: expandOk,
    tokens_used: selected.reduce((n, ch) => n + ch.tokens, 0),
    budget: c.budget,
    selected: selected.length,
  };
}

/** Run every fixture. `minPassRate` defaults to 1.0 (all must pass). */
export async function runRecallEval(minPassRate = 1): Promise<RecallReport> {
  const cases = loadRecallCases();
  const results: RecallCaseResult[] = [];
  for (const c of cases) results.push(await runRecallCase(c));
  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok);
  const rate = cases.length ? passed / cases.length : 0;
  if (rate < minPassRate) {
    const detail = failed
      .map(
        (f) =>
          `${f.id}: missing=${JSON.stringify(f.missing)} unexpected=${JSON.stringify(f.unexpected)} expand=${f.expand_ok}`
      )
      .join("; ");
    throw new Error(
      `recall eval below floor: ${passed}/${cases.length} (need ${(minPassRate * 100).toFixed(0)}%). ${detail}`
    );
  }
  return { total: cases.length, passed, failed, results };
}
