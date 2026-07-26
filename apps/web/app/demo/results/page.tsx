"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { useState } from "react";

import { useDemo } from "@/lib/demo-context";
import type { ExpandApiResult, SectionInfo } from "@/lib/types";

function SectionCard({ s, kind }: { s: SectionInfo; kind: "in" | "out" }) {
  return (
    <article className={`scard-static ${kind}`}>
      <div className="nm">
        {s.section}{" "}
        <span className="afaint">
          · {s.tokens.toLocaleString()} tok
          {s.relevance != null ? ` · rel ${(s.relevance * 100).toFixed(0)}%` : ""}
          {s.truncated ? " · truncated" : ""}
        </span>
      </div>
      {s.text ? <pre className="sectext">{s.text}</pre> : null}
    </article>
  );
}

export default function ResultsPage() {
  const { compile, questionStale, budgetStale, task, budget } = useDemo();
  const [peek, setPeek] = useState<Record<string, string>>({});
  const [err, setErr] = useState("");

  if (!compile) {
    return (
      <section className="panel">
        <h2 className="sec">No compile yet</h2>
        <p className="sub">
          <Link href="/demo">Compile a document</Link> first.
        </p>
      </section>
    );
  }

  async function expand(id: string) {
    setErr("");
    try {
      const res = await fetch("/api/expand", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ handle: compile!.handle, section_id: id }),
      });
      const data = (await res.json()) as ExpandApiResult & { error?: string };
      if (!res.ok) throw new Error(data.error || "Expand failed");
      setPeek((p) => ({ ...p, [id]: data.markdown }));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Expand failed");
    }
  }

  const stale = questionStale || budgetStale;

  return (
    <section>
      <motion.div
        className="panel"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      >
        <h2 className="sec">Compiled context</h2>
        <p className="sub">
          {compile.raw_tokens.toLocaleString()} → {compile.tokens_used.toLocaleString()} tokens (
          {compile.reduction_pct}% fewer)
          {compile.compile_hints?.early_stopped ? " · early-stopped with spare under ceiling" : ""}
        </p>
        {stale ? (
          <p className="hostnote" role="status">
            Inputs changed since this compile (task or budget).{" "}
            <Link href="/demo">Recompile</Link> before Prove / Agent.
          </p>
        ) : null}

        <div className="row" style={{ marginBottom: 16 }}>
          <Link className={`btn ghost${stale ? " disabled" : ""}`} href={stale ? "/demo" : "/demo/prove"}>
            Prove answer parity
          </Link>
          <Link className={`btn quiet`} href={stale ? "/demo" : "/demo/agent"}>
            Run agent
          </Link>
        </div>

        <p className="alabel">Included</p>
        <div className="section-list">
          {compile.selected_sections.length === 0 ? (
            <p className="sub">No sections included — try a higher budget or a sharper question.</p>
          ) : (
            compile.selected_sections.map((s) => <SectionCard key={s.id} s={s} kind="in" />)
          )}
        </div>

        <p className="alabel">Omitted (budget)</p>
        <div className="section-list">
          {(compile.budget_omitted_sections ?? []).map((s) => (
            <div key={s.id}>
              <SectionCard s={s} kind="out" />
              <button type="button" className="btn quiet" onClick={() => void expand(s.id)}>
                Peek expand
              </button>
              {peek[s.id] ? <pre className="sectext peek">{peek[s.id]}</pre> : null}
            </div>
          ))}
        </div>

        <p className="alabel">Omitted (relevance)</p>
        <div className="section-list">
          {(compile.relevance_omitted_sections ?? []).slice(0, 12).map((s) => (
            <SectionCard key={s.id} s={s} kind="out" />
          ))}
        </div>

        {err ? (
          <div className="err" role="alert">
            {err}
          </div>
        ) : null}

        <details className="formhint" style={{ marginTop: 18 }}>
          <summary>Raw packed markdown</summary>
          <pre className="sectext">{compile.markdown}</pre>
        </details>
        <p className="sub" style={{ marginTop: 12 }}>
          Live inputs: budget {budget.toLocaleString()} · task “{task.slice(0, 80)}
          {task.length > 80 ? "…" : ""}”
        </p>
      </motion.div>
    </section>
  );
}
