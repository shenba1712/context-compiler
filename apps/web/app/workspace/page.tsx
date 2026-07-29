"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { useWorkspace } from "@/lib/workspace-context";
import type { CompileApiResult, MeasureApiResult, Sample } from "@/lib/types";
import {
  apiFailureMessage,
  computePresets,
  DEFAULT_PRESETS,
  deriveWorkspaceStatus,
  fetchWithBusyRetry,
  SLIDER_MAX,
  SLIDER_MIN,
  validateUploadFile,
} from "@/lib/ux";

async function fileFromSample(s: Sample, signal: AbortSignal): Promise<File> {
  const res = await fetch(`/samples/${s.file}`, { signal });
  if (!res.ok) throw new Error(`Could not load sample ${s.file}`);
  const buf = await res.arrayBuffer();
  return new File([buf], s.file, { type: res.headers.get("content-type") || "application/octet-stream" });
}

export default function WorkspaceCompilePage() {
  const router = useRouter();
  const measureSeq = useRef(0);
  const sampleAbort = useRef<AbortController | null>(null);
  const compileAbort = useRef<AbortController | null>(null);
  const {
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
    setFile,
    setSampleKey,
    setTask,
    setBudget,
    setPresets,
    setDocSizeNote,
    setRawTokensHint,
    setCompile,
    clearCompile,
    requestRun,
  } = useWorkspace();
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState("");
  const maxFileBytes = config?.max_file_bytes ?? 20 * 1024 * 1024;
  const fileValidationError = file ? validateUploadFile(file, maxFileBytes) : null;
  const workspaceStatus = deriveWorkspaceStatus({
    hasCompiledOnce: false,
    lastCompiledTask: null,
    currentTask: task,
    lastCompiledBudget: null,
    currentBudget: budget,
    sourceAvailable: Boolean(file),
    taskValid: Boolean(task.trim()),
    sourceValid: fileValidationError === null,
    busy,
  });

  async function measureUpload(f: File) {
    const seq = ++measureSeq.current;
    setPresets(DEFAULT_PRESETS, null);
    setDocSizeNote("Measuring document size…");
    try {
      const fd = new FormData();
      fd.append("file", f);
      const res = await fetchWithBusyRetry("/api/measure", { method: "POST", body: fd }, () =>
        setDocSizeNote("Server busy — retrying size check once…")
      );
      const d = (await res.json()) as MeasureApiResult;
      if (seq !== measureSeq.current) return;
      if (!res.ok || d.error) throw new Error(apiFailureMessage(res, d.error, "measure"));
      const p = computePresets(
        d.raw_tokens,
        config?.web_budget_min ?? SLIDER_MIN,
        config?.web_budget_max ?? SLIDER_MAX
      );
      setPresets(p, "standard");
      setRawTokensHint(d.raw_tokens);
      const scaled = p !== DEFAULT_PRESETS;
      setDocSizeNote(
        `This document is ~${d.raw_tokens.toLocaleString()} tokens once converted.${
          scaled ? " Presets below are scaled to it." : ""
        }`
      );
    } catch (e) {
      if (seq !== measureSeq.current) return;
      setRawTokensHint(null);
      setDocSizeNote(
        e instanceof Error && e.message
          ? `Couldn't pre-measure this file: ${e.message}`
          : "Size will be shown after you compile."
      );
    }
  }

  async function pickSample(s: Sample) {
    sampleAbort.current?.abort();
    const controller = new AbortController();
    sampleAbort.current = controller;
    const seq = ++measureSeq.current;
    setErr("");
    clearCompile();
    setSampleKey(s.key);
    setFile(null);
    try {
      const f = await fileFromSample(s, controller.signal);
      if (controller.signal.aborted || seq !== measureSeq.current) return;
      setFile(f);
      if (s.q[0]) setTask(s.q[0]);
      if (s.tok != null) {
        const p = computePresets(
          s.tok,
          config?.web_budget_min ?? SLIDER_MIN,
          config?.web_budget_max ?? SLIDER_MAX
        );
        setPresets(p, "standard");
        setRawTokensHint(s.tok);
        setDocSizeNote(
          `This document is about ${s.tok.toLocaleString()} tokens total.${
            p !== DEFAULT_PRESETS ? " The presets below are scaled to it." : ""
          }`
        );
      } else {
        setDocSizeNote("Measuring sample size in the background…");
        void measureUpload(f);
      }
    } catch (e) {
      if (controller.signal.aborted) return;
      setErr(e instanceof Error ? e.message : "Sample load failed");
    } finally {
      if (sampleAbort.current === controller) sampleAbort.current = null;
    }
  }

  async function onCompile(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    if (!workspaceStatus.compileAvailable) {
      if (!file) setErr("Upload a file or pick a sample.");
      else if (fileValidationError) setErr(fileValidationError);
      else if (!task.trim()) setErr("Enter a question / task.");
      return;
    }
    if (!file) return;
    const controller = new AbortController();
    compileAbort.current?.abort();
    compileAbort.current = controller;
    setBusy(true);
    setLoadingDetail(
      "Converting a file for the first time can take a few seconds; cached files are instant."
    );
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("task", task.trim());
      fd.append("token_budget", String(budget));
      const res = await fetchWithBusyRetry(
        "/api/compile",
        { method: "POST", body: fd, signal: controller.signal },
        () => setLoadingDetail("Server busy — retrying once…")
      );
      const data = (await res.json()) as CompileApiResult & { error?: string };
      if (!res.ok) throw new Error(apiFailureMessage(res, data.error, "compile"));
      setCompile(data, task.trim(), budget);
      setRawTokensHint(data.raw_tokens);
      router.push("/workspace/results");
    } catch (e) {
      setErr(
        e instanceof Error && e.name === "AbortError"
          ? "Compile cancelled."
          : e instanceof Error
            ? e.message
            : "Compile failed"
      );
    } finally {
      setBusy(false);
      setLoadingDetail("");
      if (compileAbort.current === controller) compileAbort.current = null;
    }
  }

  function launch(action: "prove" | "agent") {
    setErr("");
    if (!workspaceStatus.compileAvailable) {
      if (!file) setErr("Upload a file or pick a sample.");
      else if (fileValidationError) setErr(fileValidationError);
      else if (!task.trim()) setErr("Enter a question / task.");
      return;
    }
    requestRun(action);
    router.push(`/workspace/${action}`);
  }

  const pool = config?.rate_limit ?? 100;
  const windowMin = config?.rate_window_minutes ?? 5;
  const sliderMin = config?.web_budget_min ?? SLIDER_MIN;
  const sliderMax = config?.web_budget_max ?? SLIDER_MAX;
  const maxFileMb = maxFileBytes / (1024 * 1024);
  const maxFileLabel = Number.isInteger(maxFileMb) ? String(maxFileMb) : maxFileMb.toFixed(1);

  return (
    <section>
      <div className="panel">
        <h2 className="sec">Compile a document</h2>
        <p className="sub">Upload your own file, or pick a sample. Then ask a question and set a budget.</p>
        <p className="hostnote" role="note">
          Free-tier hosts may sleep when idle — first load can take <strong>30–60 seconds</strong>.
        </p>

        <form onSubmit={onCompile}>
          <label htmlFor="file">
            Upload (pdf, docx, xlsx, pptx, html, csv, txt, md). Max {maxFileLabel} MB
          </label>
          <input
            id="file"
            type="file"
            accept=".pdf,.docx,.xlsx,.pptx,.html,.htm,.csv,.txt,.md,.markdown"
            onChange={(ev) => {
              sampleAbort.current?.abort();
              ++measureSeq.current;
              const f = ev.target.files?.[0] ?? null;
              const validationError = f ? validateUploadFile(f, maxFileBytes) : null;
              if (validationError) {
                ev.target.value = "";
                setErr(validationError);
                setFile(null);
                return;
              }
              setErr("");
              clearCompile();
              setSampleKey(null);
              setFile(f);
              if (f) void measureUpload(f);
              else {
                setDocSizeNote("");
                setRawTokensHint(null);
                setPresets(DEFAULT_PRESETS, null);
              }
            }}
          />
          {filePicked ? (
            <p className="filepicked" role="status">
              {filePicked}
            </p>
          ) : null}

          <details className="samplesbox" open>
            <summary>
              <span>
                No file handy? <span className="cap">Try a sample</span>
              </span>
            </summary>
            <div className="samples" role="group" aria-label="Sample documents">
              {samples.length === 0 ? (
                <p className="bucket-help">
                  {loadError
                    ? "The sample library is unavailable right now. You can still upload your own document."
                    : config
                      ? "No sample documents are configured on this host. Upload your own document."
                      : "Loading the sample library…"}
                </p>
              ) : null}
              {samples.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  className={`scard${sampleKey === s.key ? " active" : ""}`}
                  aria-pressed={sampleKey === s.key}
                  onClick={() => void pickSample(s)}
                >
                  <div className="nm">
                    {s.nm}
                    <span className={`fmt ${s.fmt}`}>{s.fmt}</span>
                  </div>
                  <div className="mt">{s.mt}</div>
                </button>
              ))}
            </div>
          </details>

          <label htmlFor="task" style={{ marginTop: 20 }}>
            Question / task
          </label>
          <textarea
            id="task"
            rows={2}
            value={task}
            onChange={(ev) => {
              setTask(ev.target.value);
              ev.currentTarget.style.height = "auto";
              ev.currentTarget.style.height = `${ev.currentTarget.scrollHeight}px`;
            }}
            onKeyDown={(ev) => {
              if (ev.key === "Enter" && !ev.shiftKey && !ev.nativeEvent.isComposing) {
                ev.preventDefault();
                (ev.currentTarget.form as HTMLFormElement | null)?.requestSubmit();
              }
            }}
            placeholder="e.g. What does the warranty not cover?"
          />
          {sampleKey ? (
            <div className="qchips" role="group" aria-label="Suggested questions">
              {(samples.find((s) => s.key === sampleKey)?.q ?? []).map((q) => (
                <button
                  key={q}
                  type="button"
                  className={`qchip${task.trim() === q.trim() ? " active" : ""}`}
                  aria-pressed={task.trim() === q.trim()}
                  onClick={() => setTask(q)}
                >
                  {q}
                </button>
              ))}
            </div>
          ) : null}
          <details className="formhint">
            <summary>Tips for questions</summary>
            <p>
              Asking several things at once? Separate them with <strong>?</strong> or new lines. Each question
              is ranked on its own, then the best sections are merged. Press <kbd>Enter</kbd> to compile or{" "}
              <kbd>Shift+Enter</kbd> for a new line.
            </p>
          </details>

          <label htmlFor="budget">
            Token budget <span className="label-note">(ceiling for Compile and Agent)</span>
          </label>
          {docSizeNote ? <div className="docsizenote">{docSizeNote}</div> : null}
          <div className="budgetbar">
            <div className="budgetnum">
              <span>{budget.toLocaleString()}</span> <span className="u">tokens</span>
            </div>
            <div className="bpre-group">
              {(
                [
                  ["quick", "Quick"],
                  ["standard", "Standard"],
                  ["deep", "Deep"],
                ] as const
              ).map(([tier, label]) => (
                <button
                  key={tier}
                  type="button"
                  className={`bpre${budget === presets[tier] ? " active" : ""}`}
                  aria-pressed={budget === presets[tier]}
                  onClick={() => setBudget(presets[tier])}
                >
                  {label}
                  <small>~{presets[tier].toLocaleString()}</small>
                </button>
              ))}
            </div>
          </div>
          <input
            id="budget"
            type="range"
            min={sliderMin}
            max={sliderMax}
            step={50}
            value={budget}
            onChange={(ev) => setBudget(Number(ev.target.value))}
          />
          <div className="sliderscale">
            <span>{sliderMin.toLocaleString()}</span>
            <span>{sliderMax.toLocaleString()}</span>
          </div>

          {err ? (
            <div className="err" role="alert">
              {err}
            </div>
          ) : null}
          {loadError ? (
            <div className="err" role="alert">
              Host setup could not load: {loadError}
            </div>
          ) : null}
          {busy ? (
            <div className="loading-banner" role="status" aria-live="polite" aria-busy="true">
              <span className="spinner" aria-hidden="true" />
              <span>
                <strong>Compiling…</strong>
                <small>{loadingDetail}</small>
              </span>
            </div>
          ) : null}

          <div className="row">
            <button className="btn primary" type="submit" disabled={busy}>
              {busy ? "Compiling…" : "Compile"}
            </button>
            {busy ? (
              <button className="btn ghost" type="button" onClick={() => compileAbort.current?.abort()}>
                Cancel
              </button>
            ) : null}
            <button
              className="btn quiet"
              type="button"
              disabled={busy || !config?.llm_available}
              onClick={() => launch("prove")}
              title="Skip compile results and compare full-file vs budgeted answers"
            >
              Prove…
            </button>
            <button
              className="btn quiet"
              type="button"
              disabled={busy || !config?.llm_available}
              onClick={() => launch("agent")}
            >
              Run agent ▸
            </button>
          </div>
        </form>

        <details className="expectbox">
          <summary>What to expect on this host</summary>
          <div className="expectbody">
            <ul>
              <li>
                Compile and expand share a pool of about <strong>{pool}</strong> points every{" "}
                <strong>{windowMin}</strong> minutes per IP.
              </li>
              <li>
                Prove / Agent need an LLM key on the server
                {config
                  ? config.llm_available
                    ? " (available here)."
                    : ` (${config.llm_disabled_reason || "not configured here"}).`
                  : "."}
              </li>
              <li>
                Prove costs <strong>{config?.rate_cost_answer ?? 4}</strong> points (about{" "}
                <strong>{Math.max(1, Math.floor(pool / (config?.rate_cost_answer ?? 4)))}</strong> runs per
                window); Agent costs <strong>{config?.rate_cost_agent ?? 12}</strong> (about{" "}
                <strong>{Math.max(1, Math.floor(pool / (config?.rate_cost_agent ?? 12)))}</strong>).
              </li>
              <li>
                Full-file comparisons cap context at about{" "}
                <strong>{(config?.answer_context_cap ?? 60_000).toLocaleString()}</strong> tokens; at most{" "}
                <strong>{config?.max_concurrent_llm ?? 2}</strong> LLM jobs run concurrently.
              </li>
            </ul>
          </div>
        </details>
      </div>
    </section>
  );
}
