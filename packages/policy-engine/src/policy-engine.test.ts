import { describe, expect, test } from "vitest";
import type { CartMandate, IntentMandate } from "@poi/contracts";
import { NOW, compliantCart, greyJacketIntent, overreachingCart } from "@poi/contracts/fixtures";
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

const withConstraints = (extra: Partial<IntentMandate["constraints"]>): IntentMandate => ({
  ...greyJacketIntent,
  constraints: { ...greyJacketIntent.constraints, ...extra },
});

const withLines = (cart: CartMandate, lines: CartMandate["contents"]["lines"]): CartMandate => ({
  ...cart,
  contents: {
    ...cart.contents,
    lines,
    total: { value: lines.reduce((n, l) => n + l.unit_price.value * l.quantity, 0), currency: "USD" },
  },
});

const usd = (value: number) => ({ value, currency: "USD" });

describe("policy engine: attributes", () => {
  test("the red $95 jacket also gives ATTRIBUTE_MISMATCH (journey B's two codes)", () => {
    expect(run(overreachingCart).reasons).toEqual(["AMOUNT_EXCEEDS_MAX", "ATTRIBUTE_MISMATCH"]);
  });

  test("comparison is case-insensitive on keys and values, and ignores surrounding spaces", () => {
    const [line] = compliantCart.contents.lines;
    const cart = withLines(compliantCart, [
      { ...line!, attributes: { Category: "Running-Jacket", COLOR: " Grey " } },
    ]);
    expect(run(cart)).toEqual({ pass: true, reasons: [] });
  });

  test("a line missing a constrained attribute fails", () => {
    const [line] = compliantCart.contents.lines;
    const cart = withLines(compliantCart, [{ ...line!, attributes: { category: "running-jacket" } }]);
    expect(run(cart).reasons).toEqual(["ATTRIBUTE_MISMATCH"]);
  });

  test("extra attributes on the line are fine", () => {
    const [line] = compliantCart.contents.lines;
    const cart = withLines(compliantCart, [{ ...line!, attributes: { ...line!.attributes, size: "M" } }]);
    expect(run(cart).pass).toBe(true);
  });

  test("every line must match, not just one", () => {
    const intent = withConstraints({ quantity_max: undefined, amount_max: undefined });
    const [grey] = compliantCart.contents.lines;
    const [red] = overreachingCart.contents.lines;
    expect(run(withLines(compliantCart, [grey!, red!]), intent).reasons).toEqual(["ATTRIBUTE_MISMATCH"]);
  });

  test("no attribute constraint, no attribute check", () => {
    const intent = withConstraints({ attributes: undefined, amount_max: undefined });
    expect(run(overreachingCart, intent).pass).toBe(true);
  });
});

describe("policy engine: sku_allowlist", () => {
  test("a SKU outside the allowlist is rejected", () => {
    const intent = withConstraints({ sku_allowlist: ["JKT-GRY-S"] });
    expect(run(compliantCart, intent).reasons).toEqual(["SKU_NOT_ALLOWED"]);
  });

  test("a SKU in the allowlist passes; matching is exact", () => {
    expect(run(compliantCart, withConstraints({ sku_allowlist: ["JKT-GRY-S", "JKT-GRY-M"] })).pass).toBe(
      true,
    );
    expect(run(compliantCart, withConstraints({ sku_allowlist: ["jkt-gry-m"] })).reasons).toEqual([
      "SKU_NOT_ALLOWED",
    ]);
  });
});

describe("policy engine: shipping address", () => {
  const intent = withConstraints({ shipping_address_hash: "a".repeat(64) });
  const shipTo = (hash?: string): CartMandate => ({
    ...compliantCart,
    contents: { ...compliantCart.contents, shipping_address_hash: hash },
  });

  test("a different address hash is rejected", () => {
    expect(run(shipTo("b".repeat(64)), intent).reasons).toEqual(["ADDRESS_MISMATCH"]);
  });

  test("the same hash passes", () => {
    expect(run(shipTo("a".repeat(64)), intent).pass).toBe(true);
  });

  test("a cart with no address can't prove it ships home", () => {
    expect(run(shipTo(undefined), intent).reasons).toEqual(["ADDRESS_MISMATCH"]);
  });

  test("no address constraint, any address", () => {
    expect(run(shipTo("b".repeat(64))).pass).toBe(true);
  });
});

