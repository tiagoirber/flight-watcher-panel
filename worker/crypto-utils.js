export function toBase64Url(input) {
  const bytes =
    typeof input === "string" ? new TextEncoder().encode(input) : input;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64UrlToText(input) {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padLength = (4 - (normalized.length % 4)) % 4;
  const padded = normalized + "=".repeat(padLength);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export async function hmacSha256Base64Url(message, secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(message)
  );
  return toBase64Url(new Uint8Array(signature));
}

export function timingSafeEqual(a, b) {
  const bufferA = new TextEncoder().encode(String(a ?? ""));
  const bufferB = new TextEncoder().encode(String(b ?? ""));
  const length = Math.max(bufferA.length, bufferB.length, 1);
  let difference = bufferA.length === bufferB.length ? 0 : 1;
  for (let index = 0; index < length; index += 1) {
    difference |= (bufferA[index] ?? 0) ^ (bufferB[index] ?? 0);
  }
  return difference === 0;
}
