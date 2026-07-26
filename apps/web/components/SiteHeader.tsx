"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/", label: "Home" },
  { href: "/demo", label: "Demo" },
  { href: "/mcp", label: "MCP" },
];

export function SiteHeader() {
  const path = usePathname();
  return (
    <header className="site-nav">
      <div className="wrap site-nav-inner">
        <Link href="/" className="site-nav-brand">
          Context <span>Compiler</span>
        </Link>
        <nav aria-label="Primary">
          {links.map((l) => (
            <Link key={l.href} href={l.href} className={path === l.href || (l.href !== "/" && path.startsWith(l.href)) ? "active" : ""}>
              {l.label}
            </Link>
          ))}
          <a href="https://github.com/shenba1712/context-compiler" target="_blank" rel="noopener noreferrer">
            Code
          </a>
        </nav>
      </div>
    </header>
  );
}
