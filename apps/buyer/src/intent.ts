/**
 * Turns what the shopper typed into an Intent Mandate (spec 0001). Pure: the caller passes the clock and the
 * random parts, so the browser and the tests build the same thing.
 */
import { IntentMandate, SCHEMA_VERSION } from "@poi/contracts";

export interface IntentForm {
  description: string;
  /** Dollars as typed, e.g. "80" or "79.99". */
  maxPrice: string;
  category: string;
  color: string;
  /** Days until the intent expires. */
  validDays: number;
  /** "Ask me before every purchase": the merchant always steps up (spec 0003). */
  confirmEachCart: boolean;
  /**
   * "Let the agent pay alone from my saved wallet": signed into the intent as `unattended_payment` (#157), so the
   * merchant takes the shopper's word for it, not the agent's. Off unless set.
   */
  payAlone?: boolean;
}

export interface IntentContext {
  kid: string;
  merchantId: string;
  now: Date;
  mandateId: string;
  nonce: string;
  /** The buyer agent's platform name: an unattended permission is limited to it. */
  agentPlatform?: string;
}

/** Signed intents start a few minutes in the past so a browser clock slightly ahead of the server still works. */
export const CLOCK_SKEW_MS = 5 * 60_000;

/** "79.99" → 7999. Throws on anything that isn't a positive dollar amount with at most two decimals. */
export function dollarsToCents(text: string): number {
  const m = /^\s*\$?\s*(\d{1,6})(?:\.(\d{1,2}))?\s*$/.exec(text);
  if (!m) throw new Error("Enter a price like 80 or 79.99");
  const cents = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
  if (cents <= 0) throw new Error("The price has to be more than $0");
  return cents;
}

export const usd = (cents: number) => `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;

/**
 * What the signed intent lets the agent buy, in the words the shop shows after signing (#156). An intent with no budget
 * and no order count authorizes one purchase; more than that is only what the shopper signed.
 */
export function describePermission(intent: IntentMandate): string {
  const { amount_max, budget_cap, recurrence } = intent.constraints;
  const each = amount_max ? `, at most ${usd(amount_max.value)} each` : "";
  if (budget_cap)
    return `Your agent may spend up to ${usd(budget_cap.value)} in total${each}, over as many orders as fit.`;
  if (recurrence)
    return `Your agent may place up to ${recurrence.max_orders} orders every ${recurrence.window_days} days${each}.`;
  return `Your agent may make one purchase${amount_max ? ` of at most ${usd(amount_max.value)}` : ""}. A second purchase needs a new signed intent.`;
}

export function buildIntent(form: IntentForm, ctx: IntentContext): IntentMandate {
  const description = form.description.trim();
  if (!description) throw new Error("Say what you want the agent to buy");
  const start = new Date(ctx.now.getTime() - CLOCK_SKEW_MS).toISOString();
  const days = Math.min(Math.max(Math.round(form.validDays), 1), 30);
  const attributes: Record<string, string> = {};
  if (form.category) attributes.category = form.category;
  if (form.color) attributes.color = form.color;

  return IntentMandate.parse({
    mandate_id: ctx.mandateId,
    issuer: ctx.kid,
    nonce: ctx.nonce,
    created_at: start,
    schema_version: SCHEMA_VERSION,
    user_cart_confirmation_required: form.confirmEachCart,
    natural_language_description: description,
    merchants: [ctx.merchantId],
    intent_expiry: new Date(ctx.now.getTime() + days * 86_400_000).toISOString(),
    constraints: {
      amount_max: { value: dollarsToCents(form.maxPrice), currency: "USD" },
      merchant_allowlist: [ctx.merchantId],
      ...(Object.keys(attributes).length ? { attributes } : {}),
      quantity_max: { per_line: 1, per_order: 1 },
      ...(form.payAlone
        ? {
            unattended_payment: ctx.agentPlatform ? { allowed_agent_platforms: [ctx.agentPlatform] } : {},
          }
        : {}),
      valid_from: start,
    },
  });
}
