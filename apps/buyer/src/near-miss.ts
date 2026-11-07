/**
 * Near-miss suggestions (spec 0010): after the merchant refuses a cart, say what would have fit and offer to fill the
 * limits form to match. Pure and deterministic: no model, no network, the same refusal always gives the same hint.
 *
 * It never signs, never buys and never changes a signed intent. The only thing it can hand back is a patch for the
 * limits form; the shopper reviews the form and signs again themselves. Voice never applies it.
 */
import type { ReasonCode } from "@poi/contracts";
import { CATALOG, categoryLabel, type Product } from "./catalog";
import type { IntentForm } from "./intent";

/** The limits the refused cart was checked against: the signed intent's, not whatever the form says now. */
export interface SignedLimits {
  maxCents: number;
  category?: string;
  color?: string;
}

export interface NearMiss {
  /** Plain words for the shopper. Every figure in it comes from the catalog or the signed limits. */
  text: string;
  /** A product in the store that already fits the signed limits, if there is one. */
  alternative?: { sku: string; title: string; color: string; price_cents: number };
  /** One click fills these into the limits form. */
  apply?: { label: string; patch: Pick<IntentForm, "maxPrice" | "category" | "color" | "description"> };
}

const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;
/** "80", "79.5", "79.99": the form's own price format, so the box shows what a person would type. */
const dollarsForForm = (cents: number) => String(Number((cents / 100).toFixed(2)));

const fits = (p: Product, limits: SignedLimits) =>
  p.line.unit_price.value <= limits.maxCents &&
  (!limits.category || p.line.attributes.category === limits.category) &&
  (!limits.color || p.line.attributes.color === limits.color);

/** The form's description, matching the new limits (the merchant's semantic check reads it). */
function describe(category: string, color: string, maxCents: number): string {
  const what = [color, categoryLabel(category).toLowerCase()].filter(Boolean).join(" ");
  return `${what[0]!.toUpperCase()}${what.slice(1)} under $${dollarsForForm(maxCents)}.`;
}

/**
 * What would have fit, for a refused cart. Returns nothing when the refusal isn't about the shopper's own limits
 * (an expired intent, a bad signature, a replayed payment): then there is nothing to adjust.
 */
export function nearMiss(args: {
  sku: string;
  reasons: ReasonCode[];
  limits: SignedLimits;
}): NearMiss | undefined {
  const { limits } = args;
  const refused = CATALOG.find((p) => p.line.sku === args.sku);
  if (!refused) return undefined;
  const tooDear = args.reasons.includes("AMOUNT_EXCEEDS_MAX");
  const wrongKind = args.reasons.includes("ATTRIBUTE_MISMATCH");
  if (!tooDear && !wrongKind) return undefined;

  const price = refused.line.unit_price.value;
  const category = String(refused.line.attributes.category ?? "");
  const color = String(refused.line.attributes.color ?? "");

  // The closest product that already fits the signed limits: same category first, then nearest in price.
  const closest = CATALOG.filter((p) => p.line.sku !== args.sku && fits(p, limits)).sort(
    (a, b) =>
      Number(b.line.attributes.category === category) - Number(a.line.attributes.category === category) ||
      Math.abs(a.line.unit_price.value - price) - Math.abs(b.line.unit_price.value - price) ||
      a.line.sku.localeCompare(b.line.sku),
  )[0];
  const alternative = closest && {
    sku: closest.line.sku,
    title: closest.line.title,
    color: String(closest.line.attributes.color ?? ""),
    price_cents: closest.line.unit_price.value,
  };
  const altText = alternative
    ? ` ${alternative.title}, ${alternative.color}, ${dollars(alternative.price_cents)} (${alternative.sku}) already fits what you signed.`
    : "";
  const title = refused.line.title;

  if (wrongKind) {
    // The cart is for something other than the limits describe: offer limits for this item. The cap never goes
    // down, and if it has to go up to cover the item, the text says so.
    const newMax = Math.max(limits.maxCents, price);
    const raised = newMax > limits.maxCents ? ` (this raises your cap to ${dollars(newMax)})` : "";
    const otherItem = Boolean(limits.category) && limits.category !== category;
    const otherColor = Boolean(limits.color) && limits.color !== color;
    const asked = [limits.color, limits.category ? categoryLabel(limits.category).toLowerCase() : undefined]
      .filter(Boolean)
      .join(" ");
    const is = otherItem
      ? `${title} is ${categoryLabel(category).toLowerCase()}`
      : otherColor
        ? `${title} comes in ${color}`
        : `${title} doesn't match your limits`;
    return {
      text:
        `${is}, but you signed limits for ${asked || "something else"}.${altText} ` +
        `If you do want it, you can change your limits to match${raised} and sign again.`,
      ...(alternative ? { alternative } : {}),
      apply: {
        label: `Set limits for ${categoryLabel(category).toLowerCase()}`,
        patch: {
          maxPrice: dollarsForForm(newMax),
          category,
          color,
          description: describe(category, color, newMax),
        },
      },
    };
  }

  // Only too dear: keep the shopper's own item and color, and offer the higher cap that would have covered it.
  const keepCategory = limits.category ?? category;
  const keepColor = limits.category || limits.color ? (limits.color ?? "") : color;
  return {
    text:
      `${title} costs ${dollars(price)} and your limit is ${dollars(limits.maxCents)}.${altText} ` +
      `You can raise your limit to ${dollars(price)} and sign again, or keep it as it is: it is your call.`,
    ...(alternative ? { alternative } : {}),
    apply: {
      label: `Raise limit to ${dollars(price)}`,
      patch: {
        maxPrice: dollarsForForm(price),
        category: keepCategory,
        color: keepColor,
        description: describe(keepCategory, keepColor, price),
      },
    },
  };
}
