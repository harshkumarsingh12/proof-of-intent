import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, test } from "vitest";
import type { SemanticFit } from "@poi/ai";
import { compliantCart, greyJacketIntent, MERCHANT_ID, NOW, overreachingCart } from "@poi/contracts/fixtures";
import { generateSigningKeyPair, keyIdFor, mandateHash, signMandate } from "@poi/mandates";
import { createMockClient } from "@poi/paypal";
import { verifyProofPackage } from "@poi/proof";
import type { JWK } from "jose";
import { buildApp } from "./app";
import { memoryDb, party, signedCheckout, type Party } from "./test-helpers";

/** In production a shopper or agent key id is the key's own thumbprint, and the verifier checks that: so these are too. */
async function realParty(prefix: "shp" | "agt"): Promise<Party> {
  const p = await party("tmp");
  return { ...p, kid: await keyIdFor(prefix, p.publicJwk as unknown as JWK) };
}

let shopper: Party;
let agent: Party;
let merchantKey: Awaited<ReturnType<typeof generateSigningKeyPair>>;
const TOKEN = "operator-token-for-tests";

beforeAll(async () => {
  shopper = await realParty("shp");
  agent = await realParty("agt");
  merchantKey = await generateSigningKeyPair();
});

const match = async (): Promise<SemanticFit> => ({
  fit: "match",
  confidence: 0.95,
  reasons: [],
  matched_attributes: [],
  conflicting_attributes: [],
});

async function purchase(opts: { approve?: boolean; operatorToken?: string; merchantKid?: string } = {}) {
  const mem = memoryDb();
  mem.keys.set(shopper.kid, {
    kind: "shopper",
    kid: shopper.kid,
    publicJwk: shopper.publicJwk,
    shopperId: "shopper-1",
  });
  mem.keys.set(agent.kid, {
    kind: "agent",
    kid: agent.kid,
    publicJwk: agent.publicJwk,
    platform: "Northstar",
  });
  const make = (merchantKid = "merchant-1") =>
    buildApp({
      paypal: createMockClient(),
      db: mem.db,
      merchant: { id: MERCHANT_ID, kid: merchantKid, privateKey: merchantKey.privateKey },
      semanticFit: match,
      now: () => NOW,
      ...(opts.operatorToken ? { operatorToken: opts.operatorToken } : {}),
    });
  const app = make(opts.merchantKid);
  const { body, cart } = await signedCheckout({ shopper, agent });
  const created = (await app.inject({ method: "POST", url: "/checkout", payload: body })).json();
  if (opts.approve !== false) {
    const approval_jws = await signMandate(
      { order_id: created.order_id, cart_mandate_hash: mandateHash(cart), approved_at: NOW },
      shopper.privateKey,
      shopper.kid,
    );
    const res = await app.inject({
      method: "POST",
      url: `/checkout/${created.order_id}/approve`,
      payload: { approval_jws },
    });
    expect(res.statusCode).toBe(200);
  }
  return { app, mem, make, orderId: created.order_id as string };
}

const proofOf = (app: ReturnType<typeof buildApp>, id: string, headers: Record<string, string> = {}) =>
  app.inject({ method: "GET", url: `/orders/${id}/proof`, headers });

