/**
 * The merchant API surface agreed in docs/specs/0003. Every route exists so the contract is
 * visible and testable; each returns 501 with its owner until it is built.
 */
import type { FastifyInstance } from "fastify";
import { RATE_LIMITS } from "../rate-limits";

type Method = "GET" | "POST";

const SPEC = "docs/specs/0003-checkout-and-verification.md";

const routes: [Method, string, string][] = [
  ["POST", "/stepup/:token/approve", "srshriv"],
  ["GET", "/analytics/:report", "hoursgotviral-dev"],
  ["POST", "/ai/studio", "sumedhag28"],
];

export function registerRoutes(app: FastifyInstance): void {
  for (const [method, url, owner] of routes) {
    app.route({
      method,
      url,
      // The limit is in place before the real handler lands (Studio calls cost model tokens).
      config: url === "/ai/studio" ? { rateLimit: RATE_LIMITS.studio } : {},
      handler: async (_req, reply) =>
        reply.code(501).send({ error: "not_implemented", route: `${method} ${url}`, owner, spec: SPEC }),
    });
  }
}
