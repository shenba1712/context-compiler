"use client";

import Link from "next/link";
import { useRef, useState } from "react";

import { useDemo } from "@/lib/demo-context";
import type { AgentParityResult } from "@/lib/types";

type Step = { kind?: string; title?: string; detail?: string; action?: string; n?: number; [k: string]: unknown };

export default function AgentPage() {
  const {
    file,
    task,
    budget,
    compile,
    config,
    proveStale,
    agentParityHandle,
    setAgentParityHandle,
  } = useDemo();
  const [busy, setBusy] = useState(false);
  const [parityBusy, setParityBusy] = useState(false);
  const [err, setErr] = useState("");
  const [parityErr, setParityErr] = useState("");
  const [steps, setSteps] = useState<Step[]>([]);
  const [answer, setAnswer] = useState("");
  const [parity, setParity] = useState<AgentParityResult | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const llmOk = config?.llm_available ?? false;

  async function runAgent() {
    setErr("");
    setParityErr("");
    setSteps([]);
    setAnswer("");
    setParity(null);
    setAgentParityHandle(null);
    if (!file || !compile) {
      setErr("Compile a document first.");
      return;
    }
    if (proveStale) {
      setErr("Task or budget changed — recompile first.");
      return;
    }
    if (!llmOk) {
      setErr("This host has no LLM API key. Agent is disabled.");
      return;
    }
    const ac = new AbortController();
    abortRef.current = ac;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("task", task.trim());
      fd.append("token_budget", String(budget));
      const res = await fetch("/api/agent", { method: "POST", body: fd, signal: ac.signal });
      const ctype = res.headers.get("content-type") || "";
      if (!ctype.includes("text/event-stream")) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error || `Agent failed (${res.status})`);
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
      abortRef.current = null;
    }
  }

  async function runParity() {
    setParityErr("");
    setParity(null);
    if (!agentParityHandle) {
      setParityErr("Run the agent first to unlock compare.");
      return;
    }
    setParityBusy(true);
    try {
      const res = await fetch("/api/agent-parity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parity_handle: agentParityHandle }),
      });
      const data = (await res.json()) as AgentParityResult & { error?: string };
      if (!res.ok) throw new Error(data.error || `Compare failed (${res.status})`);
      setParity(data);
      setAgentParityHandle(null); // one-shot
    } catch (e) {
      setParityErr(e instanceof Error ? e.message : "Compare failed");
    } finally {
      setParityBusy(false);
    }
  }

  if (!compile) {
    return (
      <section className="panel">
        <h2 className="sec">Run agent</h2>
        <p className="sub">
          <Link href="/demo">Compile</Link> first. The model drives compile → expand under your budget.
        </p>
      </section>
    );
  }

  return (
    <section className="panel">
      <h2 className="sec">Run agent</h2>
      <p className="sub">
        SSE step trace — the model retrieves with compile_context / expand_section under your ceiling.
      </p>
      {proveStale ? (
        <p className="hostnote">
          Stale compile. <Link href="/demo">Recompile</Link> first.
        </p>
      ) : null}
      <div className="row">
        <button
          className="btn primary"
          type="button"
          disabled={busy || proveStale || !llmOk}
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
        <Link className="btn quiet" href="/demo/results">
          Back to results
        </Link>
      </div>
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
      <div className="asteps" style={{ marginTop: 16 }}>
        {steps.map((st, i) => (
          <div key={i} className="astep">
            <div className="abody">
              <div className="atitle">
                {String(st.title ?? st.action ?? st.kind ?? `Step ${st.n ?? i + 1}`)}
              </div>
              {st.detail || st.reasoning ? (
                <div className="areason">{String(st.detail ?? st.reasoning)}</div>
              ) : null}
            </div>
          </div>
        ))}
      </div>
      {answer ? (
        <>
          <p className="alabel">Answer</p>
          <div className="aanswer">{answer}</div>
        </>
      ) : null}
      {parity ? (
        <div
          style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 20 }}
        >
          <div>
            <p className="alabel">Full file · {parity.full.context_tokens.toLocaleString()} tok</p>
            <div className="aanswer">{parity.full.answer}</div>
          </div>
          <div>
            <p className="alabel">Agent context · {parity.agent.context_tokens.toLocaleString()} tok</p>
            <div className="aanswer">{parity.agent.answer}</div>
          </div>
          <p className="sub" style={{ gridColumn: "1 / -1" }}>
            Model: {parity.model}
          </p>
        </div>
      ) : null}
    </section>
  );
}