describe("GET /orders/:id/proof", () => {
  test("a captured order's package verifies on its own, with every check passed", async () => {
    const { app, orderId } = await purchase();
    const res = await proofOf(app, orderId);
    expect(res.statusCode).toBe(200);
    const report = await verifyProofPackage(res.json());
    expect(report.checks.filter((c) => !c.passed)).toEqual([]);
    expect(report.ok).toBe(true);
  });

  test("it carries the PayPal references the order has, the policy version, and is sent as a download", async () => {
    const { app, orderId } = await purchase();
    const res = await proofOf(app, orderId);
    expect(res.headers["content-disposition"]).toBe(`attachment; filename="poi-proof-${orderId}.json"`);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.json()).toMatchObject({
      schema_version: "poi-proof/0.1",
      policy: { version: "poi-policy/0.1" },
      references: {
        order_id: orderId,
        merchant_id: MERCHANT_ID,
        order_status: "CAPTURED",
        capture_id: expect.stringMatching(/^[0-9A-Z]{17}$/),
        paypal_order_id: expect.any(String),
        agent_platform: "Northstar",
        human_present: true,
      },
    });
  });

  test("an order not yet captured still has a verifiable package, and says it was not captured", async () => {
    const { app, orderId } = await purchase({ approve: false });
    const pkg = (await proofOf(app, orderId)).json();
    expect(pkg.references.capture_id).toBeUndefined();
    expect(pkg.references.order_status).not.toBe("CAPTURED");
    expect((await verifyProofPackage(pkg)).ok).toBe(true);
  });

  test("it names the three mandates the order was made from, and only public material", async () => {
    const { app, orderId, mem } = await purchase();
    const pkg = (await proofOf(app, orderId)).json();
    const order = (await mem.db.getOrder(orderId))!;
    expect(pkg.mandates.intent.hash).toBe(order.intentMandateHash);
    expect(pkg.mandates.cart.hash).toBe(order.cartMandateHash);
    expect(pkg.keys.map((k: { role: string }) => k.role).sort()).toEqual(["agent", "merchant", "shopper"]);
    const text = JSON.stringify(pkg);
    expect(text).not.toMatch(/"d"\s*:/); // no private key
    expect(text).not.toContain("shopper-1"); // not the merchant's internal shopper id
    expect(text).not.toMatch(/vault/i);
  });

  test("a downloaded package that is edited afterwards no longer verifies", async () => {
    const { app, orderId } = await purchase();
    const pkg = (await proofOf(app, orderId)).json();
    pkg.references.capture_id = "FORGEDCAPTURE0000";
    const report = await verifyProofPackage(pkg);
    expect(report.ok).toBe(false);
    expect(report.checks.find((c) => c.id === "manifest.integrity")?.passed).toBe(false);
  });

  test("an unknown order is a 404", async () => {
    const { app } = await purchase();
    const res = await proofOf(app, "ord_nope");
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: "order_not_found" });
  });

  test("an order with no stored mandates says what is missing rather than inventing a package", async () => {
    const { app, mem } = await purchase({ approve: false });
    await mem.db.createOrder({
      id: "ord_orphan",
      intentMandateId: "i",
      intentMandateHash: "e".repeat(64),
      cartMandateHash: "f".repeat(64),
      customId: "poi:i:eeeeeeeeeeeeeeee",
      paypalIntent: "AUTHORIZE",
      status: "CAPTURED",
      totalValue: 7400,
      currency: "USD",
      agentPlatform: "Northstar",
      humanPresent: true,
    });
    const res = await proofOf(app, "ord_orphan");
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: "proof_unavailable" });
    expect(res.json().message).toMatch(
      /Intent Mandate and the signed Cart Mandate and the signed Payment Mandate/,
    );
  });

  test("when the cart was signed by a merchant key this server no longer holds, it says so", async () => {
    const { mem, orderId, make } = await purchase();
    const rotated = make("merchant-2");
    const res = await proofOf(rotated, orderId);
    expect(res.statusCode).toBe(409);
    expect(res.json().message).toContain("merchant-1");
    expect(mem.db).toBeDefined();
  });

  test("when a registered key has gone from the registry, it says which", async () => {
    const { app, mem, orderId } = await purchase();
    mem.keys.delete(agent.kid);
    const res = await proofOf(app, orderId);
    expect(res.statusCode).toBe(409);
    expect(res.json().message).toContain(`agent key ${agent.kid}`);
  });

  test("without a database or a merchant key it answers 503, not a half package", async () => {
    expect((await proofOf(buildApp({ paypal: createMockClient() }), "ord_1")).statusCode).toBe(503);
    const noMerchant = buildApp({ paypal: createMockClient(), db: memoryDb().db });
    const res = await proofOf(noMerchant, "ord_1");
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ error: "merchant_not_configured" });
  });

  test("it is merchant data: with an operator token set, it needs that token", async () => {
    const { app, orderId } = await purchase({ operatorToken: TOKEN });
    expect((await proofOf(app, orderId)).statusCode).toBe(401);
    expect((await proofOf(app, orderId, { authorization: "Bearer wrong" })).statusCode).toBe(401);
    const ok = await proofOf(app, orderId, { authorization: `Bearer ${TOKEN}` });
    expect(ok.statusCode).toBe(200);
    expect((await verifyProofPackage(ok.json())).ok).toBe(true);
  });

  test("the package never changes the order: reading it twice gives the same order and the same mandates", async () => {
    const { app, mem, orderId } = await purchase();
    const before = JSON.stringify(await mem.db.getOrder(orderId));
    const a = (await proofOf(app, orderId)).json();
    const b = (await proofOf(app, orderId)).json();
    expect(JSON.stringify(await mem.db.getOrder(orderId))).toBe(before);
    expect(a.mandates).toEqual(b.mandates);
    expect(a.references).toEqual(b.references);
  });
});

