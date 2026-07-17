# Context Compiler — Security & QA Audit

> **Remediation status (updated):** 9 of 10 findings are now fixed in code and
> verified with live re-tests + regression tests in `npm test`. The one that
> can't be fully closed in application code (prompt injection) is mitigated and
> explained. See **[Remediation status](#remediation-status)** at the end.

**Scope:** the hosted web demo (`src/web.ts`), the MCP server (`src/server.ts`), the
converter shell-out (`src/convert.ts`), and supporting pipeline/client code.
**Method:** full source review followed by live black-box attacks against a running
instance. Every "confirmed" finding below was reproduced empirically, not just read.

**Headline:** the core compile/rank/pack pipeline is sound (no XSS, no SQL, no eval,
no command injection — `execFile` with no shell, defusedxml in markitdown, output
rendered via `textContent`). The exposure is almost entirely in the **hosted demo's
resilience and abuse-resistance**, plus one **path-safety gap in the MCP server**.
None of these block a hackathon submission; several are quick, high-value hardening.

Severity uses likelihood × impact for a publicly reachable demo instance.

---

## Findings at a glance

| # | Finding | Severity | Confirmed |
|---|---------|----------|-----------|
| 1 | Decompression-bomb DoS (305 KB → 754 MB RSS) | **High** | ✅ live |
| 2 | Rate-limit bypass via spoofed `X-Forwarded-For` | **High** | ✅ live |
| 3 | MCP `checkPath` symlink escape of `CC_ROOT` | **High** | ✅ live |
| 4 | Internal path / stack-trace disclosure in errors | Medium | ✅ live |
| 5 | Unbounded upload + cache disk growth (no cleanup) | Medium | ✅ live |
| 6 | `CC_RATE_LIMIT`/`PORT` NaN silently disables/breaks | Medium | ✅ live |
| 7 | Subprocess-per-request exhaustion (no concurrency cap) | Medium | ✅ reasoned |
| 8 | Extension-only allowlist (no content check) | Medium | ✅ live (root cause of #1) |
| 9 | Missing security headers; `X-Powered-By` leak | Low–Med | ✅ live |
| 10 | Residual prompt-injection risk in LLM paths | Low | mitigated, noted |

**Checked and found NOT vulnerable** (good defenses already present): stored/reflected
XSS (output uses `textContent`; HTML built with an `esc()` helper), HTML-driven SSRF
(markitdown does not fetch remote resources), path traversal on `/api/expand`
(`resolve()` + `startsWith(UPLOAD_DIR + sep)` holds), XXE (markitdown depends on
defusedxml), cache poisoning (cache is content-addressed by SHA-256).

---

## 1. Decompression-bomb DoS — **High**

**What:** Uploads are gated by a 50 MB *on-disk* limit and an *extension* allowlist.
Neither bounds the *decompressed* size. Office formats and zips are compressed
containers, so a tiny upload expands to gigabytes inside markitdown.

**Reproduction (live):**
- Built a ZIP of 300 MB of zeros → **305 KB** on disk, renamed `bomb.xlsx`.
- markitdown's own type detector (magika) labeled it `zip` — **the `.xlsx` name is
  irrelevant**, so the extension allowlist provides no protection.
- Converting it drove **peak RSS to 754 MB** — a **~2,470× amplification** from a
  305 KB file that sails under the 50 MB cap.
- Confirmed end-to-end over HTTP: a 30 KB→30 MB variant was **accepted** by
  `/api/measure` (1.3 s of server work), not rejected.

**Impact:** A single ~50 MB upload of maximally-compressible data → tens of GB of
memory → OOM kill of the one demo replica. Trivial, unauthenticated, repeatable.

**Fix (targeted):**
- Enforce a **decompressed-size ceiling**. Before handing an Office/zip file to
  markitdown, sum the uncompressed sizes in the zip central directory and reject if
  the total (or the ratio) exceeds a limit:

  ```ts
  import yauzl from "yauzl"; // or read the central directory manually
  const MAX_UNCOMPRESSED = 200 * 1024 * 1024; // 200 MB
  const MAX_RATIO = 100;                       // 100:1
  // reject if sum(entry.uncompressedSize) > MAX_UNCOMPRESSED
  //   or sum(uncompressed)/fileSize > MAX_RATIO
  ```
- Run the converter subprocess under an **OS memory cap** so it dies cheaply if a
  bomb slips through: `execFile("bash", ["-c", "ulimit -v 1048576; exec markitdown ..."])`
  (1 GB virtual-memory cap), or a container `--memory` limit, or `systemd-run --scale`.
- Lower `maxBuffer` scrutiny: you already cap stdout at 64 MB (good) and timeout at
  120 s (good) — keep both.

**Overkill / defense-in-depth:** convert in a disposable sandbox (gVisor / a
short-lived container / `nsjail`) with no network and a tmpfs quota; treat markitdown
as fully untrusted.

---

## 2. Rate-limit bypass via `X-Forwarded-For` — **High**

**What:** `app.set("trust proxy", 1)` is unconditional, and the limiter keys on
`req.ip`. With trust-proxy on, `req.ip` is derived from the client-supplied
`X-Forwarded-For` header. If the app is reachable directly (or behind a proxy that
doesn't strip the header), the client picks its own "IP" per request.

**Reproduction (live):** with `CC_RATE_LIMIT=3`:
- No header: request 4 onward → **429** (limiter works).
- Rotating `X-Forwarded-For: 10.0.0.1..6`: **all 6 → 200**. Limiter fully bypassed.

**Impact:** Neutralizes the only abuse control. Directly enables #1 (bomb spam), #5
(disk fill), and #7 (subprocess/API-cost exhaustion) at unlimited volume; also
poisons any per-IP logging.

**Fix:** Make trust-proxy match the real deployment and don't trust a raw header for
security decisions.
- If behind exactly one known proxy (Render/Railway/Fly), keep `trust proxy` but
  prefer a hardened limiter: **`express-rate-limit`** with a `keyGenerator` that uses
  the platform's trusted client-IP, plus `validate: { trustProxy: true }` so it warns
  on misconfig.
- If the app can be hit directly, set `trust proxy` to `false` (use the socket IP), or
  to the specific proxy CIDR.
- Because the limiter is in-memory per replica, it also resets on redeploy and doesn't
  span replicas — fine for a demo, but note it.

---

## 3. MCP `checkPath` symlink escape of `CC_ROOT` — **High (for the MCP surface)**

**What:** `server.ts` restricts file access to `CC_ROOT` by string comparison after
`resolve()`. It then calls `statSync(p).isFile()` — which **follows symlinks** — and
reads the path. A symlink *inside* `CC_ROOT` pointing *outside* it passes the string
check and is read.

**Reproduction (live):** placed `CC_ROOT/innocent.txt → /etc/passwd`. The exact
`checkPath` logic **accepted** the path, and reading it returned
`root:x:0:0:root:/root:/bin/bash`. Confinement broken.

**Impact:** An agent (or anything that can drop a symlink into the agent-readable
folder, e.g. a synced directory, a git checkout, an extracted archive) can exfiltrate
arbitrary files — SSH keys, `.env`, `/etc/passwd` — through the "sandboxed" tool.
This is the tool's central security promise, so it rates High even though it needs a
symlink in `CC_ROOT`.

**Fix:** Resolve symlinks and re-check containment against the *real* path:

```ts
import { realpathSync } from "node:fs";
function checkPath(filePath: string): string {
  const p = realpathSync(resolve(filePath.replace(/^~(?=$|\/)/, homedir())));
  const root = realpathSync(ROOT);
  if (p !== root && !p.startsWith(root + sep)) {
    throw new Error(`Access denied: ${p} is outside allowed root ${root}`);
  }
  if (!statSync(p).isFile()) throw new Error(`Not a file: ${p}`);
  return p;
}
```

**Edge cases to cover in a test:** `~`-expansion, a symlinked `CC_ROOT` itself,
relative `../` paths, and a path that *is* exactly `CC_ROOT`.

---

## 4. Internal path / stack-trace disclosure — **Medium**

**What:** Two leaks:
- `convert.ts` returns `(stderr || err.message).slice(0, 500)` on conversion failure,
  and `web.ts` passes `e.message` straight to the client.
- `/api/compile` and `/api/measure` return the absolute server `file_path` in the JSON
  body.

**Reproduction (live):** a malformed PDF made markitdown exit 1 with a full Python
traceback; the client-facing error began:
`Conversion failed: Traceback (most recent call last): File "/usr/local/bin/markitdown" ... /usr/local/lib/python3.10/dist-packages/markitdown/_markitdown.py", line 306`.
That leaks the OS user's paths, Python version, and library layout. `/api/measure`
responses leak `/…/cc-demo-uploads/<hex>.xlsx`.

**Impact:** Recon aid; not directly exploitable, but hands an attacker the filesystem
layout and dependency versions.

**Fix:** Return a generic, stable message to the client; log the detail server-side.

```ts
} catch (e) {
  const status = e instanceof ConversionError ? 422 : 500;
  console.error("compile failed:", e);
  res.status(status).json({
    error: e instanceof ConversionError
      ? "Could not convert this file — it may be corrupt or password-protected."
      : "Internal error.",
  });
}
```

The `file_path` round-trip is needed by `/api/expand`, but you can hand the client an
**opaque token** (e.g. the SHA-256 cache key or a random id mapped server-side) instead
of a real path, and resolve it internally. This also tightens #3's web analogue.

---

## 5. Unbounded upload + cache disk growth — **Medium**

**What:** `saveUpload()` writes every upload to `/tmp/cc-demo-uploads` and **nothing
ever deletes it** (0 `unlink`/cleanup calls in `web.ts`). The content cache in
`~/.cache/context-compiler` (or `/tmp/cc-cache` in Docker) is also append-only by
design. Worse, `/api/measure`, `/api/compile`, and `/api/answer` **each** call
`saveUpload()` — the normal "measure → compile → prove parity" flow writes the *same
file three times* under three random names (3× write amplification).

**Impact:** Slow disk exhaustion → failed writes → 500s / crash. Accelerated by #2.

**Fix:**
- Delete each upload in a `finally` after the request (the cache already holds the
  converted markdown keyed by content hash, so re-conversion is cheap/free).
- Or write to an OS temp file and unlink immediately.
- De-duplicate the save: compute the content hash first; if `saveUpload` for the same
  bytes already produced a path this request, reuse it.
- Add a periodic sweeper (or `tmpreaper`/`tmpfiles.d`) and a max-size cap on the cache
  dir with LRU eviction.

---

## 6. `CC_RATE_LIMIT` / `PORT` NaN footgun — **Medium**

**What:** `RATE_LIMIT = Number(process.env.CC_RATE_LIMIT ?? 30)`. A non-numeric value
yields `NaN`, and `arr.length >= NaN` is **always false**, so the limiter silently
turns off. `PORT = Number(process.env.PORT ?? 8000)` has the same problem (→ `listen(NaN)`
binds a random port).

**Reproduction (live):** with `CC_RATE_LIMIT=abc`, **0 of 40** rapid requests from one
IP were limited.

**Impact:** A typo'd env var in deployment silently removes the abuse control with no
error or log line — you'd never know until the bill arrives.

**Fix:** Validate config at boot and fail loud (or clamp to a safe default):

```ts
function intEnv(name: string, def: number, min = 1): number {
  const v = Number(process.env[name]);
  if (process.env[name] !== undefined && !Number.isFinite(v)) {
    console.warn(`${name}="${process.env[name]}" is not a number; using ${def}`);
    return def;
  }
  return Number.isFinite(v) ? Math.max(min, Math.trunc(v)) : def;
}
```

**Overkill:** validate the whole env with a `zod` schema at startup and refuse to boot
on invalid config.

---

## 7. Subprocess-per-request exhaustion — **Medium**

**What:** Each compile/measure/answer spawns a Python markitdown subprocess (up to
120 s each). There's no concurrency cap. Within the intended 30-req window that's up to
30 concurrent Python processes; with #2's bypass it's unbounded. `/api/answer`
additionally fires **two** LLM calls per request (`Promise.all`), so bypassed rate
limiting is also an **API-cost DoS**.

**Fix:** Add a small concurrency queue (e.g. `p-limit(2–4)`) around `convertToMarkdown`,
returning `503` with `Retry-After` when saturated; keep `/api/answer` behind a stricter,
separate limit since it costs real money. Cache the "measure" result so the subsequent
compile doesn't re-spawn.

---

## 8. Extension-only allowlist — **Medium (root cause of #1)**

**What:** `rejectUnsupportedUpload` checks only the filename extension. markitdown
itself ignores the extension and sniffs content (magika), so the allowlist and the
converter disagree about what a file *is*. That's exactly why the `.xlsx`-named zip
bomb in #1 got through.

**Fix:** Validate by **content**, not name. Sniff magic bytes (e.g. `file-type`) and
require the detected type to be in the allowlist; reject on extension/content mismatch.
Combine with the decompression bounds from #1.

**Edge cases:** legitimate `.csv`/`.txt`/`.md`/`.html` have no reliable magic bytes —
treat "detected as text" as acceptable for those extensions only.

---

## 9. Missing security headers; `X-Powered-By` leak — **Low–Medium**

**What (live):** the only non-standard response header is `X-Powered-By: Express`.
No `Content-Security-Policy`, `X-Content-Type-Options`, `X-Frame-Options`/`frame-ancestors`,
`Referrer-Policy`, or `Strict-Transport-Security`.

**Impact:** Clickjacking is possible (no frame protection); no defense-in-depth against
content sniffing or a future XSS; the framework banner aids fingerprinting.

**Fix:** Add `helmet` and disable the banner:

```ts
import helmet from "helmet";
app.disable("x-powered-by");
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:"],
      scriptSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
    },
  },
}));
```

(The page currently inlines a few `style="…"` attributes and has inline
`<script defer src>` — the src script is fine under `'self'`, but inline `style`
attributes will trip a strict CSP. Either move them to `style.css` or allow
`'unsafe-inline'` for `style-src` only. Worth doing since you already extracted the CSS.)

---

## 10. Residual prompt-injection risk — **Low (already mitigated)**

Document content is wrapped in explicit `UNTRUSTED … / END UNTRUSTED` markers, and both
the rerank prompt and the answer prompt tell the model to treat the content as data and
ignore embedded instructions. That's the right posture. It is not a hard guarantee —
a determined injection could still influence the rerank ordering or an answer. Keep the
markers; consider noting the residual risk in the README's threat model (you already
reference one), and never let compiled output drive side-effectful tool calls without a
human/agent gate.

---

## Suggested remediation order

1. **#3 symlink `realpath`** — one-line-ish fix, closes the MCP sandbox promise. Add a test.
2. **#2 trust-proxy / limiter** and **#6 NaN config** — cheap, restore the abuse control.
3. **#1 + #8 decompression bounds + content sniffing + subprocess memory cap** — the real DoS.
4. **#5 upload cleanup** and **#7 concurrency/answer cap** — resilience + cost.
5. **#4 error hygiene** and **#9 helmet headers** — polish, low effort.

## Regression tests worth adding (this project already leans on `npm test`)

- `checkPath` rejects a symlink inside `CC_ROOT` that points outside it (guards #3).
- A zip/office file whose declared uncompressed size exceeds the ceiling is rejected
  before conversion (guards #1/#8).
- Conversion failure returns a generic message containing no `/usr/`, `/app/`, or
  `Traceback` (guards #4).
- `intEnv("CC_RATE_LIMIT", 30)` returns 30 for `"abc"` and clamps negatives (guards #6).

---

## Remediation status

All fixes below were implemented, rebuilt, **re-attacked live** with the same probes
that originally confirmed each finding, and locked in with regression tests
(`testPathGuardBlocksSymlinkEscape`, `testUploadGuardRejectsBombAndMismatch`,
`testConversionErrorIsSanitized`, `testEnvParsingFailsSafe`, plus the existing
`testClientBuildIsPlainScript`). `npm test` is green (17 tests); `npm audit` reports 0
vulnerabilities.

New/changed files: `src/env.ts` (safe env parsing), `src/upload-guard.ts` (content
sniffing + decompression-bomb precheck), `src/path-guard.ts` (testable symlink-safe
path check), `src/convert.ts` (memory cap + concurrency gate + sanitized errors),
`src/web.ts` (headers, trust-proxy default, opaque handles, upload dedupe + TTL sweep,
central error mapping), `src/server.ts` (uses `path-guard`), client `types.ts`/`app.ts`
(`file_path` → opaque `handle`).

| # | Finding | Status | How it was fixed / verified |
|---|---------|--------|------------------------------|
| 1 | Decompression-bomb DoS | **Fixed** | ZIP central-directory size precheck (`upload-guard.ts`) rejects the 305 KB→300 MB bomb with **HTTP 413** before conversion; backed by a hard **1.5 GB `ulimit -v`** on the converter subprocess (Linux) + concurrency cap. Re-tested live: bomb now rejected. |
| 2 | X-Forwarded-For rate-limit bypass | **Fixed** | `trust proxy` now defaults to **false** (unspoofable socket IP); operators opt in via `CC_TRUST_PROXY`. Re-tested: 15/15 spoofed-XFF requests are now rate-limited (was 0/15). |
| 3 | MCP symlink escape of `CC_ROOT` | **Fixed** | `realpathSync` resolves symlinks **before** the containment check (`path-guard.ts`). Regression test proves a symlink→`/etc/passwd`-style escape is denied. |
| 4 | Path / stack-trace disclosure | **Fixed** | Converter errors are logged server-side and returned as a generic message (`convert.ts`); all routes go through one sanitizing error mapper; the leaky `file_path` is replaced by an **opaque handle**. Re-tested: malformed PDF now returns a generic 422, no traceback/paths. |
| 5 | Unbounded upload/cache disk growth | **Fixed** | Content-addressed filenames **dedupe** (measure+compile+answer now share 1 file, was 3) + a TTL sweeper deletes stale uploads. Re-tested: 1 file on disk after the full flow. |
| 6 | NaN config disables limiter | **Fixed** | `intEnv`/`numEnv` reject NaN, warn, and clamp. Re-tested: `CC_RATE_LIMIT=abc` now enforces the default 30 (was: limiter fully off). |
| 7 | Subprocess/API-cost exhaustion | **Fixed (mitigated)** | Converter concurrency gate (default 3, bounded queue → **HTTP 503**) caps concurrent Python processes; dedupe means measure→compile reuses the cache instead of re-spawning. Cross-replica coordination is still out of scope (see below). |
| 8 | Extension-only allowlist | **Fixed** | Uploads validated by **magic bytes** (ZIP/PDF signatures, NUL-byte check for text) and required to match the claimed extension. Re-tested: a zip renamed `.pdf` → **415**. |
| 9 | Missing headers / `X-Powered-By` | **Fixed** | CSP, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, COOP added; `x-powered-by` disabled. Re-tested: all present, banner gone. |
| 10 | Prompt injection | **Mitigated (see below)** | Kept the untrusted-content markers + explicit "ignore embedded instructions" in both LLM prompts. |

### What can't be fully fixed in application code, and why

- **#10 Prompt injection — mitigated, not eliminable.** There is no known complete
  defense against adversarial instructions embedded in document text; it's an open
  research problem. The right posture (data/instruction separation via the UNTRUSTED
  markers, explicit "treat as data" instructions, and never letting compiled output
  auto-trigger side-effectful tools) is in place. Full elimination isn't achievable in
  code here — it depends on the consuming agent's own guardrails.

- **#7 across replicas — bounded per instance only.** The concurrency gate and rate
  limiter are **in-process**. Truly bounding cost across a horizontally-scaled fleet
  needs shared state (e.g. Redis token buckets) and a real deployment topology — an
  infrastructure decision, not something implementable meaningfully in this repo without
  standing up that infrastructure. Per-replica limits are the in-code mitigation.

- **Converter OS-level isolation (seccomp / no-network namespace / disposable
  sandbox).** The in-code mitigations (memory cap, timeout, concurrency, size precheck,
  content sniffing) contain the blast radius, but true isolation (gVisor, `nsjail`, a
  per-conversion throwaway container) is a host/deployment capability. It can't be added
  purely in Node, and the environment must support it. Recommended for a hardened deploy.

- **HTTPS / HSTS.** TLS is terminated by the hosting platform (Render/Railway/Fly), not
  the app. Emitting `Strict-Transport-Security` unconditionally would be wrong for local
  HTTP dev and is redundant behind a platform that already enforces HTTPS — it belongs at
  the proxy/platform layer, so it's intentionally not set in app code.

- **`ulimit -v` on non-Linux dev.** The memory cap is a no-op on macOS (BSD `ulimit -v`
  doesn't bound address space the same way), so local Mac dev runs without it. That's
  acceptable because production is Linux/Docker, where the cap is active; the size
  precheck still applies everywhere.

- **Authentication / CAPTCHA.** The demo is intentionally public and unauthenticated —
  adding auth would defeat its purpose. Rate limiting, upload validation, and the cost
  caps are the compensating controls; bot mitigation (e.g. Cloudflare Turnstile) belongs
  at the CDN/platform edge if abuse becomes real.
