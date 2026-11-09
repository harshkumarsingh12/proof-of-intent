/**
 * Merchant service. Owner: @harshkumarsingh12 (routes), @srshriv (verification logic).
 * Spec: docs/specs/0003-checkout-and-verification.md.
 */
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyInstance } from "fastify";
import { parseAiMode, semanticFit, validateLiveEnvironment, type AiMode } from "@poi/ai";
import { createDb, type Db } from "@poi/db";
import { generateSigningKeyPair } from "@poi/mandates";
import { createPayPalClient, parseMode, type PayPalClient } from "@poi/paypal";
import { importPKCS8 } from "jose";
import type { CheckoutDeps, Merchant, StepUpConfig } from "./checkout";
import { loggerOptions } from "./logging";
import { checkoutRoutes } from "./routes/checkout";
import { disputeRoutes } from "./routes/disputes";
import { keyRoutes } from "./routes/keys";
import { registerRoutes } from "./routes/index";
import { studioRoutes } from "./routes/studio";
import { vaultRoutes } from "./routes/vault";
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
  /** What the merchant sells, for checking cart lines against (spec 0003). Absent: the demo store. */
  catalog?: CheckoutDeps["catalog"];
  now?: () => string;
  /**
   * Agent-alone step-up links. linkBase defaults to BUYER_PUBLIC_URL; send defaults to the API log, because no
   * email provider is wired yet (the link only locates the cart: approving it needs the shopper's own key).
   */
  stepUp?: Partial<StepUpConfig>;
  /** Tests only: logs go here (and are on), so they can check what is, and isn't, written. */
  logStream?: NodeJS.WritableStream;
  /** How long `/readyz` waits for the database to answer `select 1`. Default 2000 ms. */
  readyDbTimeoutMs?: number;
}

/**
 * Whether Postgres answers `select 1` within `timeoutMs`. The pool has no connect timeout of its own, so a host that
 * accepts nothing (a stale network, a dropped route) would otherwise hang the request instead of failing it.
 */
