/**
 * Per-IP limits on the public endpoints (docs/specs/0008 §Abuse). In memory per process, which is right
 * for one API container; move to a shared store if the API ever runs more than one replica.
 * Behind Caddy or Cloudflare set TRUST_PROXY=1 so the limit keys on the client, not the proxy. Leave it
 * unset otherwise, or anyone could pick their own IP with X-Forwarded-For.
 */
export const RATE_LIMITS = {
  /** A buyer agent retrying carts; generous for agents, tight for scripts hammering us. */
  checkout: { max: 30, timeWindow: "1 minute" },
  /** PayPal delivers bursts and retries on any non-2xx, so this only stops floods. */
  webhook: { max: 300, timeWindow: "1 minute" },
  /** A shopper registers one browser key; more than a few a minute from one IP is a script. */
  keys: { max: 10, timeWindow: "1 minute" },
  /** Every call costs model tokens. */
  // One chat question is several requests (each model turn and each tool lookup), so 10 a minute cut a single
  // question short. The daily AI call budget, not this, is what bounds spend.
  studio: { max: 60, timeWindow: "1 minute" },
} as const;
