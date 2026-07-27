import type { Metadata } from "next";
import { WorkspaceProvider } from "@/lib/workspace-context";
import { SiteHeader } from "@/components/SiteHeader";
import "./globals.css";

export const metadata: Metadata = {
  title: "Context Compiler: stop paying for pages your agent doesn't read",
  description: "Task-aware, token-budgeted file-to-markdown compiler for AI agents. MCP + hosted workspace.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;1,9..40,400&family=Fraunces:opsz,wght@9..144,600;9..144,700&family=IBM+Plex+Mono:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <a className="skip-link" href="#main-content">
          Skip to main content
        </a>
        <WorkspaceProvider>
          <SiteHeader />
          <main id="main-content" className="page-main" tabIndex={-1}>
            {children}
          </main>
          <footer className="site-footer">
            <div className="wrap">
              Context Compiler · team <strong>3 Percent (Shenbaga Lakshmi Srinivasan)</strong> ·{" "}
              <a href="https://github.com/shenba1712/context-compiler">source &amp; docs on GitHub</a>
            </div>
          </footer>
        </WorkspaceProvider>
      </body>
    </html>
  );
}
