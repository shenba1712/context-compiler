/** Test suite. Run: npm test */
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
  unlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Force a high demo rate budget before any dynamic import of web.ts — LLM-heavy
// tests (agent + parity + answer) share one in-process limiter. Use `=` not
// `??=` so a dirty shell (e.g. CC_RATE_LIMIT=1) cannot starve those routes.
process.env.CC_RATE_LIMIT = "200";

const FIXTURES_DIR = join(process.cwd(), "src", "tests", "fixtures");
/** Writable under the workspace (sandbox-safe) and still under ~/… so CC_ROOT checks pass. */
const TEST_TMP = join(process.cwd(), ".test-tmp");
// Keep conversion cache inside the workspace — ~/.cache is often sandbox-blocked,
// and integrity sidecars must be writable for put/get during e2e.
process.env.CC_CACHE_DIR = join(TEST_TMP, "cache");
mkdirSync(process.env.CC_CACHE_DIR, { recursive: true });

function testTmpPath(name: string): string {
  mkdirSync(TEST_TMP, { recursive: true });
  return join(TEST_TMP, name);
}

/** Provider keys that select which LLM backends are active. */
const LLM_PROVIDER_KEYS = [
  "ANTHROPIC_API_KEY",
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "OPENROUTER_API_KEY",
  "OPENAI_API_KEY",
  "CC_LLM_API_KEY",
] as const;

/** Model-id overrides that leak from a real demo shell into assertions. */
const LLM_MODEL_KEYS = [
  "CC_GEMINI_MODEL",
  "CC_GEMINI_MODELS",
  "CC_OPENROUTER_MODEL",
  "CC_ANSWER_MODEL",
  "CC_LLM_MODEL",
  "CC_ANTHROPIC_MODEL",
] as const;

/**
 * Clear (and optionally patch) env keys for the duration of `fn`, then restore
 * the caller's values — including keys that were unset. Prefer this over
 * `process.env = { ...saved }` so we never clobber unrelated vars mid-suite.
 */