async function databaseAnswers(db: Db, timeoutMs: number, log: (reason: string) => void): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      db.ping(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`no answer within ${timeoutMs} ms`)), timeoutMs);
      }),
    ]);
    return true;
  } catch (err) {
    log((err as Error).message);
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Real dependencies from the environment. PAYPAL_MODE (mock by default), DATABASE_URL, AI_MODE,
 * OPERATOR_TOKEN, MERCHANT_ID, MERCHANT_KEY_ID and MERCHANT_SIGNING_KEY (PKCS#8 PEM from `pnpm keys:gen`, `\n` escaped).
 */
export async function depsFromEnv(env = process.env): Promise<AppDeps> {
  const paypalMode = parseMode(env.PAYPAL_MODE);
  const aiMode = parseAiMode(env.AI_MODE);
  if (aiMode === "live") validateLiveEnvironment(env);
  const buyer = buyerBaseFromEnv(env);
  if (paypalMode === "sandbox" && buyer.defaulted) {
    // PayPal sends a shopper back here after they approve a wallet, and step-up links open here too.
    console.warn(
      `BUYER_PUBLIC_URL is not set, so wallet approvals and step-up links point at ${buyer.url}. ` +
        "Set it to the shop's public address (docs/SETUP.md §4) or hosted shoppers are sent to localhost.",
    );
  }
  return {
    paypal: createPayPalClient(paypalMode),
    db: env.DATABASE_URL ? createDb(env.DATABASE_URL) : undefined,
    merchant: await merchantFromEnv(env, paypalMode === "sandbox"),
    aiMode,
    operatorToken: env.OPERATOR_TOKEN || undefined,
    stepUp: { linkBase: buyer.url },
  };
}

/** The buyer app's public origin (PayPal's return URL for wallets, step-up links) and whether it was left at the local default. */
export function buyerBaseFromEnv(env: NodeJS.ProcessEnv): { url: string; defaulted: boolean } {
  const set = env.BUYER_PUBLIC_URL?.trim();
  return set ? { url: set, defaulted: false } : { url: "http://localhost:3001", defaulted: true };
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
    logger: deps.logStream || process.env.NODE_ENV !== "test" ? loggerOptions(deps.logStream) : false,
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

  // Readiness means the routes can do their work, so it asks the database (#120). On Nov 6 and Nov 7 the API lost its
  // route to Postgres (`getaddrinfo ENOTFOUND postgres`): every route answered 500 while this said ok. Without a
  // DATABASE_URL (mock demos) there is nothing to ask and it stays ok. /healthz is liveness only and never touches Postgres.
  app.get("/readyz", async (_req, reply) => {
    const paypalMode = parseMode(process.env.PAYPAL_MODE);
    // Whether merchant reads need the operator token (#163): the one thing an outside check can tell about auth.
    const reads = deps.operatorToken ? "protected" : "open";
    if (!deps.db) return { status: "ok", paypalMode, reads, database: "not_configured", webhooks: undefined };
    const up = await databaseAnswers(deps.db, deps.readyDbTimeoutMs ?? 2000, (reason) =>
      app.log.error({ reason }, "readyz: the database did not answer"),
    );
    if (!up) {
      return reply
        .code(503)
        .send({ status: "unavailable", paypalMode, reads, database: "unreachable", webhooks: null });
    }
    // Deliveries PayPal has made to POST /webhooks/paypal and passed verification (spec 0004 §Webhooks, #19).
    const webhooks = await deps.db.webhookStats().catch(() => null);
    return {
      status: "ok",
      paypalMode,
      reads,
      database: "configured",
      webhooks,
      // The worker's lag signal (#164): "quarantined" when an event was given up on, "lagging" when the oldest waits past
      // INBOX_LAG_ALERT_SECONDS (default 600), else "ok". It never turns /readyz into a 503: the API is up, the worker is the
      // problem, and the uptime check reads this field to alert.
      inbox: inboxStatus(webhooks, Date.now(), Number(process.env.INBOX_LAG_ALERT_SECONDS) || 600),
    };
  });

  app.register(webhookRoutes, deps);
  app.register(disputeRoutes, deps);
  app.register(studioRoutes, deps);
  app.register(keyRoutes, deps);
  app.register(vaultRoutes, {
    ...deps,
    now: deps.now ?? (() => new Date().toISOString()),
    buyerBase: deps.stepUp?.linkBase ?? "http://localhost:3001",
  });
  app.register(checkoutRoutes, {
    ...deps,
    aiMode: deps.aiMode ?? "replay",
    semanticFit: deps.semanticFit ?? semanticFit,
    now: deps.now ?? (() => new Date().toISOString()),
    stepUp: {
      linkBase: deps.stepUp?.linkBase ?? "http://localhost:3001",
      send:
        deps.stepUp?.send ??
        (async (link) => {
          // The link carries a secret token, so it is not logged unless asked for (local development, where there is
          // no email provider). The shop lists a shopper's held carts without any link.
          const logLink = process.env.LOG_STEPUP_LINKS === "1";
          app.log.info(
            {
              stepUpId: link.stepUpId,
              shopperId: link.shopperId,
              expiresAt: link.expiresAt,
              ...(logLink ? { url: link.url } : {}),
            },
            logLink
              ? "step-up approval link (LOG_STEPUP_LINKS=1; deliver this to the shopper)"
              : "step-up created; its link is not logged because it carries a secret (set LOG_STEPUP_LINKS=1 to log it for local development)",
          );
        }),
    },
  });
  // As a plugin, so these load after rate-limit and its per-route hook sees them.
  app.register(async (instance) => registerRoutes(instance));
  if (deps.db) app.addHook("onClose", () => deps.db!.close());
  return app;
}

/** "ok", "lagging" (the oldest dispute event has waited too long), "quarantined" (one was given up on) or "unknown". */
export function inboxStatus(
  stats: { pending: number; oldestPendingAt: string | null; quarantined: number } | null,
  nowMs: number,
  lagSeconds: number,
): "ok" | "lagging" | "quarantined" | "unknown" {
  if (!stats) return "unknown";
  if (stats.quarantined > 0) return "quarantined";
  if (stats.oldestPendingAt && nowMs - Date.parse(stats.oldestPendingAt) > lagSeconds * 1000)
    return "lagging";
  return "ok";
}
