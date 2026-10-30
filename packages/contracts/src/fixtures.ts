/**
 * Canonical demo data. The same fixtures seed mock mode, the tests and the demo,
 * so what judges see is what the tests exercise.
 */
import type { CartLine, CartMandate, IntentMandate } from "./index";

export const MERCHANT_ID = "merchant-trailhead";
export const NOW = "2026-11-02T10:00:00Z";

export const greyJacketIntent: IntentMandate = {
  mandate_id: "0192f3a0-0000-7000-8000-000000000001",
  issuer: "shopper-key-1",
  nonce: "n-7f3c9a1e5b2d4c6a",
  created_at: "2026-11-01T09:00:00Z",
  schema_version: "poi/0.1",
  user_cart_confirmation_required: false,
  natural_language_description: "Find me a grey running jacket under $80, ship to my home address.",
  intent_expiry: "2026-11-08T00:00:00Z",
  constraints: {
    amount_max: { value: 8000, currency: "USD" },
    merchant_allowlist: [MERCHANT_ID],
    attributes: { category: "running-jacket", color: "grey" },
    quantity_max: { per_line: 1, per_order: 1 },
    valid_from: "2026-11-01T09:00:00Z",
  },
};

const line = (sku: string, title: string, color: string, cents: number): CartLine => ({
  sku,
  title,
  attributes: { category: "running-jacket", color },
  unit_price: { value: cents, currency: "USD" },
  quantity: 1,
});

const cart = (id: string, l: CartLine): CartMandate => ({
  contents: {
    cart_id: id,
    merchant_id: MERCHANT_ID,
    merchant_name: "Trailhead Outfitters",
    lines: [l],
    total: l.unit_price,
    cart_expiry: "2026-11-02T10:15:00Z",
  },
  intent_mandate_id: greyJacketIntent.mandate_id,
  intent_mandate_hash: "0".repeat(64),
});

/** Fits the intent: grey, $74. */
export const compliantCart = cart("cart-compliant", line("JKT-GRY-M", "Stride Running Jacket", "grey", 7400));

/** Journey B / D: red, $95. Breaks amount_max and the color attribute. */
export const overreachingCart = cart("cart-overreach", line("JKT-RED-M", "Stride Running Jacket", "red", 9500));

/** Hard rules pass; the semantic check should say "partial" (a hooded rain shell, not a running jacket). */
export const partialCart = cart("cart-partial", line("SHL-GRY-M", "Hooded Rain Shell", "grey", 7900));
