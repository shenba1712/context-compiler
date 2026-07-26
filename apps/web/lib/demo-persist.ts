import type { CompileApiResult } from "./types";

const KEY = "cc-demo-v1";

export type PersistedDemo = {
  task: string;
  budget: number;
  sampleKey: string | null;
  compile: CompileApiResult | null;
  compiledTask: string | null;
  compiledBudget: number | null;
  proveExpandedIds: string[];
  proveExpandedTokens: [string, number][];
};

export function loadPersistedDemo(): PersistedDemo | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PersistedDemo;
  } catch {
    return null;
  }
}

export function savePersistedDemo(data: PersistedDemo): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    /* quota / private mode */
  }
}

export function clearPersistedDemo(): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
