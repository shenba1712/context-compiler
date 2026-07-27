"use client";

import Link from "next/link";
import { useState } from "react";

import { useWorkspace } from "@/lib/workspace-context";
import type { AnswerApiResult } from "@/lib/types";

export default function ProvePage() {
  const { file, task, budget, compile, config, proveStale, proveExpandedIds, proveExpandedTokenSum } =
    useWorkspace();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [result, setResult] = useState<AnswerApiResult | null>(null);

  const llmOk = config?.llm_available ?? false;

  async function runProve() {
    setErr("");
    setResult(null);
    if (!file || !compile) {
      setErr("Compile a document first.");
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
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("task", task.trim());
      fd.append("token_budget", String(budget));
      fd.append("expanded_ids", JSON.stringify(proveExpandedIds));
      const res = await fetch("/api/answer", { method: "POST", body: fd });
      const data = (await res.json()) as AnswerApiResult & { error?: string };
      if (!res.ok) throw new Error(data.error || `Prove failed (${res.status})`);
      setResult(data);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Prove failed");
    } finally {
      setBusy(false);
    }
  }

  if (!compile) {
    return (
      <section className="panel">
        <h2 className="sec">Prove answer parity</h2>
        <p className="sub">
          <Link href="/workspace">Compile</Link> first, then compare full-file vs compiled answers.
        </p>
      </section>
    );
  }

  return (
    <section className="panel">
      <h2 className="sec">Prove answer parity</h2>
      <p className="sub">
        Same question answered from the full file and from your compiled context — side by side.
        {proveExpandedIds.length > 0
          ? ` Includes ${proveExpandedIds.length} expanded section(s) (+${proveExpandedTokenSum.toLocaleString()} tokens).`
          : " Mark Include in Prove on Results to merge omitted sections."}
      </p>
      {proveStale ? (
        <p className="hostnote">
          Stale compile. <Link href="/workspace">Recompile</Link> before proving.
        </p>
      ) : null}
      {!file ? (
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
          disabled={busy || proveStale || !file || !llmOk}
          onClick={() => void runProve()}
        >
          {busy ? "Proving…" : "Prove"}
        </button>
        <Link className="btn ghost" href="/workspace/results">
          Back to results
        </Link>
      </div>
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
        </div>
      ) : null}
    </section>
  );
}
