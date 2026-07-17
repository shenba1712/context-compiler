/**
 * Environment-variable parsing that fails safe and loud.
 *
 * `Number(process.env.X ?? default)` has a footgun: a non-numeric value (a
 * deploy typo like CC_RATE_LIMIT=off) yields NaN, and comparisons against NaN
 * are always false — which silently DISABLED the rate limiter in an earlier
 * version. These helpers reject NaN, warn once, and fall back to the default
 * (clamped to a sane range) instead of quietly propagating NaN through the app.
 */
function parse(name: string, def: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return def;
  const v = Number(raw);
  if (!Number.isFinite(v)) {
    console.warn(`Config: ${name}="${raw}" is not a number; using default ${def}.`);
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
  if (raw === "true") return true; // explicit opt-in only
  const n = Number(raw);
  return Number.isFinite(n) ? Math.trunc(n) : raw; // number of hops, or a keyword/CIDR
}
