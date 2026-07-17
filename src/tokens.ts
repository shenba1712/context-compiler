/**
 * Token counting via js-tiktoken (cl100k_base), pure JS, no network.
 * Budgets are advisory; if the encoder ever fails we approximate at 4 chars/token.
 */
import { Tiktoken } from "js-tiktoken/lite";
import cl100k_base from "js-tiktoken/ranks/cl100k_base";

let encoder: Tiktoken | null = null;
try {
  encoder = new Tiktoken(cl100k_base);
} catch {
  encoder = null;
}

export function countTokens(text: string): number {
  if (encoder) {
    try {
      return encoder.encode(text).length;
    } catch {
      /* fall through */
    }
  }
  return Math.max(1, Math.floor(text.length / 4));
}
