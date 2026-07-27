import type { CompileApiResult } from "./types";

const KEY = "cc-workspace-v1";
const LEGACY_KEY = "cc-demo-v1";

export type PersistedWorkspace = {
  task: string;
  budget: number;
  sampleKey: string | null;
  compile: CompileApiResult | null;
  compiledTask: string | null;
  compiledBudget: number | null;
  proveExpandedIds: string[];
  proveExpandedTokens: [string, number][];
  sessionSavedTokens?: number;
  sessionSavedUsd?: number;
};

export function loadPersistedWorkspace(): PersistedWorkspace | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(KEY) ?? sessionStorage.getItem(LEGACY_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedWorkspace;
    sessionStorage.setItem(KEY, raw);
    sessionStorage.removeItem(LEGACY_KEY);
    return parsed;
  } catch {
    return null;
  }
}

export function savePersistedWorkspace(data: PersistedWorkspace): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(KEY, JSON.stringify(data));
    sessionStorage.removeItem(LEGACY_KEY);
  } catch {
    /* quota / private mode */
  }
}

export function clearPersistedWorkspace(): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.removeItem(KEY);
    sessionStorage.removeItem(LEGACY_KEY);
  } catch {
    /* ignore */
  }
}