describe("policy engine: budget_cap", () => {
  const intent = withConstraints({ budget_cap: usd(10000) });
  const prior = (capturedTotal: number) => ({ capturedTotal, capturedOrderTimes: [] });

  test("prior captures plus this cart over the cap is rejected", () => {
    const res = evaluate({ intent, cart: compliantCart, now: NOW, ledger: prior(5000) });
    expect(res.reasons).toEqual(["BUDGET_EXCEEDED"]);
  });

  test("boundary: landing exactly on the cap passes, one cent over fails", () => {
    expect(evaluate({ intent, cart: compliantCart, now: NOW, ledger: prior(2600) }).pass).toBe(true);
    expect(evaluate({ intent, cart: compliantCart, now: NOW, ledger: prior(2601) }).reasons).toEqual([
      "BUDGET_EXCEEDED",
    ]);
  });

  test("no ledger means no prior captures", () => {
    expect(run(compliantCart, intent).pass).toBe(true);
    expect(run(compliantCart, withConstraints({ budget_cap: usd(7399) })).reasons).toEqual([
      "BUDGET_EXCEEDED",
    ]);
  });

  test("a budget in another currency is a mismatch, even without amount_max", () => {
    const eur = withConstraints({ amount_max: undefined, budget_cap: { value: 10000, currency: "EUR" } });
    expect(run(compliantCart, eur).reasons).toEqual(["CURRENCY_MISMATCH"]);
  });
});

describe("policy engine: recurrence", () => {
  const intent = withConstraints({ recurrence: { max_orders: 2, window_days: 30 } });
  const times = (...capturedOrderTimes: string[]) => ({ capturedTotal: 0, capturedOrderTimes });
  const at = (...t: string[]) => evaluate({ intent, cart: compliantCart, now: NOW, ledger: times(...t) });

  test("the order that would go over max_orders in the window is rejected", () => {
    expect(at("2026-10-20T00:00:00Z").pass).toBe(true);
    expect(at("2026-10-20T00:00:00Z", "2026-11-01T12:00:00Z").reasons).toEqual(["RECURRENCE_EXCEEDED"]);
  });

  test("boundary: a capture exactly window_days ago has aged out, one second later it counts", () => {
    expect(at("2026-10-03T10:00:00Z", "2026-11-01T12:00:00Z").pass).toBe(true);
    expect(at("2026-10-03T10:00:01Z", "2026-11-01T12:00:00Z").reasons).toEqual(["RECURRENCE_EXCEEDED"]);
  });

  test("captures after now are ignored, so a replay at capture time matches checkout", () => {
    expect(at("2026-11-01T12:00:00Z", "2026-11-03T00:00:00Z").pass).toBe(true);
  });

  test("max_orders 1 with no ledger allows the first order", () => {
    expect(run(compliantCart, withConstraints({ recurrence: { max_orders: 1, window_days: 30 } })).pass).toBe(
      true,
    );
  });
});

describe("policy engine: everything at once", () => {
  test("every failing rule adds its code, in table order", () => {
    const intent = withConstraints({
      sku_allowlist: ["JKT-GRY-M"],
      shipping_address_hash: "a".repeat(64),
      budget_cap: usd(9000),
      recurrence: { max_orders: 1, window_days: 30 },
    });
    const res = evaluate({
      intent,
      cart: overreachingCart,
      now: NOW,
      ledger: { capturedTotal: 0, capturedOrderTimes: ["2026-11-01T12:00:00Z"] },
    });
    expect(res).toEqual({
      pass: false,
      reasons: [
        "AMOUNT_EXCEEDS_MAX",
        "ATTRIBUTE_MISMATCH",
        "SKU_NOT_ALLOWED",
        "ADDRESS_MISMATCH",
        "BUDGET_EXCEEDED",
        "RECURRENCE_EXCEEDED",
      ],
    });
  });
});
