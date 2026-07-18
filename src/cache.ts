/**
 * Disk cache for converted markdown, keyed by sha256(file bytes). Since the
 * key IS the file's content, a cached entry never goes stale — editing the
 * source file produces a different key, not a wrong cache hit.
 *
 * What it doesn't do on its own: shrink. Every distinct file ever converted
 * leaves a permanent entry, which is fine for a short CLI run but would slowly
 * fill the disk on a long-lived server. sweepOldEntries() below handles that.
 */
import { createHash } from "node:crypto";
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { intEnv } from "./env.js";

const CACHE_DIR = process.env.CC_CACHE_DIR ?? join(homedir(), ".cache", "context-compiler");

// How long a cached conversion is kept, and how often we bother checking.
// Defaults: keep for 30 days, check at most once an hour.
const MAX_AGE_MS = intEnv("CC_CACHE_MAX_AGE_MS", 30 * 24 * 60 * 60_000, 60_000);
const SWEEP_INTERVAL_MS = intEnv("CC_CACHE_SWEEP_INTERVAL_MS", 60 * 60_000, 60_000);
let lastSweep = 0;

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
  // The temp filename includes the process id and a random suffix, not just
  // the key, so two requests converting the SAME new file at the same time
  // can't write to the same temp path and corrupt each other's output.
  const tmp = join(
    CACHE_DIR,
    `${key}.${process.pid}.${createHash("sha256").update(String(Math.random())).digest("hex").slice(0, 8)}.md.tmp`
  );
  writeFileSync(tmp, markdown, "utf-8");
  renameSync(tmp, join(CACHE_DIR, `${key}.md`));
  maybeSweep();
}

// Runs at most once per SWEEP_INTERVAL_MS, triggered by cachePut rather than a
// timer — so short-lived CLI runs skip it and long-lived servers self-clean.
function maybeSweep(): void {
  const now = Date.now();
  if (now - lastSweep < SWEEP_INTERVAL_MS) return;
  lastSweep = now;
  try {
    for (const name of readdirSync(CACHE_DIR)) {
      if (!name.endsWith(".md")) continue; // skip stray .tmp files, etc.
      const path = join(CACHE_DIR, name);
      const st = statSync(path, { throwIfNoEntry: false });
      if (st && now - st.mtimeMs > MAX_AGE_MS) {
        try {
          unlinkSync(path);
        } catch {
          /* already gone */
        }
      }
    }
  } catch {
    // Cache dir doesn't exist yet, or isn't readable — nothing to sweep.
  }
}
