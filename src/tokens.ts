/**
 * Token counting via js-tiktoken (cl100k_base), pure JS, no network.
 * Budgets are advisory; if the encoder ever fails we approximate at 4 chars/token.
 */
import { Tiktoken } from "js-tiktoken/lite";
import cl100k_base from "js-tiktoken/ranks/cl100k_base";

let encoder: Tiktoken | null = null;
try {
  encoder = new Tiktoken(cl100k_base);
} catch (err) {
  console.warn("Tiktoken encoder failed to load; falling back to the 4-chars/token estimate:", err);
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
        console.warn(
          "Tiktoken encode() failed on some input; falling back to the 4-chars/token estimate:",
          err
        );
      }
    }
  }
  return Math.max(1, Math.floor(text.length / 4));
}
