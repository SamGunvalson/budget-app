import assert from "node:assert/strict";
import { test } from "node:test";
import { readableHttpErrorMessage, withReadableError } from "../src/services/httpErrors.js";

const nginx502 = () =>
  new Response("<html><head><title>502 Bad Gateway</title></head></html>", {
    status: 502,
    headers: { "Content-Type": "text/html" },
  });

test("an nginx HTML error page becomes a PostgREST-shaped JSON error", async () => {
  const response = withReadableError(nginx502());
  assert.equal(response.status, 502);
  assert.match(response.headers.get("content-type"), /json/);
  const body = await response.json();
  assert.equal(
    body.message,
    "Server temporarily unavailable (502 Bad Gateway). Please try again in a moment.",
  );
  assert.doesNotMatch(body.message, /<html/i);
});

test("gateway messages keep the phrases isConnectivityError matches on", () => {
  // Mirrors CONNECTIVITY_MESSAGE in src/services/connectivity.js.
  const connectivity = /bad gateway|service unavailable|gateway time-?out/i;
  for (const status of [502, 503, 504]) {
    assert.match(readableHttpErrorMessage(status), connectivity);
  }
  assert.doesNotMatch(readableHttpErrorMessage(500), connectivity);
});

test("JSON errors and successful responses pass through untouched", () => {
  const ok = new Response("<html></html>", { status: 200, headers: { "Content-Type": "text/html" } });
  assert.equal(withReadableError(ok), ok);
  const pgError = new Response('{"code":"23505","message":"duplicate"}', {
    status: 409,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
  assert.equal(withReadableError(pgError), pgError);
});

test("unknown statuses fall back to the response's status text", () => {
  assert.equal(readableHttpErrorMessage(418, "I'm a teapot"), "Request failed (418 I'm a teapot).");
  assert.equal(readableHttpErrorMessage(500), "Server error (500 Internal Server Error). Please try again.");
});
