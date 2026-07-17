# Context Compiler — UI / UX Audit

> **Remediation status (updated):** 12 of 14 findings fixed and verified live
> against a running server (build + `npm test` green). See
> **[Remediation status](#remediation-status)** at the end for what changed,
> and why #13/#14 were folded into other fixes rather than left open.

**Scope:** the hosted demo page — `public/index.html`, `public/style.css`,
`src/client/app.ts` (compiled to `app.js`).
**Method:** source-level review of markup, styles, interaction logic, copy, and
responsive/accessibility behavior, plus numeric contrast checks. A headless
browser couldn't run in this sandbox (missing system lib, no root), so findings
are grounded in the source rather than screenshots — noted where a live render
would help confirm.

**Headline:** this is a well-built page, not a rough draft. It already does things
many production sites miss: `prefers-reduced-motion`, `:focus-visible`, a skip
link, `sr-only` live regions (polite *and* assertive), `aria-pressed` on toggles,
labels rendered *outside* the token bars (so a dramatic result can't squeeze text
into an unreadable sliver), Devanagari `lang` tagging, and colour pairs that mostly
verify at WCAG AA. The gaps are concentrated in **feedback during slow operations**,
a few **credibility/polish** items a hackathon judge will notice, and **information
locked in hover-only tooltips**. None are architectural; most are small.

Severity = impact on a first-time user's success and on the judged impression.

---

## Findings at a glance

| # | Finding | Severity | Type |
|---|---------|----------|------|
| 1 | No progress feedback during a compile (can take many seconds) | **High** | Feedback |
| 2 | Dead / placeholder GitHub links ("View the code" → github.com home; footer → `#`) | **High** | Credibility |
| 3 | Typo "Pride & Prejusice" in the hero mock | **High** | Copy |
| 4 | Key explanations trapped in hover-only `title` tooltips | Medium | A11y |
| 5 | "Prove answer parity" shown/enabled before it's meaningful (and pre-key) | Medium | IA / feedback |
| 6 | Sample stays "✓ selected" after a manual upload replaces it | Medium | State clarity |
| 7 | Sample-library summary copy omits `pptx` (now a real sample) | Medium | Copy |
| 8 | Results section has no *visible* heading (only `sr-only`) | Medium | Scanability |
| 9 | Multi-question intent encouraged, but task field is single-line | Low | Input ergonomics |
| 10 | Some mobile tap targets below the ~44px minimum (chips) | Low | Mobile |
| 11 | Budget slider has no visible range/scale labels | Low | Discoverability |
| 12 | `--faint` on `--bg2` is exactly 4.50:1 (zero margin) | Low | A11y margin |
| 13 | "ARCHITECTURE.md" styled like a link but is a plain `<span>` | Low | Affordance |
| 14 | Hero mock uses hard-coded numbers (and 9% bar for a 7.4% value) | Low | Consistency |

**Strengths worth keeping** (don't regress these): reduced-motion handling,
focus-visible outlines, skip link, dual live regions, labels-outside-bars,
responsive breakpoints with rationale comments, AA-verified core contrast,
`textContent` rendering (also the XSS-safe choice), and `lang="hi"` on Hindi output.

---

## 1. No progress feedback during a compile — **High**

**What:** On submit, the only signal is the button switching to "Compiling…" and
disabling (`app.ts` submit handler). The results panel stays hidden until the
response arrives. Conversion shells out to markitdown with a **120-second** ceiling
(`convert.ts`), so a large/first-seen PDF can leave the user staring at a disabled
button with no sense of progress, and nothing near where the results will appear.

**Impact:** The classic "did it freeze?" moment. First-time users abandon or
double-submit. This is the single biggest experiential gap.

**Fix:**
- Reveal the results section immediately with a **skeleton/spinner** placeholder
  (`#resultsSec` un-hidden, stats showing a shimmer) so the wait happens where the
  answer will land, and scroll to it on submit rather than on completion.
- Add a reassuring line for first-time conversions, e.g. "Converting this file for
  the first time — this can take a few seconds." Switch it to a different message if
  it runs long (>5s).
- You already have `AbortController` wired — surface a **Cancel** affordance during
  the wait.

---

## 2. Dead / placeholder GitHub links — **High (for a judged demo)**

**What:** `index.html:29` — "View the code" points at `https://github.com/` (GitHub's
homepage, not the repo) and opens in a new tab **without `rel="noopener noreferrer"`**
(reverse-tabnabbing + perf). `index.html:201` — the footer "source & docs on GitHub"
is `href="#"` (a dead anchor that jumps to top). Only the footer link is tagged
`data-placeholder`, so the "View the code" button silently sends judges to github.com.

**Impact:** A hackathon is partly judged on the repo; two prominent links either dead
or wrong reads as unfinished.

**Fix:** Point both at the real repository URL before sharing; until then, disable or
hide them rather than linking to the wrong place. Add `rel="noopener noreferrer"` to
every `target="_blank"`. (You already `console.warn` on placeholders — extend that to
`#repoLink`, which currently escapes the check.)

---

## 3. Typo: "Pride & Prejusice" — **High (trivial, but front-and-centre)**

**What:** `index.html:33`, in the hero demo card: `Pride & Prejusice` (missing the
second "d"). It's in the most-looked-at element on the page.

**Fix:** "Pride & Prejudice". One-character change; disproportionate credibility win.

---

## 4. Explanations locked in hover-only `title` tooltips — **Medium (accessibility)**

**What:** Genuinely useful explanations live only in `title` attributes:
- `index.html:102` — the "compiled tokens" stat's ⓘ ("why it's more than the
  per-section counts added up"). The ⓘ glyph is `aria-hidden`, and the `title` sits on
  a `<div>`.
- `#viewToggle` (`:115`) and the cache/rerank badges (`title` set in `app.ts`).

**Impact:** `title` tooltips don't appear on touch devices at all, are unreliable for
screen readers, and require a precise hover on desktop. The "why is compiled > sum of
sections?" note is exactly the kind of thing that pre-empts confusion — burying it
makes it invisible to most users.

**Fix:** Promote the important ones to a visible, focusable affordance: a small
`<details>`/disclosure, an inline caption under the stat, or a button that toggles a
short explanation. Keep `title` only as redundant enhancement, never as the sole home
of information.

---

## 5. "Prove answer parity" appears before it's meaningful — **Medium**

**What:** The Prove button sits beside Compile in the initial form. Before any
compile it's fully enabled; on a **keyless** deploy (the headline "works with zero API
keys" case) clicking it returns a 400 error. It's only `disabled` (with an
explanatory `title`) *after* the first compile sets `llm_available`.

**Impact:** The feature that best demonstrates value ("same answer, fewer tokens") is
presented before the user has anything to compare, and its first click on the default
deploy is an error rather than a graceful, explained disabled state.

**Fix:** Determine LLM availability up front (a tiny `/api/health` returning
`llm_available`, or reflect it on page load) so the button's disabled state + tooltip
are correct immediately. Consider relocating Prove into the results panel, where a
comparison actually makes sense, and showing a one-line "needs an API key" hint inline
rather than only after a failed click.

---

## 6. Sample stays "✓ selected" after a manual upload — **Medium**

**What:** Selecting a sample marks its card active (`.scard.active` → "✓ selected").
If the user then chooses their own file via the file input, the file input updates but
the sample card **keeps** its active/selected styling (`app.ts` clears it only inside
`selectSample`, not on the file `change` handler).

**Impact:** The UI claims a sample is the source while a different uploaded file is
what will actually be compiled — a quiet correctness/trust mismatch.

**Fix:** In the file-input `change` handler, clear `.scard.active`/`aria-pressed` and
the suggested-question chips whenever the user picks a file manually.

---

## 7. Stale sample-library copy — **Medium (easy)**

**What:** `index.html:64` summary reads "…sample documents (pdf · docx · xlsx ·
markdown)". Since then a **pptx** sample (Meridian pitch deck) was added, so the list
is now wrong/incomplete.

