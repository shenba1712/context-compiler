/**
 * Context Compiler demo — client script (compiled to public/app.js).
 * Plain global script (no bundler): tsconfig.client.json emits with
 * module "none" so this can be dropped in via a single <script src>.
 * Shared interfaces (Sample, CompileApiResult, ...) come from types.ts,
 * compiled alongside this file as an ambient global — see the note there.
 */

/// <reference path="./types.ts" />

// Scroll/peek UX contracts — keep in sync with src/client-ux.ts (unit-tested).
const LAYOUT_FRAMES_BEFORE_SCROLL = 2;

/** Unchecking Include in Prove must not remove peek blocks — see client-ux.ts. */
function shouldRemovePeekOnUncheck(): boolean {
  return false;
}

/** Truncated selected-card meta — keep in sync with truncatedSectionMeta in client-ux.ts. */
function truncatedSectionMetaCopy(
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

/** New compile must hide stale agent output — keep in sync with client-ux.ts. */
function shouldClearAgentOnCompile(): boolean {
  return true;
}

/** Doc change must hide compile results — keep in sync with client-ux.ts. */
function shouldClearResultsOnDocChange(): boolean {
  return true;
}

/** Live task ≠ last compile task — keep in sync with taskInvalidatesCompile in client-ux.ts. */
function taskInvalidatesCompile(lastCompiledTask: string | null, currentTask: string): boolean {
  if (lastCompiledTask === null) return false;
  return lastCompiledTask.trim() !== currentTask.trim();
}

/** Question-stale banner — keep in sync with questionStaleBannerHtml in client-ux.ts. */
function questionStaleBannerCopy(): string {
  return (
    "<strong>Question changed.</strong> Results below are from your previous question " +
    "(expands cleared). Click <strong>Compile once</strong> to refresh for the new question."
  );
}

/** Question soft-stale — keep in sync with shouldDisableProveAgentWhenQuestionStale in client-ux.ts. */
function isQuestionStale(): boolean {
  if (!hasCompiledOnce || lastCompiledTask === null) return false;
  return taskInvalidatesCompile(lastCompiledTask, $<HTMLTextAreaElement>("task").value);
}

function isBudgetStale(): boolean {
  if (!hasCompiledOnce || lastCompiledBudget === null) return false;
  return +$<HTMLInputElement>("budget").value !== lastCompiledBudget;
}

/** Prove lockout when on-screen compile disagrees with live inputs — keep in sync with client-ux.ts. */
function isProveStale(): boolean {
  return isQuestionStale() || isBudgetStale();
}

/** Idle agent CTA after compile — keep in sync with shouldShowAgentSecIdle in client-ux.ts. */
function shouldShowAgentSecIdle(): boolean {
  const resultsVisible =
    !$("resultsSec").classList.contains("hidden") && !$("results").classList.contains("hidden");
  return shouldShowAgentSecIdleContract({
    hasCompiledOnce,
    resultsVisible,
    questionStale: isQuestionStale(),
    budgetStale: isBudgetStale(),
  });
}

function shouldShowAgentSecIdleContract(opts: {
  hasCompiledOnce: boolean;
  resultsVisible: boolean;
  questionStale: boolean;
  budgetStale: boolean;
}): boolean {
  if (!opts.hasCompiledOnce || !opts.resultsVisible) return false;
  if (opts.questionStale || opts.budgetStale) return false;
  return true;
}

/** Include-hint copy — keep in sync with includeRestHint in client-ux.ts. */
function includeRestHintCopy(remainderTokens: number, sectionLeaf?: string): string {
  if (remainderTokens <= 0) return "";
  if (sectionLeaf) {
    return "Include the rest of " + sectionLeaf + " (~" + remainderTokens.toLocaleString() + " tokens)";
  }
  return "+" + remainderTokens.toLocaleString() + " content tokens in Prove";
}

function $<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id} in the page. Markup and script are out of sync.`);
  return el as T;
}

// Fetched from GET /api/samples on load — real, server-measured token counts
// (computed through the same convert+cache pipeline a real compile uses),
// not a client-side guess. See samples-manifest.ts and web.ts for the source.
let SAMPLES: Sample[] = [];

/**
 * Source of truth for the active document when a sample card is chosen.
 * Programmatic `input.files = DataTransfer…` is unreliable across browsers
 * (silent no-op, or assignment that does not stick). Compile / Agent / Prove
 * must not depend on it — they read `pickedFile` first.
 */
let pickedFile: File | null = null;

function activeFile(): File | null {
  return pickedFile ?? $<HTMLInputElement>("file").files?.[0] ?? null;
}

async function loadSamples(): Promise<void> {
  const wrap = $("samples");
  try {
    const resp = await fetch("/api/samples");
    if (!resp.ok) throw new Error(`samples HTTP ${resp.status}`);
    const data: Sample[] = await resp.json();
    if (!Array.isArray(data)) throw new Error("Unexpected response shape");
    SAMPLES = data;
    renderSamples();
    // Open the library so the demo doesn't look empty behind a closed <details>.
    const box = document.querySelector<HTMLDetailsElement>("details.samplesbox");
    if (box) box.open = true;
    // Server returns tok=null until background convert finishes; refresh once
    // so budget presets can scale to real sizes without blocking first paint.
    window.setTimeout(() => {
      void refreshSampleTokens();
    }, 12_000);
  } catch (e) {
    console.warn("Could not load the sample library:", e);
    wrap.textContent = "Couldn't load the sample library right now. Uploading your own file still works.";
  }
}

async function refreshSampleTokens(): Promise<void> {
  try {
    const resp = await fetch("/api/samples");
    if (!resp.ok) return;
    const data: Sample[] = await resp.json();
    if (!Array.isArray(data) || data.length === 0) return;
    const before = SAMPLES.map((s) => `${s.key}:${s.tok ?? ""}`).join("|");
    const after = data.map((s) => `${s.key}:${s.tok ?? ""}`).join("|");
    if (before === after) return;
    SAMPLES = data;
    renderSamples();
  } catch {
    /* non-critical */
  }
}

function setFilePickedStatus(msg: string): void {
  const el = $("filePicked");
  el.textContent = msg;
  el.classList.remove("hidden");
}

function clearFilePickedStatus(): void {
  const el = $("filePicked");
  el.textContent = "";
  el.classList.add("hidden");
}

// Known up front (not just after a failed click, or worse, left fully
// enabled on the keyless default deploy this project's headline is built
// around) so LLM-only actions are correctly disabled + explained from the
// moment the page loads, not only after the first compile.
let maxFileBytes = 20 * 1024 * 1024;
let llmAvailable = true;

const PROVE_IDLE = "Prove answer parity";
const PROVE_TOP_IDLE = "Prove…";
const PROVE_BUSY = "Asking the model twice…";

const NO_LLM_TITLE = "The server has no LLM API key configured. Everything else works without one.";

/** Keep Prove + Run agent in sync with LLM availability and soft-stale inputs. */
function setLlmDependentButtons(available: boolean): void {
  llmAvailable = available;
  const qStale = isQuestionStale();
  const proveStale = isProveStale();
  const budgetStale = isBudgetStale();
  const proveTop = $<HTMLButtonElement>("prove");
  const proveResults = $<HTMLButtonElement>("proveResults");
  const agentBtn = $<HTMLButtonElement>("goAgent");
  const agentBtnBelow = $<HTMLButtonElement>("goAgentBelow");
  const proveBusy = proveTop.textContent === PROVE_BUSY;
  const agentBusy = agentBtn.textContent === "Agent working…";
  // Prove must match on-screen compile (question + budget). Agent only locks on question:
  // it recompiles from form inputs and never claims to use the cards below.
  proveTop.disabled = !available || proveStale || proveBusy;
  proveResults.disabled = !available || proveStale || proveBusy;
  agentBtn.disabled = !available || qStale || agentBusy;
  agentBtnBelow.disabled = !available || qStale || agentBusy;
  const proveTitle = available
    ? qStale
      ? "Question changed — compile again before proving"
      : budgetStale
        ? "Budget changed — compile again before proving"
        : "Compare answers from the full file vs your Compile result (not Agent)"
    : NO_LLM_TITLE;
  proveTop.title = available
    ? qStale
      ? "Question changed — compile again before proving"
      : budgetStale
        ? "Budget changed — compile again before proving"
        : "Power path: prove from file + budget without waiting on the results view"
    : NO_LLM_TITLE;
  proveResults.title = proveTitle;
  agentBtn.title = available
    ? qStale
      ? "Question changed — compile again before running the agent"
      : "Retrieve under your token budget, then answer (same slider as Compile)"
    : NO_LLM_TITLE;
  agentBtnBelow.title = agentBtn.title;
  const parityBtn = $<HTMLButtonElement>("aParityBtn");
  if (parityBtn) parityBtn.disabled = !available || qStale || !agentParityHandle;
  setProveIncludeControlsEnabled(!proveStale);
  // Results-area Prove appears after a compile (when an LLM is available).
  if (available && hasCompiledOnce) $("proveActions").classList.remove("hidden");
  else if (!available) $("proveActions").classList.add("hidden");
}

async function loadConfig(): Promise<void> {
  try {
    const resp = await fetch("/api/config");
    const cfg: {
      llm_available: boolean;
      max_file_bytes?: number;
      rate_limit?: number;
      rate_window_minutes?: number;
      rate_cost_answer?: number;
      rate_cost_agent?: number;
      max_concurrent_llm?: number;
      answer_context_cap?: number;
    } = await resp.json();
    if (typeof cfg.max_file_bytes === "number" && cfg.max_file_bytes > 0) {
      maxFileBytes = cfg.max_file_bytes;
      const label = document.querySelector('label[for="file"]');
      if (label) {
        const mb = Math.round(maxFileBytes / (1024 * 1024));
        label.textContent = `Upload your file (pdf, docx, xlsx, pptx, html, csv, txt, md). Max ${mb} MB`;
      }
    }
    setLlmDependentButtons(Boolean(cfg.llm_available));
    fillExpectPanel(cfg);
  } catch (e) {
    console.warn("Could not load server config:", e);
    // Leave the buttons enabled — worst case a click surfaces the real error.
  }
}

/** Fill the “what to expect” panel from live server limits (falls back to HTML defaults). */
function fillExpectPanel(cfg: {
  llm_available: boolean;
  rate_limit?: number;
  rate_window_minutes?: number;
  rate_cost_answer?: number;
  rate_cost_agent?: number;
  max_concurrent_llm?: number;
  answer_context_cap?: number;
}): void {
  const pool = cfg.rate_limit ?? 30;
  const windowMin = cfg.rate_window_minutes ?? 5;
  const costAnswer = cfg.rate_cost_answer ?? 4;
  const costAgent = cfg.rate_cost_agent ?? 12;
  const setAll = (key: string, text: string) => {
    document.querySelectorAll(`[data-k="${key}"]`).forEach((el) => {
      el.textContent = text;
    });
  };
  setAll("compile_n", pool.toLocaleString());
  setAll("window", String(windowMin));
  setAll("cost_answer", String(costAnswer));
  setAll("cost_agent", String(costAgent));
  setAll("prove_n", String(Math.max(1, Math.floor(pool / costAnswer))));
  setAll("agent_n", String(Math.max(1, Math.floor(pool / costAgent))));
  setAll("llm_conc", String(cfg.max_concurrent_llm ?? 2));
  setAll("answer_cap", (cfg.answer_context_cap ?? 60_000).toLocaleString());

  const llmLine = document.getElementById("expectLlmLine");
  if (llmLine) {
    llmLine.innerHTML = cfg.llm_available
      ? "If Gemini/OpenRouter <strong>free-tier quota</strong> is exhausted, Prove and Agent may return 429/503 even when our rate limit still has room. Wait a few minutes and retry."
      : "<strong>Prove</strong> and <strong>Run agent</strong> are disabled here. This server has no LLM API key. Compile and expand still work fully offline.";
  }
}

// The sample library spans several scripts, so tag text with the right
// language (assistive tech pronounces it correctly under the page's lang="en")
// and direction (Arabic is right-to-left). Latin text stays the page default.
function scriptInfo(text: string): { lang: string; rtl: boolean } {
  if (/[؀-ۿ]/.test(text)) return { lang: "ar", rtl: true }; // Arabic
  if (/[ऀ-ॿ]/.test(text)) return { lang: "hi", rtl: false }; // Devanagari
  if (/[Ѐ-ӿ]/.test(text)) return { lang: "ru", rtl: false }; // Cyrillic
  if (/[ñ¿¡áéíóúü]/i.test(text)) return { lang: "es", rtl: false }; // Spanish accents
  return { lang: "", rtl: false };
}

// Tag an element with the language and direction of its text.
function applyLang(el: HTMLElement, text: string): void {
  const info = scriptInfo(text);
  el.lang = info.lang;
  el.dir = info.rtl ? "rtl" : "";
}

function langSpan(text: string): HTMLSpanElement {
  const span = document.createElement("span");
  applyLang(span, text);
  span.textContent = text;
  return span;
}

function announce(msg: string, assertive = false): void {
  $(assertive ? "liveRegionAssertive" : "liveRegion").textContent = msg;
}

/** True when el meaningfully intersects the viewport (with a small margin). */
function isNearVisible(el: HTMLElement, margin = 64): boolean {
  const r = el.getBoundingClientRect();
  const vh = window.innerHeight || document.documentElement.clientHeight;
  return r.bottom > margin && r.top < vh - margin;
}

/**
 * Scroll only when the target isn't already near-visible — avoids the
 * Prove flow jumping to the spinner when the user is already in results.
 * Returns whether a scroll was started.
 */
function scrollIntoViewIfNeeded(
  el: HTMLElement,
  opts: ScrollIntoViewOptions = { behavior: "smooth", block: "start" }
): boolean {
  if (isNearVisible(el)) return false;
  el.scrollIntoView(opts);
  return true;
}

/**
 * scrollIntoView in the same turn as removing `display:none` is often a no-op
 * (layout height is still zero). Wait two frames so first-compile scroll lands.
 */
function scrollIntoViewAfterLayout(
  el: HTMLElement,
  opts: ScrollIntoViewOptions = { behavior: "smooth", block: "start" },
  after?: () => void
): void {
  let framesLeft = LAYOUT_FRAMES_BEFORE_SCROLL;
  const tick = (): void => {
    if (framesLeft > 0) {
      framesLeft -= 1;
      requestAnimationFrame(tick);
      return;
    }
    scrollIntoViewIfNeeded(el, opts);
    after?.();
  };
  requestAnimationFrame(tick);
}

const esc = (s: unknown): string =>
  String(s).replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c] as string);

// Section breadcrumbs look like "Contract > Termination > Notice". Most of
// the UI only wants that last, most-specific part — this pulls it out (or
// falls back to the full breadcrumb if there's no " > " to split on).
const lastCrumb = (section: string): string => section.split(" > ").pop() || section;

// Copy the referenced <pre> config to the clipboard.
document.querySelectorAll<HTMLButtonElement>(".copybtn").forEach((btn) => {
  btn.onclick = async () => {
    const targetId = btn.dataset.copy;
    if (!targetId) return;
    const el = document.getElementById(targetId);
    if (!el) return;
    try {
      await navigator.clipboard.writeText(el.textContent ?? "");
      const prev = btn.textContent;
      btn.textContent = "copied ✓";
      btn.classList.add("done");
      setTimeout(() => {
        btn.textContent = prev;
        btn.classList.remove("done");
      }, 1400);
    } catch (err) {
      console.warn("Clipboard write failed:", err);
      btn.textContent = "copy failed";
    }
  };
});

const blobCache: Record<string, Blob> = {};

function renderSamples(): void {
  const wrap = $("samples");
  wrap.innerHTML = "";
  SAMPLES.forEach((s) => {
    const c = document.createElement("button");
    c.type = "button";
    c.className = "scard";
    c.dataset.key = s.key;
    c.setAttribute("aria-pressed", "false");
    const nmWrap = document.createElement("div");
    nmWrap.className = "nm";
    nmWrap.appendChild(langSpan(s.nm));
    const fmt = document.createElement("span");
    fmt.className = "fmt " + s.fmt;
    fmt.textContent = s.fmt.toUpperCase();
    nmWrap.appendChild(fmt);
    const mt = document.createElement("div");
    mt.className = "mt";
    mt.textContent = s.mt;
    c.append(nmWrap, mt);
    c.onclick = () => selectSample(s, c);
    wrap.appendChild(c);
  });
}

async function selectSample(s: Sample, card: HTMLButtonElement): Promise<void> {
  if (shouldClearResultsOnDocChange()) clearCompiledResults();
  document.querySelectorAll<HTMLButtonElement>(".scard").forEach((x) => {
    x.classList.remove("active");
    x.setAttribute("aria-pressed", "false");
  });
  card.classList.add("active");
  card.setAttribute("aria-pressed", "true");
  clearErr();
  setFilePickedStatus("Loading sample: " + s.nm + "…");
  try {
    let blob = blobCache[s.key];
    if (!blob) {
      const resp = await fetch("/samples/" + encodeURIComponent(s.file));
      if (!resp.ok) {
        throw new Error(
          `Could not download sample (HTTP ${resp.status}). The host may still be waking up — try again in a moment.`
        );
      }
      blob = await resp.blob();
      if (!blob.size) throw new Error("Sample file was empty.");
      blobCache[s.key] = blob;
    }
    // Hold the File in memory — do not require input.files assignment to succeed.
    pickedFile = new File([blob], s.file, { type: blob.type || "application/octet-stream" });
    const input = $<HTMLInputElement>("file");
    try {
      const dt = new DataTransfer();
      dt.items.add(pickedFile);
      input.files = dt.files;
    } catch {
      // Best-effort only: some browsers block programmatic FileList writes.
    }
  } catch (e) {
    delete blobCache[s.key];
    pickedFile = null;
    card.classList.remove("active");
    card.setAttribute("aria-pressed", "false");
    clearFilePickedStatus();
    fail("Could not load sample: " + (e instanceof Error ? e.message : String(e)));
    return;
  }
  const box = document.querySelector<HTMLDetailsElement>("details.samplesbox");
  if (box) box.open = true;
  setFilePickedStatus("Selected sample: " + s.nm + " (" + s.file + ")");
  renderQChips(s.q);
  $<HTMLTextAreaElement>("task").value = s.q[0];
  syncQChips();
  autoGrowTask();
  // The sample's real size is already known (measured ahead of time), so the
  // budget picker can be scaled to it immediately — before the user even
  // presses Compile, unlike an arbitrary upload where size is unknown until
  // conversion. See computePresets().
  const presets = computePresets(s.tok);
  applyPresets(presets, "standard");
  renderDocSizeNote(s.tok, presets !== DEFAULT_PRESETS);
  announce(
    s.nm +
      (s.tok ? " loaded (~" + s.tok.toLocaleString() + " tokens). " : " loaded. ") +
      s.q.length +
      " suggested questions available below the question field."
  );
}

function renderQChips(questions: string[]): void {
  const box = $("qchips");
  box.innerHTML = "";
  questions.forEach((q) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "qchip";
    b.appendChild(langSpan(q));
    b.dataset.q = q;
    b.onclick = () => {
      $<HTMLTextAreaElement>("task").value = q;
      syncQChips();
      autoGrowTask();
      onTaskUserChange();
      $<HTMLTextAreaElement>("task").focus();
    };
    box.appendChild(b);
  });
  box.classList.remove("hidden");
}

// Highlight whichever chip matches the current text (if any).
function syncQChips(): void {
  const v = $<HTMLTextAreaElement>("task").value.trim();
  document
    .querySelectorAll<HTMLButtonElement>(".qchip")
    .forEach((c) => c.classList.toggle("active", c.dataset.q === v));
}
$<HTMLTextAreaElement>("task").addEventListener("input", syncQChips);

/** Question edited after compile: soft-stale banner; keep compile cards visible. */
function onTaskUserChange(): void {
  if (!hasCompiledOnce || lastCompiledTask === null) return;
  const task = $<HTMLTextAreaElement>("task").value;
  if (!taskInvalidatesCompile(lastCompiledTask, task)) {
    clearQuestionStale();
    setLlmDependentButtons(llmAvailable);
    if (shouldShowAgentSecIdle()) showAgentSecIdle();
    return;
  }
  proveAbort?.abort();
  clearProveExpands();
  $("parity").classList.add("hidden");
  clearAgentPanel();
  const el = $("questionStaleNote");
  el.innerHTML = questionStaleBannerCopy();
  el.classList.remove("hidden");
  setLlmDependentButtons(llmAvailable);
}
$<HTMLTextAreaElement>("task").addEventListener("input", onTaskUserChange);

// #task replaced a single-line <input> so multi-question tasks
// (see “Tips for questions”) are comfortable to type and read.
// Grow with content instead of scrolling internally; call after every value
// change, including the programmatic ones (sample select, chip click).
function autoGrowTask(): void {
  const el = $<HTMLTextAreaElement>("task");
  el.style.height = "auto";
  el.style.height = el.scrollHeight + "px";
}
$<HTMLTextAreaElement>("task").addEventListener("input", autoGrowTask);

// Enter submits (matching the old single-line input's behavior and every
// user's expectation of a "question box"); Shift+Enter inserts a newline,
// which is exactly the "new lines" separator the hint text tells them to use.
$<HTMLTextAreaElement>("task").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    $<HTMLFormElement>("compileForm").requestSubmit();
  }
});

// Keep the big number, the slider, and the active preset in lockstep so the
// selected budget is never something you have to hunt for.
function syncBudget(): void {
  const v = +$<HTMLInputElement>("budget").value;
  $("budgetVal").textContent = v.toLocaleString();
  document.querySelectorAll<HTMLButtonElement>(".bpre").forEach((b) => {
    const on = +(b.dataset.v ?? NaN) === v;
    b.classList.toggle("active", on);
    b.setAttribute("aria-pressed", String(on));
  });
}

/** Budget the last successful compile used — for stale detection when the slider moves. */
let lastCompiledBudget: number | null = null;
/** Question text from the last successful compile — for invalidation when the task edits. */
let lastCompiledTask: string | null = null;

function clearResultsStale(): void {
  const el = $("budgetStaleNote");
  el.classList.add("hidden");
  el.innerHTML = "";
}

function clearQuestionStale(): void {
  const el = $("questionStaleNote");
  el.classList.add("hidden");
  el.innerHTML = "";
}

/** Disable Include-in-Prove checkboxes while question-stale (peeks stay usable). */
function setProveIncludeControlsEnabled(enabled: boolean): void {
  document
    .querySelectorAll<HTMLInputElement>(
      ".seccard-include input[type=checkbox], .expblk-include input[type=checkbox]"
    )
    .forEach((cb) => {
      cb.disabled = !enabled;
    });
}

/** Slider/preset changed after a compile: drop expands + parity, ask them to recompile. */
function onBudgetUserChange(): void {
  if (!hasCompiledOnce || lastCompiledBudget === null) return;
  const v = +$<HTMLInputElement>("budget").value;
  if (v === lastCompiledBudget) {
    // Back to the budget that produced the results on screen — still valid.
    clearResultsStale();
    setLlmDependentButtons(llmAvailable);
    if (shouldShowAgentSecIdle()) showAgentSecIdle();
    return;
  }
  clearProveExpands();
  $("parity").classList.add("hidden");
  clearAgentPanel();
  const el = $("budgetStaleNote");
  el.innerHTML =
    "<strong>Budget changed.</strong> Results below are from the previous " +
    lastCompiledBudget.toLocaleString() +
    "-token compile (expands cleared). Click <strong>Compile once</strong> to refresh at " +
    v.toLocaleString() +
    " tokens.";
  el.classList.remove("hidden");
  setLlmDependentButtons(llmAvailable);
}

$<HTMLInputElement>("budget").oninput = () => {
  syncBudget();
  onBudgetUserChange();
};
document.querySelectorAll<HTMLButtonElement>(".bpre").forEach((b) => {
  b.onclick = () => {
    $<HTMLInputElement>("budget").value = b.dataset.v ?? "4000";
    syncBudget();
    onBudgetUserChange();
  };
});
syncBudget();

// Preset budgets for a big document. On a small one these would all just mean
// "return the whole file", so computePresets() scales them down to the doc's
// size below. "standard" mirrors DEFAULT_TOKEN_BUDGET in config.ts — the client
// is a separate bundle that can't import server code, so the number is copied.
// Keep presets inside the slider's min/max (see #budget in index.html; min
// matches BUDGET_FLOORS.web = 100).
const DEFAULT_PRESETS: BudgetPresets = { quick: 1000, standard: 4000, deep: 8000 };
const SLIDER_MIN = 100;
const SLIDER_MAX = 20_000;

function computePresets(rawTokens: number | null): BudgetPresets {
  if (!rawTokens || rawTokens >= DEFAULT_PRESETS.deep) return DEFAULT_PRESETS;
  const round50 = (n: number) => Math.round(n / 50) * 50;
  const clamp = (n: number) => Math.min(SLIDER_MAX, Math.max(SLIDER_MIN, round50(n)));
  const deep = clamp(Math.max(rawTokens, SLIDER_MIN));
  // Spread tiers on small docs so quick < standard < deep when the file allows it.
  const standard = clamp(Math.min(deep, Math.max(SLIDER_MIN * 2, rawTokens * 0.5)));
  const quick = clamp(Math.min(standard - 50, Math.max(SLIDER_MIN, rawTokens * 0.2)));
  return {
    quick: Math.min(quick, standard),
    standard: Math.min(standard, deep),
    deep,
  };
}

// selectTier: which preset to jump the slider to, or null to just relabel the
// buttons in place (used after a compile completes — the user already chose
// a value for that run; don't yank the slider out from under the result they
// just got, just refresh the preset numbers for their NEXT compile).
function applyPresets(p: BudgetPresets, selectTier: keyof BudgetPresets | null): void {
  document.querySelectorAll<HTMLButtonElement>(".bpre").forEach((b) => {
    const tier = b.dataset.tier as keyof BudgetPresets | undefined;
    if (!tier) return;
    b.dataset.v = String(p[tier]);
    const small = b.querySelector("small");
    if (small) small.textContent = "~" + p[tier].toLocaleString();
  });
  if (selectTier) {
    const slider = $<HTMLInputElement>("budget");
    const v = Math.min(SLIDER_MAX, Math.max(SLIDER_MIN, p[selectTier]));
    slider.value = String(v);
    syncBudget();
    onBudgetUserChange();
  } else {
    syncBudget();
  }
}

function renderDocSizeNote(rawTokens: number | null, scaled: boolean): void {
  const el = $("docSizeNote");
  if (!rawTokens) {
    el.classList.add("hidden");
    return;
  }
  el.textContent = scaled
    ? `This document is about ${rawTokens.toLocaleString()} tokens total. The presets below are scaled to it.`
    : `This document is about ${rawTokens.toLocaleString()} tokens total.`;
  el.classList.remove("hidden");
}

$<HTMLButtonElement>("viewToggle").onclick = () => {
  const raw = $("out").classList.toggle("hidden");
  $("sections").classList.toggle("hidden", !raw);
  $<HTMLButtonElement>("viewToggle").textContent = raw ? "See exact text sent to AI" : "Back to section view";
  $("viewToggle").setAttribute("aria-pressed", String(!raw));
};

function fail(m: string): void {
  $("err").textContent = m;
  $("err").classList.remove("hidden");
  announce(m, true);
}

function proveError(m: string): void {
  for (const el of Array.from(document.querySelectorAll<HTMLElement>(".prove-err"))) {
    el.textContent = m;
    el.classList.remove("hidden");
  }
  announce("Prove error: " + m, true);
}

function clearProveErr(): void {
  for (const el of Array.from(document.querySelectorAll<HTMLElement>(".prove-err"))) {
    el.classList.add("hidden");
  }
}

/** Expand/peek failures in the results panel — not the top-of-form `#err`. */
function resultsError(m: string): void {
  const el = $("resultsErr");
  el.textContent = m;
  el.classList.remove("hidden");
  announce(m, true);
}