async function withCleanEnv(
  keys: readonly string[],
  fn: () => Promise<void>,
  patch?: Record<string, string>
): Promise<void> {
  const all = new Set<string>([...keys, ...Object.keys(patch ?? {})]);
  const saved: Record<string, string | undefined> = {};
  for (const k of all) saved[k] = process.env[k];
  for (const k of keys) delete process.env[k];
  if (patch) {
    for (const [k, v] of Object.entries(patch)) process.env[k] = v;
  }
  try {
    await fn();
  } finally {
    for (const k of all) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

import { nextSectionHint } from "../budget-hint.js";
import {
  budgetBoundHintBodyPlain,
  budgetBoundHintMentionsExpand,
  compileNoteHints,
  EARLY_STOPPED_FLOOR_TEXT,
  MULTI_PART_NUDGE_TEXT,
} from "../compile-notes.js";
import { classifyOmitBuckets } from "../omit-buckets.js";
import { chunkMarkdown } from "../chunk.js";
import {
  agentStreamIncompleteMessage,
  applyProveIncludeChange,
  emptyCompiledSectionsMessage,
  includeRestHint,
  isNearVisibleRect,
  LAYOUT_FRAMES_BEFORE_SCROLL,
  packagingGapNote,
  shouldClearAgentOnCompile,
  shouldClearResultsOnDocChange,
  shouldDisableProveAgentWhenQuestionStale,
  shouldDisableProveWhenBudgetStale,
  shouldDisableProveWhenStale,
  shouldKeepAgentStepsOnCancel,
  shouldRemovePeekOnUncheck,
  shouldScrollIntoView,
  shouldShowAgentSecIdle,
  apiFailureMessageFromStatus,
  busy503RetryDelayMs,
  BUSY_503_RETRY_MS_MAX,
  BUSY_503_RETRY_MS_MIN,
  proveFlowUsesLocalError,
  questionStaleBannerHtml,
  rateLimitRetryHint,
  shouldRetryBusy503,
  taskInvalidatesCompile,
  truncatedSectionMeta,
} from "../client-ux.js";
import { convertToMarkdown, ConversionError } from "../convert.js";
import { intEnv, numEnv, trustProxyFromEnv } from "../env.js";
import { assemble, pack, truncateSectionToBudget } from "../pack.js";
import { checkPathWithin } from "../path-guard.js";
import { assembleProveContext, compileContext, expandSection, fullMarkdown } from "../pipeline.js";
import {
  bm25Scores,
  multiScoresFromRows,
  perQueryScores,
  queryAttribution,
  queryAttributionFromRows,
  queryBestIdsFromRows,
  rank,
  rankMulti,
  rankMultiFromRows,
  splitQueries,
  tokenize,
  tokenizeQuery,
} from "../rank.js";
import { isMultiPartTask, splitTaskAspects } from "../query-aspects.js";
import {
  applyNameIntentBoost,
  chunkHasGivenNameSpan,
  detectNameIntent,
  prepareRankedForPack,
} from "../name-intent.js";
import { countContentTokens, countTokens } from "../tokens.js";
import { UploadRejected, validateUpload } from "../upload-guard.js";
import { sanitizeSourceName } from "../util.js";
import { cacheGet, cachePut } from "../cache.js";

function makeTestDoc(): string {
  const sections: string[] = ["# Master Services Agreement\n\nThis agreement is made between parties."];
  for (let i = 1; i < 30; i++) {
    const title = i === 7 ? "Payment terms" : `General provision ${i}`;
    const body = Array.from(
      { length: 40 },
      (_, j) => `Boilerplate clause sentence number ${j} for section ${i}.`
    ).join(" ");
    sections.push(`## Section ${i}: ${title}\n\n${body}`);
  }
  sections.push(
    "## Section 30: Termination\n\n" +
      "Either party may terminate this agreement with **90 days written notice**. " +
      "In case of material breach, termination notice period is 30 days. " +
      "Termination for insolvency is immediate."
  );
  sections.push(
    "## Section 31: Data table\n\n" +
      "| Tier | Notice | Fee |\n|---|---|---|\n| Basic | 90 days | $0 |\n| Pro | 60 days | $500 |\n"
  );
  return sections.join("\n\n");
}

async function testChunking() {
  const chunks = chunkMarkdown(makeTestDoc());
  assert.ok(chunks.length > 20, `expected many chunks, got ${chunks.length}`);
  const tableChunks = chunks.filter((c) => c.text.includes("| Tier |"));
  assert.equal(tableChunks.length, 1, "table stays atomic");
  assert.ok(tableChunks[0].text.includes("| Pro | 60 days"));
  assert.ok(chunks.every((c) => c.breadcrumb));
  console.log(`  chunking ok: ${chunks.length} chunks, tables atomic`);
}

function testContentTokens() {
  const wrapped =
    "<!-- source: demo.md (UNTRUSTED CONTENT) -->\n# Title\n\nBody text here.\n\n" +
    "<!-- section: A > B (UNTRUSTED CONTENT) -->\nMore body.";
  assert.ok(
    countContentTokens(wrapped) < countTokens(wrapped),
    "HTML comment wrappers must not inflate content metering"
  );
  assert.ok(
    countContentTokens(wrapped) >= countTokens("# Title\n\nBody text here.\n\nMore body.") - 1,
    "content metering should track the substantive markdown"
  );
  console.log("  content tokens ok: assemble wrappers stripped for metering");
}

async function testRankAndPack() {
  const chunks = chunkMarkdown(makeTestDoc());
  const task = "What are the termination notice periods?";
  const ranked = rank(task, chunks);
  assert.ok(
    ranked[0].breadcrumb.includes("Termination") || ranked[0].text.includes("Termination"),
    `top chunk should be termination, got: ${ranked[0].breadcrumb}`
  );
  const { text, selected, omitted } = pack(ranked, 1500, "test.md");
  assert.ok(selected.length, "should select at least one chunk");
  assert.ok(omitted.length, "should omit chunks at this budget");
  assert.ok(text.includes("90 days written notice"), "the answer must survive compilation");
  assert.ok(text.includes("UNTRUSTED"));
  assert.ok(text.includes("expand_section"));
  assert.ok(countTokens(text) <= 1500, `budget overshoot: ${countTokens(text)}`);
  console.log(
    `  rank+pack ok: ${selected.length} kept, ${omitted.length} omitted, ${countTokens(text)} tokens`
  );
}

async function testEndToEnd() {
  const path = testTmpPath(`cc-test-${Date.now()}.md`);
  writeFileSync(path, makeTestDoc());
  try {
    const r = await compileContext(path, "termination notice period", 1500);
    assert.ok(r.reduction_pct > 50, `expected >50% reduction, got ${r.reduction_pct}%`);
    assert.ok(r.markdown.includes("90 days written notice"));
    assert.ok(r.omitted_sections.length, "manifest should list omitted sections");
    assert.ok(
      r.selected_sections.every((s) => typeof s.text === "string" && s.text.length > 0),
      "pipeline attaches text on selected sections (web UI depends on this)"
    );

    const r2 = await compileContext(path, "payment terms", 1500);
    assert.equal(r2.cache_hit, true, "second call hits cache");
    assert.ok(r2.markdown.includes("Payment terms"), "different task selects different sections");

    const sid = r.omitted_sections[0].id;
    const e = await expandSection(path, sid);
    assert.ok(!("error" in e), "expand_section should find the omitted section by id");
    assert.ok((e as { markdown: string }).markdown, "expand_section returns content");
    console.log(
      `  e2e ok: ${r.raw_tokens} -> ${r.tokens_used} tokens (${r.reduction_pct}% saved), cache+expand ok`
    );
  } finally {
    unlinkSync(path);
  }
}

async function testMultilingualRanking() {
  // A Latin-only tokenizer scores Hindi chunks at 0 — this guards the fix.
  const md = [
    "# नीति पुस्तिका",
    "## अध्याय 1: सामान्य नियम\n\n" + "सामान्य प्रक्रियाएँ और अनुपालन की जानकारी यहाँ है। ".repeat(30),
    "## अध्याय 2: धनवापसी नीति\n\nधनवापसी 14 कार्य दिवसों के भीतर संसाधित की जाती है।",
    "## अध्याय 3: समाप्ति\n\n" + "समाप्ति की शर्तें और सूचना अवधि। ".repeat(30),
  ].join("\n\n");
  const chunks = chunkMarkdown(md);
  const ranked = rank("धनवापसी में कितने दिन लगते हैं?", chunks);
  assert.ok(
    ranked[0].text.includes("14 कार्य दिवसों"),
    `Hindi query should rank the refund section first, got: ${ranked[0].breadcrumb}`
  );
  // Content must beat metadata: even at a tight budget with token-dense
  // Devanagari breadcrumbs, at least the top-ranked chunk must survive.
  const { text, selected } = pack(ranked, 700, "test-hi.md");
  assert.ok(selected.length >= 1, "pack must never ship a manifest-only result when content fits");
  assert.ok(text.includes("14 कार्य दिवसों"), "the Hindi answer must survive packing");
  console.log("  multilingual ok: Devanagari ranking + content-priority packing");
}

async function testMoreScriptsRanking() {
  // The Unicode tokenizer must rank across scripts, not just Devanagari. This
  // guards the sample library's added languages: Latin+accents (Spanish),
  // Cyrillic (Russian), and Arabic (right-to-left, connected). Each query
  // shares terms with exactly one section; the ranker must surface it over a
  // longer, unrelated distractor.
  const cases = [
    {
      q: "¿Qué encontró el panadero en la harina?",
      hit: "monedas",
      doc: [
        "# Cuentos",
        "## El panadero\n\nEl panadero encontró una bolsa de monedas en la harina.",
        "## El árbol\n\n" + "Un olmo crecía en la plaza del pueblo. ".repeat(20),
      ],
    },
    {
      q: "Что нашёл извозчик в санях?",
      hit: "кошелёк",
      doc: [
        "# Рассказы",
        "## Извозчик\n\nИзвозчик нашёл кошелёк в санях.",
        "## Берёза\n\n" + "Берёза росла у сельской школы. ".repeat(20),
      ],
    },
    {
      q: "ماذا وجد الخبّاز في كيس الطحين؟",
      hit: "صرّة",
      doc: [
        "# حكايات",
        "## الخبّاز\n\nوجد الخبّاز صرّة نقود في كيس الطحين.",
        "## الشجرة\n\n" + "شجرة عتيقة في وسط القرية. ".repeat(20),
      ],
    },
  ];
  for (const c of cases) {
    const chunks = chunkMarkdown(c.doc.join("\n\n"));
    const ranked = rank(c.q, chunks);
    assert.ok(
      ranked[0].text.includes(c.hit),
      `top chunk for "${c.q}" should contain "${c.hit}", got: ${ranked[0].breadcrumb}`
    );
  }
  console.log("  more-scripts ok: Spanish / Russian / Arabic queries rank the right section");
}

async function testRelevanceFloor() {
  const chunks = chunkMarkdown(makeTestDoc());
  const task = "What are the termination notice periods?";
  const ranked = rank(task, chunks);
  const scores = new Map(chunks.map((c, i) => [c.id, bm25Scores(task, chunks)[i]]));

  // Sharp query + big budget: the floor should stop early instead of
  // padding the budget with boilerplate sections.
  const withFloor = pack(ranked, 6000, "t.md", scores);
  const withoutFloor = pack(ranked, 6000, "t.md");
  assert.ok(
    withFloor.selected.length < withoutFloor.selected.length,
    `floor should select fewer: ${withFloor.selected.length} vs ${withoutFloor.selected.length}`
  );
  assert.ok(
    withFloor.text.includes("90 days written notice"),
    "the answer must still be present with the floor on"
  );
  // Flat scores (vague query with no signal): recall insurance picks a compact
  // cluster — it must not vacuum-fill the whole document.
  const vague = new Map(chunks.map((c) => [c.id, 1]));
  const flat = pack(ranked, 6000, "t.md", vague);
  assert.ok(
    flat.selected.length < withoutFloor.selected.length,
    `flat scores must not budget-fill: ${flat.selected.length} vs ${withoutFloor.selected.length}`
  );
  assert.ok(flat.selected.length >= 1, "flat scores still pick at least one section");
  console.log(
    `  relevance floor ok: ${withFloor.selected.length} kept vs ${withoutFloor.selected.length} without; flat scores stay compact (${flat.selected.length})`
  );
}

async function testEarlyStopFillerHeavy() {
  // Coverage + marginal gain: mid-tier sections share query terms with the
  // answer and must not fill a large budget once discriminative terms are covered.
  const chunks = chunkMarkdown(
    [
      "## Answer\n\nThe launch window opens on April 3 for the Nova mission. " +
        "Mission timeline detail. ".repeat(15),
      "## Near peer\n\nRelated Nova mission timeline notes without the date. ".repeat(12),
      "## Mid padding\n\nSome Nova keywords but not the answer. ".repeat(12),
      ...Array.from(
        { length: 5 },
        (_, i) => `## Weak ${i}\n\n` + `Unrelated corporate filler ${i}. `.repeat(20)
      ),
    ].join("\n\n")
  );
  const byTitle = (re: RegExp) => chunks.find((c) => re.test(c.breadcrumb))!;
  const answer = byTitle(/Answer/);
  const near = byTitle(/Near peer/);
  const mid = byTitle(/Mid padding/);
  const scores = new Map(chunks.map((c) => [c.id, 0.1]));
  scores.set(answer.id, 1.0);
  scores.set(near.id, 0.99);
  scores.set(mid.id, 0.45);
  const ranked = [...chunks].sort((a, b) => (scores.get(b.id) ?? 0) - (scores.get(a.id) ?? 0));
  const budget = 6000;
  const task = "When is the Nova mission launch date?";
  const queryTerms = tokenizeQuery(task);

  const { selected, omitted, stopped_early } = pack(
    ranked,
    budget,
    "nova.md",
    scores,
    queryTerms,
    undefined,
    true,
    "full",
    undefined,
    undefined,
    task
  );
  assert.ok(stopped_early, "large budget must stop once coverage is met");
  assert.ok(
    selected.some((c) => c.id === answer.id),
    "answer-bearing section must be selected"
  );
  assert.ok(!selected.some((c) => c.id === near.id), "redundant near-peer must not fill budget");
  assert.ok(!selected.some((c) => c.id === mid.id), "mid-tier padding must not fill the budget");
  assert.ok(!selected.some((c) => /Weak/.test(c.breadcrumb)), "weak fillers must stay omitted");
  assert.ok(
    omitted.some((c) => c.id === mid.id),
    "mid-tier padding should appear in omitted"
  );
  console.log(
    `  coverage filler ok: ${selected.length} selected, stopped_early=${stopped_early}, budget=${budget}`
  );
}

async function testEarlyStopNoBudgetInflation() {
  // Larger budget must not vacuum in weak junk; it may still pack near-top peers
  // (prefer false negative). Do not require stopped_early on every large budget.
  const doc = makeTestDoc();
  const chunks = chunkMarkdown(doc);
  const task = "What are the termination notice periods?";
  const ranked = rank(task, chunks);
  const scores = new Map(chunks.map((c, i) => [c.id, bm25Scores(task, chunks)[i]]));
  const topScore = scores.get(ranked[0]!.id) ?? 1;

  const at1000 = pack(ranked, 1000, "t.md", scores);
  const at4000 = pack(ranked, 4000, "t.md", scores);
  assert.ok(
    at1000.selected.some((c) => c.text.includes("90 days")),
    "1000 budget still gets the termination answer"
  );
  assert.ok(
    at4000.selected.some((c) => c.text.includes("90 days")),
    "4000 budget still gets the termination answer"
  );
  for (const c of at4000.selected) {
    const rel = (scores.get(c.id) ?? 0) / topScore;
    assert.ok(rel >= 0.45, `4000 must not add clear padding: ${c.id} rel=${rel}`);
  }
  // Optional: if early-stop fired, selection should stay compact vs fill-all.
  if (at4000.stopped_early) {
    assert.ok(
      at4000.selected.length <= at1000.selected.length + 2,
      `early-stop at 4000 should stay compact: ${at1000.selected.length}→${at4000.selected.length}`
    );
  }
  console.log(
    `  early-stop budget inflation ok: 1000→${at1000.selected.length} sections, ` +
      `4000→${at4000.selected.length} sections, stopped_early=${at4000.stopped_early}`
  );
}

function testEarlyStopNameIntentBingley() {
  // Synthetic P&P-shaped case: honorific-heavy chunks score 89–97% of top; once
  // CAROLINE BINGLEY is in, a 4000 budget must not vacuum them in.
  const task = "What is Ms. Bingley's first name?";
  const honorificBody = "Miss Bingley smiled at Darcy and Elizabeth. ".repeat(55);
  const doc = [
    "## Chapter III\n\n" + honorificBody,
    "## Chapter IV\n\n" + honorificBody,
    "## Chapter VII\n\n" + honorificBody,
    "## Chapter VII\n\nThe note ended with:\n\nCAROLINE BINGLEY.",
    "## Chapter VIII\n\n" + honorificBody,
    "## Chapter X\n\n" + honorificBody,
    "## Chapter XVI\n\n" + honorificBody,
    "## Chapter XVIII\n\n" + honorificBody,
    "## Chapter XXVI\n\n" + honorificBody,
  ].join("\n\n");
  const chunks = chunkMarkdown(doc);
  const byHeading = (re: RegExp) => chunks.find((c) => re.test(c.breadcrumb))!;
  const caroline = byHeading(/VII.*VII|Chapter VII/i);
  // Prefer the chunk that actually has the signature
  const carolineChunk = chunks.find((c) => chunkHasGivenNameSpan(c.text, "bingley")) ?? caroline;

  let raw = bm25Scores(task, chunks);
  raw = applyNameIntentBoost(task, chunks, raw);
  const scores = new Map(chunks.map((c, i) => [c.id, raw[i]!]));
  const top = Math.max(...raw);
  for (const c of chunks) {
    if (c.id === carolineChunk.id) continue;
    const rel = /Chapter (III|IV)\b/.test(c.breadcrumb) ? 0.52 : 0.93;
    scores.set(c.id, top * rel);
  }
  scores.set(carolineChunk.id, top);

  let ranked = [...chunks].sort((a, b) => (scores.get(b.id) ?? 0) - (scores.get(a.id) ?? 0));
  ranked = prepareRankedForPack(ranked, chunks, task, scores);
  const queryTerms = tokenizeQuery(task);

  const at1000 = pack(
    ranked,
    1000,
    "pp.md",
    scores,
    queryTerms,
    undefined,
    true,
    "content",
    undefined,
    undefined,
    task
  );
  const at4000 = pack(
    ranked,
    4000,
    "pp.md",
    scores,
    queryTerms,
    undefined,
    true,
    "content",
    undefined,
    undefined,
    task
  );

  const hasCaroline = (sel: typeof at1000.selected) =>
    sel.some((c) => chunkHasGivenNameSpan(c.text, "bingley"));
  assert.ok(hasCaroline(at1000.selected), "1000 budget must include Caroline");
  assert.ok(hasCaroline(at4000.selected), "4000 budget must include Caroline");
  assert.ok(at4000.stopped_early, "4000 must set stopped_early once answer is sufficient");
  assert.ok(
    at4000.selected.length <= at1000.selected.length + 1,
    `4000 should stay compact: 1000→${at1000.selected.length}, 4000→${at4000.selected.length}`
  );
  const tok1000 = countContentTokens(assemble("pp.md", at1000.selected, []));
  const tok4000 = countContentTokens(assemble("pp.md", at4000.selected, []));
  assert.ok(
    tok4000 <= tok1000 * 1.35 + 120,
    `4000 tokens (${tok4000}) should stay near 1000 case (${tok1000}), not fill budget`
  );
  assert.ok(
    !at4000.selected.some((c) => /Chapter (III|IV)\b/.test(c.breadcrumb)),
    "weak Ch.III/IV padding must not be selected at 4000"
  );
  console.log(
    `  early-stop Bingley ok: 1000→${at1000.selected.length} sel/${tok1000} tok, ` +
      `4000→${at4000.selected.length} sel/${tok4000} tok, stopped_early=${at4000.stopped_early}`
  );
}

function testCoverageRedundantFillers() {
  // Many high-BM25 sections repeat the same query terms — after the answer
  // section covers discriminative terms, fillers must not be admitted.
  const task = "What is the Nova mission launch date?";
  const answerBody = "The Nova mission launch date is April 3, 2026. Mission control confirmed.";
  const fillerBody = "Nova mission timeline and Nova mission planning notes without the date. ".repeat(40);
  const doc = [
    "## Answer\n\n" + answerBody,
    ...Array.from({ length: 10 }, (_, i) => `## Filler ${i}\n\n` + fillerBody + ` Section ${i}.`),
  ].join("\n\n");
  const chunks = chunkMarkdown(doc);
  const ranked = rank(task, chunks);
  const scores = new Map(chunks.map((c, i) => [c.id, bm25Scores(task, chunks)[i]!]));
  const queryTerms = tokenizeQuery(task);

  const at4000 = pack(
    ranked,
    4000,
    "nova.md",
    scores,
    queryTerms,
    undefined,
    true,
    "content",
    undefined,
    undefined,
    task
  );
  const at8000 = pack(
    ranked,
    8000,
    "nova.md",
    scores,
    queryTerms,
    undefined,
    true,
    "content",
    undefined,
    undefined,
    task
  );

  assert.ok(
    at4000.selected.some((c) => c.text.includes("April 3")),
    "must include launch date"
  );
  assert.ok(at4000.stopped_early, "4000 must stop once coverage met");
  assert.ok(at8000.stopped_early, "8000 must stop once coverage met");
  assert.ok(
    at8000.selected.length <= at4000.selected.length + 1,
    `redundant fillers must not inflate selection: 4000→${at4000.selected.length}, 8000→${at8000.selected.length}`
  );
  assert.ok(
    !at8000.selected.some((c) => /Filler/.test(c.breadcrumb)),
    "BM25-redundant filler sections must stay out after coverage"
  );
  console.log(
    `  coverage redundant fillers ok: 4000→${at4000.selected.length} sel, 8000→${at8000.selected.length} sel`
  );
}

function testEarlyStopClusterJaneBingley() {
  // Coverage-first: once Bingley/Jane discriminative terms are covered, larger
  // budgets must not vacuum honorific-heavy chapters that repeat the same terms.
  const task = "What does Mr. Bingley think of Jane Bennet early on?";
  const answerBody =
    "Bingley had never met with pleasanter people. As to Miss Bennet, he could not conceive an angel more beautiful.";
  const fillerBody =
    "Mr. Bingley danced twice. Everyone talked about Jane Bennet at the assembly. " +
    "Between him and Darcy there was a steady friendship. ".repeat(35);
  const doc = [
    "## Chapter Opinion\n\n" + answerBody,
    "## Chapter III\n\n" + fillerBody,
    "## Chapter IV\n\n" + fillerBody,
    "## Chapter VII\n\n" + fillerBody,
    "## Chapter VIII\n\n" + fillerBody,
    "## Chapter X\n\n" + fillerBody,
    "## Chapter XVI\n\n" + fillerBody,
    "## Chapter XVIII\n\n" + fillerBody,
    "## Chapter XX\n\n" + fillerBody,
    "## Chapter XXII\n\n" + fillerBody,
    "## Chapter XXVI\n\n" + fillerBody,
  ].join("\n\n");
  const chunks = chunkMarkdown(doc);
  const byHeading = (re: RegExp) => chunks.find((c) => re.test(c.breadcrumb))!;
  const answer = byHeading(/Opinion/);

  const raw = bm25Scores(task, chunks);
  const scores = new Map(chunks.map((c, i) => [c.id, raw[i]!]));
  const top = Math.max(...raw);
  for (const c of chunks) {
    if (c.id === answer.id) {
      scores.set(c.id, top);
      continue;
    }
    const rel = /Chapter (III|IV)\b/.test(c.breadcrumb) ? 0.76 : 0.93;
    scores.set(c.id, top * rel);
  }
  const ranked = [...chunks].sort((a, b) => (scores.get(b.id) ?? 0) - (scores.get(a.id) ?? 0));
  const queryTerms = tokenizeQuery(task);

  const at1000 = pack(
    ranked,
    1000,
    "pp.md",
    scores,
    queryTerms,
    undefined,
    true,
    "content",
    undefined,
    undefined,
    task
  );
  const at4000 = pack(
    ranked,
    4000,
    "pp.md",
    scores,
    queryTerms,
    undefined,
    true,
    "content",
    undefined,
    undefined,
    task
  );
  const at8000 = pack(
    ranked,
    8000,
    "pp.md",
    scores,
    queryTerms,
    undefined,
    true,
    "content",
    undefined,
    undefined,
    task
  );

  assert.ok(
    at1000.selected.some((c) => c.text.includes("angel more beautiful")),
    "1000 budget must include Bingley's opinion"
  );
  assert.ok(
    at4000.selected.some((c) => c.text.includes("angel more beautiful")),
    "4000 budget must include Bingley's opinion"
  );
  assert.ok(
    at8000.selected.some((c) => c.text.includes("angel more beautiful")),
    "8000 budget must include Bingley's opinion"
  );
  assert.ok(at4000.stopped_early, "4000 must set stopped_early once coverage met");
  assert.ok(at8000.stopped_early, "8000 must set stopped_early once coverage met");
  assert.ok(
    at8000.selected.length <= at1000.selected.length + 2,
    `8000 should stay compact: 1000→${at1000.selected.length}, 8000→${at8000.selected.length}`
  );
  assert.ok(
    at4000.selected.length <= at1000.selected.length + 2,
    `4000 should stay compact: 1000→${at1000.selected.length}, 4000→${at4000.selected.length}`
  );
  const tok1000 = countContentTokens(assemble("pp.md", at1000.selected, []));
  const tok4000 = countContentTokens(assemble("pp.md", at4000.selected, []));
  const tok8000 = countContentTokens(assemble("pp.md", at8000.selected, []));
  assert.ok(
    tok8000 <= tok1000 * 1.5 + 150,
    `8000 tokens (${tok8000}) should stay near 1000 case (${tok1000}), not fill budget`
  );
  assert.ok(
    tok4000 <= tok1000 * 1.5 + 150,
    `4000 tokens (${tok4000}) should stay near 1000 case (${tok1000}), not fill budget`
  );
  assert.ok(
    !at8000.selected.some((c) => /Chapter (III|IV)\b/.test(c.breadcrumb)),
    "weak Ch.III/IV padding must not be selected at 8000"
  );
  console.log(
    `  coverage Jane/Bingley ok: 1000→${at1000.selected.length} sel/${tok1000} tok, ` +
      `4000→${at4000.selected.length} sel/${tok4000} tok, ` +
      `8000→${at8000.selected.length} sel/${tok8000} tok, stopped_early=${at8000.stopped_early}`
  );
}

async function testClusterStopJaneBingleyPrideAndPrejudice() {
  const path = join(process.cwd(), "public", "samples", "pride-and-prejudice.docx");
  if (!existsSync(path)) {
    console.log("  cluster Jane/Bingley P&P skipped: sample docx not present");
    return;
  }
  const task = "What does Mr. Bingley think of Jane Bennet early on?";
  const at1000 = await compileContext(path, task, 1000, "Pride and Prejudice");
  const at8000 = await compileContext(path, task, 8000, "Pride and Prejudice");
  assert.ok(at1000.selected_sections.length >= 1, "1000 budget must select Bingley-adjacent context");
  assert.ok(/bingley/i.test(at1000.markdown), "1000 compile must mention Bingley");
  assert.ok(
    at8000.selected_sections.length <= at1000.selected_sections.length + 3,
    `8000 should stay compact vs 1000: ${at1000.selected_sections.length}→${at8000.selected_sections.length}`
  );
  assert.ok(
    at8000.tokens_used <= at1000.tokens_used * 3.5 + 200,
    `8000 tokens (${at8000.tokens_used}) should stay same order of magnitude as 1000 (${at1000.tokens_used})`
  );
  assert.ok(
    at8000.selected_sections.length < 8,
    `8000 must not vacuum Bingley-adjacent chapters: got ${at8000.selected_sections.length}`
  );
  assert.ok(
    at8000.compile_hints?.early_stopped || at8000.tokens_used < 5000,
    "8000 should early-stop or stay well under budget"
  );
  console.log(
    `  cluster Jane/Bingley P&P ok: 1000→${at1000.selected_sections.length} sel/${at1000.tokens_used} tok, ` +
      `8000→${at8000.selected_sections.length} sel/${at8000.tokens_used} tok, ` +
      `early_stopped=${at8000.compile_hints?.early_stopped ?? false}`
  );
}

async function testReserveDoesNotEvictFittingContent() {
  // Regression: an under-reserved budget let greedy content-fill overcommit,
  // forcing the eviction loop to drop a real, relevant, FITTING chunk and let
  // the manifest re-inflate with preview text in its place. Two facet-bearing
  // sections that together fit the budget must both survive when each adds
  // coverage the other lacks.
  const doc = [
    "## Alpha\n\nThe launch date for the rocket is set for March. ".repeat(30),
    "## Beta\n\nThe mission closing window ends March 31. " +
      "Launch clearance and window details are recorded here. ".repeat(28),
    ...Array.from(
      { length: 5 },
      (_, i) => `## Filler ${i}\n\n` + `Irrelevant boilerplate text ${i}. `.repeat(30)
    ),
  ].join("\n\n");
  const chunks = chunkMarkdown(doc);
  const task = "What is the rocket launch date, and when does the mission closing window end?";
  const queries = splitQueries(task);
  const rows = perQueryScores(queries, chunks);
  const ranked = rankMultiFromRows(rows, chunks, queries);
  const merged = multiScoresFromRows(rows, chunks);
  const scores = new Map(chunks.map((c, i) => [c.id, merged[i]!]));
  const matchMap = new Map(chunks.map((c, i) => [c.id, queryAttributionFromRows(rows, chunks)[i]!]));
  const queryBestIds = queryBestIdsFromRows(rows, chunks, queries);
  const queryTerms = tokenizeQuery(task);

  // Pick a budget just large enough to fit the top two relevant chunks
  // together (content beats a padded manifest — both must be kept).
  const top2 = [chunks[0]!, chunks[1]!];
  const top2Tokens = top2.reduce((s, c) => s + c.tokens, 0);
  const budget = top2Tokens + 400; // headroom for wrapper + a real (non-bloated) manifest
  const { selected } = pack(
    ranked,
    budget,
    "launch.md",
    scores,
    queryTerms,
    undefined,
    true,
    "full",
    matchMap,
    queryBestIds,
    task
  );
  const selectedIds = new Set(selected.map((c) => c.id));
  assert.ok(
    top2.every((c) => selectedIds.has(c.id)),
    `both facet sections should survive when they jointly fit: kept ${selected.length} of top 2`
  );
  console.log(
    "  reserve ok: two relevant, fitting chunks both kept instead of one evicted for manifest padding"
  );
}

async function testOversizedTopNotice() {
  // The single most relevant section is bigger than the budget. Policy B takes
  // a truncated partial (not weak fillers) and skips the oversized notice.
  const doc = [
    "## Small aside\n\nA brief unrelated note about scheduling and logistics.",
    "## Refund policy\n\n" +
      "Refunds are processed within 14 business days once the item is returned. " +
      "The refund policy has many detailed clauses and exceptions. ".repeat(40),
  ].join("\n\n");
  const chunks = chunkMarkdown(doc);
  const task = "What is the refund policy?";
  const ranked = rank(task, chunks);
  const scores = new Map(chunks.map((c, i) => [c.id, bm25Scores(task, chunks)[i]]));
  const refundId = chunks.find((c) => c.text.includes("14 business days"))!.id;

  const { text, selected } = pack(ranked, 200, "policy.md", scores);
  const partial = selected.find((c) => c.id === refundId);
  assert.ok(partial, "oversized top section should appear as a budget partial");
  assert.ok(partial!.truncated, "top section must be marked truncated");
  assert.ok(text.includes("14 business days"), "partial must include the answer lead");
  assert.ok(text.includes("truncated to budget"), "partial must carry an honest truncation marker");
  assert.ok(!text.includes("Most relevant"), "no oversized notice when top is partially included");
  assert.ok(countTokens(text) <= 200, `budget must hold with a partial: ${countTokens(text)}`);
  console.log("  oversized-top ok: tight budget gets a truncated top section, not weak fillers");
}

async function testRelevanceFirstPartialPacking() {
  // Meridian-style: one huge high-rel section + several small low-rel fillers.
  // Under a tight budget the packer must take a partial of the big section,
  // not skip it in favor of junk that happens to fit whole.
  const doc = [
    "## Meridian launch\n\n" +
      "The Meridian rocket launch date is March 15. Mission details and timeline follow. ".repeat(45),
    ...Array.from({ length: 4 }, (_, i) => `## Aside ${i}\n\n` + `Unrelated logistics note ${i}. `.repeat(8)),
  ].join("\n\n");
  const chunks = chunkMarkdown(doc);
  const task = "When is the Meridian rocket launch date?";
  const ranked = rank(task, chunks);
  const scores = new Map(chunks.map((c, i) => [c.id, bm25Scores(task, chunks)[i]]));
  const top = ranked[0]!;
  assert.ok(top.text.includes("March 15"), "top ranked should be Meridian launch");

  const budget = 250;
  const { text, selected } = pack(ranked, budget, "meridian.md", scores);
  const topSel = selected.find((c) => c.id === top.id);
  assert.ok(topSel, "high-relevance section must be selected as a partial, not skipped");
  assert.ok(topSel!.truncated, "selection should be truncated under this budget");
  assert.ok(text.includes("March 15") || text.includes("Meridian"), "partial must surface the answer");
  assert.ok(
    selected.every((c) => c.id === top.id || (scores.get(c.id) ?? 0) >= (scores.get(top.id) ?? 0) * 0.4),
    "must not pack weak fillers instead of the top partial"
  );
  assert.ok(countTokens(text) <= budget, `assembled output must respect budget: ${countTokens(text)}`);
  console.log("  relevance-first partial ok: truncated top beats small low-rel fillers");
}

async function testBm25FirstPackingDespiteDemotion() {
  // Regression: LLM (or any) order that puts many small sections ahead of the
  // BM25 top hit can fill the budget and omit a fitting 100%-relevant section.
  // Packing must try highest BM25 score first (pipeline sorts before pack).
  const doc = [
    "## Tiny A\n\nKing of Bohemia mentioned once in passing.",
    "## Tiny B\n\nKing of Bohemia mentioned once in passing.",
    "## Tiny C\n\nKing of Bohemia mentioned once in passing.",
    "## Tiny D\n\nKing of Bohemia mentioned once in passing.",
    "## Scandal\n\n" +
      "The King of Bohemia comes to Sherlock Holmes because Irene Adler has a " +
      "photograph that could compromise his forthcoming marriage. ".repeat(35),
    "## Other case\n\n" + "A red-headed league and a bank tunnel distraction fill this chapter. ".repeat(35),
  ].join("\n\n");
  const chunks = chunkMarkdown(doc);
  const task = "Why does the King of Bohemia come to Sherlock Holmes?";
  const scoresArr = bm25Scores(task, chunks);
  const scores = new Map(chunks.map((c, i) => [c.id, scoresArr[i]!]));
  const byScore = [...chunks].sort((a, b) => (scores.get(b.id) ?? 0) - (scores.get(a.id) ?? 0));
  const top = byScore[0]!;
  assert.ok(top.text.includes("Irene Adler"), `top BM25 should be Scandal, got ${top.breadcrumb}`);

  // Demote the top hit to the end (simulates a demoted fill order).
  const demoted = [...byScore.filter((c) => c.id !== top.id), top];
  const budget = top.tokens + 400; // room for top + a few tinies, not all tinies + other
  const starved = pack(demoted, budget, "bohemia.md");
  const starvedTop = starved.selected.find((c) => c.id === top.id);
  assert.ok(
    !starvedTop || starvedTop.truncated,
    "demoted fill order must not take the full top section ahead of tinies without BM25 reorder"
  );

  const rankPos = new Map(demoted.map((c, i) => [c.id, i]));
  const packOrder = [...demoted].sort((a, b) => {
    const d = (scores.get(b.id) ?? 0) - (scores.get(a.id) ?? 0);
    if (d !== 0) return d;
    return (rankPos.get(a.id) ?? 0) - (rankPos.get(b.id) ?? 0);
  });
  const fixed = pack(packOrder, budget, "bohemia.md", scores);
  assert.ok(
    fixed.selected.some((c) => c.id === top.id),
    "BM25-first pack order must keep the top-scoring section when it fits"
  );
  console.log("  bm25-first pack ok: demoted top hit still selected when it fits the budget");
}

async function testNextSectionHint() {
  // Spare room left → not budget-bound → no hint.
  assert.equal(
    nextSectionHint(2000, 1000, [{ id: "s1", section: "A > B", tokens: 500, relevance: 80 }]),
    null,
    "plenty of spare budget → no hint"
  );

  // Budget-bound but only weak leftovers → no hint.
  assert.equal(
    nextSectionHint(1150, 1130, [{ id: "s1", section: "A > B", tokens: 500, relevance: 29 }]),
    null,
    "weak omitted section → no hint"
  );

  // Budget-bound + strong omitted that doesn't fit → concrete suggested budget.
  const hint = nextSectionHint(1150, 1137, [
    { id: "s18", section: "Doc > I", tokens: 773, relevance: 81 },
    { id: "s31", section: "Doc > Ii", tokens: 748, relevance: 79 },
  ]);
  assert.ok(hint, "expected a next-section hint");
  assert.equal(hint!.id, "s18");
  assert.equal(hint!.relevance, 81);
  assert.equal(hint!.suggested_budget, 2000);

  // Budget-bound + truncated selected section → hint to finish it.
  const partialHint = nextSectionHint(
    400,
    390,
    [],
    [{ id: "s0", section: "Doc > Launch", tokens: 120, full_tokens: 800, relevance: 95, truncated: true }]
  );
  assert.ok(partialHint, "truncated selected section should produce a hint");
  assert.equal(partialHint!.id, "s0");
  assert.equal(partialHint!.tokens, 800);
  assert.ok(partialHint!.suggested_budget > 400, "suggested budget should cover the remainder");

  // End-to-end: Sherlock @ 1150 — hint when budget-bound; no hint when stopped early.
  const sherlock = join(process.cwd(), "public", "samples", "sherlock-holmes.docx");
  if (existsSync(sherlock)) {
    const r = await compileContext(sherlock, "Why does the King of Bohemia come to Sherlock Holmes?", 1150);
    if (r.compile_hints?.early_stopped) {
      const spare = r.token_budget - r.tokens_used;
      const budgetBound = spare < r.token_budget * 0.12;
      if (!budgetBound) {
        assert.equal(
          r.next_section_hint,
          null,
          "Sherlock@1150 early-stopped with headroom → no next-section hint"
        );
        console.log(
          `  next-section hint ok: unit + Sherlock@1150 early-stopped (${r.tokens_used}/${r.token_budget} tok)`
        );
      } else if (r.next_section_hint) {
        assert.ok((r.next_section_hint.relevance ?? 0) >= 40, "budget-bound hint should be high-relevance");
        console.log(
          `  next-section hint ok: unit + Sherlock@1150 early-stopped+budget-bound → ${r.next_section_hint.id}`
        );
      } else {
        console.log(
          `  next-section hint ok: unit + Sherlock@1150 early-stopped+budget-bound (no strong omitted)`
        );
      }
    } else {
      assert.ok(r.next_section_hint, "Sherlock@1150 should hint at the next strong omitted section");
      assert.ok((r.next_section_hint!.relevance ?? 0) >= 40, "hinted section should be high-relevance");
      assert.ok(
        r.next_section_hint!.suggested_budget > r.token_budget,
        "suggested budget must exceed the current one"
      );
      console.log(
        `  next-section hint ok: unit + Sherlock@1150 → ${r.next_section_hint!.id} ` +
          `(raise to ~${r.next_section_hint!.suggested_budget})`
      );
    }
  } else {
    console.log("  next-section hint ok: unit cases (Sherlock sample not present, skipped e2e)");
  }
}

async function testRelevanceFloorDropsWeakToc() {
  const sherlock = join(process.cwd(), "public", "samples", "sherlock-holmes.docx");
  if (!existsSync(sherlock)) {
    console.log("  relevance-floor toc ok: skipped (no Sherlock sample)");
    return;
  }
  const r = await compileContext(sherlock, "Why does the King of Bohemia come to Sherlock Holmes?", 2000);
  const weak = r.selected_sections.filter((s) => (s.relevance ?? 0) < 40);
  assert.equal(
    weak.length,
    0,
    `floor 0.4 should drop <40% TOC noise, got: ${weak.map((s) => s.id + "@" + s.relevance).join(", ")}`
  );
  assert.ok(
    r.selected_sections.some((s) => (s.relevance ?? 0) >= 80),
    "strong Bohemia sections should still be selected"
  );
  console.log(`  relevance-floor toc ok: ${r.selected_sections.length} sections, all ≥40% relevance`);
}

async function testMultiQuery() {
  // splitQueries: separators and single-question passthrough.
  assert.deepEqual(
    splitQueries("What voids the warranty? Can it fly in rain?"),
    ["What voids the warranty?", "Can it fly in rain?"],
    "splits on question boundaries"
  );
  assert.equal(splitQueries("just one question about payment").length, 1, "single query passes through");
  assert.equal(splitQueries("net profit; gross margin; revenue growth").length, 3, "splits on semicolons");
  assert.ok(splitQueries("What about batteries and air travel?").length === 1, "does not split on 'and'");
  assert.equal(
    splitQueries("What was net profit in FY25, and which quarter had the best gross margin?").length,
    2,
    "splits comma+and multi-facet asks"
  );

  // Two questions whose answers live in different, distant sections. A single
  // blended query can starve one; round-robin must surface BOTH.
  const doc = [
    "# Manual",
    "## Warranty\n\n" + "Dropping the unit in water voids the warranty immediately. ".repeat(20),
    ...Array.from(
      { length: 10 },
      (_, i) => `## Filler ${i}\n\n` + `Unrelated boilerplate paragraph ${i}. `.repeat(20)
    ),
    "## Weather\n\n" + "The drone must not be flown in rain; moisture damages the rotors. ".repeat(20),
  ].join("\n\n");
  const chunks = chunkMarkdown(doc);
  const queries = splitQueries("What voids the warranty? Can it fly in rain?");
  const ranked = rankMulti(queries, chunks);
  const { text } = pack(ranked, 1200, "manual.md");
  assert.ok(text.includes("voids the warranty"), "warranty answer present");
  assert.ok(text.includes("flown in rain"), "rain answer present");

  // Attribution: best-match first. The warranty section leads with Q0, the
  // weather section with Q1.
  const attr = queryAttribution(queries, chunks);
  const warrantyIdx = chunks.findIndex((c) => c.text.includes("voids the warranty"));
  const rainIdx = chunks.findIndex((c) => c.text.includes("flown in rain"));
  assert.equal(attr[warrantyIdx][0], 0, "warranty section best-answers Q1");
  assert.equal(attr[rainIdx][0], 1, "weather section best-answers Q2");

  // A section relevant to two questions lists both. Build a chunk that
  // mentions both keywords and confirm attribution returns both indices.
  const shared = chunkMarkdown(
    "## Overview\n\n" + "The warranty terms and the rain-resistance rating are both listed here. ".repeat(15)
  );
  const sharedAttr = queryAttribution(queries, shared);
  assert.ok(sharedAttr[0].length >= 2, "a dual-topic section is attributed to both questions");

  // Regression: shared tokens (FY25, financial tables) must not badge Quarterly
  // with Q1 when net profit lives only in Five-Year Summary. Budget-200-sized
  // text pushes Quarterly's Q1 score to ~0.41 (clears pack floor) but not
  // near-top — the false [Q2][Q1] badge the UI showed before this fix.
  const finDoc = [
    "# Meridian Financials",
    "## Five-Year Summary\n\n" + "FY25 net profit was $412M, up 8% year over year. ".repeat(8),
    "## Segments FY25\n\n" + "Segment revenue breakdown for FY25 by business line. ".repeat(6),
    "## Quarterly FY25\n\n" +
      "Gross margin by quarter: Q1 24%, Q2 26%, Q3 28%, Q4 31%. Q4 had the best gross margin. ".repeat(3),
  ].join("\n\n");
  const finChunks = chunkMarkdown(finDoc);
  const finTask = "What was net profit in FY25, and which quarter had the best gross margin?";
  const finQueries = splitQueries(finTask);
  const finAttr = queryAttribution(finQueries, finChunks);
  const fiveYearIdx = finChunks.findIndex((c) => c.text.includes("net profit"));
  const quarterlyIdx = finChunks.findIndex((c) => c.text.includes("Gross margin"));
  assert.ok(fiveYearIdx >= 0 && quarterlyIdx >= 0, "financials fixture chunks found");
  assert.ok(finAttr[fiveYearIdx]!.includes(0), "Five-Year answers Q1 (net profit)");
  assert.ok(
    !finAttr[quarterlyIdx]!.includes(0),
    "Quarterly must not badge Q1 (weak FY25 overlap, no net profit)"
  );
  assert.ok(finAttr[quarterlyIdx]!.includes(1), "Quarterly answers Q2 (gross margin)");

  console.log("  multi-query ok: split + round-robin + multi-question attribution");
}

function testQueryAspects() {
  assert.equal(splitTaskAspects("just one question about payment").length, 1);
  assert.ok(!isMultiPartTask("What about batteries and air travel?"));
  assert.ok(isMultiPartTask("What was net profit in FY25, and which quarter had the best gross margin?"));
  assert.deepEqual(splitTaskAspects("What voids the warranty? Can it fly in rain?"), [
    "What voids the warranty?",
    "Can it fly in rain?",
  ]);
  assert.equal(splitTaskAspects("net profit; gross margin").length, 2);
  // Multilingual conjunctions + Unicode-safe question-word starts (\\b fails on Devanagari).
  assert.ok(isMultiPartTask("ईमानदार चायवाले को क्या मिला, और आम का पेड़ किसके हिस्से आया?"));
  assert.ok(isMultiPartTask("¿Qué encontró el panadero, y qué preguntaba el último examen de la maestra?"));
  assert.ok(isMultiPartTask("Что нашёл извозчик, и какой вопрос был на последнем экзамене?"));
  assert.ok(isMultiPartTask("ماذا وجد الخبّاز، وما السؤال في امتحان المعلّمة الأخير؟"));
  assert.equal(splitTaskAspects("ईमानदार चायवाले को क्या मिला, और आम का पेड़ किसके हिस्से आया?").length, 2);
  console.log("  query-aspects ok: guarded and-split + hard separators + multilingual");
}

function testCompileNotes() {
  const base = {
    reduction_pct: 40,
    token_budget: 2000,
    tokens_used: 1200,
    queries: ["net profit FY25", "best gross margin quarter"],
    selected_sections: [{ id: "s1", section: "Doc > Quarterly", tokens: 800, relevance: 100 }],
    omitted_sections: [{ id: "s2", section: "Doc > Five-Year Summary", tokens: 600, relevance: 38 }],
    next_section_hint: null,
  };
  const hints = compileNoteHints(base);
  assert.ok(hints.multi_part_nudge, "multi-part + omitted → nudge");
  assert.ok(hints.omit_action, "omitted under budget → actionable omit");
  assert.equal(hints.named_omit?.id, "s2", "names top omitted section");
  assert.ok(MULTI_PART_NUDGE_TEXT.includes("more than one section"));
  const whole = compileNoteHints({ ...base, reduction_pct: 0, omitted_sections: [] });
  assert.ok(!whole.multi_part_nudge, "whole file → no nudge");

  const truncatedFloor = budgetBoundHintBodyPlain({
    token_budget: 1000,
    next_section_hint: {
      id: "s21",
      section: "Pride > Chapter V",
      tokens: 1400,
      relevance: 100,
      suggested_budget: 1400,
    },
    selected_sections: [{ id: "s21", truncated: true }],
    budget_omitted_sections: [],
    relevance_omitted_sections: [{ id: "s3" }],
  });
  assert.ok(
    truncatedFloor.includes("Peek rest") && truncatedFloor.includes("Include rest in Prove"),
    "truncated selected hint must point at Included card actions"
  );
  assert.ok(
    !budgetBoundHintMentionsExpand({
      token_budget: 1000,
      next_section_hint: {
        id: "s21",
        section: "Pride > Chapter V",
        tokens: 1400,
        relevance: 100,
        suggested_budget: 1400,
      },
      selected_sections: [{ id: "s21", truncated: true }],
    }),
    "truncated selected must not mention expand_section"
  );
  assert.ok(!truncatedFloor.includes("expand_section"), "truncated floor copy must not name expand_section");

  const earlyHints = compileNoteHints({
    ...base,
    early_stopped: true,
    tokens_used: 500,
    next_section_hint: null,
  });
  assert.ok(earlyHints.early_stopped, "pack early_stopped → compile hint");
  assert.ok(EARLY_STOPPED_FLOOR_TEXT.includes("Packed enough"), "coverage-complete floor copy");

  const omittedWithChip = budgetBoundHintBodyPlain({
    token_budget: 1150,
    next_section_hint: {
      id: "s18",
      section: "Doc > I",
      tokens: 773,
      relevance: 81,
      suggested_budget: 2000,
    },
    selected_sections: [{ id: "s0" }],
    budget_omitted_sections: [{ id: "s18" }],
  });
  assert.ok(omittedWithChip.includes("expand_section (s18)"), "omitted hint with chip keeps expand_section");

  console.log("  compile-notes ok: multi-part nudge + omit-action + budget-bound floor copy");
}

function testOmitBucketClassification() {
  const multi = classifyOmitBuckets({
    token_budget: 200,
    tokens_used: 185,
    queries: ["net profit FY25", "best gross margin quarter"],
    selected_sections: [
      {
        id: "s2",
        section: "Doc > Quarterly FY25",
        tokens: 120,
        relevance: 100,
        matched_queries: [1],
      },
    ],
    omitted_sections: [
      {
        id: "s0",
        section: "Doc > Five-Year Summary",
        tokens: 180,
        relevance: 95,
        matched_queries: [0],
      },
      {
        id: "s1",
        section: "Doc > Segments FY25",
        tokens: 90,
        relevance: 43,
      },
    ],
    next_section_hint: null,
    query_best_ids: ["s0", "s2"],
  });
  assert.equal(multi.budget_omitted_sections.length, 1, "Five-Year gaps uncovered Q1");
  assert.equal(multi.budget_omitted_sections[0]!.id, "s0");
  assert.deepEqual(multi.budget_omitted_sections[0]!.gap_queries, [0]);
  assert.equal(multi.relevance_omitted_sections.length, 1, "Segments is lower-rel omit");
  assert.equal(multi.relevance_omitted_sections[0]!.id, "s1");

  const single = classifyOmitBuckets({
    token_budget: 200,
    tokens_used: 180,
    queries: ["What is the refund policy?"],
    selected_sections: [{ id: "s0", section: "Doc > Small", tokens: 50, relevance: 25 }],
    omitted_sections: [
      { id: "s1", section: "Doc > Refund", tokens: 500, relevance: 100 },
      { id: "s2", section: "Doc > Other", tokens: 40, relevance: 15 },
    ],
    next_section_hint: {
      id: "s1",
      section: "Doc > Refund",
      tokens: 500,
      relevance: 100,
      suggested_budget: 700,
    },
  });
  assert.equal(single.budget_omitted_sections.length, 1);
  assert.equal(single.budget_omitted_sections[0]!.id, "s1");
  assert.equal(single.budget_omitted_sections[0]!.suggested_budget, 700);
  assert.equal(single.relevance_omitted_sections[0]!.id, "s2");
  console.log("  omit-buckets ok: aspect gaps + oversized-top single-query");
}

async function testMultiFacetFinancials() {
  // Meridian-style: net profit in Five-Year Summary, gross margin in Quarterly FY25.
  const doc = [
    "# Meridian Financials",
    "## Five-Year Summary\n\n" +
      "FY25 net profit was $412M, up 8% year over year. Revenue and margin trends follow. ".repeat(25),
    ...Array.from(
      { length: 8 },
      (_, i) => `## Filler ${i}\n\n` + `General corporate overview paragraph ${i}. `.repeat(18)
    ),
    "## Quarterly FY25\n\n" +
      "Gross margin by quarter: Q1 24%, Q2 26%, Q3 28%, Q4 31%. Q4 had the best gross margin. ".repeat(22),
  ].join("\n\n");
  const path = testTmpPath(`meridian-fin-${Date.now()}.md`);
  writeFileSync(path, doc);
  try {
    const task = "What was net profit in FY25, and which quarter had the best gross margin?";
    assert.equal(splitQueries(task).length, 2, "task splits into two facets");

    const r = await compileContext(path, task, 800);
    assert.ok(r.reduction_pct > 0, "should compile under budget");
    assert.ok(r.queries.length >= 2, "pipeline uses multi-aspect queries");

    const hasNetProfit = r.markdown.includes("$412M") || r.markdown.includes("412M");
    const hasGrossMargin =
      r.markdown.includes("Gross margin") || r.markdown.includes("gross margin") || r.markdown.includes("Q4");
    assert.ok(hasNetProfit, "compiled context must include FY25 net profit facet");
    assert.ok(hasGrossMargin, "compiled context must include gross margin facet");

    const fiveYearSelected = r.selected_sections.some((s) => s.section.includes("Five-Year"));
    const quarterlySelected = r.selected_sections.some((s) => s.section.includes("Quarterly"));
    assert.ok(
      fiveYearSelected && quarterlySelected,
      "round-robin should select both facet sections at this budget (old single-query kept only Quarterly)"
    );

    assert.ok(r.compile_hints.multi_part_nudge || r.omitted_sections.length > 0, "hints or omits tracked");
    if (r.omitted_sections.length > 0) {
      assert.ok(r.compile_hints.omit_action, "omitted sections get actionable framing");
    }
    console.log(
      `  multi-facet financials ok: ${r.selected_sections.length} selected, ` +
        `net=${hasNetProfit} margin=${hasGrossMargin}`
    );
  } finally {
    unlinkSync(path);
  }
}

async function testMultiFacetFinancialsBudget200() {
  // Unified compile packing: at budget 200, query-aware partial of Five-Year
  // (net profit facet) plus whole Quarterly (gross margin) — same intelligence
  // as agent repack, without requiring an expand step.
  const doc = meridianNetProfitAtEndDoc();
  const path = testTmpPath(`meridian-fin-200-${Date.now()}.md`);
  writeFileSync(path, doc);
  try {
    const task = "What was net profit in FY25, and which quarter had the best gross margin?";
    const r = await compileContext(path, task, 200);

    const fiveYearSel = r.selected_sections.find((s) => s.section.includes("Five-Year"));
    const quarterlySelected = r.selected_sections.some((s) => s.section.includes("Quarterly"));
    const segmentsSelected = r.selected_sections.some((s) => s.section.includes("Segments"));

    assert.ok(fiveYearSel, "Five-Year must be included as a query-aware partial at budget 200");
    assert.ok(fiveYearSel!.truncated, "Five-Year should be truncated, not whole");
    assert.ok(
      (fiveYearSel!.remainder_tokens ?? 0) > 0,
      "truncated Five-Year must expose remainder_tokens for Prove Include rest"
    );
    assert.ok(quarterlySelected, "Quarterly FY25 facet must be included whole at budget 200");
    assert.ok(!segmentsSelected, "weak Segments must not be selected at this budget");

    assert.ok(
      !r.budget_omitted_sections?.some((s) => s.section.includes("Five-Year")),
      "Five-Year with a useful partial is Included, not budget-omit"
    );
    assert.ok(
      r.relevance_omitted_sections?.some((s) => s.section.includes("Segments")),
      "Segments should be in relevance-omit bucket"
    );
    assert.ok(
      !r.relevance_omitted_sections?.some((s) => s.section.includes("Five-Year")),
      "Five-Year must not appear in relevance-omit bucket"
    );

    assert.ok(r.markdown.includes("51.0"), "compiled context must include net profit facet (51.0)");
    const hasGrossMargin =
      r.markdown.includes("Gross margin") ||
      r.markdown.includes("gross margin") ||
      r.markdown.includes("35.1");
    assert.ok(hasGrossMargin, "compiled context must include gross-margin facet content");

    assert.ok(r.tokens_used <= 200, `content budget must hold: ${r.tokens_used}`);
    assert.ok(
      r.selected_sections.some((s) => s.text && s.text.length > 0),
      "selected sections must carry text for the UI cards"
    );
    const quarterlySel = r.selected_sections.find((s) => s.section.includes("Quarterly"));
    assert.ok(quarterlySel, "Quarterly FY25 facet must be included whole at budget 200");
    assert.equal(quarterlySel!.relevance, 100, "Quarterly is a same-relevance peer to the top facet");
    assert.ok(
      !r.markdown.includes("Most relevant"),
      "no oversized notice when a same-relevance peer is selected"
    );
    console.log(
      `  multi-facet budget-200 ok: ${r.selected_sections.length} selected, ` +
        `fiveYear_trunc=${fiveYearSel!.truncated}, quarterly=${quarterlySelected}, tokens=${r.tokens_used}`
    );
  } finally {
    unlinkSync(path);
  }
}

async function testMultiFacetFinancialsBudget800() {
  // Early-stop must not starve uncovered facets. Pad the doc so the whole file
  // does not fit — packing runs — then both facets must still land while clear
  // padding fillers stay out.
  const weakFillers = Array.from(
    { length: 12 },
    (_, i) =>
      `## Appendix note ${i}\n\n` + `Generic appendix boilerplate ${i} with no financial metrics. `.repeat(20)
  ).join("\n\n");
  const doc = meridianNetProfitAtEndDoc() + "\n\n" + weakFillers;
  const path = testTmpPath(`meridian-fin-800-${Date.now()}.md`);
  writeFileSync(path, doc);
  try {
    const task = "What was net profit in FY25, and which quarter had the best gross margin?";
    const r = await compileContext(path, task, 800);

    const fiveYearSel = r.selected_sections.find((s) => s.section.includes("Five-Year"));
    const quarterlySel = r.selected_sections.find((s) => s.section.includes("Quarterly"));
    assert.ok(fiveYearSel, "Five-Year facet must be included at budget 800");
    assert.ok(quarterlySel, "Quarterly facet must be included at budget 800 (early-stop must not starve Q2)");
    assert.ok(
      !r.selected_sections.some((s) => /Appendix note/i.test(s.section)),
      "clear padding appendix fillers must not be packed just to fill budget"
    );
    assert.ok(r.markdown.includes("51.0"), "net profit facet in markdown");
    assert.ok(
      r.markdown.includes("35.1") || r.markdown.toLowerCase().includes("gross margin"),
      "gross margin facet in markdown"
    );
    console.log(
      `  multi-facet budget-800 ok: ${r.selected_sections.length} selected, tokens=${r.tokens_used}, ` +
        `early_stopped=${r.compile_hints?.early_stopped ?? false}`
    );
  } finally {
    unlinkSync(path);
  }
}

async function testDemoParityFy25Budget200() {
  /*
   * Demo parity checklist (Meridian FY25 @ budget 200 — same path on Compile / Prove / Agent):
   * 1. Compile → tokens_used ≈ selected_content_tokens; both facets in markdown/cards
   * 2. Prove (no Include) → context_tokens ≈ compile substance, not manifest-inflated
   * 3. Agent → tokens_read / final_context_tokens ≈ compile when answering without expand
   * 4. Badges → Quarterly [Q2] only (no fake [Q1] on gross-margin section)
   * 5. Buckets → Five-Year Included (truncated), not budget-omit
   * 6. Soft ceiling → agent tokens_read ≤ 200 (+small slack)
   */
  const BUDGET = 200;
  const TOKEN_SLACK = 5;
  const PARITY_SLACK = 2;
  const task = "What was net profit in FY25, and which quarter had the best gross margin?";
  const doc = meridianNetProfitAtEndDoc();
  const path = testTmpPath(`demo-parity-fy25-200-${Date.now()}.md`);
  writeFileSync(path, doc);
  try {
    const compiled = await compileContext(path, task, BUDGET, "meridian.md");

    // 1. Compile metering + facet content
    assert.ok(compiled.tokens_used <= BUDGET, `compile content budget: ${compiled.tokens_used}`);
    assert.ok(
      Math.abs(compiled.tokens_used - compiled.selected_content_tokens) <= PARITY_SLACK,
      `tokens_used (${compiled.tokens_used}) ≈ selected_content_tokens (${compiled.selected_content_tokens})`
    );
    assert.ok(compiled.markdown.includes("51.0"), "compile markdown includes net profit (51.0)");
    assert.ok(
      compiled.markdown.includes("35.1") || /gross margin/i.test(compiled.markdown),
      "compile markdown includes gross-margin facet"
    );

    const fiveYearSel = compiled.selected_sections.find((s) => s.section.includes("Five-Year"));
    const quarterlySel = compiled.selected_sections.find((s) => s.section.includes("Quarterly"));
    assert.ok(fiveYearSel?.truncated, "Five-Year included as query-aware partial");
    assert.ok(quarterlySel, "Quarterly FY25 included whole");
    assert.ok(fiveYearSel!.text?.includes("51.0"), "Five-Year card text includes net profit");
    assert.ok(
      quarterlySel!.text?.includes("35.1") || /gross margin/i.test(quarterlySel!.text ?? ""),
      "Quarterly card text includes gross margin"
    );

    // 5. Badges — Quarterly must not fake-tag Q1 (net profit lives in Five-Year)
    assert.ok(quarterlySel!.matched_queries?.includes(1), "Quarterly badges Q2 (gross margin)");
    assert.ok(
      !quarterlySel!.matched_queries?.includes(0),
      "Quarterly must not badge Q1 (weak FY25 overlap, no net profit)"
    );
    const finChunks = chunkMarkdown(doc);
    const finQueries = splitQueries(task);
    const finAttr = queryAttribution(finQueries, finChunks);
    const quarterlyIdx = finChunks.findIndex((c) => c.text.includes("Gross margin"));
    assert.ok(!finAttr[quarterlyIdx]!.includes(0), "attribution: Quarterly must not answer net-profit facet");

    // 6. Omit buckets — truncated Five-Year is Included, not budget-omit
    assert.ok(
      !compiled.budget_omitted_sections?.some((s) => s.section.includes("Five-Year")),
      "Five-Year with useful partial is Included, not budget-omit"
    );
    assert.ok(
      compiled.relevance_omitted_sections?.some((s) => s.section.includes("Segments")),
      "weak Segments stays relevance-omit"
    );

    // 2. Prove (no Include) matches compile substance, not manifest ballast
    const { markdown: proveMarkdown, expandContentTokens } = await assembleProveContext(
      path,
      compiled,
      [],
      "meridian.md"
    );
    assert.equal(expandContentTokens, 0);
    const proveContent = countContentTokens(proveMarkdown);
    assert.ok(
      Math.abs(proveContent - compiled.selected_content_tokens) <= PARITY_SLACK,
      `Prove (${proveContent}) ≈ selected_content_tokens (${compiled.selected_content_tokens})`
    );
    assert.ok(
      Math.abs(proveContent - compiled.tokens_used) <= PARITY_SLACK,
      `Prove (${proveContent}) ≈ tokens_used (${compiled.tokens_used})`
    );
    const manifestInflated = countContentTokens(compiled.markdown);
    assert.ok(
      manifestInflated > proveContent + 15,
      `compile markdown with manifest (${manifestInflated}) must not inflate Prove (${proveContent})`
    );
    assert.ok(!proveMarkdown.includes("Sections omitted"), "Prove ships substance only");

    // 3 + 7. Agent answers from compile; tokens_read / final_context_tokens ≈ compile
    let decideContext = "";
    const mock: (p: string) => Promise<string> = async (prompt) => {
      if (/ONLY a JSON object/.test(prompt)) {
        const ctx = (prompt.match(/<context>\n([\s\S]*)\n<\/context>/) ?? [])[1] ?? "";
        decideContext = ctx;
        if (ctx.includes("51.0")) {
          return JSON.stringify({ action: "answer", reasoning: "compile already has both facets" });
        }
        return JSON.stringify({ action: "answer", reasoning: "best effort" });
      }
      return "FY25 net profit was 51.0. Q4 had the best gross margin at 35.1%.";
    };
    const { runAgent } = await import("../agent.js");
    const agent = await runAgent(path, task, {
      startBudget: BUDGET,
      tokenCeiling: BUDGET,
      complete: (p) => mock(p),
      sourceName: "meridian.md",
    });

    assert.equal(agent.stopped_reason, "confident", "agent answers from unified compile pack");
    assert.ok(agent.tokens_read <= BUDGET + TOKEN_SLACK, `agent soft ceiling: ${agent.tokens_read}`);
    assert.ok(
      Math.abs(agent.tokens_read - compiled.selected_content_tokens) <= PARITY_SLACK,
      `agent tokens_read (${agent.tokens_read}) ≈ compile (${compiled.selected_content_tokens})`
    );
    assert.ok(
      Math.abs(agent.final_context_tokens - compiled.selected_content_tokens) <= PARITY_SLACK,
      `agent final_context_tokens (${agent.final_context_tokens}) ≈ compile (${compiled.selected_content_tokens})`
    );
    assert.equal(
      agent.final_context_tokens,
      countContentTokens(agent.final_context ?? ""),
      "final_context_tokens meters final_context substance"
    );
    assert.ok(agent.final_context?.includes("51.0"), "agent final context includes net profit");
    assert.ok(agent.final_context?.includes("35.1"), "agent final context includes gross margin");
    assert.ok(!agent.final_context?.includes("Sections omitted"), "agent answer context omits manifest");
    assert.ok(
      !decideContext.includes("Sections omitted"),
      "agent decide <context> must be substance-only (manifest listed separately)"
    );
    const manifestInflatedAgent = countContentTokens(compiled.markdown);
    assert.ok(
      manifestInflatedAgent > agent.final_context_tokens + 15,
      `agent parity must not use manifest-inflated compile markdown (${manifestInflatedAgent} vs ${agent.final_context_tokens})`
    );

    console.log(
      `  demo parity FY25@200 ok: compile=${compiled.tokens_used} prove=${proveContent} ` +
        `agent_read=${agent.tokens_read} agent_final=${agent.final_context_tokens}`
    );
  } finally {
    unlinkSync(path);
  }
}

function meridianNetProfitAtEndDoc(): string {
  const filler = Array.from(
    { length: 40 },
    (_, i) => `FY${21 + (i % 5)} revenue and operating metrics row ${i} with extended commentary.`
  ).join("\n");
  return [
    "# Meridian Financials",
    "## Five-Year Summary\n\n" + filler + "\nNet profit | 51.0 | FY25",
    "## Segments FY25\n\n" + "Segment revenue breakdown for FY25 by business line. ".repeat(6),
    "## Quarterly FY25\n\n" +
      "Gross margin by quarter: Q1 24%, Q2 26%, Q3 28%, Q4 35.1%. Q4 had the best gross margin. ".repeat(3),
  ].join("\n\n");
}

function queryMissAgentDoc(): string {
  // Huge matching line with the needle at the end: query-aware truncate keeps the
  // line start under tiny headroom, then shrinks and drops WORDZXQ9 → query_miss.
  const hugeNeedleLine = "x".repeat(2000) + " WORDZXQ9";
  const filler = "Regional metrics narrative. ".repeat(80);
  return [
    "# Filing",
    "## Overview\n\nShort overview without the secret code.",
    "## Liability schedule\n\n" + filler + "\n\n" + hugeNeedleLine,
  ].join("\n\n");
}

function testClientUxContracts() {
  assert.equal(LAYOUT_FRAMES_BEFORE_SCROLL, 2, "first-compile scroll waits two layout frames");

  assert.ok(isNearVisibleRect({ top: 10, bottom: 200 }, 800), "mid-viewport rect is near-visible");
  assert.ok(!isNearVisibleRect({ top: 900, bottom: 1100 }, 800), "below-fold rect is not near-visible");
  assert.ok(shouldScrollIntoView({ top: 900, bottom: 1100 }, 800), "scroll when off-screen");
  assert.ok(!shouldScrollIntoView({ top: 10, bottom: 200 }, 800), "skip scroll when already visible");

  assert.equal(shouldRemovePeekOnUncheck(), false, "unchecking Prove Include must not imply peek removal");
  assert.equal(shouldClearAgentOnCompile(), true, "new compile must hide stale agent panel");
  assert.equal(shouldClearResultsOnDocChange(), true, "doc change must hide compile results");
  assert.equal(
    shouldShowAgentSecIdle({
      hasCompiledOnce: true,
      resultsVisible: true,
      questionStale: false,
      budgetStale: false,
    }),
    true,
    "fresh compile with results → idle agent section"
  );
  assert.equal(
    shouldShowAgentSecIdle({
      hasCompiledOnce: true,
      resultsVisible: true,
      questionStale: true,
      budgetStale: false,
    }),
    false,
    "question-stale hides idle agent section"
  );
  assert.equal(
    shouldShowAgentSecIdle({
      hasCompiledOnce: true,
      resultsVisible: false,
      questionStale: false,
      budgetStale: false,
    }),
    false,
    "no results on screen → hide idle agent section"
  );
  assert.ok(questionStaleBannerHtml().includes("Question changed"), "question-stale banner names the edit");
  assert.equal(
    shouldDisableProveAgentWhenQuestionStale(true, "Q1", "Q2"),
    true,
    "edited task disables Prove/Agent until recompile"
  );
  assert.equal(
    shouldDisableProveAgentWhenQuestionStale(true, "Q1", "Q1"),
    false,
    "matching task keeps Prove/Agent enabled"
  );
  assert.equal(
    shouldDisableProveAgentWhenQuestionStale(false, "Q1", "Q2"),
    false,
    "no prior compile → no question-stale lockout"
  );
  assert.equal(
    shouldDisableProveWhenBudgetStale(true, 4000, 8000),
    true,
    "budget move disables Prove until recompile"
  );
  assert.equal(
    shouldDisableProveWhenBudgetStale(true, 4000, 4000),
    false,
    "matching budget keeps Prove enabled"
  );
  assert.equal(
    shouldDisableProveWhenBudgetStale(false, 4000, 8000),
    false,
    "power-path Prove before first compile stays enabled"
  );
  assert.equal(
    shouldDisableProveWhenStale({
      hasCompiledOnce: true,
      lastCompiledTask: "Q1",
      currentTask: "Q1",
      lastCompiledBudget: 4000,
      currentBudget: 8000,
    }),
    true,
    "combined Prove stale includes budget drift"
  );
  assert.equal(shouldKeepAgentStepsOnCancel(), true, "cancel must keep partial agent steps");
  assert.ok(agentStreamIncompleteMessage().includes("connection ended"), "incomplete SSE named");
  assert.ok(emptyCompiledSectionsMessage().includes("No sections fit"), "empty included bucket is explicit");
  assert.equal(taskInvalidatesCompile(null, "any"), false, "no prior compile → no task invalidation");
  assert.equal(taskInvalidatesCompile("Q1", "Q1"), false, "same task stays valid");
  assert.equal(taskInvalidatesCompile("Q1", "Q2"), true, "edited task invalidates compile");
  assert.equal(taskInvalidatesCompile("  Q1  ", "Q1"), false, "trim matches last compile task");

  const s0 = { expandedIds: new Set<string>(), expandedTokens: new Map<string, number>() };
  const s1 = applyProveIncludeChange(s0, "s2", 120, true);
  assert.ok(s1.expandedIds.has("s2") && s1.expandedTokens.get("s2") === 120);
  const s2 = applyProveIncludeChange(s1, "s2", 120, false);
  assert.ok(!s2.expandedIds.has("s2") && !s2.expandedTokens.has("s2"), "uncheck removes prove state only");

  const truncMeta = truncatedSectionMeta(188, 412, 224, 95);
  assert.ok(truncMeta.includes("224"), "truncated meta shows unread remainder count");
  assert.ok(truncMeta.includes("still unread"), "truncated meta names unread remainder honestly");
  assert.ok(
    includeRestHint(224, "Five-Year Summary").includes("Five-Year Summary"),
    "include hint names the section leaf"
  );
  assert.equal(packagingGapNote(188, 200), null, "small wrapper gap stays quiet");
  assert.equal(
    packagingGapNote(188, 250),
    "188 content · ~250 with packaging",
    "material packaging gap is named"
  );

  assert.ok(
    rateLimitRetryHint("agent").includes("Run agent above or below"),
    "429 agent hint names both Run agent controls"
  );
  assert.ok(rateLimitRetryHint("prove").includes("Prove"), "429 prove hint names Prove controls");
  assert.ok(proveFlowUsesLocalError(), "prove API failures use local .prove-err, not top #err");
  assert.equal(
    apiFailureMessageFromStatus(429, "Rate limit reached. Try again in a few minutes.", null, "agent"),
    "Rate limit reached. Try again in a few minutes. Use Run agent above or below when ready.",
    "429 appends agent retry hint"
  );
  assert.equal(
    apiFailureMessageFromStatus(503, "Server busy.", "30"),
    "Server busy. Retry in about 30s.",
    "503 uses Retry-After when present"
  );
  assert.equal(shouldRetryBusy503(503, 0), true, "first 503 may auto-retry once");
  assert.equal(shouldRetryBusy503(503, 1), false, "second 503 must not auto-retry again");
  assert.equal(shouldRetryBusy503(429, 0), false, "429 must never auto-retry");
  assert.equal(shouldRetryBusy503(500, 0), false, "non-503 must not auto-retry");
  assert.equal(
    busy503RetryDelayMs(() => 0),
    BUSY_503_RETRY_MS_MIN,
    "jitter floor is 400ms"
  );
  assert.equal(
    busy503RetryDelayMs(() => 0.999999),
    BUSY_503_RETRY_MS_MAX,
    "jitter ceiling is 900ms"
  );
  assert.ok(
    BUSY_503_RETRY_MS_MIN >= 400 && BUSY_503_RETRY_MS_MAX <= 900,
    "busy 503 retry stays in ~400–900ms band"
  );

  console.log("  client UX contracts ok: scroll, prove-include, truncated meta + include hint");
}

async function testAgentQueryMissOnExpand() {
  const doc = queryMissAgentDoc();
  const path = testTmpPath(`agent-query-miss-${Date.now()}.md`);
  writeFileSync(path, doc);
  try {
    const task = "What is the secret code WORDZXQ9?";
    const compiled = await compileContext(path, task, 100);
    const liabilityOmit = compiled.omitted_sections.find((s) => s.section.includes("Liability"));
    assert.ok(liabilityOmit, "Liability schedule should stay omitted at tight compile budget");

    const tinyHeadroom = 80;
    const probe = await expandSection(path, liabilityOmit!.id, tinyHeadroom, task);
    assert.ok(!("error" in probe), "tiny expand should return a truncated partial");
    assert.ok(probe.truncated, "expand under tiny headroom is truncated");
    assert.ok(probe.query_miss, "truncated expand must flag query_miss when WORDZXQ9 is dropped");
    assert.ok(!probe.markdown.includes("WORDZXQ9"), "partial must not retain the needle");

    let answerPrompt = "";
    let decideCalls = 0;
    const mock: (p: string) => Promise<string> = async (prompt) => {
      if (/ONLY a JSON object/.test(prompt)) {
        decideCalls += 1;
        assert.equal(decideCalls, 1, "query_miss should stop before a second decide");
        return JSON.stringify({
          action: "expand",
          section_id: liabilityOmit!.id,
          reasoning: "need the secret code",
        });
      }
      answerPrompt = prompt;
      return "The code is not in the excerpt; raise the budget.";
    };

    const compileTokens = compiled.selected_content_tokens ?? countContentTokens(compiled.markdown);
    const tokenCeiling = compileTokens + tinyHeadroom;
    const { runAgent } = await import("../agent.js");
    const r = await runAgent(path, task, {
      startBudget: 100,
      tokenCeiling,
      complete: (p) => mock(p),
    });

    assert.equal(r.stopped_reason, "token_ceiling", "query_miss expand aborts as token_ceiling");
    assert.equal(r.unread_remaining, true, "manifest still has unread sections");
    assert.ok(
      !r.steps.some((s) => s.action === "expand"),
      "failed query_miss expand must not emit expand step"
    );
    assert.ok(
      !r.final_context?.includes("WORDZXQ9"),
      "query_miss must not keep the expanded section needle in claimed context"
    );
    assert.match(answerPrompt, /partially read|higher budget/i, "answer prompt must not pretend full read");
    assert.ok(
      r.final_context_tokens <= tokenCeiling + 5,
      `final context stays within ceiling (${r.final_context_tokens} vs ${tokenCeiling})`
    );
    console.log("  agent query_miss ok: token_ceiling stop, expand rolled back, honest answer prompt");
  } finally {
    unlinkSync(path);
  }
}

async function testAgentRecompileTokensReadNoDoubleCount() {
  const doc = meridianNetProfitAtEndDoc();
  const path = testTmpPath(`agent-recompile-tokens-${Date.now()}.md`);
  writeFileSync(path, doc);
  try {
    const task = "What was net profit in FY25, and which quarter had the best gross margin?";
    let decideCalls = 0;
    const mock: (p: string) => Promise<string> = async (prompt) => {
      if (/ONLY a JSON object/.test(prompt)) {
        decideCalls += 1;
        if (decideCalls === 1) {
          // Expand the omitted Quarterly facet (not a tiny title/crumb chunk).
          const candidates = [...prompt.matchAll(/- (s\d+) "([^"]+)" \(~(\d+) tok/g)];
          const quarterly = candidates.find((m) => /Quarterly/i.test(m[2] ?? ""));
          const pick = quarterly ?? candidates.sort((a, b) => Number(b[3]) - Number(a[3]))[0];
          assert.ok(pick, "manifest should offer an omitted facet section to expand");
          return JSON.stringify({
            action: "expand",
            section_id: pick[1],
            reasoning: "pull omitted Quarterly facet",
          });
        }
        if (decideCalls === 2) {
          return JSON.stringify({ action: "recompile", budget: 300, reasoning: "widen compile pack" });
        }
        return JSON.stringify({ action: "answer", reasoning: "enough from recompile+expand" });
      }
      return "FY25 net profit 51.0; Q4 best gross margin 35.1%.";
    };

    const { runAgent } = await import("../agent.js");
    const r = await runAgent(path, task, {
      // @100 correctly keeps Five-Year only; expand of Quarterly repacks under the
      // ceiling. Ceiling must leave headroom after that so recompile can run.
      startBudget: 100,
      tokenCeiling: 800,
      complete: (p) => mock(p),
    });

    assert.ok(
      r.steps.some((s) => s.action === "expand"),
      "agent expands once before recompile"
    );
    assert.ok(
      r.steps.some((s) => s.action === "recompile"),
      "agent recompiles under headroom ceiling"
    );
    const expectedRead = countContentTokens(r.final_context ?? "");
    assert.equal(
      r.tokens_read,
      expectedRead,
      `tokens_read must match final context substance (${r.tokens_read} vs ${expectedRead})`
    );
    assert.equal(r.final_context_tokens, expectedRead, "final_context_tokens uses same metering");
    console.log(`  agent recompile tokens_read ok: ${r.tokens_read} tok (expand+recompile, no double-count)`);
  } finally {
    unlinkSync(path);
  }
}

async function testExpandQueryAwareTruncation() {
  const doc = meridianNetProfitAtEndDoc();
  const path = testTmpPath(`expand-query-trunc-${Date.now()}.md`);
  writeFileSync(path, doc);
  try {
    const task = "What was net profit in FY25, and which quarter had the best gross margin?";
    const compiled = await compileContext(path, task, 200);
    const fiveYearSel = compiled.selected_sections.find((s) => s.section.includes("Five-Year"));
    assert.ok(fiveYearSel?.truncated, "compile includes Five-Year as query-aware partial");
    assert.ok(
      compiled.markdown.includes("51.0"),
      "compile alone keeps Net profit 51.0 via query-aware partial"
    );

    const chunks = chunkMarkdown(doc);
    const fiveChunk = chunks.find((c) => c.text.includes("Net profit"));
    assert.ok(fiveChunk, "Five-Year chunk contains net profit row");

    const partialBudget = fiveYearSel!.tokens;
    const prefixOnly = truncateSectionToBudget(fiveChunk!.text, fiveChunk!.tokens, partialBudget);
    assert.ok(prefixOnly, "prefix truncation produces a partial");
    assert.ok(
      !prefixOnly!.text.includes("51.0"),
      "prefix-only truncation at the compile partial size must drop the Net profit row at section end"
    );

    const headroom = Math.max(40, fiveYearSel!.remainder_tokens ?? 40);
    const smart = await expandSection(path, fiveYearSel!.id, headroom, task);
    assert.ok(!("error" in smart), "query-aware expand succeeds");
    assert.equal(smart.truncated, true, "expand is truncated under headroom");
    assert.ok(smart.markdown.includes("51.0"), "query-aware expand keeps Net profit 51.0");
    assert.ok(!smart.query_miss, "partial must retain query-relevant lines");

    const proveExpand = await expandSection(path, fiveYearSel!.id, 2000);
    assert.ok(!("error" in proveExpand), "full expand for Prove");
    const { markdown: reassembled, expandContentTokens } = await assembleProveContext(
      path,
      compiled,
      [fiveYearSel!.id],
      "meridian.md"
    );
    const reassembledContent = countContentTokens(reassembled);
    const fullFiveContent = countContentTokens(
      proveExpand.markdown.replace(/^<!--[\s\S]*?-->\n?/, "").trim()
    );
    assert.ok(
      reassembledContent >= fullFiveContent - 5,
      "Prove Include rest replaces partial with full Five-Year"
    );
    assert.ok(
      expandContentTokens >= (fiveYearSel!.remainder_tokens ?? 1) - 5,
      "expand tokens should reflect remainder, not double-count partial"
    );
    assert.ok(
      fullFiveContent > compiled.selected_content_tokens + 50,
      `Prove full Five-Year (${fullFiveContent}) adds beyond compile selection (${compiled.selected_content_tokens})`
    );
    console.log(
      `  expand query-aware ok: compile_has_51=true prefix_misses_net=true ` +
        `prove_remainder=${expandContentTokens} effective=${reassembledContent}`
    );
  } finally {
    unlinkSync(path);
  }
}

async function testAgentMultiFacetBudget200() {
  const doc = meridianNetProfitAtEndDoc();
  const path = testTmpPath(`agent-fin-200-${Date.now()}.md`);
  writeFileSync(path, doc);
  try {
    const task = "What was net profit in FY25, and which quarter had the best gross margin?";
    const mock: (p: string) => Promise<string> = async (prompt) => {
      if (/ONLY a JSON object/.test(prompt)) {
        const ctx = (prompt.match(/<context>\n([\s\S]*)\n<\/context>/) ?? [])[1] ?? "";
        if (ctx.includes("51.0")) {
          return JSON.stringify({ action: "answer", reasoning: "compile already has both facets" });
        }
        return JSON.stringify({ action: "answer", reasoning: "best effort" });
      }
      const ctx = (prompt.match(/<document>\n([\s\S]*)\n<\/document>/) ?? [])[1] ?? "";
      if (ctx.includes("51.0")) {
        return "FY25 net profit was 51.0. Q4 had the best gross margin at 35.1%.";
      }
      if (/partially read|higher budget/i.test(prompt)) {
        return (
          "The excerpt does not include FY25 net profit — raise the token budget to read Five-Year Summary. " +
          "Q4 had the best gross margin at 35.1%."
        );
      }
      return "Cannot determine net profit from this excerpt.";
    };

    const { runAgent } = await import("../agent.js");
    const r = await runAgent(path, task, {
      startBudget: 200,
      tokenCeiling: 200,
      complete: (p) => mock(p),
    });

    const compileStep = r.steps.find((s) => s.action === "compile");
    assert.ok(compileStep, "agent starts with compile");
    assert.ok(r.tokens_read <= 205, `tokens_read stays at ceiling (${r.tokens_read})`);
    assert.ok(
      r.final_context?.includes("51.0"),
      "agent context includes net profit from unified compile packing"
    );
    assert.ok(r.answer.includes("51.0"), "answer cites net profit, not 'missing from document'");
    assert.ok(r.answer.includes("35.1"), "answer still covers gross-margin facet");
    assert.equal(r.stopped_reason, "confident", "unified compile lets agent answer without expand");
    assert.equal(r.unread_remaining, true, "truncated partial + omitted manifest → raise-budget CTA");
    console.log(`  agent multi-facet budget-200 ok: tokens_read=${r.tokens_read} net=51.0 margin=35.1%`);
  } finally {
    unlinkSync(path);
  }
}

async function testOpenAICompatClient() {
  // Mock an OpenAI-compatible /chat/completions endpoint and verify the
  // provider-agnostic client path (used for OpenAI/Gemini/Ollama keys).
  const http = await import("node:http");
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      const parsed = JSON.parse(body);
      assert.equal(req.url, "/v1/chat/completions");
      assert.ok(parsed.model && parsed.messages?.[0]?.content);
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ choices: [{ message: { content: "mock-answer" } }] }));
    });
  });
  await new Promise<void>((r) => server.listen(0, r));
  const port = (server.address() as { port: number }).port;

  // Clear every higher-priority provider + model overrides so this test
  // exercises the generic OpenAI-compatible path in isolation.
  try {
    await withCleanEnv([...LLM_PROVIDER_KEYS, ...LLM_MODEL_KEYS, "CC_LLM_BASE_URL"], async () => {
      process.env.CC_LLM_API_KEY = "test-key";
      process.env.CC_LLM_BASE_URL = `http://127.0.0.1:${port}/v1`;
      const { complete, hasLlm, answerModel } = await import("../llm.js");
      assert.equal(hasLlm(), true);
      assert.equal(answerModel(), "gpt-4o-mini"); // openai-compat default
      assert.equal(await complete("ping"), "mock-answer");
      console.log("  openai-compat ok: generic provider path works");
    });
  } finally {
    server.close();
  }
}

