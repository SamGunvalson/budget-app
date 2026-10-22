import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, unlinkSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";

// Build all three images with this tag before running; never use a live project.
const imageTag = process.env.BUDGET_IMAGE_TAG || "selfhost-test";

test("image-only stack initializes, authenticates, enforces RLS, and preserves data", { timeout: 300_000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), "budget-selfhost-"));
  const composeFile = join(directory, "compose.yml");
  copyFileSync(new URL("../docker-compose.selfhost.yml", import.meta.url), composeFile);
  const env = {
    ...process.env,
    BUDGET_IMAGE_TAG: imageTag,
    POSTGRES_PASSWORD: randomBytes(32).toString("hex"),
    AUTHENTICATOR_PASSWORD: randomBytes(32).toString("hex"),
    AUTH_ADMIN_PASSWORD: randomBytes(32).toString("hex"),
    JWT_SECRET: randomBytes(48).toString("base64"),
    ALLOW_SIGNUP: "true",
    APP_BIND: "127.0.0.1",
    APP_PORT: "0",
  };
  const project = `budget-smoke-${randomBytes(6).toString("hex")}`;
  const compose = (...args) => execFileSync("docker", [
    "compose", "--project-name", project, "-f", composeFile, ...args,
  ], { cwd: directory, env, encoding: "utf8", timeout: 180_000, stdio: ["pipe", "pipe", "pipe"] });
  const start = () => compose("up", "-d", "--wait", "--wait-timeout", "120", "--pull", "missing");
  let base;
  const waitForApi = async () => {
    base = `http://${compose("port", "budget-app", "8085").trim()}`;
    for (let attempt = 0; attempt < 30; attempt++) {
      const health = await fetch(`${base}/auth/v1/health`);
      const rest = await fetch(`${base}/rest/v1/`);
      if (health.ok && rest.ok) return;
      await setTimeout(1000);
    }
    assert.fail("Auth/PostgREST did not become ready through Nginx");
  };
  const request = (path, body, token, method = "POST") => fetch(`${base}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      Prefer: "return=representation",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  try {
    start();
    await waitForApi();
    assert.equal((await fetch(base)).status, 200);
    compose("exec", "-T", "db", "psql", "-X", "-v", "ON_ERROR_STOP=1", "-U", "postgres",
      "-d", "postgres", "-f", "/sql_scripts/local/tests/transactions_rls.sql");
    const email = "smoke@example.com";
    const password = randomBytes(24).toString("hex");
    const signup = await request("/auth/v1/signup", { email, password });
    assert.equal(signup.status, 201, await signup.clone().text());
    const session = await signup.json();
    const created = await request("/rest/v1/categories", {
      user_id: session.user.id, name: "Deployment smoke test", type: "needs",
    }, session.access_token);
    assert.equal(created.status, 201, await created.clone().text());
    const [category] = await created.json();
    assert.ok(category.id);
    const anonymous = await request("/rest/v1/categories", null, null, "GET");
    assert.equal(anonymous.status, 401);

    compose("down");
    start();
    await waitForApi();
    const login = await request("/auth/v1/token", { grant_type: "password", email, password });
    assert.equal(login.status, 200, await login.clone().text());
    const restored = await login.json();
    assert.equal(restored.user.id, session.user.id);
    const saved = await request(`/rest/v1/categories?id=eq.${category.id}`, null, restored.access_token, "GET");
    assert.equal(saved.status, 200);
    assert.deepEqual((await saved.json()).map((row) => row.id), [category.id]);
  } catch (error) {
    console.error(compose("logs", "--no-color", "--tail", "100"));
    throw error;
  } finally {
    try {
      compose("down", "--volumes", "--remove-orphans");
    } finally {
      unlinkSync(composeFile);
      rmdirSync(directory);
    }
  }
});
