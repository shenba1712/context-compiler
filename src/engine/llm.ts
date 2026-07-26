/**
 * Thin LLM interface — the entire provider surface lives in this file.
 *
 * Providers are tried in a fixed priority order, and complete() automatically
 * falls over to the next entry when one errors (rate limit, quota, network
 * blip, bad/retired model id). If they all fail, complete() throws and callers
 * degrade gracefully: the answer panel reports the error.
 *
 * Priority order (highest first):
 *   1. Gemini      — GEMINI_API_KEY   (free tier; tries several model ids)
 *   2. OpenRouter  — OPENROUTER_API_KEY (fallback across many models)
 *   3. Anthropic   — ANTHROPIC_API_KEY (Claude)
 *   4. Generic     — OPENAI_API_KEY, or CC_LLM_API_KEY + CC_LLM_BASE_URL
 *                    (any OpenAI-compatible endpoint: OpenAI, Groq, Ollama, ...)
 *
 * Gemini free-tier model ids churn, so one Gemini key expands into a short
 * model list (defaults below; override with CC_GEMINI_MODELS or pin one via
 * CC_GEMINI_MODEL). Each model is tried before moving to the next provider.
 * Soft 404 / model-not-found failures are remembered briefly
 * (CC_GEMINI_DEAD_MODEL_TTL_MS) so later complete() calls skip that id.
 * Soft 429/quota on Gemini pauses briefly before the next chain entry
 * (CC_LLM_FAILOVER_COOLDOWN_MS, default 1500ms, capped at 10s; prefers
 * Retry-After when the provider sends it). 404s fail over immediately.
 *
 * Configure as many or as few providers as you like — an unset key just skips
 * that provider. No keys at all → fully local (BM25 rank, no answer panel).
 */
import Anthropic from "@anthropic-ai/sdk";

import { intEnv } from "./env.js";
import { log } from "./log.js";
import { inc } from "./metrics.js";

/** Tried in order on the same Gemini key before failing over to OpenRouter etc. */
const GEMINI_MODELS_DEFAULT = [
  "gemini-flash-lite-latest",
  "gemini-3-flash-preview",
  "gemini-flash-latest",
] as const;

const OPENROUTER_DEFAULT = "meta-llama/llama-3.3-70b-instruct:free";
const ANTHROPIC_DEFAULT = "claude-haiku-4-5-20251001";
const OPENAI_DEFAULT = "gpt-4o-mini";

const LLM_TIMEOUT_MS = intEnv("CC_LLM_TIMEOUT_MS", 30_000, 1_000, 300_000);
const MAX_CONCURRENT_LLM = intEnv("CC_MAX_CONCURRENT_LLM", 2, 1, 32);

/** Soft rate-limit / quota — recoverable; do not blacklist the model. */
function isSoftRateLimit(msg: string): boolean {
  return /\b429\b|rate.?limit|too many requests|quota/i.test(msg);
}

/**
 * Gemini model-missing only — 404 / retired id. NOT 429/quota (those recover
 * quickly and must not blacklist a model for the dead-model TTL).
 */
function isGeminiModelMissing(msg: string): boolean {
  if (isSoftRateLimit(msg)) return false;
  return /\b404\b|not found|not supported|invalid model/i.test(msg);
}

/** Soft failover that is expected on free tiers (429/quota OR dead model ids). */
function isSoftFailover(msg: string): boolean {
  return isSoftRateLimit(msg) || isGeminiModelMissing(msg);
}

/** Default pause before the next chain entry after a Gemini soft 429/quota. */
const FAILOVER_COOLDOWN_MAX_MS = 10_000;

function failoverCooldownMs(): number {
  return intEnv("CC_LLM_FAILOVER_COOLDOWN_MS", 1500, 0, FAILOVER_COOLDOWN_MAX_MS);
}

/** Parse Retry-After (delta-seconds or HTTP-date) → ms, or undefined if absent/invalid. */
function parseRetryAfterMs(header: string | null): number | undefined {
  if (!header?.trim()) return undefined;
  const raw = header.trim();
  if (/^\d+$/.test(raw)) return Number(raw) * 1000;
  const when = Date.parse(raw);
  if (!Number.isNaN(when)) return Math.max(0, when - Date.now());
  return undefined;
}