async function testProviderFailover() {
  // Gemini is the intended primary and OpenRouter the fallback. When the
  // primary errors (rate limit, quota, outage), complete() must silently fail
  // over to the next configured provider instead of surfacing the error — and
  // only throw if EVERY provider fails. Two mock servers stand in for the two
  // providers (their base URLs are env-overridable for exactly this reason).
  const http = await import("node:http");
  const makeServer = (status: number, answer: string) =>
    http.createServer((_req, res) => {
      res.statusCode = status;
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify(status < 400 ? { choices: [{ message: { content: answer } }] } : { error: "boom" })
      );
    });

  const primary = makeServer(500, ""); // Gemini: down
  const fallback = makeServer(200, "fallback-answer"); // OpenRouter: healthy
  await new Promise<void>((r) => primary.listen(0, r));
  await new Promise<void>((r) => fallback.listen(0, r));
  const pPort = (primary.address() as { port: number }).port;
  const fPort = (fallback.address() as { port: number }).port;

  try {
    await withCleanEnv(
      [...LLM_PROVIDER_KEYS, ...LLM_MODEL_KEYS, "CC_GEMINI_BASE_URL", "CC_OPENROUTER_BASE_URL"],
      async () => {
        process.env.GEMINI_API_KEY = "gem-key";
        process.env.CC_GEMINI_BASE_URL = `http://127.0.0.1:${pPort}`;
        process.env.OPENROUTER_API_KEY = "or-key";
        process.env.CC_OPENROUTER_BASE_URL = `http://127.0.0.1:${fPort}`;
        const { complete, answerModel, geminiModels } = await import("../llm.js");
        // Before any success on this chain, the badge shows the primary id.
        assert.equal(answerModel(), geminiModels()[0]);
        assert.equal(await complete("ping"), "fallback-answer", "should fail over to the healthy provider");
        // After failover, the badge must show the model that actually answered.
        assert.equal(answerModel(), "meta-llama/llama-3.3-70b-instruct:free");

        // Now knock out the fallback too: every provider down → complete() throws.
        process.env.CC_OPENROUTER_BASE_URL = `http://127.0.0.1:${pPort}`;
        const { LlmUnavailableError } = await import("../llm.js");
        await assert.rejects(
          () => complete("ping"),
          (e: unknown) => {
            assert.ok(e instanceof LlmUnavailableError, "should be LlmUnavailableError");
            assert.match((e as Error).message, /All LLM providers failed/);
            assert.match(
              (e as { publicMessage: string }).publicMessage,
              /AI provider is unavailable/i,
              "public message stays generic"
            );
            return true;
          }
        );
        console.log(
          "  provider failover ok: primary down → fallback used; badge follows success; all down → throws"
        );
      }
    );
  } finally {
    primary.close();
    fallback.close();
  }
}

