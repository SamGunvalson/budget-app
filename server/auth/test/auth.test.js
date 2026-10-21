import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { SignJWT } from "jose";
import { buildApp } from "../src/app.js";
import { startTestDb, testConfig } from "./helpers.js";

let db;
let n = 0;
const PW = "correct horse";
const email = () => `user${++n}-${Date.now()}@example.com`;

before(async () => {
  db = await startTestDb();
});
after(async () => {
  if (db) await db.stop();
});
beforeEach(async () => {
  await db.pool.query("TRUNCATE auth.users CASCADE");
});

async function app(over) {
  const a = buildApp(testConfig(over), { pool: db.pool });
  await a.ready();
  return a;
}
const call = (a, method, url, payload, token) =>
  a.inject({ method, url, payload, headers: token ? { authorization: `Bearer ${token}` } : {} });
const signup = (a, e = email(), password = PW) => call(a, "POST", "/auth/v1/signup", { email: e, password });
const login = (a, e, password) => call(a, "POST", "/auth/v1/token", { grant_type: "password", email: e, password });
const refresh = (a, t) => call(a, "POST", "/auth/v1/token", { grant_type: "refresh_token", refresh_token: t });

test("health", async () => {
  const a = await app();
  const r = await call(a, "GET", "/auth/v1/health");
  assert.deepEqual(r.json(), { ok: true, signupEnabled: true });
  await a.close();
});

test("signup returns session with proper JWT", async () => {
  const a = await app();
  const e = email();
  const r = await signup(a, `  ${e.toUpperCase()} `);
  assert.equal(r.statusCode, 201);
  const s = r.json();
  assert.equal(s.token_type, "bearer");
  assert.equal(s.expires_in, 900);
  assert.equal(s.user.email, e);
  assert.ok(s.refresh_token && s.user.id && s.user.created_at);
  const claims = JSON.parse(Buffer.from(s.access_token.split(".")[1], "base64url"));
  assert.equal(claims.aud, "authenticated");
  assert.equal(claims.role, "authenticated");
  assert.equal(claims.sub, s.user.id);
  assert.equal(claims.exp, s.expires_at);
  const stored = await db.pool.query("SELECT token_hash FROM auth.refresh_tokens");
  assert.notEqual(stored.rows[0].token_hash, s.refresh_token);
  await a.close();
});

test("signup disabled", async () => {
  const a = await app({ allowSignup: false });
  const r = await signup(a);
  assert.equal(r.statusCode, 403);
  assert.equal(r.json().error.code, "signup_disabled");
  assert.equal((await call(a, "GET", "/auth/v1/health")).json().signupEnabled, false);
  await a.close();
});

test("duplicate signup -> 409; invalid input -> 400", async () => {
  const a = await app();
  const e = email();
  assert.equal((await signup(a, e)).statusCode, 201);
  const r = await signup(a, e);
  assert.equal(r.statusCode, 409);
  assert.equal(r.json().error.code, "user_exists");
  assert.equal((await signup(a, "nope")).statusCode, 400);
  assert.equal((await signup(a, email(), "short")).statusCode, 400);
  assert.equal((await signup(a, email(), "é".repeat(40))).statusCode, 400);
  await a.close();
});

test("login ok / bad password / unknown email", async () => {
  const a = await app();
  const e = email();
  await signup(a, e);
  const ok = await login(a, e, PW);
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.json().user.email, e);
  const bad = await login(a, e, "wrong password");
  assert.equal(bad.statusCode, 401);
  assert.equal(bad.json().error.code, "invalid_credentials");
  const unk = await login(a, "nobody@example.com", PW);
  assert.equal(unk.statusCode, 401);
  assert.equal(unk.json().error.message, bad.json().error.message);
  const u = await db.pool.query("SELECT last_sign_in_at FROM auth.users WHERE email=$1", [e]);
  assert.ok(u.rows[0].last_sign_in_at);
  await a.close();
});

test("refresh rotates and reuse revokes family", async () => {
  const a = await app();
  const s1 = (await signup(a)).json();
  const r2 = await refresh(a, s1.refresh_token);
  assert.equal(r2.statusCode, 200);
  const s2 = r2.json();
  assert.notEqual(s2.refresh_token, s1.refresh_token);
  const reuse = await refresh(a, s1.refresh_token);
  assert.equal(reuse.statusCode, 401);
  assert.equal(reuse.json().error.code, "invalid_grant");
  const after = await refresh(a, s2.refresh_token);
  assert.equal(after.statusCode, 401);
  const { rows } = await db.pool.query("SELECT count(*)::int AS c FROM auth.refresh_tokens WHERE revoked_at IS NULL");
  assert.equal(rows[0].c, 0);
  const unknown = await refresh(a, "garbage");
  assert.equal(unknown.json().error.code, "invalid_grant");
  await a.close();
});

