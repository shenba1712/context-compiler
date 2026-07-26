"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { useWorkspace } from "@/lib/workspace-context";

const steps = [
  { href: "/workspace", label: "Compile", need: false },
  { href: "/workspace/results", label: "Results", need: true },
  { href: "/workspace/prove", label: "Prove", need: true },
  { href: "/workspace/agent", label: "Agent", need: true },
];

export function WorkspaceChrome({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const { compile } = useWorkspace();
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
            <Link key={s.href} href={s.href} className={`workspace-step${active ? " active" : ""}`}>
              {s.label}
            </Link>
          );
        })}
      </nav>
      {children}
    </div>
  );
}
