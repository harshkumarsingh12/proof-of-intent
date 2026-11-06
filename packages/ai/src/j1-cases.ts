/**
 * Carts the J1 replay file must cover: for every category's demo words (PRESETS in
 * packages/contracts/src/catalog.ts), every product in that category. That's every cart the shop, the tests and the
 * demo can send to J1 with the shop's default words: a product from another category, or in another color, fails
 * a hard rule first and never reaches J1. `pnpm ai:record` asks the live model about the ones without a
 * recording and writes the answers to replay/j1-semantic-fit.json.
 */
import type { CartMandate } from "@poi/contracts";
import { PRESETS, productsIn } from "@poi/contracts/catalog";
import { compliantCart } from "@poi/contracts/fixtures";
import type { SemanticFit } from "./j1";

export interface J1Case {
  label: string;
  description: string;
  cart: CartMandate;
  /** What a person says the answer is. Used by evals; the replay stores what the model actually said. */
  expected: SemanticFit["fit"];
}

/** A person's label for each product against its category's demo words. */
const EXPECTED: Record<string, SemanticFit["fit"]> = {
  "JKT-GRY-M": "match",
  "SHL-GRY-M": "partial", // a rain shell is not a running jacket
  "JKT-RED-M": "mismatch", // red, and over $80
  "JKT-BLK-M": "mismatch", // black, not grey
  "WND-GRY-M": "partial", // a wind shell, not a running jacket
  "SHO-TMP-BLU-10": "match",
  "SHO-TMP-GRY-10": "mismatch", // grey, not blue
  "SHO-RDG-BLU-10": "partial", // trail, not road
  "BSL-MER-GRY-M": "match",
  "BSL-SYN-GRY-M": "partial", // synthetic, not merino
  "SOK-3PK-WHT": "match",
  "SOK-6PK-WHT": "partial", // a 6-pack, not a 3-pack (and over $20)
};

/** The cart J1 sees for one product: one line, quantity 1. Ids don't matter; they aren't in the replay key. */
const cartOf = (line: CartMandate["contents"]["lines"][number]): CartMandate => ({
  ...compliantCart,
  contents: { ...compliantCart.contents, lines: [line], total: line.unit_price },
});

const money = (cents: number) => `$${(cents / 100).toFixed(0)}`;

export const J1_CASES: J1Case[] = PRESETS.flatMap((preset) =>
  productsIn(preset.category).map(({ line }) => {
    const expected = EXPECTED[line.sku];
    if (!expected) throw new Error(`j1-cases: no expected label for ${line.sku}`);
    return {
      label: `${line.sku} ${line.attributes.color} ${line.title}, ${money(line.unit_price.value)} vs "${preset.description}"`,
      description: preset.description,
      cart: cartOf(line),
      expected,
    };
  }),
);
