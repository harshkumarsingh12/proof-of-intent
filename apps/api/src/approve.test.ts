import { beforeAll, describe, expect, test, vi } from "vitest";
import type { SemanticFit } from "@poi/ai";
import { MERCHANT_ID, NOW } from "@poi/contracts/fixtures";
import { generateSigningKeyPair, mandateHash, signMandate } from "@poi/mandates";
import { createMockClient, PayPalError, type PayPalClient } from "@poi/paypal";
import { buildApp } from "./app";
import { memoryDb, party, signedCheckout, type Party } from "./test-helpers";

let shopper: Party;
let agent: Party;
let merchantKey: Awaited<ReturnType<typeof generateSigningKeyPair>>;

beforeAll(async () => {
  shopper = await party("shopper-key-1");
  agent = await party("agent-key-1");
  merchantKey = await generateSigningKeyPair();
});

const match = async (): Promise<SemanticFit> => ({
  fit: "match",
  confidence: 0.95,
  reasons: [],
  matched_attributes: [],
  conflicting_attributes: [],
});

/** A human-present order created through POST /checkout, ready for the shopper to approve. */
async function orderedApp(opts: { paypal?: PayPalClient; now?: string } = {}) {
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
  const paypal = opts.paypal ?? createMockClient();
  let clock = NOW;
  const app = buildApp({
    paypal,
    db: mem.db,
    merchant: { id: MERCHANT_ID, kid: "merchant-1", privateKey: merchantKey.privateKey },
    semanticFit: match,
    now: () => clock,
  });
  const { body, cart } = await signedCheckout({ shopper, agent });
  const created = (await app.inject({ method: "POST", url: "/checkout", payload: body })).json();
  const approval = (signer: Party = shopper, override: Record<string, unknown> = {}) =>
    signMandate(
      { order_id: created.order_id, cart_mandate_hash: mandateHash(cart), approved_at: NOW, ...override },
      signer.privateKey,
      signer.kid,
    );
  const approve = async (jws: string, id = created.order_id) =>
    app.inject({ method: "POST", url: `/checkout/${id}/approve`, payload: { approval_jws: jws } });
  return { app, mem, paypal, created, approval, approve, setClock: (t: string) => (clock = t) };
}

describe("POST /checkout/:id/approve", () => {
  test("an approved, unchanged, unexpired cart is authorized and captured", async () => {
    const s = await orderedApp();
    const capture = vi.spyOn(s.paypal, "captureAuthorization");
    const res = await s.approve(await s.approval());

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "CAPTURED", capture_id: expect.stringMatching(/^[0-9A-Z]{17}$/) });
    expect(capture).toHaveBeenCalledTimes(1);
    expect(await s.mem.db.getOrder(s.created.order_id)).toMatchObject({
      status: "CAPTURED",
      authorizationId: expect.any(String),
      captureId: res.json().capture_id,
      capturedAt: NOW,
    });
    expect(s.mem.audit.map((a) => a.action)).toEqual([
      "checkout.verdict",
      "paypal.create_order",
      "paypal.authorize",
      "paypal.capture",
    ]);
    // The capture now counts toward the intent's budget and recurrence ledger.
    expect((await s.mem.db.mandateLedger("0192f3a0-0000-7000-8000-000000000001")).capturedTotal).toBe(7400);
  });

  test("a countersignature over a different cart voids the authorization", async () => {
    const s = await orderedApp();
    const voided = vi.spyOn(s.paypal, "voidAuthorization");
    const res = await s.approve(await s.approval(shopper, { cart_mandate_hash: "f".repeat(64) }));
    expect(res.json()).toEqual({ status: "VOIDED", reasons: ["MANDATE_MISMATCH"] });
    expect(voided).toHaveBeenCalledTimes(1);
    expect((await s.mem.db.getOrder(s.created.order_id))?.status).toBe("VOIDED");
  });

  test("an approval naming another order voids", async () => {
    const s = await orderedApp();
    const res = await s.approve(await s.approval(shopper, { order_id: "ord_other" }));
    expect(res.json()).toEqual({ status: "VOIDED", reasons: ["MANDATE_MISMATCH"] });
  });

  test("an expired cart voids", async () => {
    const s = await orderedApp();
    s.setClock("2026-11-02T10:15:00Z"); // cart_expiry in the fixture
    const res = await s.approve(await s.approval());
    expect(res.json()).toEqual({ status: "VOIDED", reasons: ["CART_EXPIRED"] });
  });

  test("only the key that signed the intent can approve: anyone else voids", async () => {
    const s = await orderedApp();
    const res = await s.approve(await s.approval(await party("someone-else")));
    expect(res.json()).toEqual({ status: "VOIDED", reasons: ["UNKNOWN_KEY"] });
    // The agent's key is registered, but it isn't the shopper.
    const s2 = await orderedApp();
    expect((await s2.approve(await s2.approval(agent))).json()).toEqual({
      status: "VOIDED",
      reasons: ["UNKNOWN_KEY"],
    });
  });

  test("a retry after capture returns the same capture and charges nothing twice", async () => {
    const s = await orderedApp();
    const capture = vi.spyOn(s.paypal, "captureAuthorization");
    const first = (await s.approve(await s.approval())).json();
    const second = await s.approve(await s.approval());
    expect(second.statusCode).toBe(200);
    expect(second.json()).toEqual(first);
    expect(capture).toHaveBeenCalledTimes(1);
  });

  test("before the shopper approves on PayPal it's a 409 and nothing changes", async () => {
    const paypal: PayPalClient = {
      ...createMockClient(),
      authorizeOrder: async () => {
        throw new PayPalError(422, "ORDER_NOT_APPROVED", "dbg", "PayPal 422 ORDER_NOT_APPROVED");
      },
    };
    const s = await orderedApp({ paypal });
    const res = await s.approve(await s.approval());
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("shopper_has_not_approved");
    expect((await s.mem.db.getOrder(s.created.order_id))?.status).toBe("CREATED");
  });

  test("if capture fails, the order stays AUTHORIZED and a retry finishes the job", async () => {
    const mock = createMockClient();
    let fail = true;
    const paypal: PayPalClient = {
      ...mock,
      createOrder: mock.createOrder,
      authorizeOrder: mock.authorizeOrder,
      captureAuthorization: async (id) => {
        if (fail) throw new Error("ECONNRESET");
        return mock.captureAuthorization(id);
      },
    };
    const s = await orderedApp({ paypal });
    const firstTry = await s.approve(await s.approval());
    expect(firstTry.statusCode).toBe(502);
    expect((await s.mem.db.getOrder(s.created.order_id))?.status).toBe("AUTHORIZED");
    fail = false;
    expect((await s.approve(await s.approval())).json().status).toBe("CAPTURED");
  });

  test("unknown order 404; malformed body 400; agent-alone orders aren't approved here", async () => {
    const s = await orderedApp();
    expect((await s.approve(await s.approval(), "ord_missing")).statusCode).toBe(404);
    expect(
      (await s.app.inject({ method: "POST", url: `/checkout/${s.created.order_id}/approve`, payload: {} }))
        .statusCode,
    ).toBe(400);
    await s.mem.db.updateOrder(s.created.order_id, { status: "CREATED" });
    const order = (await s.mem.db.getOrder(s.created.order_id))!;
    s.mem.orders.set(order.id, { ...order, humanPresent: false, paypalIntent: "CAPTURE" });
    expect((await s.approve(await s.approval())).json().error).toBe("not_a_human_present_order");
  });
});
