/**
 * Merchant service. Owner: @harshkumarsingh12 (routes), @srshriv (verification logic).
 * Spec: docs/specs/0003-checkout-and-verification.md.
 */
import Fastify, { type FastifyInstance } from "fastify";
import { createDb, type Db } from "@poi/db";
import { createPayPalClient, parseMode, type PayPalClient } from "@poi/paypal";
import { registerRoutes } from "./routes/index";
import { webhookRoutes } from "./routes/webhooks";

export interface AppDeps {
  paypal: PayPalClient;
  /** Absent when DATABASE_URL isn't set; routes that need it answer 503. */
  db?: Db;
}

/** Real dependencies from the environment: PAYPAL_MODE (mock by default) and DATABASE_URL. */
export function depsFromEnv(): AppDeps {
  return {
    paypal: createPayPalClient(parseMode(process.env.PAYPAL_MODE)),
    db: process.env.DATABASE_URL ? createDb(process.env.DATABASE_URL) : undefined,
  };
}

export function buildApp(deps: AppDeps = depsFromEnv()): FastifyInstance {
  const app = Fastify({ logger: process.env.NODE_ENV !== "test" });

  app.get("/healthz", async () => ({ status: "ok" }));

  // Simplification: readiness reports config only; add a DB ping once a route depends on it at startup.
  app.get("/readyz", async () => ({
    status: "ok",
    paypalMode: parseMode(process.env.PAYPAL_MODE),
    database: deps.db ? "configured" : "not_configured",
  }));

  app.register(webhookRoutes, deps);
  registerRoutes(app);
  if (deps.db) app.addHook("onClose", () => deps.db!.close());
  return app;
}
