# 3-minute demo video script

Arc: money → proof → the model at the center → controlled failure → close.
Target 2:50 so you never get cut at 3:00.

## Pre-recording checklist (do NOT skip)

- [ ] Pick the hero document: a real, relatable, 100+ page PDF that converts
      with headings. Candidates: RBI Annual Report, a Union Budget document,
      a SEBI regulation, a long court judgment. Test it end-to-end FIRST.
- [ ] Pre-warm: compile the hero doc once so conversion is cached — no
      dead air on camera. (Say "cached" out loud when the badge shows; it's
      a feature, not a cheat.)
- [ ] `ANTHROPIC_API_KEY` set; parity button tested on the hero doc.
- [ ] Claude Code configured with the MCP server; test the autonomous run.
- [ ] Find a question + budget combo where the answer section gets OMITTED
      (vague phrasing or budget 800 on a huge doc). Verify the miss is
      reproducible, and that `expand_section` recovers it. Rehearse twice.
- [ ] Close every other tab. 1080p. Cursor highlighting on if available.

## Script

### 0:00–0:20 — Hook (voiceover on the hosted demo page, empty)

> "Every time an AI agent reads a file, you pay for every page — even when
> the answer is one paragraph. One 100-page document, read a thousand times
> by your agents, costs about $61 in tokens. It should cost two.
> This is Context Compiler."

### 0:20–0:55 — The money demo (hosted URL, live)

Actions: upload hero PDF → type a specific question → budget 2,000 → Compile.

> "I upload the <hero doc>, ask a real question, and set a token budget.
> The raw file is <N> thousand tokens. The compiled context — only the
> sections relevant to my question — is <M> hundred. That's a <X>% cut,
> and the savings counter up top is per read, forever. Repeat reads hit a
> content-hash cache and are instant."

Point at: the two bars, the cost meter, the session-savings counter.

### 0:55–1:25 — Answer parity (the proof)

Action: click "Prove answer parity".

> "But cheap context is worthless if the answer changes. So the demo asks
> Claude the same question twice — once with the full document, once with
> the compiled context — side by side. Same answer. Three percent of the
> tokens. Judges: this button is live on the hosted URL. Try to break it."

### 1:25–2:00 — The model at the center (Claude Code, terminal)

Action: terminal with Claude Code. Prompt on screen:
`Answer from ~/docs/<hero>.pdf using the context-compiler tools: <question>`

> "This isn't just a web page — it's an MCP server, two lines of config in
> Claude Desktop, Claude Code, or Cursor. Watch Claude Code work: it calls
> compile_context on its own, gets 2,000 tokens instead of 40,000, and
> answers. The model decides what it needs; the compiler keeps it under
> budget. And the ranking is a real pipeline — BM25 plus a Claude Haiku
> reranker — not a prompt wrapper."

Show: the tool-call line in Claude Code's output (this is the AI-fluency
money shot — the model using the tool autonomously).

### 2:00–2:35 — Controlled failure (the credibility move)

Action: the rehearsed miss — vague question / tiny budget. Answer comes back
incomplete. Scroll to the omitted-sections manifest. Then Claude Code (or
you) calls `expand_section` with the flagged id; correct answer appears.

> "Now let me break my own product. Vague question, tiny budget — and the
> compiled context misses the section that matters. Here's the design
> answer: every response ends with a manifest of what was omitted. The
> agent sees what it didn't see, calls expand_section, and recovers.
> Trimming is transparent, never silent. That's the difference between a
> demo and infrastructure. Same story if a judge feeds an injected PDF —
> markers mitigate; the manifest is how you recover."

### 2:35–2:50 — Close (deck slide 6 or the demo page)

> "Context Compiler. TypeScript MCP server, hosted demo, full test suite,
> honest limitations in the README. Stop paying for pages your agent
> doesn't read. Links below."

On screen: hosted URL + repo.

## Delivery notes

- Record screen and voice separately if your first take stumbles; sync later.
- Never wait on camera: cut latency in the edit, or pre-warm the cache.
- The recall-miss segment is the riskiest and the most memorable — rehearse
  it until it's boring to you.
- If the parity answers differ slightly in wording, say so: "not identical
  words — identical facts." Pretending they're identical reads worse.

## Appendix — capturing the agent (both paths)

Two shots show "the model drives it." Record both; use whichever lands.

### A. In-repo agent (the dependable shot)

This is the demo's own loop — deterministic-looking, streamed, no terminal.

1. Server running with a key set: `GEMINI_API_KEY=... npm run web` (the free
   tier is plenty; failover to `OPENROUTER_API_KEY` if you set one).
2. Load the hero doc (or a sample), type a question whose answer lives deep in
   the document, and click **Run agent** — not "Compile once".
3. Record the trace building live: the `compile_context` step, then an
   `expand_section` step with the model's one-line reason, then `answer`. The
   token meter climbs toward the crossed-out whole-file number.

> "I don't set a budget here. The model compiles a slice, sees a manifest of
> what it hasn't read, decides the answer is in section nineteen, expands just
> that, and answers — having read a fraction of the file. It decided that,
> not me."

Pre-warm the doc first (cached conversion) so step one isn't waiting on
markitdown. If a live model wanders, reload and re-run — it's fast.

### B. Real coding agent over MCP (the credibility shot)

Proves the same tools work in a real client, not just our UI.

1. Build once: `npm run build`.
2. Register the server (pick your client):
   - Claude Code: `claude mcp add context-compiler -- node /abs/path/dist/server.js`
   - Cursor / Claude Desktop: the JSON block from the README's MCP section.
3. Set `CC_ROOT` to a folder the agent may read, and drop the hero doc in it.
   Set a key (`GEMINI_API_KEY`) in the same env the server launches from.
4. Prompt, on screen:
   `Using the context-compiler tools, answer from <hero>.pdf: <specific question>`
5. Record the tool-call line — the client calling `compile_context` on its own,
   getting a few thousand tokens instead of tens of thousands, then answering.
   That autonomous tool call is the whole point; let it sit on screen.

If the client is slow or flaky on camera, fall back to shot A — it makes the
same point and you control it frame by frame.