async function testGeminiModelFailover() {
  // Same Gemini key, first model id dead → second model on the same key succeeds
  // before we ever leave the Gemini provider.
  const http = await import("node:http");
  const seen: string[] = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      const model = (JSON.parse(body) as { model?: string }).model ?? "?";
      seen.push(model);
      res.setHeader("content-type", "application/json");
      if (model === "gemini-flash-lite-latest" || model === "model-a") {
        res.statusCode = 404;
        res.end(JSON.stringify({ error: "model not found" }));
        return;
      }
      if (model === "model-429") {
        res.statusCode = 429;
        res.end(JSON.stringify({ error: "quota exceeded" }));
        return;
      }
      res.end(JSON.stringify({ choices: [{ message: { content: `ok:${model}` } }] }));
    });
  });
  await new Promise<void>((r) => server.listen(0, r));
  const port = (server.address() as { port: number }).port;

  try {
    await withCleanEnv(
      [
        ...LLM_PROVIDER_KEYS,
        ...LLM_MODEL_KEYS,
        "CC_GEMINI_BASE_URL",
        "CC_OPENROUTER_BASE_URL",
        "CC_GEMINI_DEAD_MODEL_TTL_MS",
        "CC_LLM_FAILOVER_COOLDOWN_MS",
      ],
      async () => {
        process.env.GEMINI_API_KEY = "gem-key";
        process.env.CC_GEMINI_BASE_URL = `http://127.0.0.1:${port}`;
        // Existing 429 path must stay fast — cooldown is covered in its own test.
        process.env.CC_LLM_FAILOVER_COOLDOWN_MS = "0";
        const { complete, geminiModels, answerModel, clearGeminiDeadModels } = await import("../llm.js");
        clearGeminiDeadModels();
        assert.deepEqual(geminiModels(), [
          "gemini-flash-lite-latest",
          "gemini-3-flash-preview",
          "gemini-flash-latest",
        ]);
        assert.equal(await complete("ping"), "ok:gemini-3-flash-preview");
        assert.deepEqual(seen, ["gemini-flash-lite-latest", "gemini-3-flash-preview"]);
        assert.equal(
          answerModel(),
          "gemini-3-flash-preview",
          "badge follows the Gemini model that succeeded"
        );

        // CC_GEMINI_MODELS override: custom list, first 404 → second 200; OpenRouter never hit.
        seen.length = 0;
        let openRouterHits = 0;
        const orServer = http.createServer((_req, res) => {
          openRouterHits += 1;
          res.statusCode = 200;
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ choices: [{ message: { content: "should-not-run" } }] }));
        });
        await new Promise<void>((r) => orServer.listen(0, r));
        const orPort = (orServer.address() as { port: number }).port;
        process.env.CC_GEMINI_MODELS = "model-a,model-b";
        process.env.OPENROUTER_API_KEY = "or-key";
        process.env.CC_OPENROUTER_BASE_URL = `http://127.0.0.1:${orPort}`;
        try {
          const {
            complete: complete2,
            geminiModels: geminiModels2,
            answerModel: answerModel2,
          } = await import("../llm.js");
          assert.deepEqual(geminiModels2(), ["model-a", "model-b"]);
          assert.equal(await complete2("ping"), "ok:model-b");
          assert.deepEqual(seen, ["model-a", "model-b"]);
          assert.equal(openRouterHits, 0, "OpenRouter must not be called when a Gemini model succeeds");
          assert.equal(answerModel2(), "model-b");

          // Dead-model cache: 404'd model-a must not be re-hit on the next complete().
          seen.length = 0;
          assert.equal(await complete2("ping2"), "ok:model-b");
          assert.deepEqual(seen, ["model-b"], "cached-dead model-a skipped (no HTTP)");

          // 429/quota must NOT blacklist — model-429 is tried again on the next call.
          process.env.CC_GEMINI_MODELS = "model-429,model-ok";
          seen.length = 0;
          assert.equal(await complete2("ping3"), "ok:model-ok");
          assert.deepEqual(seen, ["model-429", "model-ok"]);
          seen.length = 0;
          assert.equal(await complete2("ping4"), "ok:model-ok");
          assert.deepEqual(seen, ["model-429", "model-ok"], "429 must not blacklist — model-429 hit again");

          console.log(
            "  gemini model failover ok: defaults + override; dead-model cache; 429 not cached; OpenRouter unused"
          );
        } finally {
          orServer.close();
          clearGeminiDeadModels();
        }
      }
    );
  } finally {
    server.close();
  }
}

