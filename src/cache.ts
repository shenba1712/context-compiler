/**
 * Disk cache for converted markdown, keyed by sha256(file bytes). Since the
 * key IS the file's content, a cached entry never goes stale — editing the
 * source file produces a different key, not a wrong cache hit.
 *
 * What it doesn't do on its own: shrink. Every distinct file ever converted
 * leaves a permanent entry, which is fine for a short CLI run but would slowly
 * fill the disk on a long-lived server. maybeSweep() below handles that.
 *
 * Integrity: each put also writes `${key}.sha` = sha256(markdown). Gets without
 * a matching sidecar (legacy or corrupted) miss and delete the bad entry — the
 * source-file hash alone cannot detect payload corruption.
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

/** Live read so tests / late CC_CACHE_DIR still work (not frozen at import). */
function cacheDir(): string {
  return process.env.CC_CACHE_DIR ?? join(homedir(), ".cache", "context-compiler");
}

// How long a cached conversion is kept, and how often we bother checking.
// Defaults: keep for 30 days, check at most once an hour.
const MAX_AGE_MS = intEnv("CC_CACHE_MAX_AGE_MS", 30 * 24 * 60 * 60_000, 60_000);
const SWEEP_INTERVAL_MS = intEnv("CC_CACHE_SWEEP_INTERVAL_MS", 60 * 60_000, 60_000);
let lastSweep = 0;

export function fileKey(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function contentShaPath(key: string): string {
  return join(cacheDir(), `${key}.sha`);
}

function markdownSha(markdown: string): string {
  return createHash("sha256").update(markdown).digest("hex");
}

export function cacheGet(key: string): string | null {
  const dir = cacheDir();
  try {
    const md = readFileSync(join(dir, `${key}.md`), "utf-8");
    // Integrity sidecar: key is sha256(source bytes), not of the cached markdown.
    // Without this check, a corrupted/truncated .md is trusted forever and can
    // ship garbage (or lose the answer) until the source file changes.
    let expected: string;
    try {
      expected = readFileSync(contentShaPath(key), "utf-8").trim();
    } catch {
      // Pre-integrity cache entries: treat as miss so the next convert rewrites
      // both .md and .sha. Do not serve unverified payloads.
      return null;
    }
    if (!expected || markdownSha(md) !== expected) {
      try {
        unlinkSync(join(dir, `${key}.md`));
      } catch {
        /* ignore */
      }
      try {
        unlinkSync(contentShaPath(key));
      } catch {
        /* ignore */
      }
      return null;
    }
    return md;
  } catch {
    return null;
  }
}

export function cachePut(key: string, markdown: string): void {
  const dir = cacheDir();
  mkdirSync(dir, { recursive: true });
  // The temp filename includes the process id and a random suffix, not just
  // the key, so two requests converting the SAME new file at the same time
  // can't write to the same temp path and corrupt each other's output.
  const tmp = join(
    dir,
    `${key}.${process.pid}.${createHash("sha256").update(String(Math.random())).digest("hex").slice(0, 8)}.md.tmp`
  );
  writeFileSync(tmp, markdown, "utf-8");
  renameSync(tmp, join(dir, `${key}.md`));
  writeFileSync(contentShaPath(key), markdownSha(markdown), "utf-8");
  maybeSweep();
}

// Runs at most once per SWEEP_INTERVAL_MS, triggered by cachePut rather than a
// timer — so short-lived CLI runs skip it and long-lived servers self-clean.
function maybeSweep(): void {
  const now = Date.now();
  if (now - lastSweep < SWEEP_INTERVAL_MS) return;
  lastSweep = now;
  const dir = cacheDir();
  try {
    for (const name of readdirSync(dir)) {
      // Age out .md and matching .sha; skip stray .tmp files.
      if (!name.endsWith(".md") && !name.endsWith(".sha")) continue;
      const path = join(dir, name);
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
