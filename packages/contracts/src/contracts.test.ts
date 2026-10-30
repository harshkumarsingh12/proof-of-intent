import { describe, expect, test } from "vitest";
import { CartMandate, IntentMandate, Money } from "./index";
import { compliantCart, greyJacketIntent, overreachingCart, partialCart } from "./fixtures";

describe("contracts", () => {
  test("fixtures satisfy their schemas", () => {
    expect(IntentMandate.parse(greyJacketIntent)).toEqual(greyJacketIntent);
    for (const c of [compliantCart, overreachingCart, partialCart]) CartMandate.parse(c);
  });

  test("money rejects floats and lowercase currency", () => {
    expect(Money.safeParse({ value: 79.99, currency: "USD" }).success).toBe(false);
    expect(Money.safeParse({ value: 7999, currency: "usd" }).success).toBe(false);
  });

  test("intent mandate requires the current schema version", () => {
    const bad = { ...greyJacketIntent, schema_version: "poi/0.0" };
    expect(IntentMandate.safeParse(bad).success).toBe(false);
  });
});