async function testGeminiFailoverCooldown() {
  // Soft 429 on Gemini model-a must pause briefly before trying model-b.
  // Env knocks the default 1500ms down so the suite stays fast; Retry-After
  // (when present) is preferred over the env default.
  const http = await import("node:http");
  const seen: string[] = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      const model = (JSON.parse(body) as { model?: string }).model ?? "?";
      seen.push(model);
      res.setHeader("content-type", "application/json");
      if (model === "model-a") {
        res.statusCode = 429;
        res.setHeader("Retry-After", "0"); // exercise header path; 0ms → no real wait
        res.end(JSON.stringify({ error: "rate limit" }));
        return;
      }
      if (model === "model-slow") {
        res.statusCode = 429;
        // No Retry-After → env cooldown (50ms) applies.
        res.end(JSON.stringify({ error: "quota exceeded" }));
        return;
      }
      if (model === "model-404") {
        res.statusCode = 404;
        res.end(JSON.stringify({ error: "model not found" }));
        return;
      }
      res.end(JSON.stringify({ choices: [{ message: { content: `ok:${model}` } }] }));
    });
  });
  await new Promise<void>((r) => server.listen(0, r));
  const port = (server.address() as { port: number }).port;

  try {
    await withCleanEnv(
      [
        ...LLM_PROVIDER_KEYS,
        ...LLM_MODEL_KEYS,
        "CC_GEMINI_BASE_URL",
        "CC_LLM_FAILOVER_COOLDOWN_MS",
        "CC_GEMINI_DEAD_MODEL_TTL_MS",
      ],
      async () => {
        process.env.GEMINI_API_KEY = "gem-key";
        process.env.CC_GEMINI_BASE_URL = `http://127.0.0.1:${port}`;
        process.env.CC_LLM_FAILOVER_COOLDOWN_MS = "50";
        const { complete, clearGeminiDeadModels } = await import("../llm.js");
        clearGeminiDeadModels();

        // Retry-After: 0 → failover still works, no meaningful delay.
        process.env.CC_GEMINI_MODELS = "model-a,model-b";
        seen.length = 0;
        const t0 = Date.now();
        assert.equal(await complete("ping-ra"), "ok:model-b");
        assert.deepEqual(seen, ["model-a", "model-b"]);
        assert.ok(Date.now() - t0 < 200, "Retry-After: 0 should not stall");

        // Env cooldown when no Retry-After: must wait ~50ms before model-ok.
        process.env.CC_GEMINI_MODELS = "model-slow,model-ok";
        seen.length = 0;
        const t1 = Date.now();
        assert.equal(await complete("ping-cd"), "ok:model-ok");
        const elapsed = Date.now() - t1;
        assert.deepEqual(seen, ["model-slow", "model-ok"]);
        assert.ok(elapsed >= 40, `expected ~50ms cooldown, got ${elapsed}ms`);

        // 404 must fail over immediately (no cooldown sleep). Bump env cooldown
        // so a missing sleep is obvious vs ordinary HTTP latency.
        process.env.CC_LLM_FAILOVER_COOLDOWN_MS = "200";
        process.env.CC_GEMINI_MODELS = "model-404,model-ok";
        seen.length = 0;
        const t2 = Date.now();
        assert.equal(await complete("ping-404"), "ok:model-ok");
        assert.deepEqual(seen, ["model-404", "model-ok"]);
        assert.ok(Date.now() - t2 < 150, "404 failover must not sleep the 200ms cooldown");

        clearGeminiDeadModels();
        console.log("  gemini failover cooldown ok: Retry-After path, env cooldown on 429, no sleep on 404");
      }
    );
  } finally {
    server.close();
  }
}

async function testAgentAbort() {
  // AbortSignal mid-loop must stop further complete() calls (client disconnect).
  const { runAgent } = await import("../agent.js");
  const path = testTmpPath(`cc-agent-abort-${Date.now()}.md`);
  writeFileSync(path, makeTestDoc());
  try {
    const ac = new AbortController();
    let calls = 0;
    let firstStarted!: () => void;
    const firstCallStarted = new Promise<void>((r) => {
      firstStarted = r;
    });

    const run = runAgent(path, "termination notice period", {
      startBudget: 1200,
      signal: ac.signal,
      complete: async (_prompt, opts) => {
        calls += 1;
        firstStarted();
        // Hang until aborted — mirrors a slow LLM call the client abandons.
        await new Promise<void>((_resolve, reject) => {
          const sig = opts?.signal ?? ac.signal;
          if (sig.aborted) {
            reject(new Error("LLM request aborted"));
            return;
          }
          const onAbort = () => reject(new Error("LLM request aborted"));
          sig.addEventListener("abort", onAbort, { once: true });
        });
        return "unreachable";
      },
    });

    await firstCallStarted;
    assert.equal(calls, 1, "decide should have started one complete()");
    ac.abort();
    await assert.rejects(
      () => run,
      (e: unknown) => {
        assert.match(String(e), /cancelled|aborted/i);
        return true;
      }
    );
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(calls, 1, "no further complete() after abort");
    console.log("  agent abort ok: signal stops the loop mid-complete");
  } finally {
    unlinkSync(path);
  }
}

async function testAgentLoop() {
  // The agent loop is driven entirely by an injected `complete`, so this runs
  // with NO model or network — the mock plays the model's part. Three scripted
  // behaviours, all against the same fixture document.
  const { runAgent } = await import("../agent.js");
  const path = testTmpPath(`cc-agent-${Date.now()}.md`);
  writeFileSync(path, makeTestDoc());
  try {
    // 1. Happy path: expand one offered section, then answer.
    let decisions = 0;
    const expandThenAnswer: (p: string) => Promise<string> = async (prompt) => {
      if (/ONLY a JSON object/.test(prompt)) {
        decisions += 1;
        if (decisions === 1) {
          const id = (prompt.match(/- (s\d+)/) ?? [])[1]; // first offered section id
          return JSON.stringify({ action: "expand", section_id: id, reasoning: "likely holds the answer" });
        }
        return JSON.stringify({ action: "answer", reasoning: "have enough now" });
      }
      return "The termination notice period is 90 days.";
    };
    const r = await runAgent(path, "termination notice period", {
      startBudget: 1200,
      complete: (p) => expandThenAnswer(p),
    });
    assert.ok(r.answer.includes("90 days"), "final answer should come from the injected model");
    assert.equal(r.steps[0].action, "compile", "first step is always a compile");
    assert.ok(
      r.steps.some((s) => s.action === "expand" && s.section_id),
      "the agent should have expanded a section it was offered"
    );
    assert.equal(r.steps[r.steps.length - 1].action, "answer", "last step is the answer");
    assert.equal(r.stopped_reason, "confident");
    assert.ok(r.tokens_read < r.raw_tokens, "the whole point: it reads less than the full file");

    // 1b. Tiny doc that fits under the start budget: no retrieval loop — answer
    // from the whole file and label it honestly (not a fake oversized budget).
    const tiny = testTmpPath(`cc-agent-tiny-${Date.now()}.md`);
    writeFileSync(tiny, "# Note\n\nThe password is swordfish.\n");
    try {
      let decideCalls = 0;
      const whole = await runAgent(tiny, "What is the password?", {
        startBudget: 1500,
        tokenCeiling: 1500,
        complete: async (prompt) => {
          if (/ONLY a JSON object/.test(prompt)) {
            decideCalls += 1;
            return JSON.stringify({ action: "expand", section_id: "s0", reasoning: "should not run" });
          }
          return "The password is swordfish.";
        },
      });
      assert.equal(whole.stopped_reason, "whole_file");
      assert.equal(whole.tokens_read, whole.raw_tokens, "read the whole small file once");
      assert.equal(decideCalls, 0, "no decide steps when the whole file already fit");
      assert.ok(
        whole.steps[0].detail.includes("whole file"),
        `compile step should say whole file, got ${whole.steps[0].detail}`
      );
      assert.ok(!whole.steps.some((s) => s.action === "expand"), "no expands on a whole-file short-circuit");
      assert.ok(whole.answer.includes("swordfish"));
    } finally {
      unlinkSync(tiny);
    }

    // 2. Runaway model that never answers must still terminate at the step cap.
    const alwaysExpand: (p: string) => Promise<string> = async (prompt) => {
      if (/ONLY a JSON object/.test(prompt)) {
        const id = (prompt.match(/- (s\d+)/) ?? [])[1];
        return JSON.stringify({ action: "expand", section_id: id, reasoning: "more" });
      }
      return "forced answer";
    };
    const capped = await runAgent(path, "termination", {
      startBudget: 1200,
      tokenCeiling: 50_000,
      maxSteps: 3,
      complete: (p) => alwaysExpand(p),
    });
    assert.equal(capped.stopped_reason, "max_steps", "a non-stopping model hits the step cap");
    assert.ok(
      capped.steps.filter((s) => s.action === "expand").length <= 2,
      "the cap bounds how many sections it can pull"
    );
    assert.equal(
      capped.steps[capped.steps.length - 1].action,
      "answer",
      "still produces an answer at the cap"
    );

    // 3. Garbage decision output falls back to answering, never crashes.
    const garbage: (p: string) => Promise<string> = async (prompt) =>
      /ONLY a JSON object/.test(prompt) ? "sorry, I can't do that" : "fallback answer";
    const safe = await runAgent(path, "termination", { startBudget: 1200, complete: (p) => garbage(p) });
    assert.equal(safe.stopped_reason, "confident", "malformed decision → answer, not a loop");
    assert.ok(safe.answer.length > 0);

    // 4. Soft token ceiling: always-expand with start === ceiling. Expands are
    // truncated to remaining headroom; tokens_read stays at or under the ceiling.
    const softCeiling = 1500;
    const alwaysExpandCeiling: (p: string) => Promise<string> = async (prompt) => {
      if (/ONLY a JSON object/.test(prompt)) {
        assert.match(prompt, /"answer" \| "expand"/, "web-equal ceiling omits recompile from decide prompt");
        assert.doesNotMatch(
          prompt,
          /"recompile"/,
          "recompile must not be offered when ceiling ≤ current budget"
        );
        const id = (prompt.match(/- (s\d+)/) ?? [])[1];
        return JSON.stringify({ action: "expand", section_id: id, reasoning: "more" });
      }
      return "ceiling answer";
    };
    const ceilingHit = await runAgent(path, "termination", {
      startBudget: softCeiling,
      tokenCeiling: softCeiling,
      maxSteps: 8,
      complete: (p) => alwaysExpandCeiling(p),
    });
    assert.equal(
      ceilingHit.stopped_reason,
      "token_ceiling",
      "always-expand under equal start/ceiling stops with token_ceiling"
    );
    assert.ok(
      ceilingHit.tokens_read <= softCeiling + 5,
      `tokens_read must stay at or under the ceiling (tokens_read=${ceilingHit.tokens_read})`
    );
    assert.ok(
      ceilingHit.steps.filter((s) => s.action === "expand").length >= 1,
      "truncated expands should run while headroom remains"
    );
    assert.ok(
      ceilingHit.steps.filter((s) => s.action === "expand").length < 8,
      "soft ceiling bounds expand count"
    );
    assert.equal(
      ceilingHit.unread_remaining,
      true,
      "ceiling stop with unread left should flag raise-budget hint"
    );

    // 4b. Full section larger than remaining headroom still expands (truncated via repack).
    // Repack under ceiling may leave headroom for one more decide → answer (confident),
    // while unread_remaining stays true when the expand was truncated.
    const tightCeiling = 900;
    let expandDecisions = 0;
    const expandOnce: (p: string) => Promise<string> = async (prompt) => {
      if (/ONLY a JSON object/.test(prompt)) {
        expandDecisions += 1;
        if (expandDecisions === 1) {
          const largest = [...(prompt.matchAll(/- (s\d+) "[^"]+" \(~(\d+) tok/g) ?? [])].sort(
            (a, b) => Number(b[2]) - Number(a[2])
          )[0];
          assert.ok(largest, "manifest should list omitted sections");
          assert.ok(Number(largest[2]) > 100, "pick a section larger than typical headroom");
          return JSON.stringify({
            action: "expand",
            section_id: largest[1],
            reasoning: "need the big section",
          });
        }
        return JSON.stringify({ action: "answer", reasoning: "enough" });
      }
      return "truncated expand answer";
    };
    const truncated = await runAgent(path, "termination", {
      startBudget: tightCeiling,
      tokenCeiling: tightCeiling,
      complete: (p) => expandOnce(p),
    });
    const expandStep = truncated.steps.find((s) => s.action === "expand");
    assert.ok(expandStep, "should expand even when section > headroom");
    assert.ok(
      truncated.tokens_read <= tightCeiling + 5,
      `repacked expand must respect ceiling (tokens_read=${truncated.tokens_read})`
    );
    assert.ok(
      truncated.stopped_reason === "token_ceiling" || truncated.stopped_reason === "confident",
      "after truncated repack, agent stops at ceiling or when model answers"
    );
    if (expandStep?.truncated) {
      assert.equal(truncated.unread_remaining, true, "truncated section remainder → raise-budget hint");
    }

    // 4c. Confident answer with headroom left: no raise-budget flag required for UX
    // (client only shows CTA on token_ceiling + unread_remaining).
    const answerNow: (p: string) => Promise<string> = async (prompt) =>
      /ONLY a JSON object/.test(prompt)
        ? JSON.stringify({ action: "answer", reasoning: "enough from compile" })
        : "early answer";
    const early = await runAgent(path, "termination", {
      startBudget: 1500,
      tokenCeiling: 1500,
      complete: (p) => answerNow(p),
    });
    assert.equal(early.stopped_reason, "confident");
    // May still have omitted sections, but CTA must not fire for confident stops.

    // 5. Equal start/ceiling: inject recompile → schema rejects it → answer
    // (no second compile). Use a large budget so relevance floor leaves
    // headroom and decide actually runs.
    const equalBudget = 4000;
    let decideCalls = 0;
    const injectRecompile: (p: string) => Promise<string> = async (prompt) => {
      if (/ONLY a JSON object/.test(prompt)) {
        decideCalls += 1;
        assert.doesNotMatch(prompt, /"recompile"/, "recompile omitted from decide when at ceiling");
        return JSON.stringify({
          action: "recompile",
          budget: equalBudget * 2,
          reasoning: "want more room",
        });
      }
      return "noop recompile answer";
    };
    const noop = await runAgent(path, "termination", {
      startBudget: equalBudget,
      tokenCeiling: equalBudget,
      complete: (p) => injectRecompile(p),
    });
    assert.ok(decideCalls >= 1, "decide should run when compile left headroom under ceiling");
    assert.equal(noop.stopped_reason, "confident", "rejected recompile collapses to answer");
    assert.ok(
      !noop.steps.some((s) => s.action === "recompile"),
      "no recompile step when ceiling equals start"
    );

    console.log(
      "  agent loop ok: expand→answer, step-cap, bad JSON, soft ceiling, truncated expand, confident no CTA, recompile omitted at equal ceiling"
    );
  } finally {
    unlinkSync(path);
  }
}

async function testAgentSseEndpoint() {
  // End-to-end through the real Express app: a mock LLM server plays the model,
  // and we assert the /api/agent route streams step events then a done event,
  // respects token_budget, and that /api/agent-parity is one-shot.
  const http = await import("node:http");
  let decisionCount = 0;
  const chat = http.createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      const content = JSON.parse(body).messages[0].content as string;
      let text: string;
      if (/ONLY a JSON object/.test(content)) {
        decisionCount += 1;
        if (decisionCount === 1) {
          const id = (content.match(/- (s\d+)/) ?? [])[1];
          text = JSON.stringify({ action: "expand", section_id: id, reasoning: "likely holds it" });
        } else {
          text = JSON.stringify({ action: "answer", reasoning: "enough now" });
        }
      } else {
        text = "The termination notice period is 90 days.";
      }
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ choices: [{ message: { content: text } }] }));
    });
  });
  await new Promise<void>((r) => chat.listen(0, r));
  const chatPort = (chat.address() as { port: number }).port;

  await withCleanEnv([...LLM_PROVIDER_KEYS, ...LLM_MODEL_KEYS, "CC_LLM_BASE_URL"], async () => {
    process.env.CC_LLM_API_KEY = "test-key";
    process.env.CC_LLM_BASE_URL = `http://127.0.0.1:${chatPort}/v1`;

    const { app } = await import("../web.js");
    const server = app.listen(0);
    await new Promise<void>((r) => server.once("listening", () => r()));
    const appPort = (server.address() as { port: number }).port;

    try {
      const form = new FormData();
      form.append("task", "termination notice period");
      form.append("token_budget", "1200");
      form.append("file", new Blob([makeTestDoc()], { type: "text/markdown" }), "doc.md");
      const res = await fetch(`http://127.0.0.1:${appPort}/api/agent`, { method: "POST", body: form });
      assert.equal(res.headers.get("content-type"), "text/event-stream", "agent route streams SSE");

      // Parse the buffered event stream into {event, data} records.
      const raw = await res.text();
      const events = raw
        .split("\n\n")
        .filter(Boolean)
        .map((block) => {
          const event = (block.match(/^event: (.*)$/m) ?? [])[1];
          const data = (block.match(/^data: (.*)$/m) ?? [])[1];
          return { event, data: data ? JSON.parse(data) : null };
        });

      const steps = events.filter((e) => e.event === "step");
      const done = events.find((e) => e.event === "done");
      assert.ok(steps.length >= 2, "should stream at least a compile and one more step");
      assert.equal(steps[0].data.action, "compile", "first streamed step is the compile");
      assert.equal(
        String(steps[0].data.detail).replace(/[^\d]/g, ""),
        "1200",
        `first compile should respect token_budget=1200, got ${steps[0].data.detail}`
      );
      assert.ok(steps[0].data.tokens_added <= 1200, "compile pack must stay under the requested budget");
      assert.ok(
        steps.some((s) => s.data.action === "expand"),
        "the agent expanded a section over the wire"
      );
      assert.ok(done, "a done event closes the stream");
      assert.ok(done!.data.answer.includes("90 days"), "final answer arrives in the done event");
      assert.ok(done!.data.tokens_read < done!.data.raw_tokens, "reads less than the whole file");
      assert.ok(
        done!.data.tokens_read <= 1200 + 5,
        "tokens_read stays at or under the soft ceiling (truncated expands)"
      );
      const handle = done!.data.parity_handle as string;
      assert.ok(typeof handle === "string" && /^[a-f0-9]{32}$/.test(handle), "opaque parity_handle on done");
      assert.equal(
        done!.data.final_context,
        undefined,
        "agent context must not be sent over SSE (only the handle)"
      );

      // POST /api/agent-parity: happy path, then one-shot 410, invalid → 400.
      const parityOk = await fetch(`http://127.0.0.1:${appPort}/api/agent-parity`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ parity_handle: handle }),
      });
      assert.equal(parityOk.status, 200, "agent-parity succeeds with a fresh handle");
      const parityBody = (await parityOk.json()) as {
        full?: { answer?: string; context_tokens?: number };
        agent?: { answer?: string; context_tokens?: number };
        model?: string;
      };
      assert.ok(parityBody.full?.answer, "parity returns full-file answer");
      assert.ok(parityBody.agent?.answer, "parity returns agent-context answer");
      assert.ok(typeof parityBody.full?.context_tokens === "number");
      assert.ok(typeof parityBody.agent?.context_tokens === "number");
      assert.ok(
        (parityBody.full!.context_tokens as number) >= (parityBody.agent!.context_tokens as number),
        "full context is at least as large as agent context"
      );

      const parityReuse = await fetch(`http://127.0.0.1:${appPort}/api/agent-parity`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ parity_handle: handle }),
      });
      assert.equal(parityReuse.status, 410, "parity handle is one-shot — second call is gone");

      const parityBad = await fetch(`http://127.0.0.1:${appPort}/api/agent-parity`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ parity_handle: "not-a-valid-handle" }),
      });
      assert.equal(parityBad.status, 400, "invalid parity_handle → 400");

      const parityMissing = await fetch(`http://127.0.0.1:${appPort}/api/agent-parity`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ parity_handle: "a".repeat(32) }),
      });
      assert.equal(parityMissing.status, 410, "unknown handle → 410");

      console.log("  agent SSE ok: token_budget, live steps, agent-parity 200/400/410 one-shot");
    } finally {
      server.close();
      chat.close();
    }
  });
}

async function testProveContextNoExpandMatchesSelectedTokens() {
  // FY25@200: Prove with no includes must meter the same selected substance as
  // compile/agent — not compile.markdown with omit-manifest ballast (~250 vs ~188).
  const doc = meridianNetProfitAtEndDoc();
  const path = testTmpPath(`prove-no-expand-${Date.now()}.md`);
  writeFileSync(path, doc);
  try {
    const task = "What was net profit in FY25, and which quarter had the best gross margin?";
    const compiled = await compileContext(path, task, 200, "meridian.md");
    assert.ok(
      compiled.selected_content_tokens <= 200,
      `compile content budget: ${compiled.selected_content_tokens}`
    );

    const { markdown, expandContentTokens } = await assembleProveContext(path, compiled, [], "meridian.md");
    assert.equal(expandContentTokens, 0);
    const proveContent = countContentTokens(markdown);
    assert.ok(
      Math.abs(proveContent - compiled.selected_content_tokens) <= 2,
      `Prove context (${proveContent}) must match selected_content_tokens (${compiled.selected_content_tokens})`
    );
    assert.ok(
      Math.abs(proveContent - compiled.tokens_used) <= 2,
      `Prove context (${proveContent}) must match tokens_used (${compiled.tokens_used})`
    );

    const manifestInflated = countContentTokens(compiled.markdown);
    assert.ok(
      manifestInflated > proveContent + 15,
      `compile markdown with manifest (${manifestInflated}) must not inflate Prove (${proveContent})`
    );
    assert.ok(!markdown.includes("Sections omitted"), "Prove context must not ship omit manifest");
    assert.ok(markdown.includes("51.0"), "Prove context keeps net profit facet");
    console.log(
      `  prove no-expand tokens ok: compile=${compiled.selected_content_tokens} prove=${proveContent} manifest=${manifestInflated}`
    );
  } finally {
    unlinkSync(path);
  }
}

async function testProveContextReassembly() {
  // FY25 case: compile keeps Quarterly + truncated Five-Year. Prove Include rest
  // must replace the partial (not stack partial + full) when reassembling.
  const doc = meridianNetProfitAtEndDoc();
  const path = testTmpPath(`prove-reassemble-${Date.now()}.md`);
  writeFileSync(path, doc);
  try {
    const task = "What was net profit in FY25, and which quarter had the best gross margin?";
    const compiled = await compileContext(path, task, 200, "meridian.md");
    const fiveYearSel = compiled.selected_sections.find((s) => s.section.includes("Five-Year"));
    assert.ok(fiveYearSel?.truncated, "Five-Year should be truncated Included at budget 200");
    assert.ok(
      compiled.selected_sections.some((s) => s.section.includes("Quarterly")),
      "Quarterly should be selected"
    );

    const expand = await expandSection(path, fiveYearSel!.id);
    assert.ok(!("error" in expand), "expand Five-Year");
    const naiveConcat = compiled.markdown + "\n\n" + expand.markdown;
    const naiveTokens = countContentTokens(naiveConcat);

    const {
      markdown: reassembled,
      expandedApplied,
      expandContentTokens,
    } = await assembleProveContext(path, compiled, [fiveYearSel!.id], "meridian.md");
    assert.deepEqual(expandedApplied, [fiveYearSel!.id], "Five-Year rest included");
    assert.ok(reassembled.includes("51.0"), "reassembled context includes net profit");
    assert.ok(reassembled.includes("35.1"), "reassembled context keeps Quarterly gross margin");

    const effective = countContentTokens(reassembled);
    const fullFiveContent = countContentTokens(expand.markdown.replace(/^<!--[\s\S]*?-->\n?/, "").trim());
    const quarterlyContent = compiled.selected_content_tokens - (fiveYearSel!.tokens ?? 0);
    const honestEstimate = quarterlyContent + fullFiveContent;
    const oldInflated = compiled.selected_content_tokens + expand.tokens_used;
    assert.ok(
      effective <= compiled.raw_tokens + 20,
      `reassembled content (${effective}) must not exceed raw (${compiled.raw_tokens}) + slack`
    );
    assert.ok(
      oldInflated > effective,
      `naive partial+full concat (${oldInflated}) inflated vs reassembled (${effective})`
    );
    assert.ok(
      Math.abs(effective - honestEstimate) <= 8,
      `effective (${effective}) should track quarterly+full Five-Year (${honestEstimate}), not naive ${naiveTokens}`
    );
    assert.ok(
      expandContentTokens >= (fiveYearSel!.remainder_tokens ?? 1) - 5,
      "expand content tokens should reflect remainder past compile partial"
    );
    console.log(
      `  prove reassembly ok: raw=${compiled.raw_tokens} naive=${naiveTokens} effective=${effective} ` +
        `(compile=${compiled.selected_content_tokens}, remainder=${expandContentTokens})`
    );
  } finally {
    unlinkSync(path);
  }
}

