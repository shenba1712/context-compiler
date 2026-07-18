/**
 * Tiny leveled logger — writes to STDERR only, never stdout.
 *
 * The MCP server speaks JSON-RPC over stdout, so any stray stdout write would
 * corrupt the protocol. Everything here goes to stderr, which the host platform
 * (Render, Docker) captures as logs just the same.
 *
 * Levels are gated by CC_LOG_LEVEL (error < warn < info < debug; default info,
 * "silent" to mute). Tests run silent automatically. CC_LOG_JSON=1 emits one
 * JSON object per line for log ingestion instead of the human-readable form.
 *
 * Error-level events also POST to CC_LOG_WEBHOOK if set — the one-env-var path
 * to a hosted monitor (Better Stack, a custom collector, ...) with no SDK
 * dependency. Delivery is best-effort: it never blocks or throws, because
 * monitoring must not be able to break the request it's reporting on.
 */
type Level = "error" | "warn" | "info" | "debug";
const ORDER: Record<Level, number> = { error: 0, warn: 1, info: 2, debug: 3 };

// Read live (not cached at import) so tests and deploys can change it freely.
function threshold(): number {
  const raw = (process.env.CC_LOG_LEVEL ?? (process.env.NODE_ENV === "test" ? "silent" : "info")).toLowerCase();
  if (raw === "silent" || raw === "off" || raw === "none") return -1;
  return ORDER[raw as Level] ?? ORDER.info;
}

// A value for the human-readable form: quote it only if it contains spaces.
function fmtValue(v: unknown): string {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s !== undefined && /\s/.test(s) ? JSON.stringify(s) : String(s);
}

/** Strip absolute filesystem paths before anything leaves the box via webhook. */
function redactPaths(s: string): string {
  return s
    .replace(/\/(?:Users|home|var|tmp|app|usr|opt|root)\/[^\s"'`]+/gi, "[path]")
    .replace(/[A-Za-z]:\\(?:[^\\\s"'`]+\\)+[^\\\s"'`]*/g, "[path]");
}

function sanitizeForWebhook(fields?: Record<string, unknown>): Record<string, unknown> {
  if (!fields) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (typeof v === "string") out[k] = redactPaths(v).slice(0, 500);
    else out[k] = v;
  }
  return out;
}

async function ship(webhook: string, record: object): Promise<void> {
  try {
    await fetch(webhook, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(record),
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    // Best-effort: a monitoring outage must never surface in the app.
  }
}

function emit(level: Level, msg: string, fields?: Record<string, unknown>): void {
  if (ORDER[level] > threshold()) return;
  const record = { t: new Date().toISOString(), level, msg, ...fields };

  if (process.env.CC_LOG_JSON === "1") {
    process.stderr.write(JSON.stringify(record) + "\n");
  } else {
    const extra =
      fields && Object.keys(fields).length
        ? " " +
          Object.entries(fields)
            .map(([k, v]) => `${k}=${fmtValue(v)}`)
            .join(" ")
        : "";
    process.stderr.write(`${record.t} ${level.toUpperCase()} ${msg}${extra}\n`);
  }

  const webhook = process.env.CC_LOG_WEBHOOK;
  if (level === "error" && webhook) {
    void ship(webhook, { t: record.t, level, msg: redactPaths(msg), ...sanitizeForWebhook(fields) });
  }
}

export const log = {
  error: (msg: string, fields?: Record<string, unknown>) => emit("error", msg, fields),
  warn: (msg: string, fields?: Record<string, unknown>) => emit("warn", msg, fields),
  info: (msg: string, fields?: Record<string, unknown>) => emit("info", msg, fields),
  debug: (msg: string, fields?: Record<string, unknown>) => emit("debug", msg, fields),
};
