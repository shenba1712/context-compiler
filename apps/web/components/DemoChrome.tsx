"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { useDemo } from "@/lib/demo-context";

const steps = [
  { href: "/demo", label: "Compile", need: false },
  { href: "/demo/results", label: "Results", need: true },
  { href: "/demo/prove", label: "Prove", need: true },
  { href: "/demo/agent", label: "Agent", need: true },
];

export function DemoChrome({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const { compile } = useDemo();
  return (
    <div className="wrap demo-shell">
      <nav className="demo-steps" aria-label="Demo steps">
        {steps.map((s) => {
          const disabled = s.need && !compile;
          const active = path === s.href;
          if (disabled) {
            return (
              <span key={s.href} className="demo-step disabled" aria-disabled="true">
                {s.label}
              </span>
            );
          }
          return (
            <Link key={s.href} href={s.href} className={`demo-step${active ? " active" : ""}`}>
              {s.label}
            </Link>
          );
        })}
      </nav>
      {children}
    </div>
  );
}
