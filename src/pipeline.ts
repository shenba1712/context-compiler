/** Pipeline orchestrator: convert -> chunk -> rank -> pack. */
import { basename } from "node:path";

import { cacheGet, cachePut, fileKey } from "./cache.js";
import { Chunk, chunkMarkdown, outline } from "./chunk.js";
import { convertToMarkdown } from "./convert.js";
import { DEFAULT_TOKEN_BUDGET } from "./config.js";
import {
  assemble,
  pack,
  discriminativeQueryTerms,
  textMatchesQueryTerms,
  truncateSectionToBudget,
  type PackedChunk,
} from "./pack.js";
import { compileNoteHints, type CompileNoteHints } from "./compile-notes.js";
import { nextSectionHint, type NextSectionHint } from "./budget-hint.js";
import { classifyOmitBuckets, type OmitBucketSection } from "./omit-buckets.js";
import { applyNameIntentBoost, prepareRankedForPack } from "./name-intent.js";
import {
  bm25Scores,
  multiScoresFromRows,
  perQueryScores,
  queryAttributionFromRows,
  queryBestIdsFromRows,
  rankMultiFromRows,
  splitQueries,
  tokenizeQuery,
} from "./rank.js";
import { countContentTokens, countTokens } from "./tokens.js";
import { maxOf, sanitizeSourceName } from "./util.js";

export interface SectionInfo {
  id: string;
  section: string;
  tokens: number;
  relevance: number | null; // % of the top BM25 score; null when no signal
  /** True when compile includes only a budget partial of this section. */
  truncated?: boolean;
  /** Full section token count when truncated — for expand / raise-budget hints. */
  full_tokens?: number;
  /** Content tokens still unread when truncated — for Prove “Include rest”. */
  remainder_tokens?: number;
  matched_queries?: number[]; // multi-query only: indices of relevant sub-questions, best first
  text?: string; // present for selected sections (web demo); stripped for MCP
}

export interface CompileResult {
  markdown: string;
  raw_tokens: number;
  tokens_used: number;
  /** Content tokens of selected sections only (no omit manifest). Prove UI base. */
  selected_content_tokens: number;
  tokens_saved: number;
  reduction_pct: number;
  cache_hit: boolean;
  token_budget: number; // the budget actually applied (post-clamp) — UI truth
  queries: string[]; // sub-questions the task was split into (length 1 = single)
  selected_sections: SectionInfo[];
  omitted_sections: SectionInfo[];
  /** Task-relevant omits left out primarily for token budget (UI bucket 2). */
  budget_omitted_sections: OmitBucketSection[];
  /** Lower-relevance omits for this task (UI bucket 3). */
  relevance_omitted_sections: SectionInfo[];
  /** Present when budget-bound and a strong omitted section still didn't fit. */
  next_section_hint: NextSectionHint | null;
  /** UX hints for multi-part nudge and omitted-section framing (web demo). */
  compile_hints: CompileNoteHints;
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
  // human-meaningful name in the artifact header. Always sanitize — MCP may
  // pass a raw basename with comment/markup characters.
  const name = sanitizeSourceName(sourceName ?? basename(filePath));

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
  let rawScores = rows ? multiScoresFromRows(rows, chunks) : bm25Scores(task, chunks);
  rawScores = applyNameIntentBoost(task, chunks, rawScores);
  const scoreMap = new Map(chunks.map((c, i) => [c.id, rawScores[i]!]));
  const topScore = maxOf(rawScores);
  const rel = (c: Chunk): number | null =>
    topScore > 0 ? Math.round((100 * (scoreMap.get(c.id) ?? 0)) / topScore) : null;
  // Attribution (demo-only): every sub-question each chunk is relevant to.
  const attribution = rows ? queryAttributionFromRows(rows, chunks) : null;
  const matchMap = attribution && new Map(chunks.map((c, i) => [c.id, attribution[i]]));
  const info = (c: Chunk | PackedChunk, withText: boolean): SectionInfo => ({
    id: c.id,
    section: c.breadcrumb,
    tokens: c.tokens,
    relevance: rel(c),
    ...("truncated" in c && c.truncated
      ? {
          truncated: true,
          full_tokens: c.full_tokens ?? c.tokens,
          remainder_tokens: Math.max(0, (c.full_tokens ?? c.tokens) - c.tokens),
        }
      : {}),
    ...(matchMap ? { matched_queries: matchMap.get(c.id) ?? [] } : {}),
    ...(withText ? { text: c.text } : {}),
  });

