/**
 * Canonicalization, hashing and JWS signatures for mandates. Spec: docs/specs/0001-mandate-model.md.
 * Standard libraries only (jose, canonicalize). No custom crypto.
 */
import { createHash } from "node:crypto";
import canonicalize from "canonicalize";
import {
  calculateJwkThumbprint,
  CompactSign,
  compactVerify,
  generateKeyPair,
  importJWK,
  type JWK,
} from "jose";

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

/**
 * Spec 0001: a retired key still verifies mandates created before `retired_at`, and nothing created after.
 * The one place this rule lives; checkout and the registry both use it.
 *
 * `createdAt` must be a time the verifier trusts: now, or when this merchant first saw the mandate. Never a time the
 * signer wrote into the mandate (`created_at`, `timestamp`): a retired or stolen key can sign any date it likes, so
 * a fresh mandate dated before the retirement would pass (#162). Checking an *old* mandate for evidence, long after
 * the fact, is the one place the mandate's own date is fine: it was accepted when first seen.
 */
export function keyValidAt(key: { retiredAt?: string }, createdAt: string): boolean {
  return !key.retiredAt || Date.parse(createdAt) < Date.parse(key.retiredAt);
}

/** A public ES256 key as we store it: P-256 coordinates only. Throws on anything else (private parts included). */
export function publicEs256Jwk(input: unknown): JWK {
  const k = input as Record<string, unknown> | null;
  const coord = (v: unknown) => typeof v === "string" && /^[A-Za-z0-9_-]{43}$/.test(v);
  if (!k || k.kty !== "EC" || k.crv !== "P-256" || !coord(k.x) || !coord(k.y)) {
    throw new Error("expected a P-256 public JWK { kty: EC, crv: P-256, x, y }");
  }
  if ("d" in k) throw new Error("that is a private key; send only the public half");
  return { kty: "EC", crv: "P-256", x: k.x as string, y: k.y as string };
}

/**
 * The key id is the key's RFC 7638 thumbprint, so the same key always gets the same id and nobody can claim
 * an id for a key they don't hold the public half of.
 */
export async function keyIdFor(prefix: "shp" | "agt", jwk: JWK): Promise<string> {
  return `${prefix}_${await calculateJwkThumbprint(jwk, "sha256")}`;
}

export interface RegisteredKey {
  kid: string;
  publicJwk: JWK;
  owner: string;
  retiredAt?: string;
}

/** In-memory key registry (spec 0001 interface). The API keeps the same records in Postgres. */
export function createKeyRegistry() {
  const keys = new Map<string, RegisteredKey>();
  return {
    register(kid: string, publicJwk: JWK, owner: string): void {
      const prev = keys.get(kid);
      if (prev && (prev.publicJwk.x !== publicJwk.x || prev.publicJwk.y !== publicJwk.y)) {
        throw new Error(`key id ${kid} is already registered to a different key`);
      }
      if (!prev) keys.set(kid, { kid, publicJwk: publicEs256Jwk(publicJwk), owner });
    },
    retire(kid: string, at: string): void {
      const key = keys.get(kid);
      if (!key) throw new Error(`unknown key id ${kid}`);
      key.retiredAt ??= at; // retiring twice keeps the first date
    },
    /** The key for a mandate created at `mandateCreatedAt`, or undefined (unknown, or retired by then). */
    async resolve(kid: string, mandateCreatedAt: string): Promise<VerifyKey | undefined> {
      const key = keys.get(kid);
      if (!key || !keyValidAt(key, mandateCreatedAt)) return undefined;
      return (await importJWK(key.publicJwk, "ES256")) as VerifyKey;
    },
  };
}
