import { describe, expect, test } from "vitest";
import { MERCHANT_ID, NOW } from "@poi/contracts/fixtures";
import { generateSigningKeyPair, keyIdFor, publicEs256Jwk } from "@poi/mandates";
import { createMockClient } from "@poi/paypal";
import { exportJWK } from "jose";
import { buildApp } from "./app";
import { memoryDb, signedCheckout, type Party } from "./test-helpers";

const TOKEN = "operator-test-token";
const auth = { authorization: `Bearer ${TOKEN}` };

async function setup() {
  const mem = memoryDb();
  const merchantKey = await generateSigningKeyPair();
  const app = buildApp({
    paypal: createMockClient(),
    db: mem.db,
    operatorToken: TOKEN,
    merchant: { id: MERCHANT_ID, kid: "merchant-1", privateKey: merchantKey.privateKey },
    semanticFit: async () =>
      ({ fit: "match", confidence: 0.95, reasons: [], prompt_version: "test" }) as never,
    now: () => NOW,
  });
  return { app, mem };
}

/** A key pair with the public half as JWK, like a browser would export it. */
async function keyPair() {
  const { privateKey, publicKey } = await generateSigningKeyPair();
  return { privateKey, jwk: await exportJWK(publicKey) };
}

describe("POST /keys/shopper", () => {
  test("registers once and answers the same kid and shopper on repeat", async () => {
    const { app, mem } = await setup();
    const { jwk } = await keyPair();
    const first = await app.inject({ method: "POST", url: "/keys/shopper", payload: { public_jwk: jwk } });
    expect(first.statusCode).toBe(201);
    expect(first.json().kid).toBe(await keyIdFor("shp", publicEs256Jwk(jwk)));
    const again = await app.inject({ method: "POST", url: "/keys/shopper", payload: { public_jwk: jwk } });
    expect(again.statusCode).toBe(200);
    expect(again.json()).toEqual(first.json());
    expect(mem.audit.map((a) => a.action)).toEqual(["key.registered"]);
  });

  test("refuses private keys and non-P-256 keys", async () => {
    const { app } = await setup();
    const { jwk } = await keyPair();
    const priv = await app.inject({
      method: "POST",
      url: "/keys/shopper",
      payload: { public_jwk: { ...jwk, d: "x".repeat(43) } },
    });
    expect(priv.statusCode).toBe(400);
    expect(priv.json().message).toContain("private");
    const p384 = await app.inject({
      method: "POST",
      url: "/keys/shopper",
      payload: { public_jwk: { ...jwk, crv: "P-384" } },
    });
    expect(p384.statusCode).toBe(400);
  });
});

describe("POST /keys/agent and retirement (operator)", () => {
  test("agent keys need the operator token; the same key can't be claimed by another platform", async () => {
    const { app } = await setup();
    const { jwk } = await keyPair();
    const payload = { public_jwk: jwk, platform: "Northstar" };
    expect((await app.inject({ method: "POST", url: "/keys/agent", payload })).statusCode).toBe(401);
    expect(
      (await app.inject({ method: "POST", url: "/keys/agent", headers: auth, payload })).statusCode,
    ).toBe(201);
    expect(
      (await app.inject({ method: "POST", url: "/keys/agent", headers: auth, payload })).statusCode,
    ).toBe(200);
    const stolen = await app.inject({
      method: "POST",
      url: "/keys/agent",
      headers: auth,
      payload: { ...payload, platform: "Other" },
    });
    expect(stolen.statusCode).toBe(409);
  });

  test("retire needs the operator token and keeps the first date", async () => {
    const { app } = await setup();
    const { jwk } = await keyPair();
    const { kid } = (
      await app.inject({ method: "POST", url: "/keys/shopper", payload: { public_jwk: jwk } })
    ).json();
    const retire = (at: string, headers: Record<string, string> = auth) =>
      app.inject({ method: "POST", url: `/keys/shopper/${kid}/retire`, headers, payload: { at } });
    expect((await retire("2026-11-02T00:00:00Z", {})).statusCode).toBe(401);
    expect((await retire("2026-11-02T00:00:00Z")).json()).toEqual({
      kid,
      retired_at: "2026-11-02T00:00:00.000Z",
    });
    expect((await retire("2026-12-01T00:00:00Z")).json().retired_at).toBe("2026-11-02T00:00:00.000Z");
    expect(
      (await app.inject({ method: "POST", url: "/keys/shopper/shp_nope/retire", headers: auth, payload: {} }))
        .statusCode,
    ).toBe(404);
  });
});

describe("registered through the API, then checkout", () => {
  test("keys registered over HTTP sign a checkout that is approved; a retired shopper key is refused", async () => {
    const { app } = await setup();
    const shopperKeys = await keyPair();
    const agentKeys = await keyPair();
    const { kid: shopperKid } = (
      await app.inject({ method: "POST", url: "/keys/shopper", payload: { public_jwk: shopperKeys.jwk } })
    ).json();
    const { kid: agentKid } = (
      await app.inject({
        method: "POST",
        url: "/keys/agent",
        headers: auth,
        payload: { public_jwk: agentKeys.jwk, platform: "Northstar" },
      })
    ).json();
    const shopper: Party = {
      kid: shopperKid,
      privateKey: shopperKeys.privateKey,
      publicJwk: shopperKeys.jwk as unknown as Record<string, unknown>,
    };
    const agent: Party = {
      kid: agentKid,
      privateKey: agentKeys.privateKey,
      publicJwk: agentKeys.jwk as unknown as Record<string, unknown>,
    };

    const ok = await app.inject({
      method: "POST",
      url: "/checkout",
      payload: (await signedCheckout({ shopper, agent })).body,
    });
    expect(ok.json().verdict.outcome).toBe("APPROVE");

    // Retired before the fixture intent was created (2026-11-01T09:00Z): its mandates no longer verify.
    await app.inject({
      method: "POST",
      url: `/keys/shopper/${shopperKid}/retire`,
      headers: auth,
      payload: { at: "2026-11-01T00:00:00Z" },
    });
    const refused = await app.inject({
      method: "POST",
      url: "/checkout",
      payload: (await signedCheckout({ shopper, agent, paymentMandateId: crypto.randomUUID() })).body,
    });
    expect(refused.json().verdict).toEqual({ outcome: "REJECT", reasons: ["UNKNOWN_KEY"] });
  });
});
