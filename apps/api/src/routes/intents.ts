/**
 * The shopper's controls over a signed intent (docs/specs/0013, #176). Public, like /vault/*: each request carries a fresh
 * signature from the key that signed the intent, and that signature is what authorizes it.
 */
import type { FastifyPluginAsync } from "fastify";
import { IntentReceiptRequest, IntentRevokeRequest } from "@poi/contracts";
import type { AppDeps } from "../app";
import { intentReceipt, revokeIntent, type IntentDeps } from "../intents";
import { RATE_LIMITS } from "../rate-limits";

type Options = AppDeps & Pick<IntentDeps, "now">;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const intentRoutes: FastifyPluginAsync<Options> = async (app, deps) => {
  const notConfigured = { error: "not_configured", message: "DATABASE_URL is not set" };
  const notFound = { error: "intent_not_found", message: "The merchant has no record of this intent" };

  app.post<{ Params: { id: string } }>(
    "/intents/:id/revoke",
    { bodyLimit: 4 * 1024, config: { rateLimit: RATE_LIMITS.keys } },
    async (req, reply) => {
      const parsed = IntentRevokeRequest.safeParse(req.body);
      if (!parsed.success)
        return reply.code(400).send({ error: "invalid_request", message: "Expected { revocation_jws }" });
      if (!UUID.test(req.params.id)) return reply.code(404).send(notFound);
      if (!deps.db) return reply.code(503).send(notConfigured);
      const result = await revokeIntent(req.params.id, parsed.data.revocation_jws, {
        db: deps.db,
        now: deps.now,
      });
      return reply.code(result.status).header("cache-control", "no-store").send(result.body);
    },
  );

  app.post<{ Params: { id: string } }>(
    "/intents/:id/receipt",
    { bodyLimit: 4 * 1024, config: { rateLimit: RATE_LIMITS.checkout } },
    async (req, reply) => {
      const parsed = IntentReceiptRequest.safeParse(req.body);
      if (!parsed.success)
        return reply.code(400).send({ error: "invalid_request", message: "Expected { proof_jws }" });
      if (!UUID.test(req.params.id)) return reply.code(404).send(notFound);
      if (!deps.db) return reply.code(503).send(notConfigured);
      const result = await intentReceipt(req.params.id, parsed.data.proof_jws, {
        db: deps.db,
        now: deps.now,
      });
      return reply.code(result.status).header("cache-control", "no-store").send(result.body);
    },
  );
};
