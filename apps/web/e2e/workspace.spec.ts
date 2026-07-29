import { expect, test, type Page, type Route } from "@playwright/test";

const config = {
  llm_available: true,
  max_file_bytes: 20 * 1024 * 1024,
  web_budget_min: 100,
  web_budget_max: 20_000,
  rate_limit: 100,
  rate_window_minutes: 5,
  rate_cost_answer: 4,
  rate_cost_agent: 12,
  max_concurrent_llm: 2,
  answer_context_cap: 60_000,
};

const samples = [
  {
    key: "golden",
    file: "golden.txt",
    fmt: "txt",
    nm: "Golden sample",
    mt: "Deterministic browser fixture",
    q: ["What is covered?"],
    tok: 10_000,
  },
];

const compileResult = {
  markdown: "# Coverage\nCovered golden content",
  raw_tokens: 10_000,
  tokens_used: 2_000,
  selected_content_tokens: 1_900,
  tokens_saved: 8_000,
  reduction_pct: 80,
  cache_hit: true,
  token_budget: 4_000,
  queries: ["What is covered?"],
  selected_sections: [
    {
      id: "selected-1",
      section: "Coverage > Included",
      tokens: 1_900,
      relevance: 100,
      text: "Covered golden content",
    },
  ],
  omitted_sections: [
    {
      id: "omitted-1",
      section: "Coverage > Exclusion",
      tokens: 700,
      relevance: 82,
    },
  ],
  budget_omitted_sections: [
    {
      id: "omitted-1",
      section: "Coverage > Exclusion",
      tokens: 700,
      relevance: 82,
      suggested_budget: 4_700,
    },
  ],
  relevance_omitted_sections: [],
  next_section_hint: {
    id: "omitted-1",
    section: "Coverage > Exclusion",
    tokens: 700,
    relevance: 82,
    suggested_budget: 4_700,
  },
  compile_hints: {
    multi_part_nudge: false,
    omit_action: true,
    named_omit: {
      id: "omitted-1",
      section: "Coverage > Exclusion",
      tokens: 700,
      relevance: 82,
    },
    early_stopped: false,
  },
  cost_raw_usd: 0.03,
  cost_compiled_usd: 0.006,
  price_per_mtok: 3,
  handle: "compile-golden",
  llm_available: true,
};

type MockOptions = {
  llmAvailable?: boolean;
  compileError?: string;
  compileResults?: Array<Record<string, unknown>>;
  answerDelayMs?: number;
  measureError?: string;
  measureDelayMs?: number;
  compileDelayMs?: number;
  sampleDelayMs?: number;
};

