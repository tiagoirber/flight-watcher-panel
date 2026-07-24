import assert from "node:assert/strict";
import test from "node:test";

import worker from "../worker/index.js";
import { createSessionToken } from "../worker/session.js";

const ENV = {
  PANEL_PASSWORD: "correct horse battery staple",
  SESSION_SECRET: "test-session-secret-please-rotate",
  GITHUB_PAT: "test-pat-should-never-leak-to-the-browser",
};

async function withStubFetch(responder, run) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => responder(url, init);
  try {
    return await run();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("rejects login with the wrong password", async () => {
  const request = new Request("https://worker.example/login", {
    method: "POST",
    body: JSON.stringify({ password: "wrong" }),
  });
  const response = await worker.fetch(request, ENV);
  assert.equal(response.status, 401);
});

test("accepts login with the correct password and returns a usable session token", async () => {
  const request = new Request("https://worker.example/login", {
    method: "POST",
    body: JSON.stringify({ password: ENV.PANEL_PASSWORD }),
  });
  const response = await worker.fetch(request, ENV);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(typeof body.token, "string");
  assert.ok(body.token.includes("."));
});

test("rejects a malformed login body instead of crashing", async () => {
  const request = new Request("https://worker.example/login", {
    method: "POST",
    body: "isso não é json",
  });
  const response = await worker.fetch(request, ENV);
  assert.equal(response.status, 400);
});

test("rejects protected endpoints without a valid session", async () => {
  const request = new Request("https://worker.example/repo/config/flights.json");
  const response = await worker.fetch(request, ENV);
  assert.equal(response.status, 401);
});

test("rejects protected endpoints with an expired or tampered session", async () => {
  const request = new Request("https://worker.example/repo/config/flights.json", {
    headers: { Authorization: "Bearer não-e-um-token-valido" },
  });
  const response = await worker.fetch(request, ENV);
  assert.equal(response.status, 401);
});

test("rejects repo paths outside the config/ and data/ allowlist", async () => {
  const token = await createSessionToken(ENV.SESSION_SECRET);
  const request = new Request("https://worker.example/repo/secrets.json", {
    headers: { Authorization: `Bearer ${token}` },
  });
  const response = await worker.fetch(request, ENV);
  assert.equal(response.status, 403);
});

test("rejects repo paths containing '..' even if the prefix looks allowed", async () => {
  const token = await createSessionToken(ENV.SESSION_SECRET);
  const request = new Request(
    "https://worker.example/repo/config/../secrets.json",
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const response = await worker.fetch(request, ENV);
  assert.equal(response.status, 403);
});

test("proxies an allowed repo path to the GitHub contents API using the stored PAT, without leaking it back", async () => {
  const token = await createSessionToken(ENV.SESSION_SECRET);
  let capturedUrl;
  let capturedAuthorization;
  await withStubFetch(
    (url, init) => {
      capturedUrl = String(url);
      capturedAuthorization = init.headers.Authorization;
      return new Response(
        JSON.stringify({ encoding: "base64", content: "eyJvazp0cnVlfQ==" }),
        { status: 200 }
      );
    },
    async () => {
      const request = new Request(
        "https://worker.example/repo/config/flights.json",
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const response = await worker.fetch(request, ENV);
      assert.equal(response.status, 200);
      const bodyText = await response.text();
      assert.doesNotMatch(bodyText, new RegExp(ENV.GITHUB_PAT));
    }
  );
  assert.equal(
    capturedUrl,
    "https://api.github.com/repos/tiagoirber/flight-watcher/contents/config/flights.json?ref=master"
  );
  assert.equal(capturedAuthorization, `Bearer ${ENV.GITHUB_PAT}`);
});

test("allows the exact monitor.yml path used to read the cron schedule", async () => {
  const token = await createSessionToken(ENV.SESSION_SECRET);
  await withStubFetch(
    () =>
      new Response(JSON.stringify({ encoding: "base64", content: "" }), {
        status: 200,
      }),
    async () => {
      const request = new Request(
        "https://worker.example/repo/.github/workflows/monitor.yml",
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const response = await worker.fetch(request, ENV);
      assert.equal(response.status, 200);
    }
  );
});

test("dispatches the manage-flights workflow only with a valid session", async () => {
  const token = await createSessionToken(ENV.SESSION_SECRET);
  let capturedUrl;
  let capturedBody;
  await withStubFetch(
    (url, init) => {
      capturedUrl = String(url);
      capturedBody = JSON.parse(init.body);
      return new Response(null, { status: 204 });
    },
    async () => {
      const request = new Request("https://worker.example/dispatch", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          ref: "master",
          inputs: { action: "pause", id: "bsb-ios-jan27" },
        }),
      });
      const response = await worker.fetch(request, ENV);
      assert.equal(response.status, 204);
    }
  );
  assert.equal(
    capturedUrl,
    "https://api.github.com/repos/tiagoirber/flight-watcher/actions/workflows/manage-flights.yml/dispatches"
  );
  assert.deepEqual(capturedBody, {
    ref: "master",
    inputs: { action: "pause", id: "bsb-ios-jan27" },
  });
});

test("dispatch requires a valid session too", async () => {
  const request = new Request("https://worker.example/dispatch", {
    method: "POST",
    body: JSON.stringify({ ref: "master", inputs: { action: "remove", id: "x" } }),
  });
  const response = await worker.fetch(request, ENV);
  assert.equal(response.status, 401);
});

test("responds to CORS preflight and unknown routes without throwing", async () => {
  const preflight = await worker.fetch(
    new Request("https://worker.example/login", { method: "OPTIONS" }),
    ENV
  );
  assert.equal(
    preflight.headers.get("Access-Control-Allow-Origin"),
    "https://tiagoirber.github.io"
  );

  const notFound = await worker.fetch(
    new Request("https://worker.example/rota-inexistente"),
    ENV
  );
  assert.equal(notFound.status, 404);
});
