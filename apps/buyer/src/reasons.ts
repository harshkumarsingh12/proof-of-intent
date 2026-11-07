import type { ReasonCode } from "@poi/contracts";

/** Plain-language labels for the shopper. The code is shown next to it, same vocabulary as the dashboard. */
export const REASON_TEXT: Record<ReasonCode, string> = {
  SCHEMA_INVALID: "The request was malformed",
  SIGNATURE_INVALID: "A signature didn't check out",
  UNKNOWN_KEY: "The merchant doesn't know this signing key",
  NONCE_REPLAYED: "This payment request was already used",
  MANDATE_MISMATCH: "The cart and the payment don't point at the same intent",
  MANDATE_NOT_YET_VALID: "Your intent isn't valid yet (check your device clock)",
  MANDATE_EXPIRED: "Your intent has expired",
  CART_EXPIRED: "The cart expired before payment",
  CURRENCY_MISMATCH: "The cart is in a different currency",
  AMOUNT_EXCEEDS_MAX: "It costs more than your limit",
  BUDGET_EXCEEDED: "It would go over your total budget",
  MERCHANT_NOT_ALLOWED: "You didn't allow this merchant",
  SKU_NOT_ALLOWED: "You didn't allow this product",
  ATTRIBUTE_MISMATCH: "It doesn't match what you asked for (color, category)",
  QUANTITY_EXCEEDS_MAX: "It's more items than you allowed",
  ADDRESS_MISMATCH: "It ships somewhere else",
  RECURRENCE_EXCEEDED: "You've reached your limit of orders for now",
  INTENT_ALREADY_USED: "You allowed one purchase and it was made. Sign a new intent to buy again",
  CATALOG_MISMATCH: "The cart doesn't match what the store sells (product or price)",
  UNATTENDED_NOT_PERMITTED: "You didn't let the agent pay without you, so you approve at PayPal",
  SEMANTIC_UNCERTAIN: "The merchant isn't sure it's what you meant, so you confirm",
  SEMANTIC_MISMATCH: "The merchant's check says it isn't what you described",
};
