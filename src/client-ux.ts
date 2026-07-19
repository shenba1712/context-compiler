/**
 * Pure UX contracts for the web demo — unit-tested from Node (see test.ts).
 * The browser client (app.ts) mirrors these helpers inline because it ships as
 * a plain script without imports; keep both in sync.
 */

/** rAF frames to wait before scrollIntoView after revealing hidden layout. */
export const LAYOUT_FRAMES_BEFORE_SCROLL = 2;

export interface VisibleRect {
  top: number;
  bottom: number;
}

/** True when `rect` already intersects the viewport (with margin). */
export function isNearVisibleRect(rect: VisibleRect, viewportHeight: number, margin = 64): boolean {
  return rect.bottom > margin && rect.top < viewportHeight - margin;
}

/** Scroll contract: skip when the target is already near-visible. */
export function shouldScrollIntoView(rect: VisibleRect, viewportHeight: number, margin = 64): boolean {
  return !isNearVisibleRect(rect, viewportHeight, margin);
}

/**
 * Unchecking “Include in Prove” removes the id from proveExpandedIds only;
 * peek DOM blocks stay open (product: “peek kept”).
 */
export function shouldRemovePeekOnUncheck(): boolean {
  return false;
}

export interface ProveIncludeState {
  expandedIds: Set<string>;
  expandedTokens: Map<string, number>;
}

