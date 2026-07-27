import { realpathSync } from "node:fs";
import { basename, dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { fullMarkdown } from "../engine/pipeline.js";
import { SAMPLES_MANIFEST } from "../engine/samples-manifest.js";
import { countTokens } from "../engine/tokens.js";
import { log } from "../engine/log.js";

// dist/http/samples-catalog.js → repo root public/
const STATIC_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "public");

export type SampleRow = {
  key: string;
  file: string;
  fmt: string;
  nm: string;
  mt: string;
  q: string[];
  tok: number | null;
};

const sampleTokByKey = new Map<string, number | null>();
let sampleWarmPromise: Promise<void> | null = null;

/** Resolve a sample library file under public/samples. */
export function resolveSampleFile(file: string): string {
  const base = basename(file);
  if (!base || base !== file || base.includes("\0") || !/^[\w.-]+$/.test(base)) {
    throw new Error("Invalid sample file name");
  }
  const samplesRoot = realpathSync(join(STATIC_DIR, "samples"));
  const full = realpathSync(join(samplesRoot, base));
  if (full !== samplesRoot && !full.startsWith(samplesRoot + sep)) {
    throw new Error("Sample path escaped samples directory");
  }
  return full;
}

export function samplesPayload(): SampleRow[] {
  return SAMPLES_MANIFEST.map((s) => ({
    ...s,
    tok: sampleTokByKey.has(s.key) ? (sampleTokByKey.get(s.key) ?? null) : null,
  }));
}

/** Fire-and-forget convert+count. Sequential; safe to call many times. */
export function warmSampleTokenCache(): Promise<void> {
  if (sampleWarmPromise) return sampleWarmPromise;
  sampleWarmPromise = (async () => {
    let hadFailure = false;
    for (const s of SAMPLES_MANIFEST) {
      if (typeof sampleTokByKey.get(s.key) === "number") continue;
      try {
        const markdown = await fullMarkdown(resolveSampleFile(s.file));
        sampleTokByKey.set(s.key, countTokens(markdown));
      } catch (e) {
        hadFailure = true;
        log.warn("could not measure sample", {
          file: s.file,
          err: e instanceof Error ? e.message : String(e),
        });
        sampleTokByKey.set(s.key, null);
      }
    }
    // Nulls are transient failures (converter startup, queue pressure, etc.).
    // Permit a later catalog request to retry only those entries.
    if (hadFailure) sampleWarmPromise = null;
  })();
  return sampleWarmPromise;
}

export function getSamplesCatalog(): SampleRow[] {
  void warmSampleTokenCache();
  return samplesPayload();
}

export { STATIC_DIR };