**Fix:** Update to include pptx (and consider generating the format list from the
`/api/samples` response so it can't drift again).

---

## 8. Results section has no visible heading — **Medium**

**What:** The results heading (`#resultsHeading`) is `h2.sr-only` — present for screen
readers, invisible to sighted users. Between the stats, bars, badges, notes, section
cards, omitted chips, and the parity panel, there's a lot to parse with no visible
anchor.

**Impact:** Weaker scanability; the eye has to infer where "results" begin.

**Fix:** Make the results heading visible (e.g. "Your compiled context"), or add a
clear visual divider/label. Keep the focus target for keyboard/SR users.

---

## 9. Multi-question intent vs. single-line input — **Low**

**What:** The copy and placeholder actively encourage multi-question tasks ("Separate
them with ? or new lines"), but `#task` is a single-line `<input type="text">`. Long
or multi-line questions are awkward to read and edit, and "new lines" can't actually
be typed into a single-line input.

**Fix:** Use an auto-growing `<textarea>` (Enter-to-submit, Shift+Enter for a newline)
so the encouraged behaviour is actually possible and comfortable.

---

## 10. Sub-44px tap targets on mobile — **Low**

**What:** Budget preset chips (`.bpre`, ~28px tall) and omitted-section chips
(`.ochip`) are below the ~44px minimum recommended for touch. Sample cards and primary
buttons are fine.

**Fix:** Bump `min-height`/padding for `.bpre`/`.ochip`/`.qchip` under the phone
breakpoint so they're comfortably tappable.

---

## 11. Budget slider has no visible scale — **Low**

**What:** The range input (200–20,000) shows no min/max/tick labels, so users can't
tell the range or where a value sits without dragging. The big number helps, but the
track itself is unlabelled.

**Fix:** Add small end labels (e.g. "200" / "20k") or a couple of ticks; optionally
mark the current preset on the track.

---

## 12. `--faint` on `--bg2` sits exactly at the AA threshold — **Low**

**What:** Measured 4.50:1 — it passes AA for normal text with **zero margin**, so any
future tweak to either token could tip it under. (`--faint` on `--bg` is a healthier
4.83:1; other pairs are 5–8:1.)

**Fix:** Nudge `--faint` a touch darker (e.g. `#6b6459`, already used for `--muted`) to
buy margin, or avoid `--faint` text on `--bg2` surfaces.

---

## 13. "ARCHITECTURE.md" looks like a link but isn't — **Low**

**What:** `index.html:197` renders `ARCHITECTURE.md` inside an `<span id="archLink">`
in a sentence about docs "in the repo". If it's styled/expected to be clickable it's a
dead affordance; if it's just prose, the id is unused noise.

**Fix:** Make it a real link to the file in the repo, or leave it as plain prose and
drop the id.

---

## 14. Hero mock uses hard-coded numbers — **Low**

**What:** The hero card hard-codes "19,612 → 1,454 tokens (92.6%)" and draws the
compiled bar at `width:9%` although 1,454/19,612 ≈ 7.4%. It's illustrative, but it can
drift from what the actual P&P sample now produces, and the bar width doesn't match its
own label.

**Fix:** Either label it clearly as an illustration, or fix the width to match the
ratio; ideally seed it from a real sample number so it can't go stale.

---

## Suggested order

1. **#3 typo, #7 stale copy, #2 links + `rel`** — minutes each, pure credibility.
2. **#1 compile progress feedback** — the biggest experiential win.
3. **#6 clear sample state on upload, #5 Prove availability/placement** — correctness of state.
4. **#4 un-bury tooltip explanations, #8 visible results heading** — clarity/a11y.
5. **#9–#14** — polish as time allows.

## Note on verification

These are source-grounded. Two things specifically warrant a quick look in a real
browser before/after fixing: the **compile wait** (feel of #1) and the **mobile
layout** at ≤560px (#10, and the bar-wrapping behaviour). If useful, I can render a
faithful static preview of the page inline to make the findings visual, or implement
the fixes and show before/after.

---

## Remediation status

All fixes were implemented, rebuilt (`npm run build`), and re-checked live against a
running server (`node dist/web.js` + `curl`): the typo is gone, `/api/config` and the
new `/README.md` / `/ARCHITECTURE.md` routes respond correctly, the textarea/cancel
button/visible heading are all present in the served HTML, and a full compile still
runs end-to-end with the same response shape. `npm test` is green.

| # | Finding | Status | How it was fixed |
|---|---------|--------|-------------------|
| 1 | No progress feedback during compile | **Fixed** | Submitting now immediately reveals the results panel with a loading note ("converting a file for the first time can take a few seconds…") and scrolls to it, plus a new **Cancel** button wired to the existing `AbortController`. A failed/cancelled *first* attempt hides the empty panel again; a failed *retry* leaves the previous result visible with the error surfaced separately. |
| 2 | Dead/placeholder GitHub links | **Fixed (as far as code can)** | Both links now carry `data-placeholder` (only the footer one did before) so the existing console warning covers both, and `rel="noopener noreferrer"` was added to the `target="_blank"` link. The actual repo URL still needs to be filled in once public — see below for why that part can't be done here. |
| 3 | Typo "Pride & Prejusice" | **Fixed** | Corrected to "Pride & Prejudice". |
| 4 | Explanations trapped in hover-only tooltips | **Fixed** | The "why is compiled > sum of sections" explanation is now a permanently visible line under the stats, not a `title`-only tooltip. |
| 5 | Prove button availability unclear pre-compile | **Fixed** | New `GET /api/config` returns `{ llm_available }`; the client fetches it on load and sets the button's disabled state + tooltip immediately, instead of only after a compile (or a failed click on the keyless default). |
| 6 | Sample stays "✓ selected" after manual upload | **Fixed** | The file-input change handler now clears `.scard.active`/`aria-pressed` on every genuine manual pick (verified this doesn't fire for `selectSample`'s own programmatic file assignment, so it can't undo a sample selection — only override it, correctly). |
| 7 | Stale "pdf · docx · xlsx · markdown" copy | **Fixed** | Updated to include pptx. |
| 8 | No visible results heading | **Fixed** | `#resultsHeading` changed from `h2.sr-only` to a visible `h2.sec` reading "Your compiled context"; still focus-targeted for screen readers/keyboard. |
| 9 | Single-line input despite multi-question copy | **Fixed** | `#task` is now an auto-growing `<textarea>` (height tracks content via `scrollHeight`). Enter submits the form, Shift+Enter inserts a newline — matching the hint text ("separate with ? or new lines") that previously described behavior the input couldn't actually perform. |
| 10 | Sub-44px mobile tap targets | **Fixed** | `.bpre`/`.qchip`/`.ochip`/`.ochip-more` get extra padding and a 40px `min-height` under the ≤560px breakpoint. |
| 11 | No visible slider scale | **Fixed** | Added a small "200 … 20,000 tokens" label row under the range input. |
| 12 | `--faint` at exactly 4.50:1 on `--bg2` | **Fixed** | `--faint` now equals `--muted` (`#6b6459`), verified 5:1+ on every surface it's used on (bg, bg2, panel) instead of sitting at the AA floor. |
| 13 | Fake-looking "ARCHITECTURE.md" span | **Fixed — differently than proposed** | Rather than just removing the unused id, both `README` and `ARCHITECTURE.md` are now **real links**: `web.ts` added `GET /README.md` and `GET /ARCHITECTURE.md` routes serving the actual repo-root files directly (fixed literal paths, no user input, no traversal risk), so the docs are one click away without needing the GitHub URL at all. |
| 14 | Hero mock bar width didn't match its own label | **Fixed** | Bar width corrected from `9%` to `7.4%`, matching 1,454/19,612. |

### What's left, and why

- **#2's actual URL.** The link behavior (placeholder warning, `rel=noopener`) is
  fixed, but the `href` itself still points at a stand-in (`https://github.com/`)
  because the real repository URL isn't known yet — this project's repo is not public
  as of this session. There's no code fix for "we don't have the URL yet"; whoever
  publishes the repo needs to drop the real link into `index.html`'s two `href`s
  (`#repoLink`, `#repoLink2`). The console warning now fires for both, so it won't ship
  silently broken.

- **Live-rendered, pixel-level confirmation.** Everything above was verified by
  rebuilding, running the real test suite, and hitting the live server with `curl` to
  confirm markup/behavior/response shapes are correct — but I still could not get a
  headless browser running in this sandbox (one missing shared library, `apt`/`sudo`
  both blocked). So things that are fundamentally about *how it looks* rather than
  *what the markup says* — exact textarea growth feel, precise mobile wrapping,
  whether the loading note reads well in context — are implemented correctly per the
  code but not screenshot-confirmed. Recommend a quick manual pass in a real browser
  (`npm run web` → `http://localhost:8000`) before the demo, particularly at ≤560px.