async function fulfillJson(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

async function mockWorkspace(page: Page, options: MockOptions = {}) {
  const requests = {
    answerBodies: [] as string[],
    agentBodies: [] as string[],
    compileBodies: [] as string[],
    expandBodies: [] as string[],
  };

  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/config") {
      await fulfillJson(route, {
        ...config,
        llm_available: options.llmAvailable ?? true,
        llm_disabled_reason: options.llmAvailable === false ? "test host has no key" : null,
      });
      return;
    }
    if (path === "/api/samples") {
      await fulfillJson(route, samples);
      return;
    }
    if (path === "/api/measure") {
      if (options.measureDelayMs) {
        await new Promise((resolve) => setTimeout(resolve, options.measureDelayMs));
      }
      if (options.measureError) {
        await fulfillJson(route, { error: options.measureError }, 500);
      } else {
        await fulfillJson(route, { raw_tokens: 1_250, handle: "measure-golden" });
      }
      return;
    }
    if (path === "/api/compile") {
      requests.compileBodies.push(route.request().postData() ?? "");
      if (options.compileDelayMs) {
        await new Promise((resolve) => setTimeout(resolve, options.compileDelayMs));
      }
      if (options.compileError) {
        await fulfillJson(route, { error: options.compileError }, 400);
      } else {
        const compileResults = options.compileResults?.length ? options.compileResults : [compileResult];
        const resultIndex = Math.min(requests.compileBodies.length - 1, compileResults.length - 1);
        await fulfillJson(route, compileResults[resultIndex]);
      }
      return;
    }
    if (path === "/api/expand") {
      const requestBody = route.request().postData() ?? "";
      requests.expandBodies.push(requestBody);
      const handle = (JSON.parse(requestBody) as { handle?: string }).handle ?? "unknown";
      await fulfillJson(route, {
        markdown: handle === compileResult.handle ? "Expanded exclusion text" : `Expanded for ${handle}`,
        tokens_used: 700,
        cache_hit: true,
      });
      return;
    }
    if (path === "/api/answer") {
      requests.answerBodies.push(route.request().postData() ?? "");
      if (options.answerDelayMs) {
        await new Promise((resolve) => setTimeout(resolve, options.answerDelayMs));
      }
      await fulfillJson(route, {
        model: "golden-model",
        full: { answer: "Full-file answer", context_tokens: 10_000 },
        compiled: {
          answer: "Compiled answer",
          context_tokens: 2_700,
          selected_content_tokens: 1_900,
          expand_content_tokens: 700,
          reduction_pct: 73,
          expanded_ids: ["omitted-1"],
        },
      });
      return;
    }
    if (path === "/api/agent") {
      requests.agentBodies.push(route.request().postData() ?? "");
      await route.fulfill({
        status: 200,
        headers: {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
        },
        body:
          'event: step\ndata: {"title":"Compile context","detail":"Ranked sections","tokens_added":1900}\n\n' +
          'event: done\ndata: {"answer":"Agent answer","tokens_read":1900,"raw_tokens":10000,"final_context_tokens":1900,"stopped_reason":"answered","unread_remaining":true,"parity_handle":"parity-golden"}\n\n',
      });
      return;
    }
    if (path === "/api/agent-parity") {
      await fulfillJson(route, {
        model: "golden-model",
        full: { answer: "Full-file answer", context_tokens: 10_000 },
        agent: { answer: "Agent answer", context_tokens: 1_900 },
      });
      return;
    }
    await route.fallback();
  });

  await page.route("**/samples/golden.txt", async (route) => {
    if (options.sampleDelayMs) {
      await new Promise((resolve) => setTimeout(resolve, options.sampleDelayMs));
    }
    await route.fulfill({
      status: 200,
      contentType: "text/plain",
      body: "Golden sample contents",
    });
  });

  return requests;
}

async function pickSample(page: Page) {
  await page.getByRole("button", { name: /Golden sample/ }).click();
  await expect(page.getByRole("status")).toContainText("Golden sample");
}

async function compileSample(page: Page) {
  await pickSample(page);
  await page.getByRole("button", { name: "Compile", exact: true }).click();
  await expect(page).toHaveURL(/\/workspace\/results$/);
  await expect(page.getByRole("heading", { name: "Compiled context" })).toBeVisible();
}

async function mockAnswersIgnoringAbort(
  page: Page,
  attempts: Array<{ delayMs: number; fullAnswer: string; compiledAnswer: string }>
) {
  await page.addInitScript((answerAttempts) => {
    const nativeFetch = window.fetch.bind(window);
    let answerIndex = 0;
    window.fetch = (input, init) => {
      if (!String(input).endsWith("/api/answer")) return nativeFetch(input, init);
      const attempt = answerAttempts[Math.min(answerIndex++, answerAttempts.length - 1)];
      return new Promise<Response>((resolve) => {
        window.setTimeout(() => {
          resolve(
            new Response(
              JSON.stringify({
                model: "snapshot-model",
                full: { answer: attempt.fullAnswer, context_tokens: 10_000 },
                compiled: {
                  answer: attempt.compiledAnswer,
                  context_tokens: 2_000,
                  selected_content_tokens: 1_900,
                  expand_content_tokens: 0,
                  reduction_pct: 80,
                  expanded_ids: [],
                },
              }),
              { status: 200, headers: { "content-type": "application/json" } }
            )
          );
        }, attempt.delayMs);
      });
    };
  }, attempts);
}

test("flag off keeps legacy workspace steps and guards result-only routes", async ({ page }) => {
  await mockWorkspace(page);
  await page.goto("/workspace");

  await expect(page.locator(".workspace-rail")).toHaveCount(0);
  const liveSummary = page.getByTestId("live-task-summary");
  await expect(liveSummary).toContainText("No document");
  await expect(liveSummary).toContainText("No task");
  await expect(liveSummary).toContainText("4,000 tokens");
  await expect(page.getByTestId("compiled-task-summary")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Compile", exact: true })).toHaveAttribute(
    "aria-current",
    "step"
  );
  for (const label of ["Results", "Prove", "Agent"]) {
    await expect(page.getByText(label, { exact: true })).toHaveAttribute("aria-disabled", "true");
  }

  await page.goto("/workspace/results");
  await expect(page.getByRole("heading", { name: "No compile yet" })).toBeVisible();
  await page.getByRole("link", { name: "Compile a document" }).click();
  await expect(page).toHaveURL(/\/workspace$/);
});

