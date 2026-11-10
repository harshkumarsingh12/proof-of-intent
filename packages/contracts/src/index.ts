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
  // an intent that signs no budget and no recurrence authorizes one purchase, and it has been made (docs/specs/0002, #156)
  "INTENT_ALREADY_USED",
  // the merchant's own facts: a cart line that its catalog doesn't back (docs/specs/0003, #158)
  "CATALOG_MISMATCH",
  // the agent pays without the shopper present, and the shopper's signed intent didn't allow it (docs/specs/0003, #157)
  "UNATTENDED_NOT_PERMITTED",
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
  /**
   * Permission to pay with the shopper's saved wallet while they are not present (#157). Absent means the shopper
   * must be present: the agent's own `human_present: false` is a claim, and this is what the shopper signed.
   * `allowed_agent_platforms` narrows it to those agent platforms; absent means any registered platform.
   */
  unattended_payment: z
    .object({
      allowed_agent_platforms: z.array(z.string().min(1)).min(1).optional(),
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
  /** Agent alone: the vaulted wallet was charged at once, so the capture already exists. */
  capture_id: z.string().optional(),
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

/**
 * The shopper's proof that they are the one saving a wallet (docs/specs/0004 §Vault), signed with the same key as
 * their Intent Mandates. `vault.setup` starts a save; `vault.save` finishes it for one setup token; `vault.remove`
 * forgets the saved wallet. A proof is only
 * good for a few minutes (`issued_at`), so a leaked one can't be kept and replayed later.
 */
export const VaultProof = z.discriminatedUnion("purpose", [
  z.object({ purpose: z.literal("vault.setup"), issued_at: isoDateTime }),
  z.object({ purpose: z.literal("vault.save"), setup_token_id: z.string().min(1), issued_at: isoDateTime }),
  z.object({ purpose: z.literal("vault.remove"), issued_at: isoDateTime }),
]);
export type VaultProof = z.infer<typeof VaultProof>;

/**
 * The shopper asking to see the carts waiting for their approval (docs/specs/0003 §Step-up links). Signed like a
 * VaultProof, so only the holder of the key that signed the intent can list (and approve) its step-ups.
 */
export const StepUpListProof = z.object({ purpose: z.literal("stepup.list"), issued_at: isoDateTime });
export type StepUpListProof = z.infer<typeof StepUpListProof>;

/** Every proof a shopper's key signs for the merchant besides mandates. */
export const ShopperProof = z.union([VaultProof, StepUpListProof]);
export type ShopperProof = z.infer<typeof ShopperProof>;

/** POST /vault/setup: `{ proof_jws }` (purpose vault.setup) → where the shopper approves the wallet with PayPal. */
export const VaultSetupRequest = z.object({ proof_jws: z.string().min(1) });
export const VaultSetupResponse = z.object({ setup_token_id: z.string(), approval_url: z.string().url() });
export type VaultSetupResponse = z.infer<typeof VaultSetupResponse>;

/** POST /vault/remove: `{ proof_jws }` (purpose vault.remove). The agent can no longer pay alone for this shopper. */
export const VaultRemoveRequest = z.object({ proof_jws: z.string().min(1) });
export const VaultRemoveResponse = z.object({ wallet: z.literal(false) });
export type VaultRemoveResponse = z.infer<typeof VaultRemoveResponse>;

/** POST /vault/save: PayPal sent the shopper back with `approval_token_id`; the proof names that setup token. */
export const VaultSaveRequest = z.object({ setup_token_id: z.string().min(1), proof_jws: z.string().min(1) });
export const VaultSaveResponse = z.object({ wallet: z.literal(true) });
export type VaultSaveResponse = z.infer<typeof VaultSaveResponse>;

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

/**
 * POST /stepup/view `{ token }`: what the shopper is asked to approve (agent alone, docs/specs/0003, #35). The shopper signs
 * a CartApproval with `order_id` = `stepup_id` and this `cart_mandate_hash`, using the key named by `shopper_kid`.
 */
export const StepUpView = z.object({
  stepup_id: z.string().min(1),
  status: z.enum(["PENDING", "APPROVING", "APPROVED", "REJECTED", "EXPIRED", "FAILED"]),
  lines: z.array(CartLine),
  total: Money,
  merchant_name: z.string(),
  agent_platform: z.string(),
  reasons: z.array(ReasonCode),
  cart_mandate_hash: sha256Hex,
  shopper_kid: z.string().min(1),
  expires_at: isoDateTime,
  order_id: z.string().optional(),
});
export type StepUpView = z.infer<typeof StepUpView>;

/** POST /stepup/approve, body ApproveRequest plus `token` (#257). The order exists only from here. */
/** POST /stepups/pending: `{ proof_jws }` (purpose stepup.list) → the shopper's own unexpired, pending step-ups. */
export const StepUpListRequest = z.object({ proof_jws: z.string().min(1) });

export const StepUpApproveResponse = z.object({
  status: z.literal("CAPTURED"),
  order_id: z.string(),
  paypal_order_id: z.string().optional(),
  capture_id: z.string().optional(),
});
export type StepUpApproveResponse = z.infer<typeof StepUpApproveResponse>;

export const DisputeClass = z.enum(["MANDATE_COMPLIANT", "AGENT_OVERREACH", "INTENT_MISREAD", "NO_MANDATE"]);
export type DisputeClass = z.infer<typeof DisputeClass>;

/** Thrown by stubs so a half-built path fails loudly and says who to ask. */
export class NotImplementedError extends Error {
  constructor(what: string, owner: string, spec: string) {
    super(`${what} is not implemented yet (owner: @${owner}, spec: ${spec})`);
    this.name = "NotImplementedError";
  }
}
