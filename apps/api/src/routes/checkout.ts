/** POST /checkout (docs/specs/0003). A REJECT is a successful request: HTTP 200 with the reason codes. */
import type { FastifyPluginAsync } from "fastify";
import { ApproveRequest, CheckoutRequest } from "@poi/contracts";
import type { AppDeps } from "../app";
import { approveOrder } from "../approve";
import { runCheckout, type CheckoutDeps } from "../checkout";
import { approveStepUp, viewStepUp } from "../stepup";
import { RATE_LIMITS } from "../rate-limits";

type Options = AppDeps & Pick<CheckoutDeps, "aiMode" | "semanticFit" | "now" | "stepUp">;

export const checkoutRoutes: FastifyPluginAsync<Options> = async (app, deps) => {
  app.post(
    "/checkout",
    { bodyLimit: 64 * 1024, config: { rateLimit: RATE_LIMITS.checkout } },
    async (req, reply) => {
      const parsed = CheckoutRequest.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: "invalid_request",
          message: "Expected { intent_jws, payment_mandate_jws, cart }",
        });
      }
      if (!deps.db || !deps.merchant) {
        return reply.code(503).send({
          error: "not_configured",
          message: !deps.db ? "DATABASE_URL is not set" : "No merchant signing key",
        });
      }
      const result = await runCheckout(parsed.data, { ...deps, db: deps.db, merchant: deps.merchant });
      return reply.code(result.status).send(result.body);
    },
  );

  // Stage 2: the buyer app calls this from PayPal's onApprove with the shopper's countersignature.
  app.post<{ Params: { id: string } }>(
    "/checkout/:id/approve",
    { bodyLimit: 16 * 1024, config: { rateLimit: RATE_LIMITS.checkout } },
    async (req, reply) => {
      const parsed = ApproveRequest.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "invalid_request", message: "Expected { approval_jws }" });
      }
      if (!deps.db)
        return reply.code(503).send({ error: "not_configured", message: "DATABASE_URL is not set" });
      const result = await approveOrder(req.params.id, parsed.data.approval_jws, { ...deps, db: deps.db });
      return reply.code(result.status).send(result.body);
    },
  );

  // Step-up links (#35): the shopper opens the emailed link, sees the cart, and approves with their own key.
  app.get<{ Params: { token: string } }>(
    "/stepup/:token",
    { config: { rateLimit: RATE_LIMITS.checkout } },
    async (req, reply) => {
      if (!deps.db)
        return reply.code(503).send({ error: "not_configured", message: "DATABASE_URL is not set" });
      const result = await viewStepUp(req.params.token, { db: deps.db, now: deps.now });
      return reply.code(result.status).header("cache-control", "no-store").send(result.body);
    },
  );

  app.post<{ Params: { token: string } }>(
    "/stepup/:token/approve",
    { bodyLimit: 16 * 1024, config: { rateLimit: RATE_LIMITS.checkout } },
    async (req, reply) => {
      const parsed = ApproveRequest.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "invalid_request", message: "Expected { approval_jws }" });
      }
      if (!deps.db || !deps.merchant) {
        return reply.code(503).send({
          error: "not_configured",
          message: !deps.db ? "DATABASE_URL is not set" : "No merchant signing key",
        });
      }
      const result = await approveStepUp(req.params.token, parsed.data.approval_jws, {
        ...deps,
        db: deps.db,
        merchant: deps.merchant,
      });
      return reply.code(result.status).send(result.body);
    },
  );
};