test("@revamp flag on makes the rail the only task editor", async ({ page }) => {
  test.skip(
    process.env.NEXT_PUBLIC_CC_WORKSPACE_REVAMP !== "1",
    "Run with NEXT_PUBLIC_CC_WORKSPACE_REVAMP=1 and a matching web build."
  );
  await mockWorkspace(page);
  await page.goto("/workspace");

  const rail = page.getByRole("complementary", { name: "Live task" });
  await expect(rail).toBeVisible();
  await expect(page.getByRole("region", { name: "Workspace canvas" })).toBeVisible();
  await expect(rail.locator("#budget")).toHaveValue("4000");
  await expect(page.locator('input[type="file"]')).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Compile", exact: true })).toHaveCount(1);
  await expect(page.locator(".workspace-canvas").locator('input[type="file"]')).toHaveCount(0);

  const activity = rail.getByRole("navigation", { name: "Workspace activity" });
  await expect(activity.locator(".workspace-activity-link", { hasText: "Results" })).toHaveAttribute(
    "aria-disabled",
    "true"
  );
  await expect(activity.locator(".workspace-activity-link", { hasText: "Prove" })).toHaveAttribute(
    "aria-disabled",
    "true"
  );
  await expect(activity.locator(".workspace-activity-link", { hasText: "Agent" })).toHaveAttribute(
    "aria-disabled",
    "true"
  );
  await expect(activity.getByText("Compile", { exact: true })).toHaveCount(0);

  await pickSample(page);
  await rail.getByRole("button", { name: "Compile", exact: true }).click();
  await expect(page).toHaveURL(/\/workspace\/results$/);
  await expect(activity.getByRole("link", { name: /Results/ })).toHaveAttribute("aria-current", "page");
  await expect(rail).toContainText("Current");
  await expect(page.locator('input[type="file"]')).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Compile", exact: true })).toHaveCount(1);
});

test("@revamp Results stays bound to the compiled snapshot and payload order", async ({ page }) => {
  test.skip(
    process.env.NEXT_PUBLIC_CC_WORKSPACE_REVAMP !== "1",
    "Run with NEXT_PUBLIC_CC_WORKSPACE_REVAMP=1 and a matching web build."
  );
  const orderedResult = {
    ...compileResult,
    raw_tokens: 12_345,
    tokens_used: 2_345,
    token_budget: 4_321,
    reduction_pct: 81,
    handle: "compile-ordered",
    selected_sections: [
      {
        id: "payload-first",
        section: "Payload > First",
        tokens: 1_200,
        relevance: 25,
        text: "First in payload despite lower relevance",
      },
      {
        id: "payload-second",
        section: "Payload > Second",
        tokens: 1_145,
        relevance: 99,
        text: "Second in payload despite higher relevance",
      },
    ],
  };
  await mockWorkspace(page, { compileResults: [orderedResult] });
  await page.goto("/workspace");
  await compileSample(page);

  const canvas = page.getByRole("region", { name: "Workspace canvas" });
  await expect(canvas.getByTestId("results-snapshot-label")).toContainText("What is covered?");
  await expect(canvas.getByTestId("results-snapshot-label")).toContainText("4,000 token budget");
  await expect(canvas.getByRole("heading", { name: "Compiled context" }).locator("..")).toContainText(
    "12,345 → 2,345 tokens"
  );
  await expect(canvas.locator(".scard-static.in .nm")).toHaveText([
    /Payload > First.*payload-first/,
    /Payload > Second.*payload-second/,
  ]);

  await page.locator("#task").fill("Live task must stay in the rail");
  await page.locator("#budget").fill("6000");
  await expect(canvas.getByTestId("results-snapshot-label")).toContainText("What is covered?");
  await expect(canvas.getByTestId("results-snapshot-label")).toContainText("4,000 token budget");
  await expect(canvas).not.toContainText("Live task must stay in the rail");
  await expect(canvas.getByTestId("stale-results-status")).toContainText(
    "Stale result — showing the previous compiled snapshot"
  );
  await expect(canvas.getByText("First in payload despite lower relevance")).toBeVisible();
});

