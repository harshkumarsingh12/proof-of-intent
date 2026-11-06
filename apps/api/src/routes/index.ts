/**
 * The merchant API surface agreed in docs/specs/0003. Every route exists so the contract is
 * visible and testable; each returns 501 with its owner until it is built.
 */
import type { FastifyInstance } from "fastify";

type Method = "GET" | "POST";

const SPEC = "docs/specs/0003-checkout-and-verification.md";

const routes: [Method, string, string][] = [
  ["GET", "/analytics/:report", "hoursgotviral-dev"],
];

export function registerRoutes(app: FastifyInstance): void {
  for (const [method, url, owner] of routes) {
    app.route({
      method,
      url,
      handler: async (_req, reply) =>
        reply.code(501).send({ error: "not_implemented", route: `${method} ${url}`, owner, spec: SPEC }),
    });
  }
}
