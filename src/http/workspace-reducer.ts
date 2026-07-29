export type WorkspaceRun = "prove" | "agent";

export type WorkspacePresets = {
  quick: number;
  standard: number;
  deep: number;
};

export type WorkspaceCompileArtifact = {
  tokens_saved: number;
  cost_raw_usd: number;
  cost_compiled_usd: number;
};

export type WorkspaceSourceAvailability = "available" | "restorable" | "missing" | "not-selected";

export type WorkspaceCompiledSnapshot<TCompile extends WorkspaceCompileArtifact> = Readonly<{
  result: TCompile;
  documentName: string | null;
  taskLabel: string;
  budget: number;
  sourceAvailability: WorkspaceSourceAvailability;
}>;

export type ProveIncludeState = {
  expandedIds: Set<string>;
  expandedTokens: Map<string, number>;
};

export type WorkspaceReducerState<TCompile extends WorkspaceCompileArtifact, TFile> = {
  file: TFile | null;
  filePicked: string;
  sampleKey: string | null;
  task: string;
  budget: number;
  presets: WorkspacePresets;
  docSizeNote: string;
  rawTokensHint: number | null;
  compiledSnapshot: WorkspaceCompiledSnapshot<TCompile> | null;
  proveInclude: ProveIncludeState;
  sessionSavedTokens: number;
  sessionSavedUsd: number;
  agentParityHandle: string | null;
  pendingRun: WorkspaceRun | null;
  hydrated: boolean;
};

export type WorkspaceReducerEvent<TCompile extends WorkspaceCompileArtifact, TFile> =
  | {
      type: "WORKSPACE_HYDRATED";
      task: string;
      budget: number;
      filePicked: string;
      sampleKey: string | null;
      compiledSnapshot: WorkspaceCompiledSnapshot<TCompile> | null;
      proveExpandedIds: string[];
      proveExpandedTokens: [string, number][];
      sessionSavedTokens: number;
      sessionSavedUsd: number;
      docSizeNote: string;
      rawTokensHint: number | null;
    }
  | {
      type: "DOCUMENT_SELECTED";
      file?: TFile | null;
      filePicked?: string;
      sampleKey?: string | null;
    }
  | {
      type: "DOCUMENT_RESTORED";
      file: TFile;
      filePicked: string;
      presets?: WorkspacePresets;
    }
  | { type: "TASK_CHANGED"; task: string }
  | { type: "BUDGET_CHANGED"; budget: number }
  | { type: "PRESETS_CHANGED"; presets: WorkspacePresets; selectTier: keyof WorkspacePresets | null }
  | { type: "DOC_SIZE_NOTE_CHANGED"; note: string }
  | { type: "RAW_TOKENS_HINT_CHANGED"; rawTokensHint: number | null }
  | {
      type: "COMPILE_SUCCEEDED";
      result: TCompile;
      task: string;
      budget: number;
      documentName: string | null;
    }
  | { type: "COMPILE_CLEARED" | "COMPILE_FAILED" | "COMPILE_CANCELLED" }
  | { type: "PROVE_INCLUDE_CHANGED"; id: string; tokens: number; included: boolean }
  | { type: "PROVE_INCLUDE_CLEARED" }
  | { type: "RUN_REQUESTED" | "RUN_CONSUMED"; action: WorkspaceRun }
  | { type: "RUN_STARTED"; action: WorkspaceRun }
  | { type: "RUN_COMPLETED"; action: WorkspaceRun; parityHandle?: string | null }
  | { type: "RUN_FAILED" | "RUN_CANCELLED"; action: WorkspaceRun };

const EMPTY_PROVE_INCLUDE = (): ProveIncludeState => ({
  expandedIds: new Set(),
  expandedTokens: new Map(),
});

