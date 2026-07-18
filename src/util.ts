/**
 * The biggest number in a list, or 0 for an empty list. Same result as
 * `Math.max(0, ...nums)`, but safe for very large lists — spreading a huge
 * array as function arguments can crash with "Maximum call stack size
 * exceeded", and a document that chunks into tens of thousands of sections
 * is exactly the kind of input that could hit that.
 */
export function maxOf(nums: number[]): number {
  let best = 0;
  for (const n of nums) if (n > best) best = n;
  return best;
}

/**
 * Safe display name for compiled-context headers. Strips path components and
 * characters that would confuse agents or look like markup/injection in the
 * `<!-- Compiled context from: … -->` comment.
 */
export function sanitizeSourceName(name: string): string {
  const base = name.replace(/^.*[/\\]/, "").slice(0, 120);
  const cleaned = base.replace(/[^\w.\- ()[\]]+/g, "_").replace(/_+/g, "_");
  return cleaned.replace(/^[_.]+|[_.]+$/g, "") || "document";
}
