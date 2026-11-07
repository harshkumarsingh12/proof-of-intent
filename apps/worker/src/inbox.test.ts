import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { CartMandate } from "@poi/contracts";
import { compliantCart, greyJacketIntent, NOW, overreachingCart } from "@poi/contracts/fixtures";
import { createDb, type Db } from "@poi/db";
import { canonicalJson, customId, generateSigningKeyPair, mandateHash, signMandate } from "@poi/mandates";
import { exportJWK } from "jose";
import { createMockClient, type PayPalDispute } from "@poi/paypal";
import { processDisputeEvents, syncDisputes } from "./inbox";

// Real Postgres, like packages/db: the inbox is a query, so a fake would test nothing. CI provides one.
const ADMIN_URL = process.env.DATABASE_URL;

describe.runIf(ADMIN_URL)("dispute inbox", () => {
  const name = `poi_inbox_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const url = new URL(ADMIN_URL ?? "postgres://localhost/unused");
  url.pathname = `/${name}`;
  let db: Db;
  let raw: pg.Pool;
  // Two orders under one intent, so the shopper signed permission for more than one purchase (#156).
  const intent = {
    ...greyJacketIntent,
    constraints: { ...greyJacketIntent.constraints, recurrence: { max_orders: 5, window_days: 30 } },
  };
  const intentHash = mandateHash(intent);
  const pointer = customId(intent.mandate_id, intentHash);
  const log: string[] = [];
  const deps = () => ({
    db,
    aiMode: "replay" as const,
    now: () => "2026-11-06T12:00:00.000Z",
    log: (m: string) => void log.push(m),
  });

  beforeAll(async () => {
    const admin = new pg.Client({ connectionString: ADMIN_URL });
    await admin.connect();
    await admin.query(`create database ${name}`);
    await admin.end();
    db = createDb(url.toString());
    raw = new pg.Pool({ connectionString: url.toString() });
    await db.migrate();

    const { privateKey, publicKey } = await generateSigningKeyPair();
    await raw.query("insert into shoppers (id) values ('shopper-1')");
    await raw.query(
      "insert into shopper_keys (kid, shopper_id, public_jwk) values ('shopper-key-1', 'shopper-1', $1)",
      [JSON.stringify(await exportJWK(publicKey))],
    );
    await db.saveMandate({
      hash: intentHash,
      kind: "intent",
      mandateId: intent.mandate_id,
      canonical: canonicalJson(intent),
      jws: await signMandate(intent, privateKey, "shopper-key-1"),
      kid: "shopper-key-1",
    });
    await capturedOrder("ord_compliant", compliantCart, "CAP-COMPLIANT");
    await capturedOrder("ord_overreach", overreachingCart, "CAP-OVERREACH");
  });

  afterAll(async () => {
    await db?.close();
    await raw?.end();
    const admin = new pg.Client({ connectionString: ADMIN_URL });
    await admin.connect();
    // pool.end() resolves before its sockets close; force-dropping under them makes Postgres kill those
    // connections, which pg reports as an unhandled error. Let them go first.
    for (let i = 0; i < 50; i++) {
      const left = await admin.query("select count(*)::int as n from pg_stat_activity where datname = $1", [
        name,
      ]);
      if (left.rows[0].n === 0) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    await admin.query(`drop database if exists ${name} with (force)`);
    await admin.end();
  });

  /** An order as checkout leaves it after capture. */
  async function capturedOrder(id: string, cartFixture: CartMandate, captureId: string) {
    const cart = { ...cartFixture, intent_mandate_hash: intentHash };
    const cartHash = mandateHash(cart);
    await db.saveMandate({
      hash: cartHash,
      kind: "cart",
      mandateId: cart.contents.cart_id,
      canonical: canonicalJson(cart),
      jws: "merchant-signed",
      kid: "merchant-1",
    });
    await db.createOrder({
      id,
      intentMandateId: intent.mandate_id,
      intentMandateHash: intentHash,
      cartMandateHash: cartHash,
      customId: pointer,
      paypalIntent: "AUTHORIZE",
      status: "PENDING",
      totalValue: cart.contents.total.value,
      currency: "USD",
      shopperId: "shopper-1",
      agentPlatform: "Northstar",
      humanPresent: true,
    });
    await db.recordVerdict({
      intentMandateId: intent.mandate_id,
      cartId: cart.contents.cart_id,
      orderId: id,
      outcome: "STEP_UP",
      reasons: ["SEMANTIC_UNCERTAIN"],
      semantic: { unavailable: true },
    });
    await db.updateOrder(id, { status: "CAPTURED", captureId, capturedAt: NOW });
  }

  /** A CUSTOMER.DISPUTE.* delivery shaped like the live sandbox one (PP-R-NSZ-10196423). */
  async function deliver(
    eventId: string,
    disputeId: string,
    orderId: string,
    extra: Record<string, unknown> = {},
  ) {
    await db.recordWebhookEvent({
      eventId,
      eventType: "CUSTOMER.DISPUTE.CREATED",
      resourceId: disputeId,
      payload: {
        id: eventId,
        event_type: "CUSTOMER.DISPUTE.CREATED",
        resource: {
          dispute_id: disputeId,
          create_time: "2026-11-05T10:00:00.000Z",
          update_time: "2026-11-05T10:00:00.000Z",
          status: "WAITING_FOR_SELLER_RESPONSE",
          reason: "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED",
          dispute_amount: { currency_code: "USD", value: "74.00" },
          seller_response_due_date: "2026-11-15T10:00:00.000Z",
          disputed_transactions: [
            {
              seller_transaction_id: "CAP",
              invoice_number: orderId,
              custom: pointer,
              items: [{ notes: "wrong colour" }],
            },
          ],
          ...extra,
        },
      },
    });
  }

  test("a compliant order gets MANDATE_COMPLIANT and an evidence package; the event leaves the inbox", async () => {
    await deliver("WH-1", "PP-D-COMPLIANT", "ord_compliant");
    expect(await processDisputeEvents(deps())).toBe(1);
    expect(log).toEqual([]);

    const d = (await db.getDispute("PP-D-COMPLIANT"))!;
    expect(d).toMatchObject({
      orderId: "ord_compliant",
      status: "WAITING_FOR_SELLER_RESPONSE",
      amountValue: 7400,
      currency: "USD",
      recommendation: {
        class: "MANDATE_COMPLIANT",
        action: "PROVIDE_EVIDENCE",
        mandateHash: intentHash,
        customId: pointer,
      },
    });
    expect(Buffer.from(d.evidencePdf!).subarray(0, 5).toString()).toBe("%PDF-");
    // Acceptance criterion 3 (spec 0005): the package carries the hash that is in custom_id.
    expect(pointer.endsWith(intentHash.slice(0, 16))).toBe(true);
    expect(d.evidenceBundle).toMatchObject({ mandate_hash: intentHash, custom_id: pointer });
    expect(await db.pendingDisputeEvents(10)).toEqual([]);
    const audit = await db.auditTrail("PP-D-COMPLIANT");
    expect(audit.map((a) => a.action)).toEqual(["dispute.classified"]);
  });

  test("an overreaching cart is AGENT_OVERREACH with accept recommended, and no defence package", async () => {
    await deliver("WH-2", "PP-D-OVERREACH", "ord_overreach", {
      dispute_amount: { currency_code: "USD", value: "95.00" },
    });
    await processDisputeEvents(deps());
    const d = (await db.getDispute("PP-D-OVERREACH"))!;
    expect(d.recommendation).toMatchObject({ class: "AGENT_OVERREACH", action: "ACCEPT_CLAIM" });
    expect((d.recommendation as { reasons: string[] }).reasons).toEqual(
      expect.arrayContaining(["AMOUNT_EXCEEDS_MAX"]),
    );
    expect(d.evidencePdf).toBeUndefined();
  });

  test("a dispute on an order we never saw takes the standard path", async () => {
    await deliver("WH-3", "PP-D-UNKNOWN", "ord_not_ours");
    await processDisputeEvents(deps());
    expect((await db.getDispute("PP-D-UNKNOWN"))!.recommendation).toMatchObject({
      class: "NO_MANDATE",
      action: "STANDARD_EVIDENCE",
    });
  });

  test("an older delivery arriving late doesn't roll the dispute back", async () => {
    await deliver("WH-4", "PP-D-COMPLIANT", "ord_compliant", {
      status: "OPEN",
      update_time: "2026-11-05T09:00:00.000Z",
    });
    expect(await processDisputeEvents(deps())).toBe(1);
    expect((await db.getDispute("PP-D-COMPLIANT"))!.status).toBe("WAITING_FOR_SELLER_RESPONSE");
  });

  /** The full PayPal object for a dispute on one of our orders, as get_dispute returns it. */
  const fullDispute = (id: string, orderId: string, update: string): PayPalDispute => ({
    dispute_id: id,
    create_time: "2026-11-06T08:00:00.000Z",
    update_time: update,
    status: "WAITING_FOR_SELLER_RESPONSE",
    reason: "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED",
    dispute_amount: { currency_code: "USD", value: "74.00" },
    seller_response_due_date: "2026-11-16T08:00:00.000Z",
    disputed_transactions: [{ invoice_number: orderId, custom: pointer }],
  });

  test("with PayPal available, a partial webhook is completed from get_dispute before classifying", async () => {
    const paypal = createMockClient();
    paypal.seedDispute(fullDispute("PP-D-PARTIAL", "ord_compliant", "2026-11-06T08:00:00.000Z"));
    await db.recordWebhookEvent({
      eventId: "WH-PARTIAL",
      eventType: "CUSTOMER.DISPUTE.UPDATED",
      payload: { resource: { dispute_id: "PP-D-PARTIAL" } }, // no transactions: alone it would be NO_MANDATE
    });
    expect(await processDisputeEvents({ ...deps(), paypal })).toBe(1);
    expect(await db.getDispute("PP-D-PARTIAL")).toMatchObject({
      orderId: "ord_compliant",
      sellerResponseDueDate: "2026-11-16T08:00:00.000Z",
      recommendation: { class: "MANDATE_COMPLIANT" },
    });
  });

  test("list_disputes catch-up handles disputes we never got a webhook for, and skips up-to-date ones", async () => {
    const paypal = createMockClient();
    paypal.seedDispute(fullDispute("PP-D-MISSED", "ord_overreach", "2026-11-06T09:00:00.000Z"));
    paypal.seedDispute(fullDispute("PP-D-PARTIAL", "ord_compliant", "2026-11-06T08:00:00.000Z")); // already held
    expect(await syncDisputes({ ...deps(), paypal })).toBe(1);
    expect((await db.getDispute("PP-D-MISSED"))!.recommendation).toMatchObject({ class: "AGENT_OVERREACH" });
    expect(await syncDisputes({ ...deps(), paypal })).toBe(0); // nothing changed since
    expect(await syncDisputes(deps())).toBe(0); // no PayPal client (mock without a reader): nothing to list
  });

  test("a malformed event stays in the inbox and is reported, never dropped", async () => {
    await db.recordWebhookEvent({
      eventId: "WH-BAD",
      eventType: "CUSTOMER.DISPUTE.UPDATED",
      payload: { resource: {} },
    });
    expect(await processDisputeEvents(deps())).toBe(0);
    expect(log.at(-1)).toContain("WH-BAD");
    expect((await db.pendingDisputeEvents(10)).map((e) => e.eventId)).toEqual(["WH-BAD"]);
  });
});