function clearResultsErr(): void {
  $("resultsErr").classList.add("hidden");
  $("resultsErr").textContent = "";
}

/** Which control to name in a 429 retry hint — keep in sync with client-ux.ts. */
type RateLimitRetryContext = "agent" | "prove" | "agentParity";

function rateLimitRetryHint(context: RateLimitRetryContext): string {
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
function apiFailureMessage(
  resp: Response,
  body: { error?: string } | null,
  retryContext?: RateLimitRetryContext
): string {
  const base = body?.error || `Request failed (${resp.status})`;
  if (resp.status === 429) return base + (retryContext ? rateLimitRetryHint(retryContext) : "");
  if (resp.status === 503) {
    const ra = resp.headers.get("Retry-After");
    return base + (ra ? ` Retry in about ${ra}s.` : " Retry in a few seconds.");
  }
  return base;
}

/** Keep in sync with client-ux.ts — one automatic retry on 503 busy, never 429. */
const BUSY_503_RETRY_MS_MIN = 400;
const BUSY_503_RETRY_MS_MAX = 900;

function shouldRetryBusy503(status: number, attemptIndex: number): boolean {
  return status === 503 && attemptIndex === 0;
}

function busy503RetryDelayMs(random: () => number = Math.random): number {
  return BUSY_503_RETRY_MS_MIN + Math.floor(random() * (BUSY_503_RETRY_MS_MAX - BUSY_503_RETRY_MS_MIN + 1));
}

/** Soft status nudge during the one invisible 503 retry (no second spinner). */
function noteBusy503Retry(): void {
  const note = $("loadingNote");
  if (!note.classList.contains("hidden")) {
    $("loadingDetail").textContent = "Server busy — retrying once…";
  }
}

/**
 * Fetch once; on 503 wait a short jittered delay and retry once, then return
 * the final response (success or still failing). Does not retry 429.
 */
async function fetchWithBusyRetry(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const resp = await fetch(input, init);
  if (!shouldRetryBusy503(resp.status, 0)) return resp;
  void resp.body?.cancel();
  noteBusy503Retry();
  const delay = busy503RetryDelayMs();
  await new Promise<void>((resolve, reject) => {
    const signal = init?.signal;
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(resolve, delay);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true }
    );
  });
  return fetch(input, init);
}
function clearErr(): void {
  $("err").classList.add("hidden");
  $("fileErr").classList.add("hidden");
  clearProveErr();
  clearResultsErr();
}

