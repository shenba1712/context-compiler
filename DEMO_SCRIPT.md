# 3-minute demo video script

## Submission one-liner

Context Compiler cuts agent file reads by ~90%+ — compile under a token budget with coverage-first packing, prove the answer still holds, and recover misses via an omitted-sections manifest. Local-first TypeScript + MCP; hosted demo at the project URL.

---

**Arc: Problem → Product → Payoff.** Target **~2:50** so you never get cut at 3:00.

Prefer the **hosted demo + in-repo Run agent** for the recording. MCP in a coding agent is an optional credibility cut — same two tools, harder to control on camera.

**Use only in-doc sample chips.** Abridged samples do not contain every classic plot beat (no invented Collins / propose questions).

## Pre-recording checklist (do NOT skip)

- [ ] Hosted URL open (no access token — the public demo is open). Local
      fallback: `GEMINI_API_KEY=… npm run web` (optional `OPENROUTER_API_KEY`
      for failover when Gemini free tier hiccups).
- [ ] Pre-warm: free Render sleeps when idle — open the URL **~1 minute early**
      (first hit can take 30–60s). Compile the hero sample once so conversion
      is cached. Say “cached” when the badge shows; it’s a feature. Expect a
      **spinner banner** while Compile / Prove / Agent wait — not buried status
      text.
- [ ] **Prove answer parity** and **Run agent** both work on the hero sample
      (needs a server-side LLM key — Gemini free tier is enough; OpenRouter is
      the automatic backup).
- [ ] Hero setup (rehearse numbers so you don’t invent them live):
      - Sample: **Pride and Prejudice** (chip: Darcy / Meryton assembly).
      - Question: *What does Mr. Darcy say about Elizabeth at the Meryton assembly?*
      - Budget: **2,000** (or leave **4,000** — still a huge cut; pointed asks
        often **early-stop** with spare headroom). Same slider = Compile hard
        pack ceiling **and** Agent soft **content-token** reading ceiling.
      - Expect ~90%+ fewer **content** tokens with the answer still in the
        compiled markdown.
- [ ] Optional second money shot (rehearse one):
      - **Meridian Annual Report** · *Which R&D programs were cancelled and why?*
        @ **4,000** → coverage complete / spare unused (early-stop story).
      - **Meridian Financials** · *What was net profit in FY25, and which quarter
        had the best gross margin?* @ **4,000** → multi-facet pack.
      - **Sherlock** · *What salary does the Red-Headed League offer, and what
        hours must Wilson keep?* @ **2,000–4,000** → compound in-doc ask.
      - Multilingual chip (Hindi / Spanish / Russian / Arabic) @ **4,000** if
        you want a 5-second script-aware nod.
- [ ] Rehearse a **controlled miss**: tiny budget (e.g. **800**) or a vague /
      paraphrased question so the gold section lands in **Omitted**. Click to
      **peek** (does not change Prove tokens). Optionally check **Include in
      Prove** — only then does the effective Prove context grow — and confirm
      recovery. Dismiss × closes a peek without including it. Do this twice
      before you hit record.
- [ ] Know the two Prove buttons: quiet **Prove…** next to Compile (file +
      budget only; skip results), and **Prove answer parity** under results
      (compile + any **Include in Prove** expands). Peeks alone do not count.
      Prove is not Agent.
- [ ] Close other tabs. 1080p. Cursor highlighting on if you have it.

## Script

### Problem — 0:00–0:40

**On screen:** Hosted demo landing page → pick **Pride and Prejudice** → paste
the rehearsed Darcy / Meryton question → budget **2,000** → **Compile**. Hold
on the spinner banner, then the red/green bars and cost meter.

**Say:**

> "Every time an AI agent reads a file, you pay for every page — even when
> the answer is one paragraph. A long novel read a thousand times is not a
> rounding error. It is a bill you keep replaying.
> Watch: whole file, tens of thousands of tokens. Compiled context — only
> the sections that look relevant — a few thousand. Ninety-plus percent cut.
> Same question again and conversion is cached. This is Context Compiler."

Point at: token bars (content tokens), cost meter, `⚡ conversion cached` on a
second compile if you show one. Do **not** narrate BM25, providers, or Docker
here.

---

### Product — 0:40–2:20

Three beats. Keep moving; cut dead air in edit.

#### 0:40–1:05 — Prove (answer still holds)

**On screen:** If a useful section is omitted, click to **peek** (optional look).
If you want it in the parity prompt, check **Include in Prove**. Then hit
**Prove answer parity** under results — or the quiet top **Prove…** for a
no-expand proof. Hold on side-by-side answers.

**Say:**

> "Cheap context is worthless if the answer changes. Same question twice —
> full converted file versus the compiled slice, plus only sections I
> Include in Prove. Peeks are free to look; they don’t add tokens. Side by
> side: same facts, a fraction of the tokens."

If wording differs: *“not identical words — identical facts.”* Never claim
byte-identical prose.

#### 1:05–1:45 — Run agent (model drives retrieval)

**On screen:** Same file + question → budget **2,000** → **Run agent ▸**
(not Compile). Spinner, then SSE trace. Token meter vs crossed-out whole-file
count. Optional: **Compare to full file**.

**Say:**

> "Same budget slider — Agent’s soft reading ceiling on content tokens. It
> compiles, reads the omitted-sections manifest, expands what it needs, and
> answers — having read a fraction of the file. It stops starting new expands
> at the ceiling; a last expand may finish slightly over. Live steps. Same
> two tools an MCP agent would call: compile and expand."

