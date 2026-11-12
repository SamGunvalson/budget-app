import { test } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { DEFAULT_TRUST_PROXY, loadConfig, parseTrustProxy } from "../src/config.js";

test("TRUST_PROXY defaults to private proxy ranges, not trust-everything", () => {
  assert.equal(loadConfig({}).trustProxy, DEFAULT_TRUST_PROXY);
  assert.equal(parseTrustProxy(""), DEFAULT_TRUST_PROXY);
  assert.equal(parseTrustProxy("  "), DEFAULT_TRUST_PROXY);
  assert.notEqual(DEFAULT_TRUST_PROXY, true);
});

test("TRUST_PROXY accepts booleans, hop counts, and address lists", () => {
  assert.equal(parseTrustProxy("true"), true);
  assert.equal(parseTrustProxy("TRUE"), true);
  assert.equal(parseTrustProxy("false"), false);
  assert.equal(parseTrustProxy("False"), false);
  assert.equal(parseTrustProxy("1"), 1);
  assert.equal(parseTrustProxy("0"), 0);
  assert.equal(parseTrustProxy("172.18.0.0/16"), "172.18.0.0/16");
  assert.equal(parseTrustProxy(" 10.0.0.1 , 172.18.0.0/16,"), "10.0.0.1,172.18.0.0/16");
  assert.equal(loadConfig({ TRUST_PROXY: "false" }).trustProxy, false);
});

const clientIp = async (trustProxy, forwardedFor) => {
  const app = Fastify({ trustProxy });
  app.get("/", (req) => req.ip);
  const res = await app.inject({
    url: "/",
    remoteAddress: "172.18.0.5",
    headers: { "x-forwarded-for": forwardedFor },
  });
  await app.close();
  return res.body;
};

test("default trusts the private proxy hop and reads the address it set", async () => {
  assert.equal(await clientIp(parseTrustProxy(undefined), "203.0.113.7"), "203.0.113.7");
});

test("default ignores X-Forwarded-For from a public peer", async () => {
  const app = Fastify({ trustProxy: parseTrustProxy(undefined) });
  app.get("/", (req) => req.ip);
  const res = await app.inject({
    url: "/",
    remoteAddress: "198.51.100.9",
    headers: { "x-forwarded-for": "203.0.113.7" },
  });
  await app.close();
  assert.equal(res.body, "198.51.100.9");
});

test("TRUST_PROXY=false uses the socket peer", async () => {
  assert.equal(await clientIp(parseTrustProxy("false"), "203.0.113.7"), "172.18.0.5");
});
