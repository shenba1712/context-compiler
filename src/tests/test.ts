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
import { chunkMarkdown } from "../chunk.js";
import { convertToMarkdown, ConversionError } from "../convert.js";
import { intEnv, numEnv } from "../env.js";
import { pack } from "../pack.js";
import { checkPathWithin } from "../path-guard.js";
import { compileContext, expandSection } from "../pipeline.js";
import { bm25Scores, queryAttribution, rank, rankMulti, splitQueries, tokenize, tokenizeQuery } from "../rank.js";
import { countTokens } from "../tokens.js";
import { UploadRejected, validateUpload } from "../upload-guard.js";

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
  // Flat scores (vague query with no signal): floor must NOT bite.
  const vague = new Map(chunks.map((c) => [c.id, 1]));
  const flat = pack(ranked, 6000, "t.md", vague);
  assert.equal(
    flat.selected.length,
    withoutFloor.selected.length,
    "flat scores must fall back to budget-filling (recall insurance)"
  );
  console.log(
    `  relevance floor ok: ${withFloor.selected.length} kept vs ${withoutFloor.selected.length} without; flat scores fill budget`
  );
}

async function testReserveDoesNotEvictFittingContent() {
  // Regression: an under-reserved budget let greedy content-fill overcommit,
  // forcing the eviction loop to drop a real, relevant, FITTING chunk and let
  // the manifest re-inflate with preview text in its place. Two second-most-
  // relevant chunks that together fit the budget must both survive, rather
  // than one being evicted for a fatter manifest.
  const doc = [
    "## Alpha\n\nThe launch date for the rocket is set for March. ".repeat(30), // top match, ~small
    "## Beta\n\nThe rocket launch date and mission details are discussed here. " +
      "The launch date for the rocket appears again in this section. ".repeat(28),
    ...Array.from(
      { length: 5 },
      (_, i) => `## Filler ${i}\n\n` + `Irrelevant boilerplate text ${i}. `.repeat(30)
    ),
  ].join("\n\n");
  const chunks = chunkMarkdown(doc);
  const task = "What is the rocket launch date?";
  const ranked = rank(task, chunks);
  const scores = new Map(chunks.map((c, i) => [c.id, bm25Scores(task, chunks)[i]]));

  // Pick a budget just large enough to fit the top two relevant chunks
  // together (content beats a padded manifest — both must be kept).
  const top2 = ranked.slice(0, 2);
  const top2Tokens = top2.reduce((s, c) => s + c.tokens, 0);
  const budget = top2Tokens + 400; // headroom for wrapper + a real (non-bloated) manifest
  const { selected } = pack(ranked, budget, "launch.md", scores);
  const selectedIds = new Set(selected.map((c) => c.id));
  assert.ok(
    top2.every((c) => selectedIds.has(c.id)),
    `both top-2 relevant chunks should survive when they jointly fit: kept ${selected.length} of top 2`
  );
  console.log(
    "  reserve ok: two relevant, fitting chunks both kept instead of one evicted for manifest padding"
  );
}