One short failover nod only if something flakes on camera: *“Gemini first,
OpenRouter if free tier hiccups.”* Don’t walk the provider chain.

#### 1:45–2:20 — Controlled miss **or** early-stop (pick one primary)

**Option A — Controlled miss (default):** Budget **~800** and/or a paraphrased
question → **Compile** → scroll **Omitted** → **peek** → optionally
**Include in Prove** and Prove again, or let Agent walk the same manifest.

**Say:**

> "I’ll break my own product. Tiny budget — or a paraphrase ranking misses —
> and the section that matters is omitted. Every compile ends with a
> manifest of what was left out. Peek or expand recovers it. Trimming is
> transparent, never silent."

**Option B — Early-stop (alternate / insert 10s):** Meridian report · R&D
cancelled @ **4,000** → floor note “coverage complete / spare unused.”

**Say:**

> "Budget is a ceiling, not a fill quota. Once the answer is covered, it
> stops — spare tokens left on the table instead of padding with noise."

---

### Payoff — 2:20–2:50

**On screen:** Cost meter / session savings, then hosted URL + GitHub in the
final frame.

**Say:**

> "Stop paying for pages your agent doesn’t read. Context Compiler —
> local-first pipeline, MCP server, hosted demo you just saw. Ninety-plus
> percent fewer tokens when the answer still holds — and a map back when
> it doesn’t."

Hold URL + `github.com/shenba1712/context-compiler` through end of VO.

#### Optional 10–15s payoff close (fits inside 2:50–3:00)

Use only if the main close finished early (~2:35). Else cut it.

**On screen:** Full-bleed URL + GitHub; freeze on demo hero or token bars.

**Say:**

> "Try it: the hosted demo link in the submission. Source and evals on
> GitHub — shenba1712 slash context-compiler."

---

## Timing summary

| Beat | Clock | What |
|------|-------|------|
| **Problem** | 0:00–0:40 | Hook + Compile money shot |
| **Product** | 0:40–2:20 | Prove → Agent → miss / early-stop |
| **Payoff** | 2:20–2:50 | Value close + URL/GitHub |
| Optional close | ~2:35–2:50 | Extra 10–15s URL/GitHub if early |
| **Hard stop** | **3:00** | Never overrun |

## Delivery notes

| Do | Don’t |
|----|--------|
| **Show** bars, spinner, side-by-side Prove, Agent SSE, Omitted → peek | Narrate infra (BM25 details, Docker, rate-limit math) over the shot |
| **Say** peek vs Include in Prove once, clearly | Claim peeks change Prove tokens |
| **Say** Agent soft content ceiling once | Confuse Prove with Agent, or top Prove… with results Prove |
| **Say** early-stop spare is intentional | Claim large budgets dump the whole file |
| Cut latency in edit; pre-warm cold start | Wait on camera for Render wake or first convert |
| Record screen + VO separately if take one stumbles | Oversell embeddings or LLM rerank you don’t ship |
| Stick to sample chips | Invent out-of-file plot questions |

- The miss → peek/expand beat is the riskiest and the most memorable — rehearse
  until it’s boring. Lexical paraphrase misses are real; expand/agent recovery
  is the product answer.
- Free-tier host still waking up? Wait for the in-page cold-start note /
  `/healthz` before you start talking over a blank spinner.
- Rate-limit reality on the public demo: pool ~30 / 5 min; Prove costs 4;
  Agent costs 12; at most 2 LLM jobs at once. Don’t burn the pool rehearsing
  live on the hosted instance.

## Appendix — optional MCP credibility cut

Use this if you want a second shot of a *real* coding agent. If the client is
flaky on camera, skip it — **Run agent** already makes the point.

1. `npm run build`
2. Register the server (pick one):
   - Claude Code: `claude mcp add context-compiler -- node /abs/path/dist/server.js`
   - Cursor / Claude Desktop / Codex: JSON or TOML from the README MCP section
3. Set `CC_ROOT` to a folder the agent may read; put the hero file there.
   Put `GEMINI_API_KEY` (and optionally `OPENROUTER_API_KEY`) in the env the
   server process inherits.
4. Prompt on screen:
   `Using the context-compiler tools, answer from <hero>: <in-doc sample question>`
5. Hold on the autonomous `compile_context` tool call — few thousand tokens
   instead of tens of thousands — then the answer.

## Appendix — sample prompts that work well

| Sample | Strong question | Why it demos well | Budget |
|--------|-----------------|-------------------|--------|
| Pride and Prejudice | What does Mr. Darcy say about Elizabeth at the Meryton assembly? | Huge novel → tiny slice; hero mock | 2,000–4,000 |
| Meridian Annual Report | Which R&D programs were cancelled and why? | Early-stop / spare unused | 4,000 |
| Meridian Financials | What was net profit in FY25, and which quarter had the best gross margin? | Multi-facet pack | 4,000 |
| Sherlock Holmes | What salary does the Red-Headed League offer, and what hours must Wilson keep? | Compound in-doc ask (partial text) | 2,000–4,000 |
| Kestrel K2 manual | What does the warranty not cover, and can the drone fly in rain? | Compound query + multi-section pack | 4,000 |
| Origin of Species | What is natural selection? | Dense PDF; expect slower first convert | 4,000 |
| Hindi / ES / RU / AR shorts | Use a chip in that language | Multilingual BM25 | 4,000 |
| Paraphrase miss (eval) | falling ill / wet through style | BM25 miss → expand/agent recovery | ~800–2,000 |
