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

const SAMPLES: Sample[] = [
  { key: "pp", file: "pride-and-prejudice.docx", fmt: "docx", nm: "Pride and Prejudice", mt: "Jane Austen · novel",
    q: ["What is Mr. Darcy's first impression at the ball?", "How does Mr. Collins propose to Elizabeth?", "What does Mr. Bingley think of Jane?", "Why does Elizabeth dislike Mr. Darcy at first?", "How does Mr. Collins propose to Elizabeth, and how does Darcy propose?"] },
  { key: "sh", file: "sherlock-holmes.docx", fmt: "docx", nm: "The Adventures of Sherlock Holmes", mt: "Arthur Conan Doyle · mystery",
    q: ["Why does the King of Bohemia come to Sherlock Holmes?", "What is the Red-Headed League?", "How does Holmes solve the Red-Headed League case?", "What case involves a stepfather and a typewriter?", "What is the Red-Headed League, and how does Holmes solve it?"] },
  { key: "og", file: "origin-of-species.pdf", fmt: "pdf", nm: "On the Origin of Species", mt: "Charles Darwin · dense science PDF",
    q: ["What is natural selection?", "What does Darwin say about the struggle for existence?", "How does Darwin explain variation under domestication?", "What is natural selection? What does Darwin say about the struggle for existence?"] },
  { key: "ar", file: "meridian-annual-report.docx", fmt: "docx", nm: "Meridian Annual Report", mt: "business report · tables + prose",
    q: ["What are the three risks management worries about?", "What mistake did the company admit this year?", "Which R&D programs were cancelled and why?", "What is the FY2026 revenue guidance?", "What are the three risks, and which R&D programs were cancelled?"] },
  { key: "km", file: "kestrel-k2-manual.pdf", fmt: "pdf", nm: "Kestrel K2 Drone Manual", mt: "user manual PDF",
    q: ["What voids the warranty?", "Which directions can the obstacle sensors not see?", "How should batteries be handled for air travel?", "Can the drone fly in rain?", "What voids the warranty? Can the drone fly in rain?"] },
  { key: "fin", file: "meridian-financials.xlsx", fmt: "xlsx", nm: "Meridian Financials", mt: "spreadsheet · 3 sheets",
    q: ["What was net profit in FY25?", "Which quarter had the best gross margin?", "How did revenue grow over five years?", "What was net profit in FY25? Which quarter had the best gross margin?"] },
  { key: "lt", file: "the-lantern-tales.md", fmt: "md", nm: "The Lantern Tales", mt: "24 short fables",
    q: ["What three promises did the fox collect as payment for winter?", "How did Lina win her shadow back?", "What did the ferryman charge instead of coins?", "What was the rule at the night market of lost things?", "What did the ferryman charge, and what was the rule at the night market?"] },
  { key: "hi", file: "chhoti-kahaniyan.md", fmt: "md", nm: "छोटी कहानियाँ", mt: "Hindi · 12 stories (Unicode)",
    q: ["ईमानदार चायवाले को अंगूठी लौटाने पर क्या मिला?", "आम का पेड़ बँटवारे में किसके हिस्से आया?", "गणित की परीक्षा का आख़िरी सवाल क्या था?", "ईमानदार चायवाले को क्या मिला? आम का पेड़ किसके हिस्से आया?"] },
];

// Hindi text uses Devanagari; tag such strings with lang="hi" so assistive
// tech doesn't mispronounce them under the page's declared lang="en".
const DEVANAGARI_RE = /[ऀ-ॿ]/;

function langSpan(text: string): HTMLSpanElement {
  const span = document.createElement("span");
  if (DEVANAGARI_RE.test(text)) span.lang = "hi";
  span.textContent = text;
  return span;
}

function announce(msg: string, assertive = false): void {
  $(assertive ? "liveRegionAssertive" : "liveRegion").textContent = msg;
}

const esc = (s: unknown): string =>
  String(s).replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c] as string));

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
const MAX_FILE_BYTES = 50 * 1024 * 1024;