test("@revamp Results expands by visible handle and resets peeks and includes on compile", async ({
  page,
}) => {
  test.skip(
    process.env.NEXT_PUBLIC_CC_WORKSPACE_REVAMP !== "1",
    "Run with NEXT_PUBLIC_CC_WORKSPACE_REVAMP=1 and a matching web build."
  );
  const requests = await mockWorkspace(page, {
    compileResults: [
      { ...compileResult, handle: "compile-visible-a" },
      { ...compileResult, handle: "compile-visible-b", markdown: "# New compile" },
    ],
  });
  await page.goto("/workspace");
  await compileSample(page);

  await expect(page.getByText("Expanded for compile-visible-a")).toBeVisible();
  await page.getByLabel("Include in Prove", { exact: true }).check();
  await expect(page.getByLabel("Include in Prove", { exact: true })).toBeChecked();
  expect(requests.expandBodies.at(-1)).toContain('"handle":"compile-visible-a"');

  await page
    .getByRole("complementary", { name: "Live task" })
    .getByRole("button", {
      name: "Compile",
      exact: true,
    })
    .click();
  await expect(page.getByText("Expanded for compile-visible-b")).toBeVisible();
  await expect(page.getByText("Expanded for compile-visible-a")).toHaveCount(0);
  await expect(page.getByLabel("Include in Prove", { exact: true })).not.toBeChecked();
  expect(requests.expandBodies.at(-1)).toContain('"handle":"compile-visible-b"');
});

test("@revamp budget drift retains Results cards but disables Prove includes", async ({ page }) => {
  test.skip(
    process.env.NEXT_PUBLIC_CC_WORKSPACE_REVAMP !== "1",
    "Run with NEXT_PUBLIC_CC_WORKSPACE_REVAMP=1 and a matching web build."
  );
  await mockWorkspace(page);
  await page.goto("/workspace");
  await compileSample(page);

  const canvas = page.getByRole("region", { name: "Workspace canvas" });
  await page.locator("#budget").fill("5000");
  await expect(canvas.getByText("Coverage > Included")).toBeVisible();
  await expect(canvas.getByText("Coverage > Exclusion")).toBeVisible();
  await expect(canvas.getByLabel("Include in Prove", { exact: true })).toBeDisabled();
  await expect(canvas.getByTestId("stale-results-status")).toContainText("budget changed since this compile");
  await expect(canvas.getByTestId("stale-results-status")).toContainText("Use Compile in the live task rail");
  await expect(canvas.getByTestId("stale-results-status").getByRole("link")).toHaveCount(0);
});

test("@revamp Prove keeps submitted labels and answers through live rail edits", async ({ page }) => {
  test.skip(
    process.env.NEXT_PUBLIC_CC_WORKSPACE_REVAMP !== "1",
    "Run with NEXT_PUBLIC_CC_WORKSPACE_REVAMP=1 and a matching web build."
  );
  const requests = await mockWorkspace(page, { answerDelayMs: 150 });
  await page.goto("/workspace");
  await compileSample(page);
  await page.getByLabel("Include in Prove", { exact: true }).check();
  await page.getByRole("link", { name: "Prove answer parity" }).click();
  await page.getByRole("button", { name: "Prove", exact: true }).click();

  const snapshot = page.getByTestId("prove-run-snapshot");
  await expect(snapshot).toContainText("What is covered?");
  await expect(snapshot).toContainText("4,000 token budget");
  await expect(snapshot).toContainText("compile compile-golden");
  await expect(snapshot).toContainText("includes omitted-1");

  await page.locator("#task").fill("Edited while Prove is running");
  await page.locator("#budget").fill("6000");
  await expect(snapshot).not.toContainText("Edited while Prove is running");
  await expect(snapshot).not.toContainText("6,000 token budget");
  await expect(page.getByText("Compiled answer", { exact: true })).toBeVisible();
  await expect(snapshot).toContainText("What is covered?");
  await expect(snapshot).toContainText("4,000 token budget");
  expect(requests.answerBodies.at(-1)).toContain("What is covered?");
  expect(requests.answerBodies.at(-1)).toContain('["omitted-1"]');
});

