/** Pipeline orchestrator: convert -> chunk -> rank -> pack. */
import { basename } from "node:path";

import { cacheGet, cachePut, fileKey } from "./cache.js";
import { Chunk, chunkMarkdown, outline } from "./chunk.js";
import { convertToMarkdown } from "./convert.js";
import { DEFAULT_TOKEN_BUDGET } from "./config.js";
import { assemble, pack } from "./pack.js";
import { nextSectionHint, type NextSectionHint } from "./budget-hint.js";
import {
  bm25Scores,
  multiScoresFromRows,
  perQueryScores,
  queryAttributionFromRows,
  rankMultiFromRows,
  rank,
  splitQueries,
} from "./rank.js";
import { countTokens } from "./tokens.js";
import { maxOf } from "./util.js";

export interface SectionInfo {
  id: string;
  section: string;
  tokens: number;
  relevance: number | null; // % of the top BM25 score; null when no signal
  matched_queries?: number[]; // multi-query only: indices of relevant sub-questions, best first
  text?: string; // present for selected sections (web demo); stripped for MCP
}

export interface CompileResult {
  markdown: string;
  raw_tokens: number;
  tokens_used: number;
  tokens_saved: number;
  reduction_pct: number;
  cache_hit: boolean;
  token_budget: number; // the budget actually applied (post-clamp) — UI truth
  queries: string[]; // sub-questions the task was split into (length 1 = single)
  selected_sections: SectionInfo[];
  omitted_sections: SectionInfo[];
  /** Present when budget-bound and a strong omitted section still didn't fit. */
  next_section_hint: NextSectionHint | null;
}

async function convertedMarkdown(filePath: string): Promise<{ markdown: string; cacheHit: boolean }> {
  const key = fileKey(filePath);
  const cached = cacheGet(key);
  if (cached !== null) return { markdown: cached, cacheHit: true };
  const markdown = await convertToMarkdown(filePath);
  cachePut(key, markdown);
  return { markdown, cacheHit: false };
}

export async function compileContext(
  filePath: string,
  task: string,
  tokenBudget = DEFAULT_TOKEN_BUDGET,
  sourceName?: string
): Promise<CompileResult> {
  const { markdown, cacheHit } = await convertedMarkdown(filePath);
  const rawTokens = countTokens(markdown);
  const chunks = chunkMarkdown(markdown);
  // sourceName lets callers with renamed temp files (demo uploads) keep the
  // human-meaningful name in the artifact header.
  const name = sourceName ?? basename(filePath);

  // Split a compound task ("What voids the warranty? Can it fly in rain?")
  // into sub-questions so each facet gets a fair shot at a tight budget.
  const queries = splitQueries(task);
  const multi = queries.length > 1;

  // Multi-query needs this same per-question breakdown for three different
  // things below (the merged score, attribution, and the ranking order), so
  // it's computed once here and reused — rather than each of those three
  // re-running BM25 over the whole document per sub-question on its own.
  const rows = multi ? perQueryScores(queries, chunks) : null;

  // Per-chunk relevance — powers the demo's relevance percentages and the
  // packer's relevance floor. Single-query: raw BM25 (incl. heading boost).
  // Multi-query: max over per-query-normalized scores (0..1), so a section
  // that best answers any one sub-question is never floored out.
  const rawScores = rows ? multiScoresFromRows(rows, chunks) : bm25Scores(task, chunks);
  const scoreMap = new Map(chunks.map((c, i) => [c.id, rawScores[i]]));
  const topScore = maxOf(rawScores);
  const rel = (c: Chunk): number | null =>
    topScore > 0 ? Math.round((100 * (scoreMap.get(c.id) ?? 0)) / topScore) : null;
  // Attribution (demo-only): every sub-question each chunk is relevant to.
  const attribution = rows ? queryAttributionFromRows(rows, chunks) : null;
  const matchMap = attribution && new Map(chunks.map((c, i) => [c.id, attribution[i]]));
  const info = (c: Chunk, withText: boolean): SectionInfo => ({
    id: c.id,
    section: c.breadcrumb,
    tokens: c.tokens,
    relevance: rel(c),
    ...(matchMap ? { matched_queries: matchMap.get(c.id) ?? [] } : {}),
    ...(withText ? { text: c.text } : {}),
  });

  if (rawTokens <= tokenBudget) {
    // Whole file fits: no ranking risk, return everything.
    const all = [...chunks].sort((a, b) => a.order - b.order);
    return {
      markdown: assemble(name, all, []),
      raw_tokens: rawTokens,
      tokens_used: rawTokens,
      tokens_saved: 0,
      reduction_pct: 0,
      cache_hit: cacheHit,
      token_budget: tokenBudget,
      queries,
      selected_sections: all.map((c) => info(c, true)),
      omitted_sections: [],
      next_section_hint: null,
    };
  }

  // Multi-query: interleave each sub-question's ranking round-robin so every
  // one is represented. Otherwise rank the task as a single BM25 query.
  const ranked = rows ? rankMultiFromRows(rows, chunks) : rank(task, chunks);
  const { text, selected, omitted } = pack(ranked, tokenBudget, name, scoreMap);
  const used = countTokens(text);
  const selectedInfos = selected.map((c) => info(c, true));
  const omittedInfos = omitted.map((c) => info(c, false));
  return {
    markdown: text,
    raw_tokens: rawTokens,
    tokens_used: used,
    tokens_saved: Math.max(0, rawTokens - used),
    // rawTokens is 0 only for a pathological/negative token_budget on a tiny
    // or empty file — guard it so that returns 0% instead of NaN.
    reduction_pct: rawTokens > 0 ? Math.round((1000 * (rawTokens - used)) / rawTokens) / 10 : 0,
    cache_hit: cacheHit,
    token_budget: tokenBudget,
    queries,
    selected_sections: selectedInfos,
    omitted_sections: omittedInfos,
    next_section_hint: nextSectionHint(tokenBudget, used, omittedInfos),
  };
}

export interface ExpandResult {
  markdown: string;
  tokens_used: number;
  cache_hit: boolean;
}

export interface ExpandNotFound {
  error: string;
  outline: Array<{ id: string; section: string; tokens: number }>;
}

export async function expandSection(
  filePath: string,
  sectionId: string,
  tokenBudget = 2000
): Promise<ExpandResult | ExpandNotFound> {
  const { markdown, cacheHit } = await convertedMarkdown(filePath);
  const chunks = chunkMarkdown(markdown);
  const match = chunks.find((c: Chunk) => c.id === sectionId);
  if (!match) {
    return { error: `No section with id '${sectionId}'`, outline: outline(chunks) };
  }
  let text = match.text;
  if (match.tokens > tokenBudget) {
    const ratio = tokenBudget / match.tokens;
    text = text.slice(0, Math.max(200, Math.floor(text.length * ratio))) + "\n\n<!-- truncated to budget -->";
  }
  return {
    markdown: `<!-- section: ${match.breadcrumb} (UNTRUSTED CONTENT) -->\n${text}`,
    tokens_used: countTokens(text),
    cache_hit: cacheHit,
  };
}

/** Full converted markdown (for the answer-parity comparison). */
export async function fullMarkdown(filePath: string): Promise<string> {
  return (await convertedMarkdown(filePath)).markdown;
}