function renderSamples(): void {
  const wrap = $("samples");
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
    dt.items.add(new File([blobCache[s.key]], s.file, { type: blobCache[s.key].type || "application/octet-stream" }));
    $<HTMLInputElement>("file").files = dt.files;
  } catch (e) {
    fail("Could not load sample: " + (e instanceof Error ? e.message : String(e)));
    return;
  }
  renderQChips(s.q);
  $<HTMLInputElement>("task").value = s.q[0];
  syncQChips();
  announce(s.nm + " loaded. " + s.q.length + " suggested questions available below the question field.");
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
      $<HTMLInputElement>("task").value = q;
      syncQChips();
      $<HTMLInputElement>("task").focus();
    };
    box.appendChild(b);
  });
  box.classList.remove("hidden");
  $("qhint").classList.remove("hidden");
}

// Highlight whichever chip matches the current text (if any).
function syncQChips(): void {
  const v = $<HTMLInputElement>("task").value.trim();
  document.querySelectorAll<HTMLButtonElement>(".qchip").forEach((c) => c.classList.toggle("active", c.dataset.q === v));
}
$<HTMLInputElement>("task").addEventListener("input", syncQChips);

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
$<HTMLInputElement>("budget").oninput = syncBudget;
document.querySelectorAll<HTMLButtonElement>(".bpre").forEach((b) => {
  b.onclick = () => {
    $<HTMLInputElement>("budget").value = b.dataset.v ?? "4000";
    syncBudget();
  };
});
syncBudget();

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
function clearErr(): void {
  $("err").classList.add("hidden");
  $("fileErr").classList.add("hidden");
}

// Client-side validation before any network round-trip: catch obviously
// wrong file sizes immediately instead of after a full upload.
$<HTMLInputElement>("file").addEventListener("change", () => {
  const f = $<HTMLInputElement>("file").files?.[0];
  $("fileErr").classList.add("hidden");
  if (f && f.size > MAX_FILE_BYTES) {
    $("fileErr").textContent = `"${f.name}" is ${(f.size / 1e6).toFixed(1)} MB — over the 50 MB limit. Pick a smaller file.`;
    $("fileErr").classList.remove("hidden");
    $<HTMLInputElement>("file").value = "";
  }
});

// The GitHub links are placeholders until this repo is public — warn in
// the console rather than ship a silently dead link to judges.
document.querySelectorAll("[data-placeholder]").forEach((a) => {
  a.addEventListener("click", () => {
    console.warn("Repo link is a placeholder — set the real GitHub URL before sharing this page.");
  });
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
    "saved this session: $" + savedUsd.toFixed(4) +
    "<small>" + savedTok.toLocaleString() + " tokens · ~$" + (savedUsd * 1000).toFixed(0) + " per 1,000 reads</small>";
}

function formData(): FormData | null {
  const f = $<HTMLInputElement>("file").files?.[0];
  const task = $<HTMLInputElement>("task").value.trim();
  if (!f || !task) return null;
  const fd = new FormData();
  fd.append("file", f);
  fd.append("task", task);
  fd.append("token_budget", $<HTMLInputElement>("budget").value);
  return fd;
}

let compileAbort: AbortController | null = null;

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
  try {
    const resp = await fetch("/api/compile", { method: "POST", body: fd, signal: compileAbort.signal });
    const d: CompileApiResult = await resp.json();
    if (d.error) throw new Error(d.error);
    $("resultsSec").classList.remove("hidden");
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
      ? "This file was already converted, so we reused the cached markdown and skipped conversion."
      : "First time we saw this file, so we converted it and cached the result.";
    $("cacheNote").innerHTML = d.cache_hit
      ? "⚡ <b>Conversion cached.</b> We recognised this exact file (matched by content hash), so we reused the markdown from a previous run instead of re-converting it. Only the file→markdown step is cached — your question was still ranked fresh just now."
      : "<b>Converted fresh.</b> First time we've seen this exact file, so we converted it to markdown and cached it by content hash. Ask another question on the same file and this step is skipped (you'll see “⚡ conversion cached”). Edit the file and it converts again.";
    $("rerankBadge").textContent = d.rerank_used ? "llm rerank" : "bm25 ranking";
    $("omitBadge").textContent = d.omitted_sections.length + " sections omitted";
    $("out").textContent = d.markdown;
    $("out").lang = DEVANAGARI_RE.test(d.markdown) ? "hi" : "";
    renderSections(d);
    renderOmitted(d);
    renderMultiNote(d);
    renderFloorNote(d);
    bumpSavings(d);
    const proveBtn = $<HTMLButtonElement>("prove");
    proveBtn.disabled = d.llm_available === false;
    proveBtn.title =
      d.llm_available === false
        ? "The server has no LLM API key configured. Everything else works without one."
        : "Answer the question from the full file vs the compiled context";
    // Move focus (not just scroll) to the results heading so screen-reader
    // and keyboard users land where the sighted eye would.
    $("resultsSec").scrollIntoView({ behavior: "smooth", block: "start" });
    $("resultsHeading").focus();
    announce(`Compiled: ${d.reduction_pct}% fewer tokens, ${d.omitted_sections.length} sections omitted.`);
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") return;
    fail(e instanceof Error ? e.message : String(e));
  } finally {
    goBtn.disabled = false;
    goBtn.textContent = "Compile";
  }
});

