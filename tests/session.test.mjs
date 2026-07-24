import assert from "node:assert/strict";
import test from "node:test";

import { createSessionToken, verifySessionToken } from "../worker/session.js";

const SECRET = "segredo-de-teste-nao-usar-em-producao";

test("a freshly created token is accepted before it expires", async () => {
  const now = Date.now();
  const token = await createSessionToken(SECRET, now);
  assert.equal(await verifySessionToken(token, SECRET, now), true);
});

test("a token is still valid right before its one-year expiry", async () => {
  const now = Date.now();
  const token = await createSessionToken(SECRET, now);
  const almostOneYearLater = now + 365 * 24 * 60 * 60 * 1000 - 1000;
  assert.equal(await verifySessionToken(token, SECRET, almostOneYearLater), true);
});

test("a token is rejected once it has expired", async () => {
  const now = Date.now();
  const token = await createSessionToken(SECRET, now);
  const oneYearAndADayLater = now + 366 * 24 * 60 * 60 * 1000;
  assert.equal(await verifySessionToken(token, SECRET, oneYearAndADayLater), false);
});

test("a token signed with a different secret is rejected", async () => {
  const now = Date.now();
  const token = await createSessionToken(SECRET, now);
  assert.equal(await verifySessionToken(token, "outro-segredo", now), false);
});

test("a token with a tampered payload is rejected", async () => {
  const now = Date.now();
  const token = await createSessionToken(SECRET, now);
  const [, signature] = token.split(".");
  const tamperedPayload = Buffer.from('{"exp":99999999999999}')
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  const tampered = `${tamperedPayload}.${signature}`;
  assert.equal(await verifySessionToken(tampered, SECRET, now), false);
});

test("malformed tokens are rejected without throwing", async () => {
  assert.equal(await verifySessionToken("", SECRET), false);
  assert.equal(await verifySessionToken("sem-ponto", SECRET), false);
  assert.equal(await verifySessionToken("a.b.c", SECRET), false);
  assert.equal(await verifySessionToken(null, SECRET), false);
  assert.equal(await verifySessionToken(undefined, SECRET), false);
});
