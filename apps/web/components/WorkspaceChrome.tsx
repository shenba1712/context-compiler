"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { selectTaskSummary, type SourceAvailability } from "@/lib/task-summary";
import { useWorkspace } from "@/lib/workspace-context";

const steps = [
  { href: "/workspace", label: "Compile", need: false },
  { href: "/workspace/results", label: "Results", need: true },
  { href: "/workspace/prove", label: "Prove", need: true },
  { href: "/workspace/agent", label: "Agent", need: true },
];

const sourceLabels: Record<SourceAvailability, string> = {
  available: "Available",
  restorable: "Restoring sample",
  missing: "Missing file bytes",
  "not-selected": "Not selected",
};

export function WorkspaceChrome({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const workspace = useWorkspace();
  const { compile } = workspace;
  const summary = selectTaskSummary(workspace);
  return (
    <div className="wrap workspace-shell">
      <nav className="workspace-steps" aria-label="Workspace steps">
        {steps.map((s) => {
          const disabled = s.need && !compile;
          const active = path === s.href;
          if (disabled) {
            return (
              <span key={s.href} className="workspace-step disabled" aria-disabled="true">
                {s.label}
              </span>
            );
          }
          return (
            <Link
              key={s.href}
              href={s.href}
              className={`workspace-step${active ? " active" : ""}`}
              aria-current={active ? "step" : undefined}
            >
              {s.label}
            </Link>
          );
        })}
      </nav>
      <aside className="task-summary" aria-labelledby="task-summary-title">
        <div className="task-summary-heading">
          <h2 id="task-summary-title">Task summary</h2>
          <span className={`task-summary-status ${summary.compileStatus}`}>
            {summary.compileStatus === "current"
              ? "Compiled"
              : summary.compileStatus === "stale"
                ? "Compiled · live edits"
                : "Not compiled"}
          </span>
        </div>
        <div className="task-summary-grid">
          <section className="task-summary-view" data-testid="live-task-summary">
            <h3>Live task</h3>
            <dl>
              <div>
                <dt>Document</dt>
                <dd>{summary.live.documentName ?? "No document"}</dd>
              </div>
              <div>
                <dt>Task</dt>
                <dd>{summary.live.taskLabel || "No task"}</dd>
              </div>
              <div>
                <dt>Budget</dt>
                <dd>{summary.live.budget.toLocaleString()} tokens</dd>
              </div>
              <div>
                <dt>Source</dt>
                <dd>{sourceLabels[summary.live.sourceAvailability]}</dd>
              </div>
            </dl>
          </section>
          {summary.compiled ? (
            <section className="task-summary-view compiled" data-testid="compiled-task-summary">
              <h3>Compiled snapshot</h3>
              <dl>
                <div>
                  <dt>Document</dt>
                  <dd>{summary.compiled.documentName ?? "No document"}</dd>
                </div>
                <div>
                  <dt>Task</dt>
                  <dd>{summary.compiled.taskLabel || "No task"}</dd>
                </div>
                <div>
                  <dt>Budget</dt>
                  <dd>{summary.compiled.budget.toLocaleString()} tokens</dd>
                </div>
                <div>
                  <dt>Source</dt>
                  <dd>{sourceLabels[summary.compiled.sourceAvailability]}</dd>
                </div>
              </dl>
            </section>
          ) : null}
        </div>
      </aside>
      {children}
    </div>
  );
}
