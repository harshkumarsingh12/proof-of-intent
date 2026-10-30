import { describe, expect, test } from "vitest";
import { greyJacketIntent } from "@poi/contracts/fixtures";
import { ledger } from "@poi/ledger";
import {
  canonicalJson,
  customId,
  generateSigningKeyPair,
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
    expect(await verifyMandate(`${h}.${forged}.${s}`, resolve)).toEqual({ ok: false, reason: "SIGNATURE_INVALID" });
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

describe("key registry (unbuilt)", () => {
  ledger("M1", "srshriv", "a retired shopper key still verifies mandates signed before retired_at", async () => {
    const { createKeyRegistry } = (await import("./index")) as unknown as {
      createKeyRegistry: () => { retire: (kid: string, at: string) => void };
    };
    expect(typeof createKeyRegistry).toBe("function");
  });
});
