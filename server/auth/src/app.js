import crypto from "node:crypto";
import Fastify from "fastify";
import rateLimit from "@fastify/rate-limit";
import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";

class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
const newRefreshToken = () => crypto.randomBytes(32).toString("base64url");

export function buildApp(config, { pool }) {
  if (!config.jwtSecret || Buffer.byteLength(config.jwtSecret) < 32) {
    throw new Error("JWT_SECRET must be at least 32 bytes");
  }
  const secret = new TextEncoder().encode(config.jwtSecret);
  const dummyHash = bcrypt.hashSync("dummy-password-for-timing", config.bcryptCost);

  const app = Fastify({
    bodyLimit: 16 * 1024,
    trustProxy: config.trustProxy,
    logger: {
      level: config.logLevel,
      redact: ["req.headers.authorization", "req.headers.cookie", "req.body"],
    },
  });

  const failures = new Map();
  const failState = (email) => {
    const f = failures.get(email);
    if (f && Date.now() - f.first > config.loginFailWindowMs) {
      failures.delete(email);
      return null;
    }
    return f || null;
  };
  const assertNotLocked = (email) => {
    const f = failState(email);
    if (f && f.count >= config.loginFailMax) {
      throw new HttpError(429, "too_many_attempts", "Too many failed attempts. Try again later.");
    }
  };
  const recordFailure = (email) => {
    const f = failState(email);
    if (f) f.count++;
    else failures.set(email, { count: 1, first: Date.now() });
  };
  const sweep = setInterval(() => {
    for (const k of [...failures.keys()]) failState(k);
  }, 60_000);
  sweep.unref();
  app.addHook("onClose", async () => clearInterval(sweep));

  const strictLimit = {
    config: {
      rateLimit: { max: config.authRateLimitMax, timeWindow: config.rateLimitWindowMs },
    },
  };

  app.register(rateLimit, {
    global: true,
    max: config.rateLimitMax,
    timeWindow: config.rateLimitWindowMs,
  });

  app.setErrorHandler((err, req, reply) => {
    let status = err.status || err.statusCode || 500;
    let code = err.code;
    let message = err.message;
    if (!(err instanceof HttpError)) {
      if (status === 429) {
        code = "rate_limited";
        message = "Too many requests";
      } else if (status >= 400 && status < 500) {
        code = status === 413 ? "payload_too_large" : "bad_request";
        message = status === 413 ? "Payload too large" : "Invalid request";
        if (status !== 413) status = 400;
      } else {
        req.log.error({ err: { message: err.message, code: err.code } }, "unhandled error");
        status = 500;
        code = "server_error";
        message = "Internal server error";
      }
    }
    reply.code(status).send({ error: { code, message } });
  });
  app.setNotFoundHandler((req, reply) =>
    reply.code(404).send({ error: { code: "not_found", message: "Not found" } }),
  );

  const toUser = (u) => ({ id: u.id, email: u.email, created_at: new Date(u.created_at).toISOString() });

  async function signAccess(user) {
    const now = Math.floor(Date.now() / 1000);
    const exp = now + config.accessTtl;
    const token = await new SignJWT({ email: user.email, role: "authenticated" })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setSubject(user.id)
      .setAudience("authenticated")
      .setIssuer(config.issuer)
      .setIssuedAt(now)
      .setExpirationTime(exp)
      .sign(secret);
    return { token, exp };
  }

  async function buildSession(user, refreshToken) {
    const { token, exp } = await signAccess(user);
    return {
      access_token: token,
      token_type: "bearer",
      expires_in: config.accessTtl,
      expires_at: exp,
      refresh_token: refreshToken,
      user: toUser(user),
    };
  }

  async function issueRefresh(db, userId, { familyId, parentId, userAgent } = {}) {
    const token = newRefreshToken();
    await db.query(
      `INSERT INTO auth.refresh_tokens (user_id, token_hash, family_id, parent_id, expires_at, user_agent)
       VALUES ($1, $2, COALESCE($3::uuid, gen_random_uuid()), $4, now() + ($5 || ' seconds')::interval, $6)`,
      [userId, sha256(token), familyId || null, parentId || null, String(config.refreshTtl), userAgent || null],
    );
    return token;
  }

  async function withTx(fn) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const r = await fn(client);
      await client.query("COMMIT");
      return r;
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  }

  function normalizeEmail(email) {
    const e = String(email).trim().toLowerCase();
    if (e.length > 254 || !EMAIL_RE.test(e)) throw new HttpError(400, "invalid_email", "Invalid email address");
    return e;
  }
  function parseCreds(body) {
    if (!body || typeof body !== "object") throw new HttpError(400, "bad_request", "Invalid request");
    const { email, password } = body;
    if (typeof email !== "string" || typeof password !== "string") {
      throw new HttpError(400, "bad_request", "Email and password are required");
    }
    return { email: normalizeEmail(email), password };
  }
  function validateNewPassword(password) {
    if (typeof password !== "string") throw new HttpError(400, "bad_request", "Password is required");
    if (password.length < config.passwordMinLength) {
      throw new HttpError(400, "weak_password", `Password must be at least ${config.passwordMinLength} characters`);
    }
    if (Buffer.byteLength(password, "utf8") > 72) {
      throw new HttpError(400, "weak_password", "Password must be at most 72 bytes");
    }
  }

  async function authenticate(req) {
    const h = req.headers.authorization || "";
    const m = /^Bearer\s+(.+)$/i.exec(h);
    if (!m) throw new HttpError(401, "unauthorized", "Missing bearer token");
    try {
      const { payload } = await jwtVerify(m[1], secret, {
        algorithms: ["HS256"],
        audience: "authenticated",
        issuer: config.issuer,
      });
      if (!payload.sub) throw new Error("no sub");
      return payload;
    } catch {
      throw new HttpError(401, "invalid_token", "Invalid or expired token");
    }
  }

  const ua = (req) => String(req.headers["user-agent"] || "").slice(0, 255);

  // routes must register after the rate-limit plugin so per-route limits apply
  app.register(async (app) => {
  app.get("/auth/v1/health", async () => ({ ok: true, signupEnabled: config.allowSignup }));

  app.post("/auth/v1/signup", strictLimit, async (req, reply) => {
    if (!config.allowSignup) throw new HttpError(403, "signup_disabled", "Signups are disabled");
    const { email, password } = parseCreds(req.body);
    validateNewPassword(password);
    const hash = await bcrypt.hash(password, config.bcryptCost);
    let session;
    try {
      session = await withTx(async (db) => {
        const { rows } = await db.query(
          `INSERT INTO auth.users (email, encrypted_password, last_sign_in_at)
           VALUES ($1, $2, now()) RETURNING id, email, created_at`,
          [email, hash],
        );
        const rt = await issueRefresh(db, rows[0].id, { userAgent: ua(req) });
        return buildSession(rows[0], rt);
      });
    } catch (e) {
      if (e.code === "23505") throw new HttpError(409, "user_exists", "Unable to create account with these details");
      throw e;
    }
    return reply.code(201).send(session);
  });

  async function passwordGrant(req, body) {
    const { email, password } = parseCreds(body);
    assertNotLocked(email);
    const { rows } = await pool.query(
      "SELECT id, email, encrypted_password, created_at FROM auth.users WHERE email = $1",
      [email],
    );
    const user = rows[0];
    const ok = await bcrypt.compare(password, user ? user.encrypted_password : dummyHash);
    if (!user || !ok) {
      recordFailure(email);
      throw new HttpError(401, "invalid_credentials", "Invalid email or password");
    }
    failures.delete(email);
    await pool.query("UPDATE auth.users SET last_sign_in_at = now() WHERE id = $1", [user.id]);
    const rt = await issueRefresh(pool, user.id, { userAgent: ua(req) });
    return buildSession(user, rt);
  }

  async function refreshGrant(req, body) {
    const token = body.refresh_token;
    if (typeof token !== "string" || !token) throw new HttpError(400, "bad_request", "refresh_token is required");
    const result = await withTx(async (db) => {
      const { rows } = await db.query(
        `SELECT id, user_id, family_id, revoked_at, (expires_at <= now()) AS expired
         FROM auth.refresh_tokens WHERE token_hash = $1 FOR UPDATE`,
        [sha256(token)],
      );
      const rt = rows[0];
      if (!rt) return { fail: true };
      if (rt.revoked_at) {
        await db.query(
          "UPDATE auth.refresh_tokens SET revoked_at = now() WHERE family_id = $1 AND revoked_at IS NULL",
          [rt.family_id],
        );
        return { fail: true };
      }
      if (rt.expired) return { fail: true };
      const u = await db.query("SELECT id, email, created_at FROM auth.users WHERE id = $1", [rt.user_id]);
      if (!u.rows[0]) return { fail: true };
      await db.query("UPDATE auth.refresh_tokens SET revoked_at = now() WHERE id = $1", [rt.id]);
      const next = await issueRefresh(db, rt.user_id, { familyId: rt.family_id, parentId: rt.id, userAgent: ua(req) });
      return { user: u.rows[0], next };
    });
    if (result.fail) throw new HttpError(401, "invalid_grant", "Invalid refresh token");
    return buildSession(result.user, result.next);
  }

  app.post("/auth/v1/token", strictLimit, async (req) => {
    const body = req.body;
    if (!body || typeof body !== "object") throw new HttpError(400, "bad_request", "Invalid request");
    if (body.grant_type === "password") return passwordGrant(req, body);
    if (body.grant_type === "refresh_token") return refreshGrant(req, body);
    throw new HttpError(400, "unsupported_grant_type", "Unsupported grant_type");
  });

  app.post("/auth/v1/logout", async (req, reply) => {
    const token = req.body?.refresh_token;
    if (typeof token !== "string" || !token) throw new HttpError(400, "bad_request", "refresh_token is required");
    await pool.query(
      `UPDATE auth.refresh_tokens SET revoked_at = now()
       WHERE revoked_at IS NULL AND family_id IN
         (SELECT family_id FROM auth.refresh_tokens WHERE token_hash = $1)`,
      [sha256(token)],
    );
    return reply.code(204).send();
  });

  app.get("/auth/v1/user", async (req) => {
    const claims = await authenticate(req);
    const { rows } = await pool.query("SELECT id, email, created_at FROM auth.users WHERE id = $1", [claims.sub]);
    if (!rows[0]) throw new HttpError(401, "invalid_token", "Invalid or expired token");
    return toUser(rows[0]);
  });

  app.put("/auth/v1/user/password", strictLimit, async (req, reply) => {
    const claims = await authenticate(req);
    const { current_password: cur, new_password: next, refresh_token: rtok } = req.body || {};
    if (typeof cur !== "string") throw new HttpError(400, "bad_request", "current_password is required");
    validateNewPassword(next);
    const { rows } = await pool.query("SELECT id, email, encrypted_password FROM auth.users WHERE id = $1", [claims.sub]);
    const user = rows[0];
    if (!user) throw new HttpError(401, "invalid_token", "Invalid or expired token");
    assertNotLocked(user.email);
    if (!(await bcrypt.compare(cur, user.encrypted_password))) {
      recordFailure(user.email);
      throw new HttpError(401, "invalid_credentials", "Current password is incorrect");
    }
    const hash = await bcrypt.hash(next, config.bcryptCost);
    await withTx(async (db) => {
      await db.query("UPDATE auth.users SET encrypted_password = $1, updated_at = now() WHERE id = $2", [hash, user.id]);
      let keep = null;
      if (typeof rtok === "string" && rtok) {
        const r = await db.query(
          "SELECT family_id FROM auth.refresh_tokens WHERE token_hash = $1 AND user_id = $2",
          [sha256(rtok), user.id],
        );
        keep = r.rows[0]?.family_id || null;
      }
      await db.query(
        `UPDATE auth.refresh_tokens SET revoked_at = now()
         WHERE user_id = $1 AND revoked_at IS NULL AND ($2::uuid IS NULL OR family_id <> $2::uuid)`,
        [user.id, keep],
      );
    });
    failures.delete(user.email);
    return reply.code(204).send();
  });

  });

  return app;
}
