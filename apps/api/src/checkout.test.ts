import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, test, vi } from "vitest";
import type { SemanticFit } from "@poi/ai";
import { NotImplementedError } from "@poi/contracts";
import {
  compliantCart,
  greyJacketIntent,
  MERCHANT_ID,
  NOW,
  overreachingCart,
  partialCart,
} from "@poi/contracts/fixtures";
import { createDb } from "@poi/db";
import { customId, generateSigningKeyPair, mandateHash, verifyMandate } from "@poi/mandates";
import { createMockClient, PayPalError, type PayPalClient } from "@poi/paypal";
import pg from "pg";
import { buildApp, type AppDeps } from "./app";
import { memoryDb, party, signedCheckout, type Party } from "./test-helpers";

let shopper: Party;
let agent: Party;
let merchantKey: Awaited<ReturnType<typeof generateSigningKeyPair>>;

beforeAll(async () => {
  shopper = await party("shopper-key-1");
  agent = await party("agent-key-1");
  merchantKey = await generateSigningKeyPair();
});

const j1 = (fit: SemanticFit["fit"], confidence: number) => async (): Promise<SemanticFit> => ({
  fit,
  confidence,
  reasons: [],
  matched_attributes: [],
  conflicting_attributes: [],
});
const j1Unbuilt = async (): Promise<SemanticFit> => {
  throw new NotImplementedError("J1 semanticFit", "sumedhag28", "docs/specs/0006-ai-jobs.md");
};

function setup(overrides: Partial<AppDeps> & { vaultId?: string; retiredAt?: string } = {}) {
  const mem = memoryDb();
  mem.keys.set(shopper.kid, {
    kind: "shopper",
    kid: shopper.kid,
    publicJwk: shopper.publicJwk,
    shopperId: "shopper-1",
    ...(overrides.vaultId ? { vaultId: overrides.vaultId } : {}),
    ...(overrides.retiredAt ? { retiredAt: overrides.retiredAt } : {}),
  });
  mem.keys.set(agent.kid, {
    kind: "agent",
    kid: agent.kid,
    publicJwk: agent.publicJwk,
    platform: "Northstar",
  });
  const paypal = overrides.paypal ?? createMockClient();
  const createOrder = vi.spyOn(paypal, "createOrder");
  const semanticFit = vi.fn(overrides.semanticFit ?? j1("match", 0.95));
  const app = buildApp({
    paypal,
    db: mem.db,
    merchant: { id: MERCHANT_ID, kid: "merchant-1", privateKey: merchantKey.privateKey },
    semanticFit,
    now: () => NOW,
  });
  const checkout = (body: unknown) =>
    app.inject({ method: "POST", url: "/checkout", payload: body as object });
  return { app, mem, createOrder, semanticFit, checkout };
}

