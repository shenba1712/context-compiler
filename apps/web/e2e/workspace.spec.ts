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
      await fulfillJson(route, { raw_tokens: 1_250, handle: "measure-golden" });
      return;
    }
    if (path === "/api/compile") {
      if (options.compileError) {
        await fulfillJson(route, { error: options.compileError }, 400);
      } else {
        await fulfillJson(route, compileResult);
      }
      return;
    }
    if (path === "/api/expand") {
      await fulfillJson(route, {
        markdown: "Expanded exclusion text",
        tokens_used: 700,
        cache_hit: true,
      });
      return;
    }
    if (path === "/api/answer") {
      requests.answerBodies.push(route.request().postData() ?? "");
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

  await page.route("**/samples/golden.txt", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/plain",
      body: "Golden sample contents",
    })
  );

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

test("routes workspace steps and guards result-only routes before compile", async ({ page }) => {
  await mockWorkspace(page);
  await page.goto("/workspace");

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
