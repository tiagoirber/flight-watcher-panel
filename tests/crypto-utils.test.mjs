import assert from "node:assert/strict";
import test from "node:test";

import {
  fromBase64UrlToText,
  hmacSha256Base64Url,
  timingSafeEqual,
  toBase64Url,
} from "../worker/crypto-utils.js";

test("base64url round-trips arbitrary UTF-8 text", () => {
  const original = '{"exp":123,"nota":"café ☕"}';
  assert.equal(fromBase64UrlToText(toBase64Url(original)), original);
});

test("base64url output never contains +, / or padding characters", () => {
  const encoded = toBase64Url("qualquer texto de tamanho variável aqui!!");
  assert.doesNotMatch(encoded, /[+/=]/);
});

test("HMAC signatures are deterministic for the same message and secret", async () => {
  const first = await hmacSha256Base64Url("payload", "segredo");
  const second = await hmacSha256Base64Url("payload", "segredo");
  assert.equal(first, second);
});

test("HMAC signatures differ when the secret differs", async () => {
  const first = await hmacSha256Base64Url("payload", "segredo-a");
  const second = await hmacSha256Base64Url("payload", "segredo-b");
  assert.notEqual(first, second);
});

test("timingSafeEqual accepts identical strings", () => {
  assert.equal(timingSafeEqual("mesma-senha", "mesma-senha"), true);
});

test("timingSafeEqual rejects different strings, including different lengths", () => {
  assert.equal(timingSafeEqual("senha-a", "senha-b"), false);
  assert.equal(timingSafeEqual("curta", "muito-mais-longa"), false);
  assert.equal(timingSafeEqual("", "algo"), false);
});
