import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, test, vi } from "vitest";
import type { SemanticFit } from "@poi/ai";
import { compliantCart, greyJacketIntent, MERCHANT_ID, NOW } from "@poi/contracts/fixtures";
import { generateSigningKeyPair, mandateHash, signMandate } from "@poi/mandates";
import { createMockClient, createPayPalClient, PayPalError, type PayPalClient } from "@poi/paypal";
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

/** Spies on the three PayPal calls that move money or holds, to prove a refused approval never reaches them. */
const watch = (p: PayPalClient) => ({
  authorize: vi.spyOn(p, "authorizeOrder"),
  capture: vi.spyOn(p, "captureAuthorization"),
  void: vi.spyOn(p, "voidAuthorization"),
});
const expectUntouched = (w: ReturnType<typeof watch>) => {
  expect(w.authorize).not.toHaveBeenCalled();
  expect(w.capture).not.toHaveBeenCalled();
  expect(w.void).not.toHaveBeenCalled();
};
const refused = (reasons: string[]) => ({
  error: "approval_invalid",
  message: expect.any(String),
  reasons,
});

/** A human-present order created through POST /checkout, ready for the shopper to approve. */
async function orderedApp(
  opts: { paypal?: PayPalClient; now?: string; signed?: Partial<Parameters<typeof signedCheckout>[0]> } = {},
) {
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
  const { body, cart } = await signedCheckout({ shopper, agent, ...opts.signed });
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

  test("a countersignature over a different cart is refused, and PayPal is never contacted", async () => {
    const s = await orderedApp();
    const paypal = watch(s.paypal);
    const res = await s.approve(await s.approval(shopper, { cart_mandate_hash: "f".repeat(64) }));
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual(refused(["MANDATE_MISMATCH"]));
    expectUntouched(paypal);
    expect((await s.mem.db.getOrder(s.created.order_id))?.status).toBe("CREATED");
  });

  test("an approval naming another order is refused and changes nothing", async () => {
    const s = await orderedApp();
    const paypal = watch(s.paypal);
    const res = await s.approve(await s.approval(shopper, { order_id: "ord_other" }));
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual(refused(["MANDATE_MISMATCH"]));
    expectUntouched(paypal);
  });

  test("a genuine approval of one order can't be replayed to void another", async () => {
    const s = await orderedApp();
    // Its own intent: one default intent authorizes one purchase (#156).
    const second = await signedCheckout({
      shopper,
      agent,
      intent: { ...greyJacketIntent, mandate_id: randomUUID() },
    });
    const other = (await s.app.inject({ method: "POST", url: "/checkout", payload: second.body })).json();
    expect(other.order_id).toBeTruthy();
    const paypal = watch(s.paypal);
    // The shopper's real, valid approval of the first order, sent against the second.
    const res = await s.approve(await s.approval(), other.order_id);
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual(refused(["MANDATE_MISMATCH"]));
    expectUntouched(paypal);
    expect((await s.mem.db.getOrder(other.order_id))?.status).toBe("CREATED");
    // And the first order is still approvable.
    expect((await s.approve(await s.approval())).json().status).toBe("CAPTURED");
  });

  test("an invalid signature never reaches PayPal and doesn't use up the order", async () => {
    const s = await orderedApp();
    const paypal = watch(s.paypal);
    const real = await s.approval();
    const tampered = `${real.slice(0, -4)}AAAA`;
    for (const bad of ["aaa.bbb.ccc", tampered]) {
      const res = await s.approve(bad);
      expect(res.statusCode).toBe(403);
      expect(res.json()).toEqual(refused(["SIGNATURE_INVALID"]));
    }
    expectUntouched(paypal);
    expect((await s.mem.db.getOrder(s.created.order_id))?.status).toBe("CREATED");
    expect((await s.approve(real)).json().status).toBe("CAPTURED");
  });

  test("an expired cart is voided without calling PayPal: nothing was held", async () => {
    const s = await orderedApp();
    const paypal = watch(s.paypal);
    s.setClock("2026-11-02T10:15:00Z"); // cart_expiry in the fixture
    const res = await s.approve(await s.approval());
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "VOIDED", reasons: ["CART_EXPIRED"] });
    expectUntouched(paypal);
    expect((await s.mem.db.getOrder(s.created.order_id))?.status).toBe("VOIDED");
  });

  test("approval re-checks the reservation: if the intent's other holds no longer leave room, it is voided (#155)", async () => {
    const capped = {
      ...greyJacketIntent,
      constraints: { ...greyJacketIntent.constraints, budget_cap: { value: 10000, currency: "USD" } },
    };
    const s = await orderedApp({ signed: { intent: capped } });
    expect(s.created.verdict.outcome).toBe("APPROVE");
    const paypal = watch(s.paypal);
    // Something else under the same intent took 5000 of the cap after this order reserved its 7400.
    const order = (await s.mem.db.getOrder(s.created.order_id))!;
    s.mem.orders.set("ord_other", {
      ...order,
      id: "ord_other",
      status: "CAPTURED",
      totalValue: 5000,
      capturedAt: NOW,
    });
    const res = await s.approve(await s.approval());
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "VOIDED", reasons: ["BUDGET_EXCEEDED"] });
    expectUntouched(paypal);
    expect((await s.mem.db.getOrder(s.created.order_id))?.status).toBe("VOIDED");
  });

  test("approval of an order that still fits is captured, its own reservation not counted against it (#155)", async () => {
    const capped = {
      ...greyJacketIntent,
      constraints: { ...greyJacketIntent.constraints, budget_cap: { value: 7400, currency: "USD" } },
    };
    const s = await orderedApp({ signed: { intent: capped } });
    expect((await s.approve(await s.approval())).json().status).toBe("CAPTURED");
  });

  test("an approval that arrives too late voids a hold we already took (a capture had failed)", async () => {
    const mock = createMockClient();
    let fail = true;
    const paypal: PayPalClient = {
      ...mock,
      captureAuthorization: async (id) => {
        if (fail) throw new Error("ECONNRESET");
        return mock.captureAuthorization(id);
      },
    };
    const s = await orderedApp({ paypal });
    expect((await s.approve(await s.approval())).statusCode).toBe(502); // authorized, capture failed
    fail = false;
    const voided = vi.spyOn(paypal, "voidAuthorization");
    s.setClock("2026-11-02T10:15:00Z");
    const res = await s.approve(await s.approval());
    expect(res.json()).toEqual({ status: "VOIDED", reasons: ["CART_EXPIRED"] });
    expect(voided).toHaveBeenCalledTimes(1);
    expect((await s.mem.db.getOrder(s.created.order_id))?.status).toBe("VOIDED");
  });

  // The cart's expiry is the agent's choice, so a cart can outlive the shopper's own authority (#161).
  const longLived = () => ({
    intent: { ...greyJacketIntent, intent_expiry: "2026-11-02T10:30:00Z" },
    cart: { ...compliantCart, contents: { ...compliantCart.contents, cart_expiry: "2026-11-02T12:00:00Z" } },
  });

  test("an intent that expired after checkout stops the capture, even though the cart is still valid", async () => {
    const s = await orderedApp({ signed: longLived() });
    const paypal = watch(s.paypal);
    s.setClock("2026-11-02T11:00:00Z"); // intent expired 10:30; cart good until 12:00
    const res = await s.approve(await s.approval());
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "VOIDED", reasons: ["MANDATE_EXPIRED"] });
    expectUntouched(paypal);
    expect((await s.mem.db.getOrder(s.created.order_id))?.status).toBe("VOIDED");
  });

  test("with the intent and the cart both expired, both are reported", async () => {
    const s = await orderedApp({ signed: longLived() });
    s.setClock("2026-11-02T12:30:00Z");
    expect((await s.approve(await s.approval())).json()).toEqual({
      status: "VOIDED",
      reasons: ["MANDATE_EXPIRED", "CART_EXPIRED"],
    });
  });

  test("an intent that is still valid at approval time still captures", async () => {
    const s = await orderedApp({ signed: longLived() });
    s.setClock("2026-11-02T10:29:59Z");
    expect((await s.approve(await s.approval())).json().status).toBe("CAPTURED");
  });

  test("the intent expiring while we hold an authorization voids that hold (a capture had failed)", async () => {
    const mock = createMockClient();
    let fail = true;
    const paypal: PayPalClient = {
      ...mock,
      captureAuthorization: async (id) => {
        if (fail) throw new Error("ECONNRESET");
        return mock.captureAuthorization(id);
      },
    };
    const s = await orderedApp({ paypal, signed: longLived() });
    expect((await s.approve(await s.approval())).statusCode).toBe(502);
    fail = false;
    const voided = vi.spyOn(paypal, "voidAuthorization");
    s.setClock("2026-11-02T11:00:00Z");
    expect((await s.approve(await s.approval())).json()).toEqual({
      status: "VOIDED",
      reasons: ["MANDATE_EXPIRED"],
    });
    expect(voided).toHaveBeenCalledTimes(1);
  });

  test("a signing key retired before approval can't approve: the key's current standing counts", async () => {
    const s = await orderedApp();
    const paypal = watch(s.paypal);
    const key = s.mem.keys.get(shopper.kid)!;
    s.mem.keys.set(shopper.kid, { ...key, retiredAt: "2026-11-02T10:05:00Z" });
    s.setClock("2026-11-02T10:10:00Z");
    // The signer's own `approved_at` can't talk its way around it: the server's clock decides.
    const res = await s.approve(await s.approval(shopper, { approved_at: "2026-11-02T10:00:00Z" }));
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual(refused(["UNKNOWN_KEY"]));
    expectUntouched(paypal);
    // A retirement that hasn't happened yet doesn't matter.
    const s2 = await orderedApp();
    s2.mem.keys.set(shopper.kid, { ...s2.mem.keys.get(shopper.kid)!, retiredAt: "2026-11-02T10:12:00Z" });
    s2.setClock("2026-11-02T10:10:00Z");
    expect((await s2.approve(await s2.approval())).json().status).toBe("CAPTURED");
  });

  test("only the key that signed the intent can approve: anyone else is refused", async () => {
    const s = await orderedApp();
    const paypal = watch(s.paypal);
    const res = await s.approve(await s.approval(await party("someone-else")));
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual(refused(["UNKNOWN_KEY"]));
    // The agent's key is registered, but it isn't the shopper.
    const s2 = await orderedApp();
    const res2 = await s2.approve(await s2.approval(agent));
    expect(res2.statusCode).toBe(403);
    expect(res2.json()).toEqual(refused(["UNKNOWN_KEY"]));
    expectUntouched(paypal);
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

/**
 * The real sandbox adapter over a fake PayPal (#225's reproduction): recorded create-order and authorize answers, a capture
 * answer the test chooses, and a webhook check that passes. Counts the capture calls.
 */
function sandboxPayPal(capture: { id: string; status: string }) {
  const recorded = (name: string) =>
    JSON.parse(
      readFileSync(
        join(import.meta.dirname, "../../../packages/paypal/fixtures/sandbox", `${name}.json`),
        "utf8",
      ),
    ) as { status: number; body: unknown };
  let captures = 0;
  const fetchFn: typeof fetch = async (url) => {
    const path = new URL(String(url)).pathname;
    if (path === "/v1/oauth2/token") return Response.json({ access_token: "t", expires_in: 32400 });
    if (path.endsWith("/capture")) {
      captures++;
      return Response.json(capture, { status: 201 });
    }
    if (path.endsWith("/authorize")) {
      const r = recorded("create-order-authorized");
      return Response.json(r.body, { status: r.status });
    }
    if (path === "/v2/checkout/orders") {
      const r = recorded("create-order-created");
      return Response.json(r.body, { status: r.status });
    }
    if (path.endsWith("/verify-webhook-signature")) return Response.json({ verification_status: "SUCCESS" });
    return new Response("not routed", { status: 599 });
  };
  const paypal = createPayPalClient("sandbox", {
    clientId: "id",
    clientSecret: "s",
    webhookId: "WH",
    fetch: fetchFn,
  });
  return { paypal, captures: () => captures };
}

const captureEvent = (eventType: string, resource: Record<string, unknown>) => ({
  method: "POST" as const,
  url: "/webhooks/paypal",
  headers: {
    "content-type": "application/json",
    "paypal-transmission-id": `t-${randomUUID()}`,
    "paypal-transmission-time": NOW,
    "paypal-transmission-sig": "sig",
    "paypal-cert-url": "https://api.sandbox.paypal.com/cert",
    "paypal-auth-algo": "SHA256withRSA",
  },
  payload: JSON.stringify({ id: `WH-${randomUUID()}`, event_type: eventType, resource }),
});

describe("POST /checkout/:id/approve: only a COMPLETED capture is captured (#225)", () => {
  test("a PENDING capture is CAPTURE_PENDING, not CAPTURED, and still holds the intent's authority", async () => {
    const pp = sandboxPayPal({ id: "CAP-PENDING", status: "PENDING" });
    const s = await orderedApp({ paypal: pp.paypal });
    const res = await s.approve(await s.approval());
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "CAPTURE_PENDING", capture_id: "CAP-PENDING" });
    const order = await s.mem.db.getOrder(s.created.order_id);
    expect(order).toMatchObject({ status: "CAPTURE_PENDING", captureId: "CAP-PENDING" });
    expect(order?.capturedAt).toBeUndefined();
    expect(s.mem.audit.map((a) => a.action)).toContain("paypal.capture.pending");
    expect(s.mem.audit.map((a) => a.action)).not.toContain("paypal.capture");

    // Not captured, so not in the record of purchases; but the money may still move, so it keeps its hold.
    expect((await s.mem.db.mandateLedger(greyJacketIntent.mandate_id)).capturedTotal).toBe(0);
    expect((await s.mem.db.activeLedger(greyJacketIntent.mandate_id, NOW)).capturedTotal).toBe(7400);

    // A retry answers the same and doesn't capture again.
    expect((await s.approve(await s.approval())).json()).toEqual({
      status: "CAPTURE_PENDING",
      capture_id: "CAP-PENDING",
    });
    expect(pp.captures()).toBe(1);
  });

  test("PayPal's PAYMENT.CAPTURE.COMPLETED for that capture settles it, dated when PayPal made the capture", async () => {
    const pp = sandboxPayPal({ id: "CAP-PENDING", status: "PENDING" });
    const s = await orderedApp({ paypal: pp.paypal });
    await s.approve(await s.approval());
    const id = s.created.order_id as string;

    // An event for another capture changes nothing.
    await s.app.inject(captureEvent("PAYMENT.CAPTURE.COMPLETED", { id: "CAP-OTHER", invoice_id: id }));
    expect((await s.mem.db.getOrder(id))?.status).toBe("CAPTURE_PENDING");

    const madeAt = "2026-11-01T12:00:30.000Z";
    const res = await s.app.inject(
      captureEvent("PAYMENT.CAPTURE.COMPLETED", { id: "CAP-PENDING", invoice_id: id, create_time: madeAt }),
    );
    expect(res.statusCode).toBe(200);
    expect(await s.mem.db.getOrder(id)).toMatchObject({
      status: "CAPTURED",
      captureId: "CAP-PENDING",
      capturedAt: madeAt,
    });
    expect((await s.mem.db.mandateLedger(greyJacketIntent.mandate_id)).capturedTotal).toBe(7400);
    expect(s.mem.audit.map((a) => a.action)).toContain("order.outcome_confirmed");
    expect((await s.approve(await s.approval())).json()).toEqual({
      status: "CAPTURED",
      capture_id: "CAP-PENDING",
    });
  });

  test("PAYMENT.CAPTURE.DENIED for a pending capture releases it: nothing was taken", async () => {
    const pp = sandboxPayPal({ id: "CAP-PENDING", status: "PENDING" });
    const s = await orderedApp({ paypal: pp.paypal });
    await s.approve(await s.approval());
    const id = s.created.order_id as string;
    await s.app.inject(captureEvent("PAYMENT.CAPTURE.DENIED", { id: "CAP-PENDING", invoice_id: id }));
    const order = await s.mem.db.getOrder(id);
    expect(order?.status).toBe("CAPTURE_DECLINED");
    expect(order?.capturedAt).toBeUndefined();
    expect((await s.mem.db.activeLedger(greyJacketIntent.mandate_id, NOW)).capturedTotal).toBe(0);
    expect((await s.approve(await s.approval())).statusCode).toBe(402);
  });

  test("a DECLINED capture is 402 payment_declined, never captured, and frees the intent's authority", async () => {
    const pp = sandboxPayPal({ id: "CAP-DECLINED", status: "DECLINED" });
    const s = await orderedApp({ paypal: pp.paypal });
    const res = await s.approve(await s.approval());
    expect(res.statusCode).toBe(402);
    expect(res.json()).toMatchObject({ error: "payment_declined" });
    const order = await s.mem.db.getOrder(s.created.order_id);
    expect(order).toMatchObject({ status: "CAPTURE_DECLINED", captureId: "CAP-DECLINED" });
    expect(order?.capturedAt).toBeUndefined();
    expect((await s.mem.db.activeLedger(greyJacketIntent.mandate_id, NOW)).capturedTotal).toBe(0);
    expect((await s.approve(await s.approval())).statusCode).toBe(402); // a retry answers the same
    expect(pp.captures()).toBe(1);
  });
});
