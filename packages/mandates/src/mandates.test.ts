import { describe, expect, test } from "vitest";
import { greyJacketIntent } from "@poi/contracts/fixtures";
import { exportJWK, generateKeyPair } from "jose";
import {
  canonicalJson,
  createKeyRegistry,
  customId,
  generateSigningKeyPair,
  keyIdFor,
  keyValidAt,
  publicEs256Jwk,
  mandateHash,
  signMandate,
  verifyMandate,
  type VerifyKey,
} from "./index";

describe("canonicalization", () => {
  test("key order does not change the bytes or the hash", () => {
    const a = { b: 1, a: { d: [1, 2], c: "x" } };
    const b = { a: { c: "x", d: [1, 2] }, b: 1 };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
    expect(mandateHash(a)).toBe(mandateHash(b));
  });

  test("hash is lowercase hex SHA-256", () => {
    expect(mandateHash(greyJacketIntent)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("customId", () => {
  test("is 57 characters for a UUID mandate id and fits PayPal's 127 cap", () => {
    const id = customId(greyJacketIntent.mandate_id, mandateHash(greyJacketIntent));
    expect(id).toHaveLength(57);
    expect(id.startsWith(`poi:${greyJacketIntent.mandate_id}:`)).toBe(true);
  });
});

describe("JWS sign and verify", () => {
  const registry = new Map<string, VerifyKey>();
  const resolve = async (kid: string) => registry.get(kid);

  test("round trip returns the exact canonical payload", async () => {
    const { privateKey, publicKey } = await generateSigningKeyPair();
    registry.set("shopper-key-1", publicKey);
    const jws = await signMandate(greyJacketIntent, privateKey, "shopper-key-1");
    const res = await verifyMandate(jws, resolve);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.payload).toEqual(greyJacketIntent);
      expect(res.canonical).toBe(canonicalJson(greyJacketIntent));
    }
  });

  test("a tampered payload fails verification", async () => {
    const { privateKey, publicKey } = await generateSigningKeyPair();
    registry.set("k-tamper", publicKey);
    const jws = await signMandate(greyJacketIntent, privateKey, "k-tamper");
    const [h, , s] = jws.split(".");
    const forged = Buffer.from(
      canonicalJson({ ...greyJacketIntent, natural_language_description: "anything, any price" }),
    ).toString("base64url");
    expect(await verifyMandate(`${h}.${forged}.${s}`, resolve)).toEqual({
      ok: false,
      reason: "SIGNATURE_INVALID",
    });
  });

  test("a signature from the wrong key fails", async () => {
    const real = await generateSigningKeyPair();
    const attacker = await generateSigningKeyPair();
    registry.set("k-wrong", real.publicKey);
    const jws = await signMandate(greyJacketIntent, attacker.privateKey, "k-wrong");
    expect(await verifyMandate(jws, resolve)).toEqual({ ok: false, reason: "SIGNATURE_INVALID" });
  });

  test("an unregistered key id is reported as UNKNOWN_KEY", async () => {
    const { privateKey } = await generateSigningKeyPair();
    const jws = await signMandate(greyJacketIntent, privateKey, "never-registered");
    expect(await verifyMandate(jws, resolve)).toEqual({ ok: false, reason: "UNKNOWN_KEY" });
  });
});

describe("key registry", () => {
  test("a retired shopper key still verifies mandates signed before retired_at, and nothing after", async () => {
    const { privateKey, publicKey } = await generateSigningKeyPair();
    const jwk = await exportJWK(publicKey);
    const kid = await keyIdFor("shp", publicEs256Jwk(jwk));
    const registry = createKeyRegistry();
    registry.register(kid, publicEs256Jwk(jwk), "shopper-1");
    const jws = await signMandate(greyJacketIntent, privateKey, kid);

    registry.retire(kid, "2026-11-01T12:00:00Z");
    registry.retire(kid, "2026-12-31T00:00:00Z"); // a second retire keeps the first date
    const before = await verifyMandate(jws, (k) => registry.resolve(k, "2026-11-01T09:00:00Z"));
    const after = await verifyMandate(jws, (k) => registry.resolve(k, "2026-11-01T12:00:00Z"));
    expect(before.ok).toBe(true);
    expect(after).toEqual({ ok: false, reason: "UNKNOWN_KEY" });
  });

  test("the key id is the thumbprint: same key, same id; a different key can't take it", async () => {
    const a = publicEs256Jwk(await exportJWK((await generateSigningKeyPair()).publicKey));
    const b = publicEs256Jwk(await exportJWK((await generateSigningKeyPair()).publicKey));
    expect(await keyIdFor("shp", a)).toBe(await keyIdFor("shp", { ...a }));
    expect(await keyIdFor("shp", a)).toMatch(/^shp_[A-Za-z0-9_-]{43}$/);
    const registry = createKeyRegistry();
    registry.register("k", a, "x");
    expect(() => registry.register("k", b, "y")).toThrow("different key");
    expect(() => registry.retire("nope", "2026-11-01T00:00:00Z")).toThrow("unknown key");
  });

  test("only P-256 public keys are accepted", async () => {
    const pair = await generateKeyPair("ES256", { extractable: true });
    const pub = await exportJWK(pair.publicKey);
    expect(publicEs256Jwk({ ...pub, kid: "ignored", use: "sig" })).toEqual({
      kty: "EC",
      crv: "P-256",
      x: pub.x,
      y: pub.y,
    });
    const priv = await exportJWK(pair.privateKey);
    expect(() => publicEs256Jwk(priv)).toThrow("private key");
    expect(() => publicEs256Jwk({ ...pub, crv: "P-384" })).toThrow("P-256");
    expect(() => publicEs256Jwk(null)).toThrow();
  });

  test("keyValidAt is strict at the retirement instant", () => {
    expect(keyValidAt({}, "2030-01-01T00:00:00Z")).toBe(true);
    expect(keyValidAt({ retiredAt: "2026-11-01T00:00:00Z" }, "2026-10-31T23:59:59Z")).toBe(true);
    expect(keyValidAt({ retiredAt: "2026-11-01T00:00:00Z" }, "2026-11-01T00:00:00Z")).toBe(false);
  });
});
