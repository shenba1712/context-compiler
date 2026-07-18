/**
 * In-process operational counters — a cheap way to see what the server is
 * actually doing (compiles, agent runs, conversion failures, LLM failovers,
 * rate-limit hits). Surfaced at GET /healthz.
 *
 * These live in memory and reset on restart, and aren't shared across replicas
 * — fine for a single-instance demo, and the honest scope for this project. A
 * real multi-replica deployment would push these to a metrics backend instead
 * (see the observability notes in the README).
 */
const counters: Record<string, number> = Object.create(null);

export function inc(name: string, by = 1): void {
  counters[name] = (counters[name] ?? 0) + by;
}

export function snapshot(): Record<string, number> {
  return { ...counters };
}