export function createInitialWorkspaceState<TCompile extends WorkspaceCompileArtifact, TFile>(
  presets: WorkspacePresets
): WorkspaceReducerState<TCompile, TFile> {
  return {
    file: null,
    filePicked: "",
    sampleKey: null,
    task: "",
    budget: 4000,
    presets,
    docSizeNote: "",
    rawTokensHint: null,
    compiledSnapshot: null,
    proveInclude: EMPTY_PROVE_INCLUDE(),
    sessionSavedTokens: 0,
    sessionSavedUsd: 0,
    agentParityHandle: null,
    pendingRun: null,
    hydrated: false,
  };
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function immutableCopy<T>(value: T): T {
  return deepFreeze(structuredClone(value));
}

function clearCompile<TCompile extends WorkspaceCompileArtifact, TFile>(
  state: WorkspaceReducerState<TCompile, TFile>
): WorkspaceReducerState<TCompile, TFile> {
  return {
    ...state,
    compiledSnapshot: null,
    proveInclude: EMPTY_PROVE_INCLUDE(),
    agentParityHandle: null,
  };
}

export function workspaceReducer<TCompile extends WorkspaceCompileArtifact, TFile>(
  state: WorkspaceReducerState<TCompile, TFile>,
  event: WorkspaceReducerEvent<TCompile, TFile>
): WorkspaceReducerState<TCompile, TFile> {
  switch (event.type) {
    case "WORKSPACE_HYDRATED":
      return {
        ...state,
        task: event.task,
        budget: event.budget,
        filePicked: event.filePicked,
        sampleKey: event.sampleKey,
        compiledSnapshot: event.compiledSnapshot,
        proveInclude: event.compiledSnapshot
          ? {
              expandedIds: new Set(event.proveExpandedIds),
              expandedTokens: new Map(event.proveExpandedTokens),
            }
          : EMPTY_PROVE_INCLUDE(),
        sessionSavedTokens: event.sessionSavedTokens,
        sessionSavedUsd: event.sessionSavedUsd,
        docSizeNote: event.docSizeNote,
        rawTokensHint: event.rawTokensHint,
        hydrated: true,
      };
    case "DOCUMENT_SELECTED":
      return clearCompile({
        ...state,
        file: event.file === undefined ? state.file : event.file,
        filePicked: event.filePicked === undefined ? state.filePicked : event.filePicked,
        sampleKey: event.sampleKey === undefined ? state.sampleKey : event.sampleKey,
      });
    case "DOCUMENT_RESTORED":
      return {
        ...state,
        file: event.file,
        filePicked: event.filePicked,
        presets: event.presets ?? state.presets,
      };
    case "TASK_CHANGED":
      return { ...state, task: event.task };
    case "BUDGET_CHANGED":
      return { ...state, budget: event.budget };
    case "PRESETS_CHANGED":
      return {
        ...state,
        presets: event.presets,
        budget: event.selectTier ? event.presets[event.selectTier] : state.budget,
      };
    case "DOC_SIZE_NOTE_CHANGED":
      return { ...state, docSizeNote: event.note };
    case "RAW_TOKENS_HINT_CHANGED":
      return { ...state, rawTokensHint: event.rawTokensHint };
    case "COMPILE_SUCCEEDED": {
      const result = immutableCopy(event.result);
      return {
        ...state,
        compiledSnapshot: Object.freeze({
          result,
          documentName: event.documentName,
          taskLabel: event.task,
          budget: event.budget,
          sourceAvailability: state.file ? "available" : state.sampleKey ? "restorable" : "missing",
        }),
        proveInclude: EMPTY_PROVE_INCLUDE(),
        sessionSavedTokens: state.sessionSavedTokens + Math.max(0, result.tokens_saved),
        sessionSavedUsd: state.sessionSavedUsd + Math.max(0, result.cost_raw_usd - result.cost_compiled_usd),
        agentParityHandle: null,
      };
    }
    case "COMPILE_CLEARED":
      return clearCompile(state);
    case "COMPILE_FAILED":
    case "COMPILE_CANCELLED":
      return state;
    case "PROVE_INCLUDE_CHANGED": {
      const expandedIds = new Set(state.proveInclude.expandedIds);
      const expandedTokens = new Map(state.proveInclude.expandedTokens);
      if (event.included) {
        expandedIds.add(event.id);
        expandedTokens.set(event.id, event.tokens);
      } else {
        expandedIds.delete(event.id);
        expandedTokens.delete(event.id);
      }
      return { ...state, proveInclude: { expandedIds, expandedTokens } };
    }
    case "PROVE_INCLUDE_CLEARED":
      return { ...state, proveInclude: EMPTY_PROVE_INCLUDE() };
    case "RUN_REQUESTED":
      return { ...state, pendingRun: event.action };
    case "RUN_CONSUMED":
      return state.pendingRun === event.action ? { ...state, pendingRun: null } : state;
    case "RUN_STARTED":
      return event.action === "agent" ? { ...state, agentParityHandle: null } : state;
    case "RUN_COMPLETED":
      return event.action === "agent" ? { ...state, agentParityHandle: event.parityHandle ?? null } : state;
    case "RUN_FAILED":
    case "RUN_CANCELLED":
      return state;
  }
}
