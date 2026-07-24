import {
  fromBase64UrlToText,
  hmacSha256Base64Url,
  timingSafeEqual,
  toBase64Url,
} from "./crypto-utils.js";

const SESSION_LIFETIME_MS = 365 * 24 * 60 * 60 * 1000;

export async function createSessionToken(secret, now = Date.now()) {
  const payloadJson = JSON.stringify({ exp: now + SESSION_LIFETIME_MS });
  const signature = await hmacSha256Base64Url(payloadJson, secret);
  return `${toBase64Url(payloadJson)}.${signature}`;
}

export async function verifySessionToken(token, secret, now = Date.now()) {
  if (typeof token !== "string") return false;
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  const [payloadPart, signaturePart] = parts;

  let payloadJson;
  try {
    payloadJson = fromBase64UrlToText(payloadPart);
  } catch {
    return false;
  }

  const expectedSignature = await hmacSha256Base64Url(payloadJson, secret);
  if (!timingSafeEqual(expectedSignature, signaturePart)) return false;

  let payload;
  try {
    payload = JSON.parse(payloadJson);
  } catch {
    return false;
  }
  return typeof payload.exp === "number" && payload.exp > now;
}