test("@revamp rail resolves upload, sample, and measurement races", async ({ page }) => {
  test.skip(
    process.env.NEXT_PUBLIC_CC_WORKSPACE_REVAMP !== "1",
    "Run with NEXT_PUBLIC_CC_WORKSPACE_REVAMP=1 and a matching web build."
  );
  await mockWorkspace(page, { sampleDelayMs: 150, measureDelayMs: 150 });
  await page.goto("/workspace");

  await page.getByRole("button", { name: /Golden sample/ }).click();
  await page.locator("#file").setInputFiles({
    name: "upload-wins.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Upload wins"),
  });
  await expect(page.getByRole("status")).toContainText("upload-wins.txt");
  await page.waitForTimeout(200);
  await expect(page.getByRole("status")).toContainText("upload-wins.txt");
  await expect(page.locator("#task")).toHaveValue("");

  await page.locator("#file").setInputFiles({
    name: "measurement-loses.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Measurement loses"),
  });
  await page.getByRole("button", { name: /Golden sample/ }).click();
  await expect(page.getByRole("status")).toContainText("Golden sample");
  await page.waitForTimeout(200);
  await expect(page.getByText(/This document is about 10,000 tokens total/)).toBeVisible();
  await expect(page.getByText(/1,250 tokens/)).toHaveCount(0);
});

test("@revamp rail keeps validation and measurement fallback", async ({ page }) => {
  test.skip(
    process.env.NEXT_PUBLIC_CC_WORKSPACE_REVAMP !== "1",
    "Run with NEXT_PUBLIC_CC_WORKSPACE_REVAMP=1 and a matching web build."
  );
  await mockWorkspace(page, { measureError: "measurement unavailable" });
  await page.goto("/workspace");

  await page.locator("#file").setInputFiles({
    name: "invalid.exe",
    mimeType: "application/octet-stream",
    buffer: Buffer.from("invalid"),
  });
  await expect(page.locator(".err[role=alert]")).toContainText(/file type|extension/i);
  await expect(page.locator("#file")).toHaveValue("");

  await page.locator("#file").setInputFiles({
    name: "valid.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("valid"),
  });
  await expect(page.getByText(/Couldn't pre-measure this file: measurement unavailable/)).toBeVisible();
  await page.locator("#task").fill("");
  await page.getByRole("button", { name: "Compile", exact: true }).click();
  await expect(page.locator(".err[role=alert]")).toHaveText("Enter a question / task.");
});

test("@revamp rail cancels compile from its owning editor", async ({ page }) => {
  test.skip(
    process.env.NEXT_PUBLIC_CC_WORKSPACE_REVAMP !== "1",
    "Run with NEXT_PUBLIC_CC_WORKSPACE_REVAMP=1 and a matching web build."
  );
  await mockWorkspace(page);
  await page.addInitScript(() => {
    const nativeFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      if (String(input).endsWith("/api/compile")) {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("The operation was aborted.", "AbortError")),
            { once: true }
          );
        });
      }
      return nativeFetch(input, init);
    };
  });
  await page.goto("/workspace");
  await pickSample(page);
  await page.getByRole("button", { name: "Compile", exact: true }).click();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.locator(".err[role=alert]")).toHaveText("Compile cancelled.");
});

test("@revamp rail submits by keyboard once and preserves Shift+Enter", async ({ page }) => {
  test.skip(
    process.env.NEXT_PUBLIC_CC_WORKSPACE_REVAMP !== "1",
    "Run with NEXT_PUBLIC_CC_WORKSPACE_REVAMP=1 and a matching web build."
  );
  const requests = await mockWorkspace(page, { compileDelayMs: 150 });
  await page.goto("/workspace");
  await pickSample(page);

  const task = page.locator("#task");
  await task.fill("First line");
  await task.press("Shift+Enter");
  await expect(task).toHaveValue("First line\n");
  expect(requests.compileBodies).toHaveLength(0);

  await task.press("Enter");
  await page.evaluate(() =>
    document.querySelector<HTMLFormElement>(".workspace-rail-editor")?.requestSubmit()
  );
  await expect(page).toHaveURL(/\/workspace\/results$/);
  expect(requests.compileBodies).toHaveLength(1);
});

