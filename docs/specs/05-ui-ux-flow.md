# UI / UX flow

**Implementation:** Next App Router under `apps/web` (Forest theme). API via Nest → `src/http/app.ts`.

## Routes

| Route | Purpose |
| --- | --- |
| `/` | Brand-first landing + savings plane |
| `/workspace` | Upload/sample, question, budget presets, Compile |
| `/workspace/results` | Packed sections, omit buckets, peek, Include in Prove |
| `/workspace/prove` | Full vs compiled answer parity (`expanded_ids`) |
| `/workspace/agent` | SSE agent + optional full-file compare |
| `/mcp` | MCP install / tool playbook |

## Contracts

Pure UX helpers for stale question/budget and Include-in-Prove live in `src/http/client-ux.ts` (unit-tested). The Next app mirrors the ones it needs in `apps/web/lib/ux.ts` — keep them in sync.

Compile state (task, budget, last compile, prove includes, sample key) persists in `sessionStorage` so refresh on Results does not wipe the pack; sample `File` is re-fetched from `/samples/` when possible.
