#!/usr/bin/env node
/**
 * MCP server (stdio): exposes compile_context + expand_section.
 * Only files inside CC_ROOT (default: the user's home folder) can be read.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { z } from "zod";

import { BUDGET_FLOORS, DEFAULT_TOKEN_BUDGET, clampBudget } from "./config.js";
import { ConversionError } from "./convert.js";
import { checkPathWithin } from "./path-guard.js";
import { compileContext, expandSection } from "./pipeline.js";

const ROOT = resolve(process.env.CC_ROOT ?? homedir());

const checkPath = (filePath: string): string => checkPathWithin(ROOT, filePath);

const server = new McpServer({ name: "context-compiler", version: "0.1.0" });

server.registerTool(
  "compile_context",
  {
    description:
      "Convert a file (pdf/docx/xlsx/pptx/html/csv/...) to markdown with only the " +
      "sections relevant to `task`. `token_budget` is a hard ceiling on selected " +
      "content tokens (`tokens_used` / `selected_content_tokens`) — not a fill quota, " +
      "and not the size of the returned markdown (omit-manifest lines are UX metadata " +
      "and may push wire size above the ceiling). Prefer this over reading a large " +
      "file directly. Returns JSON with compiled markdown, token stats, and omitted " +
      "section ids (fetchable via expand_section).",
    inputSchema: {
      file_path: z.string(),
      task: z.string(),
      token_budget: z.number().int().default(DEFAULT_TOKEN_BUDGET),
    },
  },
  async ({ file_path, task, token_budget }) => {
    try {
      const path = checkPath(file_path);
      const result = await compileContext(path, task, clampBudget(token_budget, BUDGET_FLOORS.mcpCompile));
      // The section text is already in `markdown` — drop the duplicate
      // copies here so the response isn't twice as large as it needs to be.
      result.selected_sections = result.selected_sections.map(({ text: _t, ...r }) => r);
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    } catch (e) {
      const msg = e instanceof ConversionError || e instanceof Error ? e.message : String(e);
      return { content: [{ type: "text", text: JSON.stringify({ error: msg }) }] };
    }
  }
);

server.registerTool(
  "expand_section",
  {
    description:
      "Fetch one section of a previously compiled file by section id " +
      "(ids appear in compile_context's omitted-sections manifest).",
    inputSchema: {
      file_path: z.string(),
      section_id: z.string(),
      token_budget: z.number().int().default(2000),
    },
  },
  async ({ file_path, section_id, token_budget }) => {
    try {
      const path = checkPath(file_path);
      const result = await expandSection(
        path,
        section_id,
        clampBudget(token_budget, BUDGET_FLOORS.mcpExpand)
      );
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { content: [{ type: "text", text: JSON.stringify({ error: msg }) }] };
    }
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