// Real, pre-compile size signal for a manually chosen upload (as opposed to a
// sample, whose size is already known from the server). This is NOT a guess:
// the file is sent through /api/measure, which runs the exact same
// convert+cache pipeline a real compile uses, so the number is exactly what
// raw_tokens will read after you press Compile — true for every format
// (xlsx, pptx, images, ...), not just plain text. Content-hash caching means
// this upload isn't wasted work: pressing Compile afterward on the same
// bytes hits the cache this call just populated, instead of converting twice.
let measureSeq = 0;

async function estimateUploadSize(f: File): Promise<void> {
  const el = $("docSizeNote");
  const seq = ++measureSeq;
  applyPresets(DEFAULT_PRESETS, null);
  el.textContent = "Measuring document size…";
  el.classList.remove("hidden");
  try {
    const fd = new FormData();
    fd.append("file", f);
    const resp = await fetch("/api/measure", { method: "POST", body: fd });
    const d: MeasureApiResult = await resp.json();
    if (seq !== measureSeq) return; // a newer file was picked while this was in flight
    if (d.error) throw new Error(d.error);
    const presets = computePresets(d.raw_tokens);
    applyPresets(presets, "standard");
    const scaledNote = presets !== DEFAULT_PRESETS ? " Presets below are scaled to it." : "";
    el.textContent = `This document is ~${d.raw_tokens.toLocaleString()} tokens once converted.${scaledNote}`;
  } catch (e) {
    if (seq !== measureSeq) return;
    console.warn("Could not measure the uploaded file ahead of compiling:", e);
    // Formats markitdown can't read at all (e.g. a plain image with no
    // OCR/captioning backend configured) surface their real reason here
    // instead of a generic fallback, so the note stays honest either way.
    el.textContent =
      e instanceof Error && e.message
        ? `Couldn't pre-measure this file: ${e.message}`
        : "Size will be shown after you compile.";
  }
}

// Kept in lockstep with ALLOWED_EXTENSIONS in web.ts (server has the final
// say; this is just so a rejection shows up instantly, before any upload).
// Images are deliberately excluded: markitdown's LLM image captioning only
// works through its Python API with an OpenAI-shaped client, not the CLI
// this demo shells out to — a bare image upload would just fail after a full
// round trip with no useful result. Revisit if that gets wired up.
const ALLOWED_EXT_RE = /\.(docx|pdf|xlsx|pptx|csv|md|markdown|txt|html?)$/i;

// Client-side validation before any network round-trip: catch obviously
// wrong file sizes and unsupported formats immediately instead of after a
// full upload.
$<HTMLInputElement>("file").addEventListener("change", () => {
  const f = $<HTMLInputElement>("file").files?.[0];
  $("fileErr").classList.add("hidden");
  if (f && f.size > maxFileBytes) {
    const mb = Math.round(maxFileBytes / (1024 * 1024));
    $("fileErr").textContent =
      `"${f.name}" is ${(f.size / 1e6).toFixed(1)} MB, over the ${mb} MB limit. Pick a smaller file.`;
    $("fileErr").classList.remove("hidden");
    $<HTMLInputElement>("file").value = "";
    pickedFile = null;
    clearFilePickedStatus();
    return;
  }
  if (f && !ALLOWED_EXT_RE.test(f.name)) {
    $("fileErr").textContent =
      `"${f.name}" isn't a supported format yet. Supported: pdf, docx, xlsx, pptx, csv, md, txt, html. ` +
      `Images aren't supported without an OCR/captioning backend, which this demo doesn't have configured.`;
    $("fileErr").classList.remove("hidden");
    $<HTMLInputElement>("file").value = "";
    pickedFile = null;
    clearFilePickedStatus();
    return;
  }
  if (f) {
    if (shouldClearResultsOnDocChange()) clearCompiledResults();
    // A manually picked file replaces any selected sample, so clear the sample
    // cards' "selected" state. (This only fires for real user picks, not
    // selectSample()'s own programmatic assignment.)
    document.querySelectorAll<HTMLButtonElement>(".scard").forEach((x) => {
      x.classList.remove("active");
      x.setAttribute("aria-pressed", "false");
    });
    pickedFile = f;
    setFilePickedStatus("Selected file: " + f.name);
    estimateUploadSize(f);
  } else {
    pickedFile = null;
    clearFilePickedStatus();
  }
});

