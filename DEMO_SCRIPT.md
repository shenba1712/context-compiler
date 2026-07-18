# 3-minute demo video script

Arc: money → proof → the model drives it → controlled failure → close.  
Target **2:50** so you never get cut at 3:00.

Prefer the **hosted demo + in-repo Run agent** for the recording. MCP in a coding agent is the optional credibility cut — same two tools, harder to control on camera.

## Pre-recording checklist (do NOT skip)

- [ ] Hosted URL open (no access token — the public demo is open). Local
      fallback: `GEMINI_API_KEY=… npm run web` (optional `OPENROUTER_API_KEY`).
- [ ] Pre-warm: free Render sleeps when idle — open the URL **~1 minute early**
      (first hit can take 30–60s). Compile the hero sample once so conversion
      is cached. Say “cached” when the badge shows; it’s a feature.
- [ ] **Prove answer parity** and **Run agent** both work on the hero sample
      (needs a server-side LLM key — Gemini free tier is enough).
- [ ] Hero setup (rehearse numbers so you don’t invent them live):
      - Sample: **Pride and Prejudice** (or Kestrel K2 / Meridian report).
      - Question: *What does Mr. Darcy say about Elizabeth at the Meryton assembly?*
      - Budget: **2,000** (or leave the default ~4,000 — still a huge cut).
      - Expect ~90%+ fewer tokens with the answer still in the compiled markdown.
- [ ] Rehearse a **controlled miss**: tiny budget (e.g. 800) or a vague question
      so the gold section lands in **Omitted**. Expand that section once and
      confirm recovery. Do this twice before you hit record.
- [ ] Close other tabs. 1080p. Cursor highlighting on if you have it.

## Script

### 0:00–0:20 — Hook (voiceover on the hosted demo page)

> "Every time an AI agent reads a file, you pay for every page — even when
> the answer is one paragraph. A long novel read a thousand times is not a
> rounding error. It is a bill you keep replaying.
> This is Context Compiler."

### 0:20–0:55 — The money demo (Compile)

Actions: pick **Pride and Prejudice** (or upload your hero file) → paste the
rehearsed question → budget **2,000** → **Compile**.

> "I pick a classic novel, ask a real question, and set a token budget.
> The whole file is tens of thousands of tokens. The compiled context — only
> the sections that look relevant — is a few thousand. That’s a ninety-plus
> percent cut, and the cost meter shows what that means per read. Ask again
> on the same file and conversion is cached by content hash — ranking still
> runs fresh for the new question."

Point at: red/green bars, cost meter, session savings, `⚡ conversion cached`
on the second run if you show one.

### 0:55–1:25 — Answer parity (the proof)

Action: click **Prove answer parity**.

> "Cheap context is worthless if the answer changes. So we ask the model the
> same question twice — once from the full converted file, once from the
> compiled slice — side by side. Same facts. A fraction of the tokens.
> Judges: this button is live. Try to break it."

If wording differs slightly: *“not identical words — identical facts.”*
Never claim byte-identical prose.

### 1:25–2:05 — The model at the center (Run agent)

Action: same file + a question whose answer sits deeper in the doc →
**Run agent ▸** (not Compile). Watch the SSE trace: compile → expand (with a
one-line reason) → answer. Token meter climbs next to the crossed-out whole-file count.

> "I don’t pick the budget here. The model compiles a small slice, reads the
> omitted-sections manifest, decides what to expand, and answers — having
> read a fraction of the file. That loop is bounded on purpose: step cap,
> token ceiling, and bad decisions fall back to ‘answer with what we have’
> instead of spinning. Same two tools an MCP agent would call:
> `compile_context` and `expand_section`."

This is the dependable “model drives it” shot. Keep it.

### 2:05–2:35 — Controlled failure (credibility)

Action: vague question and/or budget **~800**. Compile. Scroll to
**Omitted**. Click expand (or narrate `expand_section` on the flagged id).
Correct content appears.

> "Now I’ll break my own product. Tiny budget — and the section that matters
> is omitted. Here’s the design: every compile ends with a manifest of what
> was left out. Failure is visible. Expand recovers it. Trimming is
> transparent, never silent. That’s the difference between a demo and
> infrastructure. Same story if someone feeds an injected PDF — markers
> mitigate; the manifest is how you recover."

### 2:35–2:50 — Close

> "Context Compiler. Local-first TypeScript pipeline, MCP server, hosted
> demo, offline recall eval in CI, honest limitations in the README.
> Stop paying for pages your agent doesn’t read."

On screen: hosted URL + `github.com/shenba1712/context-compiler`.

## Delivery notes

- Record screen and voice separately if take one stumbles; sync later.
- Never wait on camera: cut latency in the edit, or pre-warm cold start + cache.
- The miss → expand beat is the riskiest and the most memorable — rehearse
  until it’s boring.
- Ranking is BM25 (local, free). Don’t oversell embeddings or an LLM rerank
  you don’t ship — those are possible later, not today.
- Free-tier host still waking up? Wait for the in-page cold-start note / `/healthz`
  before you start talking over a blank spinner.

## Appendix — optional MCP credibility cut

Use this if you want a second shot of a *real* coding agent. If the client is
flaky on camera, skip it — **Run agent** already makes the point.

1. `npm run build`
2. Register the server (pick one):
   - Claude Code: `claude mcp add context-compiler -- node /abs/path/dist/server.js`
   - Cursor / Claude Desktop / Codex: JSON or TOML from the README MCP section
3. Set `CC_ROOT` to a folder the agent may read; put the hero file there.
   Put `GEMINI_API_KEY` in the env the server process inherits.
4. Prompt on screen:
   `Using the context-compiler tools, answer from <hero>: <specific question>`
5. Hold on the autonomous `compile_context` tool call — few thousand tokens
   instead of tens of thousands — then the answer.

## Appendix — sample prompts that work well

| Sample | Strong question | Why it demos well |
|--------|-----------------|-------------------|
| Pride and Prejudice | What does Mr. Darcy say about Elizabeth at the Meryton assembly? | Huge novel → tiny slice; hero mock on the landing page |
| Kestrel K2 manual | What does the warranty not cover? Can the drone fly in rain? | Compound query + multi-section pack |
| Sherlock Holmes | What is the Red-Headed League? | Partial text — ask what’s *in* the file, not the full plot |
| Meridian Annual Report | What are the three risks management worries about? | Business prose + tables |
| Meridian Financials | What was net profit in FY25? | Spreadsheet path through markitdown |
| Origin of Species | What is natural selection? | Dense PDF; expect slower first convert |
