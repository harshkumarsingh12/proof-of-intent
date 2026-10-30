/**
 * Canonicalization, hashing and JWS signatures for mandates. Spec: docs/specs/0001-mandate-model.md.
 * Standard libraries only (jose, canonicalize). No custom crypto.
 */
import { createHash } from "node:crypto";
import canonicalize from "canonicalize";
import { CompactSign, compactVerify, generateKeyPair } from "jose";

export type SigningKey = Parameters<CompactSign["sign"]>[0];
export type VerifyKey = Awaited<ReturnType<typeof generateKeyPair>>["publicKey"];

/** RFC 8785 JSON Canonicalization Scheme. Same input, same bytes, on every machine. */
export function canonicalJson(value: unknown): string {
  const out = canonicalize(value);
  if (out === undefined) throw new TypeError("value cannot be canonicalized");
  return out;
}

/** mandate_hash = SHA-256(JCS(payload)), lowercase hex. Reproducible by any party. */
export function mandateHash(payload: unknown): string {
  return createHash("sha256").update(canonicalJson(payload), "utf8").digest("hex");
}

/** The pointer we write to PayPal: poi:<mandate_id>:<first 16 hex of hash>. 57 chars for a UUID id. */
export function customId(mandateId: string, hash: string): string {
  const id = `poi:${mandateId}:${hash.slice(0, 16)}`;
  if (id.length > 127) throw new RangeError("PayPal caps custom_id at 127 characters");
  return id;
}

/** Signs the canonical bytes as a compact JWS (ES256). */
export async function signMandate(payload: unknown, key: SigningKey, kid: string): Promise<string> {
  return new CompactSign(new TextEncoder().encode(canonicalJson(payload)))
    .setProtectedHeader({ alg: "ES256", kid })
    .sign(key);
}

export type KeyResolver = (kid: string) => Promise<VerifyKey | undefined>;

export type VerifyResult =
  | { ok: true; kid: string; payload: unknown; canonical: string }
  | { ok: false; reason: "UNKNOWN_KEY" | "SIGNATURE_INVALID" };

/**
 * Verifies a compact JWS against a registered key. Returns the exact verified bytes
 * (`canonical`) so the audit log stores what was signed, never a re-serialized copy.
 * Schema and freshness checks happen after this, in the policy engine.
 */
export async function verifyMandate(jws: string, resolveKey: KeyResolver): Promise<VerifyResult> {
  let kid = "";
  try {
    const { payload, protectedHeader } = await compactVerify(jws, async (header) => {
      kid = header.kid ?? "";
      if (header.alg !== "ES256") throw new Error("alg");
      const key = await resolveKey(kid);
      if (!key) throw new UnknownKey();
      return key;
    });
    const canonical = new TextDecoder().decode(payload);
    return { ok: true, kid: protectedHeader.kid ?? kid, payload: JSON.parse(canonical), canonical };
  } catch (err) {
    return { ok: false, reason: err instanceof UnknownKey ? "UNKNOWN_KEY" : "SIGNATURE_INVALID" };
  }
}

class UnknownKey extends Error {}

export async function generateSigningKeyPair(): Promise<{ privateKey: SigningKey; publicKey: VerifyKey }> {
  return generateKeyPair("ES256", { extractable: true });
}