function countUp(el: HTMLElement, to: number, suffix = "", dur = 650): void {
  const start = performance.now();
  const step = (now: number) => {
    const p = Math.min(1, (now - start) / dur);
    const v = Math.round(to * (1 - Math.pow(1 - p, 3)));
    el.textContent = v.toLocaleString() + suffix;
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

let savedUsd = 0;
let savedTok = 0;
function bumpSavings(d: CompileApiResult): void {
  savedUsd += Math.max(0, d.cost_raw_usd - d.cost_compiled_usd);
  savedTok += Math.max(0, d.tokens_saved);
  if (!savedTok) return;
  const el = $("sessionSaved");
  el.classList.remove("hidden");
  el.innerHTML =
    "saved this session: $" +
    savedUsd.toFixed(4) +
    "<small>" +
    savedTok.toLocaleString() +
    " tokens · ~$" +
    (savedUsd * 1000).toFixed(0) +
    " per 1,000 reads</small>";
}

function formData(): FormData | null {
  const f = activeFile();
  const task = $<HTMLTextAreaElement>("task").value.trim();
  if (!f || !task) return null;
  const fd = new FormData();
  fd.append("file", f);
  fd.append("task", task);
  fd.append("token_budget", $<HTMLInputElement>("budget").value);
  return fd;
}

let compileAbort: AbortController | null = null;
let proveAbort: AbortController | null = null;
// Whether any compile has ever succeeded this session — decides whether a
// failed/cancelled attempt should hide the (empty) results panel again or
// leave a previous successful result visible underneath the error.
let hasCompiledOnce = false;
/** Omitted-section ids checked “Include in Prove” — sent as expanded_ids. Peeks alone do not count. */
const proveExpandedIds = new Set<string>();
/** Tokens for each included expand (for the “effective Prove context” note). */
const proveExpandedTokens = new Map<string, number>();
/** Compiled content tokens from the last successful compile (selected sections only). */
let lastCompiledContentTokens = 0;
/** Whole-file content token count from the last compile. */
let lastRawTokens = 0;

function setProveInclude(id: string, tokens: number, included: boolean): void {
  if (included) {
    proveExpandedIds.add(id);
    proveExpandedTokens.set(id, tokens);
  } else {
    proveExpandedIds.delete(id);
    proveExpandedTokens.delete(id);
  }
  refreshExpandBudgetNote();
}

function refreshExpandBudgetNote(): void {
  const el = $("expandBudgetNote");
  let expandSum = 0;
  for (const t of proveExpandedTokens.values()) expandSum += t;
  if (!el || expandSum <= 0 || lastCompiledContentTokens <= 0) {
    if (el) {
      el.classList.add("hidden");
      el.innerHTML = "";
    }
    return;
  }
  const total = lastCompiledContentTokens + expandSum;
  let copy =
    "Prove context ≈ <strong>" +
    lastCompiledContentTokens.toLocaleString() +
    "</strong> compiled + <strong>" +
    expandSum.toLocaleString() +
    "</strong> from included expands → <strong>" +
    total.toLocaleString() +
    "</strong> content tokens effective (slider budget was the compile ceiling only. Only sections with Include in Prove add tokens; peeks do not).";
  if (lastRawTokens > 0 && total >= lastRawTokens * 0.95) {
    copy +=
      " This is about the full document (~" +
      total.toLocaleString() +
      " of ~" +
      lastRawTokens.toLocaleString() +
      " content tokens). Consider raising the compile budget to pack both facets, or use Prove against the full file.";
  }
  el.innerHTML = copy;
  el.classList.remove("hidden");
}

function clearProveExpands(): void {
  proveExpandedIds.clear();
  proveExpandedTokens.clear();
  for (const id of ["budgetExpanded", "relevanceExpanded"] as const) {
    const exp = $(id);
    if (exp) exp.innerHTML = "";
  }
  refreshExpandBudgetNote();
}

// First-time conversion can take many seconds (server ceiling ~120s). Show a
// spinner + copy in the results area — not only on the button — and hide the
// empty/stale results panel so the wait isn't buried under placeholder stats.
type LoadingKind = "compile" | "prove";

const LOADING_COPY: Record<LoadingKind, { title: string; detail: string }> = {
  compile: {
    title: "Compiling…",
    detail: "Converting a file for the first time can take a few seconds; cached files are instant.",
  },
  prove: {
    title: "Proving answer parity…",
    detail: "Asking the model twice: full file vs your compile. This can take a few seconds.",
  },
};

function showLoading(kind: LoadingKind = "compile"): void {
  const copy = LOADING_COPY[kind];
  $("loadingTitle").textContent = copy.title;
  $("loadingDetail").textContent = copy.detail;
  const el = $("loadingNote");
  el.classList.remove("hidden");
  el.setAttribute("aria-busy", "true");
  $("resultsSec").classList.remove("hidden");
  $("parity").classList.add("hidden");

  if (kind === "prove") {
    // Keep compile results on screen. Park the wait banner under the Prove
    // controls so the page does not collapse up to a top-of-section spinner.
    if (hasCompiledOnce) $("results").classList.remove("hidden");
    else $("results").classList.add("hidden");
    $("proveActions").after(el);
    return;
  }

  // Compile: hide stale results; banner at the top of resultsSec.
  $("results").classList.add("hidden");
  hideAgentSec();
  const wrap = $("resultsSec").querySelector(".wrap");
  if (wrap) wrap.prepend(el);
  $<HTMLButtonElement>("cancelGo").classList.remove("hidden");
  scrollIntoViewAfterLayout($("resultsSec"));
}
function hideLoading(): void {
  const el = $("loadingNote");
  el.classList.add("hidden");
  el.setAttribute("aria-busy", "false");
  $<HTMLButtonElement>("cancelGo").classList.add("hidden");
  // Park the banner back at the top of resultsSec for the next compile wait.
  const wrap = $("resultsSec").querySelector(".wrap");
  if (wrap) wrap.prepend(el);
}
$<HTMLButtonElement>("cancelGo").onclick = () => {
  compileAbort?.abort();
  agentAbort?.abort();
  proveAbort?.abort();
};

// Wrapping the inputs in a real <form> means pressing Enter in the task
// field submits — no more silent no-op on the most natural keyboard action.
$<HTMLFormElement>("compileForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  clearErr();
  const fd = formData();
  if (!fd) return fail("Pick a file (or a sample) and enter a question.");

  compileAbort?.abort();
  compileAbort = new AbortController();
  const goBtn = $<HTMLButtonElement>("go");
  goBtn.disabled = true;
  goBtn.textContent = "Compiling…";
  announce("Compiling, please wait…");
  // Hide results before clearing agent state — otherwise clearAgentPanel sees
  // stale results on screen and wrongly re-shows the idle agent section.
  showLoading();
  if (shouldClearAgentOnCompile()) clearAgentPanel();
  try {
    const resp = await fetchWithBusyRetry("/api/compile", {
      method: "POST",
      body: fd,
      signal: compileAbort.signal,
    });
    const d: CompileApiResult = await resp
      .json()
      .catch(() => ({ error: "Compile failed." }) as CompileApiResult);
    if (!resp.ok || d.error) throw new Error(await apiFailureMessage(resp, d));
    hideLoading();
    if (shouldClearAgentOnCompile()) clearAgentPanel();
    clearProveExpands();
    lastCompiledContentTokens = d.selected_content_tokens ?? d.tokens_used;
    lastRawTokens = d.raw_tokens;
    lastCompiledBudget = d.token_budget;
    lastCompiledTask = $<HTMLTextAreaElement>("task").value.trim();
    clearResultsStale();
    clearQuestionStale();
    // Now that the real size is known (for an upload, this is the FIRST time
    // it's known at all), refresh the presets to match — without moving the
    // slider off the value just used for this result.
    const presets = computePresets(d.raw_tokens);
    applyPresets(presets, null);
    renderDocSizeNote(d.raw_tokens, presets !== DEFAULT_PRESETS);
    $("resultsSec").classList.remove("hidden");
    $("results").classList.remove("hidden");
    countUp($("sRaw"), d.raw_tokens);
    countUp($("sUsed"), d.tokens_used);
    countUp($("sPct"), Math.round(d.reduction_pct), "%");
    // 0% means packed content tokens ≈ raw (typical only for tiny single-section
    // docs). Coverage-first no longer dumps the whole file when budget ≥ raw —
    // don't paint 0% as the same "success green" as a real cut.
    $("sPct").style.color = d.reduction_pct > 0 ? "var(--green)" : "var(--muted)";
    $("sUsed").style.color = d.reduction_pct > 0 ? "var(--green)" : "var(--text)";
    $("sCost").innerHTML = "$" + d.cost_raw_usd.toFixed(4) + " → $" + d.cost_compiled_usd.toFixed(4);
    $("price").textContent = "@$" + d.price_per_mtok + "/Mtok";
    requestAnimationFrame(() => {
      $("barRaw").style.width = "100%";
      $("barRawVal").textContent = d.raw_tokens.toLocaleString() + " content tokens";
      $("barC").style.width = Math.max(3, (100 * d.tokens_used) / d.raw_tokens) + "%";
      const earlySpare =
        d.compile_hints?.early_stopped && d.token_budget > d.tokens_used
          ? " · " +
            (d.token_budget - d.tokens_used).toLocaleString() +
            " spare under " +
            d.token_budget.toLocaleString() +
            " ceiling"
          : "";
      $("barCVal").textContent = d.tokens_used.toLocaleString() + " content tokens" + earlySpare;
    });
    clearResultsErr();
    $("cacheBadge").textContent = d.cache_hit ? "⚡ conversion cached" : "converted fresh";
    $("cacheBadge").title = d.cache_hit
      ? "This file was already converted. Reused cached markdown. Ranking still ran fresh."
      : "First time we saw this file. Converted and cached by content hash.";
    $("rankBadge").textContent = "bm25 ranking";
    $("omitBadge").textContent =
      d.omitted_sections.length +
      " omitted" +
      (d.budget_omitted_sections?.length ? " · " + d.budget_omitted_sections.length + " budget-blocked" : "");
    $("out").textContent = d.markdown;
    applyLang($("out"), d.markdown);
    renderSections(d);
    renderOmitted(d);
    renderMultiNote(d);
    renderFloorNote(d);
    bumpSavings(d);
    hasCompiledOnce = true;
    setLlmDependentButtons(d.llm_available !== false);
    if (shouldShowAgentSecIdle()) showAgentSecIdle();
    // Move focus (not just scroll) to the results heading so screen-reader
    // and keyboard users land where the sighted eye would. Defer scroll until
    // #results is unhidden and rendered — same-frame scroll is a no-op on first compile.
    scrollIntoViewAfterLayout($("resultsSec"), { behavior: "smooth", block: "start" }, () => {
      $("resultsHeading").focus({ preventScroll: true });
    });
    announce(`Compiled: ${d.reduction_pct}% fewer tokens, ${d.omitted_sections.length} sections omitted.`);
  } catch (e) {
    hideLoading();
    // No prior successful result to fall back to — don't leave an empty
    // results panel showing after a failed/cancelled first attempt.
    if (!hasCompiledOnce) {
      $("resultsSec").classList.add("hidden");
    } else {
      // showLoading hid the panel so the banner could take focus — put it back.
      $("results").classList.remove("hidden");
    }
    if (e instanceof DOMException && e.name === "AbortError") return;
    fail(e instanceof Error ? e.message : String(e));
  } finally {
    goBtn.disabled = false;
    goBtn.textContent = "Compile once";
  }
});

// ---- Agent mode ----------------------------------------------------------
// "Run agent" streams a live trace from /api/agent: the model compiles under
// the user's token-budget slider (same control as Compile), reads the omitted-
// sections manifest, and may expand while under a soft reading ceiling until
// it can answer. We render each step as it arrives, not after the whole run.
let agentAbort: AbortController | null = null;
let agentTokens = 0;
/** Opaque handle from the last successful agent `done` event (for opt-in compare). */
let agentParityHandle: string | null = null;
let agentParityAbort: AbortController | null = null;

const AGENT_ACTIONS: Record<AgentStep["action"], { icon: string; cls: string; label: string }> = {
  compile: { icon: "▤", cls: "a-compile", label: "compile_context" },
  expand: { icon: "⤢", cls: "a-expand", label: "expand_section" },
  recompile: { icon: "↻", cls: "a-recompile", label: "recompile" },
  answer: { icon: "✓", cls: "a-answer", label: "answer" },
};

const STOP_TEXT: Record<AgentRunResult["stopped_reason"], string> = {
  confident: "Stopped when the agent was confident it could answer",
  max_steps: "Hit the step limit and answered with what it had",
  token_ceiling: "Hit the soft token ceiling and answered with what it had",
  whole_file: "The whole file fit, so the agent read all of it",
};

const TOKEN_CEILING_RAISE = "Hit the token budget. Raise the budget slider and run Agent again to read more.";

function stopReasonText(r: AgentRunResult): string {
  if (r.stopped_reason === "token_ceiling" && r.unread_remaining) return TOKEN_CEILING_RAISE;
  return STOP_TEXT[r.stopped_reason];
}

function resetAgentPanelDom(): void {
  $("aSteps").innerHTML = "";
  $("aAnswerWrap").classList.add("hidden");
  $("aParityActions").classList.add("hidden");
  $("aParity").classList.add("hidden");
  $("aParityErr").classList.add("hidden");
  $("aErr").classList.add("hidden");
  $("aAnswer").textContent = "";
  $("aStopped").textContent = "";
  $("aAnsFull").textContent = "";
  $("aAnsAgent").textContent = "";
  $("aParityModel").textContent = "";
  $("aTokens").textContent = "0";
  $("aWhole").textContent = "";
  $("aBar").style.width = "0%";
  const parityBtn = $<HTMLButtonElement>("aParityBtn");
  parityBtn.disabled = !llmAvailable;
  parityBtn.textContent = "Compare to full file";
}

function hideAgentSec(): void {
  $("agentSec").classList.add("hidden");
  $("agentIdleCta").classList.add("hidden");
  $("agentRunBody").classList.add("hidden");
}

function showAgentSecIdle(): void {
  $("agentSec").classList.remove("hidden");
  $("agentIdleCta").classList.remove("hidden");
  $("agentRunBody").classList.add("hidden");
  hideAgentLoading();
}

function showAgentSecRunning(): void {
  $("agentSec").classList.remove("hidden");
  $("agentIdleCta").classList.add("hidden");
  $("agentRunBody").classList.remove("hidden");
}

function syncAgentButtonsIdle(): void {
  const top = $<HTMLButtonElement>("goAgent");
  const below = $<HTMLButtonElement>("goAgentBelow");
  if (top.textContent === "Agent working…") {
    top.disabled = !llmAvailable || isQuestionStale();
    top.textContent = "Run agent ▸";
  }
  if (below.textContent === "Agent working…") {
    below.disabled = !llmAvailable || isQuestionStale();
    below.textContent = "Run agent ▸";
  }
}

/** Hide agent UI and drop in-flight / cached agent state (mirrors budget-stale for Prove). */
function clearAgentPanel(): void {
  agentAbort?.abort();
  agentParityAbort?.abort();
  agentTokens = 0;
  agentParityHandle = null;
  hideAgentLoading();
  resetAgentPanelDom();
  syncAgentButtonsIdle();
  if (shouldShowAgentSecIdle()) showAgentSecIdle();
  else hideAgentSec();
}

/**
 * Document changed (sample / file): abort in-flight work and hide compiled results + agent.
 * Question-only edits use onTaskUserChange (soft-stale). Budget edits use onBudgetUserChange.
 */
function clearCompiledResults(): void {
  compileAbort?.abort();
  proveAbort?.abort();
  clearProveExpands();
  clearResultsStale();
  clearQuestionStale();
  hideLoading();
  hasCompiledOnce = false;
  lastCompiledBudget = null;
  lastCompiledTask = null;
  lastCompiledContentTokens = 0;
  lastRawTokens = 0;

  $("resultsSec").classList.add("hidden");
  $("results").classList.add("hidden");
  clearAgentPanel();
  $("parity").classList.add("hidden");
  $("proveActions").classList.add("hidden");
  clearResultsErr();

  $("sections").innerHTML = "";
  $("out").textContent = "";
  $("out").classList.add("hidden");
  $("sections").classList.remove("hidden");
  const viewBtn = $<HTMLButtonElement>("viewToggle");
  viewBtn.textContent = "See exact text sent to AI";
  viewBtn.setAttribute("aria-pressed", "false");

  for (const id of ["multiNote", "floorNote"] as const) {
    const el = $(id);
    el.classList.add("hidden");
    el.innerHTML = "";
  }
  $("budgetOmitRow").classList.add("hidden");
  $("relevanceOmitRow").classList.add("hidden");
  $("budgetOmitCards").innerHTML = "";
  $("budgetExpanded").innerHTML = "";
  $("relevanceOmitChips").innerHTML = "";
  $("relevanceExpanded").innerHTML = "";
  $("budgetOmitDesc").textContent = "";
  $("relevanceOmitSummary").textContent = "";

  $("sRaw").textContent = "–";
  $("sUsed").textContent = "–";
  $("sPct").textContent = "–";
  $("sCost").textContent = "–";
  $("price").textContent = "";
  $("barRawVal").textContent = "–";
  $("barCVal").textContent = "–";
  $("barRaw").style.width = "100%";
  $("barC").style.width = "100%";
  $("cacheBadge").textContent = "";
  $("rankBadge").textContent = "";
  $("omitBadge").textContent = "";
  $("ansFull").textContent = "";
  $("ansCompiled").textContent = "";
  $("parityModel").textContent = "";

  const goBtn = $<HTMLButtonElement>("go");
  if (goBtn.textContent === "Compiling…") {
    goBtn.disabled = false;
    goBtn.textContent = "Compile once";
  }
  setProveButtonsBusy(false);
}

function startAgentPanel(): void {
  agentTokens = 0;
  agentParityHandle = null;
  agentParityAbort?.abort();
  resetAgentPanelDom();
  showAgentSecRunning();
  const wait = $("agentLoadingNote");
  wait.classList.remove("hidden");
  wait.setAttribute("aria-busy", "true");
  $<HTMLButtonElement>("cancelGo").classList.remove("hidden");
  scrollIntoViewAfterLayout($("agentSec"), { behavior: "smooth", block: "start" }, () => {
    $("agentHeading").focus({ preventScroll: true });
  });
  announce("Agent started.");
}

function hideAgentLoading(): void {
  const wait = $("agentLoadingNote");
  wait.classList.add("hidden");
  wait.setAttribute("aria-busy", "false");
}

function onAgentStep(step: AgentStep): void {
  hideAgentLoading();
  agentTokens += step.tokens_added;
  $("aTokens").textContent = agentTokens.toLocaleString();
  const meta = AGENT_ACTIONS[step.action];
  const suffix = step.section_id
    ? ' <span class="amono">' + esc(step.section_id) + (step.truncated ? " (truncated)" : "") + "</span>"
    : step.action === "compile" || step.action === "recompile"
      ? ' <span class="afaint">' + esc(step.detail) + "</span>"
      : "";
  const card = document.createElement("div");
  card.className = "astep " + meta.cls;
  card.innerHTML =
    '<div class="aicon" aria-hidden="true">' +
    meta.icon +
    "</div>" +
    '<div class="abody"><div class="atitle">Step ' +
    step.n +
    " · " +
    meta.label +
    suffix +
    "</div>" +
    (step.reasoning ? '<div class="areason">' + esc(step.reasoning) + "</div>" : "") +
    "</div>" +
    '<div class="adelta">' +
    (step.tokens_added > 0 ? "+" + step.tokens_added.toLocaleString() : "") +
    "</div>";
  $("aSteps").appendChild(card);
}

function onAgentDone(r: AgentRunResult): void {
  hideAgentLoading();
  $("aTokens").textContent = r.tokens_read.toLocaleString();
  $("aWhole").textContent = r.raw_tokens.toLocaleString() + " if you dumped the whole file";
  const pct = Math.round((100 * r.tokens_read) / r.raw_tokens);
  const ceiling = Number($<HTMLInputElement>("budget").value) || 0;
  requestAnimationFrame(() => {
    $("aBar").style.width = Math.max(3, Math.min(100, pct)) + "%";
  });
  $("aAnswer").textContent = r.answer;
  applyLang($("aAnswer"), r.answer);
  const over =
    r.stopped_reason === "token_ceiling"
      ? ""
      : ceiling > 0 && r.tokens_read > ceiling
        ? r.tokens_read <= ceiling + Math.max(50, Math.round(ceiling * 0.15))
          ? " Soft ceiling was " + ceiling.toLocaleString() + " (finished a little over)."
          : " Soft ceiling was " + ceiling.toLocaleString() + "."
        : "";
  $("aStopped").textContent =
    stopReasonText(r) +
    " · reading " +
    r.tokens_read.toLocaleString() +
    " content tokens (" +
    pct +
    "% of the file)." +
    over;
  $("aAnswerWrap").classList.remove("hidden");
  agentParityHandle = r.parity_handle ?? null;
  if (agentParityHandle && llmAvailable) {
    $("aParityActions").classList.remove("hidden");
  } else {
    $("aParityActions").classList.add("hidden");
  }
  $("agentHeading").focus();
  announce(
    "Agent finished. Read " +
      r.tokens_read.toLocaleString() +
      " of " +
      r.raw_tokens.toLocaleString() +
      " tokens."
  );
}

function agentError(msg: string): void {
  hideAgentLoading();
  const el = $("aErr");
  el.textContent = msg;
  el.classList.remove("hidden");
  announce("Agent error: " + msg);
}

/** After a failed agent run, bring back Run agent when compile results are still valid. */
function restoreAgentRetryAfterError(): void {
  if (shouldShowAgentSecIdle()) showAgentSecIdle();
}

// Parse a fetch SSE body into {event, data} records and hand each to `on` as it
// arrives. Events are separated by a blank line; we buffer across chunks.
async function consumeSse(
  body: ReadableStream<Uint8Array>,
  on: (event: string, data: unknown) => void
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx = buf.indexOf("\n\n");
    while (idx >= 0) {
      const block = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const event = /^event: (.*)$/m.exec(block)?.[1] ?? "message";
      const data = /^data: (.*)$/m.exec(block)?.[1];
      if (data) on(event, JSON.parse(data));
      idx = buf.indexOf("\n\n");
    }
  }
}

