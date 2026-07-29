"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  createInitialWorkspaceState,
  workspaceReducer,
  type WorkspaceCompiledSnapshot,
  type WorkspaceReducerEvent,
  type WorkspaceReducerState,
} from "../../../src/http/workspace-reducer";
import { loadPersistedWorkspace, savePersistedWorkspace } from "./workspace-persist";
import type { CompileApiResult, Sample, ServerConfig } from "./types";
import {
  computePresets,
  DEFAULT_PRESETS,
  deriveWorkspaceStatus,
  type BudgetPresets,
  type WorkspaceStatus,
} from "./ux";

type WorkspaceState = {
  config: ServerConfig | null;
  samples: Sample[];
  loadError: string;
  file: File | null;
  filePicked: string;
  sampleKey: string | null;
  task: string;
  budget: number;
  presets: BudgetPresets;
  docSizeNote: string;
  rawTokensHint: number | null;
  compile: CompileApiResult | null;
  compiledTask: string | null;
  compiledBudget: number | null;
  compiledSnapshot: WorkspaceCompiledSnapshot<CompileApiResult> | null;
  proveExpandedIds: string[];
  proveExpandedTokenSum: number;
  sessionSavedTokens: number;
  sessionSavedUsd: number;
  agentParityHandle: string | null;
  pendingRun: "prove" | "agent" | null;
  hydrated: boolean;
  setFile: (f: File | null) => void;
  setSampleKey: (k: string | null) => void;
  setTask: (t: string) => void;
  setBudget: (n: number) => void;
  setPresets: (p: BudgetPresets, selectTier?: keyof BudgetPresets | null) => void;
  setDocSizeNote: (s: string) => void;
  setRawTokensHint: (n: number | null) => void;
  setCompile: (r: CompileApiResult | null, task: string, budget: number) => void;
  clearCompile: () => void;
  setProveInclude: (id: string, tokens: number, included: boolean) => void;
  clearProveIncludes: () => void;
  setAgentParityHandle: (h: string | null) => void;
  requestRun: (action: "prove" | "agent") => void;
  consumeRun: (action: "prove" | "agent") => boolean;
  workspaceStatus: WorkspaceStatus;
};

const Ctx = createContext<WorkspaceState | null>(null);

