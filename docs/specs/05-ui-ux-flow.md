# UI / UX flow

**Implementation:** Next App Router under `apps/web` (Forest theme). API via Nest → `src/http/demo-app.ts`.

## Routes

| Route | Purpose |
| --- | --- |
| `/` | Brand-first landing + savings plane |
| `/demo` | Upload/sample, question, budget presets, Compile |
| `/demo/results` | Packed sections, omit buckets, peek, Include in Prove |
| `/demo/prove` | Full vs compiled answer parity (`expanded_ids`) |
| `/demo/agent` | SSE agent + optional full-file compare |
| `/mcp` | MCP install / tool playbook |

## Contracts

Pure UX helpers for stale question/budget and Include-in-Prove live in `src/client-ux.ts` (unit-tested). The Next app mirrors the ones it needs in `apps/web/lib/ux.ts` — keep them in sync.

Compile state (task, budget, last compile, prove includes, sample key) persists in `sessionStorage` so refresh on Results does not wipe the pack; sample `File` is re-fetched from `/samples/` when possible.
