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

test("does not persist or recover the token from web storage", async () => {
  const app = await read("app.js");

  assert.doesNotMatch(app, /localStorage\.(?:getItem|setItem)/);
  assert.match(app, /localStorage\.removeItem\("fw_token"\)/);
});

test("uses a restrictive CSP without unsafe-inline", async () => {
  const index = await read("index.html");

  assert.match(index, /Content-Security-Policy/);
  assert.match(index, /connect-src https:\/\/api\.github\.com/);
  assert.match(index, /script-src 'self'/);
  assert.doesNotMatch(index, /unsafe-inline/);
});

test("sends authenticated requests only to the fixed GitHub API repository", async () => {
  const [app, history, score] = await Promise.all([
    read("app.js"),
    read("history.mjs"),
    read("score.mjs"),
  ]);

  assert.match(app, /const OWNER = "tiagoirber"/);
  assert.match(app, /const REPO = "flight-watcher"/);
  assert.match(app, /https:\/\/api\.github\.com\/repos/);
  assert.doesNotMatch(
    app,
    /https?:\/\/(?!(?:api\.github\.com|www\.w3\.org\/2000\/svg))/
  );
  assert.match(app, /data\/history\/v1\/manifest\.json/);
  assert.match(history, /url\.protocol !== "https:"/);
  assert.doesNotMatch(history, /fetch\s*\(/);
  assert.doesNotMatch(score, /fetch\s*\(|localStorage|sessionStorage/);
});

test("uses no third-party chart scripts or unsafe SVG markup", async () => {
  const [app, index] = await Promise.all([read("app.js"), read("index.html")]);

  assert.match(app, /createElementNS\("http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.doesNotMatch(app, /\.innerHTML\b|insertAdjacentHTML|document\.write/);
  assert.doesNotMatch(index, /<script[^>]+src=["']https?:\/\//i);
});
