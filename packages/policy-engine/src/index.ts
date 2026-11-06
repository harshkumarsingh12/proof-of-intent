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

  // Every money limit in the mandate is in one currency, and the cart has to be in it too. Otherwise the
  // checks below would compare cents of different currencies.
  ({ intent, cart }) => {
    const { amount_max, budget_cap } = intent.constraints;
    const limits = [amount_max, budget_cap].flatMap((m) => (m ? [m.currency] : []));
    if (limits.length === 0) return null;
    const cartCurrencies = [
      cart.contents.total.currency,
      ...cart.contents.lines.map((l) => l.unit_price.currency),
    ];
    return [...limits, ...cartCurrencies].every((c) => c === limits[0]) ? null : "CURRENCY_MISMATCH";
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

  // Exact, case-insensitive match of every constrained attribute on every line. A line without a
  // constrained attribute doesn't prove it, so it fails too. Nuance ("running jacket" vs "rain shell") is J1's.
  ({ intent, cart }) => {
    const wanted = Object.entries(intent.constraints.attributes ?? {});
    if (wanted.length === 0) return null;
    const fits = (attrs: Record<string, string>) => {
      const have = new Map(Object.entries(attrs).map(([k, v]) => [norm(k), norm(v)]));
      return wanted.every(([k, v]) => have.get(norm(k)) === norm(v));
    };
    return cart.contents.lines.every((l) => fits(l.attributes)) ? null : "ATTRIBUTE_MISMATCH";
  },

  ({ intent, cart }) => {
    const allow = intent.constraints.sku_allowlist;
    return allow && !cart.contents.lines.every((l) => allow.includes(l.sku)) ? "SKU_NOT_ALLOWED" : null;
  },

  // A cart without an address hash can't show it ships where the shopper said, so it fails.
  ({ intent, cart }) => {
    const want = intent.constraints.shipping_address_hash;
    return want && cart.contents.shipping_address_hash !== want ? "ADDRESS_MISMATCH" : null;
  },

  // Prior captures under this mandate plus this cart. No ledger means no prior captures.
  ({ intent, cart, ledger }) => {
    const cap = intent.constraints.budget_cap;
    if (!cap) return null;
    return (ledger?.capturedTotal ?? 0) + cart.contents.total.value > cap.value ? "BUDGET_EXCEEDED" : null;
  },

  // At most max_orders captures in the window_days ending at `now`, counting this one. The window is
  // (now - window_days, now]: a capture exactly window_days ago has aged out. Captures after `now` are
  // ignored, so a dispute replay at capture time sees only what checkout saw.
  ({ intent, now, ledger }) => {
    const r = intent.constraints.recurrence;
    if (!r) return null;
    const end = t(now);
    const start = end - r.window_days * DAY_MS;
    const inWindow = (ledger?.capturedOrderTimes ?? []).filter((iso) => t(iso) > start && t(iso) <= end);
    return inWindow.length + 1 > r.max_orders ? "RECURRENCE_EXCEEDED" : null;
  },
];

const DAY_MS = 24 * 60 * 60 * 1000;
const norm = (s: string) => s.trim().toLowerCase();

export function evaluate(input: EvaluateInput): EvaluateResult {
  const reasons = rules.flatMap((rule) => rule(input) ?? []);
  return { pass: reasons.length === 0, reasons };
}
