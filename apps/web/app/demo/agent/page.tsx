"use client";

import Link from "next/link";
import { useRef, useState } from "react";

import { useDemo } from "@/lib/demo-context";

type Step = { kind?: string; title?: string; detail?: string; [k: string]: unknown };

export default function AgentPage() {
  const { file, task, budget, compile, config, questionStale, budgetStale } = useDemo();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [steps, setSteps] = useState<Step[]>([]);
  const [answer, setAnswer] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  const stale = questionStale || budgetStale;
  const llmOk = config?.llm_available ?? false;

  async function runAgent() {
    setErr("");
    setSteps([]);
    setAnswer("");
    if (!file || !compile) {
      setErr("Compile a document first.");
      return;
    }
    if (stale) {
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
      <p className="sub">SSE step trace — the model retrieves with compile_context / expand_section under your ceiling.</p>
      {stale ? (
        <p className="hostnote">
          Stale compile. <Link href="/demo">Recompile</Link> first.
        </p>
      ) : null}
      <div className="row">
        <button className="btn primary" type="button" disabled={busy || stale || !llmOk} onClick={() => void runAgent()}>
          {busy ? "Running…" : "Run agent"}
        </button>
        {busy ? (
          <button
            className="btn ghost"
            type="button"
            onClick={() => abortRef.current?.abort()}
          >
            Cancel
          </button>
        ) : null}
        <Link className="btn quiet" href="/demo/results">
          Back to results
        </Link>
      </div>
      {err ? (
        <div className="err" role="alert">
          {err}
        </div>
      ) : null}
      <div className="asteps" style={{ marginTop: 16 }}>
        {steps.map((st, i) => (
          <div key={i} className="astep">
            <div className="abody">
              <div className="atitle">{String(st.title ?? st.kind ?? `Step ${i + 1}`)}</div>
              {st.detail || st.reason ? (
                <div className="areason">{String(st.detail ?? st.reason)}</div>
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
    </section>
  );
}