describe("a proof is honest about a purchase that did not follow the signed limits", () => {
  test("an order the rules would have refused at checkout shows the failed rules when its package is verified", async () => {
    // Checkout refuses this cart, so no order is created through the API. Build the order the way an old, pre-checkout order
    // would exist, from signed mandates the merchant did store, and check the proof says what is wrong with it.
    const mem = memoryDb();
    mem.keys.set(shopper.kid, {
      kind: "shopper",
      kid: shopper.kid,
      publicJwk: shopper.publicJwk,
      shopperId: "s",
    });
    mem.keys.set(agent.kid, {
      kind: "agent",
      kid: agent.kid,
      publicJwk: agent.publicJwk,
      platform: "Northstar",
    });
    const { intent, cart, payment, body } = await signedCheckout({ shopper, agent, cart: overreachingCart });
    const cartJws = await signMandate(cart, merchantKey.privateKey, "merchant-1");
    const intentHash = mandateHash(intent);
    const cartHash = mandateHash(cart);
    for (const [kind, hash, id, canonical, jws, kid] of [
      ["intent", intentHash, intent.mandate_id, JSON.stringify(intent), body.intent_jws, shopper.kid],
      ["cart", cartHash, cart.contents.cart_id, JSON.stringify(cart), cartJws, "merchant-1"],
      [
        "payment",
        mandateHash(payment),
        payment.payment_mandate_id,
        JSON.stringify(payment),
        body.payment_mandate_jws,
        agent.kid,
      ],
    ] as const) {
      await mem.db.saveMandate({ hash, kind, mandateId: id, canonical, jws, kid });
    }
    await mem.db.createOrder({
      id: "ord_old",
      intentMandateId: intent.mandate_id,
      intentMandateHash: intentHash,
      cartMandateHash: cartHash,
      customId: `poi:${intent.mandate_id}:${intentHash.slice(0, 16)}`,
      paypalIntent: "CAPTURE",
      status: "CAPTURED",
      totalValue: 9500,
      currency: "USD",
      agentPlatform: "Northstar",
      humanPresent: true,
    });
    const app = buildApp({
      paypal: createMockClient(),
      db: mem.db,
      merchant: { id: MERCHANT_ID, kid: "merchant-1", privateKey: merchantKey.privateKey },
    });
    const report = await verifyProofPackage((await proofOf(app, "ord_old")).json());
    const replay = report.checks.find((c) => c.id === "policy.replay")!;
    expect(replay.passed).toBe(false);
    expect(replay.detail).toContain("AMOUNT_EXCEEDS_MAX");
    // The signatures are all genuine: the proof shows the purchase was signed, and that it broke the signed limits.
    expect(report.checks.filter((c) => c.id.startsWith("sig.")).every((c) => c.passed)).toBe(true);
    expect(report.ok).toBe(false);
    expect(compliantCart).toBeDefined();
    expect(greyJacketIntent).toBeDefined();
  });
});

describe("pnpm proof:verify, run as the real command on a downloaded file", () => {
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const run = (file: string) =>
    spawnSync(join(root, "node_modules/.bin/tsx"), [join(root, "scripts/proof/verify.ts"), file], {
      cwd: root,
      encoding: "utf8",
    });
  const save = (name: string, value: unknown) => {
    const file = join(mkdtempSync(join(tmpdir(), "poi-proof-")), name);
    writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value, null, 2));
    return file;
  };

  test("a genuine package passes every check and exits 0, and says what a pass does not show", async () => {
    const { app, orderId } = await purchase();
    const out = run(save("proof.json", (await proofOf(app, orderId)).json()));
    expect(out.status).toBe(0);
    expect(out.stdout).toContain("All checks passed.");
    expect(out.stdout).not.toContain("FAIL");
    expect(out.stdout).toMatch(/PASS\s+The shopper signed the Intent Mandate/);
    expect(out.stdout).toContain("What this does not show:");
  }, 30_000);

  test("an edited package fails and exits 1, naming the check that caught it", async () => {
    const { app, orderId } = await purchase();
    const pkg = (await proofOf(app, orderId)).json();
    pkg.references.capture_id = "FORGEDCAPTURE0000";
    const out = run(save("forged.json", pkg));
    expect(out.status).toBe(1);
    expect(out.stdout).toMatch(/FAIL\s+The file is unchanged since it was sealed/);
    expect(out.stdout).toContain("check(s) failed.");
  }, 30_000);

  test("a file that is not JSON, a file that is not a proof package, and a missing file are reported, not crashed on", () => {
    expect(run(save("junk.json", "{ not json")).status).toBe(2);
    const notProof = run(save("other.json", { hello: "world" }));
    expect(notProof.status).toBe(1);
    expect(notProof.stdout).toMatch(/FAIL\s+The file is a proof package/);
    expect(run(join(tmpdir(), "poi-proof-does-not-exist.json")).status).toBe(2);
  }, 30_000);
});
