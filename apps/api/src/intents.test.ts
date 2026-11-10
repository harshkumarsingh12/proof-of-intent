// Revoking a signed intent and reading what is left of it (docs/specs/0013, #176).
import { beforeAll, describe, expect, test, vi } from "vitest";
import type { SemanticFit } from "@poi/ai";
import { compliantCart, greyJacketIntent, MERCHANT_ID, NOW } from "@poi/contracts/fixtures";
import type { IntentMandate, IntentReceipt } from "@poi/contracts";
import { generateSigningKeyPair, keyIdFor, mandateHash, signMandate } from "@poi/mandates";
import type { JWK } from "jose";
import { createMockClient } from "@poi/paypal";
import { verifyProofPackage } from "@poi/proof";
import { buildApp } from "./app";
import { receiptFor } from "./intents";
import { memoryDb, party, signedCheckout, type Party } from "./test-helpers";

let shopper: Party;
let other: Party;
let agent: Party;
let merchantKey: Awaited<ReturnType<typeof generateSigningKeyPair>>;

/** Key ids are the key's own thumbprint, as in production; the proof verifier checks that. */
const thumbprinted = async (prefix: "shp" | "agt") => {
  const p = await party("tmp");
  return { ...p, kid: await keyIdFor(prefix, p.publicJwk as unknown as JWK) };
};

beforeAll(async () => {
  shopper = await thumbprinted("shp");
  other = await thumbprinted("shp");
  agent = await thumbprinted("agt");
  merchantKey = await generateSigningKeyPair();
});

const fit = (f: SemanticFit["fit"]) => async (): Promise<SemanticFit> => ({
  fit: f,
  confidence: f === "match" ? 0.95 : 0.7,
  reasons: [],
  matched_attributes: [],
  conflicting_attributes: [],
});

const later = (minutes: number) => new Date(Date.parse(NOW) + minutes * 60_000).toISOString();
const nth = (n: number) => ({
  ...compliantCart,
  contents: { ...compliantCart.contents, cart_id: `cart-${n}` },
});

function setup(opts: { semantic?: SemanticFit["fit"]; vaultId?: string } = {}) {
  const mem = memoryDb();
  for (const [p, id] of [
    [shopper, "shopper-1"],
    [other, "shopper-2"],
  ] as const) {
    mem.keys.set(p.kid, {
      kind: "shopper",
      kid: p.kid,
      publicJwk: p.publicJwk,
      shopperId: id,
      ...(opts.vaultId ? { vaultId: opts.vaultId } : {}),
    });
  }
  mem.keys.set(agent.kid, {
    kind: "agent",
    kid: agent.kid,
    publicJwk: agent.publicJwk,
    platform: "Northstar",
  });
  const paypal = createMockClient();
  const createOrder = vi.spyOn(paypal, "createOrder");
  const capture = vi.spyOn(paypal, "captureAuthorization");
  const clock = { now: NOW };
  const links: { url: string }[] = [];
  const app = buildApp({
    paypal,
    db: mem.db,
    merchant: { id: MERCHANT_ID, kid: "merchant-1", privateKey: merchantKey.privateKey },
    semanticFit: fit(opts.semantic ?? "match"),
    now: () => clock.now,
    stepUp: { linkBase: "https://shop.example", send: async (l) => void links.push(l) },
  });
  const checkout = async (o: Partial<Parameters<typeof signedCheckout>[0]> = {}) => {
    const signed = await signedCheckout({ shopper, agent, ...o });
    const res = await app.inject({ method: "POST", url: "/checkout", payload: signed.body });
    return { res, ...signed };
  };
  const revocation = (intent: IntentMandate = greyJacketIntent, signer: Party = shopper, over: object = {}) =>
    signMandate(
      {
        purpose: "intent.revoke",
        mandate_id: intent.mandate_id,
        intent_mandate_hash: mandateHash(intent),
        issued_at: clock.now,
        ...over,
      },
      signer.privateKey,
      signer.kid,
    );
  const revoke = async (jws: string, id = greyJacketIntent.mandate_id) =>
    app.inject({ method: "POST", url: `/intents/${id}/revoke`, payload: { revocation_jws: jws } });
  const receipt = async (intent: IntentMandate = greyJacketIntent, signer: Party = shopper) =>
    app.inject({
      method: "POST",
      url: `/intents/${intent.mandate_id}/receipt`,
      payload: {
        proof_jws: await signMandate(
          { purpose: "intent.receipt", intent_mandate_hash: mandateHash(intent), issued_at: clock.now },
          signer.privateKey,
          signer.kid,
        ),
      },
    });
  return { app, mem, createOrder, capture, clock, links, checkout, revocation, revoke, receipt };
}

