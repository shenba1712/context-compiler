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

// Per-provider default models. All are overridable by the matching env var.
// Gemini Flash is a good free-tier default; swap to gemini-2.5-flash-lite via
// CC_GEMINI_MODEL for higher request-per-day limits at slightly lower quality.
const GEMINI_DEFAULT = "gemini-2.5-flash";
// NOTE: OpenRouter's *free* model IDs (the ":free" suffix) come and go without
// notice — if this one stops working, set CC_OPENROUTER_MODEL to any current
// free (or paid) model from https://openrouter.ai/models.
const OPENROUTER_DEFAULT = "meta-llama/llama-3.3-70b-instruct:free";
const ANTHROPIC_DEFAULT = "claude-haiku-4-5-20251001";
const OPENAI_DEFAULT = "gpt-4o-mini";

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

// Build the ordered list of usable providers from the environment. Only keys
// that are actually set produce an entry, so the list is exactly the providers
// we can really call, already in failover order.
function providerChain(): Provider[] {
  const chain: Provider[] = [];

  const geminiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
  if (geminiKey) {
    chain.push({
      name: "gemini",
      kind: "openai-compat",
      // Google's OpenAI-compatibility endpoint — same /chat/completions shape.
      // Overridable for proxies/regional endpoints.
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
      // Optional attribution headers OpenRouter uses for its dashboard; harmless
      // if unset. Only added when the operator provides them.
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

  // Generic OpenAI-compatible: OPENAI_API_KEY on api.openai.com, or any endpoint
  // via CC_LLM_API_KEY + CC_LLM_BASE_URL (Groq, Ollama, a local proxy, ...).
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

/**
 * The model shown in the UI (e.g. the answer-parity panel's "answered by X"
 * label). Reflects the primary configured provider; a mid-request failover to
 * a lower-priority provider is rare enough that this stays accurate in practice.
 */
export function answerModel(): string {
  return process.env.CC_ANSWER_MODEL ?? providerChain()[0]?.model ?? OPENAI_DEFAULT;
}

let anthropicClient: Anthropic | null = null;

async function callProvider(p: Provider, prompt: string, maxTokens: number): Promise<string> {
  if (p.kind === "anthropic") {
    if (!anthropicClient) anthropicClient = new Anthropic({ apiKey: p.apiKey });
    const msg = await anthropicClient.messages.create({
      model: p.model,
      max_tokens: maxTokens,
      messages: [{ role: "user", content: prompt }],
    });
    const block = msg.content[0];
    return block && block.type === "text" ? block.text : "";
  }

  // OpenAI-compatible chat completions — plain fetch, no SDK dependency.
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
export async function complete(prompt: string, opts: { maxTokens?: number } = {}): Promise<string> {
  const chain = providerChain();
  if (!chain.length) throw new Error("No LLM API key configured");
  const maxTokens = opts.maxTokens ?? 1024;

  const errors: string[] = [];
  for (const p of chain) {
    try {
      return await callProvider(p, prompt, maxTokens);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`${p.name}: ${msg}`);
      // Not the last provider? Note the failover so a degraded run is visible,
      // then try the next key rather than surfacing this one error.
      if (p !== chain[chain.length - 1]) {
        console.warn(`LLM provider "${p.name}" failed (${msg}); trying next provider.`);
      }
    }
  }
  throw new Error(`All LLM providers failed — ${errors.join("; ")}`);
}
