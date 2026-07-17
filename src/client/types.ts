/**
 * Client-side mirrors of the server's API shapes (src/pipeline.ts, src/web.ts).
 * Duplicated rather than imported: this file compiles for the browser (DOM
 * lib, no Node types), while the server compiles for Node — sharing a source
 * file across those two lib/module targets isn't worth the build complexity
 * for a handful of small interfaces. Keep these in sync with pipeline.ts.
 *
 * Deliberately NOT an ES module (no import/export): tsconfig.client.json
 * compiles with module "none" for a plain global <script>, and a module-ized
 * file (any top-level import/export, even type-only) makes tsc emit a
 * CommonJS `exports` object that doesn't exist in a browser and throws on
 * load. These interfaces are ambient globals, visible to app.ts without an
 * import because both files compile together as scripts, not modules.
 */

interface Sample {
  key: string;
  file: string;
  fmt: string;
  nm: string;
  mt: string;
  q: string[];
  /** Real raw token count (cl100k), measured server-side from the actual
   *  file via the same convert+cache pipeline a real compile uses (see
   *  GET /api/samples in web.ts) — never a client-side guess, so it can't
   *  drift from reality if the file, tokenizer, or chunker ever changes.
   *  Lets budget presets react to actual document size before the user ever
   *  compiles — a 400-token spreadsheet and a 20,000-token novel shouldn't
   *  offer the same "quick fact / standard / deep dive" numbers. Null if the
   *  server couldn't measure this one sample (conversion failed). */
  tok: number | null;
}

interface BudgetPresets {
  quick: number;
  standard: number;
  deep: number;
}

interface SectionInfo {
  id: string;
  section: string;
  tokens: number;
  relevance: number | null;
  matched_queries?: number[];
  text?: string;
}

/** Response body of POST /api/compile (CompileResult + web.ts's added fields). */
interface CompileApiResult {
  markdown: string;
  raw_tokens: number;
  tokens_used: number;
  tokens_saved: number;
  reduction_pct: number;
  cache_hit: boolean;
  rerank_used: boolean;
  token_budget: number;
  queries: string[];
  selected_sections: SectionInfo[];
  omitted_sections: SectionInfo[];
  cost_raw_usd: number;
  cost_compiled_usd: number;
  price_per_mtok: number;
  /** Opaque server-minted reference to the uploaded file, passed back to
   *  /api/expand. Not a filesystem path (the old file_path leaked the server's
   *  layout and let a client name arbitrary paths). */
  handle: string;
  llm_available: boolean;
  error?: string;
}

/** Response body of POST /api/measure — a real, server-measured token count
 *  for a freshly uploaded file, ahead of Compile, via the same convert+cache
 *  pipeline a real compile uses. Not a guess: works identically for text and
 *  binary formats (xlsx, pptx, images, ...) since it's the real conversion. */
interface MeasureApiResult {
  raw_tokens: number;
  handle: string;
  error?: string;
}

/** Response body of POST /api/expand. */
interface ExpandApiResult {
  markdown: string;
  tokens_used: number;
  cache_hit: boolean;
  error?: string;
}

/** Response body of POST /api/answer. */
interface AnswerApiResult {
  model: string;
  full: { answer: string; context_tokens: number };
  compiled: { answer: string; context_tokens: number; reduction_pct: number };
  error?: string;
}
