import { describe, expect, test } from "vitest";
import { CATALOG } from "./catalog";
import { buildIntent } from "./intent";
import { nearMiss } from "./near-miss";

const jacketLimits = { maxCents: 8000, category: "running-jacket", color: "grey" };
const redJacket = CATALOG.find((p) => p.line.attributes.color === "red")!.line;
const price = (sku: string) => CATALOG.find((p) => p.line.sku === sku)!.line.unit_price.value;

describe("nearMiss", () => {
  test("a refusal that isn't about the shopper's limits gets no hint", () => {
    for (const reasons of [["MANDATE_EXPIRED"], ["SIGNATURE_INVALID"], ["NONCE_REPLAYED"], []] as const) {
      expect(nearMiss({ sku: redJacket.sku, reasons: [...reasons], limits: jacketLimits })).toBeUndefined();
    }
    expect(nearMiss({ sku: "NOPE", reasons: ["AMOUNT_EXCEEDS_MAX"], limits: jacketLimits })).toBeUndefined();
  });

  test("too dear: names the price and limit, the alternative that fits, and a raise that keeps item and color", () => {
    const sku = "SHO-RDG-BLU-10";
    const hint = nearMiss({
      sku,
      reasons: ["AMOUNT_EXCEEDS_MAX"],
      limits: { maxCents: 12000, category: "running-shoe", color: "blue" },
    })!;
    expect(hint.text).toContain("$128.00");
    expect(hint.text).toContain("$120.00");
    expect(hint.alternative?.sku).toBe("SHO-TMP-BLU-10");
    expect(hint.apply?.patch).toEqual({
      maxPrice: "128",
      category: "running-shoe",
      color: "blue",
      description: "Blue road running shoes under $128.",
    });
  });

  test("a red jacket against grey-jacket limits: color and price, offers limits for red at its price", () => {
    const hint = nearMiss({
      sku: redJacket.sku,
      reasons: ["AMOUNT_EXCEEDS_MAX", "ATTRIBUTE_MISMATCH"],
      limits: jacketLimits,
    })!;
    expect(hint.text).toContain("comes in red");
    expect(hint.text).toContain("signed limits for grey running jackets");
    expect(hint.text).toContain("raises your cap");
    expect(hint.apply?.patch.color).toBe("red");
    expect(hint.apply?.patch.category).toBe("running-jacket");
    expect(Number(hint.apply?.patch.maxPrice) * 100).toBe(redJacket.unit_price.value);
    // The closest product that already fits is a grey jacket under the cap.
    expect(hint.alternative).toBeDefined();
    expect(hint.alternative!.price_cents).toBeLessThanOrEqual(8000);
  });

  test("another kind of item: says so, never lowers the cap, and fills limits for that item", () => {
    const hint = nearMiss({
      sku: "SOK-3PK-WHT",
      reasons: ["ATTRIBUTE_MISMATCH"],
      limits: jacketLimits,
    })!;
    expect(hint.text).toContain("is running socks");
    expect(hint.text).not.toContain("raises your cap");
    expect(hint.apply?.patch).toEqual({
      maxPrice: "80",
      category: "socks",
      color: "white",
      description: "White running socks under $80.",
    });
  });

  test("no alternative when nothing in the store fits the signed limits", () => {
    const hint = nearMiss({
      sku: "SHO-RDG-BLU-10",
      reasons: ["AMOUNT_EXCEEDS_MAX"],
      limits: { maxCents: 500, category: "running-shoe", color: "blue" },
    })!;
    expect(hint.alternative).toBeUndefined();
    expect(hint.text).not.toContain("already fits");
  });

  test("every figure in the text is the catalog's or the limits'", () => {
    for (const p of CATALOG) {
      const hint = nearMiss({ sku: p.line.sku, reasons: ["AMOUNT_EXCEEDS_MAX"], limits: { maxCents: 1000 } });
      for (const m of hint?.text.matchAll(/\$(\d+\.\d\d)/g) ?? []) {
        const cents = Math.round(Number(m[1]) * 100);
        expect([1000, ...CATALOG.map((c) => c.line.unit_price.value)]).toContain(cents);
      }
    }
  });

  test("deterministic, and the patch always builds a valid intent", () => {
    const args = { sku: redJacket.sku, reasons: ["AMOUNT_EXCEEDS_MAX" as const], limits: jacketLimits };
    expect(nearMiss(args)).toEqual(nearMiss(args));
    for (const p of CATALOG) {
      for (const reasons of [["AMOUNT_EXCEEDS_MAX"], ["ATTRIBUTE_MISMATCH"]] as const) {
        const patch = nearMiss({ sku: p.line.sku, reasons: [...reasons], limits: jacketLimits })?.apply?.patch;
        if (!patch) continue;
        expect(() =>
          buildIntent(
            { ...patch, validDays: 7, confirmEachCart: false },
            { kid: "k", merchantId: "m", now: new Date(), mandateId: crypto.randomUUID(), nonce: "n".repeat(16) },
          ),
        ).not.toThrow();
        expect(Number(patch.maxPrice) * 100).toBeGreaterThanOrEqual(Math.min(8000, price(p.line.sku)));
      }
    }
  });
});
