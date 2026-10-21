const int = (v, d) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : d;
};

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
    trustProxy: String(env.TRUST_PROXY ?? "true").toLowerCase() !== "false",
    rateLimitMax: int(env.RATE_LIMIT_MAX, 100),
    authRateLimitMax: int(env.AUTH_RATE_LIMIT_MAX, 10),
    rateLimitWindowMs: int(env.RATE_LIMIT_WINDOW_MS, 60_000),
    loginFailMax: int(env.LOGIN_FAIL_MAX, 5),
    loginFailWindowMs: int(env.LOGIN_FAIL_WINDOW_MS, 15 * 60_000),
    logLevel: env.LOG_LEVEL || "info",
  };
}