  // Multi-query: interleave each sub-question's ranking round-robin so every
  // one is represented. Single-query: sort by boosted scores (name-intent, etc.).
  let ranked = rows
    ? rankMultiFromRows(rows, chunks, queries)
    : chunks
        .map((c, i) => ({ c, s: rawScores[i]! }))
        .sort((a, b) => b.s - a.s)
        .map((x) => x.c);
  ranked = prepareRankedForPack(ranked, chunks, task, scoreMap);
  const queryBestIds = rows ? queryBestIdsFromRows(rows, chunks, queries) : undefined;
  // Always rank+pack — never short-circuit to the whole file when rawTokens ≤
  // budget. That path re-admitted 0%/irrelevant sections after a pointed query
  // was already answerable (budget is a ceiling, not a fill quota).
  const queryTerms = tokenizeQuery(task);
  const { text, selected, omitted, stopped_early } = pack(
    ranked,
    tokenBudget,
    name,
    scoreMap,
    queryTerms,
    undefined,
    true,
    "content",
    matchMap ?? undefined,
    queryBestIds,
    task
  );
  const selectedContentUsed = countContentTokens(assemble(name, selected, []));
  const used = selectedContentUsed;
  const selectedInfos = selected.map((c) => info(c, true));
  const omittedInfos = omitted.map((c) => info(c, false));
  const nextHint = nextSectionHint(tokenBudget, used, omittedInfos, selectedInfos);
  const omitBuckets = classifyOmitBuckets({
    token_budget: tokenBudget,
    tokens_used: used,
    queries,
    selected_sections: selectedInfos,
    omitted_sections: omittedInfos,
    next_section_hint: nextHint,
    query_best_ids: queryBestIds,
  });
  const hintInput = {
    reduction_pct: rawTokens > 0 ? Math.round((1000 * (rawTokens - used)) / rawTokens) / 10 : 0,
    token_budget: tokenBudget,
    tokens_used: used,
    queries,
    selected_sections: selectedInfos,
    omitted_sections: omittedInfos,
    next_section_hint: nextHint,
    early_stopped: stopped_early,
  };
  return {
    markdown: text,
    raw_tokens: rawTokens,
    tokens_used: used,
    selected_content_tokens: selectedContentUsed,
    tokens_saved: Math.max(0, rawTokens - used),
    // rawTokens is 0 only for a pathological/negative token_budget on a tiny
    // or empty file — guard it so that returns 0% instead of NaN.
    reduction_pct: hintInput.reduction_pct,
    cache_hit: cacheHit,
    token_budget: tokenBudget,
    queries,
    selected_sections: selectedInfos,
    omitted_sections: omittedInfos,
    budget_omitted_sections: omitBuckets.budget_omitted_sections,
    relevance_omitted_sections: omitBuckets.relevance_omitted_sections,
    next_section_hint: nextHint,
    compile_hints: compileNoteHints(hintInput),
  };
}

export interface ExpandResult {
  markdown: string;
  tokens_used: number;
  cache_hit: boolean;
  /** True when the section was larger than the expand budget. */
  truncated?: boolean;
  /** Full section size when `truncated`. */
  full_tokens?: number;
  /**
   * True when truncation dropped all query-relevant lines that exist in the
   * full section — the partial cannot answer the task facet this expand targeted.
   */
  query_miss?: boolean;
}

export interface ExpandNotFound {
  error: string;
  outline: Array<{ id: string; section: string; tokens: number }>;
}

