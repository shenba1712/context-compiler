"use client";

import { TaskEditor } from "@/components/TaskEditor";
import { useWorkspace } from "@/lib/workspace-context";

export default function WorkspaceCompilePage() {
  const { config } = useWorkspace();
  const pool = config?.rate_limit ?? 100;
  const windowMin = config?.rate_window_minutes ?? 5;

  return (
    <section id="workspace-compile" tabIndex={-1}>
      <div className="panel">
        <h2 className="sec">Compile a document</h2>
        <p className="sub">Choose a source, ask a focused question, and set the context ceiling.</p>
        <TaskEditor />

        <div className="workspace-host-guidance">
          <p className="hostnote" role="note">
            Free-tier hosts may sleep when idle — first load can take <strong>30–60 seconds</strong>.
          </p>

          <details className="expectbox">
            <summary>What to expect on this host</summary>
            <div className="expectbody">
              <ul>
                <li>
                  Compile and expand share a pool of about <strong>{pool}</strong> points every{" "}
                  <strong>{windowMin}</strong> minutes per IP.
                </li>
                <li>
                  Prove / Agent need an LLM key on the server
                  {config
                    ? config.llm_available
                      ? " (available here)."
                      : ` (${config.llm_disabled_reason || "not configured here"}).`
                    : "."}
                </li>
                <li>
                  Prove costs <strong>{config?.rate_cost_answer ?? 4}</strong> points (about{" "}
                  <strong>{Math.max(1, Math.floor(pool / (config?.rate_cost_answer ?? 4)))}</strong> runs per
                  window); Agent costs <strong>{config?.rate_cost_agent ?? 12}</strong> (about{" "}
                  <strong>{Math.max(1, Math.floor(pool / (config?.rate_cost_agent ?? 12)))}</strong>).
                </li>
                <li>
                  Full-file comparisons cap context at about{" "}
                  <strong>{(config?.answer_context_cap ?? 60_000).toLocaleString()}</strong> tokens; at most{" "}
                  <strong>{config?.max_concurrent_llm ?? 2}</strong> LLM jobs run concurrently.
                </li>
              </ul>
            </div>
          </details>
        </div>
      </div>
    </section>
  );
}
