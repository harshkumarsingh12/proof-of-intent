/** Vault v3 wallet saving (docs/specs/0004 §Vault). Public routes: every write carries the shopper's own signature. */
import type { FastifyPluginAsync } from "fastify";
import { VaultSaveRequest, VaultSetupRequest } from "@poi/contracts";
import type { AppDeps } from "../app";
import { RATE_LIMITS } from "../rate-limits";
import { saveWallet, startWalletSetup, walletStatus, type VaultDeps } from "../vault";

type Options = AppDeps & Pick<VaultDeps, "now" | "buyerBase">;

export const vaultRoutes: FastifyPluginAsync<Options> = async (app, deps) => {
  const notConfigured = { error: "not_configured", message: "DATABASE_URL is not set" };

  app.post(
    "/vault/setup",
    { bodyLimit: 4 * 1024, config: { rateLimit: RATE_LIMITS.keys } },
    async (req, reply) => {
      const parsed = VaultSetupRequest.safeParse(req.body);
      if (!parsed.success)
        return reply.code(400).send({ error: "invalid_request", message: "Expected { proof_jws }" });
      if (!deps.db) return reply.code(503).send(notConfigured);
      const result = await startWalletSetup(parsed.data.proof_jws, { ...deps, db: deps.db });
      return reply.code(result.status).send(result.body);
    },
  );

  app.post(
    "/vault/save",
    { bodyLimit: 4 * 1024, config: { rateLimit: RATE_LIMITS.keys } },
    async (req, reply) => {
      const parsed = VaultSaveRequest.safeParse(req.body);
      if (!parsed.success)
        return reply
          .code(400)
          .send({ error: "invalid_request", message: "Expected { setup_token_id, proof_jws }" });
      if (!deps.db) return reply.code(503).send(notConfigured);
      const result = await saveWallet(parsed.data.setup_token_id, parsed.data.proof_jws, {
        ...deps,
        db: deps.db,
      });
      return reply.code(result.status).send(result.body);
    },
  );

  app.get<{ Params: { kid: string } }>(
    "/vault/:kid",
    { config: { rateLimit: RATE_LIMITS.checkout } },
    async (req, reply) => {
      if (!deps.db) return reply.code(503).send(notConfigured);
      const result = await walletStatus(req.params.kid, { db: deps.db });
      return reply.code(result.status).header("cache-control", "no-store").send(result.body);
    },
  );
};
