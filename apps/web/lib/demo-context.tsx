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

type DemoState = {
  config: ServerConfig | null;
  samples: Sample[];
  file: File | null;
  sampleKey: string | null;
  task: string;
  budget: number;
  compile: CompileApiResult | null;
  compiledTask: string | null;
  compiledBudget: number | null;
  setFile: (f: File | null) => void;
  setSampleKey: (k: string | null) => void;
  setTask: (t: string) => void;
  setBudget: (n: number) => void;
  setCompile: (r: CompileApiResult | null, task: string, budget: number) => void;
  clearCompile: () => void;
  questionStale: boolean;
  budgetStale: boolean;
};

const Ctx = createContext<DemoState | null>(null);

export function DemoProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<ServerConfig | null>(null);
  const [samples, setSamples] = useState<Sample[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [sampleKey, setSampleKey] = useState<string | null>(null);
  const [task, setTask] = useState("");
  const [budget, setBudget] = useState(4000);
  const [compile, setCompileState] = useState<CompileApiResult | null>(null);
  const [compiledTask, setCompiledTask] = useState<string | null>(null);
  const [compiledBudget, setCompiledBudget] = useState<number | null>(null);

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

  const setCompile = useCallback((r: CompileApiResult | null, t: string, b: number) => {
    setCompileState(r);
    setCompiledTask(r ? t : null);
    setCompiledBudget(r ? b : null);
  }, []);

  const clearCompile = useCallback(() => {
    setCompileState(null);
    setCompiledTask(null);
    setCompiledBudget(null);
  }, []);

  const questionStale = Boolean(compile && compiledTask !== null && task.trim() !== compiledTask.trim());
  const budgetStale = Boolean(compile && compiledBudget !== null && budget !== compiledBudget);

  const value = useMemo(
    () => ({
      config,
      samples,
      file,
      sampleKey,
      task,
      budget,
      compile,
      compiledTask,
      compiledBudget,
      setFile,
      setSampleKey,
      setTask,
      setBudget,
      setCompile,
      clearCompile,
      questionStale,
      budgetStale,
    }),
    [
      config,
      samples,
      file,
      sampleKey,
      task,
      budget,
      compile,
      compiledTask,
      compiledBudget,
      setCompile,
      clearCompile,
      questionStale,
      budgetStale,
    ]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useDemo() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useDemo outside DemoProvider");
  return v;
}
