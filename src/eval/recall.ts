/**
 * Offline recall@budget eval — curated fixtures, no LLM, $0.
 *
 * Each case packs a document under a token budget for a task and asserts
 * that gold substrings survive in the compiled markdown. CI treats any
 * miss as a regression of the ranker/packer contract.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { chunkMarkdown } from "../chunk.js";
import { pack } from "../pack.js";
import { bm25Scores, rank, splitQueries, multiScoresFromRows, perQueryScores, rankMultiFromRows } from "../rank.js";

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
  must_include: string[];
}

export interface RecallCaseResult {
  id: string;
  ok: boolean;
  missing: string[];
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

  const { text, selected } = pack(ranked, c.budget, c.doc, scores);
  const missing = c.must_include.filter((s) => !text.includes(s));
  return {
    id: c.id,
    ok: missing.length === 0,
    missing,
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
    const detail = failed.map((f) => `${f.id}: missing ${JSON.stringify(f.missing)}`).join("; ");
    throw new Error(
      `recall eval below floor: ${passed}/${cases.length} (need ${(minPassRate * 100).toFixed(0)}%). ${detail}`
    );
  }
  return { total: cases.length, passed, failed, results };
}
