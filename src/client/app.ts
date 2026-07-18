/**
 * Context Compiler demo — client script (compiled to public/app.js).
 * Plain global script (no bundler): tsconfig.client.json emits with
 * module "none" so this can be dropped in via a single <script src>.
 * Shared interfaces (Sample, CompileApiResult, ...) come from types.ts,
 * compiled alongside this file as an ambient global — see the note there.
 */

/// <reference path="./types.ts" />

function $<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id} in the page — markup and script are out of sync.`);
  return el as T;
}

// Fetched from GET /api/samples on load — real, server-measured token counts
// (computed through the same convert+cache pipeline a real compile uses),
// not a client-side guess. See samples-manifest.ts and web.ts for the source.
let SAMPLES: Sample[] = [];

async function loadSamples(): Promise<void> {
  const wrap = $("samples");
  try {
    const resp = await fetch("/api/samples");
    if (!resp.ok) throw new Error(`samples HTTP ${resp.status}`);
    const data: Sample[] = await resp.json();
    if (!Array.isArray(data)) throw new Error("Unexpected response shape");
    SAMPLES = data;
    renderSamples();
  } catch (e) {
    console.warn("Could not load the sample library:", e);
    wrap.textContent = "Couldn't load the sample library right now — uploading your own file still works.";
  }
}

// Known up front (not just after a failed click, or worse, left fully
// enabled on the keyless default deploy this project's headline is built
// around) so LLM-only actions are correctly disabled + explained from the
// moment the page loads, not only after the first compile.
let maxFileBytes = 20 * 1024 * 1024;
let llmAvailable = true;

const NO_LLM_TITLE = "The server has no LLM API key configured. Everything else works without one.";

/** Keep Prove + Run agent in sync with whether the server can call a model. */
function setLlmDependentButtons(available: boolean): void {
  llmAvailable = available;
  const proveTop = $<HTMLButtonElement>("prove");
  const proveResults = $<HTMLButtonElement>("proveResults");
  const agentBtn = $<HTMLButtonElement>("goAgent");
  proveTop.disabled = !available;
  proveResults.disabled = !available;
  agentBtn.disabled = !available;
  const proveTitle = available
    ? "Compare answers from the full file vs your Compile result (not Agent)"
    : NO_LLM_TITLE;
  proveTop.title = available
    ? "Power path: prove from file + budget without waiting on the results view"
    : NO_LLM_TITLE;
  proveResults.title = proveTitle;
  agentBtn.title = available
    ? "Retrieve under your token budget, then answer (same slider as Compile)"
    : NO_LLM_TITLE;
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
        label.textContent = `Upload your file (pdf, docx, xlsx, pptx, html, csv, txt, md) — max ${mb} MB`;
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
      ? "If Gemini/OpenRouter <strong>free-tier quota</strong> is exhausted, Prove and Agent may return 429/503 even when our rate limit still has room — wait a few minutes and retry."
      : "<strong>Prove</strong> and <strong>Run agent</strong> are disabled here — this server has no LLM API key. Compile and expand still work fully offline.";
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
  document.querySelectorAll<HTMLButtonElement>(".scard").forEach((x) => {
    x.classList.remove("active");
    x.setAttribute("aria-pressed", "false");
  });
  card.classList.add("active");
  card.setAttribute("aria-pressed", "true");
  clearErr();
  try {
    blobCache[s.key] ??= await (await fetch("/samples/" + s.file)).blob();
    const dt = new DataTransfer();
    dt.items.add(
      new File([blobCache[s.key]], s.file, { type: blobCache[s.key].type || "application/octet-stream" })
    );
    $<HTMLInputElement>("file").files = dt.files;
  } catch (e) {
    fail("Could not load sample: " + (e instanceof Error ? e.message : String(e)));
    return;
  }
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

function clearResultsStale(): void {
  const el = $("budgetStaleNote");
  el.classList.add("hidden");
  el.innerHTML = "";
}

/** Slider/preset changed after a compile: drop expands + parity, ask them to recompile. */
function onBudgetUserChange(): void {
  if (!hasCompiledOnce || lastCompiledBudget === null) return;
  const v = +$<HTMLInputElement>("budget").value;
  if (v === lastCompiledBudget) {
    // Back to the budget that produced the results on screen — still valid.
    clearResultsStale();
    return;
  }
  clearProveExpands();
  $("parity").classList.add("hidden");
  const el = $("budgetStaleNote");
  el.innerHTML =
    "<strong>Budget changed.</strong> Results below are from the previous " +
    lastCompiledBudget.toLocaleString() +
    "-token compile (expands cleared). Click <strong>Compile once</strong> to refresh at " +
    v.toLocaleString() +
    " tokens.";
  el.classList.remove("hidden");
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
const DEFAULT_PRESETS: BudgetPresets = { quick: 1000, standard: 4000, deep: 8000 };

function computePresets(rawTokens: number | null): BudgetPresets {
  if (!rawTokens || rawTokens >= DEFAULT_PRESETS.deep) return DEFAULT_PRESETS;
  const round50 = (n: number) => Math.max(50, Math.round(n / 50) * 50);
  const deep = Math.max(300, rawTokens); // "deep dive" = essentially the whole document
  const standard = Math.min(deep, round50(Math.max(200, rawTokens * 0.5)));
  const quick = Math.min(standard, round50(Math.max(100, rawTokens * 0.2)));
  return { quick, standard, deep };
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
    $<HTMLInputElement>("budget").value = String(p[selectTier]);
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
    ? `This document is about ${rawTokens.toLocaleString()} tokens total — the presets below are scaled to it.`
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

/** Turn HTTP status + JSON error body into a human message (429/503 aware). */
async function apiFailureMessage(resp: Response, body: { error?: string } | null): Promise<string> {
  const base = body?.error || `Request failed (${resp.status})`;
  if (resp.status === 429) return base + " Wait a minute, then try again.";
  if (resp.status === 503) {
    const ra = resp.headers.get("Retry-After");
    return base + (ra ? ` Retry in about ${ra}s.` : " Retry in a few seconds.");
  }
  return base;
}
function clearErr(): void {
  $("err").classList.add("hidden");
  $("fileErr").classList.add("hidden");
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
      `"${f.name}" is ${(f.size / 1e6).toFixed(1)} MB — over the ${mb} MB limit. Pick a smaller file.`;
    $("fileErr").classList.remove("hidden");
    $<HTMLInputElement>("file").value = "";
    return;
  }
  if (f && !ALLOWED_EXT_RE.test(f.name)) {
    $("fileErr").textContent =
      `"${f.name}" isn't a supported format yet. Supported: pdf, docx, xlsx, pptx, csv, md, txt, html. ` +
      `Images aren't supported without an OCR/captioning backend, which this demo doesn't have configured.`;
    $("fileErr").classList.remove("hidden");
    $<HTMLInputElement>("file").value = "";
    return;
  }
  if (f) {
    // A manually picked file replaces any selected sample, so clear the sample
    // cards' "selected" state. (This only fires for real user picks, not
    // selectSample()'s own programmatic assignment.)
    document.querySelectorAll<HTMLButtonElement>(".scard").forEach((x) => {
      x.classList.remove("active");
      x.setAttribute("aria-pressed", "false");
    });
    estimateUploadSize(f);
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
  const f = $<HTMLInputElement>("file").files?.[0];
  const task = $<HTMLTextAreaElement>("task").value.trim();
  if (!f || !task) return null;
  const fd = new FormData();
  fd.append("file", f);
  fd.append("task", task);
  fd.append("token_budget", $<HTMLInputElement>("budget").value);
  return fd;
}