async function runAgentFlow(): Promise<void> {
  clearErr();
  $("aErr").classList.add("hidden");
  if (isQuestionStale()) {
    $("agentSec").classList.remove("hidden");
    agentError("Question changed since last compile. Click Compile once to refresh.");
    return;
  }
  const f = activeFile();
  const task = $<HTMLTextAreaElement>("task").value.trim();
  if (!f || !task) {
    fail("Pick a file (or a sample) and enter a question.");
    return;
  }

  const fd = new FormData();
  fd.append("file", f);
  fd.append("task", task);
  fd.append("token_budget", $<HTMLInputElement>("budget").value);

  agentAbort?.abort();
  agentAbort = new AbortController();
  const topBtn = $<HTMLButtonElement>("goAgent");
  const belowBtn = $<HTMLButtonElement>("goAgentBelow");
  topBtn.disabled = true;
  belowBtn.disabled = true;
  topBtn.textContent = "Agent working…";
  belowBtn.textContent = "Agent working…";
  startAgentPanel();
  let gotDone = false;
  try {
    const resp = await fetchWithBusyRetry("/api/agent", {
      method: "POST",
      body: fd,
      signal: agentAbort.signal,
    });
    const ctype = resp.headers.get("content-type") ?? "";
    if (!ctype.includes("text/event-stream") || !resp.body) {
      // A guard rejected the request before the stream opened → JSON error body.
      const d = (await resp.json().catch(() => ({ error: "Agent request failed." }))) as { error?: string };
      throw new Error(apiFailureMessage(resp, d, "agent"));
    }
    await consumeSse(resp.body, (event, data) => {
      if (event === "step") onAgentStep(data as AgentStep);
      else if (event === "done") {
        gotDone = true;
        onAgentDone(data as AgentRunResult);
      } else if (event === "error") throw new Error((data as { error: string }).error);
    });
    if (!gotDone) {
      throw new Error("Agent connection ended before a result. Try Run agent again.");
    }
  } catch (e) {
    hideAgentLoading();
    if (e instanceof DOMException && e.name === "AbortError") {
      // Keep partial steps visible — wiping the panel makes cancel look broken.
      agentError("Cancelled. Partial steps above are incomplete — Run agent again to start fresh.");
      announce("Agent cancelled.");
      return;
    }
    agentError(e instanceof Error ? e.message : String(e));
    restoreAgentRetryAfterError();
  } finally {
    const qStale = isQuestionStale();
    topBtn.disabled = !llmAvailable || qStale;
    belowBtn.disabled = !llmAvailable || qStale;
    topBtn.textContent = "Run agent ▸";
    belowBtn.textContent = "Run agent ▸";
    $<HTMLButtonElement>("cancelGo").classList.add("hidden");
  }
}
$<HTMLButtonElement>("goAgent").onclick = () => void runAgentFlow();
$<HTMLButtonElement>("goAgentBelow").onclick = () => void runAgentFlow();

