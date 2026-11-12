const int = (v, d) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : d;
};

// Private/loopback peers only: the Nginx container that fronts this service.
export const DEFAULT_TRUST_PROXY = "loopback,linklocal,uniquelocal";

// TRUST_PROXY accepts: true/false, a hop count, or a comma-separated list of
// IPs, CIDRs, or proxy-addr range names. Fastify treats a hop count as "trust
// nothing" (every request then shares the proxy's IP), so prefer a list.
export function parseTrustProxy(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return DEFAULT_TRUST_PROXY;
  const lower = raw.toLowerCase();
  if (lower === "true") return true;
  if (lower === "false") return false;
  if (/^\d+$/.test(raw)) return Number(raw);
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .join(",") || DEFAULT_TRUST_PROXY;
}

export function loadConfig(env = process.env) {
  return {
    databaseUrl: env.DATABASE_URL,
    jwtSecret: env.JWT_SECRET || "",
    issuer: env.AUTH_ISSUER || "budget-app-auth",
    accessTtl: int(env.ACCESS_TOKEN_TTL, 900),
    refreshTtl: int(env.REFRESH_TOKEN_TTL, 60 * 60 * 24 * 30),
    allowSignup: String(env.ALLOW_SIGNUP ?? "true").toLowerCase() !== "false",
    passwordMinLength: int(env.PASSWORD_MIN_LENGTH, 8),
    bcryptCost: int(env.BCRYPT_COST, 12),
    port: int(env.PORT, 3001),
    host: env.HOST || "0.0.0.0",
    trustProxy: parseTrustProxy(env.TRUST_PROXY),
    rateLimitMax: int(env.RATE_LIMIT_MAX, 100),
    authRateLimitMax: int(env.AUTH_RATE_LIMIT_MAX, 10),
    rateLimitWindowMs: int(env.RATE_LIMIT_WINDOW_MS, 60_000),
    loginFailMax: int(env.LOGIN_FAIL_MAX, 5),
    loginFailWindowMs: int(env.LOGIN_FAIL_WINDOW_MS, 15 * 60_000),
    logLevel: env.LOG_LEVEL || "info",
  };
}
