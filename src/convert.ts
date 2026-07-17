/**
 * File -> markdown via the `markitdown` CLI, treated as an external converter
 * binary (the way apps treat ffmpeg). Zero custom Python code.
 *
 * Security posture (converter is treated as fully untrusted):
 * - Hard file-size limit before we touch the parser.
 * - execFile (not exec): no shell, no injection via file names.
 * - Subprocess timeout: a pathological file can't hang the server.
 * - Virtual-memory cap (Linux): a decompression bomb (a tiny .docx/.xlsx that
 *   inflates to gigabytes) dies cheaply instead of OOM-killing the host.
 * - Concurrency cap: bounds how many Python subprocesses can run at once, so a
 *   burst of uploads can't fork-bomb the box.
 * - Error messages are sanitized: raw markitdown stderr (which carries server
 *   paths and Python tracebacks) is logged server-side, never returned.
 */
import { execFile } from "node:child_process";
import { statSync } from "node:fs";

import { intEnv } from "./env.js";

const MAX_FILE_BYTES = intEnv("CC_MAX_FILE_BYTES", 50 * 1024 * 1024, 1);
const CONVERT_TIMEOUT_MS = intEnv("CC_CONVERT_TIMEOUT_S", 120, 1) * 1000;
const MARKITDOWN = process.env.CC_MARKITDOWN_CMD ?? "markitdown";
// Virtual-memory ceiling for a single conversion (KB). 1.5 GB comfortably
// runs every sample (incl. the dense Origin-of-Species PDF and magika's ONNX
// model) yet caps the blast radius of a bomb that slips past the size
// precheck. 0 disables the cap (non-Linux dev, where `ulimit -v` is a no-op).
const MEM_CAP_KB = intEnv("CC_CONVERT_MEM_CAP_KB", 1_572_864, 0);
// Bound concurrent Python subprocesses (and the queue waiting for a slot), so
// a flood of uploads can't spawn unbounded converters.
const MAX_CONCURRENT = intEnv("CC_MAX_CONCURRENT_CONVERSIONS", 3, 1, 64);
const MAX_QUEUED = intEnv("CC_MAX_QUEUED_CONVERSIONS", 12, 0, 10_000);

export class ConversionError extends Error {}
/** Thrown when the converter is saturated; callers map this to HTTP 503. */
export class ConverterBusyError extends Error {}

// ---- concurrency gate -------------------------------------------------------
let active = 0;
const waiters: Array<() => void> = [];

function acquire(): Promise<void> {
  if (active < MAX_CONCURRENT) {
    active += 1;
    return Promise.resolve();
  }
  if (waiters.length >= MAX_QUEUED) {
    return Promise.reject(
      new ConverterBusyError("The converter is busy right now — please retry in a few seconds.")
    );
  }
  // A queued waiter inherits the slot directly on release(); `active` already
  // accounts for it, so it must not increment again when it resumes.
  return new Promise<void>((resolve) => waiters.push(resolve));
}

function release(): void {
  const next = waiters.shift();
  if (next) next();
  else active -= 1;
}

// ---- conversion -------------------------------------------------------------
function spawnArgs(path: string): [string, string[]] {
  // On Linux, wrap in bash to apply `ulimit -v` before exec'ing markitdown.
  // The command and path are passed as positional args ($0, $1), never
  // interpolated into the script string, so there is no shell injection.
  if (MEM_CAP_KB > 0 && process.platform === "linux") {
    return [
      "bash",
      ["-c", `ulimit -v ${MEM_CAP_KB} 2>/dev/null; exec "$0" "$1"`, MARKITDOWN, path],
    ];
  }
  return [MARKITDOWN, [path]];
}

export async function convertToMarkdown(path: string): Promise<string> {
  let size: number;
  try {
    size = statSync(path).size;
  } catch {
    throw new ConversionError(`Not a file: ${path}`);
  }
  if (size > MAX_FILE_BYTES) {
    throw new ConversionError(
      `File is ${size} bytes; limit is ${MAX_FILE_BYTES}. Refusing to parse.`
    );
  }

  await acquire();
  try {
    return await new Promise<string>((resolve, reject) => {
      const [cmd, args] = spawnArgs(path);
      execFile(
        cmd,
        args,
        { timeout: CONVERT_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024 },
        (err, stdout, stderr) => {
          if (err) {
            // Log the real reason server-side; return a generic, safe message.
            // Raw stderr contains a Python traceback with absolute server
            // paths and dependency versions — recon fuel we must not leak.
            console.error(`markitdown failed for ${path}:`, (stderr || err.message).slice(0, 2000));
            const reason = err.killed
              ? `conversion timed out after ${CONVERT_TIMEOUT_MS / 1000}s`
              : "the file may be corrupt, password-protected, or an unsupported variant";
            reject(new ConversionError(`Conversion failed: ${reason}.`));
          } else if (!stdout.trim()) {
            reject(new ConversionError(
              "Conversion produced empty output. For plain images, this usually means no " +
                "OCR/captioning backend is configured (needs an LLM key) — text formats and " +
                "documents with embedded text don't need one and aren't affected."
            ));
          } else {
            resolve(stdout);
          }
        }
      );
    });
  } finally {
    release();
  }
}