/** Pure state transition for prove-include checkboxes (peek is separate). */
export function applyProveIncludeChange(
  state: ProveIncludeState,
  id: string,
  tokens: number,
  included: boolean
): ProveIncludeState {
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

/** Truncated selected-card meta: packed size + clear unread remainder. */
export function truncatedSectionMeta(
  packedTokens: number,
  fullTokens: number,
  remainderTokens: number,
  relevance?: number | null
): string {
  const rel = relevance != null ? "relevance " + relevance + "% · " : "";
  const rest =
    remainderTokens > 0
      ? " · +" + remainderTokens.toLocaleString() + " tokens still unread in this section"
      : "";
  return (
    rel +
    packedTokens.toLocaleString() +
    " content tokens (truncated from " +
    fullTokens.toLocaleString() +
    rest +
    ")"
  );
}

/** Include-hint on a truncated card or omitted peek. */
export function includeRestHint(remainderTokens: number, sectionLeaf?: string): string {
  if (remainderTokens <= 0) return "";
  if (sectionLeaf) {
    return "Include the rest of " + sectionLeaf + " (~" + remainderTokens.toLocaleString() + " tokens)";
  }
  return "+" + remainderTokens.toLocaleString() + " content tokens in Prove";
}

/**
 * A new compile (or any input that invalidates the prior agent run) must hide
 * the agent panel — stale steps/answers from another doc or question mislead.
 */
export function shouldClearAgentOnCompile(): boolean {
  return true;
}

/**
 * Changing the document (sample picker, file input) must hide compiled results
 * and agent immediately. Question edits use the question-stale path instead.
 */
export function shouldClearResultsOnDocChange(): boolean {
  return true;
}

/**
 * Live task no longer matches the last successful compile → question-stale UI.
 * `lastCompiledTask === null` means nothing to invalidate from the question alone.
 */
export function taskInvalidatesCompile(lastCompiledTask: string | null, currentTask: string): boolean {
  if (lastCompiledTask === null) return false;
  return lastCompiledTask.trim() !== currentTask.trim();
}

/** Banner HTML when the task field diverges from the last successful compile. */
export function questionStaleBannerHtml(): string {
  return (
    "<strong>Question changed.</strong> Results below are from your previous question " +
    "(expands cleared). Click <strong>Compile once</strong> to refresh for the new question."
  );
}

/**
 * After compile, show the agent section in idle-ready state (heading + Run agent CTA)
 * when results are on screen and neither question nor budget is stale.
 */
export function shouldShowAgentSecIdle(opts: {
  hasCompiledOnce: boolean;
  resultsVisible: boolean;
  questionStale: boolean;
  budgetStale: boolean;
}): boolean {
  if (!opts.hasCompiledOnce || !opts.resultsVisible) return false;
  if (opts.questionStale || opts.budgetStale) return false;
  return true;
}

/** Prove API failures render in `.prove-err` near Prove controls, not top `#err`. */
export function proveFlowUsesLocalError(): boolean {
  return true;
}

/** Which control to name in a 429 retry hint (keep in sync with app.ts). */
export type RateLimitRetryContext = "agent" | "prove" | "agentParity";

/** Extra copy after the server 429 message so users know where to retry. */
export function rateLimitRetryHint(context: RateLimitRetryContext): string {
  switch (context) {
    case "agent":
      return " Use Run agent above or below when ready.";
    case "prove":
      return " Use Prove above or in results when ready.";
    case "agentParity":
      return " Use Compare to full file when ready, or run the agent again.";
  }
}

/** Turn HTTP status + JSON error body into a human message (429/503 aware). */
export function apiFailureMessageFromStatus(
  status: number,
  error: string | undefined,
  retryAfterHeader: string | null,
  retryContext?: RateLimitRetryContext
): string {
  const base = error || `Request failed (${status})`;
  if (status === 429) return base + (retryContext ? rateLimitRetryHint(retryContext) : "");
  if (status === 503) {
    return base + (retryAfterHeader ? ` Retry in about ${retryAfterHeader}s.` : " Retry in a few seconds.");
  }
  return base;
}

/** Prove, Agent, and Include-in-Prove stay off until a fresh compile for this question. */
export function shouldDisableProveAgentWhenQuestionStale(
  hasCompiledOnce: boolean,
  lastCompiledTask: string | null,
  currentTask: string
): boolean {
  if (!hasCompiledOnce || lastCompiledTask === null) return false;
  return taskInvalidatesCompile(lastCompiledTask, currentTask);
}

/**
 * Prove (and Include-in-Prove) must not run against on-screen cards when the
 * slider moved — Prove recompiles under the live budget and would disagree
 * with the results the user is looking at. Agent stays allowed: it never
 * claims to use the on-screen compile.
 */
export function shouldDisableProveWhenBudgetStale(
  hasCompiledOnce: boolean,
  lastCompiledBudget: number | null,
  currentBudget: number
): boolean {
  if (!hasCompiledOnce || lastCompiledBudget === null) return false;
  return lastCompiledBudget !== currentBudget;
}

/** Combined Prove lockout: question soft-stale or budget soft-stale. */
export function shouldDisableProveWhenStale(opts: {
  hasCompiledOnce: boolean;
  lastCompiledTask: string | null;
  currentTask: string;
  lastCompiledBudget: number | null;
  currentBudget: number;
}): boolean {
  return (
    shouldDisableProveAgentWhenQuestionStale(
      opts.hasCompiledOnce,
      opts.lastCompiledTask,
      opts.currentTask
    ) ||
    shouldDisableProveWhenBudgetStale(
      opts.hasCompiledOnce,
      opts.lastCompiledBudget,
      opts.currentBudget
    )
  );
}

/** Agent cancel must keep partial steps visible (not wipe the panel). */
export function shouldKeepAgentStepsOnCancel(): boolean {
  return true;
}

/** SSE ended with neither `done` nor `error` → treat as disconnect, not success. */
export function agentStreamIncompleteMessage(): string {
  return "Agent connection ended before a result. Try Run agent again.";
}

/** Empty selected list must show an explicit empty state, not a blank “Included” bucket. */
export function emptyCompiledSectionsMessage(): string {
  return "No sections fit this budget. See the note above to raise it, or peek an omitted section below.";
}

/** Material packaging overhead vs packed content (wrappers only; manifest excluded from Prove/Agent). */
export function packagingGapNote(contentTokens: number, wireTokens: number): string | null {
  if (contentTokens <= 0 || wireTokens <= contentTokens) return null;
  const gap = wireTokens - contentTokens;
  if (gap / contentTokens <= 0.1) return null;
  return contentTokens.toLocaleString() + " content · ~" + wireTokens.toLocaleString() + " with packaging";
}
