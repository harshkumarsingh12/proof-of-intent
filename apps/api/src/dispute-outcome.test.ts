import { describe, expect, test } from "vitest";
import { outcomeOf } from "./routes/disputes";

/** #165: the dashboard's wins and refunds are read from how PayPal closed a dispute, which is in the stored PayPal object. */
const resolved = (dispute_outcome: unknown, status = "RESOLVED") => ({ status, paypal: { dispute_outcome } });

describe("outcomeOf: how PayPal closed a dispute", () => {
  test("seller's favour and buyer's favour, in either spelling", () => {
    expect(outcomeOf(resolved({ outcome_code: "RESOLVED_SELLER_FAVOUR" }))).toEqual({
      result: "SELLER_FAVOUR",
      code: "RESOLVED_SELLER_FAVOUR",
    });
    expect(outcomeOf(resolved({ outcome_code: "RESOLVED_SELLER_FAVOR" }))?.result).toBe("SELLER_FAVOUR");
    expect(outcomeOf(resolved({ outcome_code: "RESOLVED_BUYER_FAVOUR" }))?.result).toBe("BUYER_FAVOUR");
    expect(outcomeOf(resolved({ outcome_code: "RESOLVED_BUYER_FAVOR" }))?.result).toBe("BUYER_FAVOUR");
  });

  test("any other closure is OTHER, with PayPal's code kept", () => {
    expect(outcomeOf(resolved({ outcome_code: "CANCELED_BY_BUYER" }))).toEqual({
      result: "OTHER",
      code: "CANCELED_BY_BUYER",
    });
    expect(outcomeOf(resolved({ outcome_code: "RESOLVED_WITH_PAYOUT" }))?.result).toBe("OTHER");
  });

  test("reads the refunded amount in cents, and ignores one it can't read", () => {
    expect(
      outcomeOf(
        resolved({
          outcome_code: "RESOLVED_BUYER_FAVOUR",
          amount_refunded: { currency_code: "USD", value: "40.00" },
        }),
      )?.refunded,
    ).toEqual({ value: 4000, currency: "USD" });
    expect(
      outcomeOf(resolved({ outcome_code: "RESOLVED_BUYER_FAVOUR", amount_refunded: { currency_code: "USD", value: "n/a" } })),
    ).toEqual({ result: "BUYER_FAVOUR", code: "RESOLVED_BUYER_FAVOUR" });
  });

  test("nothing while the dispute is open, or when PayPal gave no outcome code", () => {
    expect(outcomeOf(resolved({ outcome_code: "RESOLVED_SELLER_FAVOUR" }, "UNDER_REVIEW"))).toBeUndefined();
    expect(outcomeOf(resolved({}))).toBeUndefined();
    expect(outcomeOf(resolved(undefined))).toBeUndefined();
    expect(outcomeOf({ status: "RESOLVED", paypal: null })).toBeUndefined();
  });
});
