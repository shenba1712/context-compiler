# DevOps

**Status:** Current  
**Artifacts:** `Dockerfile`, `render.yaml`, `.github/workflows/test.yml`

---

## 1. Build and run

| Mode | Command / entry |
| --- | --- |
| Build | `npm run build` (`tsc` + client `tsc`) |
| Web demo | `node dist/web.js` / `npm run web` |
| MCP | `node dist/server.js` / `npm run mcp` |
| Tests | `npm test` (build + `NODE_ENV=test node dist/tests/test.js`) |
| Lint / format | `npm run lint`, `npm run format:check` |

Image and local installs both need the MarkItDown Python package for conversion.

---

## 2. Docker

Single image: Node 22 slim + `python3` + `pip install markitdown[docx,pdf,xlsx,pptx]`.

- Copies `package*.json`, sources, `public/`, README, ARCHITECTURE.
- `npm ci` → build → `npm prune --omit=dev`.
- `EXPOSE 8000`, `CMD ["node", "dist/web.js"]`.
- Default `CC_CACHE_DIR=/tmp/cc-cache`.
- Abuse knobs pinned in image env so a cleared dashboard cannot silently widen limits.
- Does **not** set `CC_TRUST_PROXY` in the image (platform sets hop count).

---

## 3. Render Blueprint (`render.yaml`)

| Setting | Value |
| --- | --- |
| Type | Docker web service |
| Plan | `free` (spins down ~15 min idle → 30–60s cold start) |
| Health check | `/healthz` |
| Auto deploy | on push to connected branch |
| Secrets (`sync: false`) | `GEMINI_API_KEY`, `OPENROUTER_API_KEY` |
| Generated | `CC_METRICS_TOKEN` |
| Proxy | `CC_TRUST_PROXY=1` |
| Pinned limits | file size, rate costs, convert/LLM concurrency, LLM timeout |

`PORT` is injected by Render; do not hardcode it in the blueprint.

---

## 4. CI (GitHub Actions)

Workflow: `.github/workflows/test.yml`

On push to `main`/`master` and on PRs:

1. Checkout  
2. Node 20 + npm cache  
3. Python 3.12 + markitdown extras  
4. `npm ci`  
5. Lint → format check → build → `npm test`  

No production secrets required; LLM paths are tested with mocks / injected completions where needed.

---

## 5. Health and metrics

| Endpoint | Role |
| --- | --- |
| `GET /healthz` | Liveness only (`status`, `uptime_s`). Must stay synchronous and Python-free so cold starts do not look permanently dead. |
| `GET /metrics` | Bearer-gated counters + `llm_configured` + `converter_available` probe |

In-process counters reset on restart and are not aggregated across replicas.

---

## 6. Rate limits and capacity

Demo abuse posture (also documented in technical requirements):

- Per-IP point pool (default 30 / 5 minutes).
- Weighted costs: agent 12, answer / agent-parity 4, other API 1.
- Converter concurrency/queue and LLM job slots.
- Upload size + ZIP bomb prechecks.

Appropriate for a public demo link, not multi-tenant SaaS.

---

## 7. Secrets

| Secret | Where | Purpose |
| --- | --- | --- |
| `GEMINI_API_KEY` / `GOOGLE_API_KEY` | Host env / dashboard | Primary LLM |
| `OPENROUTER_API_KEY` | Host env | Failover |
| `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `CC_LLM_*` | Optional | Further chain entries |
| `CC_METRICS_TOKEN` | Host env | Gate `/metrics` |

Never commit keys. Browser never receives them. MCP/local use process environment.

---

## 8. Deploy and cold start

**Accepted hosting behavior (free tier):**

1. Idle spin-down.  
2. Next request wakes the container (tens of seconds).  
3. `/healthz` must answer quickly once the process is up.  
4. First conversion may still take seconds (Python + model load inside markitdown).

Mitigations operators use: external ping of `/healthz`, or a paid always-on plan. Attach a volume if conversion cache should survive redeploys (`CC_CACHE_DIR`); default `/tmp` does not.

---

## 9. What is ephemeral

On process restart or free-tier recycle:

| State | Persistence |
| --- | --- |
| Upload files + handles | Lost (temp dir + memory map) |
| Agent parity handles | Lost |
| Rate-limit maps | Lost (resets pool) |
| Metrics counters | Lost |
| Conversion cache under `/tmp` | Lost |
| Content-addressed cache on durable volume | Survives if volume kept |

No database backups. Source of truth is git; rebuild from Docker / blueprint.

---

## 10. Logging in production

- stderr only (especially important beside MCP on stdio).
- Optional JSON lines and error webhook.
- Request logging skips routine static 200s.
