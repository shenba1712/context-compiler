#!/usr/bin/env node
/**
 * MCP server (stdio): compile_context + expand_section.
 * Path access restricted to CC_ROOT (default: user home).
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { z } from "zod";

import { ConversionError } from "./convert.js";
import { checkPathWithin } from "./path-guard.js";
import { compileContext, expandSection } from "./pipeline.js";

const ROOT = resolve(process.env.CC_ROOT ?? homedir());

const checkPath = (filePath: string): string => checkPathWithin(ROOT, filePath);

const clampBudget = (n: number, lo: number) => Math.max(lo, Math.min(Math.trunc(n), 200_000));

const server = new McpServer({ name: "context-compiler", version: "0.1.0" });

server.tool(
  "compile_context",
  "Convert a file (pdf/docx/xlsx/pptx/html/csv/images/...) to markdown containing only " +
    "the sections relevant to `task`, fitted under `token_budget` tokens. Prefer this " +
    "over reading a large file directly. Returns JSON with compiled markdown, token " +
    "stats, and a manifest of omitted sections (fetchable via expand_section).",
  {
    file_path: z.string(),
    task: z.string(),
    token_budget: z.number().int().default(4000),
  },
  async ({ file_path, task, token_budget }) => {
    try {
      const path = checkPath(file_path);
      const result = await compileContext(path, task, clampBudget(token_budget, 500));
      // Section text already lives inside `markdown`; strip the duplicate
      // copies so the MCP payload isn't double-sized.
      result.selected_sections = result.selected_sections.map(({ text: _t, ...r }) => r);
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    } catch (e) {
      const msg = e instanceof ConversionError || e instanceof Error ? e.message : String(e);
      return { content: [{ type: "text", text: JSON.stringify({ error: msg }) }] };
    }
  }
);

server.tool(
  "expand_section",
  "Fetch one section of a previously compiled file by section id " +
    "(ids appear in compile_context's omitted-sections manifest).",
  {
    file_path: z.string(),
    section_id: z.string(),
    token_budget: z.number().int().default(2000),
  },
  async ({ file_path, section_id, token_budget }) => {
    try {
      const path = checkPath(file_path);
      const result = await expandSection(path, section_id, clampBudget(token_budget, 200));
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { content: [{ type: "text", text: JSON.stringify({ error: msg }) }] };
    }
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
