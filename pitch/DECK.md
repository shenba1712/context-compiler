# Context Compiler — pitch deck outline

Editable source companion to [`context-compiler-pitch.pptx`](./context-compiler-pitch.pptx).
Prefer updating both when product claims change.

**Rebuild:** `python3 pitch/build_deck.py` (requires `python-pptx`).

**Arc (6 slides):** Title → Problem → Market → How it works → Measured → What's next + CTA.

## Visual theme (matches web demo)

Aligned with **Forest map** tokens in `public/style.css` / `docs/specs/08-design-system.md` — not a separate dark/neon look.

| Role | Token / value |
| --- | --- |
| Paper bg | `#e8ece9` |
| Ink text | `#1a221e` |
| Forest accent | `#1f5c42` / deep `#143d2c` |
| Surface panels | `#f3f6f4` + hairline `#c8d2cb` |
| Muted | `#4a5850` |
| Savings plane | forest fill `#1f5c42`, plane ink `#e8f0eb` |
| Raw / compiled bars | waste `#9aab9f` / compiled `#8fceb0` |

**Typography (pptx-safe ≈ web):** Georgia ≈ Fraunces (brand), Helvetica ≈ DM Sans (body), Menlo ≈ IBM Plex Mono (coords / API / token counts). Install the Google Fonts from the demo for a closer match when presenting.

**Composition:** paper slides, forest accent rules (not soft shadows), surface panels with top forest bars, dark forest plane for raw→compiled savings (same metaphor as the hero). No purple-AI / cream-serif / broadsheet styling.

## Slide 1 — Title

- **Context Compiler** (Compiler in forest)
- Coords: MCP · LOCAL BM25 · NO KEY FOR COMPILE
- Same answer. 3% of the tokens.
- Task-aware compile under a hard token budget — coverage-first packing, omit honesty, MCP or the hosted web demo.
- Visual: forest plane — raw 20,364 → compiled 591 (97% less)
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
  - BM25 + query cleanup — local, no LLM
  - **coverage-first** under budget; content before manifest; relevance floor
- **MCP + web demo:** `compile_context` + `expand_section`; no API key for compile
- **Omit honesty:** omitted-sections manifest; fetch by id; trimming never silent

## Slide 5 — Measured

- 97.1% token reduction on a real 78-section docx, answer intact
- 34× cheaper per read — cached repeats are instant
- **Parity:** full file vs compile (+ Include in Prove) — dual buttons; not an Agent run
- Example: vendor_handbook.docx · refunds question · budget 1,200 → 20,364 → 591

## Slide 6 — What's next + CTA

- Local embeddings — query cleanup + offline recall eval shipped; local embeddings next for paraphrase
- Multi-file corpora — compile across folders; shared conversion-cache gateway for teams
- Video & audio — transcription into the same pipeline
- `npx context-compiler` — one-command install for any MCP client
- **Try it live:** context-compiler.onrender.com · Docker / Render · github.com/shenba1712/context-compiler
- Live demo + MCP in Cursor / Claude Code / Codex; prove answer parity on a real doc
- Stop paying for pages your agent doesn't read.
