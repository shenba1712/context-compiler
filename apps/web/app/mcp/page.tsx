"use client";

import { useState } from "react";

export default function McpPage() {
  const [copied, setCopied] = useState("");
  const snippets = {
    codex: `[mcp_servers.context-compiler]
command = "node"
args = ["/absolute/path/to/context-compiler/dist/mcp/server.js"]

[mcp_servers.context-compiler.env]
CC_ROOT = "/absolute/path/agents/may/read"`,
    json: `{
  "mcpServers": {
    "context-compiler": {
      "command": "node",
      "args": ["/absolute/path/to/context-compiler/dist/mcp/server.js"],
      "env": { "CC_ROOT": "/absolute/path/agents/may/read" }
    }
  }
}`,
    claude:
      "claude mcp add context-compiler -- node /absolute/path/to/context-compiler/dist/mcp/server.js",
  } as const;

  async function copy(key: keyof typeof snippets) {
    try {
      await navigator.clipboard.writeText(snippets[key]);
      setCopied(key);
      window.setTimeout(() => setCopied((current) => (current === key ? "" : current)), 1400);
    } catch {
      setCopied("failed");
    }
  }

  return (
    <div className="wrap" style={{ padding: "40px 20px 80px" }}>
      <section className="panel">
        <h2 className="sec">MCP — plug into your agent</h2>
        <p className="sub">
          Two tools: <code>compile_context</code> and <code>expand_section</code>. Compile never needs an API
          key. Your IDE agent reads the omit manifest and expands when needed.
        </p>
        <p className="hostnote">
          This repository package is private, so build the checkout with <code>npm run build</code> and point
          clients at the local <code>dist/mcp/server.js</code>. It is not an npm install command.
        </p>
        {(
          [
            ["codex", "OpenAI Codex", "~/.codex/config.toml"],
            ["json", "Cursor / Claude Desktop", "JSON MCP config"],
            ["claude", "Claude Code", "one command"],
          ] as const
        ).map(([key, label, path]) => (
          <div className="mcp-config" key={key}>
            <div className="config-heading">
              <span>
                <strong>{label}</strong> <small>{path}</small>
              </span>
              <button className="copybtn" type="button" onClick={() => void copy(key)}>
                {copied === key ? "copied" : copied === "failed" ? "copy failed" : "copy"}
              </button>
            </div>
            <pre className="aanswer">{snippets[key]}</pre>
          </div>
        ))}
        <p className="sub" style={{ marginTop: 16 }}>
          Recommended loop: compile under a budget → read the manifest → expand named misses → answer. See the
          repo README and ARCHITECTURE for contracts.
        </p>
        <p className="row">
          <a
            className="btn primary"
            href="https://github.com/shenba1712/context-compiler"
            target="_blank"
            rel="noopener noreferrer"
          >
            View on GitHub
          </a>
          <a className="btn ghost" href="/workspace">
            Open workspace
          </a>
        </p>
      </section>
    </div>
  );
}
