/**
 * Merchant service. Owner: @harshkumarsingh12 (routes), @srshriv (verification logic).
 * Spec: docs/specs/0003-checkout-and-verification.md.
 */
import Fastify, { type FastifyInstance } from "fastify";
import { parseMode } from "@poi/paypal";
import { registerRoutes } from "./routes/index";

export function buildApp(): FastifyInstance {
  const app = Fastify({ logger: process.env.NODE_ENV !== "test" });
  const paypalMode = parseMode(process.env.PAYPAL_MODE);

  app.get("/healthz", async () => ({ status: "ok" }));

  // Simplification: readiness reports config only; add a DB ping once packages/db is real.
  app.get("/readyz", async () => ({
    status: "ok",
    paypalMode,
    database: process.env.DATABASE_URL ? "configured" : "not_configured",
  }));

  registerRoutes(app);
  return app;
}
