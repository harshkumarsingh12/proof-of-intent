/**
 * The authorization card (#176): what the shopper's signed intent lets the agent do, as label and value rows. Pure, and read
 * only from the signed intent, so the card never claims more than the merchant enforces (spec 0001, spec 0002).
 */
import type { IntentMandate } from "@poi/contracts";
import { usd } from "./intent";

export interface AuthorizationRow {
  label: string;
  value: string;
}

const words = (slug: string) => slug.replace(/-/g, " ");

export function authorizationRows(
  intent: IntentMandate,
  formatTime: (iso: string) => string = (iso) => new Date(iso).toLocaleString(),
): AuthorizationRow[] {
  const { amount_max, budget_cap, recurrence, attributes, unattended_payment } = intent.constraints;
  const kind = [attributes?.category && words(attributes.category), attributes?.color].filter(Boolean).join(", ");
  const each = amount_max ? `at most ${usd(amount_max.value)} per purchase` : "no limit per purchase";
  const platforms = unattended_payment?.allowed_agent_platforms;
  const description = intent.natural_language_description;

  return [
    { label: "Item", value: kind ? `${description} (${kind})` : description },
    {
      label: "Spending",
      value: budget_cap
        ? `Up to ${usd(budget_cap.value)} in total, ${each}`
        : amount_max
          ? `At most ${usd(amount_max.value)} per purchase`
          : "No limit per purchase",
    },
    {
      label: "Purchases",
      // The policy engine enforces both limits when both are signed, so the row names both: "as many as fit" alone would
      // promise more orders than a signed recurrence allows.
      value: recurrence
        ? `Up to ${recurrence.max_orders} every ${recurrence.window_days} days${budget_cap ? ", within the budget" : ""}`
        : budget_cap
          ? "As many as fit the budget"
          : "One",
    },
    {
      label: "Agent",
      value: !unattended_payment
        ? "Any registered agent may propose a cart; none can pay without you"
        : platforms
          ? `Only ${platforms.join(", ")} may pay without you`
          : "Any registered agent may pay without you",
    },
    {
      label: "Payment",
      value:
        (unattended_payment
          ? "Your agent may pay from your saved PayPal wallet without you"
          : "You approve each payment at PayPal") +
        (intent.user_cart_confirmation_required ? ". You also confirm every cart first" : ""),
    },
    { label: "Expires", value: formatTime(intent.intent_expiry) },
  ];
}
