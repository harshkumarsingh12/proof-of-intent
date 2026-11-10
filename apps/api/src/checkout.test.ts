import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, test, vi } from "vitest";
import { semanticFit as realJ1, type Generate, type SemanticFit } from "@poi/ai";
import { NotImplementedError, type IntentMandate } from "@poi/contracts";
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
    aiMode: overrides.aiMode,
    merchant: { id: MERCHANT_ID, kid: "merchant-1", privateKey: merchantKey.privateKey },
    semanticFit,
    catalog: overrides.catalog,
    now: overrides.now ?? (() => NOW),
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

  test("the real J1 in replay mode, no API key: compliant approves, rain shell and unknown carts step up", async () => {
    const unknownCart = {
      ...compliantCart,
      contents: {
        ...compliantCart.contents,
        lines: compliantCart.contents.lines.map((l) => ({ ...l, title: "Trail Running Vest" })),
      },
    };
    const cases = [
      [compliantCart, "APPROVE", []],
      [partialCart, "STEP_UP", ["SEMANTIC_UNCERTAIN"]],
      [unknownCart, "STEP_UP", ["SEMANTIC_UNCERTAIN"]],
    ] as const;
    for (const [cart, outcome, reasons] of cases) {
      // The vest isn't in the demo store, so the merchant's catalog is told about it: this test is about J1, not #158.
      const catalog = [...cart.contents.lines];
      const s = setup({ semanticFit: realJ1, aiMode: "replay", catalog });
      const res = await s.checkout((await signedCheckout({ shopper, agent, cart })).body);
      expect(res.json().verdict).toEqual({ outcome, reasons: [...reasons] });
      expect(s.createOrder).toHaveBeenCalledTimes(1);
    }
  });

  test.each(["live", "replay"] as const)(
    "a trail shoe for road running needs confirmation in %s mode",
    async (aiMode) => {
      const amount = { value: 12800, currency: "USD" };
      const attributes = { category: "running-shoe", color: "blue" };
      const intent = {
        ...greyJacketIntent,
        natural_language_description: "Blue road running shoes in size 10, under $130.",
        constraints: {
          ...greyJacketIntent.constraints,
          attributes,
          amount_max: { value: 13000, currency: "USD" },
        },
      };
      const cart = {
        ...compliantCart,
        contents: {
          ...compliantCart.contents,
          lines: [
            {
              sku: "SHO-RDG-BLU-10",
              title: "Ridge Trail Running Shoe, size 10",
              attributes,
              unit_price: amount,
              quantity: 1,
            },
          ],
          total: amount,
        },
      };
      // What the live model really answered for this cart (#103): a confident match.
      const calls = vi.fn();
      const provider: Generate = async ({ schema }) => {
        calls();
        return schema.parse({
          fit: "match",
          confidence: 0.95,
          reasons: ["Running shoe, blue, size 10, under budget."],
          matched_attributes: ["category", "color"],
          conflicting_attributes: [],
        });
      };
      const s = setup({
        aiMode,
        vaultId: "VAULT-1",
        semanticFit: (words, proposed, mode) => realJ1(words, proposed, mode, { generate: provider }),
      });
      const { body } = await signedCheckout({ shopper, agent, intent, cart, humanPresent: false });
      const res = await s.checkout(body);
      expect(res.statusCode).toBe(200);
      expect(res.json().verdict).toEqual({ outcome: "STEP_UP", reasons: ["SEMANTIC_UNCERTAIN"] });
      expect(res.json().paypal_order_id).toBeUndefined();
      expect(calls).toHaveBeenCalledTimes(aiMode === "live" ? 1 : 0);
      expect(s.createOrder).not.toHaveBeenCalled();
    },
  );

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

