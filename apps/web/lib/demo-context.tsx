"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import type { CompileApiResult, Sample, ServerConfig } from "./types";
import { applyProveIncludeChange, computePresets, DEFAULT_PRESETS, type BudgetPresets } from "./ux";

type DemoState = {
  config: ServerConfig | null;
  samples: Sample[];
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

const Ctx = createContext<DemoState | null>(null);

export function DemoProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<ServerConfig | null>(null);
  const [samples, setSamples] = useState<Sample[]>([]);
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
    void (async () => {
      try {
        const [c, s] = await Promise.all([
          fetch("/api/config").then((r) => r.json() as Promise<ServerConfig>),
          fetch("/api/samples").then((r) => r.json() as Promise<Sample[]>),
        ]);
        setConfig(c);
        setSamples(Array.isArray(s) ? s : []);
      } catch (e) {
        console.warn("config/samples load failed", e);
      }
    })();
  }, []);

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

  const setFile = useCallback(
    (f: File | null) => {
      setFileState(f);
      clearCompile();
    },
    [clearCompile]
  );

  const setSampleKey = useCallback(
    (k: string | null) => {
      setSampleKeyState(k);
      clearCompile();
    },
    [clearCompile]
  );

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

export function useDemo() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useDemo outside DemoProvider");
  return v;
}

export { computePresets, DEFAULT_PRESETS };
