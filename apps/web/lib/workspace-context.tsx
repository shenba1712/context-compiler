"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { loadPersistedWorkspace, savePersistedWorkspace } from "./workspace-persist";
import type { CompileApiResult, Sample, ServerConfig } from "./types";
import { applyProveIncludeChange, computePresets, DEFAULT_PRESETS, type BudgetPresets } from "./ux";

type WorkspaceState = {
  config: ServerConfig | null;
  samples: Sample[];
  loadError: string;
  file: File | null;
  sampleKey: string | null;
  task: string;
  budget: number;
  presets: BudgetPresets;
  docSizeNote: string;
  rawTokensHint: number | null;
  compile: CompileApiResult | null;
  compiledTask: string | null;
  compiledBudget: number | null;
  proveExpandedIds: string[];
  proveExpandedTokenSum: number;
  agentParityHandle: string | null;
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
  questionStale: boolean;
  budgetStale: boolean;
  proveStale: boolean;
};

const Ctx = createContext<WorkspaceState | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const restored = useRef(false);
  const [hydrated, setHydrated] = useState(false);
  const [config, setConfig] = useState<ServerConfig | null>(null);
  const [samples, setSamples] = useState<Sample[]>([]);
  const [loadError, setLoadError] = useState("");
  const [file, setFileState] = useState<File | null>(null);
  const [sampleKey, setSampleKeyState] = useState<string | null>(null);
  const [task, setTask] = useState("");
  const [budget, setBudget] = useState(4000);
  const [presets, setPresetsState] = useState<BudgetPresets>(DEFAULT_PRESETS);
  const [docSizeNote, setDocSizeNote] = useState("");
  const [rawTokensHint, setRawTokensHint] = useState<number | null>(null);
  const [compile, setCompileState] = useState<CompileApiResult | null>(null);
  const [compiledTask, setCompiledTask] = useState<string | null>(null);
  const [compiledBudget, setCompiledBudget] = useState<number | null>(null);
  const [proveInclude, setProveIncludeState] = useState<{
    expandedIds: Set<string>;
    expandedTokens: Map<string, number>;
  }>(() => ({ expandedIds: new Set(), expandedTokens: new Map() }));
  const [agentParityHandle, setAgentParityHandle] = useState<string | null>(null);

  useEffect(() => {
    const saved = loadPersistedWorkspace();
    if (saved) {
      setTask(saved.task);
      setBudget(saved.budget);
      setSampleKeyState(saved.sampleKey);
      // Browser storage cannot restore a custom File. Only restore actionable
      // compile state when a sample key lets us fetch the bytes again.
      const restorableCompile = saved.sampleKey ? saved.compile : null;
      setCompileState(restorableCompile);
      setCompiledTask(restorableCompile ? saved.compiledTask : null);
      setCompiledBudget(restorableCompile ? saved.compiledBudget : null);
      setProveIncludeState(
        restorableCompile
          ? {
              expandedIds: new Set(saved.proveExpandedIds),
              expandedTokens: new Map(saved.proveExpandedTokens),
            }
          : { expandedIds: new Set(), expandedTokens: new Map() }
      );
      if (restorableCompile) {
        setRawTokensHint(restorableCompile.raw_tokens);
        setDocSizeNote(`Restored compile (~${restorableCompile.raw_tokens.toLocaleString()} tokens).`);
      }
    }
    restored.current = true;
    setHydrated(true);
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const fetchJson = async <T,>(url: string): Promise<T> => {
          const response = await fetch(url);
          if (!response.ok) throw new Error(`${url} failed (${response.status})`);
          return response.json() as Promise<T>;
        };
        const [c, s] = await Promise.all([
          fetchJson<ServerConfig>("/api/config"),
          fetchJson<Sample[]>("/api/samples"),
        ]);
        setConfig(c);
        setSamples(Array.isArray(s) ? s : []);
      } catch (e) {
        setLoadError(e instanceof Error ? e.message : "Could not load host configuration and samples.");
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
        setFileState(
          new File([buf], s.file, { type: res.headers.get("content-type") || "application/octet-stream" })
        );
        if (s.tok != null) {
          setPresetsState(computePresets(s.tok));
        }
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
      sampleKey,
      compile,
      compiledTask,
      compiledBudget,
      proveExpandedIds: [...proveInclude.expandedIds],
      proveExpandedTokens: [...proveInclude.expandedTokens.entries()],
    });
  }, [hydrated, task, budget, sampleKey, compile, compiledTask, compiledBudget, proveInclude]);

  const clearProveIncludes = useCallback(() => {
    setProveIncludeState({ expandedIds: new Set(), expandedTokens: new Map() });
  }, []);

  const clearCompile = useCallback(() => {
    setCompileState(null);
    setCompiledTask(null);
    setCompiledBudget(null);
    clearProveIncludes();
    setAgentParityHandle(null);
  }, [clearProveIncludes]);

  const setFile = useCallback((f: File | null) => {
    setFileState(f);
  }, []);

  const setSampleKey = useCallback((k: string | null) => {
    setSampleKeyState(k);
  }, []);

  const setCompile = useCallback(
    (r: CompileApiResult | null, t: string, b: number) => {
      setCompileState(r);
      setCompiledTask(r ? t : null);
      setCompiledBudget(r ? b : null);
      clearProveIncludes();
      setAgentParityHandle(null);
    },
    [clearProveIncludes]
  );

  const setPresets = useCallback((p: BudgetPresets, selectTier: keyof BudgetPresets | null = null) => {
    setPresetsState(p);
    if (selectTier) setBudget(p[selectTier]);
  }, []);

  const setProveInclude = useCallback((id: string, tokens: number, included: boolean) => {
    setProveIncludeState((prev) => applyProveIncludeChange(prev, id, tokens, included));
  }, []);

  const questionStale = Boolean(compile && compiledTask !== null && task.trim() !== compiledTask.trim());
  const budgetStale = Boolean(compile && compiledBudget !== null && budget !== compiledBudget);
  const proveStale = questionStale || budgetStale;

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
      sampleKey,
      task,
      budget,
      presets,
      docSizeNote,
      rawTokensHint,
      compile,
      compiledTask,
      compiledBudget,
      proveExpandedIds,
      proveExpandedTokenSum,
      agentParityHandle,
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
      questionStale,
      budgetStale,
      proveStale,
    }),
    [
      config,
      samples,
      loadError,
      file,
      sampleKey,
      task,
      budget,
      presets,
      docSizeNote,
      rawTokensHint,
      compile,
      compiledTask,
      compiledBudget,
      proveExpandedIds,
      proveExpandedTokenSum,
      agentParityHandle,
      hydrated,
      setFile,
      setSampleKey,
      setCompile,
      clearCompile,
      setProveInclude,
      clearProveIncludes,
      setPresets,
      questionStale,
      budgetStale,
      proveStale,
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