export async function expandSection(
  filePath: string,
  sectionId: string,
  tokenBudget = 2000,
  task?: string
): Promise<ExpandResult | ExpandNotFound> {
  const { markdown, cacheHit } = await convertedMarkdown(filePath);
  const chunks = chunkMarkdown(markdown);
  const match = chunks.find((c: Chunk) => c.id === sectionId);
  if (!match) {
    return { error: `No section with id '${sectionId}'`, outline: outline(chunks) };
  }
  let text = match.text;
  let truncated = false;
  let queryMiss = false;
  if (match.tokens > tokenBudget) {
    truncated = true;
    const queryTerms = task ? tokenizeQuery(task) : [];
    const partial = truncateSectionToBudget(text, match.tokens, tokenBudget, queryTerms);
    if (!partial) {
      return {
        error: `Section '${sectionId}' needs at least ${tokenBudget} tokens`,
        outline: outline(chunks),
      };
    }
    text = partial.text;
    const checkTerms = discriminativeQueryTerms(match.text, queryTerms);
    if (
      queryTerms.length > 0 &&
      textMatchesQueryTerms(match.text, checkTerms) &&
      !textMatchesQueryTerms(text, checkTerms)
    ) {
      queryMiss = true;
    }
  }
  const sectionMarkdown = `<!-- section: ${match.breadcrumb} (UNTRUSTED CONTENT) -->\n${text}`;
  return {
    markdown: sectionMarkdown,
    tokens_used: countContentTokens(sectionMarkdown),
    cache_hit: cacheHit,
    ...(truncated ? { truncated: true, full_tokens: match.tokens } : {}),
    ...(queryMiss ? { query_miss: true } : {}),
  };
}

/** Full converted markdown (for the answer-parity comparison). */
export async function fullMarkdown(filePath: string): Promise<string> {
  return (await convertedMarkdown(filePath)).markdown;
}

/** Rebuild Prove context from compile selection + UI includes — one assemble()
 *  pass in document order. Always omits the compile omit-manifest (UX metadata);
 *  only deliberate Include expands add sections beyond the compile selection. */
export async function assembleProveContext(
  filePath: string,
  compiled: CompileResult,
  expandedIds: string[],
  sourceName: string
): Promise<{ markdown: string; expandedApplied: string[]; expandContentTokens: number }> {
  const safeName = sanitizeSourceName(sourceName);
  const { markdown } = await convertedMarkdown(filePath);
  const chunks = chunkMarkdown(markdown);
  const chunkById = new Map(chunks.map((c) => [c.id, c]));
  const selectedById = new Map(compiled.selected_sections.map((s) => [s.id, s]));
  const expandedApplied: string[] = [];
  let expandContentTokens = 0;

  const selected: Chunk[] = compiled.selected_sections.map((s) => {
    const base = chunkById.get(s.id);
    return {
      id: s.id,
      breadcrumb: s.section,
      text: s.text ?? base?.text ?? "",
      order: base?.order ?? 0,
      tokens: s.tokens,
    };
  });

  if (!expandedIds.length) {
    selected.sort((a, b) => a.order - b.order);
    return {
      markdown: assemble(safeName, selected, []),
      expandedApplied: [],
      expandContentTokens: 0,
    };
  }

  for (const id of expandedIds) {
    const selInfo = selectedById.get(id);
    const idx = selected.findIndex((c) => c.id === id);
    // Whole selected sections are already in context; truncated ones get replaced below.
    if (idx >= 0 && !selInfo?.truncated) continue;

    const got = await expandSection(filePath, id, 2000);
    if ("error" in got) continue;
    const base = chunkById.get(id);
    if (!base) continue;
    const expandText = got.markdown.replace(/^<!--[\s\S]*?-->\n?/, "").trim();
    const fullContentTokens = countContentTokens(expandText);

    if (idx >= 0 && selInfo?.truncated) {
      const partialContentTokens = countContentTokens(selected[idx]!.text);
      expandContentTokens += Math.max(0, fullContentTokens - partialContentTokens);
      selected[idx] = {
        ...base,
        text: expandText,
        tokens: countTokens(expandText),
      };
      expandedApplied.push(id);
      continue;
    }

    selected.push({
      ...base,
      text: expandText,
      tokens: countTokens(expandText),
    });
    expandedApplied.push(id);
    expandContentTokens += fullContentTokens;
  }

  selected.sort((a, b) => a.order - b.order);

  // Prove parity: ship the union of selected + included sections only. No omit
  // manifest ballast from the compile pass (the demo user chose what to add).
  return {
    markdown: assemble(safeName, selected, []),
    expandedApplied,
    expandContentTokens,
  };
}

