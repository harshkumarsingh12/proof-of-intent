/** The demo merchant shown in the top bar (MERCHANT_ID=merchant-trailhead in .env.example). No login yet: #74. */
export const MERCHANT_NAME = "Trailhead Outfitters";

export const merchantInitials = (name: string = MERCHANT_NAME) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");

export type PayPalMode = "mock" | "sandbox";

/**
 * For display only. packages/paypal's parseMode throws on anything other than "mock", "sandbox" or unset,
 * so the API won't start with a bad value; here a bad value just shows as mock instead of crashing the page.
 */
export const parsePayPalMode = (raw: string | undefined): PayPalMode => (raw === "sandbox" ? "sandbox" : "mock");

export const REPO_URL = "https://github.com/harshkumarsingh12/proof-of-intent";