$<HTMLButtonElement>("aParityBtn").onclick = async () => {
  clearErr();
  $("aParityErr").classList.add("hidden");
  if (!agentParityHandle) {
    const el = $("aParityErr");
    el.textContent = "Run the agent again to unlock comparison.";
    el.classList.remove("hidden");
    return;
  }
  agentParityAbort?.abort();
  agentParityAbort = new AbortController();
  const btn = $<HTMLButtonElement>("aParityBtn");
  btn.disabled = true;
  btn.textContent = "Comparing…";
  announce("Comparing agent context to the full file…");
  try {
    const resp = await fetch("/api/agent-parity", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ parity_handle: agentParityHandle }),
      signal: agentParityAbort.signal,
    });
    const d: AgentParityResult = await resp
      .json()
      .catch(() => ({ error: "Comparison failed." }) as AgentParityResult);
    if (!resp.ok || d.error) throw new Error(apiFailureMessage(resp, d, "agentParity"));
    $("aParity").classList.remove("hidden");
    $("aParityModel").textContent = d.model;
    $("aAnsFull").textContent = d.full.answer;
    applyLang($("aAnsFull"), d.full.answer);
    $("aAnsFullCost").textContent = d.full.context_tokens.toLocaleString() + " content tokens";
    $("aAnsAgent").textContent = d.agent.answer;
    applyLang($("aAnsAgent"), d.agent.answer);
    $("aAnsAgentCost").textContent = d.agent.context_tokens.toLocaleString() + " content tokens";
    $("aParity").scrollIntoView({ behavior: "smooth", block: "nearest" });
    announce("Agent vs full-file comparison ready.");
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") return;
    const el = $("aParityErr");
    el.textContent = e instanceof Error ? e.message : String(e);
    el.classList.remove("hidden");
    announce("Comparison error: " + el.textContent);
  } finally {
    btn.disabled = !llmAvailable || !agentParityHandle;
    btn.textContent = "Compare to full file";
  }
};

function renderSections(d: CompileApiResult): void {
  const wrap = $("sections");
  wrap.innerHTML = "";
  const cards = [...d.selected_sections].sort((a, b) => (b.relevance ?? 0) - (a.relevance ?? 0));
  if (!cards.length) {
    const empty = document.createElement("p");
    empty.className = "qhint compiled-empty";
    empty.textContent =
      "No sections fit this budget. See the note above to raise it, or peek an omitted section below.";
    wrap.appendChild(empty);
    return;
  }
  cards.forEach((s, i) => {
    const el = document.createElement("div");
    el.className = "seccard";
    const nmText = lastCrumb(s.section);
    const h = document.createElement("div");
    h.className = "h";
    const nmSpan = document.createElement("span");
    nmSpan.className = "nm";
    const rankSpan = document.createElement("span");
    rankSpan.className = "rank";
    rankSpan.textContent = `#${i + 1} `;
    nmSpan.appendChild(rankSpan);
    nmSpan.appendChild(langSpan(nmText));
    // Multi-query: tag every sub-question this section is relevant to (a
    // section often covers more than one), best-match first.
    if (d.queries && d.queries.length > 1 && s.matched_queries && s.matched_queries.length) {
      s.matched_queries.forEach((qi, k) => {
        const qt = document.createElement("span");
        qt.className = "qtag" + (k > 0 ? " alt" : "");
        qt.textContent = "Q" + (qi + 1);
        qt.title = (k === 0 ? "Best answers: " : "Also a top match for: ") + d.queries[qi];
        nmSpan.appendChild(document.createTextNode(" "));
        nmSpan.appendChild(qt);
      });
    }
    const meta = document.createElement("span");
    meta.className = "meta";
    const remainder =
      s.truncated && s.full_tokens && s.full_tokens > s.tokens
        ? (s.remainder_tokens ?? s.full_tokens - s.tokens)
        : 0;
    meta.textContent =
      s.truncated && s.full_tokens
        ? truncatedSectionMetaCopy(s.tokens, s.full_tokens, remainder, s.relevance)
        : (s.relevance != null ? "relevance " + s.relevance + "% · " : "") +
          s.tokens.toLocaleString() +
          " content tokens";
    h.append(nmSpan, meta);
    if (s.truncated) {
      const badge = document.createElement("span");
      badge.className = "seccard-trunc-badge";
      badge.textContent = "truncated";
      h.appendChild(badge);
    }
    el.appendChild(h);
    if (s.relevance != null) {
      const bar = document.createElement("div");
      bar.className = "relbar";
      const i2 = document.createElement("i");
      i2.style.width = s.relevance + "%";
      bar.appendChild(i2);
      el.appendChild(bar);
    }
    if (s.text) {
      const p = document.createElement("pre");
      applyLang(p, s.text);
      p.textContent = s.text;
      el.appendChild(p);
    }
    if (s.truncated && remainder > 0) {
      const actions = document.createElement("div");
      actions.className = "seccard-trunc-actions";

      const includeLab = document.createElement("label");
      includeLab.className = "seccard-include";
      includeLab.addEventListener("click", (ev) => ev.stopPropagation());
      const includeCb = document.createElement("input");
      includeCb.type = "checkbox";
      includeCb.checked = proveExpandedIds.has(s.id);
      includeLab.appendChild(includeCb);
      includeLab.appendChild(document.createTextNode(" Include rest in Prove"));
      const includeHint = document.createElement("span");
      includeHint.className = "seccard-include-hint";
      if (includeCb.checked) {
        includeHint.textContent = includeRestHintCopy(remainder, lastCrumb(s.section));
      }
      includeLab.appendChild(includeHint);

      includeCb.addEventListener("change", () => {
        setProveInclude(s.id, remainder, includeCb.checked);
        includeHint.textContent = includeCb.checked
          ? includeRestHintCopy(remainder, lastCrumb(s.section))
          : "";
        if (includeCb.checked) {
          announce(
            "Included rest of " +
              lastCrumb(s.section) +
              " in Prove (~" +
              remainder.toLocaleString() +
              " content tokens)."
          );
        } else {
          // Contract: uncheck clears Prove Include only — peek-rest stays open.
          if (shouldRemovePeekOnUncheck()) {
            el.querySelector('.seccard-rest-peek[data-section-id="' + s.id + '"]')?.remove();
          }
          announce("Removed rest of " + lastCrumb(s.section) + " from Prove.");
        }
      });

      const peekBtn = document.createElement("button");
      peekBtn.type = "button";
      peekBtn.className = "peek-rest";
      peekBtn.textContent = "Peek rest";

      actions.append(includeLab, peekBtn);
      el.appendChild(actions);

      peekBtn.addEventListener("click", async () => {
        if (el.querySelector('.seccard-rest-peek[data-section-id="' + s.id + '"]')) return;
        peekBtn.disabled = true;
        try {
          const resp = await fetchWithBusyRetry("/api/expand", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ handle: d.handle, section_id: s.id }),
          });
          const e: ExpandApiResult = await resp.json();
          if (e.error) throw new Error(e.error);
          const fullText = e.markdown.replace(/^<!--[\s\S]*?-->\n?/, "").trim();
          const partialLen = s.text?.length ?? 0;
          const restText =
            fullText.length > partialLen && fullText.startsWith(s.text ?? "")
              ? fullText.slice(partialLen).trim()
              : fullText;
          const det = document.createElement("details");
          det.className = "seccard-rest-peek";
          det.dataset.sectionId = s.id;
          det.open = true;
          const sum = document.createElement("summary");
          sum.textContent = "Unread remainder (~" + remainder.toLocaleString() + " content tokens)";
          const pre = document.createElement("pre");
          pre.textContent = restText || "(no additional text beyond the partial above)";
          det.append(sum, pre);
          actions.appendChild(det);
          peekBtn.classList.add("hidden");
        } catch (err) {
          resultsError(err instanceof Error ? err.message : String(err));
          peekBtn.disabled = false;
        }
      });
    }
    wrap.appendChild(el);
  });
}

// When the task held several questions, show that we split it and merged the
// best sections for each — otherwise multi-question retrieval looks like magic.
function renderMultiNote(d: CompileApiResult): void {
  const el = $("multiNote");
  el.classList.add("hidden");
  el.innerHTML = "";
  if (!d.queries || d.queries.length < 2) return;
  const items = d.queries
    .map((q, i) => '<li><span class="qtag">Q' + (i + 1) + "</span> " + esc(q) + "</li>")
    .join("");
  let html =
    "<strong>Detected " +
    d.queries.length +
    " questions.</strong> Each was ranked on its own and the " +
    "top sections merged (round-robin), so every question is represented rather than the keyword-heaviest one " +
    "crowding out the rest. The tag on each section below shows which question it best answers." +
    '<ol style="margin:6px 0 0;padding-left:20px;list-style:none">' +
    items +
    "</ol>";
  if (d.compile_hints?.multi_part_nudge && !d.budget_omitted_sections?.length) {
    html +=
      '<p style="margin:10px 0 0"><strong>Multi-part question.</strong> This may need more than one section. ' +
      "Check omitted sections below or raise the budget if the answer looks incomplete.</p>";
  }
  el.innerHTML = html;
  el.classList.remove("hidden");
}

