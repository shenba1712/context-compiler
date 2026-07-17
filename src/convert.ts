/**
 * File -> markdown via the `markitdown` CLI, treated as an external converter
 * binary (the way apps treat ffmpeg). Zero custom Python code.
 *
 * Security posture:
 * - Hard file-size limit before we touch the parser.
 * - Subprocess with timeout; a pathological file can't hang the server.
 * - execFile (not exec): no shell, no injection via file names.
 */
import { execFile } from "node:child_process";
import { statSync } from "node:fs";

const MAX_FILE_BYTES = Number(process.env.CC_MAX_FILE_BYTES ?? 50 * 1024 * 1024);
const CONVERT_TIMEOUT_MS = Number(process.env.CC_CONVERT_TIMEOUT_S ?? 120) * 1000;
const MARKITDOWN = process.env.CC_MARKITDOWN_CMD ?? "markitdown";

export class ConversionError extends Error {}

export function convertToMarkdown(path: string): Promise<string> {
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
  return new Promise((resolve, reject) => {
    execFile(
      MARKITDOWN,
      [path],
      { timeout: CONVERT_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          const reason = err.killed
            ? `timed out after ${CONVERT_TIMEOUT_MS / 1000}s`
            : (stderr || err.message).slice(0, 500);
          reject(new ConversionError(`Conversion failed: ${reason}`));
        } else if (!stdout.trim()) {
          reject(new ConversionError("Conversion produced empty output"));
        } else {
          resolve(stdout);
        }
      }
    );
  });
}
