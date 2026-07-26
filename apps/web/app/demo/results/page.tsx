"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { useState } from "react";

import { useDemo } from "@/lib/demo-context";
import type { ExpandApiResult, SectionInfo } from "@/lib/types";
import { includeRestHint, sectionLeaf, truncatedSectionMeta } from "@/lib/ux";

function metaFor(s: SectionInfo): string {
  if (s.truncated && s.full_tokens != null) {
    return truncatedSectionMeta(s.tokens, s.full_tokens, s.remainder_tokens ?? 0, s.relevance);
  }
  const rel = s.relevance != null ? ` · rel ${(s.relevance * 100).toFixed(0)}%` : "";
  return `${s.tokens.toLocaleString()} tok${rel}${s.truncated ? " · truncated" : ""}`;
}

export default function ResultsPage() {
  const {
    compile,
    proveStale,
    proveExpandedIds,
    proveExpandedTokenSum,
    setProveInclude,
    task,
    budget,
  } = useDemo();
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

  const pct = Math.min(100, Math.round((100 * compile.tokens_used) / Math.max(1, compile.token_budget)));
  const early = compile.compile_hints?.early_stopped;

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
          {early ? " · early-stopped with spare under ceiling" : ""}
        </p>

        <div className="bar-block" style={{ marginBottom: 16 }}>
          <div className="bar-label">
            <span>Packed vs budget</span>
            <span className="tokens">
              {compile.tokens_used.toLocaleString()} / {compile.token_budget.toLocaleString()}
            </span>
          </div>
          <div className="htrack" style={{ background: "var(--bg2)" }}>
            <div className="hbar small" style={{ width: `${pct}%`, background: "var(--compiled)" }} />
          </div>
          {early ? (
            <p className="sub" style={{ marginTop: 6 }}>
              {(compile.token_budget - compile.tokens_used).toLocaleString()} spare under ceiling
            </p>
          ) : null}
        </div>

        {proveStale ? (
          <p className="hostnote" role="status">
            Inputs changed since this compile (task or budget). Expands for Prove were cleared.{" "}
            <Link href="/demo">Recompile</Link> before Prove / Agent.
          </p>
        ) : null}

        {proveExpandedIds.length > 0 ? (
          <p className="hostnote">
            <strong>{proveExpandedIds.length}</strong> section(s) marked Include in Prove (+
            {proveExpandedTokenSum.toLocaleString()} content tokens). Peeks alone do not count.
          </p>
        ) : null}

        <div className="row" style={{ marginBottom: 16 }}>
          <Link className="btn ghost" href={proveStale ? "/demo" : "/demo/prove"}>
            Prove answer parity
          </Link>
          <Link className="btn quiet" href={proveStale ? "/demo" : "/demo/agent"}>
            Run agent
          </Link>
        </div>

        <p className="alabel">Included</p>
        <div className="section-list">
          {compile.selected_sections.length === 0 ? (
            <p className="sub">No sections included — try a higher budget or a sharper question.</p>
          ) : (
            compile.selected_sections.map((s) => (
              <article key={s.id} className="scard-static in">
                <div className="nm">
                  {s.section} <span className="afaint">· {metaFor(s)}</span>
                </div>
                {s.text ? <pre className="sectext">{s.text}</pre> : null}
                {s.truncated && (s.remainder_tokens ?? 0) > 0 ? (
                  <label className="include-lab">
                    <input
                      type="checkbox"
                      disabled={proveStale}
                      checked={proveExpandedIds.includes(s.id)}
                      onChange={(ev) =>
                        setProveInclude(s.id, s.remainder_tokens ?? 0, ev.target.checked)
                      }
                    />{" "}
                    {includeRestHint(s.remainder_tokens ?? 0, sectionLeaf(s.section))}
                  </label>
                ) : null}
              </article>
            ))
          )}
        </div>

        <p className="alabel">Omitted (budget)</p>
        <div className="section-list">
          {(compile.budget_omitted_sections ?? []).map((s) => (
            <article key={s.id} className="scard-static">
              <div className="nm">
                {s.section} <span className="afaint">· {metaFor(s)}</span>
              </div>
              <div className="row" style={{ marginTop: 8 }}>
                <button type="button" className="btn quiet" onClick={() => void expand(s.id)}>
                  Peek expand
                </button>
                <label className="include-lab">
                  <input
                    type="checkbox"
                    disabled={proveStale}
                    checked={proveExpandedIds.includes(s.id)}
                    onChange={(ev) => setProveInclude(s.id, s.tokens, ev.target.checked)}
                  />{" "}
                  Include in Prove
                </label>
              </div>
              {peek[s.id] ? <pre className="sectext peek">{peek[s.id]}</pre> : null}
            </article>
          ))}
        </div>

        <p className="alabel">Omitted (relevance)</p>
        <div className="section-list">
          {(compile.relevance_omitted_sections ?? []).slice(0, 12).map((s) => (
            <article key={s.id} className="scard-static">
              <div className="nm">
                {s.section} <span className="afaint">· {metaFor(s)}</span>
              </div>
              <div className="row" style={{ marginTop: 8 }}>
                <button type="button" className="btn quiet" onClick={() => void expand(s.id)}>
                  Peek expand
                </button>
                <label className="include-lab">
                  <input
                    type="checkbox"
                    disabled={proveStale}
                    checked={proveExpandedIds.includes(s.id)}
                    onChange={(ev) => setProveInclude(s.id, s.tokens, ev.target.checked)}
                  />{" "}
                  Include in Prove
                </label>
              </div>
              {peek[s.id] ? <pre className="sectext peek">{peek[s.id]}</pre> : null}
            </article>
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
