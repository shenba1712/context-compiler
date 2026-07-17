/**
 * Upload validation, layered ahead of the converter.
 *
 * Two problems this closes:
 *  1. Extension-only trust. markitdown sniffs content (magika) and ignores the
 *     filename, so an allowlist keyed on extension and the converter disagree
 *     about what a file IS. We validate by CONTENT (magic bytes) and require it
 *     to match the claimed extension.
 *  2. Decompression bombs. Office files (docx/xlsx/pptx) are ZIP containers; a
 *     tiny upload can inflate to gigabytes inside the parser. We read the ZIP
 *     central directory and reject when the declared uncompressed total (or its
 *     ratio to the on-disk size) is implausibly large — before spawning Python.
 *
 * This is defense-in-depth: convert.ts also runs the parser under a hard
 * virtual-memory cap, so anything that evades this precheck (e.g. ZIP64-hidden
 * sizes) still can't OOM the host.
 */
import { intEnv } from "./env.js";

export class UploadRejected extends Error {
  status: number;
  constructor(message: string, status = 415) {
    super(message);
    this.status = status;
  }
}

export const ALLOWED_EXTENSIONS = [
  ".docx", ".pdf", ".xlsx", ".pptx", ".csv", ".md", ".markdown", ".txt", ".html", ".htm",
];

const ZIP_EXTS = new Set([".docx", ".xlsx", ".pptx"]);
const TEXT_EXTS = new Set([".csv", ".md", ".markdown", ".txt", ".html", ".htm"]);

// Generous vs. real docs (largest sample is ~233 KB uncompressed) but far
// below anything that could exhaust memory. Both overridable for edge cases.
const MAX_UNCOMPRESSED = intEnv("CC_MAX_UNCOMPRESSED_BYTES", 150 * 1024 * 1024, 1);
const MAX_RATIO = intEnv("CC_MAX_DECOMPRESSION_RATIO", 200, 1);

function extname(name: string): string {
  const i = name.lastIndexOf(".");
  return i < 0 ? "" : name.slice(i).toLowerCase();
}

/** Looks like a ZIP local-file header ("PK\x03\x04") or an empty archive. */
function isZip(buf: Buffer): boolean {
  return buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b &&
    (buf[2] === 0x03 || buf[2] === 0x05 || buf[2] === 0x07);
}

function isPdf(buf: Buffer): boolean {
  return buf.length >= 5 && buf.toString("latin1", 0, 5) === "%PDF-";
}

/** A NUL byte in the first 8 KB is a strong signal the "text" file is binary. */
function looksBinary(buf: Buffer): boolean {
  const n = Math.min(buf.length, 8192);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

/**
 * Sum uncompressed sizes from the ZIP central directory. Returns null if the
 * structure can't be parsed (truncated/odd but possibly legitimate) — we don't
 * block on uncertainty; the memory cap is the backstop. Returns Infinity if a
 * ZIP64 sentinel (0xFFFFFFFF) is present, which we treat as "too big to trust".
 */
function zipUncompressedTotal(buf: Buffer): number | null {
  const EOCD_SIG = 0x06054b50;
  const CDFH_SIG = 0x02014b50;
  // Find End Of Central Directory in the last 64 KB + 22-byte record.
  const from = Math.max(0, buf.length - (0xffff + 22));
  let eocd = -1;
  for (let i = buf.length - 22; i >= from; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) { eocd = i; break; }
  }
  if (eocd < 0) return null;

  let off = buf.readUInt32LE(eocd + 16); // start of central directory
  const entries = buf.readUInt16LE(eocd + 10);
  let total = 0;
  for (let e = 0; e < entries; e++) {
    if (off + 46 > buf.length || buf.readUInt32LE(off) !== CDFH_SIG) return null;
    const uncompressed = buf.readUInt32LE(off + 24);
    if (uncompressed === 0xffffffff) return Infinity; // ZIP64: sizes hidden in extra field
    total += uncompressed;
    if (total > Number.MAX_SAFE_INTEGER) return Infinity;
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    off += 46 + nameLen + extraLen + commentLen;
  }
  return total;
}

/**
 * Validate a freshly uploaded file by name AND content. Throws UploadRejected
 * (with an HTTP status) on any mismatch or bomb; returns normally when safe.
 */
export function validateUpload(originalName: string, buf: Buffer): void {
  const ext = extname(originalName);
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    throw new UploadRejected(
      `Unsupported file type "${ext || originalName}". Supported: ${ALLOWED_EXTENSIONS.join(", ")}. ` +
        `Images aren't supported yet (they need an OCR/captioning backend this demo doesn't run).`,
      415
    );
  }
  if (buf.length === 0) throw new UploadRejected("The uploaded file is empty.", 400);

  // Content must match the claimed extension — the converter trusts content,
  // so we must too. This is what stops a bomb/exe renamed to a safe extension.
  if (ZIP_EXTS.has(ext)) {
    if (!isZip(buf)) {
      throw new UploadRejected(`"${originalName}" isn't a valid ${ext} file (bad signature).`, 415);
    }
    const total = zipUncompressedTotal(buf);
    if (total !== null && (total > MAX_UNCOMPRESSED || total / buf.length > MAX_RATIO)) {
      throw new UploadRejected(
        "This file expands to far more data than its size suggests (possible decompression " +
          "bomb) and was rejected.",
        413
      );
    }
  } else if (ext === ".pdf") {
    if (!isPdf(buf)) {
      throw new UploadRejected(`"${originalName}" isn't a valid PDF (missing %PDF- header).`, 415);
    }
  } else if (TEXT_EXTS.has(ext)) {
    // Text formats have no reliable magic. Reject only if it's clearly binary
    // (e.g. a zip/image renamed .txt) — a NUL byte is the tell.
    if (looksBinary(buf)) {
      throw new UploadRejected(`"${originalName}" looks like a binary file, not ${ext} text.`, 415);
    }
  }
}
