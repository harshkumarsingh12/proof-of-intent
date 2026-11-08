import { describe, expect, test } from "vitest";
import type { CartMandate, IntentMandate } from "@poi/contracts";
import { NOW, compliantCart, greyJacketIntent, overreachingCart } from "@poi/contracts/fixtures";
import { evaluate, freshness } from "./index";

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

describe("policy engine: quantity_max.per_order", () => {
  // per_line 2 lets every line below through, so only the order's total quantity can fail.
  const perOrderIntent = withConstraints({ quantity_max: { per_line: 2, per_order: 3 } });
  // Only quantities change; the total stays the compliant one, so no money rule can fire.
  const withQuantities = (...quantities: number[]): CartMandate => {
    const [line] = compliantCart.contents.lines;
    if (!line) throw new Error("the compliant cart fixture has no line");
    return {
      ...compliantCart,
      contents: { ...compliantCart.contents, lines: quantities.map((quantity) => ({ ...line, quantity })) },
    };
  };

  test("every line within per_line but the order over per_order is rejected", () => {
    expect(run(withQuantities(2, 2), perOrderIntent).reasons).toEqual(["QUANTITY_EXCEEDS_MAX"]);
  });

  test("boundary: an order exactly at per_order passes", () => {
    expect(run(withQuantities(2, 1), perOrderIntent)).toEqual({ pass: true, reasons: [] });
  });
});

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

describe("freshness: the time rules stage-two approval re-runs before capture (#161)", () => {
  // valid_from Nov 1 09:00, intent_expiry Nov 8 00:00, cart_expiry Nov 2 10:15 in the fixtures.
  const instants = [
    "2026-11-01T08:59:59Z",
    "2026-11-01T09:00:00Z",
    NOW,
    "2026-11-02T10:15:00Z",
    "2026-11-07T23:59:59Z",
    "2026-11-08T00:00:00Z",
    "2026-11-09T00:00:00Z",
  ];
  const timeReasons = ["MANDATE_NOT_YET_VALID", "MANDATE_EXPIRED", "CART_EXPIRED"];

  test("reports exactly the time reasons evaluate reports, in the same order, at every instant", () => {
    for (const now of instants) {
      const mine = freshness({ intent: greyJacketIntent, cart: compliantCart, now });
      const theirs = run(compliantCart, greyJacketIntent, now).reasons.filter((r) => timeReasons.includes(r));
      expect(mine, now).toEqual(theirs);
    }
  });

  test("boundaries: valid at the start instant, expired at the expiry instant", () => {
    const fresh = (now: string) => freshness({ intent: greyJacketIntent, cart: compliantCart, now });
    expect(fresh("2026-11-01T08:59:59Z")).toEqual(["MANDATE_NOT_YET_VALID"]);
    expect(fresh("2026-11-01T09:00:00Z")).toEqual([]);
    expect(fresh("2026-11-02T10:15:00Z")).toEqual(["CART_EXPIRED"]);
    // After the cart has expired and the intent too, both are reported.
    expect(fresh("2026-11-08T00:00:00Z")).toEqual(["MANDATE_EXPIRED", "CART_EXPIRED"]);
  });

  test("an expired intent is reported even when the cart is still valid (the cart's expiry is the agent's choice)", () => {
    const longCart = {
      ...compliantCart,
      contents: { ...compliantCart.contents, cart_expiry: "2026-12-01T00:00:00Z" },
    };
    expect(freshness({ intent: greyJacketIntent, cart: longCart, now: "2026-11-09T00:00:00Z" })).toEqual([
      "MANDATE_EXPIRED",
    ]);
  });
});

describe("policy engine: one purchase by default (#156)", () => {
  const oneBought = { capturedTotal: 7400, capturedOrderTimes: [NOW] };
  const withConstraints = (extra: Partial<IntentMandate["constraints"]>): IntentMandate => ({
    ...greyJacketIntent,
    constraints: { ...greyJacketIntent.constraints, ...extra },
  });

  test("the first purchase passes, with no ledger or an empty one", () => {
    expect(evaluate({ intent: greyJacketIntent, cart: compliantCart, now: NOW }).pass).toBe(true);
    const empty = { capturedTotal: 0, capturedOrderTimes: [] };
    expect(evaluate({ intent: greyJacketIntent, cart: compliantCart, now: NOW, ledger: empty }).pass).toBe(
      true,
    );
  });

  test("a second purchase under an intent with no budget and no recurrence is refused", () => {
    expect(evaluate({ intent: greyJacketIntent, cart: compliantCart, now: NOW, ledger: oneBought })).toEqual({
      pass: false,
      reasons: ["INTENT_ALREADY_USED"],
    });
  });

  test("a signed budget_cap or recurrence is the permission for more than one, and then they govern", () => {
    const budget = withConstraints({ budget_cap: { value: 20000, currency: "USD" } });
    expect(evaluate({ intent: budget, cart: compliantCart, now: NOW, ledger: oneBought }).pass).toBe(true);
    const overBudget = withConstraints({ budget_cap: { value: 10000, currency: "USD" } });
    expect(
      evaluate({ intent: overBudget, cart: compliantCart, now: NOW, ledger: oneBought }).reasons,
    ).toEqual(["BUDGET_EXCEEDED"]);
    const three = withConstraints({ recurrence: { max_orders: 3, window_days: 30 } });
    expect(evaluate({ intent: three, cart: compliantCart, now: NOW, ledger: oneBought }).pass).toBe(true);
  });

  test("it is reported with the other reasons, not instead of them", () => {
    const res = evaluate({ intent: greyJacketIntent, cart: overreachingCart, now: NOW, ledger: oneBought });
    expect(res.reasons).toEqual(expect.arrayContaining(["AMOUNT_EXCEEDS_MAX", "INTENT_ALREADY_USED"]));
  });
});
