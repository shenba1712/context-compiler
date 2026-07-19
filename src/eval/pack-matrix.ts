/**
 * Coverage-first pack matrix — samples × questions × budgets.
 * Reports section counts, id stability, whole-doc dumps, and early_stop.
 *
 * Run: npm run build && node --eval "import('./dist/eval/pack-matrix.js').then(m=>m.printPackMatrix())"
 * (CLI prints on stderr so MCP stdout stays clean.)
 */
import { existsSync } from "node:fs";
import { join } from "node:path";

import { compileContext } from "../pipeline.js";
import { SAMPLES_MANIFEST } from "../samples-manifest.js";

const BUDGETS = [400, 1000, 4000, 8000] as const;

export interface MatrixCell {
  budget: number;
  raw_tokens: number;
  tokens_used: number;
  selected: number;
  total_sections: number;
  ids: string;
  whole_doc: boolean;
  early_stopped: boolean;
  short_circuit: boolean;
}

export interface MatrixRow {
  sample: string;
  question: string;
  kind: "pointed" | "vague";
  cells: MatrixCell[];
  stable_ids: boolean;
}

/** Vague meta-questions — must not whole-doc dump (recall insurance). */
const VAGUE_QUESTIONS: Record<string, string> = {
  lt: "What is the story about?",
  hi: "यह किताब किस बारे में है?",
  es: "¿De qué trata este libro?",
  ru: "О чём эта книга?",
  hq: "عن ماذا تتحدث هذه القصص؟",
};

/** Pointed overrides when the first manifest question is not the sharpest probe. */
const POINTED_OVERRIDES: Record<string, string> = {
  ar: "What revenue guidance does Meridian give for FY 2026?",
  km: "What does the K2 warranty not cover?",
  fin: "What was net profit in FY25?",
  pp: "What does Mr. Bingley think of Jane Bennet early on?",
  sh: "Why does the King of Bohemia come to Sherlock Holmes?",
  og: "What is natural selection?",
  pd: "What is the total addressable market?",
};

function pickPointed(key: string, manifestQ: string[]): string {
  return POINTED_OVERRIDES[key] ?? manifestQ[0] ?? "Summarize this document.";
}

async function runOne(
  samplesDir: string,
  key: string,
  file: string,
  nm: string,
  kind: "pointed" | "vague",
  question: string
): Promise<MatrixRow | null> {
  const path = join(samplesDir, file);
  if (!existsSync(path)) return null;

  const cells: MatrixCell[] = [];
  for (const budget of BUDGETS) {
    const r = await compileContext(path, question, budget, nm);
    const total = r.selected_sections.length + r.omitted_sections.length;
    const ids = r.selected_sections.map((s) => s.id).join(",");
    const wholeDoc = total > 0 && r.selected_sections.length >= total;
    cells.push({
      budget,
      raw_tokens: r.raw_tokens,
      tokens_used: r.tokens_used,
      selected: r.selected_sections.length,
      total_sections: total,
      ids,
      whole_doc: wholeDoc,
      early_stopped: r.compile_hints?.early_stopped ?? false,
      short_circuit: r.raw_tokens <= budget && r.reduction_pct === 0 && wholeDoc,
    });
  }

  const base = cells.find((c) => c.budget === 1000) ?? cells[0];
  const baseSel = base?.selected ?? 99;
  const stable =
    !!base && cells.every((c) => c.budget <= 1000 || c.ids === base.ids || c.selected <= baseSel + 2);

  return { sample: key, question, kind, cells, stable_ids: stable };
}

export async function runPackMatrix(samplesDir: string): Promise<MatrixRow[]> {
  const rows: MatrixRow[] = [];

  for (const meta of SAMPLES_MANIFEST) {
    const pointed = await runOne(
      samplesDir,
      meta.key,
      meta.file,
      meta.nm,
      "pointed",
      pickPointed(meta.key, meta.q)
    );
    if (pointed) rows.push(pointed);

    const vagueQ = VAGUE_QUESTIONS[meta.key];
    if (vagueQ) {
      const vague = await runOne(samplesDir, meta.key, meta.file, meta.nm, "vague", vagueQ);
      if (vague) rows.push(vague);
    }
  }

  return rows;
}

export function summarizePackMatrix(rows: MatrixRow[]): string {
  const lines: string[] = [];
  let wholeDocCount = 0;
  let shortCircuitCount = 0;
  let unstableCount = 0;

  for (const row of rows) {
    const flags = row.cells
      .map((c) => {
        if (c.whole_doc) wholeDocCount++;
        if (c.short_circuit) shortCircuitCount++;
        const tag = [
          c.whole_doc ? "WHOLE" : "",
          c.short_circuit ? "SHORT" : "",
          c.early_stopped ? "STOP" : "",
        ]
          .filter(Boolean)
          .join("+");
        return `@${c.budget}:${c.selected}/${c.total_sections}${tag ? `[${tag}]` : ""}`;
      })
      .join(" ");
    if (!row.stable_ids) unstableCount++;
    const label = `${row.sample}/${row.kind}`.padEnd(12);
    lines.push(`${label} ${flags}${row.stable_ids ? "" : " UNSTABLE"}`);
  }

  lines.push("");
  lines.push(
    `whole_doc=${wholeDocCount} short_circuit=${shortCircuitCount} unstable_rows=${unstableCount}/${rows.length}`
  );
  return lines.join("\n");
}

export function formatPackMatrixDetail(rows: MatrixRow[]): string {
  const parts: string[] = [summarizePackMatrix(rows)];
  for (const row of rows) {
    parts.push(
      `\n${row.sample}/${row.kind}: ${row.question.slice(0, 60)}${row.question.length > 60 ? "…" : ""}`
    );
    for (const c of row.cells) {
      parts.push(
        `  @${c.budget}: ${c.selected}/${c.total_sections} sel, ${c.tokens_used}/${c.raw_tokens} tok, ` +
          `ids=${c.ids || "(none)"} whole=${c.whole_doc} short=${c.short_circuit} stop=${c.early_stopped}`
      );
    }
  }
  return parts.join("\n");
}

/** CLI entry — stderr only (MCP owns stdout). */
export async function printPackMatrix(): Promise<void> {
  const samplesDir = join(process.cwd(), "public", "samples");
  const rows = await runPackMatrix(samplesDir);
  console.error(formatPackMatrixDetail(rows));
}
