import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import pg from "pg";

const SCHEMA = `
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE IF NOT EXISTS auth.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE NOT NULL CHECK (email = lower(email)),
  encrypted_password text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_sign_in_at timestamptz
);
CREATE TABLE IF NOT EXISTS auth.refresh_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token_hash text UNIQUE NOT NULL,
  family_id uuid NOT NULL,
  parent_id uuid,
  revoked_at timestamptz,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  user_agent text
);`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function startTestDb() {
  let container = null;
  let url = process.env.TEST_DATABASE_URL;
  if (!url) {
    const name = `budget-auth-test-${crypto.randomBytes(4).toString("hex")}`;
    execFileSync("docker", [
      "run", "-d", "--rm", "--name", name, "-e", "POSTGRES_PASSWORD=test",
      "-p", "127.0.0.1::5432", "postgres:16-alpine",
    ], { stdio: "pipe" });
    container = name;
    try {
      const port = execFileSync("docker", ["port", name, "5432/tcp"]).toString().trim().split("\n")[0].split(":").pop();
      url = `postgres://postgres:test@127.0.0.1:${port}/postgres`;
      let ok = false;
      for (let i = 0; i < 90 && !ok; i++) {
        const c = new pg.Client({ connectionString: url });
        try {
          await c.connect();
          await c.query("SELECT 1");
          ok = true;
        } catch {
          await sleep(1000);
        } finally {
          await c.end().catch(() => {});
        }
      }
      if (!ok) throw new Error("postgres did not become ready");
    } catch (e) {
      stopContainer(name);
      throw e;
    }
  }
  const pool = new pg.Pool({ connectionString: url, max: 5 });
  try {
    await pool.query(SCHEMA);
  } catch (e) {
    await pool.end();
    if (container) stopContainer(container);
    throw e;
  }
  return {
    pool,
    async stop() {
      await pool.end();
      if (container) stopContainer(container);
    },
  };
}

function stopContainer(name) {
  try {
    execFileSync("docker", ["rm", "-f", name], { stdio: "pipe" });
  } catch {
    /* already gone */
  }
}

export const testConfig = (over = {}) => ({
  databaseUrl: "unused",
  jwtSecret: "x".repeat(40),
  issuer: "budget-app-auth",
  accessTtl: 900,
  refreshTtl: 3600,
  allowSignup: true,
  passwordMinLength: 8,
  bcryptCost: 4,
  trustProxy: false,
  rateLimitMax: 1000,
  authRateLimitMax: 1000,
  rateLimitWindowMs: 60_000,
  loginFailMax: 5,
  loginFailWindowMs: 900_000,
  logLevel: "silent",
  ...over,
});
