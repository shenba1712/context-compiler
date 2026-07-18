# Context Compiler — pitch deck outline

Editable source companion to [`context-compiler-pitch.pptx`](./context-compiler-pitch.pptx).
Prefer updating both when product claims change.

**Arc (6 slides):** Title → Problem → Market → How it works → Measured → What's next + CTA.

## Slide 1 — Title

- **Context Compiler**
- Same answer. 3% of the tokens.
- A task-aware, token-budgeted context layer for AI agents — plug in via MCP or the hosted demo.
- Visual: raw file — 20,364 tokens → compiled — 591 tokens (97% less)
- verified: unit tests + recall eval + live runs
- OpenAI × NamasteDev Codex Hackathon · July 2026 · solo build

## Slide 2 — Problem

- Agents pay to read pages they don't need
- Whole-file reads / 95%+ never touches the answer / And it compounds
- **$61 → $2** per 1,000 reads of one 100-page document (at $3/Mtok input — demo cost meter default)
- **95%** of file tokens wasted per task — across pdf, docx, xlsx, pptx, images

## Slide 3 — Market

- Title: Who buys, why now, where we wedge
- **Who buys:** teams wiring coding and document agents — Cursor, Claude Code, Codex, and internal agent platforms
- **Why now:** MCP is the distribution rail; context windows + $/Mtok make whole-file reads expensive; agents re-read the same docs across tasks
- **Wedge:** a task-budgeted file prep layer — not a full RAG platform (one job: select under a hard token budget)
- **Vs converters:** format-in → whole-file-out; we select under budget and return a recoverable omitted-sections manifest

## Slide 4 — How it works

- `compile_context(file, task, budget)` — guaranteed-size, task-relevant markdown out
- Convert → Chunk → Rank → Pack
  - markitdown + content-hash cache
  - heading-aware; tables never split
  - BM25 + query cleanup (stopwords / honorifics) — no shipped LLM rerank
  - hard pack under budget + relevance floor
- Plugs into any agent: MCP `compile_context` + `expand_section` (Cursor, Claude Code, Codex, Claude Desktop) + web demo
- Honest about recall: omitted-sections manifest; fetch by id; trimming never silent

## Slide 5 — Measured

- 97.1% token reduction on a real 78-section docx, answer intact
- 34× cheaper per read — cached repeats are instant
- **Parity:** full file vs compile (+ Include in Prove expands) — dual buttons; not an Agent run
- Example: vendor_handbook.docx · refunds question · budget 1,200 → 20,364 → 591

## Slide 6 — What's next + CTA

- Local embeddings — query cleanup + offline recall eval shipped; local embeddings next for paraphrase
- Multi-file corpora — compile across folders; shared conversion-cache gateway for teams
- Video & audio — transcription into the same pipeline
- `npx context-compiler` — one-command install for any MCP client
- **Try it live:** Docker / Render · github.com/shenba1712/context-compiler
- Live demo + MCP in Cursor / Claude Code / Codex; prove answer parity on a real doc
- Stop paying for pages your agent doesn't read.
