/** Mirrors of src/http/client-ux.ts used by the Next workspace (keep in sync). */

export function applyProveIncludeChange(
  state: { expandedIds: Set<string>; expandedTokens: Map<string, number> },
  id: string,
  tokens: number,
  included: boolean
): { expandedIds: Set<string>; expandedTokens: Map<string, number> } {
  const expandedIds = new Set(state.expandedIds);
  const expandedTokens = new Map(state.expandedTokens);
  if (included) {
    expandedIds.add(id);
    expandedTokens.set(id, tokens);
  } else {
    expandedIds.delete(id);
    expandedTokens.delete(id);
  }
  return { expandedIds, expandedTokens };
}

export function includeRestHint(remainderTokens: number, sectionLeaf?: string): string {
  if (remainderTokens <= 0) return "";
  if (sectionLeaf) {
    return `Include the rest of ${sectionLeaf} (~${remainderTokens.toLocaleString()} tokens)`;
  }
  return `+${remainderTokens.toLocaleString()} content tokens in Prove`;
}

export function truncatedSectionMeta(
  packedTokens: number,
  fullTokens: number,
  remainderTokens: number,
  relevance?: number | null
): string {
  const rel = relevance != null ? `relevance ${relevance}% · ` : "";
  const rest =
    remainderTokens > 0 ? ` · +${remainderTokens.toLocaleString()} tokens still unread in this section` : "";
  return `${rel}${packedTokens.toLocaleString()} content tokens (truncated from ${fullTokens.toLocaleString()}${rest})`;
}

/** Relevance values arrive from the API as percentages (0–100). */
export function relevancePercentLabel(relevance: number | null | undefined): string {
  return relevance == null ? "" : `rel ${relevance}%`;
}

export type BudgetPresets = { quick: number; standard: number; deep: number };

export const DEFAULT_PRESETS: BudgetPresets = { quick: 1000, standard: 4000, deep: 8000 };
export const SLIDER_MIN = 100;
export const SLIDER_MAX = 20_000;

export function computePresets(rawTokens: number | null, min = SLIDER_MIN, max = SLIDER_MAX): BudgetPresets {
  if (!rawTokens || rawTokens >= DEFAULT_PRESETS.deep) return DEFAULT_PRESETS;
  const round50 = (n: number) => Math.round(n / 50) * 50;
  const clamp = (n: number) => Math.min(max, Math.max(min, round50(n)));
  const deep = clamp(Math.max(rawTokens, min));
  const standard = clamp(Math.min(deep, Math.max(min * 2, rawTokens * 0.5)));
  const quick = clamp(Math.min(standard - 50, Math.max(min, rawTokens * 0.2)));
  return {
    quick: Math.min(quick, standard),
    standard: Math.min(standard, deep),
    deep,
  };
}

export function sectionLeaf(section: string): string {
  const parts = section.split(/\s*[>›/]\s*/);
  return (parts[parts.length - 1] || section).trim();
}

/** Agent performs its own compile, so a budget-only edit remains runnable. */
export function shouldDisableAgentWhenStale(opts: {
  hasCompiledOnce: boolean;
  lastCompiledTask: string | null;
  currentTask: string;
  lastCompiledBudget: number | null;
  currentBudget: number;
}): boolean {
  return Boolean(
    opts.hasCompiledOnce &&
    opts.lastCompiledTask !== null &&
    opts.lastCompiledTask.trim() !== opts.currentTask.trim()
  );
}

export type RetryContext = "compile" | "prove" | "agent" | "agentParity" | "expand" | "measure";

export function retryControlHint(context: RetryContext): string {
  switch (context) {
    case "compile":
      return " Use Compile when ready.";
    case "prove":
      return " Use Prove when ready.";
    case "agent":
      return " Use Run agent when ready.";
    case "agentParity":
      return " Use Compare to full file when ready, or run the agent again.";
    case "expand":
      return " Use Peek again when ready.";
    case "measure":
      return " Select the file again, or continue and Compile.";
  }
}

export function apiFailureMessage(
  response: Response,
  error: string | undefined,
  context: RetryContext
): string {
  const base = error || `Request failed (${response.status})`;
  if (response.status === 429) {
    const retryAfter = response.headers.get("Retry-After");
    return `${base}${retryAfter ? ` Retry after about ${retryAfter}s.` : ""}${retryControlHint(context)}`;
  }
  if (response.status === 503) {
    const retryAfter = response.headers.get("Retry-After");
    return `${base}${retryAfter ? ` Retry in about ${retryAfter}s.` : " Retry in a few seconds."}${retryControlHint(context)}`;
  }
  return base;
}

export const BUSY_503_RETRY_MS_MIN = 400;
export const BUSY_503_RETRY_MS_MAX = 900;

export function shouldRetryBusy503(status: number, attemptIndex: number): boolean {
  return status === 503 && attemptIndex === 0;
}

export function busy503RetryDelayMs(random: () => number = Math.random): number {
  return BUSY_503_RETRY_MS_MIN +
    Math.floor(random() * (BUSY_503_RETRY_MS_MAX - BUSY_503_RETRY_MS_MIN + 1));
}

export async function fetchWithBusyRetry(
  input: RequestInfo | URL,
  init: RequestInit,
  onRetry?: () => void
): Promise<Response> {
  const response = await fetch(input, init);
  if (!shouldRetryBusy503(response.status, 0)) return response;
  await response.body?.cancel();
  onRetry?.();
  await new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(resolve, busy503RetryDelayMs());
    const signal = init.signal;
    signal?.addEventListener(
      "abort",
      () => {
        window.clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true }
    );
  });
  return fetch(input, init);
}

const ALLOWED_UPLOAD_EXT = /\.(docx|pdf|xlsx|pptx|csv|md|markdown|txt|html?)$/i;

export function validateUploadFile(file: File, maxBytes: number): string | null {
  if (file.size === 0) return `"${file.name}" is empty. Pick a non-empty document.`;
  if (file.size > maxBytes) {
    const maxMb = maxBytes / (1024 * 1024);
    return `"${file.name}" is ${(file.size / 1e6).toFixed(1)} MB, over the ${maxMb.toFixed(
      maxMb % 1 ? 1 : 0
    )} MB limit. Pick a smaller file.`;
  }
  if (!ALLOWED_UPLOAD_EXT.test(file.name)) {
    return `Unsupported file type. Use PDF, DOCX, XLSX, PPTX, HTML, CSV, TXT, or Markdown. Images are not supported.`;
  }
  return null;
}

export function packagingGapNote(contentTokens: number, wireTokens: number): string | null {
  if (contentTokens <= 0 || wireTokens <= contentTokens) return null;
  const gap = wireTokens - contentTokens;
  if (gap / contentTokens <= 0.1) return null;
  return `${contentTokens.toLocaleString()} content tokens · ~${wireTokens.toLocaleString()} with wrappers`;
}
