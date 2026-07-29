import type { WorkspaceCompiledSnapshot } from "../../../src/http/workspace-reducer";
import type { CompileApiResult, SectionInfo } from "./types";

export const WORKSPACE_STORAGE_KEY = "cc-workspace-v2";
export const PREVIOUS_WORKSPACE_STORAGE_KEY = "cc-workspace-v1";
export const LEGACY_WORKSPACE_STORAGE_KEY = "cc-demo-v1";

type JsonRecord = Record<string, unknown>;

export type PersistedWorkspace = {
  task: string;
  budget: number;
  filePicked: string;
  sampleKey: string | null;
  compiledSnapshot: WorkspaceCompiledSnapshot<CompileApiResult> | null;
  proveExpandedIds: string[];
  proveExpandedTokens: [string, number][];
  sessionSavedTokens: number;
  sessionSavedUsd: number;
};

type WorkspaceV2Record = {
  version: 2;
  live: {
    task: string;
    budget: number;
    filePicked: string;
    sampleKey: string | null;
  };
  compiledSnapshot: WorkspaceCompiledSnapshot<CompileApiResult> | null;
  includeMetadata: {
    expandedIds: string[];
    expandedTokens: [string, number][];
  };
  sessionTotals: {
    savedTokens: number;
    savedUsd: number;
  };
};

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function nonNegativeNumber(value: unknown, fallback = 0): number {
  const parsed = finiteNumber(value);
  return parsed === null ? fallback : Math.max(0, parsed);
}

function positiveNumber(value: unknown, fallback: number): number {
  const parsed = finiteNumber(value);
  return parsed !== null && parsed > 0 ? parsed : fallback;
}

function stringOr(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function isSection(value: unknown): value is SectionInfo {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.section === "string" &&
    finiteNumber(value.tokens) !== null &&
    (value.relevance === null || finiteNumber(value.relevance) !== null) &&
    (value.truncated === undefined || typeof value.truncated === "boolean") &&
    (value.full_tokens === undefined || finiteNumber(value.full_tokens) !== null) &&
    (value.remainder_tokens === undefined || finiteNumber(value.remainder_tokens) !== null) &&
    (value.matched_queries === undefined ||
      (Array.isArray(value.matched_queries) &&
        value.matched_queries.every((query) => finiteNumber(query) !== null))) &&
    (value.text === undefined || typeof value.text === "string")
  );
}

function isNextSectionHint(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const suggestedBudget = value.suggested_budget;
  return isSection(value) && finiteNumber(value.relevance) !== null && finiteNumber(suggestedBudget) !== null;
}

function isCompileHints(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    typeof value.multi_part_nudge === "boolean" &&
    typeof value.omit_action === "boolean" &&
    (value.named_omit === null || isSection(value.named_omit)) &&
    (value.early_stopped === undefined || typeof value.early_stopped === "boolean")
  );
}

function isCompileResult(value: unknown): value is CompileApiResult {
  if (!isRecord(value)) return false;
  const numericFields = [
    "raw_tokens",
    "tokens_used",
    "selected_content_tokens",
    "tokens_saved",
    "reduction_pct",
    "token_budget",
    "cost_raw_usd",
    "cost_compiled_usd",
    "price_per_mtok",
  ];
  const sectionArrays = [
    "selected_sections",
    "omitted_sections",
    "budget_omitted_sections",
    "relevance_omitted_sections",
  ];
  return (
    typeof value.markdown === "string" &&
    numericFields.every((field) => finiteNumber(value[field]) !== null) &&
    typeof value.cache_hit === "boolean" &&
    Array.isArray(value.queries) &&
    value.queries.every((query) => typeof query === "string") &&
    sectionArrays.every(
      (field) => Array.isArray(value[field]) && value[field].every((section) => isSection(section))
    ) &&
    (value.next_section_hint === null || isNextSectionHint(value.next_section_hint)) &&
    (value.compile_hints === undefined || isCompileHints(value.compile_hints)) &&
    typeof value.handle === "string" &&
    typeof value.llm_available === "boolean" &&
    (value.error === undefined || typeof value.error === "string")
  );
}

function normalizeCompiledSnapshot(value: unknown): WorkspaceCompiledSnapshot<CompileApiResult> | null {
  if (!isRecord(value) || !isCompileResult(value.result)) return null;
  const budget = finiteNumber(value.budget);
  if (typeof value.taskLabel !== "string" || budget === null || budget <= 0) return null;
  return Object.freeze({
    result: value.result,
    documentName: nullableString(value.documentName),
    taskLabel: value.taskLabel,
    budget,
    // Availability is derived again at hydration; never trust persisted actionability.
    sourceAvailability: "missing" as const,
  });
}

