"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { useWorkspace } from "@/lib/workspace-context";
import type { AgentParityResult, AgentRunMeta, AgentRunSnapshot, AgentRunStep } from "@/lib/types";
import { apiFailureMessage, fetchWithBusyRetry } from "@/lib/ux";

function freezeValue<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freezeValue(child);
  return Object.freeze(value);
}

function parseEventBlock(block: string): { event: string; data: Record<string, unknown> } | null {
  let event = "message";
  const dataLines: string[] = [];
  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    if (line.startsWith("data:")) dataLines.push(line.slice(5).replace(/^ /, ""));
  }
  if (!dataLines.length) return null;
  try {
    return { event, data: JSON.parse(dataLines.join("\n")) as Record<string, unknown> };
  } catch {
    throw new Error("Malformed agent event.");
  }
}

export default function AgentPage() {
  const {
    file,
    sampleKey,
    task,
    budget,
    compile,
    compiledSnapshot,
    config,
    workspaceStatus,
    pendingRun,
    consumeRun,
  } = useWorkspace();
  const [parityBusy, setParityBusy] = useState(false);
  const [validationError, setValidationError] = useState("");
  const [parityErr, setParityErr] = useState("");
  const [loadingDetail, setLoadingDetail] = useState("");
  const [run, setRun] = useState<AgentRunSnapshot | null>(null);
  const attemptSeq = useRef(0);
  const activeAttempt = useRef<{ id: string; controller: AbortController } | null>(null);
  const activeParity = useRef<{ runId: string; controller: AbortController } | null>(null);

  const llmOk = config?.llm_available ?? false;
  const { agentStale, sourceUnavailable } = workspaceStatus;
  const busy = run?.status === "running";

  async function runAgent() {
    setValidationError("");
    setParityErr("");
    if (!file) {
      setValidationError("Choose a document first.");
      return;
    }
    if (agentStale) {
      setValidationError("Task changed — recompile first.");
      return;
    }
    if (!llmOk) {
      setValidationError("This host has no LLM API key. Agent is disabled.");
      return;
    }

    const id = `agent-${Date.now()}-${++attemptSeq.current}`;
    const controller = new AbortController();
    const runningSnapshot: AgentRunSnapshot = Object.freeze({
      id,
      task: task.trim(),
      budget,
      source: Object.freeze({
        documentName: compiledSnapshot?.documentName ?? file.name,
        sampleKey,
        size: file.size,
        type: file.type,
        lastModified: file.lastModified,
      }),
      sourceFile: file,
      status: "running",
      steps: Object.freeze([]),
      answer: "",
      meta: null,
      parityHandle: null,
      parityResult: null,
      error: null,
      submittedAt: new Date().toISOString(),
      completedAt: null,
    });

    activeAttempt.current?.controller.abort();
    activeParity.current?.controller.abort();
    activeAttempt.current = { id, controller };
    activeParity.current = null;
    setParityBusy(false);
    setRun(runningSnapshot);
    setLoadingDetail("First step can take a few seconds while the file converts and the model plans.");

    const updateRunning = (update: (current: AgentRunSnapshot) => AgentRunSnapshot) => {
      if (activeAttempt.current?.id !== id || controller.signal.aborted) return;
      setRun((current) =>
        current?.id === id && current.status === "running" ? Object.freeze(update(current)) : current
      );
    };

    try {
      const fd = new FormData();
      fd.append("file", runningSnapshot.sourceFile);
      fd.append("task", runningSnapshot.task);
      fd.append("token_budget", String(runningSnapshot.budget));
      const res = await fetchWithBusyRetry(
        "/api/agent",
        { method: "POST", body: fd, signal: controller.signal },
        () => {
          if (activeAttempt.current?.id === id) setLoadingDetail("Server busy — retrying once…");
        }
      );
      if (activeAttempt.current?.id !== id || controller.signal.aborted) return;
      const ctype = res.headers.get("content-type") || "";
      if (!ctype.includes("text/event-stream")) {
        let error: string | undefined;
        try {
          error = ((await res.json()) as { error?: string }).error;
        } catch {
          // A proxy or upstream can return an HTML/plain-text failure.
        }
        if (!res.ok || error) throw new Error(apiFailureMessage(res, error, "agent"));
        throw new Error("Agent returned a non-SSE response.");
      }
      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response stream");
      const dec = new TextDecoder();
      let buf = "";
      let sawDone = false;
      stream: while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (activeAttempt.current?.id !== id || controller.signal.aborted) {
          await reader.cancel();
          return;
        }
        buf += dec.decode(value, { stream: true });
        while (true) {
          const boundary = buf.match(/\r?\n\r?\n/);
          if (!boundary || boundary.index == null) break;
          const block = buf.slice(0, boundary.index);
          buf = buf.slice(boundary.index + boundary[0].length);
          const parsed = parseEventBlock(block);
          if (!parsed) continue;
          const { event, data } = parsed;
          if (activeAttempt.current?.id !== id || controller.signal.aborted) return;
          if (event === "step") {
            const step = freezeValue(structuredClone(data) as AgentRunStep);
            updateRunning((current) => ({
              ...current,
              steps: Object.freeze([...current.steps, step]),
            }));
          }
          if (event === "error") throw new Error(String(data.error || "Agent error"));
          if (event === "done") {
            sawDone = true;
            const meta: AgentRunMeta = Object.freeze({
              tokensRead: Number(data.tokens_read ?? 0),
              rawTokens: Number(data.raw_tokens ?? 0),
              finalTokens: Number(data.final_context_tokens ?? 0),
              stoppedReason: String(data.stopped_reason ?? "unknown"),
              unreadRemaining: Boolean(data.unread_remaining),
            });
            const handle = typeof data.parity_handle === "string" ? data.parity_handle : null;
            updateRunning((current) => ({
              ...current,
              status: "succeeded",
              answer: String(data.answer ?? data.final_answer ?? ""),
              meta,
              parityHandle: handle,
              completedAt: new Date().toISOString(),
            }));
            await reader.cancel();
            break stream;
          }
        }
      }
      if (!sawDone) throw new Error("Connection ended before the agent finished.");
    } catch (e) {
      if (activeAttempt.current?.id !== id) return;
      const cancelled = e instanceof Error && e.name === "AbortError";
      updateRunning((current) => ({
        ...current,
        status: cancelled ? "cancelled" : "failed",
        error: cancelled ? "Agent cancelled." : e instanceof Error ? e.message : "Agent failed",
        completedAt: new Date().toISOString(),
      }));
    } finally {
      if (activeAttempt.current?.id === id) {
        activeAttempt.current = null;
        setLoadingDetail("");
      }
    }
  }

  function cancelRun() {
    const active = activeAttempt.current;
    if (!active) return;
    activeAttempt.current = null;
    active.controller.abort();
    setLoadingDetail("");
    setRun((current) =>
      current?.id === active.id && current.status === "running"
        ? Object.freeze({
            ...current,
            status: "cancelled",
            error: "Agent cancelled.",
            completedAt: new Date().toISOString(),
          })
        : current
    );
  }

  useEffect(() => {
    if (pendingRun !== "agent" || !consumeRun("agent")) return;
    void runAgent();
    // One-shot route handoff from the compile form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingRun]);

  async function runParity() {
    setParityErr("");
    const parityRun = run;
    if (!parityRun?.parityHandle || parityRun.status !== "succeeded") {
      setParityErr("Run the agent first to unlock compare.");
      return;
    }
    const runId = parityRun.id;
    const parityHandle = parityRun.parityHandle;
    const controller = new AbortController();
    activeParity.current?.controller.abort();
    activeParity.current = { runId, controller };
    setParityBusy(true);
    try {
      const res = await fetchWithBusyRetry(
        "/api/agent-parity",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ parity_handle: parityHandle }),
          signal: controller.signal,
        },
        () => {
          if (activeParity.current?.runId === runId) setParityErr("Server busy — retrying comparison once…");
        }
      );
      const data = (await res.json()) as AgentParityResult & { error?: string };
      if (!res.ok) throw new Error(apiFailureMessage(res, data.error, "agentParity"));
      if (activeParity.current?.runId !== runId || controller.signal.aborted) return;
      const result = freezeValue(structuredClone(data));
      setRun((current) =>
        current?.id === runId && current.parityHandle === parityHandle
          ? Object.freeze({ ...current, parityHandle: null, parityResult: result })
          : current
      );
    } catch (e) {
      if (activeParity.current?.runId !== runId || controller.signal.aborted) return;
      setParityErr(e instanceof Error ? e.message : "Compare failed");
    } finally {
      if (activeParity.current?.runId === runId) {
        activeParity.current = null;
        setParityBusy(false);
      }
    }
  }

  useEffect(
    () => () => {
      activeAttempt.current?.controller.abort();
      activeParity.current?.controller.abort();
      activeAttempt.current = null;
      activeParity.current = null;
    },
    []
  );

  const steps = run?.steps ?? [];
  const liveTokens = steps.reduce((sum, step) => sum + Math.max(0, Number(step.tokens_added ?? 0)), 0);
  const meterTokens = run?.meta?.tokensRead ?? liveTokens;
  const meterPct = Math.min(100, (100 * meterTokens) / Math.max(1, run?.budget ?? budget));

  return (
    <section className="panel">
      <h2 className="sec">Run agent</h2>
      <p className="sub">
        SSE step trace — the model retrieves with compile_context / expand_section under your ceiling.
      </p>
      {run ? (
        <div className="hostnote" data-testid="agent-run-snapshot">
          <strong>Submitted snapshot:</strong> “{run.task}” · {run.budget.toLocaleString()} token budget ·{" "}
          {run.source.documentName}
        </div>
      ) : null}
      {agentStale || sourceUnavailable ? (
        <p className="hostnote">
          {agentStale ? "The question changed." : "The source file is no longer available."}{" "}
          <Link href="/workspace">Recompile</Link> first.
        </p>
      ) : null}
      {!llmOk ? (
        <p className="hostnote" role="status">
          Agent disabled: {config?.llm_disabled_reason || "no supported LLM API key is configured."}
        </p>
      ) : null}
      <div className="row">
        <button
          className="btn primary"
          type="button"
          disabled={agentStale || sourceUnavailable || !llmOk}
          onClick={() => void runAgent()}
        >
          {busy ? "Restart agent" : "Run agent"}
        </button>
        {busy ? (
          <button className="btn ghost" type="button" onClick={cancelRun}>
            Cancel
          </button>
        ) : null}
        <button
          className="btn quiet"
          type="button"
          disabled={!run?.parityHandle || parityBusy || !llmOk}
          onClick={() => void runParity()}
        >
          {parityBusy ? "Comparing…" : "Compare to full file"}
        </button>
        <Link className="btn quiet" href={compile ? "/workspace/results" : "/workspace"}>
          {compile ? "Back to results" : "Back to compile"}
        </Link>
      </div>
      {busy ? (
        <div className="loading-banner" role="status" aria-live="polite" aria-busy="true">
          <span className="spinner" aria-hidden="true" />
          <span>
            <strong>Starting agent…</strong>
            <small>{loadingDetail}</small>
          </span>
        </div>
      ) : null}
      {validationError || run?.error ? (
        <div className="err" role="alert">
          {validationError || run?.error}
        </div>
      ) : null}
      {parityErr ? (
        <div className="err" role="alert">
          {parityErr}
        </div>
      ) : null}
      {busy || steps.length > 0 || run?.meta ? (
        <div className="agent-meter" aria-label="Agent tokens read">
          <div className="meter-label">
            <strong>{meterTokens.toLocaleString()} tokens read</strong>
            <span>
              ceiling {(run?.budget ?? budget).toLocaleString()}
              {run?.meta?.rawTokens ? ` · whole file ${run.meta.rawTokens.toLocaleString()}` : ""}
            </span>
          </div>
          <div className="htrack">
            <div className="hbar small" style={{ width: `${meterPct}%` }} />
          </div>
        </div>
      ) : null}
      <div className="asteps" style={{ marginTop: 16 }} aria-live="polite" aria-busy={busy}>
        {steps.map((st, i) => (
          <div key={i} className="astep">
            <div className="abody">
              <div className="atitle">
                {String(st.title ?? st.action ?? st.kind ?? `Step ${st.n ?? i + 1}`)}
              </div>
              {st.detail || st.reasoning ? (
                <div className="areason" dir="auto">
                  {String(st.detail ?? st.reasoning)}
                </div>
              ) : null}
              {st.section_id || st.tokens_added != null ? (
                <div className="step-meta">
                  {st.section_id ? `section ${st.section_id}` : ""}
                  {st.section_id && st.tokens_added != null ? " · " : ""}
                  {st.tokens_added != null ? `+${Number(st.tokens_added).toLocaleString()} tokens` : ""}
                  {st.truncated ? " · truncated to remaining headroom" : ""}
                </div>
              ) : null}
            </div>
          </div>
        ))}
      </div>
      {run?.answer ? (
        <>
          <p className="alabel">Answer</p>
          <div className="aanswer" dir="auto">
            {run.answer}
          </div>
        </>
      ) : null}
      {run?.meta ? (
        <p className="hostnote" role="status">
          Stopped: <strong>{run.meta.stoppedReason.replaceAll("_", " ")}</strong>. Final answer used{" "}
          <strong>{run.meta.finalTokens.toLocaleString()}</strong> content tokens.
          {run.meta.tokensRead > run.budget
            ? ` The soft ceiling may overshoot slightly at tokenizer/wrapper boundaries (+${(
                run.meta.tokensRead - run.budget
              ).toLocaleString()} tokens).`
            : ""}
          {run.meta.stoppedReason === "token_ceiling" && run.meta.unreadRemaining
            ? " Unread sections remain; raise the budget and run again for broader coverage."
            : ""}
        </p>
      ) : null}
      {run?.parityResult ? (
        <div className="parity-grid" style={{ marginTop: 20 }}>
          <div>
            <p className="alabel">Full file · {run.parityResult.full.context_tokens.toLocaleString()} tok</p>
            <div className="aanswer" dir="auto">
              {run.parityResult.full.answer}
            </div>
          </div>
          <div>
            <p className="alabel">
              Agent context · {run.parityResult.agent.context_tokens.toLocaleString()} tok
            </p>
            <div className="aanswer" dir="auto">
              {run.parityResult.agent.answer}
            </div>
          </div>
          <p className="sub" style={{ gridColumn: "1 / -1" }}>
            Model: {run.parityResult.model}
          </p>
        </div>
      ) : null}
    </section>
  );
}
