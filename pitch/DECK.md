# Context Compiler pitch deck outline

Editable source for [`context-compiler-pitch.pptx`](./context-compiler-pitch.pptx).
Update this file when claims change, then regenerate the pptx locally.

**Local rebuild (not committed):** `python3 pitch/build_deck.py` if you keep a local builder script. The repo deliverable is this outline + the `.pptx`.

**Arc (6 slides):** Title → Problem → Who / why / fit → How it works → What we show → What's next + CTA.

## Visual theme (matches web demo)

Forest map from `public/style.css` / `docs/specs/08-design-system.md`. Paper and forest, not dark neon or purple-AI.

| Role | Value |
| --- | --- |
| Paper bg | `#e8ece9` |
| Ink text | `#1a221e` |
| Forest accent | `#1f5c42` / deep `#143d2c` |
| Surface panels | `#f3f6f4` + hairline `#c8d2cb` |
| Muted | `#4a5850` |
| Savings plane | forest `#1f5c42`, plane ink `#e8f0eb` |
| Raw / compiled bars | waste `#9aab9f` / compiled `#8fceb0` |

**Fonts (pptx-safe ≈ web):** Georgia ≈ Fraunces, Helvetica ≈ DM Sans, Menlo for token counts only.

**Copy rules:** say it out loud. Short sentences. No em dashes. No tool names, snake_case, or API ids. For expand/peek: “open a section you skipped,” “pull more of a chapter.”

## Slide 1. Title

- **Context Compiler** (Compiler in forest green)
- Line under the name: works in your agent · runs offline · no key to compile
- Same answer. About 3% of the tokens.
- You give it a file, a question, and a token budget. You get the useful parts back as text, plus a clear list of what it skipped.
- Right side visual: whole file 20,364 tokens → compiled 591 (97% fewer)
- Caption: one vendor handbook, one refunds question
- Checked with tests, a recall eval, and live runs
- OpenAI × NamasteDev Codex Hackathon · July 2026 · solo build

## Slide 2. Problem

- Title: Agents pay to read pages they don’t need
- Whole-file habit: to answer one question, agents often load the entire document
- Most of it never helps: maybe 2 useful pages out of 100. The rest is pure spend.
- Then it multiplies: every file, every question, every agent, every day
- Big number: **$61 → $2** per 1,000 reads of one 100-page document (at $3 per million input tokens; same default as the demo cost meter)
- Second number: **~95%** of the file’s tokens often unused for a single task (pdf, docx, xlsx, pptx, images)

## Slide 3. Who / why / fit

- Title: Who it’s for, and where it fits
- **Who:** people wiring coding agents and document agents. Cursor, Claude Code, Codex, internal platforms.
- **Why it exists:** reading whole files is getting expensive. The same manuals and reports get reopened for different questions.
- **What’s different:** we do one job. Under a hard token budget, pick what the agent needs. We are not building a full search product.
- **Where it fits:** a converter gives you the whole file as text. We give you a budgeted slice, and we tell you what we left out so you can pull more if you need it.

## Slide 4. How it works

- Title: File in. Useful parts out. Under your budget.
- Subhead: You set the ceiling. The agent gets readable text, plus a list of skipped sections.
- Four steps:
  1. Convert the file to text (and cache it so repeats are cheap)
  2. Split on headings; keep tables whole
  3. Rank sections against the question on your machine (compile does not call a model)
  4. Pack the strongest sections until the question is covered, then stop
- Bottom left: Use it from Cursor, Claude Code, Codex, or Claude Desktop. Or try the web demo. Compile needs no API key.
- Bottom right: We are honest about cuts. Every result lists what was left out. Open a skipped section when you need more of a chapter. Nothing disappears quietly.

## Slide 5. What we show

- Title: What you actually get back
- Subhead: Real 78-section handbook. One refunds question. Budget 1,200 tokens.
- **97% fewer tokens**, answer still intact (20,364 → 591)
- **About 34× cheaper** per read once conversion is cached; repeats come back fast
- **Side-by-side check:** same question, full file vs compiled slice. You compare the facts. That is not the same as letting the model browse on its own.
- Story strip: vendor handbook · “How long do refunds take and who approves large ones?” · budget 1,200 · 20,364 → 591 · answer intact · skipped sections listed

## Slide 6. What’s next + CTA

- Better matching when the question uses different words (local embeddings next; cleanup and offline recall checks already shipped)
- Compile across a folder of files; shared conversion cache for teams
- Video and audio: transcribe, then run the same pipeline
- One-command install for agent clients
- **Try it live:** context-compiler.onrender.com · Docker / Render · github.com/shenba1712/context-compiler
- Open the demo, or wire it into Cursor / Claude Code / Codex. Check the answer on a real doc.
- Stop paying for pages your agent doesn’t read.
