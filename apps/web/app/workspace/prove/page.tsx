"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { useWorkspace } from "@/lib/workspace-context";
import type { AnswerApiResult } from "@/lib/types";
import { apiFailureMessage, fetchWithBusyRetry, packagingGapNote } from "@/lib/ux";

export default function ProvePage() {
  const {
    file,
    task,
    budget,
    compile,
    config,
    workspaceStatus,
    proveExpandedIds,
    proveExpandedTokenSum,
    pendingRun,
    consumeRun,
  } = useWorkspace();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [result, setResult] = useState<AnswerApiResult | null>(null);
  const [loadingDetail, setLoadingDetail] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  const llmOk = config?.llm_available ?? false;
  const { proveStale, sourceUnavailable } = workspaceStatus;

  async function runProve() {
    setErr("");
    setResult(null);
    if (!file) {
      setErr("Choose a document first.");
      return;
    }
    if (!task.trim()) {
      setErr("Enter a question first.");
      return;
    }
    if (proveStale) {
      setErr("Task or budget changed — recompile first.");
      return;
    }
    if (!llmOk) {
      setErr("This host has no LLM API key. Prove is disabled.");
      return;
    }
    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;
    setBusy(true);
    setLoadingDetail("Asking the model twice: full file vs your budgeted compile.");
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("task", task.trim());
      fd.append("token_budget", String(budget));
      if (compile && proveExpandedIds.length) fd.append("expanded_ids", JSON.stringify(proveExpandedIds));
      const res = await fetchWithBusyRetry(
        "/api/answer",
        { method: "POST", body: fd, signal: controller.signal },
        () => setLoadingDetail("Server busy — retrying once…")
      );
      const data = (await res.json()) as AnswerApiResult & { error?: string };
      if (!res.ok) throw new Error(apiFailureMessage(res, data.error, "prove"));
      setResult(data);
    } catch (e) {
      setErr(
        e instanceof Error && e.name === "AbortError"
          ? "Prove cancelled."
          : e instanceof Error
            ? e.message
            : "Prove failed"
      );
    } finally {
      setBusy(false);
      setLoadingDetail("");
      if (abortRef.current === controller) abortRef.current = null;
    }
  }

  useEffect(() => {
    if (pendingRun !== "prove" || !consumeRun("prove")) return;
    void runProve();
    // This is a one-shot route handoff from the compile form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingRun]);

  return (
    <section className="panel">
      <h2 className="sec">Prove answer parity</h2>
      <p className="sub">
        Same question answered from the full file and from your compiled context — side by side.
        {compile && proveExpandedIds.length > 0
          ? ` Includes ${proveExpandedIds.length} expanded section(s) (+${proveExpandedTokenSum.toLocaleString()} tokens).`
          : " Mark Include in Prove on Results to merge omitted sections."}
      </p>
      {compile && proveStale ? (
        <p className="hostnote">
          Stale compile. <Link href="/workspace">Recompile</Link> before proving.
        </p>
      ) : null}
      {sourceUnavailable ? (
        <p className="hostnote" role="status">
          The source file is no longer available. <Link href="/workspace">Choose it and recompile</Link>.
        </p>
      ) : null}
      {!llmOk ? (
        <p className="hostnote" role="status">
          Prove disabled: {config?.llm_disabled_reason || "no supported LLM API key is configured."}
        </p>
      ) : null}
      <div className="row">
        <button
          className="btn primary"
          type="button"
          disabled={busy || proveStale || sourceUnavailable || !llmOk}
          onClick={() => void runProve()}
        >
          {busy ? "Proving…" : "Prove"}
        </button>
        {busy ? (
          <button className="btn ghost" type="button" onClick={() => abortRef.current?.abort()}>
            Cancel
          </button>
        ) : null}
        <Link className="btn ghost" href={compile ? "/workspace/results" : "/workspace"}>
          {compile ? "Back to results" : "Back to compile"}
        </Link>
      </div>
      {busy ? (
        <div className="loading-banner" role="status" aria-live="polite" aria-busy="true">
          <span className="spinner" aria-hidden="true" />
          <span>
            <strong>Proving answer parity…</strong>
            <small>{loadingDetail}</small>
          </span>
        </div>
      ) : null}
      {err ? (
        <div className="err" role="alert">
          {err}
        </div>
      ) : null}
      {result ? (
        <div
          className="parity-grid"
          style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 20 }}
        >
          <div>
            <p className="alabel">Full file · {result.full.context_tokens.toLocaleString()} tok</p>
            <div className="aanswer" dir="auto">
              {result.full.answer}
            </div>
          </div>
          <div>
            <p className="alabel">
              Compiled · {result.compiled.context_tokens.toLocaleString()} tok ·{" "}
              {result.compiled.reduction_pct}% fewer
              {result.compiled.expanded_ids?.length
                ? ` · includes ${result.compiled.expanded_ids.join(", ")}`
                : ""}
            </p>
            <div className="aanswer" dir="auto">
              {result.compiled.answer}
            </div>
          </div>
          <p className="sub" style={{ gridColumn: "1 / -1" }}>
            Model: {result.model}
          </p>
          {result.compiled.selected_content_tokens != null ? (
            <p className="sub" style={{ gridColumn: "1 / -1" }}>
              Effective Prove context: <strong>{result.compiled.context_tokens.toLocaleString()}</strong>{" "}
              tokens
              {result.compiled.expand_content_tokens
                ? ` (${result.compiled.selected_content_tokens.toLocaleString()} compiled + ${result.compiled.expand_content_tokens.toLocaleString()} expanded)`
                : ""}
              {result.full.context_tokens > 0 &&
              result.compiled.context_tokens / result.full.context_tokens >= 0.9
                ? " · Near full-document size; savings may be marginal."
                : ""}
              {packagingGapNote(
                result.compiled.selected_content_tokens + (result.compiled.expand_content_tokens ?? 0),
                result.compiled.context_tokens
              )
                ? ` · ${packagingGapNote(
                    result.compiled.selected_content_tokens + (result.compiled.expand_content_tokens ?? 0),
                    result.compiled.context_tokens
                  )}. The gap is safety wrappers; the omit manifest is not sent to the model.`
                : ""}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
