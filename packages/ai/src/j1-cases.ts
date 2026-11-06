/**
 * Carts the J1 replay file must cover: every cart the tests, the sandbox scripts and the demo send through
 * checkout or the dispute copilot. `pnpm ai:record` asks the live model about each and writes the answers to
 * replay/j1-semantic-fit.json. The full labelled eval set (spec 0006: 20 cases) builds on this list.
 */
import type { CartMandate } from "@poi/contracts";
import { compliantCart, greyJacketIntent, overreachingCart, partialCart } from "@poi/contracts/fixtures";
import type { SemanticFit } from "./j1";

export interface J1Case {
  label: string;
  description: string;
  cart: CartMandate;
  /** What a person says the answer is. Used by evals; the replay stores what the model actually said. */
  expected: SemanticFit["fit"];
}

const words = greyJacketIntent.natural_language_description;

export const J1_CASES: J1Case[] = [
  {
    label: "grey running jacket, $74 (compliant fixture)",
    description: words,
    cart: compliantCart,
    expected: "match",
  },
  {
    label: "grey hooded rain shell, $79 (partial fixture)",
    description: words,
    cart: partialCart,
    expected: "partial",
  },
  {
    label: "red running jacket, $95 (overreach fixture)",
    description: words,
    cart: overreachingCart,
    expected: "mismatch",
  },
];
