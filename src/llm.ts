/**
 * Thin LLM interface — the entire provider surface lives in this file.
 *
 * Providers are tried in a fixed priority order, and complete() automatically
 * falls over to the next one when a provider errors (rate limit, quota, network
 * blip, bad key). If they all fail, complete() throws and callers degrade
 * gracefully: rerank drops back to BM25, and the answer panel reports the error.
 *
 * Priority order (highest first):
 *   1. Gemini      — GEMINI_API_KEY   (free tier, no card; the intended primary)
 *   2. OpenRouter  — OPENROUTER_API_KEY (fallback across many models)
 *   3. Anthropic   — ANTHROPIC_API_KEY (Claude)
 *   4. Generic     — OPENAI_API_KEY, or CC_LLM_API_KEY + CC_LLM_BASE_URL
 *                    (any OpenAI-compatible endpoint: OpenAI, Groq, Ollama, ...)
 *
 * Configure as many or as few as you like — an unset key just skips that
 * provider. No keys at all → fully local (BM25 rank, no answer panel).
 *
 * Each provider has a sensible default model, overridable per-provider by env
 * (see the CC_*_MODEL vars below) without touching the priority order.
 */
import Anthropic from "@anthropic-ai/sdk";

import { intEnv } from "./env.js";
import { log } from "./log.js";
import { inc } from "./metrics.js";

const GEMINI_DEFAULT = "gemini-3.5-flash";
const OPENROUTER_DEFAULT = "meta-llama/llama-3.3-70b-instruct:free";
const ANTHROPIC_DEFAULT = "claude-haiku-4-5-20251001";
const OPENAI_DEFAULT = "gpt-4o-mini";

const LLM_TIMEOUT_MS = intEnv("CC_LLM_TIMEOUT_MS", 30_000, 1_000, 300_000);
const MAX_CONCURRENT_LLM = intEnv("CC_MAX_CONCURRENT_LLM", 2, 1, 32);

type OpenAICompatProvider = {
  name: string;
  kind: "openai-compat";
  baseUrl: string;
  apiKey: string;
  model: string;
  headers?: Record<string, string>;
};
type AnthropicProvider = { name: string; kind: "anthropic"; apiKey: string; model: string };
type Provider = OpenAICompatProvider | AnthropicProvider;

/** Thrown when every configured provider fails (or none are configured). */
export class LlmUnavailableError extends Error {
  /** Safe for HTTP/SSE clients — no provider bodies or keys. */
  readonly publicMessage =
    "The AI provider is unavailable right now — try again in a minute.";
  constructor(detail: string) {
    super(detail);
    this.name = "LlmUnavailableError";
  }
}

/** Thrown when too many LLM-heavy demo jobs are already in flight. */
export class LlmBusyError extends Error {
  constructor(message = "Too many AI requests in flight — please retry in a few seconds.") {
    super(message);
    this.name = "LlmBusyError";
  }
}

let activeLlmJobs = 0;

/** Bound concurrent agent/parity/rerank work so one host can't melt the API bill. */
export function tryAcquireLlmJob(): boolean {
  if (activeLlmJobs >= MAX_CONCURRENT_LLM) return false;
  activeLlmJobs += 1;
  return true;
}

export function releaseLlmJob(): void {
  activeLlmJobs = Math.max(0, activeLlmJobs - 1);
}