// Explain WHY a bigger budget sometimes changes nothing: coverage-first packing
// stops once facets/terms are covered (budget is a ceiling). Without this note,
// "quick fact" and "deep dive" can look identical for no visible reason.
function renderFloorNote(d: CompileApiResult): void {
  const el = $("floorNote");
  el.classList.add("hidden");
  el.innerHTML = "";
  // Use the budget the server actually applied, not the live slider — they can
  // differ (server clamps), and the note must never contradict the result.
  const budget = d.token_budget;
  // Only claim "returned in full" when nothing was omitted. reduction_pct===0
  // alone is not the old whole-file short-circuit (that path is gone).
  if (d.reduction_pct === 0 && d.omitted_sections.length === 0) {
    el.innerHTML =
      "<strong>Whole file fit your budget.</strong> The document is " +
      d.raw_tokens.toLocaleString() +
      " tokens, under your " +
      budget.toLocaleString() +
      "-token budget, and every section was kept. " +
      "Nothing to leave out. Lower the budget (try “quick fact”) to see compilation drop sections.";
    el.classList.remove("hidden");
    return;
  }
  // Nothing survived at all: every section, including the best match, was too
  // big for this budget. Must NOT claim "lower-relevance sections are shown
  // instead" — nothing is shown. Say so plainly and point at the one to expand.
  const selRel = Math.max(0, ...d.selected_sections.map((s) => s.relevance || 0));
  const topOmit = d.omitted_sections.reduce<SectionInfo | null>(
    (a, s) => ((s.relevance || 0) > (a?.relevance || 0) ? s : a),
    null
  );
  const hasBudgetOmits = (d.budget_omitted_sections?.length ?? 0) > 0;
  if (topOmit && d.selected_sections.length === 0) {
    // Suggested budget: the section's size plus ~80 tokens of wrapper overhead,
    // rounded up to a tidy hundred.
    const need = Math.ceil((topOmit.tokens + 80) / 100) * 100;
    const inOmitUi = Boolean(
      d.budget_omitted_sections?.some((s) => s.id === topOmit.id) ||
      d.relevance_omitted_sections?.some((s) => s.id === topOmit.id)
    );
    el.innerHTML =
      "<strong>Nothing fit your budget.</strong> Even the best match, “" +
      esc(lastCrumb(topOmit.section)) +
      "” (" +
      topOmit.relevance +
      "% relevant, " +
      topOmit.tokens.toLocaleString() +
      " tokens) is larger than your " +
      budget.toLocaleString() +
      "-token budget, so no section is shown below. " +
      "Raise the budget to about " +
      need.toLocaleString() +
      " tokens" +
      (inOmitUi
        ? ", or peek it in the omitted sections below."
        : ", or fetch it with <code>expand_section</code> (<code>" + topOmit.id + "</code>).");
    el.classList.remove("hidden");
    return;
  }
  // More-relevant section omitted while a weaker one is shown. Usually that
  // means the top hit alone exceeds the budget; if it would fit, say so
  // instead of claiming it's "larger than" the budget (that was a real bug
  // when packing order starved a fitting 100% section).
  if (!hasBudgetOmits && topOmit && (topOmit.relevance || 0) > selRel) {
    const need = Math.ceil((topOmit.tokens + 80) / 100) * 100;
    const tooBigAlone = topOmit.tokens + 80 > budget;
    const inOmitUi = Boolean(
      d.budget_omitted_sections?.some((s) => s.id === topOmit.id) ||
      d.relevance_omitted_sections?.some((s) => s.id === topOmit.id)
    );
    const fetchHint = inOmitUi
      ? " Peek it in the omitted sections below."
      : " Fetch it with <code>expand_section</code> (<code>" + topOmit.id + "</code>).";
    el.innerHTML = tooBigAlone
      ? "<strong>The most relevant section didn’t fit.</strong> “" +
        esc(lastCrumb(topOmit.section)) +
        "” (" +
        topOmit.relevance +
        "% relevant, " +
        topOmit.tokens.toLocaleString() +
        " tokens) is larger than your " +
        budget.toLocaleString() +
        "-token budget, so lower-relevance sections are shown instead. " +
        "Raise the budget to about " +
        need.toLocaleString() +
        " tokens." +
        fetchHint
      : "<strong>The most relevant section was left out.</strong> “" +
        esc(lastCrumb(topOmit.section)) +
        "” (" +
        topOmit.relevance +
        "% relevant, " +
        topOmit.tokens.toLocaleString() +
        " tokens) fits your " +
        budget.toLocaleString() +
        "-token budget but wasn’t selected." +
        fetchHint;
    el.classList.remove("hidden");
    return;
  }
  const hint = d.next_section_hint;
  const hintInBudgetOmits = Boolean(hint && d.budget_omitted_sections?.some((s) => s.id === hint.id));
  const louderOmitShown = Boolean(
    (hasBudgetOmits && hintInBudgetOmits) ||
    (!hasBudgetOmits && topOmit && (topOmit.relevance || 0) > selRel) ||
    (hint && !hintInBudgetOmits)
  );
  if (!hasBudgetOmits && !louderOmitShown && d.compile_hints?.omit_action) {
    const named = d.compile_hints.named_omit;
    const multi = (d.queries?.length ?? 0) >= 2;
    let html =
      "<strong>Sections were omitted.</strong> " +
      (multi ? "This question spans multiple facets; what fit may not cover all of them. " : "") +
      "If the answer looks incomplete, peek omitted sections below or raise the budget.";
    if (named) {
      html +=
        " Left out: “" +
        esc(lastCrumb(named.section)) +
        "” (" +
        (named.relevance != null ? named.relevance + "% relevant, " : "") +
        named.tokens.toLocaleString() +
        " tokens).";
    }
    el.innerHTML = html;
    el.classList.remove("hidden");
    return;
  }
  const spare = budget - d.tokens_used;
  const budgetBound = spare < budget * 0.12; // used almost the whole budget
  if (hint) {
    const truncatedHint = d.selected_sections.some((s) => s.truncated && s.id === hint.id);
    const hintInOmitUi = Boolean(
      d.budget_omitted_sections?.some((s) => s.id === hint.id) ||
      d.relevance_omitted_sections?.some((s) => s.id === hint.id)
    );
    if (truncatedHint || !hintInBudgetOmits) {
      // Truncated selected: point at Peek rest / Include rest on the Included card.
      // Fully omitted: mention expand_section only when that id has an omit chip/card.
      let body: string;
      if (truncatedHint) {
        body =
          "“" +
          esc(lastCrumb(hint.section)) +
          "” (" +
          hint.relevance +
          "% relevant) is included only in part under your " +
          budget.toLocaleString() +
          "-token ceiling. Raise the budget to about " +
          hint.suggested_budget.toLocaleString() +
          " tokens for the full section, or use " +
          "<strong>Peek rest</strong> or <strong>Include rest in Prove</strong> on that included card below.";
      } else {
        body =
          "Selection stopped at your " +
          budget.toLocaleString() +
          "-token ceiling. Also left out: “" +
          esc(lastCrumb(hint.section)) +
          "” (" +
          hint.relevance +
          "% relevant, " +
          hint.tokens.toLocaleString() +
          " tokens). Raise the budget to about " +
          hint.suggested_budget.toLocaleString() +
          " tokens to keep what’s selected and add it";
        if (hintInOmitUi) {
          body += ", or peek it in the omitted sections below.";
        } else {
          body += ".";
        }
      }
      el.innerHTML = "<strong>Budget-bound.</strong> " + body;
      el.classList.remove("hidden");
      return;
    }
  }
  if (budgetBound) {
    el.innerHTML =
      "<strong>Budget-bound.</strong> Selection stopped because it hit your " +
      budget.toLocaleString() +
      "-token ceiling, not the relevance floor. A larger budget would pull in more sections.";
  } else if (d.compile_hints?.early_stopped) {
    el.innerHTML =
      "<strong>Coverage complete.</strong> Packed enough for this question under your " +
      budget.toLocaleString() +
      "-token ceiling. Spare budget was left unused. Raise the budget only if the answer looks incomplete.";
  } else {
    el.innerHTML =
      "<strong>Relevance-bound, not budget-bound.</strong> Only <strong>" +
      d.selected_sections.length +
      "</strong> section" +
      (d.selected_sections.length === 1 ? "" : "s") +
      " cleared the relevance / early-stop thresholds. " +
      "the rest scored too low to matter for this question. Used <strong>" +
      d.tokens_used.toLocaleString() +
      "</strong> of your " +
      budget.toLocaleString() +
      "-token budget, so a bigger budget (e.g. “deep dive”) adds nothing here. " +
      "That's the point: the tool sends what's relevant, not whatever fills the budget.";
  }
  el.classList.remove("hidden");
}

const CHIP_PAGE = 12; // avoid an unbounded wall of chips on long documents

function budgetOmitWhyCopy(s: BudgetOmitSection, d: CompileApiResult): string {
  const gaps = s.gap_queries ?? [];
  if (gaps.length && d.queries?.length) {
    const labels = gaps.map((qi) => "Q" + (qi + 1)).join(", ");
    return (
      "Best match for " +
      labels +
      " left out because it didn't fit your " +
      d.token_budget.toLocaleString() +
      "-token budget."
    );
  }
  const rel = s.relevance != null ? s.relevance + "% relevant, " : "";
  return (
    "“" +
    lastCrumb(s.section) +
    "” (" +
    rel +
    s.tokens.toLocaleString() +
    " tokens) left out because it didn't fit your " +
    d.token_budget.toLocaleString() +
    "-token budget."
  );
}

function appendExpblk(o: SectionInfo, exp: HTMLElement, e: ExpandApiResult, open: boolean): void {
  const tok = e.tokens_used || o.tokens || 0;
  const blk = document.createElement("details");
  blk.className = "expblk";
  blk.dataset.sectionId = o.id;
  blk.open = open;

  const sum = document.createElement("summary");
  const title = document.createElement("span");
  title.className = "expblk-title";
  title.textContent = o.id + " · " + lastCrumb(o.section) + " → " + (e.tokens_used || "?") + " tokens";

  const includeLab = document.createElement("label");
  includeLab.className = "expblk-include";
  includeLab.addEventListener("click", (ev) => ev.stopPropagation());
  const includeCb = document.createElement("input");
  includeCb.type = "checkbox";
  includeCb.checked = false;
  includeLab.appendChild(includeCb);
  includeLab.appendChild(document.createTextNode(" Include in Prove"));
  const includeHint = document.createElement("span");
  includeHint.className = "expblk-include-hint hidden";
  includeHint.setAttribute("aria-live", "polite");
  includeLab.appendChild(includeHint);

  function syncIncludeHint(): void {
    if (includeCb.checked) {
      includeHint.textContent = includeRestHintCopy(tok, lastCrumb(o.section));
      includeHint.classList.remove("hidden");
    } else {
      includeHint.textContent = "";
      includeHint.classList.add("hidden");
    }
  }

  if (proveExpandedIds.has(o.id)) {
    includeCb.checked = true;
    syncIncludeHint();
  }

  includeCb.addEventListener("change", () => {
    setProveInclude(o.id, tok, includeCb.checked);
    syncIncludeHint();
    if (includeCb.checked) {
      const est = lastCompiledContentTokens + [...proveExpandedTokens.values()].reduce((a, b) => a + b, 0);
      announce(
        "Included " +
          lastCrumb(o.section) +
          " in Prove. Effective context ≈ " +
          est.toLocaleString() +
          " content tokens."
      );
    } else {
      // Contract: uncheck clears Prove Include only — peek (this expblk) stays.
      if (shouldRemovePeekOnUncheck()) blk.remove();
      announce("Removed " + lastCrumb(o.section) + " from Prove (peek kept).");
    }
  });

  sum.appendChild(title);
  sum.appendChild(includeLab);
  const pre = document.createElement("pre");
  pre.textContent = e.markdown;
  blk.appendChild(sum);
  blk.appendChild(pre);
  exp.appendChild(blk);
}

