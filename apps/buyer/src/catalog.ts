/**
 * What the merchant sells in the demo. The lines are the shared fixtures (packages/contracts/fixtures), so the
 * tests, the recorded J1 answers (packages/ai/replay) and the shop all talk about the same three jackets.
 */
import type { CartLine } from "@poi/contracts";
import { compliantCart, overreachingCart, partialCart } from "@poi/contracts/fixtures";

export interface Product {
  line: CartLine;
  blurb: string;
}

const first = (lines: CartLine[]): CartLine => {
  if (!lines[0]) throw new Error("fixture cart has no lines");
  return lines[0];
};

export const CATALOG: Product[] = [
  { line: first(compliantCart.contents.lines), blurb: "Lightweight, breathable, reflective trim." },
  { line: first(partialCart.contents.lines), blurb: "Waterproof shell with a packable hood." },
  { line: first(overreachingCart.contents.lines), blurb: "The same running jacket in red." },
];

export const productBySku = (sku: string): Product | undefined => CATALOG.find((p) => p.line.sku === sku);

/** Choices for the intent form, taken from what the catalog actually has. */
export const CATEGORIES = [...new Set(CATALOG.map((p) => p.line.attributes.category ?? ""))].filter(Boolean);
export const COLORS = [...new Set(CATALOG.map((p) => p.line.attributes.color ?? ""))].filter(Boolean);
