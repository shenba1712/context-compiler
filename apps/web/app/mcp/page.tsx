export default function McpPage() {
  const snippet = `{
  "mcpServers": {
    "context-compiler": {
      "command": "node",
      "args": ["/absolute/path/to/context-compiler/dist/mcp/server.js"],
      "env": { "CC_ROOT": "/absolute/path/to/docs" }
    }
  }
}`;

  return (
    <div className="wrap" style={{ padding: "40px 20px 80px" }}>
      <section className="panel">
        <h2 className="sec">MCP — plug into your agent</h2>
        <p className="sub">
          Two tools: <code>compile_context</code> and <code>expand_section</code>. Compile never needs an API
          key. Your IDE agent reads the omit manifest and expands when needed.
        </p>
        <p className="alabel">Cursor / Claude / Codex-style config</p>
        <pre
          className="aanswer"
          style={{ fontFamily: "IBM Plex Mono, ui-monospace, monospace", fontSize: 13 }}
        >
          {snippet}
        </pre>
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
