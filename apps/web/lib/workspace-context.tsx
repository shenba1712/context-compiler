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
import { useRouter } from "next/navigation";

import {
  createInitialWorkspaceState,
  workspaceReducer,
  type WorkspaceCompiledSnapshot,
  type WorkspaceReducerEvent,
  type WorkspaceReducerState,
  type WorkspaceRun,
  type WorkspaceRunIntent,
  type WorkspaceRunOrigin,
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
  runIntent: WorkspaceRunIntent<File> | null;
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
  launchRun: (kind: WorkspaceRun, origin: WorkspaceRunOrigin) => string | null;
  claimRunIntent: (
    id: string,
    kind: WorkspaceRun
  ) => { intent: WorkspaceRunIntent<File>; error: null } | { intent: null; error: string };
  workspaceStatus: WorkspaceStatus;
};

const Ctx = createContext<WorkspaceState | null>(null);

type ReducerState = WorkspaceReducerState<CompileApiResult, File>;
type ReducerEvent = WorkspaceReducerEvent<CompileApiResult, File>;

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const restored = useRef(false);
  const claimedIntentIds = useRef(new Set<string>());
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
    runIntent,
    hydrated,
  } = workspace;
  const workspaceRef = useRef(workspace);
  const configRef = useRef(config);
  workspaceRef.current = workspace;
  configRef.current = config;
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

  const launchRun = useCallback(
    (kind: WorkspaceRun, origin: WorkspaceRunOrigin): string | null => {
      const current = workspaceRef.current;
      const currentCompile = current.compiledSnapshot?.result ?? null;
      const status = deriveWorkspaceStatus({
        hasCompiledOnce: Boolean(currentCompile),
        lastCompiledTask: current.compiledSnapshot?.taskLabel ?? null,
        currentTask: current.task,
        lastCompiledBudget: current.compiledSnapshot?.budget ?? null,
        currentBudget: current.budget,
        sourceAvailable: Boolean(current.file),
        taskValid: Boolean(current.task.trim()),
        sourceValid: Boolean(current.file),
        busy: false,
      });
      if (!current.file) return "Choose a document first.";
      if (!current.task.trim()) return "Enter a question first.";
      if (kind === "prove" && status.proveStale) {
        return "Task or budget changed — recompile first.";
      }
      if (kind === "agent" && status.agentStale) return "Task changed — recompile first.";
      if (!configRef.current?.llm_available) {
        return `This host has no LLM API key. ${kind === "prove" ? "Prove" : "Agent"} is disabled.`;
      }

      const sourceFile = current.file;
      const expandedIds = kind === "prove" && currentCompile ? [...current.proveInclude.expandedIds] : [];
      let expandedTokenSum = 0;
      for (const id of expandedIds) expandedTokenSum += current.proveInclude.expandedTokens.get(id) ?? 0;
      const intent: WorkspaceRunIntent<File> = Object.freeze({
        id:
          typeof crypto !== "undefined" && "randomUUID" in crypto
            ? crypto.randomUUID()
            : `run-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        kind,
        origin,
        capturedRevision: current.runRevision,
        capture: Object.freeze({
          sourceFile,
          source: Object.freeze({
            documentName: current.compiledSnapshot?.documentName ?? sourceFile.name,
            sampleKey: current.sampleKey,
            size: sourceFile.size,
            type: sourceFile.type,
            lastModified: sourceFile.lastModified,
          }),
          task: current.task.trim(),
          budget: current.budget,
          compileHandle: currentCompile?.handle ?? null,
          expandedIds: Object.freeze(expandedIds),
          expandedTokenSum,
        }),
      });
      dispatch({ type: "RUN_INTENT_CREATED", intent });
      router.push(`/workspace/${kind}`);
      return null;
    },
    [router]
  );

  const claimRunIntent = useCallback(
    (
      id: string,
      kind: WorkspaceRun
    ): { intent: WorkspaceRunIntent<File>; error: null } | { intent: null; error: string } => {
      const current = workspaceRef.current;
      const intent = current.runIntent;
      if (!intent || intent.id !== id || intent.kind !== kind || claimedIntentIds.current.has(id)) {
        return { intent: null, error: "" };
      }
      claimedIntentIds.current.add(id);
      dispatch({ type: "RUN_INTENT_CLAIMED", id, kind });

      if (intent.capturedRevision !== current.runRevision) {
        return {
          intent: null,
          error: "The workspace changed before this run could start. Review it and try again.",
        };
      }
      const status = deriveWorkspaceStatus({
        hasCompiledOnce: Boolean(current.compiledSnapshot),
        lastCompiledTask: current.compiledSnapshot?.taskLabel ?? null,
        currentTask: current.task,
        lastCompiledBudget: current.compiledSnapshot?.budget ?? null,
        currentBudget: current.budget,
        sourceAvailable: Boolean(current.file),
        taskValid: Boolean(current.task.trim()),
        sourceValid: Boolean(current.file),
        busy: false,
      });
      if (!current.file || !current.task.trim()) {
        return { intent: null, error: "Run prerequisites are no longer available. Review the live task." };
      }
      if ((kind === "prove" && status.proveStale) || (kind === "agent" && status.agentStale)) {
        return { intent: null, error: "The compiled result became stale before this run could start." };
      }
      if (!configRef.current?.llm_available) {
        return { intent: null, error: `This host has no LLM API key. ${kind} is disabled.` };
      }
      return { intent, error: null };
    },
    []
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
      runIntent,
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
      launchRun,
      claimRunIntent,
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
      runIntent,
      hydrated,
      setFile,
      setSampleKey,
      setCompile,
      clearCompile,
      setProveInclude,
      clearProveIncludes,
      setPresets,
      launchRun,
      claimRunIntent,
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
export type { WorkspaceRunCapture } from "../../../src/http/workspace-reducer";
