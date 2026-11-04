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
  /** Every call costs model tokens. */
  studio: { max: 10, timeWindow: "1 minute" },
} as const;
