"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { useWorkspace } from "@/lib/workspace-context";
import type { CompileApiResult, MeasureApiResult, Sample } from "@/lib/types";
import { computePresets, DEFAULT_PRESETS, SLIDER_MAX, SLIDER_MIN } from "@/lib/ux";

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
  const {
    config,
    samples,
    loadError,
    file,
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
  } = useWorkspace();
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState("");

  async function measureUpload(f: File) {
    const seq = ++measureSeq.current;
    setPresets(DEFAULT_PRESETS, null);
    setDocSizeNote("Measuring document size…");
    try {
      const fd = new FormData();
      fd.append("file", f);
      const res = await fetch("/api/measure", { method: "POST", body: fd });
      const d = (await res.json()) as MeasureApiResult;
      if (seq !== measureSeq.current) return;
      if (d.error) throw new Error(d.error);
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
      setPicked(`Sample: ${s.nm}`);
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
    if (!file) {
      setErr("Upload a file or pick a sample.");
      return;
    }
    if (!task.trim()) {
      setErr("Enter a question / task.");
      return;
    }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("task", task.trim());
      fd.append("token_budget", String(budget));
      const res = await fetch("/api/compile", { method: "POST", body: fd });
      const data = (await res.json()) as CompileApiResult & { error?: string };
      if (!res.ok) throw new Error(data.error || `Compile failed (${res.status})`);
      setCompile(data, task.trim(), budget);
      setRawTokensHint(data.raw_tokens);
      router.push("/workspace/results");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Compile failed");
    } finally {
      setBusy(false);
    }
  }

  const pool = config?.rate_limit ?? 100;
  const windowMin = config?.rate_window_minutes ?? 5;
  const sliderMin = config?.web_budget_min ?? SLIDER_MIN;
  const sliderMax = config?.web_budget_max ?? SLIDER_MAX;
  const maxFileMb = (config?.max_file_bytes ?? 20 * 1024 * 1024) / (1024 * 1024);
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
              clearCompile();
              setSampleKey(null);
              setFile(f);
              setPicked(f ? f.name : "");
              if (f) void measureUpload(f);
              else {
                setDocSizeNote("");
                setRawTokensHint(null);
                setPresets(DEFAULT_PRESETS, null);
              }
            }}
          />
          {picked ? (
            <p className="filepicked" role="status">
              {picked}
            </p>
          ) : null}

          <details className="samplesbox" open>
            <summary>
              <span>
                No file handy? <span className="cap">Try a sample</span>
              </span>
            </summary>
            <div className="samples" role="group" aria-label="Sample documents">
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
            onChange={(ev) => setTask(ev.target.value)}
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
                <button key={q} type="button" className="qchip" onClick={() => setTask(q)}>
                  {q}
                </button>
              ))}
            </div>
          ) : null}

          <label htmlFor="budget">Token budget</label>
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

          <div className="row">
            <button className="btn primary" type="submit" disabled={busy}>
              {busy ? "Compiling…" : "Compile"}
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
            </ul>
          </div>
        </details>
      </div>
    </section>
  );
}
