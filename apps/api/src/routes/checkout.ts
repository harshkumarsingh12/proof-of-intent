/** POST /checkout (docs/specs/0003). A REJECT is a successful request: HTTP 200 with the reason codes. */
import type { FastifyPluginAsync } from "fastify";
import { CheckoutRequest } from "@poi/contracts";
import type { AppDeps } from "../app";
import { runCheckout, type CheckoutDeps } from "../checkout";

type Options = AppDeps & Pick<CheckoutDeps, "aiMode" | "semanticFit" | "now">;

export const checkoutRoutes: FastifyPluginAsync<Options> = async (app, deps) => {
  app.post("/checkout", { bodyLimit: 64 * 1024 }, async (req, reply) => {
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
  });
};
