# Threat Model

**Status:** Current  
**Scope:** MCP server + hosted/local web demo as implemented  
**Assumption:** Demo is a public, accountless link with abuse caps — not a multi-tenant SaaS with isolation guarantees.

---

## 1. Actors

| Actor | Trust | Capabilities |
| --- | --- | --- |
| Demo uploader / browser client | Untrusted | Multipart uploads, API calls, spoof headers if misconfigured |
| MCP caller (local agent host) | Semi-trusted | Supplies filesystem paths; expected to be the machine owner or controlled automation |
| Document content | Untrusted | May contain prompt-injection text, hostile ZIP/PDF structures |
| LLM provider | Trusted only after operator sets a key | Receives prompts including document slices when Prove/Agent used |
| Platform operator | Trusted | Holds API keys, metrics token, proxy settings |

---

## 2. Assets

| Asset | Sensitivity |
| --- | --- |
| Uploaded / MCP-readable files | User data; may be confidential |
| API keys (Gemini, OpenRouter, …) | High — server env only |
| Metrics token | Medium — ops visibility |
| Compiled markdown / agent context | Derived user data; briefly held in memory for parity |
| Host filesystem outside `CC_ROOT` / upload dir | Must remain inaccessible |
| Process memory / disk (DoS) | Availability |

---

## 3. Trust boundaries

```
[Browser] --HTTP--> [web.ts] --subprocess--> [markitdown]
                         |
                         +--HTTPS--> [LLM providers]   (opt-in)
                         |
                         +--memory--> handles / rate maps / parity

[MCP client] --stdio--> [server.ts] --realpath--> files under CC_ROOT
                              |
                              +--subprocess--> [markitdown]
```

Web never accepts caller-supplied paths. MCP accepts paths only after realpath confinement.

---

## 4. Threats and mitigations

| ID | Threat | Mitigation in code | Residual risk |
| --- | --- | --- | --- |
| T1 | Path escape via `../` or symlink under root | `path-guard.ts` realpaths root and target before prefix check | Mis-set `CC_ROOT` to a broad tree still exposes that tree |
| T2 | Web path traversal / arbitrary read | Opaque handles; resolve must stay under upload dir | Handle guess entropy; process memory disclosure out of scope |
| T3 | Zip / decompression bomb | Upload ZIP CD checks; Linux `ulimit -v`; size limits; convert timeout | Novel archive tricks; non-Linux without mem cap relies more on precheck |
| T4 | Oversized upload / convert DoS | `CC_MAX_FILE_BYTES`, multer limits, convert concurrency/queue → 503 | Distributed many-IP flood still costs CPU until platform limits |
| T5 | Rate-limit bypass via `X-Forwarded-For` | Default `trust proxy` false; blanket `true` ignored unless insecure override; Render uses hop `1` | Wrong hop count trusts client headers |
| T6 | Prompt injection in documents | Untrusted markers; system instructions to ignore doc instructions; consuming agent is last line | Determined models may still follow injected text |
| T7 | Key leakage to client | Keys only in server env; not in `/api/config` | Operator mistake (embedding keys in client builds) outside this repo |
| T8 | SSRF via custom LLM base URL | Only if operator sets `CC_LLM_BASE_URL` / provider base overrides | Operator can point at internal URLs; treat as trusted config |
| T9 | LLM bill / quota abuse | Per-IP weighted rate limit; LLM concurrency; answer context cap; Abort on disconnect | Free-tier provider 429 still possible; multi-replica multiplies pools |
| T10 | Converter stderr / stack leaks | Sanitized `ConversionError`; details logged server-side | Log sinks must be protected |
| T11 | Clickjacking / XSS | CSP, frame-ancestors none, nosniff; scripts only `'self'` | `'unsafe-inline'` styles; future markup bugs |
| T12 | Parity handle replay | One-shot delete after successful compare; TTL; opaque id | Stolen handle before consume can run one compare |
| T13 | MCP stdout protocol break | Logging to stderr only; tests guard stray stdout | Misbehaving dependency write to stdout |

---

## 5. Data flow notes

- **No key → no LLM network** for Prove/Agent; compile stays local.
- With keys, document slices leave the machine to the configured providers.
- Conversion cache stores markdown derived from file bytes; treat cache dir as sensitive as uploads.
- Uploads live under OS temp with TTL sweep; not a durable store.

---

## 6. Out of scope / accepted residual

- Full sandbox of MarkItDown / Python ecosystem CVEs.
- Guaranteeing model refusal of all injections.
- Cross-replica coordinated abuse prevention.
- User authentication and per-tenant encryption.
- OCR path (rejected rather than half-supported).

---

## 7. Review triggers

Revisit this model when adding: caller-supplied URLs, persistent multi-tenant storage, additional MCP tools that execute code, or trusting reverse proxies differently.