let compileAbort: AbortController | null = null;
// Whether any compile has ever succeeded this session — decides whether a
// failed/cancelled attempt should hide the (empty) results panel again or
// leave a previous successful result visible underneath the error.
let hasCompiledOnce = false;
/** Omitted-section ids the user expanded in the UI — sent to Prove only. */
const proveExpandedIds = new Set<string>();
/** Tokens added by each UI expand (for the “effective Prove context” note). */
const proveExpandedTokens = new Map<string, number>();
/** Compiled tokens from the last successful compile (slider budget result). */
let lastCompiledTokens = 0;

function refreshExpandBudgetNote(): void {
  const el = $("expandBudgetNote");
  let expandSum = 0;
  for (const t of proveExpandedTokens.values()) expandSum += t;
  if (!el || expandSum <= 0 || lastCompiledTokens <= 0) {
    if (el) {
      el.classList.add("hidden");
      el.innerHTML = "";
    }
    return;
  }
  const total = lastCompiledTokens + expandSum;
  el.innerHTML =
    "Prove context ≈ <strong>" +
    lastCompiledTokens.toLocaleString() +
    "</strong> compiled + <strong>" +
    expandSum.toLocaleString() +
    "</strong> from expands → <strong>" +
    total.toLocaleString() +
    "</strong> tokens effective (slider budget was the compile ceiling only — expands add on top).";
  el.classList.remove("hidden");
}

