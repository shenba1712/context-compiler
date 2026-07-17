/**
 * Heading-aware markdown chunking.
 * - Chunks carry their full heading breadcrumb ("Contract > Termination > ...").
 * - Tables are atomic: a boundary never lands inside a table.
 * - Oversized heading-less sections split on paragraph boundaries.
 */
import { countTokens } from "./tokens.js";

export const MAX_CHUNK_TOKENS = 800;
const HEADING_RE = /^(#{1,6})\s+(.*)$/;

export interface Chunk {
  id: string;
  breadcrumb: string;
  text: string;
  order: number;
  tokens: number;
}

function isTableLine(line: string): boolean {
  const s = line.trim();
  return s.startsWith("|") && s.endsWith("|") && (s.match(/\|/g) ?? []).length >= 2;
}

/** Split lines into paragraph blocks; a table is a single block. */
function splitBlocks(lines: string[]): string[][] {
  const blocks: string[][] = [];
  let current: string[] = [];
  let inTable = false;
  for (const line of lines) {
    const tableLine = isTableLine(line);
    if (tableLine && !inTable) {
      if (current.length) blocks.push(current);
      current = [line];
      inTable = true;
    } else if (inTable && !tableLine && line.trim()) {
      blocks.push(current);
      current = [line];
      inTable = false;
    } else if (!line.trim() && !inTable) {
      if (current.length) blocks.push(current);
      current = [];
    } else {
      current.push(line);
    }
  }
  if (current.length) blocks.push(current);
  return blocks;
}

/** Greedily merge blocks into texts under `limit` tokens (tables atomic). */
function packBlocks(blocks: string[][], limit: number): string[] {
  const out: string[] = [];
  let buf: string[] = [];
  let bufTokens = 0;
  for (const block of blocks) {
    const text = block.join("\n");
    const t = countTokens(text);
    if (buf.length && bufTokens + t > limit) {
      out.push(buf.join("\n\n"));
      buf = [];
      bufTokens = 0;
    }
    buf.push(text);
    bufTokens += t;
  }
  if (buf.length) out.push(buf.join("\n\n"));
  return out;
}

export function chunkMarkdown(markdown: string): Chunk[] {
  const lines = markdown.split(/\r?\n/);

  interface Section { trail: string[]; headingLine: string | null; body: string[] }
  const sections: Section[] = [];
  const trail: Array<{ level: number; title: string }> = [];
  let body: string[] = [];
  let currentHeading: string | null = null;
  let currentTrail: string[] = [];

  const flush = () => {
    if (currentHeading !== null || body.some((l) => l.trim())) {
      sections.push({ trail: [...currentTrail], headingLine: currentHeading, body: [...body] });
    }
  };

  for (const line of lines) {
    const m = HEADING_RE.exec(line);
    if (m) {
      flush();
      body = [];
      const level = m[1].length;
      const title = m[2].trim();
      while (trail.length && trail[trail.length - 1].level >= level) trail.pop();
      trail.push({ level, title });
      currentTrail = trail.map((t) => t.title);
      currentHeading = line;
    } else {
      body.push(line);
    }
  }
  flush();

  const chunks: Chunk[] = [];
  let order = 0;
  const push = (breadcrumb: string, text: string) => {
    chunks.push({ id: `s${order}`, breadcrumb, text, order, tokens: countTokens(text) });
    order += 1;
  };

  for (const { trail: trailTitles, headingLine, body: bodyLines } of sections) {
    const breadcrumb = trailTitles.length ? trailTitles.join(" > ") : "(no heading)";
    const header = headingLine ? headingLine + "\n" : "";
    const bodyText = bodyLines.join("\n").trim();
    const full = (header + bodyText).trim();
    if (!full) continue;
    if (countTokens(full) <= MAX_CHUNK_TOKENS) {
      push(breadcrumb, full);
    } else {
      const parts = packBlocks(splitBlocks(bodyLines), MAX_CHUNK_TOKENS);
      parts.forEach((part, i) => {
        // Heading line attaches to the first part; breadcrumbs cover the rest.
        push(breadcrumb, i === 0 ? (header + part).trim() : part.trim());
      });
    }
  }
  return chunks;
}

export function outline(chunks: Chunk[]): Array<{ id: string; section: string; tokens: number }> {
  return chunks.map((c) => ({ id: c.id, section: c.breadcrumb, tokens: c.tokens }));
}