describe("POST /intents/:id/revoke", () => {
  test("the intent's own key revokes it once; a repeat answers with the first time; the audit row holds what was verified", async () => {
    const s = setup();
    await s.checkout({ cart: nth(1) }); // the merchant has now seen the intent
    const jws = await s.revocation();
    const first = await s.revoke(jws);
    expect(first.statusCode).toBe(200);
    expect(first.json()).toEqual({ mandate_id: greyJacketIntent.mandate_id, revoked_at: NOW });

    s.clock.now = later(1);
    const again = await s.revoke(await s.revocation());
    expect(again.json()).toEqual({ mandate_id: greyJacketIntent.mandate_id, revoked_at: NOW });

    const rows = s.mem.audit.filter((a) => a.action === "intent.revoked");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.requestBody).toMatchObject({
      intentMandateHash: mandateHash(greyJacketIntent),
      jws,
      canonical: Buffer.from(jws.split(".")[1]!, "base64url").toString("utf8"),
    });
  });

  test("another key, another intent or hash, a stale signature, or an unknown intent changes nothing", async () => {
    const s = setup();
    await s.checkout({ cart: nth(1) });
    expect((await s.revoke(await s.revocation(greyJacketIntent, other))).json()).toMatchObject({
      error: "revocation_invalid",
      reasons: ["UNKNOWN_KEY"],
    });
    // Names this intent's id but another payload's hash: no such intent.
    const wrongHash = await s.revocation(greyJacketIntent, shopper, { intent_mandate_hash: "a".repeat(64) });
    expect((await s.revoke(wrongHash)).statusCode).toBe(404);
    // A genuine revocation of this intent sent to another intent's route.
    const elsewhere = await s.revoke(await s.revocation(), "0192f3a0-0000-7000-8000-0000000000ff");
    expect(elsewhere.json()).toMatchObject({ reasons: ["MANDATE_MISMATCH"] });
    const stale = await s.revocation(greyJacketIntent, shopper, { issued_at: "2026-11-01T11:00:00.000Z" });
    expect((await s.revoke(stale)).json().error).toBe("proof_expired");
    expect((await s.revoke("not.a.jws")).statusCode).toBe(403);

    expect(s.mem.audit.some((a) => a.action === "intent.revoked")).toBe(false);
    expect((await s.mem.db.getMandate(mandateHash(greyJacketIntent)))?.revokedAt).toBeUndefined();

    // Never seen by the merchant: nothing to revoke.
    const unseen = { ...greyJacketIntent, mandate_id: "0192f3a0-0000-7000-8000-0000000000aa" };
    expect((await s.revoke(await s.revocation(unseen), unseen.mandate_id)).statusCode).toBe(404);
  });

  test("a retired key can still revoke an intent it signed", async () => {
    const s = setup();
    await s.checkout({ cart: nth(1) });
    await s.mem.db.retireKey("shopper", shopper.kid, NOW);
    s.clock.now = later(1);
    expect((await s.revoke(await s.revocation())).statusCode).toBe(200);
  });
});