function clearProveExpands(): void {
  proveExpandedIds.clear();
  proveExpandedTokens.clear();
  const exp = $("expanded");
  if (exp) exp.innerHTML = "";
  refreshExpandBudgetNote();
}

// The only feedback during a compile used to be the button reading
// "Compiling…" — nothing near where the answer lands, on an operation that
// can legitimately take many seconds (first-time conversion of a large file
// has up to a 120s server-side ceiling). Reveal the results area immediately
// with a loading note and scroll to it, so the wait happens where the user is
// already looking, and give them a way out via the new Cancel button.
function showLoading(): void {
  $("resultsSec").classList.remove("hidden");
  const el = $("loadingNote");
  el.textContent =
    "Compiling… converting a file for the first time can take a few seconds; cached files are instant.";
  el.classList.remove("hidden");
  $<HTMLButtonElement>("cancelGo").classList.remove("hidden");
  $("resultsSec").scrollIntoView({ behavior: "smooth", block: "start" });
}
function hideLoading(): void {
  $("loadingNote").classList.add("hidden");
  $<HTMLButtonElement>("cancelGo").classList.add("hidden");
}
$<HTMLButtonElement>("cancelGo").onclick = () => {
  compileAbort?.abort();
  agentAbort?.abort();
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
  showLoading();
  try {
    const resp = await fetch("/api/compile", { method: "POST", body: fd, signal: compileAbort.signal });
    const d: CompileApiResult = await resp
      .json()
      .catch(() => ({ error: "Compile failed." }) as CompileApiResult);
    if (!resp.ok || d.error) throw new Error(await apiFailureMessage(resp, d));
    hideLoading();
    clearProveExpands();
    lastCompiledTokens = d.tokens_used;
    lastCompiledBudget = d.token_budget;
    clearResultsStale();
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
    // 0% is a correct passthrough result (file already fit the budget), not
    // a failure — don't paint it the same "success green" as a real cut.
    $("sPct").style.color = d.reduction_pct > 0 ? "var(--green)" : "var(--muted)";
    $("sUsed").style.color = d.reduction_pct > 0 ? "var(--green)" : "var(--text)";
    $("sCost").innerHTML = "$" + d.cost_raw_usd.toFixed(4) + " → $" + d.cost_compiled_usd.toFixed(4);
    $("price").textContent = "@$" + d.price_per_mtok + "/Mtok";
    requestAnimationFrame(() => {
      $("barRaw").style.width = "100%";
      $("barRawVal").textContent = d.raw_tokens.toLocaleString() + " tokens";
      $("barC").style.width = Math.max(3, (100 * d.tokens_used) / d.raw_tokens) + "%";
      $("barCVal").textContent = d.tokens_used.toLocaleString() + " tokens";
    });
    $("cacheBadge").textContent = d.cache_hit ? "⚡ conversion cached" : "converted fresh";
    $("cacheBadge").title = d.cache_hit
      ? "This file was already converted — reused cached markdown. Ranking still ran fresh."
      : "First time we saw this file — converted and cached by content hash.";
    $("rankBadge").textContent = "bm25 ranking";
    $("omitBadge").textContent = d.omitted_sections.length + " sections omitted";
    $("out").textContent = d.markdown;
    applyLang($("out"), d.markdown);
    renderSections(d);
    renderOmitted(d);
    renderMultiNote(d);
    renderFloorNote(d);
    bumpSavings(d);
    hasCompiledOnce = true;
    setLlmDependentButtons(d.llm_available !== false);
    // Move focus (not just scroll) to the results heading so screen-reader
    // and keyboard users land where the sighted eye would.
    $("resultsSec").scrollIntoView({ behavior: "smooth", block: "start" });
    $("resultsHeading").focus();
    announce(`Compiled: ${d.reduction_pct}% fewer tokens, ${d.omitted_sections.length} sections omitted.`);
  } catch (e) {
    hideLoading();
    // No prior successful result to fall back to — don't leave an empty
    // results panel showing after a failed/cancelled first attempt.
    if (!hasCompiledOnce) $("resultsSec").classList.add("hidden");
    if (e instanceof DOMException && e.name === "AbortError") return;
    fail(e instanceof Error ? e.message : String(e));
  } finally {
    goBtn.disabled = false;
    goBtn.textContent = "Compile";
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

function startAgentPanel(): void {
  agentTokens = 0;
  agentParityHandle = null;
  agentParityAbort?.abort();
  $("agentSec").classList.remove("hidden");
  $("aSteps").innerHTML = "";
  $("aAnswerWrap").classList.add("hidden");
  $("aParityActions").classList.add("hidden");
  $("aParity").classList.add("hidden");
  $("aParityErr").classList.add("hidden");
  $("aErr").classList.add("hidden");
  $("aTokens").textContent = "0";
  $("aWhole").textContent = "";
  $("aBar").style.width = "0%";
  const parityBtn = $<HTMLButtonElement>("aParityBtn");
  parityBtn.disabled = !llmAvailable;
  parityBtn.textContent = "Compare to full file";
  $<HTMLButtonElement>("cancelGo").classList.remove("hidden");
  $("agentSec").scrollIntoView({ behavior: "smooth", block: "start" });
  announce("Agent started.");
}

function onAgentStep(step: AgentStep): void {
  agentTokens += step.tokens_added;
  $("aTokens").textContent = agentTokens.toLocaleString();
  const meta = AGENT_ACTIONS[step.action];
  const suffix = step.section_id
    ? ' <span class="amono">' + esc(step.section_id) + "</span>"
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
    ceiling > 0 && r.tokens_read > ceiling
      ? " Soft ceiling was " +
        ceiling.toLocaleString() +
        " — last expand finished slightly over (expected)."
      : "";
  $("aStopped").textContent =
    STOP_TEXT[r.stopped_reason] +
    " — reading " +
    r.tokens_read.toLocaleString() +
    " tokens (" +
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
    "Agent finished — read " +
      r.tokens_read.toLocaleString() +
      " of " +
      r.raw_tokens.toLocaleString() +
      " tokens."
  );
}

function agentError(msg: string): void {
  const el = $("aErr");
  el.textContent = msg;
  el.classList.remove("hidden");
  announce("Agent error: " + msg);
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
  const f = $<HTMLInputElement>("file").files?.[0];
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
  const btn = $<HTMLButtonElement>("goAgent");
  btn.disabled = true;
  btn.textContent = "Agent working…";
  startAgentPanel();
  try {
    const resp = await fetch("/api/agent", { method: "POST", body: fd, signal: agentAbort.signal });
    const ctype = resp.headers.get("content-type") ?? "";
    if (!ctype.includes("text/event-stream") || !resp.body) {
      // A guard rejected the request before the stream opened → JSON error body.
      const d = (await resp.json().catch(() => ({ error: "Agent request failed." }))) as { error?: string };
      throw new Error(await apiFailureMessage(resp, d));
    }
    await consumeSse(resp.body, (event, data) => {
      if (event === "step") onAgentStep(data as AgentStep);
      else if (event === "done") onAgentDone(data as AgentRunResult);
      else if (event === "error") throw new Error((data as { error: string }).error);
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") return;
    agentError(e instanceof Error ? e.message : String(e));
  } finally {
    btn.disabled = !llmAvailable;
    btn.textContent = "Run agent ▸";
    $<HTMLButtonElement>("cancelGo").classList.add("hidden");
  }
}
$<HTMLButtonElement>("goAgent").onclick = () => void runAgentFlow();

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
    if (!resp.ok || d.error) throw new Error(await apiFailureMessage(resp, d));
    $("aParity").classList.remove("hidden");
    $("aParityModel").textContent = d.model;
    $("aAnsFull").textContent = d.full.answer;
    applyLang($("aAnsFull"), d.full.answer);
    $("aAnsFullCost").textContent = d.full.context_tokens.toLocaleString() + " context tokens";
    $("aAnsAgent").textContent = d.agent.answer;
    applyLang($("aAnsAgent"), d.agent.answer);
    $("aAnsAgentCost").textContent = d.agent.context_tokens.toLocaleString() + " context tokens";
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
        qt.title = (k === 0 ? "Best answers: " : "Also relevant to: ") + d.queries[qi];
        nmSpan.appendChild(document.createTextNode(" "));
        nmSpan.appendChild(qt);
      });
    }
    const meta = document.createElement("span");
    meta.className = "meta";
    meta.textContent =
      (s.relevance != null ? "relevance " + s.relevance + "% · " : "") + s.tokens + " tokens";
    h.append(nmSpan, meta);
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
  el.innerHTML =
    "<strong>Detected " +
    d.queries.length +
    " questions.</strong> Each was ranked on its own and the " +
    "top sections merged (round-robin), so every question is represented rather than the keyword-heaviest one " +
    "crowding out the rest. The tag on each section below shows which question it best answers." +
    '<ol style="margin:6px 0 0;padding-left:20px;list-style:none">' +
    items +
    "</ol>";
  el.classList.remove("hidden");
}

