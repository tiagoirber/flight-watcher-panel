import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function read(relativePath) {
  return readFile(new URL(relativePath, root), "utf8");
}

test("renders untrusted data without innerHTML or inline handlers", async () => {
  const [app, index] = await Promise.all([read("app.js"), read("index.html")]);

  assert.doesNotMatch(app, /\.innerHTML\b/);
  assert.doesNotMatch(index, /\son(?:click|submit|input)=/i);
  assert.doesNotMatch(index, /<script(?![^>]*\bsrc=)[^>]*>/i);
});

test("never exposes a raw GitHub token to the browser; only a scoped, revocable session token may be persisted", async () => {
  const app = await read("app.js");

  assert.doesNotMatch(app, /github_pat_|ghp_|gho_|ghu_|ghs_|ghr_/);
  assert.match(app, /localStorage\.setItem\(SESSION_STORAGE_KEY/);
  assert.match(app, /localStorage\.getItem\(SESSION_STORAGE_KEY/);
  assert.match(app, /localStorage\.removeItem\("fw_token"\)/);
});

test("uses a restrictive CSP without unsafe-inline", async () => {
  const index = await read("index.html");

  assert.match(index, /Content-Security-Policy/);
  assert.match(index, /connect-src https:\/\/[a-zA-Z0-9.-]+\.workers\.dev/);
  assert.match(index, /script-src 'self'/);
  assert.doesNotMatch(index, /unsafe-inline/);
});

test("the panel only talks to its own worker; the worker only talks to the fixed GitHub repo", async () => {
  const [
    app,
    worker,
    history,
    score,
    recommendation,
    dashboard,
    flexible,
    intelligence,
  ] = await Promise.all([
    read("app.js"),
    read("worker/index.js"),
    read("history.mjs"),
    read("score.mjs"),
    read("recommendation.mjs"),
    read("dashboard.mjs"),
    read("flexible-search.mjs"),
    read("intelligence.mjs"),
  ]);

  assert.match(app, /const WORKER_BASE_URL = "https:\/\/[a-zA-Z0-9.-]+\.workers\.dev"/);
  assert.doesNotMatch(app, /api\.github\.com/);
  assert.doesNotMatch(
    app,
    /https?:\/\/(?!(?:[a-zA-Z0-9.-]+\.workers\.dev|www\.w3\.org\/2000\/svg))/
  );
  assert.match(app, /data\/history\/v1\/manifest\.json/);
  assert.match(app, /\.github\/workflows\/monitor\.yml/);

  assert.match(worker, /const OWNER = "tiagoirber"/);
  assert.match(worker, /const REPO = "flight-watcher"/);
  assert.match(worker, /https:\/\/api\.github\.com\/repos/);
  assert.doesNotMatch(
    worker,
    /https?:\/\/(?!(?:api\.github\.com|tiagoirber\.github\.io))/
  );

  assert.match(history, /url\.protocol !== "https:"/);
  assert.doesNotMatch(history, /fetch\s*\(/);
  assert.doesNotMatch(score, /fetch\s*\(|localStorage|sessionStorage/);
  assert.doesNotMatch(
    recommendation,
    /fetch\s*\(|localStorage|sessionStorage/
  );
  assert.doesNotMatch(dashboard, /fetch\s*\(|localStorage|sessionStorage/);
  assert.doesNotMatch(flexible, /fetch\s*\(|localStorage|sessionStorage/);
  assert.doesNotMatch(
    intelligence,
    /fetch\s*\(|localStorage|sessionStorage|workerFetch|dispatch\s*\(/
  );
});

test("the worker never leaks its secrets in code and enforces a path allowlist", async () => {
  const worker = await read("worker/index.js");

  assert.doesNotMatch(worker, /github_pat_|ghp_|gho_|ghu_|ghs_|ghr_/);
  assert.match(worker, /ALLOWED_PATH_PREFIXES/);
  assert.match(worker, /path\.includes\("\.\."\)/);
  assert.match(worker, /env\.GITHUB_PAT/);
  assert.match(worker, /env\.PANEL_PASSWORD/);
  assert.match(worker, /env\.SESSION_SECRET/);
});

test("intelligence is deterministic and declares no external AI service", async () => {
  const intelligence = await read("intelligence.mjs");

  assert.match(intelligence, /externalSources:\s*false/);
  assert.match(intelligence, /não prevê preços futuros/);
  assert.doesNotMatch(
    intelligence,
    /api\.openai|anthropic|gemini|chatgpt|XMLHttpRequest|WebSocket/
  );
});

test("uses no third-party chart scripts or unsafe SVG markup", async () => {
  const [app, index] = await Promise.all([read("app.js"), read("index.html")]);

  assert.match(app, /createElementNS\("http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.doesNotMatch(app, /\.innerHTML\b|insertAdjacentHTML|document\.write/);
  assert.doesNotMatch(index, /<script[^>]+src=["']https?:\/\//i);
});