describe("a revoked intent authorizes nothing new (#176)", () => {
  test("checkout refuses it with MANDATE_REVOKED and creates no PayPal order", async () => {
    const s = setup();
    const before = await s.checkout({ cart: overreaching() });
    expect(before.res.json().verdict.outcome).toBe("REJECT"); // seen, nothing bought
    await s.revoke(await s.revocation());
    const after = await s.checkout({ cart: nth(2) });
    expect(after.res.json().verdict).toEqual({ outcome: "REJECT", reasons: ["MANDATE_REVOKED"] });
    expect(s.createOrder).not.toHaveBeenCalled();
  });

  test("an order waiting for the shopper's approval is voided at approval, not captured", async () => {
    const s = setup();
    const { res, cart } = await s.checkout({ cart: nth(1) });
    const orderId = res.json().order_id as string;
    await s.revoke(await s.revocation());
    const approval = await signMandate(
      { order_id: orderId, cart_mandate_hash: mandateHash(cart), approved_at: NOW },
      shopper.privateKey,
      shopper.kid,
    );
    const approved = await s.app.inject({
      method: "POST",
      url: `/checkout/${orderId}/approve`,
      payload: { approval_jws: approval },
    });
    expect(approved.json()).toEqual({ status: "VOIDED", reasons: ["MANDATE_REVOKED"] });
    expect(s.capture).not.toHaveBeenCalled();
  });

  test("a held cart is no longer listed, and approving it is refused with nothing charged", async () => {
    const s = setup({ semantic: "partial", vaultId: "VAULT-1" });
    const { res } = await s.checkout({ cart: nth(1), humanPresent: false });
    expect(res.json().verdict.outcome).toBe("STEP_UP");
    const pending = async () =>
      (
        await s.app.inject({
          method: "POST",
          url: "/stepups/pending",
          payload: {
            proof_jws: await signMandate(
              { purpose: "stepup.list", issued_at: s.clock.now },
              shopper.privateKey,
              shopper.kid,
            ),
          },
        })
      ).json().stepups as { stepup_id: string; cart_mandate_hash: string }[];
    const [held] = await pending();
    expect(held).toBeDefined();

    // The intent carried the shopper's permission to pay alone, so revoke that exact intent.
    const intent = {
      ...greyJacketIntent,
      constraints: { ...greyJacketIntent.constraints, unattended_payment: {} },
    };
    expect((await s.revoke(await s.revocation(intent))).statusCode).toBe(200);
    expect(await pending()).toEqual([]);

    const approval = await signMandate(
      { order_id: held!.stepup_id, cart_mandate_hash: held!.cart_mandate_hash, approved_at: NOW },
      shopper.privateKey,
      shopper.kid,
    );
    const approved = await s.app.inject({
      method: "POST",
      url: `/stepups/${held!.stepup_id}/approve`,
      payload: { approval_jws: approval },
    });
    expect(approved.statusCode).toBe(409);
    expect(approved.json()).toMatchObject({ error: "stepup_no_longer_valid", reasons: ["MANDATE_REVOKED"] });
    expect(s.createOrder).not.toHaveBeenCalled();
  });

  test("a revocation that lands after the early check still stops the order: the reservation refuses it", async () => {
    const s = setup();
    const { body } = await signedCheckout({ shopper, agent, cart: nth(1) });
    // The merchant has seen the intent; revoke it in the gap between the hard rules and the reservation.
    await s.checkout({ cart: overreaching() });
    const reserve = s.mem.db.reserveOrder;
    s.mem.db.reserveOrder = async (o, now, check) => {
      await s.mem.db.revokeIntent(o.intentMandateHash, now);
      return reserve(o, now, check);
    };
    const res = await s.app.inject({ method: "POST", url: "/checkout", payload: body });
    expect(res.json().verdict).toEqual({ outcome: "REJECT", reasons: ["MANDATE_REVOKED"] });
    expect(s.createOrder).not.toHaveBeenCalled();
  });

  test("a purchase captured before the revocation is unaffected, and its proof package still verifies", async () => {
    const s = setup({ vaultId: "VAULT-1" });
    const { res } = await s.checkout({ cart: nth(1), humanPresent: false });
    expect(res.json().capture_status).toBe("COMPLETED");
    const intent = {
      ...greyJacketIntent,
      constraints: { ...greyJacketIntent.constraints, unattended_payment: {} },
    };
    s.clock.now = later(1);
    await s.revoke(await s.revocation(intent));
    const order = await s.mem.db.getOrder(res.json().order_id);
    expect(order).toMatchObject({ status: "COMPLETED", capturedAt: NOW });
    const proof = await s.app.inject(`/orders/${res.json().order_id}/proof`);
    expect(proof.statusCode).toBe(200);
    const report = await verifyProofPackage(proof.json());
    expect(report.checks.filter((c) => !c.passed)).toEqual([]);
  });
});