// Explain WHY a bigger budget sometimes changes nothing: on a focused
// question only a few sections clear the 40% relevance floor, so the packer
// stops well short of the budget. Without this note, "quick fact" and "deep
// dive" look identical for no visible reason.
function renderFloorNote(d: CompileApiResult): void {
  const el = $("floorNote");
  el.classList.add("hidden");
  el.innerHTML = "";
  // Use the budget the server actually applied, not the live slider — they can
  // differ (server clamps), and the note must never contradict the result.
  const budget = d.token_budget;
  if (d.reduction_pct === 0) {
    // Whole file fit under the budget — this is the "deep dive looks the same"
    // case. Say so, so it doesn't read as a no-op.
    el.innerHTML =
      "<strong>Whole file fit your budget.</strong> The document is " +
      d.raw_tokens.toLocaleString() +
      " tokens, under your " +
      budget.toLocaleString() +
      "-token budget, so it was returned in full — " +
      "nothing to leave out. Lower the budget (try “quick fact”) to see compilation kick in.";
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
  if (topOmit && d.selected_sections.length === 0) {
    // Suggested budget: the section's size plus ~80 tokens of wrapper overhead,
    // rounded up to a tidy hundred.
    const need = Math.ceil((topOmit.tokens + 80) / 100) * 100;
    el.innerHTML =
      "<strong>Nothing fit your budget.</strong> Even the best match — “" +
      esc(lastCrumb(topOmit.section)) +
      "” (" +
      topOmit.relevance +
      "% relevant, " +
      topOmit.tokens.toLocaleString() +
      " tokens) — is larger than your " +
      budget.toLocaleString() +
      "-token budget, so no section is shown below. " +
      "Raise the budget to about " +
      need.toLocaleString() +
      " tokens, or fetch it directly with " +
      "<code>expand_section</code> (<code>" +
      topOmit.id +
      "</code>).";
    el.classList.remove("hidden");
    return;
  }
  // More-relevant section omitted while a weaker one is shown. Usually that
  // means the top hit alone exceeds the budget; if it would fit, say so
  // instead of claiming it's "larger than" the budget (that was a real bug
  // when packing order starved a fitting 100% section).
  if (topOmit && (topOmit.relevance || 0) > selRel) {
    const need = Math.ceil((topOmit.tokens + 80) / 100) * 100;
    const tooBigAlone = topOmit.tokens + 80 > budget;
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
        " tokens, or fetch it directly below with " +
        "<code>expand_section</code> (<code>" +
        topOmit.id +
        "</code>)."
      : "<strong>The most relevant section was left out.</strong> “" +
        esc(lastCrumb(topOmit.section)) +
        "” (" +
        topOmit.relevance +
        "% relevant, " +
        topOmit.tokens.toLocaleString() +
        " tokens) fits your " +
        budget.toLocaleString() +
        "-token budget but wasn’t selected. Fetch it below with " +
        "<code>expand_section</code> (<code>" +
        topOmit.id +
        "</code>).";
    el.classList.remove("hidden");
    return;
  }
  const spare = budget - d.tokens_used;
  const budgetBound = spare < budget * 0.12; // used almost the whole budget
  const hint = d.next_section_hint;
  if (hint) {
    // Server already decided we're budget-bound with a strong omitted section
    // that wouldn't fit beside the selection — name it and give a concrete
    // next budget (keep current compile + add that section).
    el.innerHTML =
      "<strong>Budget-bound.</strong> Selection stopped at your " +
      budget.toLocaleString() +
      "-token ceiling. Also left out: “" +
      esc(lastCrumb(hint.section)) +
      "” (" +
      hint.relevance +
      "% relevant, " +
      hint.tokens.toLocaleString() +
      " tokens). Raise the budget to about " +
      hint.suggested_budget.toLocaleString() +
      " tokens to keep what’s selected and add it, or fetch it below with " +
      "<code>expand_section</code> (<code>" +
      esc(hint.id) +
      "</code>).";
    el.classList.remove("hidden");
    return;
  }
  if (budgetBound) {
    el.innerHTML =
      "<strong>Budget-bound.</strong> Selection stopped because it hit your " +
      budget.toLocaleString() +
      "-token ceiling, not the relevance floor. A larger budget would pull in more sections.";
  } else {
    el.innerHTML =
      "<strong>Relevance-bound, not budget-bound.</strong> Only <strong>" +
      d.selected_sections.length +
      "</strong> section" +
      (d.selected_sections.length === 1 ? "" : "s") +
      " cleared the 40% relevance floor — " +
      "the rest scored too low to matter for this question. Used <strong>" +
      d.tokens_used.toLocaleString() +
      "</strong> of your " +
      budget.toLocaleString() +
      "-token budget, so a bigger budget (e.g. “deep dive”) adds nothing here. " +
      "That’s the point: the tool sends what’s relevant, not whatever fills the budget.";
  }
  el.classList.remove("hidden");
}

const CHIP_PAGE = 12; // avoid an unbounded wall of chips on long documents

function makeChip(o: SectionInfo, d: CompileApiResult, exp: HTMLElement): HTMLButtonElement {
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
  b.setAttribute("aria-label", "Fetch omitted section: " + lastCrumb(o.section));
  b.onclick = async () => {
    if (b.classList.contains("done")) return;
    b.disabled = true;
    try {
      const resp = await fetch("/api/expand", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ handle: d.handle, section_id: o.id }),
      });
      const e: ExpandApiResult = await resp.json();
      if (e.error) throw new Error(e.error);
      const blk = document.createElement("details");
      blk.className = "expblk";
      // First expand stays open so the user sees what they fetched; later ones
      // stay collapsed so the page doesn’t flood with prose.
      if (proveExpandedIds.size === 0) blk.open = true;
      const sum = document.createElement("summary");
      sum.textContent = o.id + " · " + lastCrumb(o.section) + " → " + (e.tokens_used || "?") + " tokens";
      const pre = document.createElement("pre");
      pre.textContent = e.markdown;
      blk.appendChild(sum);
      blk.appendChild(pre);
      exp.appendChild(blk);
      b.classList.add("done");
      proveExpandedIds.add(o.id);
      proveExpandedTokens.set(o.id, e.tokens_used || o.tokens || 0);
      refreshExpandBudgetNote();
      announce(
        "Fetched section: " +
          lastCrumb(o.section) +
          ". Prove context is now about " +
          (lastCompiledTokens + [...proveExpandedTokens.values()].reduce((a, b) => a + b, 0)).toLocaleString() +
          " tokens."
      );
    } catch (err) {
      fail(err instanceof Error ? err.message : String(err));
    } finally {
      b.disabled = false;
    }
  };
  return b;
}

