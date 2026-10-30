/**
 * The merchant API surface agreed in docs/specs/0003. Every route exists so the contract is
 * visible and testable; each returns 501 with its owner until it is built.
 */
import type { FastifyInstance } from "fastify";

type Method = "GET" | "POST";

const SPEC = "docs/specs/0003-checkout-and-verification.md";

const routes: [Method, string, string][] = [
  ["POST", "/checkout", "harshkumarsingh12"],
  ["POST", "/checkout/:id/approve", "harshkumarsingh12"],
  ["POST", "/stepup/:token/approve", "srshriv"],
  ["GET", "/orders", "harshkumarsingh12"],
  ["GET", "/verifications", "harshkumarsingh12"],
  ["GET", "/disputes", "hoursgotviral-dev"],
  ["GET", "/disputes/:id/recommendation", "hoursgotviral-dev"],
  ["POST", "/disputes/:id/actions/:action", "hoursgotviral-dev"],
  ["GET", "/analytics/:report", "hoursgotviral-dev"],
  ["POST", "/webhooks/paypal", "harshkumarsingh12"],
  ["POST", "/ai/studio", "sumedhag28"],
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