/** Sleep that rejects promptly when `signal` aborts (so failover does not outlive the client). */
function sleepAbortable(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  if (signal.aborted) return Promise.reject(new Error("LLM request aborted"));
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error("LLM request aborted"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

type ProviderHttpError = Error & { retryAfterMs?: number };

/** Process-local: Gemini model id → expiry ms. Bounded; oldest dropped first. */
const geminiDeadModels = new Map<string, number>();
const GEMINI_DEAD_MODEL_MAX = 32;

function geminiDeadModelTtlMs(): number {
  return intEnv("CC_GEMINI_DEAD_MODEL_TTL_MS", 15 * 60 * 1000, 1_000, 24 * 60 * 60 * 1000);
}

function markGeminiDeadModel(model: string): void {
  if (geminiDeadModels.has(model)) geminiDeadModels.delete(model);
  geminiDeadModels.set(model, Date.now() + geminiDeadModelTtlMs());
  while (geminiDeadModels.size > GEMINI_DEAD_MODEL_MAX) {
    const oldest = geminiDeadModels.keys().next().value;
    if (oldest === undefined) break;
    geminiDeadModels.delete(oldest);
  }
}

function isGeminiDeadModelCached(model: string): boolean {
  const exp = geminiDeadModels.get(model);
  if (exp === undefined) return false;
  if (Date.now() >= exp) {
    geminiDeadModels.delete(model);
    return false;
  }
  return true;
}

/** Test helper — drop the process-local dead-model cache. */
export function clearGeminiDeadModels(): void {
  geminiDeadModels.clear();
}

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

function isGeminiCompat(p: OpenAICompatProvider): boolean {
  return p.name === "gemini" || /generativelanguage\.googleapis\.com/i.test(p.baseUrl);
}

/**
 * Gemini 2.5/3.x spend hidden "thinking" tokens from the same max_tokens budget.
 * With a small ceiling (e.g. 500) the visible answer truncates mid-sentence.
 * Dial thinking down for demo Q&A; 2.5 Flash can disable it entirely.
 */
function geminiReasoningEffort(model: string): "none" | "minimal" | "low" {
  if (/gemini-2\.5/i.test(model) && !/pro/i.test(model)) return "none";
  return "minimal";
}

/** Comma-separated model list → unique non-empty ids. */
function parseModelList(raw: string | undefined, fallback: readonly string[]): string[] {
  if (!raw?.trim()) return [...fallback];
  const list = [
    ...new Set(
      raw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    ),
  ];
  return list.length ? list : [...fallback];
}

/**
 * Gemini models for this process. Precedence:
 *   CC_GEMINI_MODELS (comma list) > CC_GEMINI_MODEL (single pin) > built-in defaults.
 */
export function geminiModels(): string[] {
  if (process.env.CC_GEMINI_MODELS?.trim()) {
    return parseModelList(process.env.CC_GEMINI_MODELS, GEMINI_MODELS_DEFAULT);
  }
  if (process.env.CC_GEMINI_MODEL?.trim()) {
    return [process.env.CC_GEMINI_MODEL.trim()];
  }
  return [...GEMINI_MODELS_DEFAULT];
}

/** Thrown when every configured provider fails (or none are configured). */
export class LlmUnavailableError extends Error {
  /** Safe for HTTP/SSE clients — no provider bodies or keys. */
  readonly publicMessage = "The AI provider is unavailable right now. Try again in a minute.";
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

/** Bound concurrent agent/parity work so one host can't melt the API bill. */
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
    const baseUrl = (
      process.env.CC_GEMINI_BASE_URL ?? "https://generativelanguage.googleapis.com/v1beta/openai"
    ).replace(/\/+$/, "");
    for (const model of geminiModels()) {
      chain.push({
        name: "gemini",
        kind: "openai-compat",
        baseUrl,
        apiKey: geminiKey,
        model,
      });
    }
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

/** Model id from the last successful complete() call (process-local). */
let lastSuccessfulModel: string | null = null;

/**
 * Model label for UI badges. Prefer the model that actually answered the most
 * recent complete() when it still appears in the current provider chain;
 * otherwise the primary chain entry (or CC_ANSWER_MODEL).
 */
export function answerModel(): string {
  if (process.env.CC_ANSWER_MODEL?.trim()) return process.env.CC_ANSWER_MODEL.trim();
  const chain = providerChain();
  if (lastSuccessfulModel && chain.some((p) => p.model === lastSuccessfulModel)) {
    return lastSuccessfulModel;
  }
  return chain[0]?.model ?? OPENAI_DEFAULT;
}

let anthropicClient: Anthropic | null = null;

function mergeSignals(signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(LLM_TIMEOUT_MS);
  if (!signal) return timeout;
  return AbortSignal.any([signal, timeout]);
}

function providerLabel(p: Provider): string {
  return `${p.name}/${p.model}`;
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

  const body: Record<string, unknown> = {
    model: p.model,
    max_tokens: maxTokens,
    messages: [{ role: "user", content: prompt }],
  };
  // Keep thinking from eating the visible answer (parity, agent).
  if (isGeminiCompat(p)) {
    body.reasoning_effort = geminiReasoningEffort(p.model);
  }

  const res = await fetch(`${p.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${p.apiKey}`,
      ...p.headers,
    },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    const err: ProviderHttpError = new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
    const retryAfterMs = parseRetryAfterMs(res.headers.get("retry-after"));
    if (retryAfterMs !== undefined) err.retryAfterMs = retryAfterMs;
    throw err;
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
  };
  const choice = data.choices?.[0];
  const text = choice?.message?.content ?? "";
  if (choice?.finish_reason === "length" || choice?.finish_reason === "max_tokens") {
    log.warn("LLM response hit max_tokens (may be truncated)", {
      provider: p.name,
      model: p.model,
      maxTokens,
      chars: text.length,
    });
  }
  return text;
}

/**
 * Run a prompt through the provider/model chain, failing over on any error.
 * Returns the first successful completion; throws only if every configured
 * entry fails (so a retired Gemini model id never takes the feature down while
 * another Gemini model — or another provider — still works).
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
    // Skip Gemini models that recently 404'd — avoid burning latency/quota on a
    // known-dead id until the short TTL expires.
    if (p.kind === "openai-compat" && isGeminiCompat(p) && isGeminiDeadModelCached(p.model)) {
      log.info("Skipping cached-dead Gemini model", { model: p.model });
      errors.push(`${providerLabel(p)}: skipped (cached dead model)`);
      continue;
    }
    try {
      const text = await callProvider(p, prompt, maxTokens, signal);
      lastSuccessfulModel = p.model;
      return text;
    } catch (e) {
      if (signal.aborted) throw new Error("LLM request aborted");
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`${providerLabel(p)}: ${msg}`);
      if (p.kind === "openai-compat" && isGeminiCompat(p) && isGeminiModelMissing(msg)) {
        markGeminiDeadModel(p.model);
      }
      if (p !== chain[chain.length - 1]) {
        inc("llm_failover");
        // Free-tier 429 / retired model ids are expected failover, not an ops alert.
        const level = isSoftFailover(msg) ? "info" : "warn";
        log[level]("LLM endpoint failed, trying next", {
          provider: p.name,
          model: p.model,
          err: msg,
        });
        // Gemini soft 429/quota: brief cool-down before the next chain entry
        // (free-tier walls often clear in a second or two). Skip for 404 /
        // dead-model (fail over immediately) and never sleep after the last entry.
        if (p.kind === "openai-compat" && isGeminiCompat(p) && isSoftRateLimit(msg)) {
          const fromHeader =
            e instanceof Error && typeof (e as ProviderHttpError).retryAfterMs === "number"
              ? (e as ProviderHttpError).retryAfterMs
              : undefined;
          const waitMs = Math.min(
            fromHeader !== undefined ? fromHeader : failoverCooldownMs(),
            FAILOVER_COOLDOWN_MAX_MS
          );
          if (waitMs > 0) {
            log.info("LLM failover cool-down before next model", {
              provider: p.name,
              model: p.model,
              ms: waitMs,
              fromRetryAfter: fromHeader !== undefined,
            });
            await sleepAbortable(waitMs, signal);
          }
        }
      }
    }
  }
  inc("llm_all_failed");
  throw new LlmUnavailableError(`All LLM providers failed — ${errors.join("; ")}`);
}