type ReducerState = WorkspaceReducerState<CompileApiResult, File>;
type ReducerEvent = WorkspaceReducerEvent<CompileApiResult, File>;

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const restored = useRef(false);
  const [config, setConfig] = useState<ServerConfig | null>(null);
  const [samples, setSamples] = useState<Sample[]>([]);
  const [loadError, setLoadError] = useState("");
  const [workspace, dispatch] = useReducer(
    (state: ReducerState, event: ReducerEvent) => workspaceReducer(state, event),
    createInitialWorkspaceState<CompileApiResult, File>(DEFAULT_PRESETS)
  );
  const {
    file,
    filePicked,
    sampleKey,
    task,
    budget,
    presets,
    docSizeNote,
    rawTokensHint,
    compiledSnapshot,
    proveInclude,
    sessionSavedTokens,
    sessionSavedUsd,
    agentParityHandle,
    pendingRun,
    hydrated,
  } = workspace;
  const compile = compiledSnapshot?.result ?? null;
  const compiledTask = compiledSnapshot?.taskLabel ?? null;
  const compiledBudget = compiledSnapshot?.budget ?? null;

  useEffect(() => {
    const saved = loadPersistedWorkspace();
    // Browser storage cannot restore a custom File. Only restore actionable
    // compile state when a sample key lets us fetch the bytes again.
    const restorableCompile = saved?.sampleKey ? saved.compiledSnapshot : null;
    const restoredSnapshot =
      saved && restorableCompile
        ? Object.freeze({
            ...restorableCompile,
            sourceAvailability: "restorable" as const,
          })
        : null;
    dispatch({
      type: "WORKSPACE_HYDRATED",
      task: saved?.task ?? "",
      budget: saved?.budget ?? 4000,
      filePicked: saved?.filePicked ?? "",
      sampleKey: saved?.sampleKey ?? null,
      compiledSnapshot: restoredSnapshot,
      proveExpandedIds: saved?.proveExpandedIds ?? [],
      proveExpandedTokens: saved?.proveExpandedTokens ?? [],
      sessionSavedTokens: saved?.sessionSavedTokens ?? 0,
      sessionSavedUsd: saved?.sessionSavedUsd ?? 0,
      docSizeNote: restorableCompile
        ? `Restored compile (~${restorableCompile.result.raw_tokens.toLocaleString()} tokens).`
        : "",
      rawTokensHint: restorableCompile?.result.raw_tokens ?? null,
    });
    restored.current = true;
  }, []);

  useEffect(() => {
    void (async () => {
      const fetchJson = async <T,>(url: string): Promise<T> => {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`${url} failed (${response.status})`);
        return response.json() as Promise<T>;
      };
      const [configResult, samplesResult] = await Promise.allSettled([
        fetchJson<ServerConfig>("/api/config"),
        fetchJson<Sample[]>("/api/samples"),
      ]);
      if (configResult.status === "fulfilled") setConfig(configResult.value);
      if (samplesResult.status === "fulfilled") {
        setSamples(Array.isArray(samplesResult.value) ? samplesResult.value : []);
      }
      const failures = [
        configResult.status === "rejected" ? "host limits" : "",
        samplesResult.status === "rejected" ? "sample library" : "",
      ].filter(Boolean);
      if (failures.length) {
        setLoadError(
          `Could not load ${failures.join(" and ")}. ${
            configResult.status === "rejected"
              ? "Defaults are shown; server validation still applies."
              : "Uploading your own file still works."
          }`
        );
      }
    })();
  }, []);

  // Re-fetch sample File after restore so Prove/Agent can upload again.
  useEffect(() => {
    if (!hydrated || !sampleKey || file || !samples.length) return;
    const s = samples.find((x) => x.key === sampleKey);
    if (!s) return;
    void (async () => {
      try {
        const res = await fetch(`/samples/${s.file}`);
        if (!res.ok) return;
        const buf = await res.arrayBuffer();
        dispatch({
          type: "DOCUMENT_RESTORED",
          file: new File([buf], s.file, {
            type: res.headers.get("content-type") || "application/octet-stream",
          }),
          filePicked: `Sample: ${s.nm}`,
          presets: s.tok != null ? computePresets(s.tok) : undefined,
        });
      } catch (e) {
        console.warn("could not restore sample file", e);
      }
    })();
  }, [hydrated, sampleKey, samples, file]);

  useEffect(() => {
    if (!hydrated) return;
    savePersistedWorkspace({
      task,
      budget,
      filePicked,
      sampleKey,
      compiledSnapshot,
      proveExpandedIds: [...proveInclude.expandedIds],
      proveExpandedTokens: [...proveInclude.expandedTokens.entries()],
      sessionSavedTokens,
      sessionSavedUsd,
    });
  }, [
    hydrated,
    task,
    budget,
    filePicked,
    sampleKey,
    compiledSnapshot,
    proveInclude,
    sessionSavedTokens,
    sessionSavedUsd,
  ]);

  const clearProveIncludes = useCallback(() => dispatch({ type: "PROVE_INCLUDE_CLEARED" }), []);

  const clearCompile = useCallback(() => dispatch({ type: "COMPILE_CLEARED" }), []);

  const setFile = useCallback((f: File | null) => {
    dispatch({ type: "DOCUMENT_SELECTED", file: f, filePicked: f?.name ?? "" });
  }, []);

  const setSampleKey = useCallback((k: string | null) => {
    dispatch({ type: "DOCUMENT_SELECTED", sampleKey: k });
  }, []);

  const setTask = useCallback((t: string) => dispatch({ type: "TASK_CHANGED", task: t }), []);
  const setBudget = useCallback((n: number) => dispatch({ type: "BUDGET_CHANGED", budget: n }), []);
  const setDocSizeNote = useCallback((s: string) => dispatch({ type: "DOC_SIZE_NOTE_CHANGED", note: s }), []);
  const setRawTokensHint = useCallback(
    (n: number | null) => dispatch({ type: "RAW_TOKENS_HINT_CHANGED", rawTokensHint: n }),
    []
  );

  const setCompile = useCallback(
    (r: CompileApiResult | null, t: string, b: number) => {
      if (!r) {
        dispatch({ type: "COMPILE_CLEARED" });
        return;
      }
      const sampleName = sampleKey ? samples.find((sample) => sample.key === sampleKey)?.nm : null;
      dispatch({
        type: "COMPILE_SUCCEEDED",
        result: r,
        task: t,
        budget: b,
        documentName: sampleName ?? file?.name ?? (filePicked.trim() || null),
      });
    },
    [file, filePicked, sampleKey, samples]
  );

  const setPresets = useCallback((p: BudgetPresets, selectTier: keyof BudgetPresets | null = null) => {
    dispatch({ type: "PRESETS_CHANGED", presets: p, selectTier });
  }, []);

  const setProveInclude = useCallback((id: string, tokens: number, included: boolean) => {
    dispatch({ type: "PROVE_INCLUDE_CHANGED", id, tokens, included });
  }, []);

  const setAgentParityHandle = useCallback((h: string | null) => {
    dispatch(
      h
        ? { type: "RUN_COMPLETED", action: "agent", parityHandle: h }
        : { type: "RUN_STARTED", action: "agent" }
    );
  }, []);
  const requestRun = useCallback(
    (action: "prove" | "agent") => dispatch({ type: "RUN_REQUESTED", action }),
    []
  );
  const consumeRun = useCallback(
    (action: "prove" | "agent") => {
      if (pendingRun !== action) return false;
      dispatch({ type: "RUN_CONSUMED", action });
      return true;
    },
    [pendingRun]
  );

  const workspaceStatus = deriveWorkspaceStatus({
    hasCompiledOnce: Boolean(compile),
    lastCompiledTask: compiledTask,
    currentTask: task,
    lastCompiledBudget: compiledBudget,
    currentBudget: budget,
    sourceAvailable: Boolean(file),
    taskValid: Boolean(task.trim()),
    sourceValid: Boolean(file),
    busy: false,
  });

  const proveExpandedIds = useMemo(() => [...proveInclude.expandedIds], [proveInclude]);
  const proveExpandedTokenSum = useMemo(() => {
    let n = 0;
    for (const t of proveInclude.expandedTokens.values()) n += t;
    return n;
  }, [proveInclude]);

  const value = useMemo(
    () => ({
      config,
      samples,
      loadError,
      file,
      filePicked,
      sampleKey,
      task,
      budget,
      presets,
      docSizeNote,
      rawTokensHint,
      compile,
      compiledTask,
      compiledBudget,
      compiledSnapshot,
      proveExpandedIds,
      proveExpandedTokenSum,
      sessionSavedTokens,
      sessionSavedUsd,
      agentParityHandle,
      pendingRun,
      hydrated,
      setFile,
      setSampleKey,
      setTask,
      setBudget,
      setPresets,
      setDocSizeNote,
      setRawTokensHint,
      setCompile,
      clearCompile,
      setProveInclude,
      clearProveIncludes,
      setAgentParityHandle,
      requestRun,
      consumeRun,
      workspaceStatus,
    }),
    [
      config,
      samples,
      loadError,
      file,
      filePicked,
      sampleKey,
      task,
      budget,
      presets,
      docSizeNote,
      rawTokensHint,
      compile,
      compiledTask,
      compiledBudget,
      compiledSnapshot,
      proveExpandedIds,
      proveExpandedTokenSum,
      sessionSavedTokens,
      sessionSavedUsd,
      agentParityHandle,
      pendingRun,
      hydrated,
      setFile,
      setSampleKey,
      setCompile,
      clearCompile,
      setProveInclude,
      clearProveIncludes,
      setPresets,
      consumeRun,
      workspaceStatus,
    ]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWorkspace() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useWorkspace outside WorkspaceProvider");
  return v;
}

export { computePresets, DEFAULT_PRESETS };