function normalizeIncludeMetadata(
  idsValue: unknown,
  tokensValue: unknown,
  compiledSnapshot: WorkspaceCompiledSnapshot<CompileApiResult> | null
): Pick<PersistedWorkspace, "proveExpandedIds" | "proveExpandedTokens"> {
  if (!compiledSnapshot) return { proveExpandedIds: [], proveExpandedTokens: [] };

  const allowedTokens = new Map<string, number>();
  for (const section of [
    ...compiledSnapshot.result.omitted_sections,
    ...compiledSnapshot.result.budget_omitted_sections,
    ...compiledSnapshot.result.relevance_omitted_sections,
  ]) {
    allowedTokens.set(section.id, Math.max(0, section.tokens));
  }
  const ids = Array.isArray(idsValue)
    ? [...new Set(idsValue.filter((id): id is string => typeof id === "string" && allowedTokens.has(id)))]
    : [];
  const storedTokenIds = new Set(
    Array.isArray(tokensValue)
      ? tokensValue
          .filter(
            (entry): entry is [string, number] =>
              Array.isArray(entry) &&
              entry.length === 2 &&
              typeof entry[0] === "string" &&
              finiteNumber(entry[1]) !== null
          )
          .map(([id]) => id)
      : []
  );
  return {
    proveExpandedIds: ids,
    proveExpandedTokens: ids.filter((id) => storedTokenIds.has(id)).map((id) => [id, allowedTokens.get(id)!]),
  };
}

function normalizeV2(value: unknown): PersistedWorkspace | null {
  if (!isRecord(value) || value.version !== 2 || !isRecord(value.live)) return null;
  const compiledSnapshot = normalizeCompiledSnapshot(value.compiledSnapshot);
  const include = isRecord(value.includeMetadata)
    ? normalizeIncludeMetadata(
        value.includeMetadata.expandedIds,
        value.includeMetadata.expandedTokens,
        compiledSnapshot
      )
    : { proveExpandedIds: [], proveExpandedTokens: [] };
  const totals = isRecord(value.sessionTotals) ? value.sessionTotals : {};
  return {
    task: stringOr(value.live.task),
    budget: positiveNumber(value.live.budget, 4000),
    filePicked: stringOr(value.live.filePicked),
    sampleKey: nullableString(value.live.sampleKey),
    compiledSnapshot,
    ...include,
    sessionSavedTokens: nonNegativeNumber(totals.savedTokens),
    sessionSavedUsd: nonNegativeNumber(totals.savedUsd),
  };
}

function normalizeV1(value: unknown): PersistedWorkspace | null {
  if (!isRecord(value)) return null;
  const compile = isCompileResult(value.compile) ? value.compile : null;
  const compiledTask = typeof value.compiledTask === "string" ? value.compiledTask : null;
  const compiledBudget = finiteNumber(value.compiledBudget);
  const compiledSnapshot =
    compile && compiledTask !== null && compiledBudget !== null && compiledBudget > 0
      ? Object.freeze({
          result: compile,
          documentName: nullableString(value.filePicked),
          taskLabel: compiledTask,
          budget: compiledBudget,
          sourceAvailability: "missing" as const,
        })
      : null;
  return {
    task: stringOr(value.task),
    budget: positiveNumber(value.budget, 4000),
    filePicked: stringOr(value.filePicked),
    sampleKey: nullableString(value.sampleKey),
    compiledSnapshot,
    ...normalizeIncludeMetadata(value.proveExpandedIds, value.proveExpandedTokens, compiledSnapshot),
    sessionSavedTokens: nonNegativeNumber(value.sessionSavedTokens),
    sessionSavedUsd: nonNegativeNumber(value.sessionSavedUsd),
  };
}

function parse(raw: string | null, normalize: (value: unknown) => PersistedWorkspace | null) {
  if (!raw) return null;
  try {
    return normalize(JSON.parse(raw));
  } catch {
    return null;
  }
}

function toV2Record(data: PersistedWorkspace): WorkspaceV2Record {
  return {
    version: 2,
    live: {
      task: data.task,
      budget: data.budget,
      filePicked: data.filePicked,
      sampleKey: data.sampleKey,
    },
    compiledSnapshot: data.compiledSnapshot,
    includeMetadata: {
      expandedIds: data.proveExpandedIds,
      expandedTokens: data.proveExpandedTokens,
    },
    sessionTotals: {
      savedTokens: data.sessionSavedTokens,
      savedUsd: data.sessionSavedUsd,
    },
  };
}

export function loadPersistedWorkspace(): PersistedWorkspace | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const current = parse(sessionStorage.getItem(WORKSPACE_STORAGE_KEY), normalizeV2);
    if (current) return current;

    const previous =
      parse(sessionStorage.getItem(PREVIOUS_WORKSPACE_STORAGE_KEY), normalizeV1) ??
      parse(sessionStorage.getItem(LEGACY_WORKSPACE_STORAGE_KEY), normalizeV1);
    if (previous) sessionStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(toV2Record(previous)));
    return previous;
  } catch {
    return null;
  }
}

export function savePersistedWorkspace(data: PersistedWorkspace): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(toV2Record(data)));
  } catch {
    /* quota / private mode */
  }
}

export function clearPersistedWorkspace(): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.removeItem(WORKSPACE_STORAGE_KEY);
    sessionStorage.removeItem(PREVIOUS_WORKSPACE_STORAGE_KEY);
    sessionStorage.removeItem(LEGACY_WORKSPACE_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
