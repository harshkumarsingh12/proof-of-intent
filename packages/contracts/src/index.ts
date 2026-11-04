/**
 * The integration contract. Every app and package imports types from here and nowhere else.
 * Changing this file needs an Accepted spec (docs/specs/0001, 0002) and review from the
 * contracts owner. See CONTRIBUTING.md, "The frozen contract".
 */
import { z } from "zod";

export const SCHEMA_VERSION = "poi/0.1";

const isoDateTime = z.string().datetime({ offset: true });
const sha256Hex = z.string().regex(/^[0-9a-f]{64}$/, "lowercase hex SHA-256");

/** Money is always integer minor units (cents) plus an ISO 4217 code. Never floats. */
export const Money = z.object({
  value: z.number().int().nonnegative(),
  currency: z.string().regex(/^[A-Z]{3}$/),
});
export type Money = z.infer<typeof Money>;

/** Stable reason codes. The same strings appear in API responses, the copilot and the dashboard. */
export const ReasonCode = z.enum([
  // structural and cryptographic
  "SCHEMA_INVALID",
  "SIGNATURE_INVALID",
  "UNKNOWN_KEY",
  "NONCE_REPLAYED",
  "MANDATE_MISMATCH",
  // freshness
  "MANDATE_NOT_YET_VALID",
  "MANDATE_EXPIRED",
  "CART_EXPIRED",
  // hard constraints
  "CURRENCY_MISMATCH",
  "AMOUNT_EXCEEDS_MAX",
  "BUDGET_EXCEEDED",
  "MERCHANT_NOT_ALLOWED",
  "SKU_NOT_ALLOWED",
  "ATTRIBUTE_MISMATCH",
  "QUANTITY_EXCEEDS_MAX",
  "ADDRESS_MISMATCH",
  "RECURRENCE_EXCEEDED",
  // semantic (LLM, downgrade only)
  "SEMANTIC_UNCERTAIN",
  "SEMANTIC_MISMATCH",
]);
export type ReasonCode = z.infer<typeof ReasonCode>;

/** Machine-checkable limits. Modeled on Mastercard Verifiable Intent constraint types. */
export const Constraints = z.object({
  amount_max: Money.optional(),
  budget_cap: Money.optional(),
  merchant_allowlist: z.array(z.string()).optional(),
  sku_allowlist: z.array(z.string()).optional(),
  attributes: z.record(z.string()).optional(),
  quantity_max: z
    .object({
      per_line: z.number().int().positive().optional(),
      per_order: z.number().int().positive().optional(),
    })
    .optional(),
  shipping_address_hash: sha256Hex.optional(),
  recurrence: z
    .object({
      max_orders: z.number().int().positive(),
      window_days: z.number().int().positive(),
    })
    .optional(),
  valid_from: isoDateTime,
});
export type Constraints = z.infer<typeof Constraints>;

/** Signed by the shopper. AP2 v0.1 core field names plus our constraints extension. */
export const IntentMandate = z.object({
  mandate_id: z.string().uuid(),
  issuer: z.string().min(1),
  nonce: z.string().min(16),
  created_at: isoDateTime,
  schema_version: z.literal(SCHEMA_VERSION),
  user_cart_confirmation_required: z.boolean(),
  natural_language_description: z.string().min(1).max(2000),
  merchants: z.array(z.string()).optional(),
  skus: z.array(z.string()).optional(),
  requires_refundability: z.boolean().optional(),
  intent_expiry: isoDateTime,
  constraints: Constraints,
});
export type IntentMandate = z.infer<typeof IntentMandate>;

export const CartLine = z.object({
  sku: z.string().min(1),
  title: z.string().min(1),
  attributes: z.record(z.string()),
  unit_price: Money,
  quantity: z.number().int().positive(),
});
export type CartLine = z.infer<typeof CartLine>;

/** Signed by the merchant, only after the hard rules pass. */
export const CartMandate = z.object({
  contents: z.object({
    cart_id: z.string().min(1),
    merchant_id: z.string().min(1),
    merchant_name: z.string().min(1),
    lines: z.array(CartLine).min(1),
    total: Money,
    shipping_address_hash: sha256Hex.optional(),
    cart_expiry: isoDateTime,
  }),
  intent_mandate_id: z.string().uuid(),
  intent_mandate_hash: sha256Hex,
});
export type CartMandate = z.infer<typeof CartMandate>;

/** Signed by the buyer agent. */
export const PaymentMandate = z.object({
  payment_mandate_id: z.string().uuid(),
  cart_mandate_hash: sha256Hex,
  intent_mandate_hash: sha256Hex,
  agent_key_id: z.string().min(1),
  agent_platform: z.string().min(1),
  human_present: z.boolean(),
  timestamp: isoDateTime,
});
export type PaymentMandate = z.infer<typeof PaymentMandate>;

export const Outcome = z.enum(["APPROVE", "STEP_UP", "REJECT"]);
export type Outcome = z.infer<typeof Outcome>;

export const Verdict = z.object({
  outcome: Outcome,
  reasons: z.array(ReasonCode),
});
export type Verdict = z.infer<typeof Verdict>;

/**
 * POST /checkout (docs/specs/0003). The cart is the agent's proposal, unsigned: the merchant signs it as the
 * Cart Mandate only after it passes. The Payment Mandate commits to it by hash.
 */
export const CheckoutRequest = z.object({
  intent_jws: z.string().min(1),
  payment_mandate_jws: z.string().min(1),
  cart: z.unknown(),
});
export type CheckoutRequest = z.infer<typeof CheckoutRequest>;

export const CheckoutResponse = z.object({
  verdict: Verdict,
  order_id: z.string().optional(),
  cart_mandate_jws: z.string().optional(),
  paypal_order_id: z.string().optional(),
  /** Human present: where the shopper approves with PayPal. */
  approval_url: z.string().url().optional(),
});
export type CheckoutResponse = z.infer<typeof CheckoutResponse>;

/**
 * The shopper's countersignature at human-present approval (docs/specs/0001, 0003 stage 2), signed with the
 * same key as their Intent Mandate. It binds "I approved on PayPal" to this order and this exact cart.
 */
export const CartApproval = z.object({
  order_id: z.string().min(1),
  cart_mandate_hash: sha256Hex,
  approved_at: isoDateTime,
});
export type CartApproval = z.infer<typeof CartApproval>;

/** POST /checkout/:id/approve, sent by the buyer app from PayPal's onApprove. */
export const ApproveRequest = z.object({ approval_jws: z.string().min(1) });
export type ApproveRequest = z.infer<typeof ApproveRequest>;

export const ApproveResponse = z.object({
  status: z.enum(["CAPTURED", "VOIDED"]),
  capture_id: z.string().optional(),
  /** Why the authorization was voided. */
  reasons: z.array(ReasonCode).optional(),
});
export type ApproveResponse = z.infer<typeof ApproveResponse>;

export const DisputeClass = z.enum(["MANDATE_COMPLIANT", "AGENT_OVERREACH", "INTENT_MISREAD", "NO_MANDATE"]);
export type DisputeClass = z.infer<typeof DisputeClass>;

/** Thrown by stubs so a half-built path fails loudly and says who to ask. */
export class NotImplementedError extends Error {
  constructor(what: string, owner: string, spec: string) {
    super(`${what} is not implemented yet (owner: @${owner}, spec: ${spec})`);
    this.name = "NotImplementedError";
  }
}
