# Security / Chaos / Config audit (Jul 19, 2026)

Independent adversarial pass on the local codebase. Replays the **Jul 18 break-test** P0/P1 hardenings and adds new findings. Sibling product/docs streams own `docs/AUDIT-CURRENT.md` — this file is the Security/Chaos section.

**Scope:** local tree only. No production Render attacks. No exploit PoCs.

---

## Jul 18 break-test — re-verification

| ID | Theme | Status on current tree |
| --- | --- | --- |
| P0 burn money | Weighted rate costs (`agent=12`, `answer/parity=4`) + LLM job concurrency | **Held.** `/api/config` exposes costs; tests lock agent > answer > 1. |
| P0 RAM before queue | `multer.diskStorage` (not memory) | **Held.** Source guard + regression test. |
| P1 answer error leak | `/api/answer` → `errorResponse()` | **Held.** Provider failure returns generic 5xx; no `sk-` / traceback. |
| P1 trust proxy | `CC_TRUST_PROXY=true` ignored unless `CC_ALLOW_INSECURE_TRUST_PROXY=1` | **Held.** Unit-tested. Prefer hop `1`. |
| P1 ZIP / non-Linux mem | Upload ZIP CD checks; Linux `ulimit -v` | **Held.** Non-Linux refuses unreadable ZIP CD when mem cap off. |
| P2 healthz recon | Cheap `/healthz`; `/metrics` behind token | **Held.** |
| P2 rate map bound | `CC_RATE_MAP_MAX` + stale sweep | **Held.** |
| P2 disconnect abort | Answer + agent `AbortSignal` on `close` | **Held.** `testAgentAbort` + route wiring. |
| P2 ARCHITECTURE in Docker | `.dockerignore` `!ARCHITECTURE.md` | **Held.** |
| P2 filename reflection | `sanitizeSourceName` | **Strengthened this pass** (CR/LF, `-->`, MCP path). |
| P3 CI `NODE_ENV=test` | Workflow sets `NODE_ENV: test` | **Held.** |
| P3 LLM fetch timeout | `AbortSignal.timeout` on providers | **Held.** |

---

## Fixed this pass

| Sev | Finding | Fix |
| --- | --- | --- |
| P1 | `ConversionError("Not a file: ${absPath}")` leaked server paths through web/MCP | Generic `Not a readable file.`; path logged server-side only |
| P1 | MCP `path-guard` errors echoed absolute root/target paths | Path-free denial / missing-file messages |
| P2 | Sample library `path.join(STATIC_DIR, "samples", file)` — absolute `file` escapes (Node join quirk) | `resolveSampleFile()` basename allowlist + realpath under `samples/` |
| P2 | Expand / agent-parity used string `resolve` prefix, not realpath | `pathUnderUploadDir()` realpath confinement |
| P2 | MCP/web `basename(filePath)` could put `-->` / markup into assemble headers | Always `sanitizeSourceName(...)` in pipeline/agent/prove |
| P3 | Metrics bearer compare not constant-time | `timingSafeEqual` on equal-length buffers |
| P3 | Concurrent same-hash upload clobber | Exclusive `wx` create on content-addressed dest |

Tests added: trust-proxy, sanitizeSourceName, missing-path hygiene, diskStorage guard, weighted costs + keyless degradation + oversized multipart, concurrent compile, answer error hygiene, path-guard message hygiene, cache atomic-put DR shape.

`npm test` — **ALL TESTS PASSED** after these changes.

---

## Chaos / DR probes (local)

| Probe | Result |
| --- | --- |
| Oversized multipart field (~40KB task) | **413** JSON, no HTML stack |
| Missing file upload | **400** |
| Keyless `/api/answer` + `/api/agent` | **400** with configure-key copy; compile still works |
| Concurrent identical-byte compiles | Both **200**, distinct opaque handles |
| Kill mid-agent (`AbortSignal`) | Loop stops; no further `complete()` |
| Corrupt/unknown conversion cache | Miss / wipe → reconvert; puts are pid-tmp + `renameSync` |
| Process restart | Handles / rate map / metrics ephemeral (accepted demo DR) |
| Invalid budgets (`NaN`, negative, huge) | `clampBudget` / `intEnv` fail-safe |

---

## Residual risks (accepted or out of scope)

- **Multi-replica burn money:** per-process rate limits and LLM pools do not share; N replicas ≈ N× budget.
- **Prompt injection** in document / task text: markers + instructions help; model may still comply.
- **ZIP tricks beyond CD heuristics** on non-Linux without cgroup mem max.
- **MarkItDown / Python CVEs** — converter treated as untrusted subprocess, not a full sandbox.
- **Stolen parity handle** before one-shot consume can run one compare.
- **Operator SSRF** if `CC_LLM_BASE_URL` points at an internal URL (trusted config).
- **In-memory handles** die on restart → expand 404 until recompile.

---

## Hackathon-judge attack cheatsheet

| Goal | What stops it today |
| --- | --- |
| Burn API $ | Weighted rate + LLM concurrency + answer context cap + abort on disconnect |
| OOM Node | Disk uploads + size cap + convert queue/concurrency + ZIP bomb precheck |
| XSS via filename / markdown | `sanitizeSourceName`; UI uses `textContent` / `esc()` for untrusted strings; CSP `script-src 'self'` |
| Path escape (MCP) | `realpath` both sides of `CC_ROOT` |
| Path escape (web) | Opaque handles only; realpath under upload dir; no caller paths |
| Provider recon via errors | `errorResponse` / `LlmUnavailableError.publicMessage`; conversion sanitized |

---

## Pointer

Indexed from [AUDIT-CURRENT.md](./AUDIT-CURRENT.md) (Security section + companion line at top). Sibling: [AUDIT-UI.md](./AUDIT-UI.md).
