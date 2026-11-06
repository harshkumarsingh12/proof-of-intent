/**
 * Merchant service. Owner: @harshkumarsingh12 (routes), @srshriv (verification logic).
 * Spec: docs/specs/0003-checkout-and-verification.md.
 */
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyInstance } from "fastify";
import { parseAiMode, semanticFit, type AiMode } from "@poi/ai";
import { createDb, type Db } from "@poi/db";
import { generateSigningKeyPair } from "@poi/mandates";
import { createPayPalClient, parseMode, type PayPalClient } from "@poi/paypal";
import { importPKCS8 } from "jose";
import type { CheckoutDeps, Merchant } from "./checkout";
import { checkoutRoutes } from "./routes/checkout";
import { disputeRoutes } from "./routes/disputes";
import { keyRoutes } from "./routes/keys";
import { registerRoutes } from "./routes/index";
import { webhookRoutes } from "./routes/webhooks";

export interface AppDeps {
  paypal: PayPalClient;
  /** Absent when DATABASE_URL isn't set; routes that need it answer 503. */
  db?: Db;
  /** Signs Cart Mandates. Absent → checkout answers 503. */
  merchant?: Merchant;
  aiMode?: AiMode;
  /** Bearer token for operator dispute actions. Absent → those routes answer 503. */
  operatorToken?: string;
  semanticFit?: CheckoutDeps["semanticFit"];
  now?: () => string;
}

/**
 * Real dependencies from the environment. PAYPAL_MODE (mock by default), DATABASE_URL, AI_MODE,
 * OPERATOR_TOKEN, MERCHANT_ID, MERCHANT_KEY_ID and MERCHANT_SIGNING_KEY (PKCS#8 PEM from `pnpm keys:gen`, `\n` escaped).
 */
export async function depsFromEnv(env = process.env): Promise<AppDeps> {
  const paypalMode = parseMode(env.PAYPAL_MODE);
  return {
    paypal: createPayPalClient(paypalMode),
    db: env.DATABASE_URL ? createDb(env.DATABASE_URL) : undefined,
    merchant: await merchantFromEnv(env, paypalMode === "sandbox"),
    aiMode: parseAiMode(env.AI_MODE),
    operatorToken: env.OPERATOR_TOKEN || undefined,
  };
}

async function merchantFromEnv(env: NodeJS.ProcessEnv, required: boolean): Promise<Merchant> {
  const id = env.MERCHANT_ID || "merchant-trailhead";
  const kid = env.MERCHANT_KEY_ID || "merchant-1";
  const pem = env.MERCHANT_SIGNING_KEY?.replace(/\\n/g, "\n");
  if (pem) return { id, kid, privateKey: await importPKCS8(pem, "ES256") };
  // A key that dies with the process can't back evidence later, so the sandbox demo must configure one.
  if (required) throw new Error("PAYPAL_MODE=sandbox needs MERCHANT_SIGNING_KEY (run `pnpm keys:gen`)");
  console.warn("MERCHANT_SIGNING_KEY not set: signing Cart Mandates with a throwaway key (mock mode only)");
  return { id, kid: `${kid}-ephemeral`, privateKey: (await generateSigningKeyPair()).privateKey };
}

export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify({
    logger: process.env.NODE_ENV !== "test",
    trustProxy: process.env.TRUST_PROXY === "1",
  });

  // Opt-in per route (config.rateLimit, see rate-limits.ts); errors in the API's usual shape.
  app.register(rateLimit, {
    global: false,
    errorResponseBuilder: (_req, ctx) => ({
      statusCode: 429,
      error: "rate_limited",
      message: `Too many requests; retry in ${ctx.after}`,
    }),
  });

  app.get("/healthz", async () => ({ status: "ok" }));

  // Simplification: readiness reports config only; add a DB ping once a route depends on it at startup.
  app.get("/readyz", async () => ({
    status: "ok",
    paypalMode: parseMode(process.env.PAYPAL_MODE),
    database: deps.db ? "configured" : "not_configured",
  }));

  app.register(webhookRoutes, deps);
  app.register(disputeRoutes, deps);
  app.register(keyRoutes, deps);
  app.register(checkoutRoutes, {
    ...deps,
    aiMode: deps.aiMode ?? "replay",
    semanticFit: deps.semanticFit ?? semanticFit,
    now: deps.now ?? (() => new Date().toISOString()),
  });
  // As a plugin, so these load after rate-limit and its per-route hook sees them.
  app.register(async (instance) => registerRoutes(instance));
  if (deps.db) app.addHook("onClose", () => deps.db!.close());
  return app;
}
