/**
 * The demo store, Trailhead Outfitters: what the shop sells, what the buyer agent can propose, what the demo seed
 * orders, and what the recorded J1 answers (packages/ai/replay) cover. One list, so all four agree.
 *
 * The first three products are the fixture carts' lines, unchanged: the tests, the video script and the scripted
 * disputes depend on them. Every product has exactly the attributes the hard rules compare (category, color).
 */
import type { CartLine, Money } from "./index";
import { compliantCart, greyJacketIntent, overreachingCart, partialCart } from "./fixtures";

export interface Product {
  line: CartLine;
  blurb: string;
}

/** A ready-made intent per category: the words the shopper starts from in the shop and in the demo seed. */
export interface ShopperPreset {
  category: string;
  /** For people: "Running jackets". */
  label: string;
  description: string;
  amountMax: Money;
  color: string;
}

const usd = (value: number): Money => ({ value, currency: "USD" });

const line = (sku: string, title: string, category: string, color: string, cents: number): CartLine => ({
  sku,
  title,
  attributes: { category, color },
  unit_price: usd(cents),
  quantity: 1,
});

const fixtureLine = (cart: typeof compliantCart): CartLine => {
  const l = cart.contents.lines[0];
  if (!l) throw new Error("fixture cart has no lines");
  return l;
};

export const CATALOG: Product[] = [
  // Running jackets. The fixtures: fits / related but different / breaks price and color.
  { line: fixtureLine(compliantCart), blurb: "Lightweight, breathable, reflective trim." },
  { line: fixtureLine(partialCart), blurb: "Waterproof shell with a packable hood." },
  { line: fixtureLine(overreachingCart), blurb: "The same running jacket in red." },
  {
    line: line("JKT-BLK-M", "Stride Running Jacket", "running-jacket", "black", 7400),
    blurb: "The same running jacket in black.",
  },
  {
    line: line("WND-GRY-M", "Packable Wind Jacket", "running-jacket", "grey", 6200),
    blurb: "Featherweight wind layer that packs into its pocket.",
  },
  // Road running shoes.
  {
    line: line("SHO-TMP-BLU-10", "Tempo Road Running Shoe, size 10", "running-shoe", "blue", 12000),
    blurb: "Cushioned daily trainer for the road.",
  },
  {
    line: line("SHO-TMP-GRY-10", "Tempo Road Running Shoe, size 10", "running-shoe", "grey", 12000),
    blurb: "The same trainer in grey.",
  },
  {
    line: line("SHO-RDG-BLU-10", "Ridge Trail Running Shoe, size 10", "running-shoe", "blue", 12800),
    blurb: "Lugged outsole for dirt and rock.",
  },
  // Base layers.
  {
    line: line("BSL-MER-GRY-M", "Merino Base Layer Top", "base-layer", "grey", 5800),
    blurb: "Merino wool, warm when wet, no odour.",
  },
  {
    line: line("BSL-SYN-GRY-M", "Quick-Dry Synthetic Base Layer Top", "base-layer", "grey", 3900),
    blurb: "Polyester base layer that dries fast.",
  },
  // Socks.
  {
    line: line("SOK-3PK-WHT", "Cushioned Running Socks, 3-pack", "socks", "white", 1800),
    blurb: "Three pairs, cushioned heel and toe.",
  },
  {
    line: line("SOK-6PK-WHT", "Cushioned Running Socks, 6-pack", "socks", "white", 3200),
    blurb: "Six pairs of the same socks.",
  },
];

export const PRESETS: ShopperPreset[] = [
  {
    category: "running-jacket",
    label: "Running jackets",
    description: greyJacketIntent.natural_language_description,
    amountMax: usd(8000),
    color: "grey",
  },
  {
    category: "running-shoe",
    label: "Road running shoes",
    description: "Blue road running shoes in size 10, under $130.",
    amountMax: usd(13000),
    color: "blue",
  },
  {
    category: "base-layer",
    label: "Base layers",
    description: "A grey merino wool base layer top for winter runs, under $60.",
    amountMax: usd(6000),
    color: "grey",
  },
  {
    category: "socks",
    label: "Running socks",
    description: "A 3-pack of white running socks under $20.",
    amountMax: usd(2000),
    color: "white",
  },
];

export const productBySku = (sku: string): Product | undefined => CATALOG.find((p) => p.line.sku === sku);

export const presetFor = (category: string): ShopperPreset | undefined =>
  PRESETS.find((p) => p.category === category);

export const productsIn = (category: string): Product[] =>
  CATALOG.filter((p) => p.line.attributes.category === category);

/** Every color the store stocks, for the intent form. */
export const COLORS = [...new Set(CATALOG.map((p) => p.line.attributes.color ?? ""))].filter(Boolean);
export const CATEGORIES = PRESETS.map((p) => p.category);

export const categoryLabel = (category: string): string => presetFor(category)?.label ?? category;