async function testAnswerExpandedIds() {
  // Prove path: omit a section at a tight budget, then pass its id via
  // expanded_ids so the compiled side grows and includes that needle.
  const http = await import("node:http");
  const chat = http.createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      const content = JSON.parse(body).messages[0].content as string;
      const hasNeedle = content.includes("UNIQUE_EXPAND_NEEDLE_XYZ");
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          choices: [{ message: { content: hasNeedle ? "found-needle" : "no-needle" } }],
        })
      );
    });
  });
  await new Promise<void>((r) => chat.listen(0, r));
  const chatPort = (chat.address() as { port: number }).port;

  const doc =
    "# Doc\n\n## Alpha\n\n" +
    "alpha filler text. ".repeat(80) +
    "\n\n## Beta needle\n\nUNIQUE_EXPAND_NEEDLE_XYZ lives only here.\n\n" +
    "## Gamma\n\n" +
    "gamma filler text. ".repeat(80);

  // Find an omitted section id that contains the needle. Ask about Alpha so
  // BM25 keeps that section and leaves the needle section in the manifest.
  const tmp = testTmpPath(`cc-expand-ids-${Date.now()}.md`);
  writeFileSync(tmp, doc);
  let omittedId: string | null = null;
  let selectedBase = 0;
  try {
    const compiled = await compileContext(tmp, "alpha filler text", 400);
    selectedBase = compiled.selected_content_tokens;
    assert.ok(
      !compiled.markdown.includes("UNIQUE_EXPAND_NEEDLE_XYZ"),
      "needle should be omitted when the query targets Alpha"
    );
    for (const s of compiled.omitted_sections) {
      const e = await expandSection(tmp, s.id);
      if (!("error" in e) && e.markdown.includes("UNIQUE_EXPAND_NEEDLE_XYZ")) {
        omittedId = s.id;
        break;
      }
    }
    assert.ok(omittedId, "should find an omitted section holding the needle");
  } finally {
    unlinkSync(tmp);
  }

  await withCleanEnv([...LLM_PROVIDER_KEYS, ...LLM_MODEL_KEYS, "CC_LLM_BASE_URL"], async () => {
    process.env.CC_LLM_API_KEY = "test-key";
    process.env.CC_LLM_BASE_URL = `http://127.0.0.1:${chatPort}/v1`;

    const { app } = await import("../web.js");
    const server = app.listen(0);
    await new Promise<void>((r) => server.once("listening", () => r()));
    const appPort = (server.address() as { port: number }).port;

    try {
      const form = new FormData();
      form.append("task", "alpha filler text");
      form.append("token_budget", "400");
      form.append("expanded_ids", JSON.stringify([omittedId]));
      form.append("file", new Blob([doc], { type: "text/markdown" }), "doc.md");
      const res = await fetch(`http://127.0.0.1:${appPort}/api/answer`, { method: "POST", body: form });
      assert.equal(res.status, 200, "answer with expanded_ids succeeds");
      const body = (await res.json()) as {
        compiled?: { answer?: string; context_tokens?: number; expanded_ids?: string[] };
        full?: { answer?: string };
      };
      assert.deepEqual(body.compiled?.expanded_ids, [omittedId], "expanded_ids echoed on compiled side");
      assert.ok(
        (body.compiled!.context_tokens as number) > selectedBase,
        `reassembled context should exceed selected-only base (${body.compiled!.context_tokens} vs ${selectedBase})`
      );
      assert.equal(body.compiled?.answer, "found-needle", "compiled prompt must include the expanded needle");
      console.log("  answer expanded_ids ok: omitted needle merged into Prove context");
    } finally {
      server.close();
      chat.close();
    }
  });
}

async function testRateCostsInConfig() {
  // Sanity: /api/config exposes the heavier LLM route costs the UI documents.
  const { app } = await import("../web.js");
  const server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const port = (server.address() as { port: number }).port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/config`);
    assert.equal(res.status, 200);
    const cfg = (await res.json()) as {
      rate_limit?: number;
      rate_cost_answer?: number;
      rate_cost_agent?: number;
    };
    assert.equal(cfg.rate_cost_agent, 12, "agent costs 12 rate points");
    assert.equal(cfg.rate_cost_answer, 4, "answer/parity cost 4 rate points");
    assert.ok((cfg.rate_limit as number) >= 12, "window can fit at least one agent run");
    console.log("  rate costs ok: /api/config reports agent=12 answer=4");
  } finally {
    server.close();
  }
}

async function testLogger() {
  const { log } = await import("../log.js");
  const saved = { ...process.env };
  const captured: string[] = [];
  const origWrite = process.stderr.write.bind(process.stderr);
  // Capture stderr so we can assert on what the logger emits (and, critically,
  // what it does NOT emit when silenced).
  process.stderr.write = ((chunk: string | Uint8Array) => {
    captured.push(String(chunk));
    return true;
  }) as typeof process.stderr.write;
  try {
    delete process.env.CC_LOG_JSON;
    delete process.env.CC_LOG_WEBHOOK;

    process.env.CC_LOG_LEVEL = "silent";
    log.error("must not appear");
    assert.equal(captured.length, 0, "silent level emits nothing");

    process.env.CC_LOG_LEVEL = "info";
    log.debug("below threshold");
    assert.equal(captured.length, 0, "debug is dropped at info level");
    log.warn("hello", { k: "v" });
    assert.equal(captured.length, 1, "warn emits at info level");
    assert.match(captured[0], /WARN hello k=v/, "human-readable format with fields");

    // Spaces in field values are quoted so the line stays parseable by eye.
    captured.length = 0;
    log.info("spaced", { note: "has spaces" });
    assert.match(captured[0], /note="has spaces"/, "values with spaces are JSON-quoted");

    // CC_LOG_JSON=1 emits one JSON object per line (for log ingestion).
    captured.length = 0;
    process.env.CC_LOG_JSON = "1";
    log.warn("json-mode", { n: 3 });
    const parsed = JSON.parse(captured[0]) as { level: string; msg: string; n: number; t: string };
    assert.equal(parsed.level, "warn");
    assert.equal(parsed.msg, "json-mode");
    assert.equal(parsed.n, 3);
    assert.ok(parsed.t, "JSON records carry an ISO timestamp");
    delete process.env.CC_LOG_JSON;

    // Error-level events fan out to CC_LOG_WEBHOOK (best-effort, fire-and-forget).
    // Warn/info must NOT hit the webhook — that's the alert surface, not a firehose.
    const http = await import("node:http");
    const box: { received: { msg?: string; level?: string; where?: string } | null; hits: number } = {
      received: null,
      hits: 0,
    };
    let resolveGot: () => void = () => {};
    const got = new Promise<void>((r) => (resolveGot = r));
    const srv = http.createServer((req, res) => {
      let b = "";
      req.on("data", (d) => (b += d));
      req.on("end", () => {
        box.hits += 1;
        box.received = JSON.parse(b) as { msg?: string; level?: string; where?: string };
        res.end("ok");
        resolveGot();
      });
    });
    await new Promise<void>((r) => srv.listen(0, r));
    const port = (srv.address() as { port: number }).port;
    process.env.CC_LOG_WEBHOOK = `http://127.0.0.1:${port}/`;
    process.env.CC_LOG_LEVEL = "warn";
    log.warn("not an alert");
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(box.hits, 0, "warn must not POST to the alert webhook");

    process.env.CC_LOG_LEVEL = "error";
    log.error("boom", { where: "test" });
    await Promise.race([got, new Promise((r) => setTimeout(r, 2000))]);
    srv.close();
    assert.ok(box.received, "webhook received an error event");
    assert.equal(box.received.msg, "boom");
    assert.equal(box.received.level, "error");
    assert.equal(box.received.where, "test");
  } finally {
    process.stderr.write = origWrite;
    process.env = saved as NodeJS.ProcessEnv;
  }
  console.log("  logger ok: level gating + human/JSON format + error-only webhook");
}

async function testMetricsCounters() {
  const { inc, snapshot } = await import("../metrics.js");
  const before = snapshot();
  const key = `test_counter_${Date.now()}`;
  assert.equal(before[key], undefined, "fresh counter name starts unset");
  inc(key);
  inc(key, 2);
  const after = snapshot();
  assert.equal(after[key], 3, "inc accumulates by the given amount");
  // snapshot() returns a copy — mutating it must not touch the live store.
  after[key] = 999;
  assert.equal(snapshot()[key], 3, "snapshot is a shallow copy, not a live view");
  console.log("  metrics ok: inc + snapshot copy semantics");
}

async function testHealthzEndpoint() {
  // Isolate from a developer shell that may already export CC_METRICS_TOKEN
  // (same class of leak as CC_GEMINI_MODEL). web.ts reads the token at request
  // time, so clearing before the dark assertion is enough — restore in finally.
  await withCleanEnv(["CC_METRICS_TOKEN"], async () => {
    const { app } = await import("../web.js");
    const server = app.listen(0);
    await new Promise<void>((r) => server.once("listening", () => r()));
    const port = (server.address() as { port: number }).port;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/healthz`);
      const body = (await res.json()) as {
        status: string;
        uptime_s: number;
        converter_available?: unknown;
        counters?: unknown;
        llm_configured?: unknown;
      };
      assert.equal(res.status, 200, "healthz is always 200 (cheap liveness)");
      assert.equal(body.status, "ok");
      assert.equal(typeof body.uptime_s, "number");
      assert.equal(body.converter_available, undefined, "converter check must not run on healthz");
      assert.equal(body.counters, undefined, "public healthz must not expose counters");
      assert.equal(body.llm_configured, undefined, "public healthz must not expose llm_configured");

      // /metrics stays dark without a token.
      const dark = await fetch(`http://127.0.0.1:${port}/metrics`);
      assert.equal(dark.status, 404);

      process.env.CC_METRICS_TOKEN = "test-metrics-token";
      const denied = await fetch(`http://127.0.0.1:${port}/metrics`);
      assert.equal(denied.status, 401);
      const { inc } = await import("../metrics.js");
      const probe = `healthz_probe_${Date.now()}`;
      inc(probe, 7);
      const ok = await fetch(`http://127.0.0.1:${port}/metrics`, {
        headers: { authorization: "Bearer test-metrics-token" },
      });
      assert.equal(ok.status, 200);
      const metrics = (await ok.json()) as {
        counters: Record<string, number>;
        llm_configured: boolean;
        converter_available: boolean;
      };
      assert.equal(metrics.counters[probe], 7);
      assert.equal(typeof metrics.llm_configured, "boolean");
      assert.equal(typeof metrics.converter_available, "boolean", "converter lives on /metrics");
      console.log("  healthz ok: cheap public probe; metrics gated by token");
    } finally {
      server.close();
    }
  });
}

async function testSampleLibraryStaticServing() {
  // Demo click-path: selectSample fetches GET /samples/<file>. Catalog can be
  // fine while static sample bytes 404/500 — lock that the library files are
  // served, dockerignore keeps markdown samples in the image, and the client
  // checks resp.ok before caching a blob.
  const { app } = await import("../web.js");
  const server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const port = (server.address() as { port: number }).port;
  try {
    const docx = await fetch(`http://127.0.0.1:${port}/samples/pride-and-prejudice.docx`);
    assert.equal(docx.status, 200, "docx sample must be served");
    const docxBytes = Buffer.from(await docx.arrayBuffer());
    assert.ok(docxBytes.byteLength > 1000, "docx sample must be non-trivial");
    assert.equal(docxBytes[0], 0x50 /* P */, "docx starts with ZIP/PK magic");
    assert.equal(docxBytes[1], 0x4b /* K */);

    const md = await fetch(`http://127.0.0.1:${port}/samples/the-lantern-tales.md`);
    assert.equal(md.status, 200, "markdown sample must be served");
    const mdText = await md.text();
    assert.ok(mdText.length > 100, "markdown sample body present");

    const missing = await fetch(`http://127.0.0.1:${port}/samples/no-such-sample.docx`);
    assert.equal(missing.status, 404, "missing sample is 404, not 500");
  } finally {
    server.close();
  }

  const dockerignore = readFileSync(join(process.cwd(), ".dockerignore"), "utf-8");
  assert.ok(
    /!public\/samples\/\*\*/.test(dockerignore),
    ".dockerignore must except public/samples/** so *.md samples ship in Docker"
  );

  const clientSrc = readFileSync(join(process.cwd(), "src", "client", "app.ts"), "utf-8");
  assert.ok(
    /resp\.ok/.test(clientSrc) && /Could not download sample \(HTTP/.test(clientSrc),
    "selectSample must check resp.ok and surface HTTP status"
  );
  assert.ok(/filePicked/.test(clientSrc), "client shows a selected-file status line");
  console.log("  sample library ok: static bytes + dockerignore exception + client resp.ok");
}

async function testCompileIncrementsCounter() {
  // End-to-end: a successful /api/compile bumps the `compiles` counter that
  // /metrics exposes when authorized. Save/restore so we do not clobber a
  // developer shell token (and so a wrong pre-set token cannot fail auth).
  await withCleanEnv(
    ["CC_METRICS_TOKEN"],
    async () => {
      const { app } = await import("../web.js");
      const server = app.listen(0);
      await new Promise<void>((r) => server.once("listening", () => r()));
      const port = (server.address() as { port: number }).port;
      const metricsHeaders = { authorization: "Bearer test-metrics-token" };
      try {
        const before =
          (
            (await (await fetch(`http://127.0.0.1:${port}/metrics`, { headers: metricsHeaders })).json()) as {
              counters: Record<string, number>;
            }
          ).counters.compiles ?? 0;

        const fd = new FormData();
        fd.append("file", new Blob(["# Tiny\n\nHello world."], { type: "text/markdown" }), "tiny.md");
        fd.append("task", "What does it say?");
        fd.append("token_budget", "2000");
        const compileRes = await fetch(`http://127.0.0.1:${port}/api/compile`, {
          method: "POST",
          body: fd,
        });
        assert.equal(compileRes.status, 200, "compile succeeds for a tiny markdown upload");

        const after =
          (
            (await (await fetch(`http://127.0.0.1:${port}/metrics`, { headers: metricsHeaders })).json()) as {
              counters: Record<string, number>;
            }
          ).counters.compiles ?? 0;
        assert.equal(after, before + 1, "compiles counter increments on success");
        console.log("  compile counter ok: /api/compile bumps compiles visible on /metrics");
      } finally {
        server.close();
      }
    },
    { CC_METRICS_TOKEN: "test-metrics-token" }
  );
}

/**
 * Regression: the section-card UI renders `selected_sections[].text`. An earlier
 * "drop duplicate bodies" optimization stripped that field from /api/compile and
 * left empty cards (titles only) while CI still passed — because a test asserted
 * the strip. Keep text on the web response; MCP may still strip separately.
 */
async function testWebCompileSectionCardsHaveText() {
  const { app } = await import("../web.js");
  const server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const port = (server.address() as { port: number }).port;
  try {
    const fd = new FormData();
    fd.append(
      "file",
      new Blob(["# Refund Policy\n\nCustomers may return items within 90 days written notice.\n"], {
        type: "text/markdown",
      }),
      "policy.md"
    );
    fd.append("task", "What is the return window?");
    fd.append("token_budget", "2000");
    const resp = await fetch(`http://127.0.0.1:${port}/api/compile`, { method: "POST", body: fd });
    assert.equal(resp.status, 200, "compile succeeds");
    const body = (await resp.json()) as {
      selected_sections: Array<{ id: string; text?: string }>;
      markdown: string;
    };
    assert.ok(body.selected_sections.length > 0, "at least one selected section");
    for (const s of body.selected_sections) {
      assert.equal(typeof s.text, "string", `section ${s.id} must include text for the card UI`);
      assert.ok((s.text as string).length > 0, `section ${s.id} text must be non-empty`);
    }
    assert.ok(body.markdown.includes("90 days"), "compiled markdown still carries the answer");
    console.log("  web section-text ok: /api/compile keeps selected_sections[].text for the UI");
  } finally {
    server.close();
  }
}

async function testNoStdoutInMcpPath() {
  // The MCP server speaks JSON-RPC over stdout, so any module it can reach must
  // never write there. Guard it: scan src for console.log / process.stdout,
  // skipping the web-only server, the browser client, and tests.
  const { readdirSync, readFileSync: readSrc, statSync } = await import("node:fs");
  const { join: joinPath } = await import("node:path");
  const offenders: string[] = [];
  const scan = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const p = joinPath(dir, name);
      if (statSync(p).isDirectory()) {
        if (name !== "client" && name !== "tests") scan(p);
        continue;
      }
      if (!name.endsWith(".ts") || p.endsWith("web.ts")) continue;
      const src = readSrc(p, "utf-8");
      if (/console\.log\s*\(/.test(src) || /process\.stdout/.test(src)) offenders.push(p);
    }
  };
  scan(joinPath(process.cwd(), "src"));
  assert.deepEqual(offenders, [], `MCP-path modules must not write to stdout: ${offenders.join(", ")}`);
  console.log("  mcp-stdout guard ok: no stdout writes in the MCP server's module path");
}

async function testSmallFilePassthrough() {
  const path = testTmpPath(`cc-tiny-${Date.now()}.md`);
  writeFileSync(path, "# Tiny\n\nJust a small note about nothing.");
  try {
    const r = await compileContext(path, "anything", 4000);
    assert.ok(r.markdown.includes("small note"), "tiny file content survives compile");
    assert.ok(r.selected_sections.length >= 1, "tiny file selects at least one section");
    console.log("  passthrough ok: tiny file compiles without whole-doc short-circuit");
  } finally {
    unlinkSync(path);
  }
}

/**
 * Regression: when rawTokens ≤ budget, do NOT dump the whole doc.
 * Pointed query + spare budget must omit zero-relevance fillers and set early_stopped.
 */
async function testNoWholeFileDumpAboveRawTokens() {
  const path = testTmpPath(`cc-no-dump-${Date.now()}.md`);
  const doc = [
    "# Annual Report",
    "",
    "## Product development",
    "The Helix e-cargo prototype and Orbit GPS tracker R&D programs were cancelled",
    "because component costs made unit economics unviable.",
    "",
    "## Letter from the CEO",
    "Dear shareholders, we had a strong year overall with revenue growth.",
    "Lorem corporate filler. ".repeat(20),
    "",
    "## Company overview",
    "We make bicycles and accessories for urban riders.",
    "More unrelated overview text. ".repeat(20),
    "",
    "## Financial highlights",
    "Revenue was up. Gross margin improved. Unrelated to R&D cancellations.",
    "Numbers and boilerplate. ".repeat(20),
    "",
    "## Awards and recognition",
    "Industry awards for design excellence this year.",
    "Award filler. ".repeat(15),
  ].join("\n");
  writeFileSync(path, doc);
  try {
    const task = "Which R&D programs were cancelled and why?";
    const at400 = await compileContext(path, task, 400);
    const raw = at400.raw_tokens;
    assert.ok(raw > 0 && raw < 2000, `fixture should be mid-size, got raw=${raw}`);
    // Budget above raw — old short-circuit would select every section including 0%.
    const overRaw = raw + 200;
    const big = await compileContext(path, task, overRaw);
    assert.ok(big.raw_tokens <= overRaw, "budget exceeds raw (short-circuit temptation)");
    assert.ok(big.omitted_sections.length > 0, "must omit sections even when budget ≥ raw");
    assert.ok(
      !big.selected_sections.some((s) => (s.relevance ?? 0) === 0),
      `must not select 0% sections: ${big.selected_sections.map((s) => s.id + "@" + s.relevance).join(",")}`
    );
    assert.ok(big.compile_hints.early_stopped, "spare budget → early_stopped / Packed enough");
    assert.ok(/cancelled|Helix|Orbit/i.test(big.markdown), "answer-bearing content must still be packed");
    // Larger budget must not grow via zero/low fillers once 400 answers.
    const ids400 = at400.selected_sections
      .map((s) => s.id)
      .sort()
      .join(",");
    const idsBig = big.selected_sections
      .map((s) => s.id)
      .sort()
      .join(",");
    assert.equal(ids400, idsBig, `section ids stable 400→${overRaw}: ${ids400}→${idsBig}`);
    assert.ok(
      !at400.selected_sections.some((s) => (s.relevance ?? 0) === 0),
      "400 must not include 0% either"
    );
    console.log(
      `  no whole-file dump ok: raw=${raw} @400→${at400.selected_sections.length} @${overRaw}→${big.selected_sections.length} stop=${big.compile_hints.early_stopped}`
    );
  } finally {
    unlinkSync(path);
  }
}

async function testFormatConversion() {
  // Every other test writes a synthetic .md straight to disk and never
  // touches convertToMarkdown()/markitdown at all — so no test actually
  // proved any real-world file format converts correctly. pptx and csv had
  // zero coverage anywhere (not even a sample in the demo). Lock both in
  // through the real pipeline, not a stub.
  const pptx = await compileContext(join(FIXTURES_DIR, "deck.pptx"), "What is planned for Q2?", 4000);
  assert.ok(pptx.markdown.includes("Add billing"), "pptx slide content survives real conversion");
  assert.ok(pptx.markdown.includes("Risks"), "pptx second slide also converts");

  const csv = await compileContext(
    join(FIXTURES_DIR, "data.csv"),
    "Who is in the Platform department?",
    4000
  );
  assert.ok(
    csv.markdown.includes("Asha Rao") && csv.markdown.includes("Priya Nair"),
    "csv rows survive as a markdown table"
  );

  console.log("  format conversion ok: pptx + csv verified through the real convert.ts/markitdown path");
}

async function testImageConversionFailsClearly() {
  // Discovered while investigating format coverage: markitdown exits 0 with
  // EMPTY stdout for a plain image when no OCR/captioning backend is
  // configured (no LLM key in this environment/CI) — there is no stderr, no
  // thrown error from markitdown itself. Without the empty-output check in
  // convert.ts, a bare image upload would silently produce a compiled
  // "context" with nothing in it. Lock in that this fails LOUD and clear
  // instead, with a message that tells the user why.
  await assert.rejects(
    () => compileContext(join(FIXTURES_DIR, "invoice.png"), "What is the total?", 4000),
    (err: unknown) => err instanceof Error && /empty output/i.test(err.message) && /OCR/i.test(err.message),
    "image with no OCR/captioning configured fails with a clear, actionable error"
  );
  console.log("  image-without-ocr ok: fails loudly with an actionable message instead of silently empty");
}

