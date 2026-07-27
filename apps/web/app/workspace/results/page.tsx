"use client";

import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { useState } from "react";

import { useWorkspace } from "@/lib/workspace-context";
import type { ExpandApiResult, SectionInfo } from "@/lib/types";
import { includeRestHint, relevancePercentLabel, sectionLeaf, truncatedSectionMeta } from "@/lib/ux";

function metaFor(s: SectionInfo): string {
  if (s.truncated && s.full_tokens != null) {
    return truncatedSectionMeta(s.tokens, s.full_tokens, s.remainder_tokens ?? 0, s.relevance);
  }
  const relevance = relevancePercentLabel(s.relevance);
  const rel = relevance ? ` · ${relevance}` : "";
  return `${s.tokens.toLocaleString()} tok${rel}${s.truncated ? " · truncated" : ""}`;
}

export default function ResultsPage() {
  const {
    compile,
    file,
    proveStale,
    questionStale,
    budgetStale,
    proveExpandedIds,
    proveExpandedTokenSum,
    setProveInclude,
    task,
    budget,
  } = useWorkspace();
  const [peek, setPeek] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<Set<string>>(() => new Set());
  const [showAllRelevance, setShowAllRelevance] = useState(false);
  const [err, setErr] = useState("");
  const reduceMotion = useReducedMotion();

  if (!compile) {
    return (
      <section className="panel">
        <h2 className="sec">No compile yet</h2>
        <p className="sub">
          <Link href="/workspace">Compile a document</Link> first.
        </p>
      </section>
    );
  }

  async function expand(id: string) {
    if (peek[id] || pending.has(id)) return;
    setErr("");
    setPending((current) => new Set(current).add(id));
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
    } finally {
      setPending((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    }
  }

  const pct = Math.min(100, Math.round((100 * compile.tokens_used) / Math.max(1, compile.token_budget)));
  const early = compile.compile_hints?.early_stopped;
  const budgetOmitted = compile.budget_omitted_sections ?? [];
  const relevanceOmitted = compile.relevance_omitted_sections ?? [];
  const visibleRelevance = showAllRelevance ? relevanceOmitted : relevanceOmitted.slice(0, 12);

  return (
    <section>
      <motion.div
        className="panel"
        initial={reduceMotion ? false : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: reduceMotion ? 0 : 0.45, ease: [0.22, 1, 0.36, 1] }}
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

        {questionStale || budgetStale || !file ? (
          <p className="hostnote" role="status">
            {!file
              ? "The source file is not available in this browser session. "
              : questionStale
                ? "The question changed since this compile. Expands for Prove were cleared. "
                : "The budget changed since this compile. Prove requires matching results; Agent can use the live budget. "}
            <Link href="/workspace">Recompile</Link>
            {questionStale || !file ? " before Prove / Agent." : " before Prove."}
          </p>
        ) : null}

        {proveExpandedIds.length > 0 ? (
          <p className="hostnote">
            <strong>{proveExpandedIds.length}</strong> section(s) marked Include in Prove (+
            {proveExpandedTokenSum.toLocaleString()} content tokens). Peeks alone do not count.
          </p>
        ) : null}

        <div className="row" style={{ marginBottom: 16 }}>
          <Link className="btn ghost" href={proveStale || !file ? "/workspace" : "/workspace/prove"}>
            Prove answer parity
          </Link>
          <Link className="btn quiet" href={questionStale || !file ? "/workspace" : "/workspace/agent"}>
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
                {s.text ? (
                  <pre className="sectext" dir="auto">
                    {s.text}
                  </pre>
                ) : null}
                {s.truncated && (s.remainder_tokens ?? 0) > 0 ? (
                  <label className="include-lab">
                    <input
                      type="checkbox"
                      disabled={proveStale}
                      checked={proveExpandedIds.includes(s.id)}
                      onChange={(ev) => setProveInclude(s.id, s.remainder_tokens ?? 0, ev.target.checked)}
                    />{" "}
                    {includeRestHint(s.remainder_tokens ?? 0, sectionLeaf(s.section))}
                  </label>
                ) : null}
              </article>
            ))
          )}
        </div>

        {budgetOmitted.length > 0 ? (
          <>
            <p className="alabel">Omitted (budget) · {budgetOmitted.length}</p>
            <div className="section-list">
              {budgetOmitted.map((s) => (
                <article key={s.id} className="scard-static">
                  <div className="nm">
                    {s.section} <span className="afaint">· {metaFor(s)}</span>
                  </div>
                  <div className="row" style={{ marginTop: 8 }}>
                    <button
                      type="button"
                      className="btn quiet"
                      disabled={pending.has(s.id) || Boolean(peek[s.id])}
                      onClick={() => void expand(s.id)}
                    >
                      {pending.has(s.id) ? "Expanding…" : peek[s.id] ? "Expanded" : "Peek expand"}
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
                  {peek[s.id] ? (
                    <pre className="sectext peek" dir="auto">
                      {peek[s.id]}
                    </pre>
                  ) : null}
                </article>
              ))}
            </div>
          </>
        ) : null}

        {relevanceOmitted.length > 0 ? (
          <>
            <p className="alabel">
              Omitted (relevance) · showing {visibleRelevance.length} of {relevanceOmitted.length}
            </p>
            <div className="section-list">
              {visibleRelevance.map((s) => (
                <article key={s.id} className="scard-static">
                  <div className="nm">
                    {s.section} <span className="afaint">· {metaFor(s)}</span>
                  </div>
                  <div className="row" style={{ marginTop: 8 }}>
                    <button
                      type="button"
                      className="btn quiet"
                      disabled={pending.has(s.id) || Boolean(peek[s.id])}
                      onClick={() => void expand(s.id)}
                    >
                      {pending.has(s.id) ? "Expanding…" : peek[s.id] ? "Expanded" : "Peek expand"}
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
                  {peek[s.id] ? (
                    <pre className="sectext peek" dir="auto">
                      {peek[s.id]}
                    </pre>
                  ) : null}
                </article>
              ))}
            </div>
            {relevanceOmitted.length > 12 ? (
              <button className="btn quiet" type="button" onClick={() => setShowAllRelevance((v) => !v)}>
                {showAllRelevance ? "Show first 12" : `Show all ${relevanceOmitted.length}`}
              </button>
            ) : null}
          </>
        ) : null}

        {err ? (
          <div className="err" role="alert">
            {err}
          </div>
        ) : null}

        <details className="formhint" style={{ marginTop: 18 }}>
          <summary>Raw packed markdown</summary>
          <pre className="sectext" dir="auto">
            {compile.markdown}
          </pre>
        </details>
        <p className="sub" style={{ marginTop: 12 }}>
          Live inputs: budget {budget.toLocaleString()} · task “{task.slice(0, 80)}
          {task.length > 80 ? "…" : ""}”
        </p>
      </motion.div>
    </section>
  );
}
