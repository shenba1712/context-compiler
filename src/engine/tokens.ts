/**
 * Token counting via js-tiktoken (cl100k_base), pure JS, no network.
 * Budgets are advisory; if the encoder ever fails we approximate at 4 chars/token.
 */
import { Tiktoken } from "js-tiktoken/lite";
import cl100k_base from "js-tiktoken/ranks/cl100k_base";

import { log } from "./log.js";

let encoder: Tiktoken | null = null;
try {
  encoder = new Tiktoken(cl100k_base);
} catch (err) {
  log.warn("Tiktoken encoder failed to load; using the 4-chars/token estimate", { err: String(err) });
  encoder = null;
}

// countTokens() runs per-chunk, potentially thousands of times per document —
// warn on the first per-call encode() failure only, so a pathological input
// gets a diagnostic trail without flooding the log on every subsequent chunk.
let warnedOnEncodeFailure = false;

export function countTokens(text: string): number {
  if (encoder) {
    try {
      return encoder.encode(text).length;
    } catch (err) {
      if (!warnedOnEncodeFailure) {
        warnedOnEncodeFailure = true;
        log.warn("Tiktoken encode() failed on some input; using the 4-chars/token estimate", {
          err: String(err),
        });
      }
    }
  }
  return Math.max(1, Math.floor(text.length / 4));
}

/**
 * Token count for demo metering / parity compares: strip HTML comments
 * (assemble wrappers, section breadcrumbs, untrusted markers) so we measure
 * document substance, not packaging. The model still receives the full text.
 */
export function countContentTokens(text: string): number {
  const stripped = text
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return countTokens(stripped.length ? stripped : text);
}
