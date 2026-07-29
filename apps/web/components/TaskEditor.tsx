"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

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
import { useWorkspace } from "@/lib/workspace-context";

async function fileFromSample(sample: Sample, signal: AbortSignal): Promise<File> {
  const response = await fetch(`/samples/${sample.file}`, { signal });
  if (!response.ok) throw new Error(`Could not load sample ${sample.file}`);
  const buffer = await response.arrayBuffer();
  return new File([buffer], sample.file, {
    type: response.headers.get("content-type") || "application/octet-stream",
  });
}

export function TaskEditor({ rail = false }: { rail?: boolean }) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement | null>(null);
  const measureSeq = useRef(0);
  const sampleAbort = useRef<AbortController | null>(null);
  const compileAbort = useRef<AbortController | null>(null);
  const compileInFlight = useRef(false);
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

  useEffect(
    () => () => {
      sampleAbort.current?.abort();
      compileAbort.current?.abort();
      ++measureSeq.current;
    },
    []
  );

  async function measureUpload(upload: File) {
    const seq = ++measureSeq.current;
    setPresets(DEFAULT_PRESETS, null);
    setDocSizeNote("Measuring document size…");
    try {
      const formData = new FormData();
      formData.append("file", upload);
      const response = await fetchWithBusyRetry("/api/measure", { method: "POST", body: formData }, () =>
        setDocSizeNote("Server busy — retrying size check once…")
      );
      const data = (await response.json()) as MeasureApiResult;
      if (seq !== measureSeq.current) return;
      if (!response.ok || data.error) {
        throw new Error(apiFailureMessage(response, data.error, "measure"));
      }
      const nextPresets = computePresets(
        data.raw_tokens,
        config?.web_budget_min ?? SLIDER_MIN,
        config?.web_budget_max ?? SLIDER_MAX
      );
      setPresets(nextPresets, "standard");
      setRawTokensHint(data.raw_tokens);
      setDocSizeNote(
        `This document is ~${data.raw_tokens.toLocaleString()} tokens once converted.${
          nextPresets !== DEFAULT_PRESETS ? " Presets below are scaled to it." : ""
        }`
      );
    } catch (error) {
      if (seq !== measureSeq.current) return;
      setRawTokensHint(null);
      setDocSizeNote(
        error instanceof Error && error.message
          ? `Couldn't pre-measure this file: ${error.message}`
          : "Size will be shown after you compile."
      );
    }
  }

  async function pickSample(sample: Sample) {
    sampleAbort.current?.abort();
    const controller = new AbortController();
    sampleAbort.current = controller;
    const seq = ++measureSeq.current;
    setErr("");
    clearCompile();
    setSampleKey(null);
    setFile(null);
    if (fileInput.current) fileInput.current.value = "";
    try {
      const sampleFile = await fileFromSample(sample, controller.signal);
      if (controller.signal.aborted || seq !== measureSeq.current) return;
      setSampleKey(sample.key);
      setFile(sampleFile);
      if (sample.q[0]) setTask(sample.q[0]);
      if (sample.tok != null) {
        const nextPresets = computePresets(
          sample.tok,
          config?.web_budget_min ?? SLIDER_MIN,
          config?.web_budget_max ?? SLIDER_MAX
        );
        setPresets(nextPresets, "standard");
        setRawTokensHint(sample.tok);
        setDocSizeNote(
          `This document is about ${sample.tok.toLocaleString()} tokens total.${
            nextPresets !== DEFAULT_PRESETS ? " The presets below are scaled to it." : ""
          }`
        );
      } else {
        setDocSizeNote("Measuring sample size in the background…");
        void measureUpload(sampleFile);
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      setErr(error instanceof Error ? error.message : "Sample load failed");
    } finally {
      if (sampleAbort.current === controller) sampleAbort.current = null;
    }
  }

  function showValidationError() {
    if (!file) setErr("Upload a file or pick a sample.");
    else if (fileValidationError) setErr(fileValidationError);
    else if (!task.trim()) setErr("Enter a question / task.");
  }

  async function onCompile(event: React.FormEvent) {
    event.preventDefault();
    if (compileInFlight.current) return;
    setErr("");
    if (!workspaceStatus.compileAvailable) {
      showValidationError();
      return;
    }
    if (!file) return;

    compileInFlight.current = true;
    const controller = new AbortController();
    compileAbort.current = controller;
    setBusy(true);
    setLoadingDetail(
      "Converting a file for the first time can take a few seconds; cached files are instant."
    );
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("task", task.trim());
      formData.append("token_budget", String(budget));
      const response = await fetchWithBusyRetry(
        "/api/compile",
        { method: "POST", body: formData, signal: controller.signal },
        () => setLoadingDetail("Server busy — retrying once…")
      );
      const data = (await response.json()) as CompileApiResult & { error?: string };
      if (!response.ok) throw new Error(apiFailureMessage(response, data.error, "compile"));
      setCompile(data, task.trim(), budget);
      setRawTokensHint(data.raw_tokens);
      router.push("/workspace/results");
    } catch (error) {
      setErr(
        error instanceof Error && error.name === "AbortError"
          ? "Compile cancelled."
          : error instanceof Error
            ? error.message
            : "Compile failed"
      );
    } finally {
      compileInFlight.current = false;
      setBusy(false);
      setLoadingDetail("");
      if (compileAbort.current === controller) compileAbort.current = null;
    }
  }

  function launch(action: "prove" | "agent") {
    setErr("");
    if (!workspaceStatus.compileAvailable) {
      showValidationError();
      return;
    }
    requestRun(action);
    router.push(`/workspace/${action}`);
  }

  const sliderMin = config?.web_budget_min ?? SLIDER_MIN;
  const sliderMax = config?.web_budget_max ?? SLIDER_MAX;
  const maxFileMb = maxFileBytes / (1024 * 1024);
  const maxFileLabel = Number.isInteger(maxFileMb) ? String(maxFileMb) : maxFileMb.toFixed(1);
  const selectedFileLabel = sampleKey
    ? `Sample: ${samples.find((sample) => sample.key === sampleKey)?.nm ?? filePicked}`
    : filePicked;

  return (
    <form className={rail ? "workspace-rail-editor" : undefined} onSubmit={onCompile}>
      <label htmlFor="file">Upload (pdf, docx, xlsx, pptx, html, csv, txt, md). Max {maxFileLabel} MB</label>
      <input
        ref={fileInput}
        id="file"
        type="file"
        accept=".pdf,.docx,.xlsx,.pptx,.html,.htm,.csv,.txt,.md,.markdown"
        onChange={(event) => {
          sampleAbort.current?.abort();
          ++measureSeq.current;
          const nextFile = event.target.files?.[0] ?? null;
          const validationError = nextFile ? validateUploadFile(nextFile, maxFileBytes) : null;
          if (validationError) {
            event.target.value = "";
            setErr(validationError);
            setFile(null);
            return;
          }
          setErr("");
          clearCompile();
          setSampleKey(null);
          setFile(nextFile);
          if (nextFile) {
            void measureUpload(nextFile);
          } else {
            setDocSizeNote("");
            setRawTokensHint(null);
            setPresets(DEFAULT_PRESETS, null);
          }
        }}
      />
      {selectedFileLabel ? (
        <p className="filepicked" role="status">
          {selectedFileLabel}
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
          {samples.map((sample) => (
            <button
              key={sample.key}
              type="button"
              className={`scard${sampleKey === sample.key ? " active" : ""}`}
              aria-pressed={sampleKey === sample.key}
              onClick={() => void pickSample(sample)}
            >
              <div className="nm">
                {sample.nm}
                <span className={`fmt ${sample.fmt}`}>{sample.fmt}</span>
              </div>
              <div className="mt">{sample.mt}</div>
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
        onChange={(event) => {
          setTask(event.target.value);
          event.currentTarget.style.height = "auto";
          event.currentTarget.style.height = `${event.currentTarget.scrollHeight}px`;
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            event.currentTarget.form?.requestSubmit();
          }
        }}
        placeholder="e.g. What does the warranty not cover?"
      />
      {sampleKey ? (
        <div className="qchips" role="group" aria-label="Suggested questions">
          {(samples.find((sample) => sample.key === sampleKey)?.q ?? []).map((question) => (
            <button
              key={question}
              type="button"
              className={`qchip${task.trim() === question.trim() ? " active" : ""}`}
              aria-pressed={task.trim() === question.trim()}
              onClick={() => setTask(question)}
            >
              {question}
            </button>
          ))}
        </div>
      ) : null}
      <details className="formhint">
        <summary>Tips for questions</summary>
        <p>
          Asking several things at once? Separate them with <strong>?</strong> or new lines. Each question is
          ranked on its own, then the best sections are merged. Press <kbd>Enter</kbd> to compile or{" "}
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
        onChange={(event) => setBudget(Number(event.target.value))}
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

      <div className={rail ? "workspace-rail-action" : "row"}>
        <button className="btn primary" type="submit" disabled={busy}>
          {busy ? "Compiling…" : "Compile"}
        </button>
        {busy ? (
          <button className="btn ghost" type="button" onClick={() => compileAbort.current?.abort()}>
            Cancel
          </button>
        ) : null}
        {!rail ? (
          <>
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
          </>
        ) : null}
      </div>
    </form>
  );
}