async function peekSection(
  o: SectionInfo,
  d: CompileApiResult,
  exp: HTMLElement,
  open: boolean,
  chip?: HTMLButtonElement
): Promise<void> {
  if (exp.querySelector('.expblk[data-section-id="' + o.id + '"]')) return;
  if (chip) {
    chip.disabled = true;
    chip.classList.add("done");
  }
  try {
    const resp = await fetchWithBusyRetry("/api/expand", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ handle: d.handle, section_id: o.id }),
    });
    const e: ExpandApiResult = await resp.json();
    if (e.error) throw new Error(e.error);
    appendExpblk(o, exp, e, open);
    announce(
      open
        ? "Loaded omitted section: " + lastCrumb(o.section) + ". Check Include in Prove to add its tokens."
        : "Peeked section: " +
            lastCrumb(o.section) +
            ". Not in Prove yet. Check Include in Prove to add its tokens."
    );
  } catch (err) {
    if (chip) {
      chip.classList.remove("done");
      chip.disabled = false;
    }
    resultsError(err instanceof Error ? err.message : String(err));
  } finally {
    if (chip) chip.disabled = false;
  }
}

function makeChip(
  o: SectionInfo,
  d: CompileApiResult,
  exp: HTMLElement,
  openOnPeek = false
): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "ochip";
  b.textContent =
    o.id +
    " · " +
    lastCrumb(o.section) +
    (o.relevance != null ? " · rel " + o.relevance + "%" : "") +
    " (~" +
    o.tokens +
    " tok)";
  b.setAttribute("aria-label", "Peek omitted section: " + lastCrumb(o.section));
  b.onclick = () => {
    if (b.classList.contains("done")) return;
    void peekSection(o, d, exp, openOnPeek || exp.querySelectorAll(".expblk").length === 0, b);
  };
  return b;
}

function renderBudgetOmitCard(s: BudgetOmitSection, d: CompileApiResult, cards: HTMLElement): void {
  const card = document.createElement("div");
  card.className = "budget-omit-card";
  const h = document.createElement("div");
  h.className = "h";
  const nm = document.createElement("span");
  nm.className = "nm";
  nm.textContent = s.id + " · " + lastCrumb(s.section);
  const meta = document.createElement("span");
  meta.className = "meta";
  meta.textContent =
    (s.relevance != null ? s.relevance + "% relevant · " : "") + s.tokens.toLocaleString() + " tokens";
  h.append(nm, meta);
  const why = document.createElement("p");
  why.className = "why";
  why.textContent = budgetOmitWhyCopy(s, d);
  if (s.suggested_budget) {
    why.textContent +=
      " Raise the budget to about " + s.suggested_budget.toLocaleString() + " tokens to include it.";
  }
  card.append(h, why);
  cards.appendChild(card);
}

function renderOmitChips(
  sections: SectionInfo[],
  d: CompileApiResult,
  chips: HTMLElement,
  exp: HTMLElement
): void {
  const first = sections.slice(0, CHIP_PAGE);
  const rest = sections.slice(CHIP_PAGE);
  first.forEach((o) => chips.appendChild(makeChip(o, d, exp)));
  if (rest.length) {
    const more = document.createElement("button");
    more.type = "button";
    more.className = "ochip-more";
    more.textContent = `+ show ${rest.length} more omitted section${rest.length === 1 ? "" : "s"}`;
    more.onclick = () => {
      rest.forEach((o) => chips.insertBefore(makeChip(o, d, exp), more));
      more.remove();
      announce(rest.length + " more omitted sections shown.");
    };
    chips.appendChild(more);
  }
}

function renderOmitted(d: CompileApiResult): void {
  const budgetRow = $("budgetOmitRow");
  const relevanceRow = $("relevanceOmitRow");
  const budgetCards = $("budgetOmitCards");
  const budgetExp = $("budgetExpanded");
  const relChips = $("relevanceOmitChips");
  const relExp = $("relevanceExpanded");
  const relSummary = $("relevanceOmitSummary");

  budgetCards.innerHTML = "";
  budgetExp.innerHTML = "";
  relChips.innerHTML = "";
  relExp.innerHTML = "";

  const budgetOmits = d.budget_omitted_sections ?? [];
  const relevanceOmits =
    d.relevance_omitted_sections ?? d.omitted_sections.filter((s) => !budgetOmits.some((b) => b.id === s.id));

  if (!d.omitted_sections.length) {
    budgetRow.classList.add("hidden");
    relevanceRow.classList.add("hidden");
    return;
  }

  if (budgetOmits.length) {
    budgetRow.classList.remove("hidden");
    $("budgetOmitDesc").textContent =
      "These sections match your question but didn't fit the token budget. Peeks load below; check Include in Prove to add one.";
    budgetOmits.forEach((s) => renderBudgetOmitCard(s, d, budgetCards));
    void (async () => {
      for (const s of budgetOmits) {
        await peekSection(s, d, budgetExp, true);
      }
    })();
  } else {
    budgetRow.classList.add("hidden");
  }

  if (relevanceOmits.length) {
    relevanceRow.classList.remove("hidden");
    relSummary.textContent =
      relevanceOmits.length + " lower-relevance section" + (relevanceOmits.length === 1 ? "" : "s");
    const disclosure = $<HTMLDetailsElement>("relevanceOmitDisclosure");
    disclosure.open = false;
    renderOmitChips(relevanceOmits, d, relChips, relExp);
  } else {
    relevanceRow.classList.add("hidden");
  }
}

function setProveButtonsBusy(busy: boolean): void {
  const proveStale = isProveStale();
  const top = $<HTMLButtonElement>("prove");
  const results = $<HTMLButtonElement>("proveResults");
  top.disabled = busy || !llmAvailable || proveStale;
  results.disabled = busy || !llmAvailable || proveStale;
  top.textContent = busy ? PROVE_BUSY : PROVE_TOP_IDLE;
  results.textContent = busy ? PROVE_BUSY : PROVE_IDLE;
}

async function runProveFlow(): Promise<void> {
  clearProveErr();
  if (isProveStale()) {
    proveError(
      isQuestionStale()
        ? "Question changed since last compile. Click Compile once to refresh."
        : "Budget changed since last compile. Click Compile once to refresh."
    );
    return;
  }
  const fd = formData();
  if (!fd) {
    proveError("Pick a file and enter a question first.");
    return;
  }
  if (proveExpandedIds.size) {
    fd.append("expanded_ids", JSON.stringify([...proveExpandedIds]));
  }
  proveAbort?.abort();
  proveAbort = new AbortController();
  setProveButtonsBusy(true);
  showLoading("prove");
  announce("Asking the model twice, this can take a few seconds…");
  try {
    const resp = await fetchWithBusyRetry("/api/answer", {
      method: "POST",
      body: fd,
      signal: proveAbort.signal,
    });
    const d: AnswerApiResult = await resp
      .json()
      .catch(() => ({ error: "Parity request failed." }) as AnswerApiResult);
    if (!resp.ok || d.error) throw new Error(apiFailureMessage(resp, d, "prove"));
    hideLoading();
    // Parity lives inside resultsSec. If they haven't compiled yet (power-path
    // Prove…), show only the parity panel — don't unveil the empty compile shell.
    $("resultsSec").classList.remove("hidden");
    if (hasCompiledOnce) {
      $("results").classList.remove("hidden");
    } else {
      $("results").classList.add("hidden");
    }
    $("parity").classList.remove("hidden");
    $("parityModel").textContent = d.model;
    $("ansFull").textContent = d.full.answer;
    applyLang($("ansFull"), d.full.answer);
    $("ansFullCost").textContent = d.full.context_tokens.toLocaleString() + " content tokens";
    $("ansCompiled").textContent = d.compiled.answer;
    applyLang($("ansCompiled"), d.compiled.answer);
    const expandedN = d.compiled.expanded_ids?.length ?? 0;
    $("ansCompiledHeading").textContent =
      expandedN > 0
        ? `From the COMPILED context (+ ${expandedN} expand${expandedN === 1 ? "" : "s"})`
        : "From the COMPILED context";
    $("ansCompiledCost").textContent =
      d.compiled.context_tokens.toLocaleString() +
      " content tokens (" +
      d.compiled.reduction_pct +
      "% less)" +
      (expandedN > 0 ? " · includes " + d.compiled.expanded_ids!.join(", ") : "");
    const compileCeiling = lastCompiledBudget || Number($<HTMLInputElement>("budget").value);
    const packedTok = d.compiled.selected_content_tokens ?? d.compiled.context_tokens;
    $("parityBudgetNote").innerHTML =
      expandedN > 0
        ? "The compiled answer sees <strong>" +
          packedTok.toLocaleString() +
          "</strong> content tokens packed under your <strong>" +
          compileCeiling.toLocaleString() +
          "-token</strong> compile ceiling, plus includes <code>" +
          esc(d.compiled.expanded_ids!.join(", ")) +
          "</code> (<strong>" +
          d.compiled.context_tokens.toLocaleString() +
          "</strong> content tokens total). If it looks thinner than the full-file answer, raise the budget and prove again, or expand other omitted sections, then prove again."
        : "The compiled answer sees <strong>" +
          d.compiled.context_tokens.toLocaleString() +
          "</strong> content tokens packed under your <strong>" +
          compileCeiling.toLocaleString() +
          "-token</strong> compile ceiling. If it looks thinner than the full-file answer, raise the budget and prove again, or expand omitted sections below, then prove again.";
    // Parity opens under the Prove controls where the spinner just was.
    // No scroll: the page already stayed put during the wait.
    announce("Answer parity ready: both answers shown below.");
  } catch (e) {
    hideLoading();
    // Restore whatever was on screen before showLoading hid the panels.
    // No scroll on abort/error.
    if (hasCompiledOnce) {
      $("resultsSec").classList.remove("hidden");
      $("results").classList.remove("hidden");
    } else {
      $("resultsSec").classList.add("hidden");
    }
    if (e instanceof DOMException && e.name === "AbortError") return;
    proveError(e instanceof Error ? e.message : String(e));
  } finally {
    setProveButtonsBusy(false);
  }
}

$<HTMLButtonElement>("prove").onclick = () => void runProveFlow();
$<HTMLButtonElement>("proveResults").onclick = () => void runProveFlow();

// Cold start: keep agent panel hidden until a successful compile unveils it.
hideAgentSec();

loadConfig().then(() => {
  loadSamples();
});

// Free Render (and similar) sleep when idle — surface the cold-start expectation
// only on those hosts so local `npm run web` stays uncluttered.
if (/\.onrender\.com$/i.test(location.hostname)) {
  document.getElementById("coldStartNote")?.classList.remove("hidden");
}
