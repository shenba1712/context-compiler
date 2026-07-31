"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { TaskEditor } from "@/components/TaskEditor";
import { selectTaskSummary } from "@/lib/task-summary";
import { useWorkspace } from "@/lib/workspace-context";

const activities = [
  { href: "/workspace/results", label: "Results" },
  { href: "/workspace/prove", label: "Prove" },
  { href: "/workspace/agent", label: "Agent" },
];

function WorkspaceRail({ children, path }: { children: React.ReactNode; path: string }) {
  const workspace = useWorkspace();
  const { budget, compile, file, filePicked, task, workspaceStatus } = workspace;
  const summary = selectTaskSummary(workspace);
  const sourceUnavailable = workspaceStatus.sourceUnavailable;
  const isCreate = path === "/workspace";

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
        <div data-testid="live-task-summary">
          {isCreate ? (
            <div className="workspace-create-summary">
              <div>
                <span className="alabel">Source</span>
                <strong>{filePicked || "Choose a document"}</strong>
              </div>
              <div>
                <span className="alabel">Question</span>
                <strong>{task.trim() || "Describe what you need"}</strong>
              </div>
              <div>
                <span className="alabel">Budget</span>
                <strong>{budget.toLocaleString()} tokens</strong>
              </div>
              <button
                className="btn primary"
                type="submit"
                form="workspace-task-form"
                disabled={!file || !task.trim()}
              >
                Compile task
              </button>
              <a className="workspace-edit-link" href="#workspace-task-form">
                Edit task in canvas
              </a>
            </div>
          ) : (
            <TaskEditor compact />
          )}
        </div>

        {summary.compiled ? (
          <div className="workspace-rail-snapshot" data-testid="compiled-task-summary">
            <p className="alabel">Compiled snapshot</p>
            <p>{summary.compiled.taskLabel || "No task"}</p>
            <span>{summary.compiled.budget.toLocaleString()} tokens</span>
            <span>{summary.compileStatus === "current" ? " · Current" : " · Live edits need compile"}</span>
          </div>
        ) : null}

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

export function WorkspaceChrome({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  return <WorkspaceRail path={path}>{children}</WorkspaceRail>;
}