function providerChain(): Provider[] {
  const chain: Provider[] = [];

  const geminiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
  if (geminiKey) {
    chain.push({
      name: "gemini",
      kind: "openai-compat",
      baseUrl: (
        process.env.CC_GEMINI_BASE_URL ?? "https://generativelanguage.googleapis.com/v1beta/openai"
      ).replace(/\/+$/, ""),
      apiKey: geminiKey,
      model: process.env.CC_GEMINI_MODEL ?? GEMINI_DEFAULT,
    });
  }

  if (process.env.OPENROUTER_API_KEY) {
    chain.push({
      name: "openrouter",
      kind: "openai-compat",
      baseUrl: (process.env.CC_OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1").replace(/\/+$/, ""),
      apiKey: process.env.OPENROUTER_API_KEY,
      model: process.env.CC_OPENROUTER_MODEL ?? OPENROUTER_DEFAULT,
      headers: process.env.CC_OPENROUTER_REFERER
        ? { "HTTP-Referer": process.env.CC_OPENROUTER_REFERER, "X-Title": "Context Compiler" }
        : undefined,
    });
  }

  if (process.env.ANTHROPIC_API_KEY) {
    chain.push({
      name: "anthropic",
      kind: "anthropic",
      apiKey: process.env.ANTHROPIC_API_KEY,
      model: process.env.CC_ANTHROPIC_MODEL ?? ANTHROPIC_DEFAULT,
    });
  }

  const genericKey = process.env.CC_LLM_API_KEY ?? process.env.OPENAI_API_KEY;
  if (genericKey) {
    chain.push({
      name: "openai",
      kind: "openai-compat",
      baseUrl: (process.env.CC_LLM_BASE_URL ?? "https://api.openai.com/v1").replace(/\/+$/, ""),
      apiKey: genericKey,
      model: process.env.CC_LLM_MODEL ?? OPENAI_DEFAULT,
    });
  }

  return chain;
}

export function hasLlm(): boolean {
  return providerChain().length > 0;
}

export function answerModel(): string {
  return process.env.CC_ANSWER_MODEL ?? providerChain()[0]?.model ?? OPENAI_DEFAULT;
}

let anthropicClient: Anthropic | null = null;

function mergeSignals(signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(LLM_TIMEOUT_MS);
  if (!signal) return timeout;
  return AbortSignal.any([signal, timeout]);
}

async function callProvider(
  p: Provider,
  prompt: string,
  maxTokens: number,
  signal: AbortSignal
): Promise<string> {
  if (p.kind === "anthropic") {
    if (!anthropicClient) anthropicClient = new Anthropic({ apiKey: p.apiKey });
    const msg = await anthropicClient.messages.create(
      {
        model: p.model,
        max_tokens: maxTokens,
        messages: [{ role: "user", content: prompt }],
      },
      { signal }
    );
    const block = msg.content[0];
    return block && block.type === "text" ? block.text : "";
  }

  const res = await fetch(`${p.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${p.apiKey}`,
      ...p.headers,
    },
    body: JSON.stringify({
      model: p.model,
      max_tokens: maxTokens,
      messages: [{ role: "user", content: prompt }],
    }),
    signal,
  });
  if (!res.ok) {
    throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
  }
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return data.choices?.[0]?.message?.content ?? "";
}

/**
 * Run a prompt through the provider chain, failing over on any error. Returns
 * the first successful completion; throws only if every configured provider
 * fails (so a single provider's rate limit never takes the feature down while
 * another key still works).
 */
export async function complete(
  prompt: string,
  opts: { maxTokens?: number; signal?: AbortSignal } = {}
): Promise<string> {
  const chain = providerChain();
  if (!chain.length) throw new LlmUnavailableError("No LLM API key configured");
  const maxTokens = opts.maxTokens ?? 1024;
  const signal = mergeSignals(opts.signal);

  const errors: string[] = [];
  for (const p of chain) {
    if (signal.aborted) throw new Error("LLM request aborted");
    try {
      return await callProvider(p, prompt, maxTokens, signal);
    } catch (e) {
      if (signal.aborted) throw new Error("LLM request aborted");
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`${p.name}: ${msg}`);
      if (p !== chain[chain.length - 1]) {
        inc("llm_failover");
        // Free-tier OpenRouter (and friends) 429 often — expected failover,
        // not an ops alert. Real outages still surface if every provider fails.
        const rateLimited = /\b429\b|rate.?limit|too many requests|quota/i.test(msg);
        const level = rateLimited ? "info" : "warn";
        log[level]("LLM provider failed, trying next", { provider: p.name, err: msg });
      }
    }
  }
  inc("llm_all_failed");
  throw new LlmUnavailableError(`All LLM providers failed — ${errors.join("; ")}`);
}
