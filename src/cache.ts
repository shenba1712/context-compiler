/**
 * Disk cache for converted markdown. Key = sha256(file bytes): entries are
 * immutable by construction — no TTL, no invalidation. Edit file, new key.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const CACHE_DIR =
  process.env.CC_CACHE_DIR ?? join(homedir(), ".cache", "context-compiler");

export function fileKey(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function cacheGet(key: string): string | null {
  try {
    return readFileSync(join(CACHE_DIR, `${key}.md`), "utf-8");
  } catch {
    return null;
  }
}

export function cachePut(key: string, markdown: string): void {
  mkdirSync(CACHE_DIR, { recursive: true });
  const tmp = join(CACHE_DIR, `${key}.md.tmp`);
  writeFileSync(tmp, markdown, "utf-8");
  renameSync(tmp, join(CACHE_DIR, `${key}.md`));
}
