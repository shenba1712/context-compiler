"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { useWorkspace } from "@/lib/workspace-context";
import type { AgentParityResult } from "@/lib/types";
import { apiFailureMessage, fetchWithBusyRetry, shouldDisableAgentWhenStale } from "@/lib/ux";

type Step = {
  kind?: string;
  title?: string;
  detail?: string;
  action?: string;
  n?: number;
  section_id?: string;
  tokens_added?: number;
  truncated?: boolean;
  [k: string]: unknown;
};

export default function AgentPage() {
  const {
    file,
    task,
    budget,
    compile,
    compiledTask,
    compiledBudget,
    config,
    agentParityHandle,
    setAgentParityHandle,
    pendingRun,
    consumeRun,
  } = useWorkspace();
  const [busy, setBusy] = useState(false);
  const [parityBusy, setParityBusy] = useState(false);
  const [err, setErr] = useState("");
  const [parityErr, setParityErr] = useState("");
  const [steps, setSteps] = useState<Step[]>([]);
  const [answer, setAnswer] = useState("");
  const [parity, setParity] = useState<AgentParityResult | null>(null);
  const [loadingDetail, setLoadingDetail] = useState("");
  const [runMeta, setRunMeta] = useState<{
    tokensRead: number;
    rawTokens: number;
    finalTokens: number;
    stoppedReason: string;
    unreadRemaining: boolean;
  } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const llmOk = config?.llm_available ?? false;
  const agentStale = shouldDisableAgentWhenStale({
    hasCompiledOnce: Boolean(compile),
    lastCompiledTask: compiledTask,
    currentTask: task,
    lastCompiledBudget: compiledBudget,
    currentBudget: budget,
  });

  async function runAgent() {
    setErr("");
    setParityErr("");
    setSteps([]);
    setAnswer("");
    setParity(null);
    setRunMeta(null);
    setAgentParityHandle(null);
    if (!file) {
      setErr("Choose a document first.");
      return;
    }
    if (agentStale) {
      setErr("Task changed — recompile first.");
      return;
    }
    if (!llmOk) {
      setErr("This host has no LLM API key. Agent is disabled.");
      return;
    }
    const ac = new AbortController();
    abortRef.current = ac;
    setBusy(true);
    setLoadingDetail("First step can take a few seconds while the file converts and the model plans.");
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("task", task.trim());
      fd.append("token_budget", String(budget));
      const res = await fetchWithBusyRetry(
        "/api/agent",
        { method: "POST", body: fd, signal: ac.signal },
        () => setLoadingDetail("Server busy — retrying once…")
      );
      const ctype = res.headers.get("content-type") || "";
      if (!ctype.includes("text/event-stream")) {
        const data = (await res.json()) as { error?: string };
        throw new Error(apiFailureMessage(res, data.error, "agent"));
      }
      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response stream");
      const dec = new TextDecoder();
      let buf = "";
      let sawDone = false;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split("\n\n");
        buf = parts.pop() ?? "";
        for (const block of parts) {
          const lines = block.split("\n");
          let event = "message";
          let dataLine = "";
          for (const line of lines) {
            if (line.startsWith("event:")) event = line.slice(6).trim();
            if (line.startsWith("data:")) dataLine += line.slice(5).trim();
          }
          if (!dataLine) continue;
          const data = JSON.parse(dataLine) as Record<string, unknown>;
          if (event === "step") setSteps((s) => [...s, data as Step]);
          if (event === "error") throw new Error(String(data.error || "Agent error"));
          if (event === "done") {
            sawDone = true;
            setAnswer(String(data.answer ?? data.final_answer ?? ""));
            setRunMeta({
              tokensRead: Number(data.tokens_read ?? 0),
              rawTokens: Number(data.raw_tokens ?? 0),
              finalTokens: Number(data.final_context_tokens ?? 0),
              stoppedReason: String(data.stopped_reason ?? "unknown"),
              unreadRemaining: Boolean(data.unread_remaining),
            });
            const handle = typeof data.parity_handle === "string" ? data.parity_handle : null;
            setAgentParityHandle(handle);
          }
        }
      }
      if (!sawDone) throw new Error("Connection ended before the agent finished.");
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") {
        setErr("Cancelled.");
      } else {
        setErr(e instanceof Error ? e.message : "Agent failed");
      }
    } finally {
      setBusy(false);
      setLoadingDetail("");
      abortRef.current = null;
    }
  }

  useEffect(() => {
    if (pendingRun !== "agent" || !consumeRun("agent")) return;
    void runAgent();
    // One-shot route handoff from the compile form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingRun]);

  async function runParity() {
    setParityErr("");
    setParity(null);
    if (!agentParityHandle) {
      setParityErr("Run the agent first to unlock compare.");
      return;
    }
    setParityBusy(true);
    try {
      const res = await fetchWithBusyRetry(
        "/api/agent-parity",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ parity_handle: agentParityHandle }),
        },
        () => setParityErr("Server busy — retrying comparison once…")
      );
      const data = (await res.json()) as AgentParityResult & { error?: string };
      if (!res.ok) throw new Error(apiFailureMessage(res, data.error, "agentParity"));
      setParity(data);
      setAgentParityHandle(null); // one-shot
    } catch (e) {
      setParityErr(e instanceof Error ? e.message : "Compare failed");
    } finally {
      setParityBusy(false);
    }
  }

  const liveTokens = steps.reduce((sum, step) => sum + Math.max(0, Number(step.tokens_added ?? 0)), 0);
  const meterTokens = runMeta?.tokensRead ?? liveTokens;
  const meterPct = Math.min(100, (100 * meterTokens) / Math.max(1, budget));

  return (
    <section className="panel">
      <h2 className="sec">Run agent</h2>
      <p className="sub">
        SSE step trace — the model retrieves with compile_context / expand_section under your ceiling.
      </p>
      {agentStale || !file ? (
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
          disabled={busy || agentStale || !file || !llmOk}
          onClick={() => void runAgent()}
        >
          {busy ? "Running…" : "Run agent"}
        </button>
        {busy ? (
          <button className="btn ghost" type="button" onClick={() => abortRef.current?.abort()}>
            Cancel
          </button>
        ) : null}
        <button
          className="btn quiet"
          type="button"
          disabled={!agentParityHandle || parityBusy || !llmOk}
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
      {err ? (
        <div className="err" role="alert">
          {err}
        </div>
      ) : null}
      {parityErr ? (
        <div className="err" role="alert">
          {parityErr}
        </div>
      ) : null}
      {busy || steps.length > 0 || runMeta ? (
        <div className="agent-meter" aria-label="Agent tokens read">
          <div className="meter-label">
            <strong>{meterTokens.toLocaleString()} tokens read</strong>
            <span>
              ceiling {budget.toLocaleString()}
              {runMeta?.rawTokens ? ` · whole file ${runMeta.rawTokens.toLocaleString()}` : ""}
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
      {answer ? (
        <>
          <p className="alabel">Answer</p>
          <div className="aanswer" dir="auto">
            {answer}
          </div>
        </>
      ) : null}
      {runMeta ? (
        <p className="hostnote" role="status">
          Stopped: <strong>{runMeta.stoppedReason.replaceAll("_", " ")}</strong>. Final answer used{" "}
          <strong>{runMeta.finalTokens.toLocaleString()}</strong> content tokens.
          {runMeta.tokensRead > budget
            ? ` The soft ceiling may overshoot slightly at tokenizer/wrapper boundaries (+${(
                runMeta.tokensRead - budget
              ).toLocaleString()} tokens).`
            : ""}
          {runMeta.stoppedReason === "token_ceiling" && runMeta.unreadRemaining
            ? " Unread sections remain; raise the budget and run again for broader coverage."
            : ""}
        </p>
      ) : null}
      {parity ? (
        <div className="parity-grid" style={{ marginTop: 20 }}>
          <div>
            <p className="alabel">Full file · {parity.full.context_tokens.toLocaleString()} tok</p>
            <div className="aanswer" dir="auto">
              {parity.full.answer}
            </div>
          </div>
          <div>
            <p className="alabel">Agent context · {parity.agent.context_tokens.toLocaleString()} tok</p>
            <div className="aanswer" dir="auto">
              {parity.agent.answer}
            </div>
          </div>
          <p className="sub" style={{ gridColumn: "1 / -1" }}>
            Model: {parity.model}
          </p>
        </div>
      ) : null}
    </section>
  );
}
