export type McpTextResult = {
  isError: true;
  content: [{ type: "text"; text: string }];
};

/** Keep tool failures machine-detectable while preserving the JSON error body. */
export function mcpToolError(error: unknown): McpTextResult {
  const message = error instanceof Error ? error.message : String(error);
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify({ error: message }) }],
  };
}