test("expired refresh token", async () => {
  const a = await app();
  const s = (await signup(a)).json();
  await db.pool.query("UPDATE auth.refresh_tokens SET expires_at = now() - interval '1 second'");
  const r = await refresh(a, s.refresh_token);
  assert.equal(r.statusCode, 401);
  assert.equal(r.json().error.code, "invalid_grant");
  await a.close();
});

test("logout revokes family", async () => {
  const a = await app();
  const s = (await signup(a)).json();
  const s2 = (await refresh(a, s.refresh_token)).json();
  const r = await call(a, "POST", "/auth/v1/logout", { refresh_token: s2.refresh_token });
  assert.equal(r.statusCode, 204);
  assert.equal((await refresh(a, s2.refresh_token)).statusCode, 401);
  await a.close();
});

test("GET /user with and without token", async () => {
  const a = await app();
  const s = (await signup(a)).json();
  const r = await call(a, "GET", "/auth/v1/user", undefined, s.access_token);
  assert.equal(r.statusCode, 200);
  assert.deepEqual(Object.keys(r.json()).sort(), ["created_at", "email", "id"]);
  assert.equal((await call(a, "GET", "/auth/v1/user")).statusCode, 401);
  assert.equal((await call(a, "GET", "/auth/v1/user", undefined, "bad.token.here")).statusCode, 401);
  const wrongAud = await new SignJWT({ role: "authenticated" })
    .setProtectedHeader({ alg: "HS256" }).setSubject(s.user.id).setAudience("other")
    .setIssuer("budget-app-auth").setExpirationTime("5m").sign(new TextEncoder().encode("x".repeat(40)));
  assert.equal((await call(a, "GET", "/auth/v1/user", undefined, wrongAud)).statusCode, 401);
  await a.close();
});

test("change password", async () => {
  const a = await app();
  const e = email();
  const s1 = (await signup(a, e)).json();
  const s2 = (await login(a, e, PW)).json();
  const wrong = await call(a, "PUT", "/auth/v1/user/password",
    { current_password: "nope nope", new_password: "new password 1" }, s1.access_token);
  assert.equal(wrong.statusCode, 401);
  assert.equal(wrong.json().error.code, "invalid_credentials");
  const ok = await call(a, "PUT", "/auth/v1/user/password",
    { current_password: PW, new_password: "new password 1", refresh_token: s1.refresh_token }, s1.access_token);
  assert.equal(ok.statusCode, 204);
  assert.equal((await refresh(a, s2.refresh_token)).statusCode, 401);
  assert.equal((await refresh(a, s1.refresh_token)).statusCode, 200);
  assert.equal((await login(a, e, PW)).statusCode, 401);
  assert.equal((await login(a, e, "new password 1")).statusCode, 200);
  await a.close();
});

test("Supabase-style $2a$10$ hash login", async () => {
  const a = await app();
  const e = email();
  const hash = bcrypt.hashSync("legacy-pass-1", 10).replace(/^\$2[aby]\$/, "$2a$");
  assert.ok(hash.startsWith("$2a$10$"));
  await db.pool.query("INSERT INTO auth.users (email, encrypted_password) VALUES ($1,$2)", [e, hash]);
  assert.equal((await login(a, e, "legacy-pass-1")).statusCode, 200);
  assert.equal((await login(a, e, "legacy-pass-2")).statusCode, 401);
  await a.close();
});

test("short JWT secret refuses to start", () => {
  assert.throws(() => buildApp(testConfig({ jwtSecret: "short" }), { pool: db.pool }), /JWT_SECRET/);
});

test("per-email lockout -> 429 too_many_attempts", async () => {
  const a = await app();
  const e = email();
  await signup(a, e);
  for (let i = 0; i < 5; i++) assert.equal((await login(a, e, "wrong password")).statusCode, 401);
  const r = await login(a, e, PW);
  assert.equal(r.statusCode, 429);
  assert.equal(r.json().error.code, "too_many_attempts");
  await a.close();
});

test("IP rate limit on /token -> 429", async () => {
  const a = await app({ authRateLimitMax: 3 });
  let last;
  for (let i = 0; i < 4; i++) last = await login(a, `x${i}@example.com`, PW);
  assert.equal(last.statusCode, 429);
  assert.equal(last.json().error.code, "rate_limited");
  await a.close();
});
