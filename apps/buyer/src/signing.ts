/**
 * Browser signing key for Intent Mandates. Owner: @srshriv. Spec: docs/specs/0001-mandate-model.md.
 *
 * ECDSA P-256 generated with WebCrypto as **non-extractable**: the private key can sign but no script, ours
 * included, can read it out. Only WebCrypto, no libraries with key access, so the same code runs in the browser
 * and in Node's test runner. The JWS it produces is what `verifyMandate` in packages/mandates checks: compact,
 * `{ alg: "ES256", kid }`, payload = RFC 8785 canonical bytes.
 */
import canonicalize from "canonicalize";

export const KEY_ALGORITHM = { name: "ECDSA", namedCurve: "P-256" } as const;
const SIGN_ALGORITHM = { name: "ECDSA", hash: "SHA-256" } as const;

export interface ShopperKey {
  /** Non-extractable. Never leaves this device. */
  privateKey: CryptoKey;
  publicKey: CryptoKey;
}

export async function generateShopperKey(): Promise<ShopperKey> {
  const pair = await crypto.subtle.generateKey(KEY_ALGORITHM, false, ["sign", "verify"]);
  return { privateKey: pair.privateKey, publicKey: pair.publicKey };
}

/** The public half as `{ kty, crv, x, y }`, the only shape `POST /keys/shopper` accepts. */
export async function publicJwk(
  key: ShopperKey,
): Promise<{ kty: string; crv: string; x: string; y: string }> {
  const { kty, crv, x, y } = await crypto.subtle.exportKey("jwk", key.publicKey);
  return { kty: kty!, crv: crv!, x: x!, y: y! };
}

export function canonicalJson(value: unknown): string {
  const out = canonicalize(value);
  if (out === undefined) throw new TypeError("value cannot be canonicalized");
  return out;
}

const utf8 = new TextEncoder();

export function base64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64url(text: string): Uint8Array {
  const bin = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

/**
 * Compact JWS (ES256) over the canonical bytes. WebCrypto's ECDSA signature is already the raw r‖s form that
 * JWS ES256 uses, so it goes in as is.
 */
export async function signCompact(payload: unknown, privateKey: CryptoKey, kid: string): Promise<string> {
  const header = base64url(utf8.encode(JSON.stringify({ alg: "ES256", kid })));
  const body = base64url(utf8.encode(canonicalJson(payload)));
  const signingInput = utf8.encode(`${header}.${body}`);
  const sig = new Uint8Array(await crypto.subtle.sign(SIGN_ALGORITHM, privateKey, signingInput));
  return `${header}.${body}.${base64url(sig)}`;
}

/** The exact bytes a compact JWS signed, as text. Doesn't verify; the merchant API does that. */
export const jwsPayloadText = (jws: string): string =>
  new TextDecoder().decode(fromBase64url(jws.split(".")[1] ?? ""));

/** Lowercase hex SHA-256, same as `mandateHash` when given canonical bytes. */
export async function sha256Hex(text: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", utf8.encode(text)));
  return Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
}