test("keeps the submitted task and budget in the compiled summary", async ({ page }) => {
  await mockWorkspace(page);
  await page.goto("/workspace");
  await pickSample(page);
  await page.locator("#task").fill("Exact submitted task");
  await page.locator("#budget").fill("5000");
  await page.getByRole("button", { name: "Compile", exact: true }).click();
  await expect(page).toHaveURL(/\/workspace\/results$/);

  const compiledSummary = page.getByTestId("compiled-task-summary");
  await expect(compiledSummary).toContainText("Golden sample");
  await expect(compiledSummary).toContainText("Exact submitted task");
  await expect(compiledSummary).toContainText("5,000 tokens");

  await page.getByRole("link", { name: "Compile", exact: true }).click();
  await page.locator("#task").fill("Live edited task");
  await page.locator("#budget").fill("6000");
  await expect(page.getByTestId("live-task-summary")).toContainText("Live edited task");
  await expect(page.getByTestId("live-task-summary")).toContainText("6,000 tokens");
  await expect(compiledSummary).toContainText("Exact submitted task");
  await expect(compiledSummary).toContainText("5,000 tokens");
  await expect(compiledSummary).not.toContainText("Live edited task");
});

test("captures task and budget stale routing rules", async ({ page }) => {
  await mockWorkspace(page);
  await page.goto("/workspace");
  await compileSample(page);

  await page.getByRole("link", { name: "Compile", exact: true }).click();
  await page.locator("#budget").fill("5000");
  await page.getByRole("link", { name: "Results" }).click();
  await expect(page.getByText(/budget changed since this compile/i)).toBeVisible();
  await expect(page.getByRole("link", { name: "Prove answer parity" })).toHaveAttribute("href", "/workspace");
  await expect(page.getByRole("link", { name: "Run agent", exact: true })).toHaveAttribute(
    "href",
    "/workspace/agent"
  );

  await page.getByRole("link", { name: "Compile", exact: true }).click();
  await page.locator("#task").fill("A changed task");
  await page.getByRole("link", { name: "Results" }).click();
  await expect(page.getByText(/question changed since this compile/i)).toBeVisible();
  await expect(page.getByRole("link", { name: "Prove answer parity" })).toHaveAttribute("href", "/workspace");
  await expect(page.getByRole("link", { name: "Run agent", exact: true })).toHaveAttribute(
    "href",
    "/workspace"
  );
});