describe("POST /intents/:id/receipt", () => {
  test("shows what the merchant's records say is spent, held and left, and only to the intent's own key", async () => {
    const s = setup({ vaultId: "VAULT-1" });
    // Nothing yet: the merchant has never seen it.
    expect((await s.receipt()).statusCode).toBe(404);

    // One human-present order waiting for approval: held, and the one purchase is set aside.
    await s.checkout({ cart: nth(1) });
    const held = (await s.receipt()).json() as IntentReceipt;
    expect(held).toMatchObject({
      state: "USED_UP",
      spent: { value: 0, currency: "USD" },
      held: { value: 7400, currency: "USD" },
      remaining: { purchases: 0, total: null },
      purchases: [{ status: "CREATED", total: { value: 7400, currency: "USD" } }],
    });

    expect((await s.receipt(greyJacketIntent, other)).statusCode).toBe(404); // another shopper learns nothing
  });

  test("a revoked intent has nothing left", async () => {
    const s = setup();
    await s.checkout({ cart: overreaching() });
    const before = (await s.receipt()).json() as IntentReceipt;
    expect(before).toMatchObject({
      state: "ACTIVE",
      remaining: { purchases: 1, per_purchase: { value: 8000 } },
    });
    await s.revoke(await s.revocation());
    expect((await s.receipt()).json()).toMatchObject({
      state: "REVOKED",
      revoked_at: NOW,
      remaining: { purchases: 0, per_purchase: { value: 0 } },
    });
  });
});

describe("receiptFor: the remaining authority, by the rules checkout enforces", () => {
  const ledger = (capturedTotal: number, times: string[] = []) => ({
    capturedTotal,
    capturedOrderTimes: times,
  });
  const base = { hash: "a".repeat(64), now: NOW, orders: [] };
  const withConstraints = (c: Partial<IntentMandate["constraints"]>): IntentMandate => ({
    ...greyJacketIntent,
    constraints: { ...greyJacketIntent.constraints, ...c },
  });

  test("a budget: what is left of it, and the next purchase is capped by both limits", () => {
    const intent = withConstraints({ budget_cap: { value: 20000, currency: "USD" } });
    const r = receiptFor({ ...base, intent, spent: ledger(7400, [NOW]), active: ledger(15000, [NOW, NOW]) });
    expect(r).toMatchObject({
      state: "ACTIVE",
      spent: { value: 7400 },
      held: { value: 7600 },
      remaining: { total: { value: 5000 }, per_purchase: { value: 5000 }, purchases: null },
    });
  });

  test("an order count counts only the window ending now", () => {
    const intent = withConstraints({ recurrence: { max_orders: 2, window_days: 7 } });
    const old = "2026-10-20T12:00:00.000Z";
    const r = receiptFor({
      ...base,
      intent,
      spent: ledger(14800, [old, NOW]),
      active: ledger(14800, [old, NOW]),
    });
    expect(r.remaining.purchases).toBe(1);
    expect(r.state).toBe("ACTIVE");
  });

  test("expired and used-up intents have nothing left", () => {
    const expired = receiptFor({
      ...base,
      intent: greyJacketIntent,
      now: greyJacketIntent.intent_expiry,
      spent: ledger(0),
      active: ledger(0),
    });
    expect(expired).toMatchObject({
      state: "EXPIRED",
      remaining: { purchases: 0, per_purchase: { value: 0 } },
    });
    const used = receiptFor({
      ...base,
      intent: greyJacketIntent,
      spent: ledger(7400, [NOW]),
      active: ledger(7400, [NOW]),
    });
    expect(used).toMatchObject({ state: "USED_UP", remaining: { purchases: 0 } });
  });
});

/** The red $95 jacket: refused, so the merchant sees the intent without anything being bought. */
function overreaching() {
  return {
    ...compliantCart,
    contents: {
      ...compliantCart.contents,
      cart_id: "cart-red",
      lines: [
        {
          ...compliantCart.contents.lines[0]!,
          attributes: { ...compliantCart.contents.lines[0]!.attributes, color: "red" },
          unit_price: { value: 9500, currency: "USD" },
        },
      ],
      total: { value: 9500, currency: "USD" },
    },
  };
}