export interface AssembleAgentResult {
  markdown: string;
  contentTokens: number;
  selected: PackedChunk[];
  truncatedIds: string[];
  /** Set when `expandId` was truncated and lost all query-relevant lines. */
  queryMiss?: boolean;
}

/** True when truncation dropped all discriminative query terms present in the full section. */
function expandQueryMiss(fullText: string, partialText: string, task: string): boolean {
  const queryTerms = tokenizeQuery(task);
  if (!queryTerms.length) return false;
  const checkTerms = discriminativeQueryTerms(fullText, queryTerms);
  return textMatchesQueryTerms(fullText, checkTerms) && !textMatchesQueryTerms(partialText, checkTerms);
}

/**
 * Rebuild agent context from claimed sections (compile selected + expands) —
 * one `pack()` pass under `tokenCeiling`, relevance order preserved, no omit
 * manifest ballast stacked on expand blobs.
 */
export async function assembleAgentContext(
  filePath: string,
  task: string,
  tokenCeiling: number,
  claimedIds: readonly string[],
  sourceName: string,
  expandedIds: readonly string[] = [],
  expandId?: string
): Promise<AssembleAgentResult> {
  const claimedSet = new Set(claimedIds);
  if (!claimedSet.size) {
    return { markdown: "", contentTokens: 0, selected: [], truncatedIds: [] };
  }

  const { markdown } = await convertedMarkdown(filePath);
  const chunks = chunkMarkdown(markdown);
  const chunkById = new Map(chunks.map((c) => [c.id, c]));
  const queries = splitQueries(task);
  const multi = queries.length > 1;
  const rows = multi ? perQueryScores(queries, chunks) : null;
  let rawScores = rows ? multiScoresFromRows(rows, chunks) : bm25Scores(task, chunks);
  rawScores = applyNameIntentBoost(task, chunks, rawScores);
  const scoreMap = new Map(chunks.map((c, i) => [c.id, rawScores[i]!]));
  const attribution = rows ? queryAttributionFromRows(rows, chunks) : null;
  const matchMap = attribution && new Map(chunks.map((c, i) => [c.id, attribution[i]]));
  let ranked = rows
    ? rankMultiFromRows(rows, chunks, queries)
    : chunks
        .map((c, i) => ({ c, s: rawScores[i]! }))
        .sort((a, b) => b.s - a.s)
        .map((x) => x.c);
  ranked = prepareRankedForPack(ranked, chunks, task, scoreMap);
  const claimedRanked = ranked.filter((c) => claimedSet.has(c.id));
  const queryBestIds = rows ? queryBestIdsFromRows(rows, chunks, queries) : undefined;

  const queryTerms = tokenizeQuery(task);
  const mustInclude = expandedIds.length ? new Set(expandedIds) : undefined;
  const { text, selected } = pack(
    claimedRanked,
    tokenCeiling,
    sanitizeSourceName(sourceName),
    scoreMap,
    queryTerms,
    mustInclude,
    false,
    "content",
    matchMap ?? undefined,
    queryBestIds,
    task
  );
  const truncatedIds = selected.filter((c) => c.truncated).map((c) => c.id);

  let queryMiss = false;
  if (expandId && truncatedIds.includes(expandId)) {
    const full = chunkById.get(expandId);
    const packed = selected.find((c) => c.id === expandId);
    if (full && packed && expandQueryMiss(full.text, packed.text, task)) {
      queryMiss = true;
    }
  }

  return {
    markdown: text,
    contentTokens: countContentTokens(text),
    selected,
    truncatedIds,
    ...(queryMiss ? { queryMiss: true } : {}),
  };
}