async function testClientBuildIsPlainScript() {
  // Regression guard: a single stray `export` (or `import`) anywhere at the
  // top level of src/client/{app,types}.ts turns that file into an ES
  // module, which makes tsc emit CommonJS `exports`/`require(...)` even
  // under tsconfig.client.json's module:"none" — code that throws instantly
  // in a browser (no `exports` object exists there). This exact bug slipped
  // through once already (an `export` accidentally left on one interface in
  // types.ts broke every type reference in app.ts). `npm run build` must run
  // before this test for public/app.js and public/types.js to exist.
  for (const f of ["public/app.js", "public/types.js"]) {
    const path = join(process.cwd(), f);
    assert.ok(existsSync(path), `${f} must exist — run npm run build first`);
    const src = readFileSync(path, "utf-8");
    assert.ok(
      !/\bexports\./.test(src),
      `${f} must not contain CommonJS "exports." (module leaked into a plain <script>)`
    );
    assert.ok(
      !/\brequire\(/.test(src),
      `${f} must not contain "require(" (module leaked into a plain <script>)`
    );
  }
  console.log("  client build ok: app.js/types.js are plain scripts, no CommonJS leakage");
}

async function testPathGuardBlocksSymlinkEscape() {
  // Security regression (audit #3): a symlink inside CC_ROOT pointing OUTSIDE
  // it must not be readable through the MCP path check. Before the realpath
  // fix, checkPath did a string-only comparison and happily read /etc/passwd
  // via such a symlink.
  const root = mkdtempSync(join(tmpdir(), "cc-root-"));
  const secretDir = mkdtempSync(join(tmpdir(), "cc-secret-"));
  const secret = join(secretDir, "secret.txt");
  writeFileSync(secret, "TOP SECRET");
  try {
    // A legitimate file inside the root resolves fine.
    const legit = join(root, "ok.txt");
    writeFileSync(legit, "hello");
    assert.equal(checkPathWithin(root, legit), realpathSync(legit), "a real file inside root is allowed");

    // A symlink inside the root pointing outside must be rejected.
    const escape = join(root, "innocent.txt");
    symlinkSync(secret, escape);
    assert.throws(
      () => checkPathWithin(root, escape),
      /outside the allowed root|outside allowed root/,
      "symlink escaping CC_ROOT must be denied"
    );

    // A plain path traversal is also denied.
    assert.throws(
      () => checkPathWithin(root, join(root, "..", "..", "etc", "passwd")),
      /outside the allowed root|outside allowed root|Not a readable file/
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(secretDir, { recursive: true, force: true });
  }
  console.log("  path guard ok: symlink escape + traversal denied, real in-root file allowed");
}

async function testUploadGuardRejectsBombAndMismatch() {
  // Security regression (audit #1/#8): a zip bomb renamed to an allowed
  // extension must be rejected by declared uncompressed size, and content must
  // match the claimed extension.
  const bomb = readFileSync(join(FIXTURES_DIR, "bomb.xlsx")); // ~250KB on disk, ~250MB uncompressed
  assert.throws(
    () => validateUpload("bomb.xlsx", bomb),
    (e: unknown) => e instanceof UploadRejected && /decompression bomb|expands/i.test((e as Error).message),
    "decompression bomb must be rejected before conversion"
  );

  // A real zip renamed .pdf fails the PDF magic-byte check.
  assert.throws(
    () => validateUpload("evil.pdf", bomb),
    (e: unknown) => e instanceof UploadRejected && /valid PDF/i.test((e as Error).message),
    "content/extension mismatch must be rejected"
  );

  // A binary blob renamed .txt is caught by the NUL-byte heuristic.
  assert.throws(
    () => validateUpload("sneaky.txt", Buffer.from([0x00, 0x01, 0x02, 0x00])),
    (e: unknown) => e instanceof UploadRejected,
    "binary content in a .txt must be rejected"
  );

  // A genuine small docx passes untouched.
  const goodPptx = readFileSync(join(FIXTURES_DIR, "deck.pptx"));
  assert.doesNotThrow(() => validateUpload("deck.pptx", goodPptx), "a real pptx must pass validation");
  console.log("  upload guard ok: bomb + type-mismatch + binary-as-text rejected, real file allowed");
}

async function testConversionErrorIsSanitized() {
  // Security regression (audit #4): a converter failure must not leak the raw
  // Python traceback or absolute server paths to the caller.
  await assert.rejects(
    () => convertToMarkdown(join(FIXTURES_DIR, "malformed.pdf")),
    (e: unknown) => {
      assert.ok(e instanceof ConversionError, "should be a ConversionError");
      const m = (e as Error).message;
      assert.ok(!/Traceback/i.test(m), "must not contain a Python traceback");
      assert.ok(!/\/usr\/|\/app\/|site-packages|dist-packages/.test(m), "must not contain server paths");
      return true;
    }
  );
  console.log("  error hygiene ok: conversion failure returns a generic, path-free message");
}

function testEnvParsingFailsSafe() {
  // Security regression (audit #6): a non-numeric env var must fall back to the
  // default instead of becoming NaN (which silently disabled the rate limiter).
  process.env.CC_TEST_INT = "abc";
  assert.equal(intEnv("CC_TEST_INT", 30, 1), 30, "non-numeric int env -> default");
  process.env.CC_TEST_INT = "-5";
  assert.equal(intEnv("CC_TEST_INT", 30, 1), 1, "negative int env -> clamped to min");
  process.env.CC_TEST_INT = "999999";
  assert.equal(intEnv("CC_TEST_INT", 30, 1, 100), 100, "over-max int env -> clamped to max");
  delete process.env.CC_TEST_INT;
  assert.equal(intEnv("CC_TEST_INT", 30, 1), 30, "missing env -> default");
  process.env.CC_TEST_NUM = "not-a-number";
  assert.equal(numEnv("CC_TEST_NUM", 3.0, 0), 3.0, "non-numeric float env -> default");
  delete process.env.CC_TEST_NUM;
  console.log("  env parsing ok: NaN/blank/out-of-range all fall back safely");
}

function testTrustProxyFailsSafe() {
  // Jul 18 P6: blanket CC_TRUST_PROXY=true must NOT enable spoofable XFF unless
  // the explicit insecure override is set.
  const savedTrust = process.env.CC_TRUST_PROXY;
  const savedAllow = process.env.CC_ALLOW_INSECURE_TRUST_PROXY;
  try {
    delete process.env.CC_TRUST_PROXY;
    delete process.env.CC_ALLOW_INSECURE_TRUST_PROXY;
    assert.equal(trustProxyFromEnv(), false, "default trust proxy is false");

    process.env.CC_TRUST_PROXY = "true";
    assert.equal(trustProxyFromEnv(), false, "true ignored without insecure override");

    process.env.CC_ALLOW_INSECURE_TRUST_PROXY = "1";
    assert.equal(trustProxyFromEnv(), true, "true allowed only with insecure override");

    delete process.env.CC_ALLOW_INSECURE_TRUST_PROXY;
    process.env.CC_TRUST_PROXY = "1";
    assert.equal(trustProxyFromEnv(), 1, "hop count 1 is accepted");

    process.env.CC_TRUST_PROXY = "false";
    assert.equal(trustProxyFromEnv(), false);
  } finally {
    if (savedTrust === undefined) delete process.env.CC_TRUST_PROXY;
    else process.env.CC_TRUST_PROXY = savedTrust;
    if (savedAllow === undefined) delete process.env.CC_ALLOW_INSECURE_TRUST_PROXY;
    else process.env.CC_ALLOW_INSECURE_TRUST_PROXY = savedAllow;
  }
  console.log("  trust proxy ok: true ignored unless insecure override; hop count works");
}

function testSanitizeSourceNameBlocksCommentBreakout() {
  // Jul 18 P11 + XSS/filename: crafted upload names must not break HTML comments
  // or inject markup into compiled-context headers.
  assert.equal(sanitizeSourceName("../../etc/passwd"), "passwd");
  const nasty = sanitizeSourceName("evil-->\n<script>alert(1)</script>.md");
  assert.ok(!nasty.includes("-->"), "HTML comment terminator stripped");
  assert.ok(!nasty.includes("<"), "angle brackets stripped");
  assert.ok(!/[\r\n]/.test(nasty), "newlines stripped");
  assert.ok(nasty.endsWith(".md") || nasty.includes("md"), "extension-ish retained safely");
  const compiled = assemble(sanitizeSourceName("break-->out.md"), [], []);
  assert.ok(compiled.startsWith("<!-- Compiled context from: break_out.md -->"));
  assert.ok(!compiled.includes("-->out"));
  console.log("  sanitizeSourceName ok: path strip + comment/XSS breakout blocked");
}

async function testConversionMissingPathIsPathFree() {
  await assert.rejects(
    () => convertToMarkdown(join(tmpdir(), "cc-no-such-file-" + Date.now() + ".md")),
    (e: unknown) => {
      assert.ok(e instanceof ConversionError);
      const m = (e as Error).message;
      assert.ok(!m.includes(tmpdir()), "must not echo absolute paths");
      assert.ok(!/\/Users\/|\/tmp\/|\/var\//.test(m), "must not contain filesystem roots");
      assert.match(m, /readable file/i);
      return true;
    }
  );
  console.log("  convert missing-path ok: ConversionError is path-free");
}

async function testCacheCorruptionFallsThrough() {
  // DR: corrupt/truncated cache payloads must miss (integrity sidecar), not poison answers.
  const dir = join(TEST_TMP, `cache-integrity-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  const prev = process.env.CC_CACHE_DIR;
  process.env.CC_CACHE_DIR = dir;
  try {
    const key = "a".repeat(64);
    cachePut(key, "# Good\n\nWarranty covers defects.\n");
    assert.equal(cacheGet(key), "# Good\n\nWarranty covers defects.\n", "integrity hit returns payload");

    writeFileSync(join(dir, `${key}.md`), "CORRUPT\x00LOST_ANSWER");
    assert.equal(cacheGet(key), null, "tampered .md with stale .sha → miss");
    assert.equal(existsSync(join(dir, `${key}.md`)), false, "bad .md deleted on integrity fail");

    // Legacy .md without .sha must miss (force reconvert), not serve unchecked.
    const legacyKey = "b".repeat(64);
    writeFileSync(join(dir, `${legacyKey}.md`), "# Legacy\n\nok\n");
    assert.equal(cacheGet(legacyKey), null, "pre-integrity .md without .sha → miss");

    const src = readFileSync(join(process.cwd(), "src", "cache.ts"), "utf-8");
    assert.ok(/renameSync/.test(src) && /\.md\.tmp/.test(src), "cache puts are atomic rename");
    assert.ok(/process\.pid/.test(src), "tmp names include pid to avoid concurrent clobber");
    assert.ok(/\.sha/.test(src) && /markdownSha/.test(src), "integrity sidecar present");
    console.log("  cache DR ok: integrity miss on tamper + atomic put");
  } finally {
    if (prev === undefined) delete process.env.CC_CACHE_DIR;
    else process.env.CC_CACHE_DIR = prev;
  }
}

async function testWeightedRateLimitBlocksAgentSpend() {
  // Jul 18 P0: agent/answer must cost more than one rate token so a single
  // IP cannot burn unbounded LLM spend under a naive request count.
  const { app } = await import("../web.js");
  const server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const port = (server.address() as { port: number }).port;
  try {
    const cfg = (await (await fetch(`http://127.0.0.1:${port}/api/config`)).json()) as {
      rate_limit: number;
      rate_cost_agent: number;
      rate_cost_answer: number;
      llm_available: boolean;
    };
    assert.ok(cfg.rate_cost_agent >= 8, "agent must be heavy vs one compile token");
    assert.ok(cfg.rate_cost_answer >= 2, "answer/parity must cost >1");
    assert.ok(
      cfg.rate_cost_agent > cfg.rate_cost_answer,
      "agent costs more than answer (burn-money asymmetry)"
    );
    // Default production window is 30 with agent cost 12 → ≤2 agent runs / 5 min.
    // This suite raises CC_RATE_LIMIT for LLM e2e, so only assert the cost knobs.

    // Missing key degradation: Prove/Agent refuse cleanly without LLM keys.
    await withCleanEnv([...LLM_PROVIDER_KEYS, ...LLM_MODEL_KEYS, "CC_LLM_BASE_URL"], async () => {
      const formAns = new FormData();
      formAns.append("task", "anything");
      formAns.append("file", new Blob(["# Hi\n\nHello."], { type: "text/markdown" }), "doc.md");
      const ans = await fetch(`http://127.0.0.1:${port}/api/answer`, { method: "POST", body: formAns });
      assert.equal(ans.status, 400, "answer without key → 400");
      const body = (await ans.json()) as { error?: string };
      assert.ok(body.error && /API key/i.test(body.error), "points at configuring a key");
      assert.ok(!/sk-|Bearer |traceback/i.test(body.error), "no secret/provider recon");

      const formAgent = new FormData();
      formAgent.append("task", "anything");
      formAgent.append("file", new Blob(["# Hi\n\nHello."], { type: "text/markdown" }), "doc.md");
      const agent = await fetch(`http://127.0.0.1:${port}/api/agent`, { method: "POST", body: formAgent });
      assert.equal(agent.status, 400, "agent without key → 400");
    });

    // Malformed / oversized multipart field (chaos): multer fieldSize 32kb.
    const big = new FormData();
    big.append("task", "x".repeat(40_000));
    big.append("file", new Blob(["# Hi\n\nok"], { type: "text/markdown" }), "doc.md");
    const huge = await fetch(`http://127.0.0.1:${port}/api/compile`, { method: "POST", body: big });
    assert.equal(huge.status, 413, "oversized form field → 413 JSON");
    const hugeBody = (await huge.json()) as { error?: string };
    assert.ok(hugeBody.error, "JSON error body, not HTML stack");
    assert.ok(!/at |\/Users\/|node_modules/.test(hugeBody.error!), "no stack/path leak");

    // Empty multipart / no file.
    const empty = new FormData();
    empty.append("task", "hi");
    const noFile = await fetch(`http://127.0.0.1:${port}/api/compile`, { method: "POST", body: empty });
    assert.equal(noFile.status, 400);

    console.log("  weighted rate + chaos ok: agent/answer costs; keyless 400; oversized field 413");
  } finally {
    server.close();
  }
}

async function testConcurrentCompileSameBytes() {
  // Chaos: two concurrent compiles of identical upload bytes must both succeed
  // (content-addressed saveUpload + exclusive create).
  const { app } = await import("../web.js");
  const server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const port = (server.address() as { port: number }).port;
  try {
    const body = "# Concurrent\n\nShared bytes for race " + Date.now() + ".\n";
    const mk = () => {
      const fd = new FormData();
      fd.append("task", "What is this about?");
      fd.append("token_budget", "500");
      fd.append("file", new Blob([body], { type: "text/markdown" }), "race.md");
      return fetch(`http://127.0.0.1:${port}/api/compile`, { method: "POST", body: fd });
    };
    const [a, b] = await Promise.all([mk(), mk()]);
    assert.equal(a.status, 200, "first concurrent compile succeeds");
    assert.equal(b.status, 200, "second concurrent compile succeeds");
    const ja = (await a.json()) as { handle?: string; markdown?: string };
    const jb = (await b.json()) as { handle?: string; markdown?: string };
    assert.ok(ja.handle && jb.handle, "both mint opaque handles");
    assert.ok(ja.markdown && jb.markdown, "both return compiled markdown");
    console.log("  concurrent same-bytes compile ok");
  } finally {
    server.close();
  }
}

async function testAnswerErrorsAreSanitized() {
  // Jul 18 P3: /api/answer must never return raw provider Error.message.
  const http = await import("node:http");
  const chat = http.createServer((_req, res) => {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: "secret recon /usr/lib/node_modules/openai boom sk-live-LEAK" }));
  });
  await new Promise<void>((r) => chat.listen(0, r));
  const chatPort = (chat.address() as { port: number }).port;

  await withCleanEnv([...LLM_PROVIDER_KEYS, ...LLM_MODEL_KEYS, "CC_LLM_BASE_URL"], async () => {
    process.env.CC_LLM_API_KEY = "test-key";
    process.env.CC_LLM_BASE_URL = `http://127.0.0.1:${chatPort}/v1`;

    const { app } = await import("../web.js");
    const server = app.listen(0);
    await new Promise<void>((r) => server.once("listening", () => r()));
    const port = (server.address() as { port: number }).port;
    try {
      const form = new FormData();
      form.append("task", "What is the notice period?");
      form.append("file", new Blob([makeTestDoc()], { type: "text/markdown" }), "doc.md");
      const res = await fetch(`http://127.0.0.1:${port}/api/answer`, { method: "POST", body: form });
      assert.ok([500, 503].includes(res.status), "failed answer stays in 5xx");
      const body = (await res.json()) as { error?: string };
      assert.ok(body.error, "JSON error");
      assert.ok(!/sk-live|node_modules|\/usr\/lib|Traceback/i.test(body.error!), "no provider recon");
      console.log("  answer error hygiene ok: generic client message on provider failure");
    } finally {
      server.close();
      chat.close();
    }
  });
}

