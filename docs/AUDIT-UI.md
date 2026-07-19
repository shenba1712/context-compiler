# UI / UX adversarial audit (web demo)

**Scope:** `public/index.html`, `public/style.css`, `src/client/app.ts`, `src/client-ux.ts`, `src/web.ts`  
**Method:** Jul 18 break-the-app UX/agentic pass + Jul 19 re-break of stale/error/empty paths  
**Date:** 2026-07-19  
**Status:** Clear bugs fixed in tree (not committed). Open items listed below.

Indexed from [AUDIT-CURRENT.md](./AUDIT-CURRENT.md). Sibling: [AUDIT-SECURITY.md](./AUDIT-SECURITY.md).

---

## Fixed this pass

| ID | Bug | Fix |
|----|-----|-----|
| U1 | **Budget soft-stale left Prove enabled** — Prove recompiled under the live slider while on-screen cards were from the prior budget | `isProveStale()` = question **or** budget drift; Prove + Include-in-Prove disabled; titles explain why |
| U2 | **Agent cancel wiped the panel** — AbortError hid steps; looked like a hang/crash | Keep partial steps; `#aErr` = “Cancelled…”; server still aborts on `req.close` |
| U3 | **SSE ended without `done`** — silent “success” with empty answer | Require `done`; else agent-local error (“connection ended…”) |
| U4 | **Empty included bucket looked broken** — “Included in context” with zero cards | Explicit empty copy under `#sections` |
| U5 | **Peek/expand errors in top `#err`** — wrong locality while scrolled in results | New `#resultsErr` in results panel |
| U6 | **Question-stale Agent validation used `#err`** | Agent-local `#aErr` + show `#agentSec` |
| U7 | **Floor notes pointed at `expand_section` when omit chips/cards exist** | Prefer “peek omitted sections below”; MCP id only when not in omit UI |
| U8 | **Early-stop bar looked like under-pack failure** | Packed bar adds “N spare under ceiling” when `early_stopped` |
| U9 | **Mobile: quiet Prove… stretched full-width** with primary buttons | `.row .btn:not(.quiet)` only grows on ≤560px |

Contracts + tests: `shouldDisableProveWhenBudgetStale`, `shouldDisableProveWhenStale`, `shouldKeepAgentStepsOnCancel`, `agentStreamIncompleteMessage`, `emptyCompiledSectionsMessage` in `src/client-ux.ts` / `testClientUxContracts`.

---

## Verified OK (no code change)

| Topic | Evidence |
|-------|----------|
| Soft-stale question / hard-clear doc | Question edit → banner + disable Prove/Agent; sample/file → `clearCompiledResults()` |
| Compile → change Q → Prove/Agent | Buttons disabled via `isQuestionStale()`; defensive prove/agent errors if forced |
| Hero vs sample | P&P “Bingley / Jane” @ any budget → **19,612 → 775 (96%)**; matches hero plane |
| Empty compile (no file/Q) | Form `#err`; results stay hidden if never succeeded |
| Failed first compile | `resultsSec` hidden again (no empty chrome) |
| Agent idle before compile | `#agentSec` starts hidden; idle CTA only after successful compile + not stale |
| Prove error locality | `.prove-err` near form + results Prove strip (`proveFlowUsesLocalError`) |
| Agent error locality | `#aErr` / `#aParityErr` (after this pass, validation too) |
| 429/503 messaging | `apiFailureMessage` appends retry hint + Retry-After for 503 |
| Agent 429 restore | `restoreAgentRetryAfterError` → idle CTA; `#aErr` stays visible (outside run body) |
| Server abort on cancel | `web.ts` `req`/`res` `close` → `AbortController` into agent/answer |
| Rate-limit expect copy | Filled from `/api/config` |

---

## Still open

| ID | Severity | Issue | Notes / suggested fix |
|----|----------|-------|------------------------|
| O1 | P3 | **`packagingGapNote` unused in UI** | Contract exists; API does not expose wire/packaging tokens separately from content. Wire only if product wants “content vs packaging” on the exact-text toggle. |
| O2 | P3 | **Agent stays enabled on budget-stale** | Intentional: Agent recompiles from form and does not claim on-screen cards. Idle CTA still hidden until recompile. Document asymmetry; optional harden = disable top Agent too. |
| O3 | P3 | **Prove power-path without compile** | “Prove…” can run before any compile (by design). Fine; ensure judges don’t confuse it with “parity against empty results.” |
| O4 | P3 | **Cancel on compile/prove is silent** | No “Cancelled” toast; panel just restores. Acceptable; could mirror agent cancel copy. |
| O5 | P3 | **Hero is a fixed example, not live** | Numbers match current pack; will drift if ranking/pack changes. Prefer regenerating from sample in CI or a footnote “example run.” |
| O6 | P3 | **Mobile hero stack** | Plane `min-height: 52vh` under copy makes first viewport very tall; not broken, just long. |
| O7 | P3 | **Budget-omit auto-peek N expands** | Can flood results + rate-limit pool on huge omit lists. Cap or lazy-peek. |
| O8 | P2 (ops) | **Jul 18 P15 auto-retry** | Messaging fixed; still no client auto-retry once on 503 converter busy. Optional jittered single retry. |
| O9 | P3 | **Relevance omit closed by default** | Floor note may say “peek below” while disclosure is collapsed — discoverable but easy to miss. |
| O10 | P3 | **Session savings badge** | Accumulates across compiles even after doc hard-clear; not wrong, can confuse. |

---

## Jul 18 break-test UX/agentic crosswalk

| Jul 18 ID | Area | Status in web UX |
|-----------|------|------------------|
| P9 | Agent ignores disconnect | **Server fixed** (`req.close` abort). **Client:** cancel + incomplete SSE handled this pass (U2/U3). |
| P15 | Client 429/503 | **Messaging done**; auto-retry still open (O8). |
| P12 | Compile JSON doubles text | API/product; UI needs cards — leave. |
| Cost metering (P1) | Weighted rate costs | Surface in expect-box; not a client bug. |

---

## Break checklist (re-run)

1. Compile sample → edit question → Prove/Agent disabled; banner; cards remain.  
2. Restore question → controls re-enable.  
3. Move budget → Prove disabled; Agent top still works; idle CTA hidden.  
4. Switch sample → results + agent hard-cleared.  
5. Compile → Cancel mid-wait → no empty results shell on first attempt.  
6. Run agent → Cancel → steps remain + cancelled copy; Run agent again works.  
7. Force agent 429 → error in `#aErr` + retry CTA / top button.  
8. Tiny budget nothing-fits → empty included copy + floor note; peek works; errors in `#resultsErr`.  
9. Early-stop P&P → spare-under-ceiling on packed bar + Coverage complete floor note.  
10. Narrow ≤560px → primary buttons full-width; Prove… stays compact.
