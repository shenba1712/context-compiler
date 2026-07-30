"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { useWorkspace, type WorkspaceRunCapture } from "@/lib/workspace-context";
import type { AnswerApiResult, ProveRunSnapshot } from "@/lib/types";
import { apiFailureMessage, fetchWithBusyRetry, packagingGapNote } from "@/lib/ux";

function freezeResult(result: AnswerApiResult): AnswerApiResult {
  const copy = structuredClone(result);
  Object.freeze(copy.full);
  if (copy.compiled.expanded_ids) Object.freeze(copy.compiled.expanded_ids);
  Object.freeze(copy.compiled);
  return Object.freeze(copy);
}

export default function ProvePage() {
  const {
    file,
    sampleKey,
    task,
    budget,
    compile,
    compiledSnapshot,
    config,
    workspaceStatus,
    proveExpandedIds,
    proveExpandedTokenSum,
    runIntent,
    claimRunIntent,
  } = useWorkspace();
  const [run, setRun] = useState<ProveRunSnapshot | null>(null);
  const [validationError, setValidationError] = useState("");
  const [loadingDetail, setLoadingDetail] = useState("");
  const attemptSeq = useRef(0);
  const activeAttempt = useRef<{ id: string; controller: AbortController } | null>(null);

  const llmOk = config?.llm_available ?? false;
  const { proveStale, sourceUnavailable } = workspaceStatus;
  const busy = run?.status === "running";

  async function runProve(retrySnapshot?: ProveRunSnapshot, intentCapture?: WorkspaceRunCapture<File>) {
    setValidationError("");
    if (!retrySnapshot && !intentCapture) {
      if (!file) {
        setValidationError("Choose a document first.");
        return;
      }
      if (!task.trim()) {
        setValidationError("Enter a question first.");
        return;
      }
      if (proveStale) {
        setValidationError("Task or budget changed — recompile first.");
        return;
      }
      if (!llmOk) {
        setValidationError("This host has no LLM API key. Prove is disabled.");
        return;
      }
    } else if (!llmOk) {
      setValidationError("This host has no LLM API key. Prove is disabled.");
      return;
    }

    const sourceFile = retrySnapshot?.sourceFile ?? intentCapture?.sourceFile ?? file;
    if (!sourceFile) {
      setValidationError("Choose a document first.");
      return;
    }

    const attemptNumber = ++attemptSeq.current;
    const id = `prove-${Date.now()}-${attemptNumber}`;
    const submittedAt = new Date().toISOString();
    const expandedIds = retrySnapshot
      ? retrySnapshot.expandedIds
      : intentCapture
        ? intentCapture.expandedIds
        : Object.freeze(compile ? [...proveExpandedIds] : []);
    const source = retrySnapshot
      ? retrySnapshot.source
      : (intentCapture?.source ??
        Object.freeze({
          documentName: compiledSnapshot?.documentName ?? sourceFile.name,
          sampleKey,
          size: sourceFile.size,
          type: sourceFile.type,
          lastModified: sourceFile.lastModified,
        }));
    const runningSnapshot: ProveRunSnapshot = Object.freeze({
      id,
      retryOf: retrySnapshot?.id ?? null,
      task: retrySnapshot?.task ?? intentCapture?.task ?? task.trim(),
      budget: retrySnapshot?.budget ?? intentCapture?.budget ?? budget,
      compileHandle: retrySnapshot
        ? retrySnapshot.compileHandle
        : intentCapture
          ? intentCapture.compileHandle
          : (compile?.handle ?? null),
      expandedIds,
      expandedTokenSum:
        retrySnapshot?.expandedTokenSum ??
        intentCapture?.expandedTokenSum ??
        (compile && expandedIds.length ? proveExpandedTokenSum : 0),
      source,
      sourceFile,
      status: "running",
      result: null,
      error: null,
      submittedAt,
      completedAt: null,
    });

    const controller = new AbortController();
    activeAttempt.current?.controller.abort();
    activeAttempt.current = { id, controller };
    setRun(runningSnapshot);
    setLoadingDetail("Asking the model twice: full file vs your budgeted compile.");
    try {
      const fd = new FormData();
      fd.append("file", runningSnapshot.sourceFile);
      fd.append("task", runningSnapshot.task);
      fd.append("token_budget", String(runningSnapshot.budget));
      if (runningSnapshot.expandedIds.length) {
        fd.append("expanded_ids", JSON.stringify(runningSnapshot.expandedIds));
      }
      const res = await fetchWithBusyRetry(
        "/api/answer",
        { method: "POST", body: fd, signal: controller.signal },
        () => {
          if (activeAttempt.current?.id === id) setLoadingDetail("Server busy — retrying once…");
        }
      );
      const data = (await res.json()) as AnswerApiResult & { error?: string };
      if (!res.ok) throw new Error(apiFailureMessage(res, data.error, "prove"));
      if (activeAttempt.current?.id !== id || controller.signal.aborted) return;
      setRun(
        Object.freeze({
          ...runningSnapshot,
          status: "succeeded",
          result: freezeResult(data),
          completedAt: new Date().toISOString(),
        })
      );
    } catch (e) {
      if (activeAttempt.current?.id !== id) return;
      const cancelled = e instanceof Error && e.name === "AbortError";
      setRun(
        Object.freeze({
          ...runningSnapshot,
          status: cancelled ? "cancelled" : "failed",
          error: cancelled ? "Prove cancelled." : e instanceof Error ? e.message : "Prove failed",
          completedAt: new Date().toISOString(),
        })
      );
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
            error: "Prove cancelled.",
            completedAt: new Date().toISOString(),
          })
        : current
    );
  }

  useEffect(
    () => () => {
      activeAttempt.current?.controller.abort();
      activeAttempt.current = null;
    },
    []
  );

  useEffect(() => {
    if (!runIntent || runIntent.kind !== "prove") return;
    const claim = claimRunIntent(runIntent.id, "prove");
    if (!claim.intent) {
      if (claim.error) setValidationError(claim.error);
      return;
    }
    void runProve(undefined, claim.intent.capture);
    // The exact intent id is claimed once; history navigation cannot replay it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runIntent?.id]);

  return (
    <section className="panel">
      <h2 className="sec">Prove answer parity</h2>
      <p className="sub">
        Same question answered from the full file and from your compiled context — side by side.
        {(run?.expandedIds.length ?? (compile ? proveExpandedIds.length : 0)) > 0
          ? ` Includes ${(run?.expandedIds.length ?? proveExpandedIds.length).toLocaleString()} expanded section(s) (+${(
              run?.expandedTokenSum ?? proveExpandedTokenSum
            ).toLocaleString()} tokens).`
          : " Mark Include in Prove on Results to merge omitted sections."}
      </p>
      {run ? (
        <div className="hostnote" data-testid="prove-run-snapshot">
          <strong>Submitted snapshot:</strong> “{run.task}” · {run.budget.toLocaleString()} token budget ·{" "}
          {run.source.documentName}
          {run.compileHandle ? ` · compile ${run.compileHandle}` : ""}
          {run.expandedIds.length ? ` · includes ${run.expandedIds.join(", ")}` : ""}
        </div>
      ) : null}
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
          {busy ? "Proving…" : run ? "Prove again" : "Prove"}
        </button>
        {busy ? (
          <button className="btn ghost" type="button" onClick={cancelRun}>
            Cancel
          </button>
        ) : null}
        {run && (run.status === "failed" || run.status === "cancelled") ? (
          <button className="btn ghost" type="button" disabled={!llmOk} onClick={() => void runProve(run)}>
            Retry submitted snapshot
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
      {validationError || run?.error ? (
        <div className="err" role="alert">
          {validationError || run?.error}
        </div>
      ) : null}
      {run?.result ? (
        <div
          className="parity-grid"
          style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 20 }}
        >
          <div>
            <p className="alabel">Full file · {run.result.full.context_tokens.toLocaleString()} tok</p>
            <div className="aanswer" dir="auto">
              {run.result.full.answer}
            </div>
          </div>
          <div>
            <p className="alabel">
              Compiled · {run.result.compiled.context_tokens.toLocaleString()} tok ·{" "}
              {run.result.compiled.reduction_pct}% fewer
              {run.result.compiled.expanded_ids?.length
                ? ` · includes ${run.result.compiled.expanded_ids.join(", ")}`
                : ""}
            </p>
            <div className="aanswer" dir="auto">
              {run.result.compiled.answer}
            </div>
          </div>
          <p className="sub" style={{ gridColumn: "1 / -1" }}>
            Model: {run.result.model}
          </p>
          {run.result.compiled.selected_content_tokens != null ? (
            <p className="sub" style={{ gridColumn: "1 / -1" }}>
              Effective Prove context: <strong>{run.result.compiled.context_tokens.toLocaleString()}</strong>{" "}
              tokens
              {run.result.compiled.expand_content_tokens
                ? ` (${run.result.compiled.selected_content_tokens.toLocaleString()} compiled + ${run.result.compiled.expand_content_tokens.toLocaleString()} expanded)`
                : ""}
              {run.result.full.context_tokens > 0 &&
              run.result.compiled.context_tokens / run.result.full.context_tokens >= 0.9
                ? " · Near full-document size; savings may be marginal."
                : ""}
              {packagingGapNote(
                run.result.compiled.selected_content_tokens +
                  (run.result.compiled.expand_content_tokens ?? 0),
                run.result.compiled.context_tokens
              )
                ? ` · ${packagingGapNote(
                    run.result.compiled.selected_content_tokens +
                      (run.result.compiled.expand_content_tokens ?? 0),
                    run.result.compiled.context_tokens
                  )}. The gap is safety wrappers; the omit manifest is not sent to the model.`
                : ""}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
