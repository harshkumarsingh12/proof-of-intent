/**
 * Deterministic hard rules. Pure: no I/O, no clock, no randomness. The caller passes `now`
 * and the ledger so the same inputs always give the same verdict, at checkout and when the
 * dispute copilot replays it. Spec: docs/specs/0002-policy-engine.md.
 */
import type { CartMandate, IntentMandate, ReasonCode } from "@poi/contracts";

/** Prior captured orders under this mandate. Used by budget_cap and recurrence. */
export interface MandateLedger {
  capturedTotal: number;
  capturedOrderTimes: string[];
}

export interface EvaluateInput {
  intent: IntentMandate;
  cart: CartMandate;
  now: string;
  ledger?: MandateLedger;
}

export interface EvaluateResult {
  pass: boolean;
  reasons: ReasonCode[];
}

type Rule = (input: EvaluateInput) => ReasonCode | ReasonCode[] | null;

const t = (iso: string) => Date.parse(iso);

const rules: Rule[] = [
  ({ intent, cart }) => (cart.intent_mandate_id === intent.mandate_id ? null : "MANDATE_MISMATCH"),

  ({ intent, now }) => (t(now) < t(intent.constraints.valid_from) ? "MANDATE_NOT_YET_VALID" : null),

  ({ intent, now }) => (t(now) >= t(intent.intent_expiry) ? "MANDATE_EXPIRED" : null),

  ({ cart, now }) => (t(now) >= t(cart.contents.cart_expiry) ? "CART_EXPIRED" : null),

  ({ intent, cart }) => {
    const max = intent.constraints.amount_max;
    if (!max) return null;
    const lineCurrencies = cart.contents.lines.map((l) => l.unit_price.currency);
    return [cart.contents.total.currency, ...lineCurrencies].every((c) => c === max.currency)
      ? null
      : "CURRENCY_MISMATCH";
  },

  ({ intent, cart }) => {
    const max = intent.constraints.amount_max;
    return max && cart.contents.total.value > max.value ? "AMOUNT_EXCEEDS_MAX" : null;
  },

  ({ intent, cart }) => {
    const allow = intent.constraints.merchant_allowlist;
    return allow && !allow.includes(cart.contents.merchant_id) ? "MERCHANT_NOT_ALLOWED" : null;
  },

  ({ intent, cart }) => {
    const q = intent.constraints.quantity_max;
    if (!q) return null;
    const lines = cart.contents.lines;
    const overLine = q.per_line !== undefined && lines.some((l) => l.quantity > q.per_line!);
    const overOrder = q.per_order !== undefined && lines.reduce((n, l) => n + l.quantity, 0) > q.per_order;
    return overLine || overOrder ? "QUANTITY_EXCEEDS_MAX" : null;
  },

  // Not built yet (ledger entries in policy-engine.test.ts, owner @srshriv):
  // budget_cap → BUDGET_EXCEEDED, recurrence → RECURRENCE_EXCEEDED,
  // shipping_address_hash → ADDRESS_MISMATCH, attributes → ATTRIBUTE_MISMATCH,
  // sku_allowlist → SKU_NOT_ALLOWED.
];

export function evaluate(input: EvaluateInput): EvaluateResult {
  const reasons = rules.flatMap((rule) => rule(input) ?? []);
  return { pass: reasons.length === 0, reasons };
}
