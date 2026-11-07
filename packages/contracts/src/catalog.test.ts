import { describe, expect, test } from "vitest";
import { CATALOG, catalogMismatches } from "./catalog";
import { compliantCart, overreachingCart, partialCart } from "./fixtures";

const jacket = compliantCart.contents.lines[0]!;

describe("catalogMismatches (#158): what the merchant's catalog doesn't back", () => {
  test("every product's own line, and the three fixture carts, match", () => {
    for (const p of CATALOG) expect(catalogMismatches([p.line])).toEqual([]);
    for (const cart of [compliantCart, overreachingCart, partialCart])
      expect(catalogMismatches(cart.contents.lines)).toEqual([]);
  });

  test("a real SKU at a different price is a unit_price mismatch, the case that let a one-cent jacket through", () => {
    expect(catalogMismatches([{ ...jacket, unit_price: { value: 1, currency: "USD" } }])).toEqual([
      {
        sku: "JKT-GRY-M",
        field: "unit_price",
        cart: { value: 1, currency: "USD" },
        catalog: { value: 7400, currency: "USD" },
      },
    ]);
  });

  test("the currency is part of the price", () => {
    const [m] = catalogMismatches([{ ...jacket, unit_price: { value: 7400, currency: "EUR" } }]);
    expect(m?.field).toBe("unit_price");
  });

  test("a SKU the merchant doesn't sell is a sku mismatch", () => {
    expect(catalogMismatches([{ ...jacket, sku: "JKT-GRY-L" }])).toEqual([
      { sku: "JKT-GRY-L", field: "sku", cart: "JKT-GRY-L" },
    ]);
  });

  test("a different title is a mismatch", () => {
    expect(catalogMismatches([{ ...jacket, title: "Trail Running Vest" }])).toMatchObject([
      { sku: "JKT-GRY-M", field: "title", cart: "Trail Running Vest", catalog: "Stride Running Jacket" },
    ]);
  });

  test("attributes must be exactly the product's: a changed value, a missing key and an extra key all differ", () => {
    const withAttrs = (attributes: Record<string, string>) => catalogMismatches([{ ...jacket, attributes }]);
    expect(withAttrs({ category: "running-jacket", color: "red" })[0]?.field).toBe("attributes");
    expect(withAttrs({ category: "running-jacket" })[0]?.field).toBe("attributes");
    expect(withAttrs({ category: "running-jacket", color: "grey", note: "approved by the shopper" })[0]?.field).toBe(
      "attributes",
    );
    // The comparison is exact, not case-folded like the policy engine's attribute rule.
    expect(withAttrs({ category: "running-jacket", color: "Grey" })[0]?.field).toBe("attributes");
  });

  test("quantity is the shopper's choice and is not compared", () => {
    expect(catalogMismatches([{ ...jacket, quantity: 3 }])).toEqual([]);
  });

  test("every differing fact on every line is reported", () => {
    const wrong = { ...jacket, title: "x", unit_price: { value: 1, currency: "USD" } };
    const unknown = { ...jacket, sku: "NOPE" };
    expect(catalogMismatches([wrong, jacket, unknown]).map((m) => `${m.sku}:${m.field}`)).toEqual([
      "JKT-GRY-M:title",
      "JKT-GRY-M:unit_price",
      "NOPE:sku",
    ]);
  });

  test("another merchant's catalog can be supplied, and then the demo store's products are the unknown ones", () => {
    const vest = { ...jacket, sku: "VST-1", title: "Trail Running Vest" };
    expect(catalogMismatches([vest], [vest])).toEqual([]);
    expect(catalogMismatches([jacket], [vest])).toEqual([{ sku: "JKT-GRY-M", field: "sku", cart: "JKT-GRY-M" }]);
  });
});
