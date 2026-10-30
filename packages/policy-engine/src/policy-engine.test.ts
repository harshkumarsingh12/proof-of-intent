import { describe, expect, test } from "vitest";
import type { CartMandate, IntentMandate } from "@poi/contracts";
import { NOW, compliantCart, greyJacketIntent, overreachingCart } from "@poi/contracts/fixtures";
import { ledger } from "@poi/ledger";
import { evaluate } from "./index";

const run = (cart: CartMandate, intent: IntentMandate = greyJacketIntent, now = NOW) =>
  evaluate({ intent, cart, now });

const withTotal = (cart: CartMandate, value: number, currency = "USD"): CartMandate => ({
  ...cart,
  contents: {
    ...cart.contents,
    total: { value, currency },
    lines: cart.contents.lines.map((l) => ({ ...l, unit_price: { value, currency } })),
  },
});

describe("policy engine: built rules", () => {
  test("a compliant cart passes with no reasons", () => {
    expect(run(compliantCart)).toEqual({ pass: true, reasons: [] });
  });

  test("the red $95 jacket exceeds amount_max", () => {
    expect(run(overreachingCart).reasons).toContain("AMOUNT_EXCEEDS_MAX");
  });

  test("amount boundary: exactly the max passes, one cent over fails", () => {
    expect(run(withTotal(compliantCart, 8000)).pass).toBe(true);
    expect(run(withTotal(compliantCart, 8001)).reasons).toEqual(["AMOUNT_EXCEEDS_MAX"]);
  });

  test("a different currency is a mismatch, not a cheap order", () => {
    expect(run(withTotal(compliantCart, 100, "EUR")).reasons).toEqual(["CURRENCY_MISMATCH"]);
  });

  test("a merchant outside the allowlist is rejected", () => {
    const cart = { ...compliantCart, contents: { ...compliantCart.contents, merchant_id: "other" } };
    expect(run(cart).reasons).toEqual(["MERCHANT_NOT_ALLOWED"]);
  });

  test("quantity over per_line is rejected", () => {
    const lines = compliantCart.contents.lines.map((l) => ({ ...l, quantity: 2 }));
    const cart = { ...compliantCart, contents: { ...compliantCart.contents, lines } };
    expect(run(cart).reasons).toContain("QUANTITY_EXCEEDS_MAX");
  });

  test("freshness: before valid_from, at expiry, and after cart expiry", () => {
    expect(run(compliantCart, greyJacketIntent, "2026-11-01T08:59:59Z").reasons).toContain(
      "MANDATE_NOT_YET_VALID",
    );
    expect(run(compliantCart, greyJacketIntent, greyJacketIntent.intent_expiry).reasons).toContain(
      "MANDATE_EXPIRED",
    );
    expect(run(compliantCart, greyJacketIntent, "2026-11-02T10:15:00Z").reasons).toEqual(["CART_EXPIRED"]);
  });

  test("a cart pointing at a different intent mandate is rejected", () => {
    const cart = { ...compliantCart, intent_mandate_id: "0192f3a0-0000-7000-8000-00000000ffff" };
    expect(run(cart).reasons).toContain("MANDATE_MISMATCH");
  });

  test("same inputs, same verdict (replayable by the dispute copilot)", () => {
    expect(run(overreachingCart)).toEqual(run(overreachingCart));
  });
});

describe("policy engine: unbuilt rules", () => {
  ledger("M1", "srshriv", "color attribute mismatch gives ATTRIBUTE_MISMATCH", () => {
    expect(run(overreachingCart).reasons).toContain("ATTRIBUTE_MISMATCH");
  });

  ledger("M1", "srshriv", "budget_cap counts prior captured orders", () => {
    const intent = { ...greyJacketIntent, constraints: { ...greyJacketIntent.constraints, budget_cap: { value: 10000, currency: "USD" } } };
    const res = evaluate({ intent, cart: compliantCart, now: NOW, ledger: { capturedTotal: 5000, capturedOrderTimes: [] } });
    expect(res.reasons).toContain("BUDGET_EXCEEDED");
  });

  ledger("M1", "srshriv", "recurrence limits orders per window", () => {
    const intent = { ...greyJacketIntent, constraints: { ...greyJacketIntent.constraints, recurrence: { max_orders: 1, window_days: 30 } } };
    const res = evaluate({ intent, cart: compliantCart, now: NOW, ledger: { capturedTotal: 0, capturedOrderTimes: ["2026-11-01T12:00:00Z"] } });
    expect(res.reasons).toContain("RECURRENCE_EXCEEDED");
  });

  ledger("M1", "srshriv", "shipping address hash must match the mandate", () => {
    const intent = { ...greyJacketIntent, constraints: { ...greyJacketIntent.constraints, shipping_address_hash: "a".repeat(64) } };
    const cart = { ...compliantCart, contents: { ...compliantCart.contents, shipping_address_hash: "b".repeat(64) } };
    expect(evaluate({ intent, cart, now: NOW }).reasons).toContain("ADDRESS_MISMATCH");
  });

  ledger("M1", "srshriv", "sku_allowlist rejects other SKUs", () => {
    const intent = { ...greyJacketIntent, constraints: { ...greyJacketIntent.constraints, sku_allowlist: ["JKT-GRY-S"] } };
    expect(evaluate({ intent, cart: compliantCart, now: NOW }).reasons).toContain("SKU_NOT_ALLOWED");
  });
});
