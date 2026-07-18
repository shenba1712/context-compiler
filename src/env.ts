/**
 * Environment-variable parsing that fails safe and loud.
 *
 * `Number(process.env.X ?? default)` has a footgun: a non-numeric value (a
 * deploy typo like CC_RATE_LIMIT=off) yields NaN, and every comparison against
 * NaN is false — so a typo could silently switch off something like the rate
 * limiter. These helpers reject NaN, warn once, and fall back to the default
 * (clamped to a sane range) instead of letting NaN leak through the app.
 */
import { log } from "./log.js";

function parse(name: string, def: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return def;
  const v = Number(raw);
  if (!Number.isFinite(v)) {
    log.warn(`Config: ${name} is not a number; using default`, { value: raw, default: def });
    return def;
  }
  return v;
}

/** Integer env var, clamped to [min, max]. NaN/blank → default. */
export function intEnv(name: string, def: number, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  return Math.min(max, Math.max(min, Math.trunc(parse(name, def))));
}

/** Float env var, clamped to [min, max]. NaN/blank → default. */
export function numEnv(name: string, def: number, min = 0, max = Number.MAX_VALUE): number {
  return Math.min(max, Math.max(min, parse(name, def)));
}

/**
 * Express "trust proxy" setting. SECURITY-CRITICAL: when this trusts a
 * client-supplied X-Forwarded-For header, per-IP controls (rate limiting) can
 * be bypassed by spoofing that header. Default is `false` (use the real socket
 * IP, which a client cannot forge) so the app is safe when reachable directly.
 * Operators behind exactly one proxy set CC_TRUST_PROXY=1; behind a known
 * proxy range, a CIDR/keyword string; never a blanket "true" on a public app.
 */
export function trustProxyFromEnv(): boolean | number | string {
  const raw = process.env.CC_TRUST_PROXY;
  if (raw === undefined || raw === "" || raw === "false") return false;
  // Blanket `true` trusts any client-supplied X-Forwarded-For and lets anyone
  // bypass per-IP rate limits. Require an explicit insecure override; prefer
  // hop count `1` (or a CIDR) behind a real reverse proxy.
  if (raw === "true") {
    if (process.env.CC_ALLOW_INSECURE_TRUST_PROXY === "1") {
      log.warn("CC_TRUST_PROXY=true enabled via CC_ALLOW_INSECURE_TRUST_PROXY — rate limits are spoofable");
      return true;
    }
    log.warn(
      "CC_TRUST_PROXY=true ignored (spoofable); set CC_TRUST_PROXY=1 for one hop, or CC_ALLOW_INSECURE_TRUST_PROXY=1 to force"
    );
    return false;
  }
  const n = Number(raw);
  return Number.isFinite(n) ? Math.trunc(n) : raw; // number of hops, or a keyword/CIDR
}