describe("POST /checkout: decisions", () => {
  test("POST /checkout rejects the red $95 jacket before any PayPal order exists", async () => {
    const s = setup();
    const { body } = await signedCheckout({ shopper, agent, cart: overreachingCart });
    const res = await s.checkout(body);

    expect(res.statusCode).toBe(200);
    expect(res.json().verdict).toEqual({
      outcome: "REJECT",
      reasons: ["AMOUNT_EXCEEDS_MAX", "ATTRIBUTE_MISMATCH"],
    });
    expect(res.json().paypal_order_id).toBeUndefined();
    expect(res.json().cart_mandate_jws).toBeUndefined();
    expect(s.createOrder).not.toHaveBeenCalled();
    expect(s.mem.orders.size).toBe(0);
    expect(s.mem.verdicts).toMatchObject([
      { outcome: "REJECT", reasons: ["AMOUNT_EXCEEDS_MAX", "ATTRIBUTE_MISMATCH"], cartId: "cart-overreach" },
    ]);
  });

  test("a compliant cart is approved: signed Cart Mandate, AUTHORIZE order with the mandate pointer", async () => {
    const s = setup();
    const { body, intent, cart } = await signedCheckout({ shopper, agent });
    const res = await s.checkout(body);
    const json = res.json();

    expect(res.statusCode).toBe(200);
    expect(json.verdict).toEqual({ outcome: "APPROVE", reasons: [] });
    expect(json.order_id).toMatch(/^ord_/);
    expect(json.approval_url).toContain(json.paypal_order_id);

    const pointer = customId(intent.mandate_id, mandateHash(intent));
    expect(s.createOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        intent: "AUTHORIZE",
        ourOrderId: json.order_id,
        customId: pointer,
        vaultId: undefined,
      }),
    );
    // The Cart Mandate is the merchant's signature over exactly the cart that was checked.
    const signed = await verifyMandate(json.cart_mandate_jws, async (kid) =>
      kid === "merchant-1" ? merchantKey.publicKey : undefined,
    );
    expect(signed.ok && signed.payload).toEqual(cart);

    expect(s.mem.orders.get(json.order_id)).toMatchObject({
      customId: pointer,
      paypalIntent: "AUTHORIZE",
      paypalOrderId: json.paypal_order_id,
      status: "CREATED",
      totalValue: 7400,
      agentPlatform: "Northstar",
      shopperId: "shopper-1",
      humanPresent: true,
    });
    expect([...s.mem.mandates.values()].map((m) => m.kind).sort()).toEqual(["cart", "intent", "payment"]);
    expect(s.mem.audit.map((a) => a.action)).toEqual(["checkout.verdict", "paypal.create_order"]);
  });

  test("J1 can only lower the outcome", async () => {
    const cases: [ReturnType<typeof j1>, string, string[]][] = [
      [j1("match", 0.95), "APPROVE", []],
      [j1("match", 0.6), "STEP_UP", ["SEMANTIC_UNCERTAIN"]],
      [j1("partial", 0.9), "STEP_UP", ["SEMANTIC_UNCERTAIN"]],
      [j1("match", 0.3), "REJECT", ["SEMANTIC_MISMATCH"]],
      [j1("mismatch", 0.99), "REJECT", ["SEMANTIC_MISMATCH"]],
    ];
    for (const [fit, outcome, reasons] of cases) {
      const s = setup({ semanticFit: fit });
      const res = await s.checkout((await signedCheckout({ shopper, agent, cart: partialCart })).body);
      expect(res.json().verdict).toEqual({ outcome, reasons });
      expect(s.createOrder).toHaveBeenCalledTimes(outcome === "REJECT" ? 0 : 1);
    }
  });

  test("J1 never runs when a hard rule failed, so it can't rescue a rejected cart", async () => {
    const s = setup({ semanticFit: j1("match", 1) });
    await s.checkout((await signedCheckout({ shopper, agent, cart: overreachingCart })).body);
    expect(s.semanticFit).not.toHaveBeenCalled();
  });

  test("while J1 is unbuilt, a passing cart steps up to the shopper instead of auto-approving", async () => {
    const s = setup({ semanticFit: j1Unbuilt });
    const res = await s.checkout((await signedCheckout({ shopper, agent })).body);
    expect(res.json().verdict).toEqual({ outcome: "STEP_UP", reasons: ["SEMANTIC_UNCERTAIN"] });
    expect(res.json().approval_url).toBeTruthy(); // human present: warnings shown before the PayPal button
  });

  test("user_cart_confirmation_required always steps up", async () => {
    const s = setup();
    const intent = { ...greyJacketIntent, user_cart_confirmation_required: true };
    const res = await s.checkout((await signedCheckout({ shopper, agent, intent })).body);
    expect(res.json().verdict.outcome).toBe("STEP_UP");
  });

  test("journey B: the agent's retry under the same intent goes through after a rejection", async () => {
    const s = setup();
    const red = await s.checkout((await signedCheckout({ shopper, agent, cart: overreachingCart })).body);
    const grey = await s.checkout((await signedCheckout({ shopper, agent, cart: compliantCart })).body);
    expect(red.json().verdict.outcome).toBe("REJECT");
    expect(grey.json().verdict.outcome).toBe("APPROVE");
    expect(s.createOrder).toHaveBeenCalledTimes(1);
  });
});

