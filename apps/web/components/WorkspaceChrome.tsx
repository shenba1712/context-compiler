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

const activities = steps.slice(1);

const sourceLabels: Record<SourceAvailability, string> = {
  available: "Available",
  restorable: "Restoring sample",
  missing: "Missing file bytes",
  "not-selected": "Not selected",
};

function LegacyWorkspaceChrome({ children, path }: { children: React.ReactNode; path: string }) {
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
      <TaskSummary summary={summary} />
      {children}
    </div>
  );
}

function TaskSummary({ summary }: { summary: ReturnType<typeof selectTaskSummary> }) {
  return (
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
  );
}

function RailWorkspaceChrome({ children, path }: { children: React.ReactNode; path: string }) {
  const workspace = useWorkspace();
  const { compile, workspaceStatus } = workspace;
  const summary = selectTaskSummary(workspace);
  const sourceUnavailable = workspaceStatus.sourceUnavailable;
  const compileLabel = compile ? "Recompile" : "Compile";
  const compileStatus = workspaceStatus.compileAvailable
    ? compile
      ? "Ready when live inputs need a new snapshot"
      : "Ready to compile"
    : summary.live.sourceAvailability === "not-selected"
      ? "Choose a source to continue"
      : !summary.live.taskLabel
        ? "Enter a task to continue"
        : "Source is unavailable";

  const activityAvailable = (href: string) => {
    if (!compile) return false;
    if (href === "/workspace/prove") return !workspaceStatus.proveStale && !sourceUnavailable;
    if (href === "/workspace/agent") return !workspaceStatus.agentStale && !sourceUnavailable;
    return true;
  };

  return (
    <div className="wrap workspace-shell workspace-shell-revamp">
      <aside className="panel workspace-rail" aria-labelledby="workspace-rail-title">
        <div className="workspace-rail-heading">
          <p className="alabel">Workspace</p>
          <h2 id="workspace-rail-title">Live task</h2>
        </div>
        <dl className="workspace-rail-summary" data-testid="live-task-summary">
          <div>
            <dt>Source</dt>
            <dd>{summary.live.documentName ?? "No document"}</dd>
            <dd className="workspace-rail-meta">{sourceLabels[summary.live.sourceAvailability]}</dd>
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
            <dt>Compile freshness</dt>
            <dd>
              {summary.compileStatus === "current"
                ? "Current"
                : summary.compileStatus === "stale"
                  ? "Live edits need compile"
                  : "Not compiled"}
            </dd>
          </div>
        </dl>

        {summary.compiled ? (
          <div className="workspace-rail-snapshot" data-testid="compiled-task-summary">
            <p className="alabel">Compiled snapshot</p>
            <p>{summary.compiled.taskLabel || "No task"}</p>
            <span>{summary.compiled.budget.toLocaleString()} tokens</span>
          </div>
        ) : null}

        <div className="workspace-rail-action">
          <Link className="btn primary" href="/workspace#workspace-compile">
            {compileLabel}
          </Link>
          <p>{compileStatus}</p>
        </div>

        <nav className="workspace-activity-nav" aria-label="Workspace activity">
          <p className="alabel">Activity</p>
          {activities.map((activity) => {
            const active = path === activity.href;
            if (!activityAvailable(activity.href)) {
              return (
                <span key={activity.href} className="workspace-activity-link disabled" aria-disabled="true">
                  {activity.label}
                  <small>Unavailable</small>
                </span>
              );
            }
            return (
              <Link
                key={activity.href}
                href={activity.href}
                className={`workspace-activity-link${active ? " active" : ""}`}
                aria-current={active ? "page" : undefined}
              >
                {activity.label}
                <small>{active ? "Active" : "Available"}</small>
              </Link>
            );
          })}
        </nav>
      </aside>
      <div className="workspace-canvas" role="region" aria-label="Workspace canvas">
        {children}
      </div>
    </div>
  );
}

export function WorkspaceChrome({
  children,
  revampEnabled = false,
}: {
  children: React.ReactNode;
  revampEnabled?: boolean;
}) {
  const path = usePathname();
  return revampEnabled ? (
    <RailWorkspaceChrome path={path}>{children}</RailWorkspaceChrome>
  ) : (
    <LegacyWorkspaceChrome path={path}>{children}</LegacyWorkspaceChrome>
  );
}