test("persists sample compile and Include in Prove across navigation and reload", async ({ page }) => {
  await mockWorkspace(page);
  await page.goto("/workspace");
  await compileSample(page);

  const include = page.getByLabel("Include in Prove", { exact: true });
  await include.check();
  await page.getByRole("link", { name: "Agent", exact: true }).click();
  await page.getByRole("link", { name: "Results", exact: true }).click();
  await expect(include).toBeChecked();

  await page.reload();
  await expect(page.getByRole("heading", { name: "Compiled context" })).toBeVisible();
  await expect(page.getByLabel("Include in Prove", { exact: true })).toBeChecked();
  await page.getByRole("link", { name: "Compile", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Sample: Golden sample");
});

test("migrates v1 persistence to v2 without deleting the rollout key", async ({ page }) => {
  await mockWorkspace(page);
  await page.addInitScript(
    ({ result }) => {
      sessionStorage.setItem(
        "cc-workspace-v1",
        JSON.stringify({
          task: "Migrated task",
          budget: 5000,
          filePicked: "Sample: Golden sample",
          sampleKey: "golden",
          compile: result,
          compiledTask: "Original compiled task",
          compiledBudget: 4000,
          proveExpandedIds: ["omitted-1"],
          proveExpandedTokens: [["omitted-1", 700]],
          sessionSavedTokens: 8000,
          sessionSavedUsd: 0.024,
        })
      );
    },
    { result: compileResult }
  );

  await page.goto("/workspace/results");
  await expect(page.getByRole("heading", { name: "Compiled context" })).toBeVisible();
  await expect(page.getByLabel("Include in Prove", { exact: true })).toBeChecked();
  await expect(page.getByText(/question changed since this compile/i)).toBeVisible();

  const storage = await page.evaluate(() => ({
    v1: sessionStorage.getItem("cc-workspace-v1"),
    v2: JSON.parse(sessionStorage.getItem("cc-workspace-v2") ?? "null") as {
      version?: number;
      live?: { task?: string };
      sessionTotals?: { savedTokens?: number };
    } | null,
  }));
  expect(storage.v1).not.toBeNull();
  expect(storage.v2?.version).toBe(2);
  expect(storage.v2?.live?.task).toBe("Migrated task");
  expect(storage.v2?.sessionTotals?.savedTokens).toBe(8000);
});

test("normalizes malformed, partial, and unknown-version persistence", async ({ page }) => {
  await mockWorkspace(page);
  await page.addInitScript(() => {
    if (sessionStorage.getItem("persistence-test-seeded")) return;
    sessionStorage.setItem("persistence-test-seeded", "true");
    sessionStorage.setItem("cc-workspace-v2", "{not json");
  });
  await page.goto("/workspace");
  await expect(page.locator("#task")).toHaveValue("");
  await expect(page.locator("#budget")).toHaveValue("4000");

  await page.evaluate(() => {
    sessionStorage.setItem(
      "cc-workspace-v2",
      JSON.stringify({ version: 2, live: { task: "Partial record" } })
    );
  });
  await page.reload();
  await expect(page.locator("#task")).toHaveValue("Partial record");
  await expect(page.locator("#budget")).toHaveValue("4000");
  await expect(page.getByTestId("compiled-task-summary")).toHaveCount(0);

  await page.evaluate(() => {
    sessionStorage.setItem("cc-workspace-v2", JSON.stringify({ version: 99, live: { task: "Unsafe" } }));
    sessionStorage.setItem(
      "cc-workspace-v1",
      JSON.stringify({
        task: "Known fallback",
        budget: 6000,
        filePicked: "custom.txt",
        sampleKey: null,
        compile: null,
        compiledTask: null,
        compiledBudget: null,
        proveExpandedIds: [],
        proveExpandedTokens: [],
      })
    );
  });
  await page.reload();
  await expect(page.locator("#task")).toHaveValue("Known fallback");
  await expect(page.locator("#budget")).toHaveValue("6000");
});

test("restores a stale sample snapshot without making the changed task current", async ({ page }) => {
  await mockWorkspace(page);
  await page.goto("/workspace");
  await compileSample(page);
  await page.getByRole("link", { name: "Compile", exact: true }).click();
  await page.locator("#task").fill("Changed after compile");
  await expect(page.getByTestId("live-task-summary")).toContainText("Changed after compile");

  await page.reload();
  await page.goto("/workspace/results");
  await expect(page.getByRole("heading", { name: "Compiled context" })).toBeVisible();
  await expect(page.getByText(/question changed since this compile/i)).toBeVisible();
  await expect(page.getByTestId("compiled-task-summary")).toContainText("What is covered?");
  await expect(page.getByTestId("compiled-task-summary")).not.toContainText("Changed after compile");
});

test("does not restore a custom upload compile after reload", async ({ page }) => {
  await mockWorkspace(page);
  await page.goto("/workspace");
  await page.locator("#file").setInputFiles({
    name: "custom.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Custom upload contents"),
  });
  await expect(page.getByText(/This document is \~1,250 tokens/)).toBeVisible();
  await page.locator("#task").fill("Custom task");
  await page.getByRole("button", { name: "Compile", exact: true }).click();
  await expect(page).toHaveURL(/\/workspace\/results$/);

  await page.reload();
  await expect(page.getByRole("heading", { name: "No compile yet" })).toBeVisible();
  await page.goto("/workspace");
  await expect(page.locator("#task")).toHaveValue("Custom task");
  await expect(page.locator("#file")).toHaveValue("");
  await expect(page.getByTestId("live-task-summary")).toContainText("custom.txt");
  await expect(page.getByTestId("live-task-summary")).toContainText("Missing file bytes");
  await expect(page.getByTestId("compiled-task-summary")).toHaveCount(0);
});

test("disables all LLM entry points when the host has no key", async ({ page }) => {
  await mockWorkspace(page, { llmAvailable: false });
  await page.goto("/workspace");
  await pickSample(page);
  await expect(page.getByRole("button", { name: "Prove…" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Run agent ▸" })).toBeDisabled();

  await page.getByRole("button", { name: "Compile", exact: true }).click();
  await page.goto("/workspace/prove");
  await expect(page.getByText(/Prove disabled: test host has no key/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Prove", exact: true })).toBeDisabled();
  await page.goto("/workspace/agent");
  await expect(page.getByText(/Agent disabled: test host has no key/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Run agent", exact: true })).toBeDisabled();
});

test("cancels an in-flight compile and exposes API errors", async ({ page }) => {
  await mockWorkspace(page);
  await page.addInitScript(() => {
    const nativeFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      if (String(input).endsWith("/api/compile")) {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("The operation was aborted.", "AbortError")),
            { once: true }
          );
        });
      }
      return nativeFetch(input, init);
    };
  });
  await page.goto("/workspace");
  await pickSample(page);
  await page.getByRole("button", { name: "Compile", exact: true }).click();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByText("Compile cancelled.", { exact: true })).toBeVisible();

  const errorPage = await page.context().newPage();
  await mockWorkspace(errorPage, { compileError: "Golden compile rejected" });
  await errorPage.goto("/workspace");
  await pickSample(errorPage);
  await errorPage.getByRole("button", { name: "Compile", exact: true }).click();
  await expect(errorPage.getByText("Golden compile rejected", { exact: true })).toBeVisible();
});

test("cancelled Prove snapshot cannot be overwritten by a late response", async ({ page }) => {
  await mockWorkspace(page);
  await mockAnswersIgnoringAbort(page, [
    { delayMs: 150, fullAnswer: "Late full answer", compiledAnswer: "Late compiled answer" },
  ]);
  await page.goto("/workspace");
  await compileSample(page);
  await page.getByRole("link", { name: "Prove answer parity" }).click();
  await page.getByRole("button", { name: "Prove", exact: true }).click();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();

  await expect(page.locator(".err[role=alert]")).toHaveText("Prove cancelled.");
  await page.waitForTimeout(200);
  await expect(page.locator(".err[role=alert]")).toHaveText("Prove cancelled.");
  await expect(page.getByText("Late compiled answer", { exact: true })).toHaveCount(0);
});

test("newer Prove retry wins when two attempts finish out of order", async ({ page }) => {
  await mockWorkspace(page);
  await mockAnswersIgnoringAbort(page, [
    { delayMs: 250, fullAnswer: "Older full answer", compiledAnswer: "Older compiled answer" },
    { delayMs: 20, fullAnswer: "Newer full answer", compiledAnswer: "Newer compiled answer" },
  ]);
  await page.goto("/workspace");
  await compileSample(page);
  await page.getByRole("link", { name: "Prove answer parity" }).click();
  await page.getByRole("button", { name: "Prove", exact: true }).click();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Retry submitted snapshot" }).click();

  await expect(page.getByText("Newer compiled answer", { exact: true })).toBeVisible();
  await page.waitForTimeout(300);
  await expect(page.getByText("Newer compiled answer", { exact: true })).toBeVisible();
  await expect(page.getByText("Older compiled answer", { exact: true })).toHaveCount(0);
  await expect(page.getByTestId("prove-run-snapshot")).toContainText("What is covered?");
  await expect(page.getByTestId("prove-run-snapshot")).toContainText("4,000 token budget");
});

test("mocks expand, answer, and agent flows with stable golden output", async ({ page }) => {
  const requests = await mockWorkspace(page);
  await page.goto("/workspace");
  await compileSample(page);

  await expect(page.getByText("Expanded exclusion text")).toBeVisible();
  await page.getByLabel("Include in Prove", { exact: true }).check();
  await page.getByRole("link", { name: "Prove answer parity" }).click();
  await page.getByRole("button", { name: "Prove", exact: true }).click();
  await expect(page.getByText("Full-file answer")).toBeVisible();
  await expect(page.getByText("Compiled answer")).toBeVisible();
  expect(requests.answerBodies.at(-1)).toContain('["omitted-1"]');

  await page.getByRole("link", { name: "Agent", exact: true }).click();
  await page.getByRole("button", { name: "Run agent", exact: true }).click();
  await expect(page.getByText("Ranked sections")).toBeVisible();
  await expect(page.getByText("Agent answer", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Compare to full file" }).click();
  await expect(page.getByText("Agent context · 1,900 tok")).toBeVisible();
  expect(requests.agentBodies).toHaveLength(1);
});