describe("POST /checkout: verification", () => {
  test("a replayed Payment Mandate is rejected with NONCE_REPLAYED and creates nothing", async () => {
    const s = setup();
    const { body } = await signedCheckout({ shopper, agent });
    expect((await s.checkout(body)).json().verdict.outcome).toBe("APPROVE");
    const again = await s.checkout(body);
    expect(again.json().verdict).toEqual({ outcome: "REJECT", reasons: ["NONCE_REPLAYED"] });
    expect(s.createOrder).toHaveBeenCalledTimes(1);
  });

  test("unknown keys and tampered signatures are rejected before anything is stored", async () => {
    const s = setup();
    const stranger = await party("stranger-key");
    const unknown = await s.checkout((await signedCheckout({ shopper: stranger, agent })).body);
    expect(unknown.json().verdict).toEqual({ outcome: "REJECT", reasons: ["UNKNOWN_KEY"] });

    const { body } = await signedCheckout({ shopper, agent });
    const [h, , sig] = body.intent_jws.split(".");
    const forged = Buffer.from(
      JSON.stringify({
        ...greyJacketIntent,
        constraints: { ...greyJacketIntent.constraints, amount_max: { value: 999999, currency: "USD" } },
      }),
    ).toString("base64url");
    const tampered = await s.checkout({ ...body, intent_jws: `${h}.${forged}.${sig}` });
    expect(tampered.json().verdict).toEqual({ outcome: "REJECT", reasons: ["SIGNATURE_INVALID"] });

    const rogueAgent = await s.checkout(
      (await signedCheckout({ shopper, agent: await party("agent-key-1") })).body,
    );
    expect(rogueAgent.json().verdict).toEqual({ outcome: "REJECT", reasons: ["SIGNATURE_INVALID"] });

    expect(s.mem.mandates.size).toBe(0);
    expect(s.mem.nonces.size).toBe(0);
    expect(s.createOrder).not.toHaveBeenCalled();
  });

  test("a cart swapped after the agent signed is MANDATE_MISMATCH", async () => {
    const s = setup();
    const { body } = await signedCheckout({ shopper, agent, cart: compliantCart });
    const swapped = {
      ...body.cart,
      contents: { ...body.cart.contents, lines: [{ ...body.cart.contents.lines[0]!, sku: "JKT-GRY-L" }] },
    };
    const res = await s.checkout({ ...body, cart: swapped });
    expect(res.json().verdict).toEqual({ outcome: "REJECT", reasons: ["MANDATE_MISMATCH"] });
  });

  test("a cart for another merchant, or a platform the agent key isn't registered to, is MANDATE_MISMATCH", async () => {
    const s = setup();
    const elsewhere = {
      ...compliantCart,
      contents: { ...compliantCart.contents, merchant_id: "someone-else" },
    };
    expect(
      (await s.checkout((await signedCheckout({ shopper, agent, cart: elsewhere })).body)).json().verdict
        .reasons,
    ).toEqual(["MANDATE_MISMATCH"]);
    expect(
      (await s.checkout((await signedCheckout({ shopper, agent, platform: "Wayfinder" })).body)).json()
        .verdict.reasons,
    ).toEqual(["MANDATE_MISMATCH"]);
  });

  test("malformed mandates and carts whose total doesn't add up are SCHEMA_INVALID", async () => {
    const s = setup();
    const badTotal = {
      ...compliantCart,
      contents: { ...compliantCart.contents, total: { value: 100, currency: "USD" } },
    };
    expect(
      (await s.checkout((await signedCheckout({ shopper, agent, cart: badTotal })).body)).json().verdict
        .reasons,
    ).toEqual(["SCHEMA_INVALID"]);
    const { body } = await signedCheckout({ shopper, agent });
    expect((await s.checkout({ ...body, cart: { not: "a cart" } })).json().verdict.reasons).toEqual([
      "SCHEMA_INVALID",
    ]);
  });

  test("a retired shopper key verifies older intents and rejects newer ones", async () => {
    const before = setup({ retiredAt: "2026-11-01T10:00:00Z" }); // intent created 09:00
    expect(
      (await before.checkout((await signedCheckout({ shopper, agent })).body)).json().verdict.outcome,
    ).toBe("APPROVE");
    const after = setup({ retiredAt: "2026-11-01T08:00:00Z" });
    expect((await after.checkout((await signedCheckout({ shopper, agent })).body)).json().verdict).toEqual({
      outcome: "REJECT",
      reasons: ["UNKNOWN_KEY"],
    });
  });
});

describe("POST /checkout: agent alone", () => {
  test("approved and vaulted: a CAPTURE order against the vault, captured at once", async () => {
    const s = setup({ vaultId: "VAULT-1" });
    const res = await s.checkout((await signedCheckout({ shopper, agent, humanPresent: false })).body);
    expect(res.json().verdict.outcome).toBe("APPROVE");
    expect(res.json().approval_url).toBeUndefined();
    expect(s.createOrder).toHaveBeenCalledWith(
      expect.objectContaining({ intent: "CAPTURE", vaultId: "VAULT-1" }),
    );
    expect(s.mem.orders.get(res.json().order_id)).toMatchObject({
      status: "COMPLETED",
      capturedAt: NOW,
      captureId: expect.any(String),
    });
  });

  test("a step-up with nobody present charges nothing", async () => {
    const s = setup({ vaultId: "VAULT-1", semanticFit: j1("partial", 0.9) });
    const res = await s.checkout(
      (await signedCheckout({ shopper, agent, humanPresent: false, cart: partialCart })).body,
    );
    expect(res.json().verdict).toEqual({ outcome: "STEP_UP", reasons: ["SEMANTIC_UNCERTAIN"] });
    expect(s.createOrder).not.toHaveBeenCalled();
  });

  test("without a saved wallet it's a 409, not a charge", async () => {
    const s = setup();
    const res = await s.checkout((await signedCheckout({ shopper, agent, humanPresent: false })).body);
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("no_vaulted_wallet");
    expect(s.createOrder).not.toHaveBeenCalled();
  });

  test("captures feed the intent's ledger, which budget_cap and recurrence read", async () => {
    const s = setup({ vaultId: "VAULT-1" });
    const intent = {
      ...greyJacketIntent,
      constraints: { ...greyJacketIntent.constraints, budget_cap: { value: 10000, currency: "USD" } },
    };
    const first = await s.checkout(
      (await signedCheckout({ shopper, agent, intent, humanPresent: false })).body,
    );
    expect(first.json().verdict.outcome).toBe("APPROVE");
    const ledger = await s.mem.db.mandateLedger(intent.mandate_id);
    expect(ledger).toEqual({ capturedTotal: 7400, capturedOrderTimes: [NOW] });
  });
});