async function testOversizedTopNotice() {
  // The single most relevant section is bigger than the budget. The artifact
  // must warn the agent (not silently ship a lesser section as if sufficient).
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
  assert.ok(!selected.some((c) => c.id === refundId), "oversized top section is omitted at a tiny budget");
  assert.ok(
    text.includes("Most relevant") || text.includes(refundId),
    "artifact warns about the omitted top section"
  );
  assert.ok(countTokens(text) <= 200, `budget must hold even when nothing fits: ${countTokens(text)}`);
  console.log("  oversized-top ok: artifact flags the too-big top section for expansion");
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
    "## Other case\n\n" +
      "A red-headed league and a bank tunnel distraction fill this chapter. ".repeat(35),
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
  assert.ok(
    !starved.selected.some((c) => c.id === top.id),
    "sanity: demoted order can starve the BM25 top when scores are not used to reorder"
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

  // End-to-end: Sherlock @ 1150 should surface s18 (or similar strong omit).
  const sherlock = join(process.cwd(), "public", "samples", "sherlock-holmes.docx");
  if (existsSync(sherlock)) {
    const r = await compileContext(
      sherlock,
      "Why does the King of Bohemia come to Sherlock Holmes?",
      1150
    );
    assert.ok(r.next_section_hint, "Sherlock@1150 should hint at the next strong omitted section");
    assert.ok(
      (r.next_section_hint!.relevance ?? 0) >= 40,
      "hinted section should be high-relevance"
    );
    assert.ok(
      r.next_section_hint!.suggested_budget > r.token_budget,
      "suggested budget must exceed the current one"
    );
    console.log(
    `  next-section hint ok: unit + Sherlock@1150 → ${r.next_section_hint!.id} ` +
      `(raise to ~${r.next_section_hint!.suggested_budget})`
  );
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
  const r = await compileContext(
    sherlock,
    "Why does the King of Bohemia come to Sherlock Holmes?",
    2000
  );
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
  console.log(
    `  relevance-floor toc ok: ${r.selected_sections.length} sections, all ≥40% relevance`
  );
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
  console.log("  multi-query ok: split + round-robin + multi-question attribution");
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
    await withCleanEnv(
      [...LLM_PROVIDER_KEYS, ...LLM_MODEL_KEYS, "CC_LLM_BASE_URL"],
      async () => {
        process.env.CC_LLM_API_KEY = "test-key";
        process.env.CC_LLM_BASE_URL = `http://127.0.0.1:${port}/v1`;
        const { complete, hasLlm, answerModel } = await import("../llm.js");
        assert.equal(hasLlm(), true);
        assert.equal(answerModel(), "gpt-4o-mini"); // openai-compat default
        assert.equal(await complete("ping"), "mock-answer");
        console.log("  openai-compat ok: generic provider path works");
      }
    );
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
      ],
      async () => {
        process.env.GEMINI_API_KEY = "gem-key";
        process.env.CC_GEMINI_BASE_URL = `http://127.0.0.1:${port}`;
        const { complete, geminiModels, answerModel, clearGeminiDeadModels } = await import(
          "../llm.js"
        );
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
          const { complete: complete2, geminiModels: geminiModels2, answerModel: answerModel2 } =
            await import("../llm.js");
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
          assert.deepEqual(
            seen,
            ["model-429", "model-ok"],
            "429 must not blacklist — model-429 hit again"
          );

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
      assert.ok(whole.steps[0].detail.includes("whole file"), `compile step should say whole file, got ${whole.steps[0].detail}`);
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

    // 4. Soft token ceiling: always-expand with start === ceiling. Loop stops
    // starting new expands once tokens_read >= ceiling; an in-flight expand
    // may push tokens_read past the ceiling (intentional soft bound).
    const softCeiling = 1500;
    const alwaysExpandCeiling: (p: string) => Promise<string> = async (prompt) => {
      if (/ONLY a JSON object/.test(prompt)) {
        assert.match(prompt, /"answer" \| "expand"/, "web-equal ceiling omits recompile from decide prompt");
        assert.doesNotMatch(prompt, /"recompile"/, "recompile must not be offered when ceiling ≤ current budget");
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
      ceilingHit.tokens_read >= softCeiling ||
        ceilingHit.steps.some((s) => s.action === "expand"),
      `should hit soft ceiling or expand at least once (tokens_read=${ceilingHit.tokens_read})`
    );
    // Soft overshoot is allowed: last expand can finish past the ceiling.
    assert.ok(
      ceilingHit.steps.filter((s) => s.action === "expand").length < 8,
      "soft ceiling bounds expand count"
    );
    if (ceilingHit.tokens_read > softCeiling) {
      assert.ok(ceilingHit.steps.some((s) => s.action === "expand"), "overshoot comes from an expand");
    }

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
    assert.ok(!noop.steps.some((s) => s.action === "recompile"), "no recompile step when ceiling equals start");

    console.log(
      "  agent loop ok: expand→answer, step-cap, bad JSON, soft ceiling, recompile omitted at equal ceiling"
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

  await withCleanEnv(
    [...LLM_PROVIDER_KEYS, ...LLM_MODEL_KEYS, "CC_LLM_BASE_URL"],
    async () => {
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
        assert.ok(
          steps[0].data.tokens_added <= 1200,
          "compile pack must stay under the requested budget"
        );
        assert.ok(
          steps.some((s) => s.data.action === "expand"),
          "the agent expanded a section over the wire"
        );
        assert.ok(done, "a done event closes the stream");
        assert.ok(done!.data.answer.includes("90 days"), "final answer arrives in the done event");
        assert.ok(done!.data.tokens_read < done!.data.raw_tokens, "reads less than the whole file");
        assert.ok(
          done!.data.tokens_read <= 1200 + 2500,
          "tokens_read stays near the soft ceiling (compile + at most one expand overshoot)"
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
    }
  );
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
  let baseTokens = 0;
  try {
    const compiled = await compileContext(tmp, "alpha filler text", 400);
    baseTokens = compiled.tokens_used;
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

  await withCleanEnv(
    [...LLM_PROVIDER_KEYS, ...LLM_MODEL_KEYS, "CC_LLM_BASE_URL"],
    async () => {
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
          (body.compiled!.context_tokens as number) > baseTokens,
          `compiled context should grow with expand (${body.compiled!.context_tokens} vs base ${baseTokens})`
        );
        assert.equal(body.compiled?.answer, "found-needle", "compiled prompt must include the expanded needle");
        console.log("  answer expanded_ids ok: omitted needle merged into Prove context");
      } finally {
        server.close();
        chat.close();
      }
    }
  );
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
            (await (
              await fetch(`http://127.0.0.1:${port}/metrics`, { headers: metricsHeaders })
            ).json()) as {
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
            (await (
              await fetch(`http://127.0.0.1:${port}/metrics`, { headers: metricsHeaders })
            ).json()) as {
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
    assert.equal(r.tokens_saved, 0);
    assert.ok(r.markdown.includes("small note"));
    console.log("  passthrough ok: small files returned whole");
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
      /outside allowed root/,
      "symlink escaping CC_ROOT must be denied"
    );

    // A plain path traversal is also denied.
    assert.throws(
      () => checkPathWithin(root, join(root, "..", "..", "etc", "passwd")),
      /outside allowed root|Not a file/
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

  console.log("  tokenizeQuery ok: stopwords/fillers, Jane→Miss, no false Cap–Cap, negation kept");
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
  testRankAndPack,
  testEndToEnd,
  testMultilingualRanking,
  testMoreScriptsRanking,
  testRelevanceFloor,
  testReserveDoesNotEvictFittingContent,
  testOversizedTopNotice,
  testBm25FirstPackingDespiteDemotion,
  testNextSectionHint,
  testRelevanceFloorDropsWeakToc,
  testMultiQuery,
  testFormatConversion,
  testImageConversionFailsClearly,
  testClientBuildIsPlainScript,
  testPathGuardBlocksSymlinkEscape,
  testUploadGuardRejectsBombAndMismatch,
  testConversionErrorIsSanitized,
  testEnvParsingFailsSafe,
  testOpenAICompatClient,
  testProviderFailover,
  testGeminiModelFailover,
  testAgentLoop,
  testAgentSseEndpoint,
  testAnswerExpandedIds,
  testRateCostsInConfig,
  testLogger,
  testMetricsCounters,
  testHealthzEndpoint,
  testCompileIncrementsCounter,
  testWebCompileSectionCardsHaveText,
  testNoStdoutInMcpPath,
  testSmallFilePassthrough,
  testTokenizeCjkAndStem,
  testTokenizeQueryCleanupAndHonorific,
  testRecallEval,
]) {
  console.log(fn.name);
  await fn();
}
console.log("ALL TESTS PASSED");
