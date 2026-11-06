/**
 * What the buyer agent sends to the merchant (spec 0003): a proposed cart bound to the shopper's intent, and a
 * Payment Mandate that commits to both by hash. Pure; the agent server adds the key and the clock.
 */
import type { CartMandate, IntentMandate, PaymentMandate } from "@poi/contracts";
import { mandateHash } from "@poi/mandates";
import { productBySku } from "./catalog";

export interface Merchant {
  id: string;
  name: string;
}

/** How long the merchant's Cart Mandate stays valid: long enough to log in to PayPal and approve. */
export const CART_TTL_MS = 30 * 60_000;

export function proposeCart(
  intent: IntentMandate,
  sku: string,
  ctx: { merchant: Merchant; now: Date; cartId: string },
): CartMandate {
  const product = productBySku(sku);
  if (!product) throw new Error(`Unknown product ${sku}`);
  const line = { ...product.line, quantity: 1 };
  return {
    contents: {
      cart_id: ctx.cartId,
      merchant_id: ctx.merchant.id,
      merchant_name: ctx.merchant.name,
      lines: [line],
      total: { value: line.unit_price.value * line.quantity, currency: line.unit_price.currency },
      cart_expiry: new Date(ctx.now.getTime() + CART_TTL_MS).toISOString(),
    },
    intent_mandate_id: intent.mandate_id,
    intent_mandate_hash: mandateHash(intent),
  };
}

export function paymentMandate(
  intent: IntentMandate,
  cart: CartMandate,
  ctx: { agentKid: string; platform: string; humanPresent: boolean; now: Date; id: string },
): PaymentMandate {
  return {
    payment_mandate_id: ctx.id,
    cart_mandate_hash: mandateHash(cart),
    intent_mandate_hash: mandateHash(intent),
    agent_key_id: ctx.agentKid,
    agent_platform: ctx.platform,
    human_present: ctx.humanPresent,
    timestamp: ctx.now.toISOString(),
  };
}