describe("POST /checkout: failure handling", () => {
  test("a malformed request is 400; missing configuration is 503", async () => {
    const s = setup();
    expect((await s.checkout({ intent: {}, cart: {} })).statusCode).toBe(400);
    const noDb = buildApp({ paypal: createMockClient() });
    const res = await noDb.inject({
      method: "POST",
      url: "/checkout",
      payload: (await signedCheckout({ shopper, agent })).body,
    });
    expect(res.statusCode).toBe(503);
  });

  test("if PayPal fails, the answer is 502, the order is marked, and nothing is claimed as charged", async () => {
    const paypal: PayPalClient = {
      ...createMockClient(),
      createOrder: async () => {
        throw new PayPalError(500, "INTERNAL_SERVER_ERROR", "dbg", "PayPal 500");
      },
    };
    const s = setup({ paypal });
    const res = await s.checkout((await signedCheckout({ shopper, agent })).body);
    expect(res.statusCode).toBe(502);
    expect([...s.mem.orders.values()].map((o) => o.status)).toEqual(["PAYPAL_FAILED"]);
    expect(s.mem.audit.map((a) => a.action)).toContain("paypal.create_order.failed");
  });
});

// The same flow against real Postgres, to prove the SQL behind the in-memory Db.
describe.runIf(process.env.DATABASE_URL)("POST /checkout with Postgres", () => {
  test("approve, persist mandates/order/verdict, then reject the replay", async () => {
    const name = `poi_test_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
    const url = new URL(process.env.DATABASE_URL!);
    const admin = new pg.Client({ connectionString: url.toString() });
    await admin.connect();
    await admin.query(`create database ${name}`);
    url.pathname = `/${name}`;
    const db = createDb(url.toString());
    const raw = new pg.Pool({ connectionString: url.toString() });
    try {
      await db.migrate();
      await raw.query("insert into shoppers (id) values ('shopper-1')");
      await raw.query("insert into shopper_keys (kid, shopper_id, public_jwk) values ($1, 'shopper-1', $2)", [
        shopper.kid,
        shopper.publicJwk,
      ]);
      await raw.query(
        "insert into agent_keys (kid, platform, owner, public_jwk) values ($1, 'Northstar', 'test', $2)",
        [agent.kid, agent.publicJwk],
      );

      const app = buildApp({
        paypal: createMockClient(),
        db,
        merchant: { id: MERCHANT_ID, kid: "merchant-1", privateKey: merchantKey.privateKey },
        semanticFit: j1("match", 0.95),
        now: () => NOW,
      });
      const { body, intent } = await signedCheckout({ shopper, agent });
      const res = await app.inject({ method: "POST", url: "/checkout", payload: body });
      expect(res.json().verdict.outcome).toBe("APPROVE");

      const order = (await raw.query("select * from orders")).rows[0];
      expect(order).toMatchObject({
        id: res.json().order_id,
        custom_id: customId(intent.mandate_id, mandateHash(intent)),
        status: "CREATED",
        total_value: "7400",
        shopper_id: "shopper-1",
      });
      expect((await raw.query("select kind from mandates order by kind")).rows.map((r) => r.kind)).toEqual([
        "cart",
        "intent",
        "payment",
      ]);
      expect((await raw.query("select outcome, reasons from verdicts")).rows).toEqual([
        { outcome: "APPROVE", reasons: [] },
      ]);

      const replay = await app.inject({ method: "POST", url: "/checkout", payload: body });
      expect(replay.json().verdict.reasons).toEqual(["NONCE_REPLAYED"]);
      expect((await raw.query("select count(*)::int as n from orders")).rows[0].n).toBe(1);
      await app.close();
    } finally {
      await raw.end();
      await db.close().catch(() => {});
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
    }
  });
});
