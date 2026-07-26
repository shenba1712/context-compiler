import type { CompileApiResult } from "./types";

const KEY = "cc-workspace-v1";

export type PersistedWorkspace = {
  task: string;
  budget: number;
  sampleKey: string | null;
  compile: CompileApiResult | null;
  compiledTask: string | null;
  compiledBudget: number | null;
  proveExpandedIds: string[];
  proveExpandedTokens: [string, number][];
};

export function loadPersistedWorkspace(): PersistedWorkspace | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PersistedWorkspace;
  } catch {
    return null;
  }
}

export function savePersistedWorkspace(data: PersistedWorkspace): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    /* quota / private mode */
  }
}

export function clearPersistedWorkspace(): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
