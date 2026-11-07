/**
 * A small in-memory limiter for the buyer app's public AI routes (the API's limiter covers Fastify, not these Next
 * routes). One process, so it is right for one container and loose across several: move it to a shared store if the shop
 * ever runs more than one replica. Behind Cloudflare the client address is `cf-connecting-ip`; otherwise the first
 * `x-forwarded-for` entry. Neither can be trusted on a host the internet reaches directly (a client can pick its own),
 * which is the same caveat as TRUST_PROXY on the API.
 */
export interface Limiter {
  /** Records one request for `key`. `ok` is false once the window is full; `retryAfterS` says when to try again. */
  hit(key: string, now?: number): { ok: boolean; retryAfterS: number };
}

export function createLimiter(opts: { windowMs: number; max: number }): Limiter {
  const seen = new Map<string, number[]>();
  return {
    hit(key, now = Date.now()) {
      const cutoff = now - opts.windowMs;
      const recent = (seen.get(key) ?? []).filter((t) => t > cutoff);
      if (recent.length >= opts.max) {
        seen.set(key, recent);
        return { ok: false, retryAfterS: Math.max(1, Math.ceil((recent[0]! + opts.windowMs - now) / 1000)) };
      }
      recent.push(now);
      seen.set(key, recent);
      // Forget addresses that went quiet, so the map can't grow without bound.
      if (seen.size > 5_000)
        for (const [k, times] of seen) if (!times.some((t) => t > cutoff)) seen.delete(k);
      return { ok: true, retryAfterS: 0 };
    },
  };
}

/** Both a short and a long window: a burst is stopped quickly, a steady drip is stopped eventually. */
export function createChatLimiter(perMinute = 10, perHour = 60): Limiter {
  const minute = createLimiter({ windowMs: 60_000, max: perMinute });
  const hour = createLimiter({ windowMs: 3_600_000, max: perHour });
  return {
    hit(key, now = Date.now()) {
      const a = minute.hit(key, now);
      if (!a.ok) return a;
      return hour.hit(key, now);
    },
  };
}

export function clientIp(headers: Pick<Headers, "get">): string {
  const cf = headers.get("cf-connecting-ip")?.trim();
  if (cf) return cf;
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || "unknown";
}
