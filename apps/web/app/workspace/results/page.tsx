"use client";

import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { useEffect, useRef, useState } from "react";

import { useWorkspace } from "@/lib/workspace-context";
import type { ExpandApiResult, SectionInfo } from "@/lib/types";
import {
  apiFailureMessage,
  fetchWithBusyRetry,
  includeRestHint,
  packagingGapNote,
  relevancePercentLabel,
  sectionLeaf,
  truncatedSectionMeta,
} from "@/lib/ux";

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
    sessionSavedTokens,
    sessionSavedUsd,
  } = useWorkspace();
  const [peek, setPeek] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<Set<string>>(() => new Set());
  const [showAllRelevance, setShowAllRelevance] = useState(false);
  const [err, setErr] = useState("");
  const autoPeekedHandle = useRef("");
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    const first = compile?.budget_omitted_sections?.[0];
    if (!compile || !first || autoPeekedHandle.current === compile.handle) return;
    autoPeekedHandle.current = compile.handle;
    void expand(first.id);
    // expand is deliberately one-shot for each compile handle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compile?.handle]);

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
      const res = await fetchWithBusyRetry(
        "/api/expand",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ handle: compile!.handle, section_id: id }),
        },
        () => setErr("Server busy — retrying this peek once…")
      );
      const data = (await res.json()) as ExpandApiResult & { error?: string };
      if (!res.ok) throw new Error(apiFailureMessage(res, data.error, "expand"));
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
  const packedPct = Math.min(
    100,
    Math.max(compile.tokens_used > 0 ? 3 : 0, (100 * compile.tokens_used) / Math.max(1, compile.raw_tokens))
  );
  const early = compile.compile_hints?.early_stopped;
  const budgetOmitted = compile.budget_omitted_sections ?? [];
  const relevanceOmitted = compile.relevance_omitted_sections ?? [];
  const visibleRelevance = showAllRelevance ? relevanceOmitted : relevanceOmitted.slice(0, 12);
  const selectedByRelevance = [...compile.selected_sections].sort(
    (a, b) => (b.relevance ?? -1) - (a.relevance ?? -1)
  );
  const packaging = packagingGapNote(compile.selected_content_tokens, compile.tokens_used);

  function dismissPeek(id: string) {
    setPeek((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
  }

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

        <div className="stats" aria-label="Compile savings">
          <div className="stat">
            <div className="v">{compile.raw_tokens.toLocaleString()}</div>
            <div className="l">raw content tokens</div>
          </div>
          <div className="stat">
            <div className="v result-win">{compile.tokens_used.toLocaleString()}</div>
            <div className="l">packed content</div>
          </div>
          <div className="stat">
            <div className={`v result-win${compile.reduction_pct === 0 ? " neutral-result" : ""}`}>
              {compile.reduction_pct}%
            </div>
            <div className="l">reduction</div>
          </div>
          <div className="stat">
            <div className="v cost-value">
              ${compile.cost_raw_usd.toFixed(4)} → ${compile.cost_compiled_usd.toFixed(4)}
            </div>
            <div className="l">cost / read · ${compile.price_per_mtok}/Mtok</div>
          </div>
        </div>
        <div className="badge-row" aria-label="Compile details">
          <span className="badge">{compile.cache_hit ? "⚡ conversion cached" : "converted fresh"}</span>
          <span className="badge">BM25 ranking</span>
          <span className="badge">{compile.omitted_sections.length} omitted</span>
          <span className="badge">{budgetOmitted.length} budget-blocked</span>
        </div>
        {packaging ? (
          <p className="bucket-help">
            {packaging}. Packed-content meters count section substance; the larger wire value includes safety
            wrappers. The omitted-section manifest is inspectability metadata and is not sent in Prove/Agent
            model context.
          </p>
        ) : null}
        <div className="bars" aria-label="Raw versus packed tokens">
          <div className="brow">
            <div className="blab">raw file</div>
            <div className="btrack">
              <div className="bar raw" style={{ width: "100%" }} />
            </div>
            <span className="bval">{compile.raw_tokens.toLocaleString()}</span>
          </div>
          <div className="brow">
            <div className="blab">packed</div>
            <div className="btrack">
              <div className="bar cmp" style={{ width: `${packedPct}%` }} />
            </div>
            <span className="bval">{compile.tokens_used.toLocaleString()}</span>
          </div>
        </div>
        <p className="session-saved" role="status">
          <strong>${sessionSavedUsd.toFixed(4)} saved this session</strong>
          <span>
            {sessionSavedTokens.toLocaleString()} tokens · ~${(sessionSavedUsd * 1000).toFixed(0)} per 1,000
            repeated reads
          </span>
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

        {compile.queries.length > 1 ? (
          <div className="floornote">
            <strong>Detected {compile.queries.length} questions.</strong> Each was ranked separately, then top
            sections were merged round-robin so one keyword-heavy question cannot crowd out the others.
            <ol className="query-list">
              {compile.queries.map((query, index) => (
                <li key={`${index}-${query}`}>
                  <span className="qtag">Q{index + 1}</span> {query}
                </li>
              ))}
            </ol>
            {compile.compile_hints?.multi_part_nudge ? (
              <p>Check omitted sections or raise the budget if one part still looks incomplete.</p>
            ) : null}
          </div>
        ) : null}

        {early ? (
          <div className="floornote">
            <strong>Coverage complete.</strong> The budget is a ceiling, not a fill quota. Weaker or redundant
            sections were left out after the question was covered.
          </div>
        ) : compile.next_section_hint ? (
          <div className="floornote">
            <strong>Budget-bound.</strong> “{sectionLeaf(compile.next_section_hint.section)}” scored{" "}
            {compile.next_section_hint.relevance}% but did not fit. Raise the budget to about{" "}
            {compile.next_section_hint.suggested_budget.toLocaleString()} tokens or include it in Prove below.
          </div>
        ) : compile.compile_hints?.omit_action && compile.compile_hints.named_omit ? (
          <div className="floornote">
            <strong>Transparent omissions.</strong> “{sectionLeaf(compile.compile_hints.named_omit.section)}”
            and other sections remain available below to peek or include in Prove.
          </div>
        ) : null}

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
            selectedByRelevance.map((s) => (
              <article key={s.id} className="scard-static in">
                <div className="nm">
                  {s.section} <span className="section-id">[{s.id}]</span>{" "}
                  <span className="afaint">· {metaFor(s)}</span>
                </div>
                {s.matched_queries?.length ? (
                  <div className="section-queries" aria-label="Matched questions">
                    {s.matched_queries.map((queryIndex) => (
                      <span className="qtag alt" key={queryIndex}>
                        Q{queryIndex + 1}
                      </span>
                    ))}
                  </div>
                ) : null}
                {s.text ? (
                  <pre className="sectext" dir="auto">
                    {s.text}
                  </pre>
                ) : null}
                {s.truncated && (s.remainder_tokens ?? 0) > 0 ? (
                  <>
                    <div className="peek-actions">
                      <label className="include-lab">
                        <input
                          type="checkbox"
                          disabled={proveStale}
                          checked={proveExpandedIds.includes(s.id)}
                          onChange={(ev) => setProveInclude(s.id, s.remainder_tokens ?? 0, ev.target.checked)}
                        />{" "}
                        {includeRestHint(s.remainder_tokens ?? 0, sectionLeaf(s.section))}
                      </label>
                      <button
                        className="btn quiet"
                        type="button"
                        disabled={pending.has(s.id) || Boolean(peek[s.id])}
                        onClick={() => void expand(s.id)}
                      >
                        {pending.has(s.id) ? "Loading rest…" : "Peek rest"}
                      </button>
                    </div>
                    {peek[s.id] ? (
                      <details open>
                        <summary>Unread remainder · section {s.id}</summary>
                        <pre className="sectext peek" dir="auto">
                          {peek[s.id].startsWith(s.text ?? "")
                            ? peek[s.id].slice((s.text ?? "").length).trim()
                            : peek[s.id]}
                        </pre>
                        <button className="btn quiet" type="button" onClick={() => dismissPeek(s.id)}>
                          Dismiss peek
                        </button>
                      </details>
                    ) : null}
                  </>
                ) : null}
              </article>
            ))
          )}
        </div>

        {budgetOmitted.length > 0 ? (
          <>
            <p className="alabel">Relevant but over budget · {budgetOmitted.length}</p>
            <p className="bucket-help">
              These sections were useful candidates but could not be packed under the ceiling.
            </p>
            <div className="section-list">
              {budgetOmitted.map((s) => (
                <article key={s.id} className="scard-static">
                  <div className="nm">
                    {s.section} <span className="section-id">[{s.id}]</span>{" "}
                    <span className="afaint">· {metaFor(s)}</span>
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
                    <details open>
                      <summary>Loaded peek · section {s.id}</summary>
                      <pre className="sectext peek" dir="auto">
                        {peek[s.id]}
                      </pre>
                      <button className="btn quiet" type="button" onClick={() => dismissPeek(s.id)}>
                        Dismiss peek
                      </button>
                    </details>
                  ) : null}
                </article>
              ))}
            </div>
          </>
        ) : null}

        {relevanceOmitted.length > 0 ? (
          <>
            <p className="alabel">
              Other omitted sections · showing {visibleRelevance.length} of {relevanceOmitted.length}
            </p>
            <p className="bucket-help">
              Left out after coverage, diversity, size, and relevance checks. Relevance is relative to the
              best score, so tied sections can show 100% without all being needed or fitting.
            </p>
            <div className="section-list">
              {visibleRelevance.map((s) => (
                <article key={s.id} className="scard-static">
                  <div className="nm">
                    {s.section} <span className="section-id">[{s.id}]</span>{" "}
                    <span className="afaint">· {metaFor(s)}</span>
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
                    <details open>
                      <summary>Loaded peek · section {s.id}</summary>
                      <pre className="sectext peek" dir="auto">
                        {peek[s.id]}
                      </pre>
                      <button className="btn quiet" type="button" onClick={() => dismissPeek(s.id)}>
                        Dismiss peek
                      </button>
                    </details>
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
