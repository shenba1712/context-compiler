/** Test suite. Run: npm test */
import assert from "node:assert/strict";
import { writeFileSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { chunkMarkdown } from "../chunk.js";
import { pack } from "../pack.js";
import { compileContext, expandSection } from "../pipeline.js";
import { bm25Scores, queryAttribution, rank, rankMulti, splitQueries } from "../rank.js";
import { countTokens } from "../tokens.js";

function makeTestDoc(): string {
  const sections: string[] = ["# Master Services Agreement\n\nThis agreement is made between parties."];
  for (let i = 1; i < 30; i++) {
    const title = i === 7 ? "Payment terms" : `General provision ${i}`;
    const body = Array.from({ length: 40 }, (_, j) =>
      `Boilerplate clause sentence number ${j} for section ${i}.`).join(" ");
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
  const ranked = await rank(task, chunks, false);
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
  console.log(`  rank+pack ok: ${selected.length} kept, ${omitted.length} omitted, ${countTokens(text)} tokens`);
}

async function testEndToEnd() {
  const path = join(homedir(), `cc-test-${Date.now()}.md`);
  writeFileSync(path, makeTestDoc());
  try {
    const r = await compileContext(path, "termination notice period", 1500, false);
    assert.ok(r.reduction_pct > 50, `expected >50% reduction, got ${r.reduction_pct}%`);
    assert.ok(r.markdown.includes("90 days written notice"));
    assert.ok(r.omitted_sections.length, "manifest should list omitted sections");

    const r2 = await compileContext(path, "payment terms", 1500, false);
    assert.equal(r2.cache_hit, true, "second call hits cache");
    assert.ok(r2.markdown.includes("Payment terms"), "different task selects different sections");

    const sid = r.omitted_sections[0].id;
    const e = await expandSection(path, sid);
    assert.ok(e.markdown, "expand_section returns content");
    console.log(`  e2e ok: ${r.raw_tokens} -> ${r.tokens_used} tokens (${r.reduction_pct}% saved), cache+expand ok`);
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
  const ranked = await rank("धनवापसी में कितने दिन लगते हैं?", chunks, false);
  assert.ok(ranked[0].text.includes("14 कार्य दिवसों"),
    `Hindi query should rank the refund section first, got: ${ranked[0].breadcrumb}`);
  // Content must beat metadata: even at a tight budget with token-dense
  // Devanagari breadcrumbs, at least the top-ranked chunk must survive.
  const { text, selected } = pack(ranked, 700, "test-hi.md");
  assert.ok(selected.length >= 1, "pack must never ship a manifest-only result when content fits");
  assert.ok(text.includes("14 कार्य दिवसों"), "the Hindi answer must survive packing");
  console.log("  multilingual ok: Devanagari ranking + content-priority packing");
}

async function testRelevanceFloor() {
  const chunks = chunkMarkdown(makeTestDoc());
  const task = "What are the termination notice periods?";
  const ranked = await rank(task, chunks, false);
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
    flat.selected.length, withoutFloor.selected.length,
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
    ...Array.from({ length: 5 }, (_, i) => `## Filler ${i}\n\n` + `Irrelevant boilerplate text ${i}. `.repeat(30)),
  ].join("\n\n");
  const chunks = chunkMarkdown(doc);
  const task = "What is the rocket launch date?";
  const ranked = await rank(task, chunks, false);
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
  console.log("  reserve ok: two relevant, fitting chunks both kept instead of one evicted for manifest padding");
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
  const ranked = await rank(task, chunks, false);
  const scores = new Map(chunks.map((c, i) => [c.id, bm25Scores(task, chunks)[i]]));
  const refundId = chunks.find((c) => c.text.includes("14 business days"))!.id;

  const { text, selected } = pack(ranked, 200, "policy.md", scores);
  assert.ok(!selected.some((c) => c.id === refundId), "oversized top section is omitted at a tiny budget");
  assert.ok(text.includes("Most relevant"), "artifact warns the agent about the omitted top section");
  assert.ok(text.includes(refundId), "warning names the section id to expand");
  assert.ok(/expand it|token_budget/i.test(text), "warning tells the agent how to recover");
  console.log("  oversized-top ok: artifact flags the too-big top section for expansion");
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
    ...Array.from({ length: 10 }, (_, i) => `## Filler ${i}\n\n` + `Unrelated boilerplate paragraph ${i}. `.repeat(20)),
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

  const saved = { ...process.env };
  delete process.env.ANTHROPIC_API_KEY;
  process.env.CC_LLM_API_KEY = "test-key";
  process.env.CC_LLM_BASE_URL = `http://127.0.0.1:${port}/v1`;
  try {
    const { complete, hasLlm, answerModel } = await import("../llm.js");
    assert.equal(hasLlm(), true);
    assert.equal(answerModel(), "gpt-4o-mini"); // openai-compat default
    assert.equal(await complete("ping"), "mock-answer");
    console.log("  openai-compat ok: generic provider path works");
  } finally {
    process.env = saved as NodeJS.ProcessEnv;
    server.close();
  }
}

async function testSmallFilePassthrough() {
  const path = join(homedir(), `cc-tiny-${Date.now()}.md`);
  writeFileSync(path, "# Tiny\n\nJust a small note about nothing.");
  try {
    const r = await compileContext(path, "anything", 4000, false);
    assert.equal(r.tokens_saved, 0);
    assert.ok(r.markdown.includes("small note"));
    console.log("  passthrough ok: small files returned whole");
  } finally {
    unlinkSync(path);
  }
}

for (const fn of [testChunking, testRankAndPack, testEndToEnd, testMultilingualRanking, testRelevanceFloor, testReserveDoesNotEvictFittingContent, testOversizedTopNotice, testMultiQuery, testOpenAICompatClient, testSmallFilePassthrough]) {
  console.log(fn.name);
  await fn();
}
console.log("ALL TESTS PASSED");