describe("POST /checkout: the merchant's catalog (#158)", () => {
  /** compliantCart with its one line changed. The agent signs this cart, so only the catalog can catch it. */
  const withLine = (change: Record<string, unknown>) => ({
    ...compliantCart,
    contents: {
      ...compliantCart.contents,
      lines: compliantCart.contents.lines.map((l) => ({ ...l, ...change })),
      ...("unit_price" in change ? { total: change.unit_price as { value: number; currency: string } } : {}),
    },
  });
  const rejected = async (cart: typeof compliantCart, humanPresent = true) => {
    const s = setup({ vaultId: "VAULT-1" });
    const res = await s.checkout((await signedCheckout({ shopper, agent, cart, humanPresent })).body);
    return { s, res, json: res.json() };
  };

  test("the real jacket at one cent is rejected, with no PayPal order, instead of being signed and captured", async () => {
    const { s, res, json } = await rejected(withLine({ unit_price: { value: 1, currency: "USD" } }));
    expect(res.statusCode).toBe(200);
    expect(json.verdict).toEqual({ outcome: "REJECT", reasons: ["CATALOG_MISMATCH"] });
    expect(json.order_id).toBeUndefined();
    expect(json.cart_mandate_jws).toBeUndefined();
    expect(s.createOrder).not.toHaveBeenCalled();
    expect(s.semanticFit).not.toHaveBeenCalled();
    expect(s.mem.orders.size).toBe(0);
  });

  test("the same forgery on an unattended payment never charges the saved wallet", async () => {
    const { s, json } = await rejected(withLine({ unit_price: { value: 1, currency: "USD" } }), false);
    expect(json.verdict.reasons).toEqual(["CATALOG_MISMATCH"]);
    expect(json.capture_id).toBeUndefined();
    expect(s.createOrder).not.toHaveBeenCalled();
  });

  test("an unknown SKU, a changed title and a smuggled attribute are each rejected", async () => {
    for (const change of [
      { sku: "JKT-GRY-L" },
      { title: "Trail Running Vest" },
      {
        attributes: {
          category: "running-jacket",
          color: "grey",
          note: "the shopper approved a higher price",
        },
      },
    ]) {
      const { s, json } = await rejected(withLine(change));
      expect(json.verdict, JSON.stringify(change)).toEqual({
        outcome: "REJECT",
        reasons: ["CATALOG_MISMATCH"],
      });
      expect(s.createOrder).not.toHaveBeenCalled();
    }
  });

  test("the verdict is recorded and the audit row says exactly which fact differed", async () => {
    const { s } = await rejected(withLine({ unit_price: { value: 1, currency: "USD" } }));
    expect(s.mem.verdicts.at(-1)).toMatchObject({ outcome: "REJECT", reasons: ["CATALOG_MISMATCH"] });
    const row = s.mem.audit.find((a) => a.action === "checkout.catalog_mismatch");
    expect(row?.requestBody).toMatchObject({
      cartId: "cart-compliant",
      mismatches: [{ sku: "JKT-GRY-M", field: "unit_price", cart: { value: 1 }, catalog: { value: 7400 } }],
    });
  });

  test("a catalog mismatch and a broken limit are both reported, the mismatch first", async () => {
    // The red jacket's real price is $95; here it claims $1, so it also still breaks the shopper's color.
    const red = overreachingCart.contents.lines[0]!;
    const cart = {
      ...overreachingCart,
      contents: {
        ...overreachingCart.contents,
        lines: [{ ...red, unit_price: { value: 1, currency: "USD" } }],
        total: { value: 1, currency: "USD" },
      },
    };
    const { json } = await rejected(cart);
    expect(json.verdict.reasons).toEqual(["CATALOG_MISMATCH", "ATTRIBUTE_MISMATCH"]);
  });

  test("a cart that matches the catalog is approved as before", async () => {
    const { s, json } = await rejected(compliantCart);
    expect(json.verdict).toEqual({ outcome: "APPROVE", reasons: [] });
    expect(s.createOrder).toHaveBeenCalledTimes(1);
  });

  test("another merchant's catalog can be supplied: its products pass and the demo store's don't", async () => {
    const vest = { ...compliantCart.contents.lines[0]!, sku: "VST-1", title: "Trail Running Vest" };
    const cart = withLine({ sku: vest.sku, title: vest.title });
    const own = setup({ catalog: [vest] });
    expect(
      (await own.checkout((await signedCheckout({ shopper, agent, cart })).body)).json().verdict.outcome,
    ).toBe("APPROVE");
    const demo = setup(); // the demo store has no VST-1
    expect(
      (await demo.checkout((await signedCheckout({ shopper, agent, cart })).body)).json().verdict.reasons,
    ).toEqual(["CATALOG_MISMATCH"]);
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

  test("an expired intent, or one that isn't valid yet, is rejected end to end and creates nothing", async () => {
    // NOW is 2026-11-02T10:00:00Z; the cart (valid until 10:15) is fine in both cases, so only the intent decides.
    const expired = { ...greyJacketIntent, intent_expiry: "2026-11-02T09:00:00Z" };
    const early = {
      ...greyJacketIntent,
      constraints: { ...greyJacketIntent.constraints, valid_from: "2026-11-02T11:00:00Z" },
    };
    for (const [intent, reason] of [
      [expired, "MANDATE_EXPIRED"],
      [early, "MANDATE_NOT_YET_VALID"],
    ] as const) {
      const s = setup();
      const res = await s.checkout((await signedCheckout({ shopper, agent, intent })).body);
      expect(res.json().verdict, reason).toEqual({ outcome: "REJECT", reasons: [reason] });
      expect(res.json().order_id).toBeUndefined();
      expect(s.createOrder).not.toHaveBeenCalled();
      expect(s.mem.orders.size).toBe(0);
    }
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
});

describe("POST /checkout: retired keys are judged by the merchant's clock (#162)", () => {
  // The clock is NOW = 2026-11-02T10:00:00Z unless a test moves it. A cart good until 12:00 outlives the later checkouts.
  const longCart = {
    ...compliantCart,
    contents: { ...compliantCart.contents, cart_expiry: "2026-11-02T12:00:00Z" },
  };
  const retire = (s: ReturnType<typeof setup>, kid: string, retiredAt: string) =>
    s.mem.keys.set(kid, { ...s.mem.keys.get(kid)!, retiredAt });
  const verdict = async (s: ReturnType<typeof setup>, opts: Parameters<typeof signedCheckout>[0]) =>
    (await s.checkout((await signedCheckout(opts)).body)).json().verdict;
  const refused = { outcome: "REJECT", reasons: ["UNKNOWN_KEY"] };

  test("a retired agent key can't get a new payment through by dating it before the retirement", async () => {
    const s = setup();
    retire(s, agent.kid, "2026-11-02T09:30:00Z"); // retired half an hour ago
    // The attack: a payment the agent dated 09:00, before the retirement. It used to be approved.
    expect(await verdict(s, { shopper, agent, cart: longCart, timestamp: "2026-11-02T09:00:00Z" })).toEqual(
      refused,
    );
    // And, as before, one honestly dated after the retirement.
    expect(await verdict(s, { shopper, agent, cart: longCart, timestamp: "2026-11-02T09:45:00Z" })).toEqual(
      refused,
    );
    expect(s.createOrder).not.toHaveBeenCalled();
  });

  test("a retirement that hasn't happened yet changes nothing", async () => {
    const s = setup();
    retire(s, agent.kid, "2026-11-02T11:00:00Z");
    expect((await verdict(s, { shopper, agent, cart: longCart })).outcome).toBe("APPROVE");
  });

  test("a retired shopper key can't present a NEW intent, whatever date the intent carries", async () => {
    // The fixture intent says it was created 2026-11-01T09:00, before this retirement. We have never seen it.
    const s = setup({ retiredAt: "2026-11-01T10:00:00Z" });
    expect(await verdict(s, { shopper, agent })).toEqual(refused);
    expect(s.createOrder).not.toHaveBeenCalled();
  });

  test("an intent we saw before the key was retired stays usable afterwards", async () => {
    let clock = NOW;
    const s = setup({ now: () => clock });
    expect((await verdict(s, { shopper, agent, cart: longCart })).outcome).toBe("APPROVE"); // first seen 10:00
    // The first order was never paid (one default intent allows one purchase, #156), so the intent is still unspent.
    await s.mem.db.updateOrder([...s.mem.orders.keys()][0]!, { status: "VOIDED" });
    retire(s, shopper.kid, "2026-11-02T10:30:00Z");
    clock = "2026-11-02T11:00:00Z";
    // A new attempt (a new Payment Mandate) under the same intent, after the retirement.
    expect((await verdict(s, { shopper, agent, cart: longCart })).outcome).toBe("APPROVE");
  });

  test("retiring a key as of an earlier date voids what we first saw after that date", async () => {
    let clock = NOW;
    const s = setup({ now: () => clock });
    expect((await verdict(s, { shopper, agent, cart: longCart })).outcome).toBe("APPROVE"); // first seen 10:00
    retire(s, shopper.kid, "2026-11-02T09:30:00Z"); // the operator says it was compromised from 09:30
    clock = "2026-11-02T11:00:00Z";
    expect(await verdict(s, { shopper, agent, cart: longCart })).toEqual(refused);
  });
});

describe("POST /checkout: agent alone", () => {
  test("approved and vaulted: a CAPTURE order against the vault, captured at once", async () => {
    const s = setup({ vaultId: "VAULT-1" });
    const res = await s.checkout((await signedCheckout({ shopper, agent, humanPresent: false })).body);
    expect(res.json().verdict.outcome).toBe("APPROVE");
    expect(res.json().approval_url).toBeUndefined();
    expect(res.json().capture_id).toBe(s.mem.orders.get(res.json().order_id)?.captureId);
    expect(res.json().capture_id).toBeTruthy();
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

describe("POST /checkout: the shopper's signed permission to pay without them (#157)", () => {
  const alone = (opts: Partial<Parameters<typeof signedCheckout>[0]> = {}) =>
    signedCheckout({ shopper, agent, humanPresent: false, ...opts });

  test("an agent that only claims the shopper is absent is refused, and the saved wallet is never charged", async () => {
    const s = setup({ vaultId: "VAULT-1" });
    const res = await s.checkout((await alone({ permitUnattended: false })).body);
    expect(res.statusCode).toBe(200);
    expect(res.json().verdict).toEqual({ outcome: "REJECT", reasons: ["UNATTENDED_NOT_PERMITTED"] });
    expect(s.createOrder).not.toHaveBeenCalled();
    expect(s.mem.orders.size).toBe(0);
  });

  test("with the permission signed into the intent, the same request is charged to the wallet", async () => {
    const s = setup({ vaultId: "VAULT-1" });
    const signed = await alone();
    expect(signed.intent.constraints.unattended_payment).toEqual({});
    const res = await s.checkout(signed.body);
    expect(res.json().verdict.outcome).toBe("APPROVE");
    expect(s.createOrder).toHaveBeenCalledWith(
      expect.objectContaining({ intent: "CAPTURE", vaultId: "VAULT-1" }),
    );
  });

  test("a permission limited to named agent platforms refuses every other platform", async () => {
    const intent = {
      ...greyJacketIntent,
      constraints: {
        ...greyJacketIntent.constraints,
        unattended_payment: { allowed_agent_platforms: ["Someone Else"] },
      },
    };
    const s = setup({ vaultId: "VAULT-1" });
    const refused = await s.checkout((await alone({ intent })).body); // the agent registers as Northstar
    expect(refused.json().verdict.reasons).toEqual(["UNATTENDED_NOT_PERMITTED"]);
    expect(s.createOrder).not.toHaveBeenCalled();

    const own = {
      ...intent,
      constraints: { ...intent.constraints, unattended_payment: { allowed_agent_platforms: ["Northstar"] } },
    };
    const ok = await s.checkout((await alone({ intent: own })).body);
    expect(ok.json().verdict.outcome).toBe("APPROVE");
  });

  test("a shopper who is present needs no permission, and it is reported with the other reasons", async () => {
    const s = setup({ vaultId: "VAULT-1" });
    const present = await s.checkout((await signedCheckout({ shopper, agent })).body);
    expect(present.json().verdict.outcome).toBe("APPROVE");
    const both = await s.checkout((await alone({ permitUnattended: false, cart: overreachingCart })).body);
    expect(both.json().verdict.reasons).toEqual(
      expect.arrayContaining(["UNATTENDED_NOT_PERMITTED", "AMOUNT_EXCEEDS_MAX"]),
    );
  });
});

describe("POST /checkout: one purchase per default intent (#156)", () => {
  const nth = (n: number) => ({
    ...compliantCart,
    contents: { ...compliantCart.contents, cart_id: `cart-${n}` },
  });

  test("a second purchase under the default intent is refused with INTENT_ALREADY_USED, and nothing is created", async () => {
    const s = setup({ vaultId: "VAULT-1" });
    const first = await s.checkout(
      (await signedCheckout({ shopper, agent, cart: nth(1), humanPresent: false })).body,
    );
    expect(first.json().verdict.outcome).toBe("APPROVE"); // charged at once
    const second = await s.checkout(
      (await signedCheckout({ shopper, agent, cart: nth(2), humanPresent: false })).body,
    );
    expect(second.json().verdict).toEqual({ outcome: "REJECT", reasons: ["INTENT_ALREADY_USED"] });
    expect(s.createOrder).toHaveBeenCalledTimes(1);
    expect(s.mem.orders.size).toBe(1);
  });

  test("the same holds for a shopper who is present, once the first order is captured", async () => {
    const s = setup();
    const first = await s.checkout((await signedCheckout({ shopper, agent, cart: nth(1) })).body);
    await s.mem.db.updateOrder(first.json().order_id, { status: "CAPTURED", capturedAt: NOW });
    const second = await s.checkout((await signedCheckout({ shopper, agent, cart: nth(2) })).body);
    expect(second.json().verdict.reasons).toEqual(["INTENT_ALREADY_USED"]);
  });

  test("a refused attempt is not a purchase: the retry after a rejection still works", async () => {
    const s = setup();
    const rejected = await s.checkout(
      (await signedCheckout({ shopper, agent, cart: overreachingCart })).body,
    );
    expect(rejected.json().verdict.outcome).toBe("REJECT");
    const retry = await s.checkout((await signedCheckout({ shopper, agent, cart: nth(2) })).body);
    expect(retry.json().verdict.outcome).toBe("APPROVE");
  });

  test("more than one needs signed permission: an order count lets a second purchase through", async () => {
    const s = setup({ vaultId: "VAULT-1" });
    const intent = {
      ...greyJacketIntent,
      constraints: { ...greyJacketIntent.constraints, recurrence: { max_orders: 2, window_days: 30 } },
    };
    for (const n of [1, 2]) {
      const res = await s.checkout(
        (await signedCheckout({ shopper, agent, intent, cart: nth(n), humanPresent: false })).body,
      );
      expect(res.json().verdict.outcome).toBe("APPROVE");
    }
    const third = await s.checkout(
      (await signedCheckout({ shopper, agent, intent, cart: nth(3), humanPresent: false })).body,
    );
    expect(third.json().verdict.reasons).toEqual(["RECURRENCE_EXCEEDED"]);
  });
});

describe("POST /checkout: a lost PayPal answer on an unattended charge (#159)", () => {
  /** PayPal completes the order and charges the wallet, but the answer never reaches us (once). */
  function losesFirstAnswer(inner: PayPalClient, failure: Error = new Error("socket hang up")) {
    const requestIds: string[] = [];
    const charges: { id: string; captureId?: string }[] = [];
    let lost = false;
    const paypal: PayPalClient = {
      ...inner,
      createOrder: async (input) => {
        requestIds.push(input.ourOrderId);
        const created = await inner.createOrder(input); // PayPal charged
        charges.push(created);
        if (!lost) {
          lost = true;
          throw failure;
        }
        return created;
      },
    };
    return { paypal, requestIds, charges };
  }
  const unattended = () => signedCheckout({ shopper, agent, humanPresent: false });

  test("is never reported as 'nothing was charged', and the order is UNKNOWN_OUTCOME", async () => {
    const { paypal } = losesFirstAnswer(createMockClient());
    const s = setup({ vaultId: "VAULT-1", paypal });
    const res = await s.checkout((await unattended()).body);
    expect(res.statusCode).toBe(502);
    expect(res.json().error).toBe("paypal_outcome_unknown");
    expect(res.json().message).not.toMatch(/nothing was charged/i);
    expect([...s.mem.orders.values()].map((o) => o.status)).toEqual(["UNKNOWN_OUTCOME"]);
    expect(s.mem.audit.map((a) => a.action)).toContain("paypal.create_order.unknown_outcome");
  });

  test("a retry of the same cart reuses the attempt, so PayPal answers with the first charge and no second one happens", async () => {
    const inner = createMockClient();
    const { paypal, requestIds, charges } = losesFirstAnswer(inner);
    const s = setup({ vaultId: "VAULT-1", paypal });
    const first = await s.checkout((await unattended()).body);
    expect(first.statusCode).toBe(502);
    const [lostId] = [...s.mem.orders.keys()];

    // A new payment mandate (the first is spent) for the same cart.
    const retry = await s.checkout((await unattended()).body);
    expect(retry.statusCode).toBe(200);
    expect(retry.json().order_id).toBe(lostId);
    expect(requestIds).toEqual([lostId, lostId]); // the same PayPal-Request-Id both times
    expect(s.mem.orders.size).toBe(1);
    const order = s.mem.orders.get(lostId!)!;
    expect(order.status).toBe("COMPLETED");
    expect(order.captureId).toBe(retry.json().capture_id);
    expect(order.capturedAt).toBeTruthy();
    // PayPal held one order and one capture: both calls got the same PayPal order and capture back.
    expect(new Set(charges.map((c) => c.id)).size).toBe(1);
    expect(new Set(charges.map((c) => c.captureId)).size).toBe(1);
  });

  test("a different cart under the same intent waits until the unconfirmed charge is settled", async () => {
    // A budget is the signed permission for more than one purchase (#156); without it the default intent is spent.
    const intent = {
      ...greyJacketIntent,
      constraints: { ...greyJacketIntent.constraints, budget_cap: { value: 20000, currency: "USD" } },
    };
    const { paypal } = losesFirstAnswer(createMockClient());
    const s = setup({ vaultId: "VAULT-1", paypal });
    await s.checkout((await signedCheckout({ shopper, agent, intent, humanPresent: false })).body);
    const other = await s.checkout(
      (
        await signedCheckout({
          shopper,
          agent,
          intent,
          humanPresent: false,
          cart: { ...compliantCart, contents: { ...compliantCart.contents, cart_id: "cart-other" } },
        })
      ).body,
    );
    expect(other.statusCode).toBe(409);
    expect(other.json().error).toBe("payment_outcome_unknown");
    expect(s.mem.orders.size).toBe(1);
  });

  test("an unconfirmed charge counts against the intent, so a default intent is not bought twice", async () => {
    const { paypal } = losesFirstAnswer(createMockClient());
    const s = setup({ vaultId: "VAULT-1", paypal });
    await s.checkout((await unattended()).body);
    const other = await s.checkout(
      (
        await signedCheckout({
          shopper,
          agent,
          humanPresent: false,
          cart: { ...compliantCart, contents: { ...compliantCart.contents, cart_id: "cart-other" } },
        })
      ).body,
    );
    expect(other.json().verdict.reasons).toEqual(["INTENT_ALREADY_USED"]);
    expect(s.mem.orders.size).toBe(1);
  });

  test("retrying the same cart does not count the unconfirmed order against the intent's budget", async () => {
    const intent = {
      ...greyJacketIntent,
      constraints: { ...greyJacketIntent.constraints, budget_cap: { value: 8000, currency: "USD" } },
    };
    const { paypal } = losesFirstAnswer(createMockClient());
    const s = setup({ vaultId: "VAULT-1", paypal });
    const send = async () =>
      s.checkout((await signedCheckout({ shopper, agent, intent, humanPresent: false })).body);
    expect((await send()).json().error).toBe("paypal_outcome_unknown");
    const retry = await send(); // 7400 is held, the cap is 8000: counted twice it would be refused
    expect(retry.json().verdict.outcome).toBe("APPROVE");
    expect(s.mem.orders.size).toBe(1);
  });

  test("a PayPal refusal (4xx) is still 'nothing was charged' and allows a fresh attempt", async () => {
    const refusing: PayPalClient = {
      ...createMockClient(),
      createOrder: async () => {
        throw new PayPalError(422, "INSTRUMENT_DECLINED", "dbg", "PayPal 422");
      },
    };
    const s = setup({ vaultId: "VAULT-1", paypal: refusing });
    const res = await s.checkout((await unattended()).body);
    expect(res.json().error).toBe("paypal_unavailable");
    expect([...s.mem.orders.values()].map((o) => o.status)).toEqual(["PAYPAL_FAILED"]);
  });

  test("a PayPal 5xx on an unattended charge is unknown too; on a human-present order it is not", async () => {
    const five: PayPalClient = {
      ...createMockClient(),
      createOrder: async () => {
        throw new PayPalError(503, "SERVICE_UNAVAILABLE", "dbg", "PayPal 503");
      },
    };
    const alone = setup({ vaultId: "VAULT-1", paypal: five });
    expect((await alone.checkout((await unattended()).body)).json().error).toBe("paypal_outcome_unknown");
    const present = setup({ vaultId: "VAULT-1", paypal: five });
    const res = await present.checkout((await signedCheckout({ shopper, agent })).body);
    expect(res.json().error).toBe("paypal_unavailable"); // AUTHORIZE charges nothing at creation
    expect([...present.mem.orders.values()].map((o) => o.status)).toEqual(["PAYPAL_FAILED"]);
  });

  test("a verified capture webhook settles the unknown order", async () => {
    const { paypal } = losesFirstAnswer(createMockClient());
    const verified: PayPalClient = { ...paypal, verifyWebhook: async () => true };
    const s = setup({ vaultId: "VAULT-1", paypal: verified });
    await s.checkout((await unattended()).body);
    const [orderId] = [...s.mem.orders.keys()];
    const res = await s.app.inject({
      method: "POST",
      url: "/webhooks/paypal",
      headers: {
        "content-type": "application/json",
        "paypal-transmission-id": "t1",
        "paypal-transmission-time": NOW,
        "paypal-transmission-sig": "sig",
        "paypal-cert-url": "https://api.sandbox.paypal.com/cert",
        "paypal-auth-algo": "SHA256withRSA",
      },
      payload: JSON.stringify({
        id: "WH-1",
        event_type: "PAYMENT.CAPTURE.COMPLETED",
        resource: {
          id: "CAP-1",
          invoice_id: orderId,
          supplementary_data: { related_ids: { order_id: "PP-ORDER-1" } },
        },
      }),
    });
    expect(res.statusCode).toBe(200);
    expect(s.mem.orders.get(orderId!)).toMatchObject({
      status: "COMPLETED",
      captureId: "CAP-1",
      paypalOrderId: "PP-ORDER-1",
    });
    expect(s.mem.audit.map((a) => a.action)).toContain("order.outcome_confirmed");
    // Settled: another cart is no longer held back.
    expect(await s.mem.db.unknownOutcomeOrders(greyJacketIntent.mandate_id)).toEqual([]);
  });
});

describe("POST /checkout: an agent-alone charge is paid only when PayPal completes the capture (#225)", () => {
  /** A vaulted CAPTURE whose ORDER completes but whose capture has the given status. */
  const capturing = (status: string): PayPalClient => {
    const mock = createMockClient();
    return {
      ...mock,
      createOrder: async (input) => ({
        ...(await mock.createOrder(input)),
        captureId: `CAP-${status}`,
        captureStatus: status,
      }),
    };
  };
  const unattended = (n = 1) =>
    signedCheckout({
      shopper,
      agent,
      humanPresent: false,
      cart: { ...compliantCart, contents: { ...compliantCart.contents, cart_id: `cart-${n}` } },
    });

  test("a COMPLETED order with a PENDING capture is CAPTURE_PENDING and says so; it still uses the intent", async () => {
    const s = setup({ vaultId: "VAULT-1", paypal: capturing("PENDING") });
    const res = await s.checkout((await unattended()).body);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ capture_id: "CAP-PENDING", capture_status: "PENDING" });
    const [order] = [...s.mem.orders.values()];
    expect(order).toMatchObject({ status: "CAPTURE_PENDING", captureId: "CAP-PENDING" });
    expect(order?.capturedAt).toBeUndefined();
    // The money may still move, so a second purchase under this default intent is refused.
    const second = await s.checkout((await unattended(2)).body);
    expect(second.json().verdict.reasons).toEqual(["INTENT_ALREADY_USED"]);
  });

  test("a COMPLETED capture is paid, as before", async () => {
    const s = setup({ vaultId: "VAULT-1" });
    const res = await s.checkout((await unattended()).body);
    expect(res.json()).toMatchObject({ capture_status: "COMPLETED", capture_id: expect.any(String) });
    expect([...s.mem.orders.values()][0]).toMatchObject({ status: "COMPLETED", capturedAt: NOW });
  });

  test("a DECLINED capture is 402 payment_declined, never paid, and the intent can still buy", async () => {
    const s = setup({ vaultId: "VAULT-1", paypal: capturing("DECLINED") });
    const res = await s.checkout((await unattended()).body);
    expect(res.statusCode).toBe(402);
    expect(res.json()).toMatchObject({ error: "payment_declined" });
    const [order] = [...s.mem.orders.values()];
    expect(order).toMatchObject({ status: "CAPTURE_DECLINED" });
    expect(order?.capturedAt).toBeUndefined();
    expect((await s.mem.db.activeLedger(greyJacketIntent.mandate_id, NOW)).capturedTotal).toBe(0);
  });
});

describe("POST /checkout: spending authority is reserved while orders are pending (#155)", () => {
  const capped = {
    ...greyJacketIntent,
    constraints: { ...greyJacketIntent.constraints, budget_cap: { value: 10000, currency: "USD" } },
  };
  /** A different cart under the same intent, each 7400, so two of them are 14800 against a 10000 cap. */
  const nth = (n: number) => ({
    ...compliantCart,
    contents: { ...compliantCart.contents, cart_id: `cart-${n}` },
  });
  const humanPresent = (n: number, intent: IntentMandate = capped) =>
    signedCheckout({ shopper, agent, intent, cart: nth(n) });

  test("a second order created before the first is captured is refused, so the cap cannot be exceeded", async () => {
    const s = setup();
    const first = await s.checkout((await humanPresent(1)).body);
    expect(first.json().verdict.outcome).toBe("APPROVE");
    expect([...s.mem.orders.values()].map((o) => o.status)).toEqual(["CREATED"]); // nothing captured yet

    const second = await s.checkout((await humanPresent(2)).body);
    expect(second.json().verdict).toEqual({ outcome: "REJECT", reasons: ["BUDGET_EXCEEDED"] });
    expect(second.json().order_id).toBeUndefined();
    expect(s.mem.orders.size).toBe(1);
    expect(s.createOrder).toHaveBeenCalledTimes(1); // PayPal was never contacted for the second
  });

  test("two checkouts racing past the first check cannot both reserve: the reservation itself refuses one", async () => {
    const s = setup();
    const [a, b] = await Promise.all([
      humanPresent(1).then((r) => s.checkout(r.body)),
      humanPresent(2).then((r) => s.checkout(r.body)),
    ]);
    const outcomes = [a, b].map((r) => r.json().verdict.outcome).sort();
    expect(outcomes).toEqual(["APPROVE", "REJECT"]);
    expect(s.mem.orders.size).toBe(1);
    expect(s.createOrder).toHaveBeenCalledTimes(1);
    const refused = [a, b].find((r) => r.json().verdict.outcome === "REJECT")!;
    expect(refused.json().verdict.reasons).toEqual(["BUDGET_EXCEEDED"]);
  });

  test("recurrence counts pending orders too", async () => {
    const s = setup();
    const once = {
      ...greyJacketIntent,
      constraints: { ...greyJacketIntent.constraints, recurrence: { max_orders: 1, window_days: 30 } },
    };
    expect((await s.checkout((await humanPresent(1, once)).body)).json().verdict.outcome).toBe("APPROVE");
    const second = await s.checkout((await humanPresent(2, once)).body);
    expect(second.json().verdict).toEqual({ outcome: "REJECT", reasons: ["RECURRENCE_EXCEEDED"] });
  });

  test("a voided, failed or expired reservation is released", async () => {
    const s = setup();
    await s.checkout((await humanPresent(1)).body);
    const [id] = [...s.mem.orders.keys()];
    const held = () => s.mem.db.activeLedger(capped.mandate_id, NOW);
    expect((await held()).capturedTotal).toBe(7400);
    await s.mem.db.updateOrder(id!, { status: "VOIDED" });
    expect((await held()).capturedTotal).toBe(0);
    await s.mem.db.updateOrder(id!, { status: "PAYPAL_FAILED" });
    expect((await held()).capturedTotal).toBe(0);
    // Expired: a pending order stops counting once its cart has expired.
    await s.mem.db.updateOrder(id!, { status: "CREATED" });
    expect((await held()).capturedTotal).toBe(7400);
    expect(
      (await s.mem.db.activeLedger(capped.mandate_id, compliantCart.contents.cart_expiry)).capturedTotal,
    ).toBe(0);
    // And with room again, the next cart is accepted.
    await s.mem.db.updateOrder(id!, { status: "VOIDED" });
    const next = await s.checkout((await humanPresent(3)).body);
    expect(next.json().verdict.outcome).toBe("APPROVE");
  });

  test("an unattended order that completed at creation counts as committed", async () => {
    const s = setup({ vaultId: "VAULT-1" });
    const first = await s.checkout(
      (await signedCheckout({ shopper, agent, intent: capped, cart: nth(1), humanPresent: false })).body,
    );
    expect(first.json().verdict.outcome).toBe("APPROVE");
    const second = await s.checkout(
      (await signedCheckout({ shopper, agent, intent: capped, cart: nth(2), humanPresent: false })).body,
    );
    expect(second.json().verdict.reasons).toEqual(["BUDGET_EXCEEDED"]);
  });
});

// The same flow against real Postgres, to prove the SQL behind the in-memory Db.
/** A throwaway database with the schema, both keys registered, and a pool for looking at the rows. */
async function withPostgres(run: (ctx: { db: ReturnType<typeof createDb>; raw: pg.Pool }) => Promise<void>) {
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
    await run({ db, raw });
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
}

describe.runIf(process.env.DATABASE_URL)("POST /checkout with Postgres", () => {
  const appFor = (db: ReturnType<typeof createDb>) =>
    buildApp({
      paypal: createMockClient(),
      db,
      merchant: { id: MERCHANT_ID, kid: "merchant-1", privateKey: merchantKey.privateKey },
      semanticFit: j1("match", 0.95),
      now: () => NOW,
    });

  test("approve, persist mandates/order/verdict, then reject the replay", async () => {
    await withPostgres(async ({ db, raw }) => {
      const app = appFor(db);
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
    });
  });

  // #155: two orders pending at the same time under one signed cap. Before the reservation both were created.
  test("two pending orders under one budget_cap: the second is refused, even when they arrive together", async () => {
    await withPostgres(async ({ db, raw }) => {
      const app = appFor(db);
      const capped = {
        ...greyJacketIntent,
        constraints: { ...greyJacketIntent.constraints, budget_cap: { value: 10000, currency: "USD" } },
      };
      const cartN = (n: number) => ({
        ...compliantCart,
        contents: { ...compliantCart.contents, cart_id: `cart-${n}` },
      });
      const send = async (n: number) =>
        app.inject({
          method: "POST",
          url: "/checkout",
          payload: (await signedCheckout({ shopper, agent, intent: capped, cart: cartN(n) })).body,
        });

      // Together: exactly one gets an order.
      const together = await Promise.all([send(1), send(2)]);
      expect(together.map((r) => r.json().verdict.outcome).sort()).toEqual(["APPROVE", "REJECT"]);
      expect((await raw.query("select status from orders")).rows).toEqual([{ status: "CREATED" }]);

      // One after the other, with the first still pending (nothing captured): refused.
      const later = await send(3);
      expect(later.json().verdict).toEqual({ outcome: "REJECT", reasons: ["BUDGET_EXCEEDED"] });
      expect((await raw.query("select count(*)::int as n from orders")).rows[0].n).toBe(1);

      // Released: once the first is voided, room is back.
      await raw.query("update orders set status = 'VOIDED'");
      expect((await send(4)).json().verdict.outcome).toBe("APPROVE");
      await app.close();
    });
  });
});