function renderOmitted(d: CompileApiResult): void {
  const row = $("omittedRow");
  const chips = $("omitChips");
  const exp = $("expanded");
  chips.innerHTML = "";
  exp.innerHTML = "";
  if (!d.omitted_sections.length) {
    row.classList.add("hidden");
    return;
  }
  row.classList.remove("hidden");
  const first = d.omitted_sections.slice(0, CHIP_PAGE);
  const rest = d.omitted_sections.slice(CHIP_PAGE);
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

let proveAbort: AbortController | null = null;

const PROVE_IDLE = "Prove answer parity";
const PROVE_TOP_IDLE = "Prove…";
const PROVE_BUSY = "Asking the model twice…";

function setProveButtonsBusy(busy: boolean): void {
  const top = $<HTMLButtonElement>("prove");
  const results = $<HTMLButtonElement>("proveResults");
  top.disabled = busy || !llmAvailable;
  results.disabled = busy || !llmAvailable;
  top.textContent = busy ? PROVE_BUSY : PROVE_TOP_IDLE;
  results.textContent = busy ? PROVE_BUSY : PROVE_IDLE;
}

async function runProveFlow(): Promise<void> {
  clearErr();
  const fd = formData();
  if (!fd) return fail("Pick a file and enter a question first.");
  if (proveExpandedIds.size) {
    fd.append("expanded_ids", JSON.stringify([...proveExpandedIds]));
  }
  proveAbort?.abort();
  proveAbort = new AbortController();
  setProveButtonsBusy(true);
  announce("Asking the model twice, this can take a few seconds…");
  try {
    const resp = await fetch("/api/answer", { method: "POST", body: fd, signal: proveAbort.signal });
    const d: AnswerApiResult = await resp
      .json()
      .catch(() => ({ error: "Parity request failed." }) as AnswerApiResult);
    if (!resp.ok || d.error) throw new Error(await apiFailureMessage(resp, d));
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
    $("ansFullCost").textContent = d.full.context_tokens.toLocaleString() + " context tokens";
    $("ansCompiled").textContent = d.compiled.answer;
    applyLang($("ansCompiled"), d.compiled.answer);
    const expandedN = d.compiled.expanded_ids?.length ?? 0;
    $("ansCompiledHeading").textContent =
      expandedN > 0
        ? `From the COMPILED context (+ ${expandedN} expand${expandedN === 1 ? "" : "s"})`
        : "From the COMPILED context";
    $("ansCompiledCost").textContent =
      d.compiled.context_tokens.toLocaleString() +
      " context tokens (" +
      d.compiled.reduction_pct +
      "% less)" +
      (expandedN > 0 ? " · includes " + d.compiled.expanded_ids!.join(", ") : "");
    const budget = Number($<HTMLInputElement>("budget").value);
    $("parityBudgetNote").innerHTML =
      expandedN > 0
        ? "Compile path (+ expands <code>" +
          esc(d.compiled.expanded_ids!.join(", ")) +
          "</code>) on a <strong>" +
          budget.toLocaleString() +
          "-token</strong> budget — not an Agent run."
        : "Compile path only — what fit your <strong>" +
          budget.toLocaleString() +
          "-token</strong> budget. Not an Agent run.";
    $("parity").scrollIntoView({ behavior: "smooth", block: "nearest" });
    announce("Answer parity ready: both answers shown below.");
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") return;
    fail(e instanceof Error ? e.message : String(e));
  } finally {
    setProveButtonsBusy(false);
  }
}

$<HTMLButtonElement>("prove").onclick = () => void runProveFlow();
$<HTMLButtonElement>("proveResults").onclick = () => void runProveFlow();

loadConfig().then(() => {
  loadSamples();
});

// Free Render (and similar) sleep when idle — surface the cold-start expectation
// only on those hosts so local `npm run web` stays uncluttered.
if (/\.onrender\.com$/i.test(location.hostname)) {
  document.getElementById("coldStartNote")?.classList.remove("hidden");
}