function renderSections(d: CompileApiResult): void {
  const wrap = $("sections");
  wrap.innerHTML = "";
  const cards = [...d.selected_sections].sort((a, b) => (b.relevance ?? 0) - (a.relevance ?? 0));
  cards.forEach((s, i) => {
    const el = document.createElement("div");
    el.className = "seccard";
    const nmText = s.section.split(" > ").pop() || s.section;
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
    meta.textContent = (s.relevance != null ? "relevance " + s.relevance + "% · " : "") + s.tokens + " tokens";
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
      if (DEVANAGARI_RE.test(s.text)) p.lang = "hi";
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
    "<b>Detected " + d.queries.length + " questions.</b> Each was ranked on its own and the " +
    "top sections merged (round-robin), so every question is represented rather than the keyword-heaviest one " +
    "crowding out the rest. The tag on each section below shows which question it best answers." +
    '<ol style="margin:6px 0 0;padding-left:20px;list-style:none">' + items + "</ol>";
  el.classList.remove("hidden");
}

// Explain WHY a bigger budget sometimes changes nothing: on a focused
// question only a few sections clear the 15% relevance floor, so the packer
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
      "<b>Whole file fit your budget.</b> The document is " + d.raw_tokens.toLocaleString() +
      " tokens, under your " + budget.toLocaleString() + "-token budget, so it was returned in full — " +
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
    const need = Math.ceil((topOmit.tokens + 80) / 100) * 100;
    el.innerHTML =
      "<b>Nothing fit your budget.</b> Even the best match — “" + esc(topOmit.section.split(" > ").pop()) +
      "” (" + topOmit.relevance + "% relevant, " + topOmit.tokens.toLocaleString() + " tokens) — is larger than your " +
      budget.toLocaleString() + "-token budget, so no section is shown below. " +
      "Raise the budget to about " + need.toLocaleString() + " tokens, or fetch it directly with " +
      "<code>expand_section</code> (<code>" + topOmit.id + "</code>).";
    el.classList.remove("hidden");
    return;
  }
  // Most important non-empty case: a MORE relevant section was omitted purely
  // because it was too big to fit — so a lower-relevance section is showing
  // in its place. This can only happen when the top-ranked chunk exceeds the
  // budget. Warn clearly and tell the user exactly how to get the real answer.
  if (topOmit && (topOmit.relevance || 0) > selRel) {
    const need = Math.ceil((topOmit.tokens + 80) / 100) * 100;
    el.innerHTML =
      "<b>The most relevant section didn’t fit.</b> “" + esc(topOmit.section.split(" > ").pop()) +
      "” (" + topOmit.relevance + "% relevant, " + topOmit.tokens.toLocaleString() + " tokens) is larger than your " +
      budget.toLocaleString() + "-token budget, so lower-relevance sections are shown instead. " +
      "Raise the budget to about " + need.toLocaleString() + " tokens, or fetch it directly below with " +
      "<code>expand_section</code> (<code>" + topOmit.id + "</code>).";
    el.classList.remove("hidden");
    return;
  }
  const spare = budget - d.tokens_used;
  const budgetBound = spare < budget * 0.12; // used almost the whole budget
  if (d.rerank_used) {
    if (budgetBound) {
      el.innerHTML =
        "<b>Budget-bound.</b> The compiled context nearly fills your " +
        budget.toLocaleString() + "-token budget — raising it would let more sections in.";
    } else {
      return;
    }
  } else if (budgetBound) {
    el.innerHTML =
      "<b>Budget-bound.</b> Selection stopped because it hit your " +
      budget.toLocaleString() + "-token ceiling, not the relevance floor. A larger budget would pull in more sections.";
  } else {
    el.innerHTML =
      "<b>Relevance-bound, not budget-bound.</b> Only <b>" + d.selected_sections.length +
      "</b> section" + (d.selected_sections.length === 1 ? "" : "s") + " cleared the 15% relevance floor — " +
      "the rest scored too low to matter for this question. Used <b>" + d.tokens_used.toLocaleString() +
      "</b> of your " + budget.toLocaleString() + "-token budget, so a bigger budget (e.g. “deep dive”) adds nothing here. " +
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
    o.id + " · " + (o.section.split(" > ").pop() || o.section) +
    (o.relevance != null ? " · rel " + o.relevance + "%" : "") + " (~" + o.tokens + " tok)";
  b.setAttribute("aria-label", "Fetch omitted section: " + (o.section.split(" > ").pop() || o.section));
  b.onclick = async () => {
    if (b.classList.contains("done")) return;
    b.disabled = true;
    try {
      const resp = await fetch("/api/expand", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ file_path: d.file_path, section_id: o.id }),
      });
      const e: ExpandApiResult = await resp.json();
      if (e.error) throw new Error(e.error);
      const blk = document.createElement("div");
      blk.className = "expblk";
      blk.innerHTML = '<div class="t">expand_section("' + o.id + '") → ' + (e.tokens_used || "?") + " tokens</div>";
      const pre = document.createElement("pre");
      pre.textContent = e.markdown;
      blk.appendChild(pre);
      exp.appendChild(blk);
      b.classList.add("done");
      announce("Fetched section: " + (o.section.split(" > ").pop() || o.section));
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
$<HTMLButtonElement>("prove").onclick = async () => {
  clearErr();
  const fd = formData();
  if (!fd) return fail("Pick a file and enter a question first.");
  proveAbort?.abort();
  proveAbort = new AbortController();
  const proveBtn = $<HTMLButtonElement>("prove");
  proveBtn.disabled = true;
  proveBtn.textContent = "Asking the model twice…";
  announce("Asking the model twice, this can take a few seconds…");
  try {
    const resp = await fetch("/api/answer", { method: "POST", body: fd, signal: proveAbort.signal });
    const d: AnswerApiResult = await resp.json();
    if (d.error) throw new Error(d.error);
    $("parity").classList.remove("hidden");
    $("parityModel").textContent = d.model;
    $("ansFull").textContent = d.full.answer;
    $("ansFull").lang = DEVANAGARI_RE.test(d.full.answer) ? "hi" : "";
    $("ansFullCost").textContent = d.full.context_tokens.toLocaleString() + " context tokens";
    $("ansCompiled").textContent = d.compiled.answer;
    $("ansCompiled").lang = DEVANAGARI_RE.test(d.compiled.answer) ? "hi" : "";
    $("ansCompiledCost").textContent =
      d.compiled.context_tokens.toLocaleString() + " context tokens (" + d.compiled.reduction_pct + "% less)";
    $("parity").scrollIntoView({ behavior: "smooth", block: "nearest" });
    announce("Answer parity ready: both answers shown below.");
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") return;
    fail(e instanceof Error ? e.message : String(e));
  } finally {
    proveBtn.disabled = false;
    proveBtn.textContent = "Prove answer parity";
  }
};

renderSamples();