async function testDiskStorageNotMemory() {
  // Jul 18 P2: multer must use disk storage (not memory) so large multipart
  // does not sit in V8 heap before the converter queue.
  const webSrc = readFileSync(join(process.cwd(), "src", "web.ts"), "utf-8");
  assert.ok(/diskStorage\s*\(/.test(webSrc), "web.ts uses multer.diskStorage");
  assert.ok(!/memoryStorage\s*\(/.test(webSrc), "web.ts must not use memoryStorage");
  console.log("  upload admission ok: diskStorage in web.ts (no memoryStorage)");
}

function testPathGuardMessagesArePathFree() {
  const root = mkdtempSync(join(tmpdir(), "cc-root-"));
  try {
    try {
      checkPathWithin(root, join(root, "missing.txt"));
      assert.fail("expected throw");
    } catch (e) {
      const m = String((e as Error).message);
      assert.ok(!m.includes(root), "missing-file error must not echo absolute root");
      assert.match(m, /readable file|Access denied/i);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
  console.log("  path-guard messages ok: no absolute paths in client-facing errors");
}

function testTokenizeCjkAndStem() {
  const zh = tokenize("退款需要多少天");
  assert.ok(zh.includes("退款"), "CJK bigrams include 退款");
  assert.ok(zh.includes("款需"), "CJK bigrams overlap across the run");
  assert.ok(zh.includes("退"), "CJK unigrams are emitted too");

  const en = tokenize("returning refunds processed");
  assert.ok(en.includes("return"), "light stem: returning → return");
  assert.ok(en.includes("refund"), "light stem: refunds → refund");
  assert.ok(en.includes("process"), "light stem: processed → process");
  console.log("  tokenize ok: CJK bigrams + light English stem");
}

function testTokenizeQueryCleanupAndHonorific() {
  const q = tokenizeQuery("What does Mr. Bingley think of Jane Bennet early on?");
  assert.ok(!q.includes("what") && !q.includes("doe") && !q.includes("of"), "question/stop words dropped");
  assert.ok(!q.includes("early"), "filler phrase 'early on' stripped");
  assert.ok(q.includes("bingley") && q.includes("think") && q.includes("bennet"));
  assert.ok(!q.includes("jane"), "given name dropped when honorific expansion covers Jane Bennet");
  assert.ok(q.includes("miss"), "Jane Bennet expands to Miss … for book-style naming");
  assert.ok(q.includes("mr") || q.includes("mrs"), "honorific variants included");

  // Docs still keep stopwords — only the query path filters.
  const docTok = tokenize("What does early on mean here");
  assert.ok(docTok.includes("what") || docTok.includes("early"), "document tokenize unchanged");

  // Hyphenated Title Case must not invent honorifics (Red-Headed → Headed League).
  const league = tokenizeQuery("What is the Red-Headed League?");
  assert.ok(!league.includes("miss") && !league.includes("mrs"), "no false honorifics on Red-Headed League");
  assert.ok(league.includes("red") && league.includes("league"), "league keywords kept");

  // Sherlock Holmes is a real Cap Cap name pair — expansion OK; Holmes kept.
  const holmes = tokenizeQuery("Why does the King of Bohemia come to Sherlock Holmes?");
  assert.ok(holmes.includes("holme") || holmes.includes("holmes"), "Holmes kept");
  assert.ok(!holmes.includes("sherlock"), "given name dropped for Holmes honorific path");

  // Negation must survive so "not cover" ≠ "cover".
  const neg = tokenizeQuery("What does the K2 warranty not cover?");
  assert.ok(neg.includes("not"), "negation kept in query");
  assert.ok(neg.includes("warranty") && neg.includes("cover"));

  // Multilingual stopwords: particles must not survive to steer BM25.
  const hi = tokenizeQuery("यह किताब किस बारे में है?");
  assert.ok(!hi.includes("में") && !hi.includes("है") && !hi.includes("किस"), "Hindi glue dropped");
  const es = tokenizeQuery("¿De qué trata este libro?");
  assert.ok(!es.includes("de") && !es.includes("qué") && !es.includes("este"), "Spanish glue dropped");
  const ru = tokenizeQuery("О чём эта книга?");
  assert.ok(!ru.includes("чём") && !ru.includes("эта"), "Russian glue dropped");
  // All-glue vague queries may be empty (recall insurance) or keep a content noun only.
  assert.ok(
    hi.every((t) => t.length > 1),
    "no empty-string Hindi tokens"
  );

  // Arabic harakat normalized so vocalized query matches bare document form.
  const arQ = tokenizeQuery("ماذا وجد الخبّاز؟");
  const arDoc = tokenize("وجد الخباز صرّة");
  assert.ok(arQ.includes("الخباز"), "Arabic query drops shadda for matching");
  assert.ok(arDoc.includes("الخباز"), "Arabic doc drops shadda for matching");
  assert.ok(arQ.includes("وجد") && arDoc.includes("وجد"), "shared Arabic stem kept");

  console.log(
    "  tokenizeQuery ok: stopwords/fillers, Jane→Miss, multilingual glue, Arabic marks, negation kept"
  );
}

function testNameIntentDetectionAndBoost() {
  const task = "What is Ms. Bingley's first name?";
  assert.deepEqual(detectNameIntent(task), { surname: "bingley" });
  assert.equal(detectNameIntent("What does Mr. Bingley think of Jane?"), null);
  assert.equal(detectNameIntent("jane and darcy at the ball"), null);

  assert.ok(chunkHasGivenNameSpan("Yours ever,\n\nCAROLINE BINGLEY.", "bingley"));
  assert.ok(!chunkHasGivenNameSpan("Miss Bingley danced twice.", "bingley"));
  assert.ok(chunkHasGivenNameSpan("Caroline Bingley wrote the note.", "bingley"));
  assert.ok(!chunkHasGivenNameSpan("The Thornton family had long been fixtures.", "thornton"));
  assert.ok(!chunkHasGivenNameSpan("Young Thornton fell asleep.", "thornton"));

  const honorificHeavy = Array.from({ length: 8 }, (_, i) => ({
    id: `s${i}`,
    breadcrumb: "Book > Ch",
    text: `Miss Bingley appeared again in paragraph ${i}. Bingley smiled.`,
    order: i,
    tokens: 50,
  }));
  const signature = {
    id: "s8",
    breadcrumb: "Book > Ch",
    text: "The letter closed with CAROLINE BINGLEY.",
    order: 8,
    tokens: 40,
  };
  const chunks = [...honorificHeavy, signature];
  const base = bm25Scores(task, chunks);
  const boosted = applyNameIntentBoost(task, chunks, base);
  const sigIdx = chunks.length - 1;
  assert.ok(
    boosted[sigIdx]! > boosted[0]!,
    "given-name signature chunk should outrank honorific-only Bingley chunks"
  );

  const order = boosted.map((s, i) => ({ id: chunks[i]!.id, s })).sort((a, b) => b.s - a.s);
  assert.equal(order[0]!.id, "s8", "boosted rank should lead with signature chunk");

  const part1 = {
    id: "s0",
    breadcrumb: "Book > Ch",
    text: "Miss Bingley talked all evening.",
    order: 0,
    tokens: 50,
  };
  const part2 = {
    id: "s1",
    breadcrumb: "Book > Ch",
    text: "Signed CAROLINE BINGLEY.",
    order: 1,
    tokens: 40,
  };
  const splitRanked = prepareRankedForPack([part1, part2], [part1, part2], task);
  assert.equal(splitRanked[0]!.id, "s1", "split sibling with given name promoted ahead of honorific half");

  assert.equal(splitTaskAspects("jane and darcy at the ball").length, 1, "noun list stays single-aspect");
  console.log("  name-intent ok: detect, given-name span, boost, sibling promote");
}

async function testNameIntentCompilePrideAndPrejudice() {
  const path = join(process.cwd(), "public", "samples", "pride-and-prejudice.docx");
  if (!existsSync(path)) {
    console.log("  name-intent P&P skipped: sample docx not present");
    return;
  }
  const task = "What is Ms. Bingley's first name?";
  const at1000 = await compileContext(path, task, 1000, "Pride and Prejudice");
  const at4000 = await compileContext(path, task, 4000, "Pride and Prejudice");
  assert.ok(/caroline/i.test(at1000.markdown), "1000 budget must include Caroline");
  assert.ok(/caroline/i.test(at4000.markdown), "4000 budget must include Caroline");
  const ids1000 = at1000.selected_sections
    .map((s) => s.id)
    .sort()
    .join(",");
  const ids4000 = at4000.selected_sections
    .map((s) => s.id)
    .sort()
    .join(",");
  assert.equal(ids4000, ids1000, "4000 must select the same sections as 1000 once name-intent is covered");
  assert.ok(at4000.compile_hints?.early_stopped, "4000 should stop once Caroline is in — not novel-fill");
  assert.ok(
    at4000.selected_sections.length < 6,
    `4000 must not vacuum Bingley chapters: got ${at4000.selected_sections.length}`
  );
  console.log(
    `  name-intent P&P ok: 1000→${at1000.selected_sections.length} sel/${at1000.tokens_used} tok, ` +
      `4000→${at4000.selected_sections.length} sel/${at4000.tokens_used} tok, ` +
      `early_stopped=${at4000.compile_hints?.early_stopped ?? false}`
  );
}

async function testNameIntentSyntheticCompile() {
  const src = join(FIXTURES_DIR, "name-intent-synthetic.md");
  const path = testTmpPath(`name-intent-${Date.now()}.md`);
  writeFileSync(path, readFileSync(src, "utf-8"));
  mkdirSync(join(TEST_TMP, "cache"), { recursive: true });
  const prevCache = process.env.CC_CACHE_DIR;
  process.env.CC_CACHE_DIR = join(TEST_TMP, "cache");
  try {
    const r = await compileContext(path, "What is Miss Thornton's given name?", 500);
    assert.ok(/sarah/i.test(r.markdown), "synthetic fixture must surface SARAH THORNTON");
    console.log("  name-intent synthetic ok: Sarah Thornton in compiled markdown");
  } finally {
    if (prevCache === undefined) delete process.env.CC_CACHE_DIR;
    else process.env.CC_CACHE_DIR = prevCache;
    try {
      unlinkSync(path);
    } catch {
      /* ignore */
    }
  }
}

async function testSherlockRedHeadedLeagueSalaryHours() {
  /**
   * Compile-only @1000: multi-facet salary + hours must pack both answer
   * sheets (Policy B partial of the hours passage). Shared Wilson tokens must
   * not make the salary sheet "cover" hours — and the hours sheet must not be
   * buried as low-relevance omit when left out.
   */
  const samples = join(process.cwd(), "public", "samples");
  const path = join(samples, "sherlock-holmes.docx");
  if (!existsSync(path)) {
    console.log("  sherlock salary/hours skipped: sample not present");
    return;
  }
  const task = "What salary does the Red-Headed League offer, and what hours must Wilson keep?";
  const md = await fullMarkdown(path);
  const chunks = chunkMarkdown(md);
  const queries = splitQueries(task);
  const rows = perQueryScores(queries, chunks);
  const bests = queryBestIdsFromRows(rows, chunks, queries);
  assert.equal(bests.length, 2, "two facet bests");
  assert.notEqual(bests[0], bests[1], "salary and hours must pick distinct best sections");
  const hoursBest = chunks.find((c) => c.id === bests[1]!);
  assert.ok(/ten to two/i.test(hoursBest?.text ?? ""), "hours facet best must be the Ten-to-two passage");

  const r = await compileContext(path, task, 1000);

  assert.ok(r.queries.length >= 2, "salary/hours must split into facets");
  assert.ok(/£\s*4|salary of/i.test(r.markdown), "compile must include £4 salary");
  assert.ok(/ten to two/i.test(r.markdown), "compile must include Ten to two hours");

  const hoursSel = r.selected_sections.find((s) => /ten to two/i.test(s.text ?? ""));
  assert.ok(hoursSel, "hours-bearing section must be selected");
  assert.ok(
    hoursSel!.truncated || (hoursSel!.tokens ?? 0) < 500,
    "oversized hours sheet should enter as a budget partial when needed"
  );

  // If somehow omitted, it belongs in budget-omit (facet gap), not relevance-omit.
  const hoursOmitRel = r.relevance_omitted_sections.find((s) => s.id === hoursSel?.id);
  assert.ok(!hoursOmitRel, "selected hours section must not also be relevance-omitted");
  for (const s of r.relevance_omitted_sections) {
    assert.ok(
      (s.relevance ?? 0) < 95 || s.tokens < 50,
      `near-top answer peer must not be buried as relevance-omit: ${s.id}@${s.relevance}%`
    );
  }
  assert.ok(r.tokens_used <= 1000, `budget hold: ${r.tokens_used}`);
  console.log(
    `  sherlock salary/hours @1000 ok: sel=${r.selected_sections.map((s) => `${s.id}${s.truncated ? "T" : ""}@${s.relevance}%`).join(",")} ` +
      `budget_omit=${r.budget_omitted_sections.map((s) => s.id).join(",") || "(none)"}`
  );
}

async function testCoveragePackMatrixRegression() {
  /**
   * Anti-whack-a-mole gate: ANY cell failure fails the suite.
   * Do not land a pack change that improves one cell by breaking another.
   */
  const samples = join(process.cwd(), "public", "samples");
  if (!existsSync(join(samples, "meridian-financials.xlsx"))) {
    console.log("  coverage pack matrix skipped: sample library not present");
    return;
  }

  async function compile(file: string, task: string, budget: number) {
    return compileContext(join(samples, file), task, budget);
  }

  const mfTask = "What was net profit in FY25, and which quarter had the best gross margin?";

  // --- FY25 multi-facet @100: correct facets beat wrong wholes ---
  const mf100 = await compile("meridian-financials.xlsx", mfTask, 100);
  assert.ok(
    mf100.selected_sections.some((s) => s.section.includes("Five-Year")),
    `FY25@100 must include Five-Year (net profit), got ${mf100.selected_sections.map((s) => s.section).join(",")}`
  );
  assert.ok(
    !mf100.selected_sections.some((s) => s.section.includes("Segments")),
    "FY25@100 must not select weak Segments over facet winners"
  );
  assert.ok(/net profit|51\.0/i.test(mf100.markdown), "FY25@100 markdown must carry net-profit signal");
  assert.ok(mf100.tokens_used <= 100, `FY25@100 budget hold: ${mf100.tokens_used}`);

  // --- Revenue FY21→FY25 @100: 100% Five-Year partial beats mid-score Segments whole ---
  // Shared tokens (revenue/FY21/FY25) inflate Segments to ~76% even though the
  // answer lives only in Five-Year. Partial of the top sheet must win.
  const revTask = "How did revenue change from FY21 to FY25?";
  const rev100 = await compile("meridian-financials.xlsx", revTask, 100);
  const revFive = rev100.selected_sections.find((s) => s.section.includes("Five-Year"));
  assert.ok(
    revFive,
    `revenue@100 must include Five-Year (100% sheet), got ${rev100.selected_sections.map((s) => `${s.section}@${s.relevance}%`).join(",")}`
  );
  assert.ok(revFive!.truncated, "revenue@100 Five-Year must be truncated (policy B partial)");
  assert.ok(
    !rev100.selected_sections.some((s) => s.section.includes("Segments")),
    "revenue@100 must not admit mid-score Segments over truncating Five-Year"
  );
  assert.ok(
    /262|482|Revenue \(Rs cr\)/i.test(rev100.markdown),
    "revenue@100 partial must carry FY revenue row"
  );
  assert.ok(rev100.tokens_used <= 100, `revenue@100 budget hold: ${rev100.tokens_used}`);

  // --- FY25 @200 parity: both facets ---
  const mf200 = await compile("meridian-financials.xlsx", mfTask, 200);
  assert.ok(
    mf200.selected_sections.some((s) => s.section.includes("Five-Year")),
    "FY25@200 Five-Year"
  );
  assert.ok(
    mf200.selected_sections.some((s) => s.section.includes("Quarterly")),
    "FY25@200 Quarterly"
  );
  assert.ok(!mf200.selected_sections.some((s) => s.section.includes("Segments")), "FY25@200 no Segments");
  assert.ok(/net profit|51\.0/i.test(mf200.markdown), "FY25@200 net profit");
  assert.ok(/gross margin|35\.|Q4/i.test(mf200.markdown), "FY25@200 gross margin");

  // --- FY25 @800 both facets ---
  const mf800 = await compile("meridian-financials.xlsx", mfTask, 800);
  assert.ok(mf800.selected_sections.length >= 2, "FY25@800 ≥2 sheets");
  assert.ok(/net profit|51\.0/i.test(mf800.markdown) && /margin|Q4/i.test(mf800.markdown), "FY25@800 facets");

  // --- Small xlsx single-facet: coverage met → no workbook dump ---
  const fin1k = await compile("meridian-financials.xlsx", "What was net profit in FY25?", 1000);
  const fin4k = await compile("meridian-financials.xlsx", "What was net profit in FY25?", 4000);
  assert.equal(fin1k.selected_sections.length, 1, "fin single @1000 one sheet");
  assert.equal(fin4k.selected_sections.length, 1, "fin single @4000 one sheet");
  assert.equal(fin1k.selected_sections[0]!.id, fin4k.selected_sections[0]!.id, "fin ids stable");

  // --- Vague query must not whole-doc dump ---
  const vagueLt = await compile("the-lantern-tales.md", "What is the story about?", 4000);
  assert.ok(vagueLt.selected_sections.length < 25, `vague lantern dump: ${vagueLt.selected_sections.length}`);
  const vagueHi = await compile("chhoti-kahaniyan.md", "यह किताब किस बारे में है?", 8000);
  assert.ok(vagueHi.selected_sections.length < 13, `vague Hindi dump: ${vagueHi.selected_sections.length}`);
  assert.ok(
    vagueHi.selected_sections.length <= 3,
    `vague Hindi must stay compact: ${vagueHi.selected_sections.length}`
  );
  assert.ok(vagueHi.compile_hints.early_stopped, "vague Hindi early_stopped");

  // --- Non-English pointed: correct section, stable across large budgets, no dump ---
  const hiPointed = "ईमानदार चायवाले को अंगूठी लौटाने पर क्या मिला?";
  const hi1k = await compile("chhoti-kahaniyan.md", hiPointed, 1000);
  const hi4k = await compile("chhoti-kahaniyan.md", hiPointed, 4000);
  const hi8k = await compile("chhoti-kahaniyan.md", hiPointed, 8000);
  assert.ok(
    hi1k.selected_sections.some((s) => s.section.includes("चायवाला")),
    `Hindi pointed must select tea-seller story, got ${hi1k.selected_sections.map((s) => s.section).join(",")}`
  );
  assert.ok(hi1k.markdown.includes("अंगूठी"), "Hindi pointed markdown carries the ring");
  assert.equal(
    hi1k.selected_sections.map((s) => s.id).join(","),
    hi4k.selected_sections.map((s) => s.id).join(","),
    "Hindi pointed ids stable 1000→4000"
  );
  assert.equal(
    hi1k.selected_sections.map((s) => s.id).join(","),
    hi8k.selected_sections.map((s) => s.id).join(","),
    "Hindi pointed ids stable 1000→8000"
  );
  assert.ok(hi8k.selected_sections.length <= 2, "Hindi pointed must not vacuum stories");
  assert.ok(hi4k.compile_hints.early_stopped, "Hindi pointed early_stopped at 4000");

  const hiVague4k = await compile("chhoti-kahaniyan.md", "यह किताब किस बारे में है?", 4000);
  assert.ok(
    hiVague4k.selected_sections.length <= 3,
    `Hindi vague @4000 compact: ${hiVague4k.selected_sections.length}`
  );
  assert.ok(
    hiVague4k.selected_sections.length <
      hiVague4k.selected_sections.length + hiVague4k.omitted_sections.length,
    "Hindi vague must omit sections (no whole-doc)"
  );

  const esPointed = "¿Qué encontró el panadero escondido en la harina?";
  const es1k = await compile("cuentos-breves.md", esPointed, 1000);
  const es4k = await compile("cuentos-breves.md", esPointed, 4000);
  assert.ok(
    es1k.selected_sections.some((s) => /panadero/i.test(s.section)),
    "Spanish pointed selects panadero"
  );
  assert.ok(es1k.markdown.includes("monedas"), "Spanish pointed carries monedas");
  assert.equal(
    es1k.selected_sections.map((s) => s.id).join(","),
    es4k.selected_sections.map((s) => s.id).join(","),
    "Spanish pointed ids stable 1000→4000"
  );

  const esVague = await compile("cuentos-breves.md", "¿De qué trata este libro?", 4000);
  assert.ok(
    esVague.selected_sections.length <= 3,
    `Spanish vague compact: ${esVague.selected_sections.length}`
  );
  assert.ok(esVague.omitted_sections.length > 0, "Spanish vague omits");

  const ruPointed = "Что нашёл извозчик в санях?";
  const ru1k = await compile("korotkie-rasskazy.md", ruPointed, 1000);
  const ru4k = await compile("korotkie-rasskazy.md", ruPointed, 4000);
  assert.ok(ru1k.markdown.includes("кошелёк") || ru1k.markdown.includes("кошелек"), "Russian pointed wallet");
  assert.equal(
    ru1k.selected_sections.map((s) => s.id).join(","),
    ru4k.selected_sections.map((s) => s.id).join(","),
    "Russian pointed ids stable"
  );

  const hqPointed = "ماذا وجد الخبّاز مخبّأً في كيس الطحين؟";
  const hq1k = await compile("hikayat-qasira.md", hqPointed, 1000);
  const hq4k = await compile("hikayat-qasira.md", hqPointed, 4000);
  assert.ok(hq1k.markdown.includes("صرّة") || hq1k.markdown.includes("نقود"), "Arabic pointed purse");
  assert.equal(
    hq1k.selected_sections.map((s) => s.id).join(","),
    hq4k.selected_sections.map((s) => s.id).join(","),
    "Arabic pointed ids stable"
  );

  // Hindi multi-aspect: both stories once budget fits
  const hiMulti = "ईमानदार चायवाले को क्या मिला, और आम का पेड़ किसके हिस्से आया?";
  const hiM1k = await compile("chhoti-kahaniyan.md", hiMulti, 1000);
  assert.ok(
    hiM1k.selected_sections.some((s) => s.section.includes("चायवाला")),
    "Hindi multi includes tea-seller"
  );
  assert.ok(
    hiM1k.selected_sections.some((s) => s.section.includes("आम")),
    "Hindi multi includes mango-tree"
  );
  assert.ok(hiM1k.selected_sections.length <= 3, "Hindi multi must not pull distractors");

  // --- P&P Jane/Bingley id-stable 1000–4000 ---
  const ppTask = "What does Mr. Bingley think of Jane Bennet early on?";
  const pp1k = await compile("pride-and-prejudice.docx", ppTask, 1000);
  const pp4k = await compile("pride-and-prejudice.docx", ppTask, 4000);
  assert.ok(pp1k.selected_sections.length >= 1, "P&P @1000 selects");
  assert.equal(
    pp1k.selected_sections.map((s) => s.id).join(","),
    pp4k.selected_sections.map((s) => s.id).join(","),
    `P&P ids must be stable 1000→4000: ${pp1k.selected_sections.map((s) => s.id)}→${pp4k.selected_sections.map((s) => s.id)}`
  );

  // --- Pointed Sherlock / Origin stay compact ---
  const sh1k = await compile(
    "sherlock-holmes.docx",
    "Why does the King of Bohemia come to Sherlock Holmes?",
    1000
  );
  const sh4k = await compile(
    "sherlock-holmes.docx",
    "Why does the King of Bohemia come to Sherlock Holmes?",
    4000
  );
  assert.ok(
    sh1k.selected_sections.length >= 1 && sh1k.selected_sections.length < 15,
    "Sherlock @1000 compact"
  );
  assert.ok(
    sh4k.selected_sections.length <= sh1k.selected_sections.length + 3,
    `Sherlock stable-ish 1000→4000: ${sh1k.selected_sections.length}→${sh4k.selected_sections.length}`
  );
  assert.ok(sh4k.selected_sections.length < 20, "Sherlock @4000 must not vacuum");

  const og1k = await compile("origin-of-species.pdf", "What is natural selection?", 1000);
  const og4k = await compile("origin-of-species.pdf", "What is natural selection?", 4000);
  assert.equal(
    og1k.selected_sections.map((s) => s.id).join(","),
    og4k.selected_sections.map((s) => s.id).join(","),
    "Origin ids stable 1000→4000"
  );

  // --- Meridian report / Kestrel: no whole-doc at high budget ---
  const arTask = "What revenue guidance does Meridian give for FY 2026?";
  const ar1k = await compile("meridian-annual-report.docx", arTask, 1000);
  const ar4k = await compile("meridian-annual-report.docx", arTask, 4000);
  assert.ok(ar4k.selected_sections.length < 25, "meridian report @4000 no whole dump");
  assert.ok(
    ar4k.selected_sections.length <= ar1k.selected_sections.length + 1,
    `meridian report stable: ${ar1k.selected_sections.length}→${ar4k.selected_sections.length}`
  );

  // User report: R&D cancelled @400 answers — larger budgets must not fill with 0% sections
  // (old whole-file short-circuit when raw ≤ budget dumped ~20 zero-relevance sections at 2100).
  const rdTask = "Which R&D programs were cancelled and why?";
  const rd400 = await compile("meridian-annual-report.docx", rdTask, 400);
  const rd1050 = await compile("meridian-annual-report.docx", rdTask, 1050);
  const rd2100 = await compile("meridian-annual-report.docx", rdTask, 2100);
  assert.ok(rd2100.raw_tokens <= 2100, "2100 exceeds raw (short-circuit temptation)");
  assert.ok(rd2100.omitted_sections.length > 0, "R&D@2100 must omit, not whole-doc dump");
  for (const [label, r] of [
    ["400", rd400],
    ["1050", rd1050],
    ["2100", rd2100],
  ] as const) {
    assert.ok(
      !r.selected_sections.some((s) => (s.relevance ?? 0) === 0),
      `R&D@${label} must not select 0% sections: ${r.selected_sections.map((s) => s.id + "@" + s.relevance).join(",")}`
    );
    assert.ok(r.compile_hints.early_stopped, `R&D@${label} early_stopped with spare budget`);
  }
  const rdIds = (r: typeof rd400) =>
    r.selected_sections
      .map((s) => s.id)
      .sort()
      .join(",");
  assert.equal(rdIds(rd400), rdIds(rd1050), `R&D ids stable 400→1050: ${rdIds(rd400)}→${rdIds(rd1050)}`);
  assert.equal(rdIds(rd400), rdIds(rd2100), `R&D ids stable 400→2100: ${rdIds(rd400)}→${rdIds(rd2100)}`);
  assert.ok(
    rd400.selected_sections.every((s) => (s.relevance ?? 0) >= 80),
    "R&D@400 high-relevance only"
  );

  const km1k = await compile("kestrel-k2-manual.pdf", "What does the K2 warranty not cover?", 1000);
  const km4k = await compile("kestrel-k2-manual.pdf", "What does the K2 warranty not cover?", 4000);
  assert.ok(km4k.selected_sections.length < 3, "kestrel @4000 no whole manual");
  assert.ok(
    km4k.selected_sections.length <= km1k.selected_sections.length + 1,
    `kestrel stable: ${km1k.selected_sections.length}→${km4k.selected_sections.length}`
  );

  console.log(
    "  coverage pack matrix ok: FY25@100/200/800, revenue@100, single-facet, vague, multilingual pointed/vague, P&P/Sherlock/Origin, meridian R&D/kestrel"
  );
}

async function testRecallEval() {
  const { runRecallEval } = await import("../eval/recall.js");
  const report = await runRecallEval(1);
  assert.equal(report.failed.length, 0, `all recall fixtures must pass: ${JSON.stringify(report.failed)}`);
  assert.ok(report.total >= 15, "fixture set should stay large enough to catch regressions");
  console.log(`  recall eval ok: ${report.passed}/${report.total} hit@budget`);
}

for (const fn of [
  testChunking,
  testContentTokens,
  testRankAndPack,
  testEndToEnd,
  testMultilingualRanking,
  testMoreScriptsRanking,
  testRelevanceFloor,
  testEarlyStopFillerHeavy,
  testCoverageRedundantFillers,
  testEarlyStopNoBudgetInflation,
  testEarlyStopNameIntentBingley,
  testEarlyStopClusterJaneBingley,
  testClusterStopJaneBingleyPrideAndPrejudice,
  testReserveDoesNotEvictFittingContent,
  testOversizedTopNotice,
  testRelevanceFirstPartialPacking,
  testBm25FirstPackingDespiteDemotion,
  testNextSectionHint,
  testRelevanceFloorDropsWeakToc,
  testMultiQuery,
  testQueryAspects,
  testCompileNotes,
  testOmitBucketClassification,
  testMultiFacetFinancials,
  testMultiFacetFinancialsBudget200,
  testMultiFacetFinancialsBudget800,
  testDemoParityFy25Budget200,
  testClientUxContracts,
  testExpandQueryAwareTruncation,
  testAgentQueryMissOnExpand,
  testAgentRecompileTokensReadNoDoubleCount,
  testAgentMultiFacetBudget200,
  testFormatConversion,
  testImageConversionFailsClearly,
  testClientBuildIsPlainScript,
  testPathGuardBlocksSymlinkEscape,
  testUploadGuardRejectsBombAndMismatch,
  testConversionErrorIsSanitized,
  testConversionMissingPathIsPathFree,
  testEnvParsingFailsSafe,
  testTrustProxyFailsSafe,
  testSanitizeSourceNameBlocksCommentBreakout,
  testPathGuardMessagesArePathFree,
  testDiskStorageNotMemory,
  testCacheCorruptionFallsThrough,
  testWeightedRateLimitBlocksAgentSpend,
  testConcurrentCompileSameBytes,
  testAnswerErrorsAreSanitized,
  testOpenAICompatClient,
  testProviderFailover,
  testGeminiModelFailover,
  testGeminiFailoverCooldown,
  testAgentAbort,
  testAgentLoop,
  testAgentSseEndpoint,
  testProveContextNoExpandMatchesSelectedTokens,
  testProveContextReassembly,
  testAnswerExpandedIds,
  testRateCostsInConfig,
  testLogger,
  testMetricsCounters,
  testHealthzEndpoint,
  testSampleLibraryStaticServing,
  testCompileIncrementsCounter,
  testWebCompileSectionCardsHaveText,
  testNoStdoutInMcpPath,
  testSmallFilePassthrough,
  testNoWholeFileDumpAboveRawTokens,
  testTokenizeCjkAndStem,
  testTokenizeQueryCleanupAndHonorific,
  testNameIntentDetectionAndBoost,
  testNameIntentCompilePrideAndPrejudice,
  testNameIntentSyntheticCompile,
  testSherlockRedHeadedLeagueSalaryHours,
  testCoveragePackMatrixRegression,
  testRecallEval,
]) {
  console.log(fn.name);
  await fn();
}
console.log("ALL TESTS PASSED");
