/**
 * Thin LLM interface — the entire provider surface lives in this file.
 *
 * Two backends, auto-detected from the environment:
 *  - ANTHROPIC_API_KEY            → Anthropic SDK (Claude)
 *  - OPENAI_API_KEY or CC_LLM_API_KEY (+ optional CC_LLM_BASE_URL)
 *                                 → any OpenAI-compatible endpoint via fetch:
 *                                   OpenAI, Gemini (OpenAI-compat endpoint),
 *                                   Groq, Ollama, OpenRouter, ...
 *
 * No key at all → callers degrade gracefully (BM25-only rank, no answer
 * panel). Model defaults per provider; CC_RERANK_MODEL / CC_ANSWER_MODEL
 * override either.
 */
import Anthropic from "@anthropic-ai/sdk";

const ANTHROPIC_DEFAULT = "claude-haiku-4-5-20251001";
const OPENAI_DEFAULT = "gpt-4o-mini";

type Provider =
  | { kind: "anthropic" }
  | { kind: "openai-compat"; baseUrl: string; apiKey: string };

function detect(): Provider | null {
  if (process.env.ANTHROPIC_API_KEY) return { kind: "anthropic" };
  const apiKey = process.env.CC_LLM_API_KEY ?? process.env.OPENAI_API_KEY;
  if (apiKey) {
    const baseUrl = (process.env.CC_LLM_BASE_URL ?? "https://api.openai.com/v1").replace(/\/+$/, "");
    return { kind: "openai-compat", baseUrl, apiKey };
  }
  return null;
}

export function hasLlm(): boolean {
  return detect() !== null;
}

function defaultModel(): string {
  return detect()?.kind === "anthropic" ? ANTHROPIC_DEFAULT : OPENAI_DEFAULT;
}

export function rerankModel(): string {
  return process.env.CC_RERANK_MODEL ?? defaultModel();
}

export function answerModel(): string {
  return process.env.CC_ANSWER_MODEL ?? defaultModel();
}

let anthropicClient: Anthropic | null = null;

export async function complete(
  prompt: string,
  opts: { model?: string; maxTokens?: number } = {}
): Promise<string> {
  const p = detect();
  if (!p) throw new Error("No LLM API key configured");
  const model = opts.model ?? answerModel();
  const maxTokens = opts.maxTokens ?? 1024;

  if (p.kind === "anthropic") {
    if (!anthropicClient) anthropicClient = new Anthropic();
    const msg = await anthropicClient.messages.create({
      model,
      max_tokens: maxTokens,
      messages: [{ role: "user", content: prompt }],
    });
    const block = msg.content[0];
    return block.type === "text" ? block.text : "";
  }

  // OpenAI-compatible chat completions — plain fetch, no SDK dependency.
  const res = await fetch(`${p.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${p.apiKey}`,
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) {
    throw new Error(`LLM request failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  }
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return data.choices?.[0]?.message?.content ?? "";
}
