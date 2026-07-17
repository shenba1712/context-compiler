/** Pipeline orchestrator: convert -> chunk -> rank -> pack. */
import { basename } from "node:path";

import { cacheGet, cachePut, fileKey } from "./cache.js";
import { Chunk, chunkMarkdown, outline } from "./chunk.js";
import { convertToMarkdown } from "./convert.js";
import { hasLlm } from "./llm.js";
import { assemble, pack } from "./pack.js";
import { bm25Scores, multiScores, queryAttribution, rank, rankMulti, splitQueries } from "./rank.js";
import { countTokens } from "./tokens.js";

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
  rerank_used: boolean;
  token_budget: number; // the budget actually applied (post-clamp) — UI truth
  queries: string[]; // sub-questions the task was split into (length 1 = single)
  selected_sections: SectionInfo[];
  omitted_sections: SectionInfo[];
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
  tokenBudget = 4000,
  rerank?: boolean,
  sourceName?: string
): Promise<CompileResult> {
  const useRerank = rerank ?? hasLlm();
  const { markdown, cacheHit } = await convertedMarkdown(filePath);
  const rawTokens = countTokens(markdown);
  const chunks = chunkMarkdown(markdown);
  // sourceName lets callers with renamed temp files (demo uploads) keep the
  // human-meaningful name in the artifact header.
  const name = sourceName ?? basename(filePath);

  // Split a compound task ("What voids the warranty? Can it fly in rain?")
  // into sub-questions. Multi-query handling is a lexical concern: an LLM
  // rerank already reasons over compound intent, so we only split for BM25.
  const queries = splitQueries(task);
  const multi = queries.length > 1 && !useRerank;

  // Per-chunk relevance — powers the demo's relevance percentages and the
  // packer's relevance floor. Single-query: raw BM25 (incl. heading boost).
  // Multi-query: max over per-query-normalized scores (0..1), so a section
  // that best answers any one sub-question is never floored out.
  const rawScores = multi ? multiScores(queries, chunks) : bm25Scores(task, chunks);
  const scoreMap = new Map(chunks.map((c, i) => [c.id, rawScores[i]]));
  const topScore = Math.max(0, ...rawScores);
  const rel = (c: Chunk): number | null =>
    topScore > 0 ? Math.round((100 * (scoreMap.get(c.id) ?? 0)) / topScore) : null;
  // Attribution (demo-only): every sub-question each chunk is relevant to.
  const attribution = multi ? queryAttribution(queries, chunks) : null;
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
      rerank_used: false,
      token_budget: tokenBudget,
      queries,
      selected_sections: all.map((c) => info(c, true)),
      omitted_sections: [],
    };
  }

  // Multi-query: interleave each sub-question's ranking round-robin so every
  // one is represented. Otherwise rank the task as a single query.
  const ranked = multi ? rankMulti(queries, chunks) : await rank(task, chunks, useRerank);
  // Relevance floor only without rerank: a lexical floor must not evict
  // sections the LLM rerank promoted for semantic (non-lexical) relevance.
  const { text, selected, omitted } = pack(
    ranked, tokenBudget, name, useRerank ? undefined : scoreMap
  );
  const used = countTokens(text);
  return {
    markdown: text,
    raw_tokens: rawTokens,
    tokens_used: used,
    tokens_saved: rawTokens - used,
    reduction_pct: Math.round((1000 * (rawTokens - used)) / rawTokens) / 10,
    cache_hit: cacheHit,
    rerank_used: useRerank,
    token_budget: tokenBudget,
    queries,
    selected_sections: selected.map((c) => info(c, true)),
    omitted_sections: omitted.map((c) => info(c, false)),
  };
}

export async function expandSection(
  filePath: string,
  sectionId: string,
  tokenBudget = 2000
): Promise<Record<string, unknown>> {
  const { markdown, cacheHit } = await convertedMarkdown(filePath);
  const chunks = chunkMarkdown(markdown);
  const match = chunks.find((c: Chunk) => c.id === sectionId);
  if (!match) {
    return { error: `No section with id '${sectionId}'`, outline: outline(chunks) };
  }
  let text = match.text;
  if (match.tokens > tokenBudget) {
    const ratio = tokenBudget / match.tokens;
    text =
      text.slice(0, Math.max(200, Math.floor(text.length * ratio))) +
      "\n\n<!-- truncated to budget -->";
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
