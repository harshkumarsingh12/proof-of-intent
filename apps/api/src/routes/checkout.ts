/** POST /checkout (docs/specs/0003). A REJECT is a successful request: HTTP 200 with the reason codes. */
import type { FastifyPluginAsync, FastifyReply } from "fastify";
import { z } from "zod";
import { ApproveRequest, CheckoutRequest, StepUpListRequest } from "@poi/contracts";
import type { AppDeps } from "../app";
import { approveOrder } from "../approve";
import { runCheckout, type CheckoutDeps } from "../checkout";
import { approveStepUp, approveStepUpById, listPendingStepUps, viewStepUp } from "../stepup";
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
  // The token travels in the request body, never in a path (#257): the link carries it after `#`, which a browser never
  // sends to a server, and the approval page posts it here, so no proxy or CDN in front of the shop or this API sees it.
  app.post(
    "/stepup/view",
    { bodyLimit: 4 * 1024, config: { rateLimit: RATE_LIMITS.checkout } },
    async (req, reply) => {
      const parsed = StepUpViewBody.safeParse(req.body);
      if (!parsed.success)
        return reply.code(400).send({ error: "invalid_request", message: "Expected { token }" });
      if (!deps.db)
        return reply.code(503).send({ error: "not_configured", message: "DATABASE_URL is not set" });
      const result = await viewStepUp(parsed.data.token, { db: deps.db, now: deps.now });
      return reply.code(result.status).header("cache-control", "no-store").send(result.body);
    },
  );

  app.post(
    "/stepup/approve",
    { bodyLimit: 16 * 1024, config: { rateLimit: RATE_LIMITS.checkout } },
    async (req, reply) => {
      const parsed = StepUpApproveBody.safeParse(req.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: "invalid_request", message: "Expected { token, approval_jws }" });
      }
      if (!deps.db || !deps.merchant) {
        return reply.code(503).send({
          error: "not_configured",
          message: !deps.db ? "DATABASE_URL is not set" : "No merchant signing key",
        });
      }
      const result = await approveStepUp(parsed.data.token, parsed.data.approval_jws, {
        ...deps,
        db: deps.db,
        merchant: deps.merchant,
      });
      return reply.code(result.status).header("cache-control", "no-store").send(result.body);
    },
  );

  // The old routes took the token in the path. They answer 410 without looking the token up, so a link sent before
  // #257 reveals nothing and approves nothing; the shopper finds the cart in the shop's own list instead. Remove later.
  app.get("/stepup/:token", { config: { rateLimit: RATE_LIMITS.checkout } }, async (_req, reply) =>
    moved(reply),
  );
  app.post(
    "/stepup/:token/approve",
    { bodyLimit: 16 * 1024, config: { rateLimit: RATE_LIMITS.checkout } },
    async (_req, reply) => moved(reply),
  );

  // The shop's own list of carts waiting for the shopper: a fresh signature from their key, no link needed.
  app.post(
    "/stepups/pending",
    { bodyLimit: 4 * 1024, config: { rateLimit: RATE_LIMITS.checkout } },
    async (req, reply) => {
      const parsed = StepUpListRequest.safeParse(req.body);
      if (!parsed.success)
        return reply.code(400).send({ error: "invalid_request", message: "Expected { proof_jws }" });
      if (!deps.db)
        return reply.code(503).send({ error: "not_configured", message: "DATABASE_URL is not set" });
      const result = await listPendingStepUps(parsed.data.proof_jws, { db: deps.db, now: deps.now });
      return reply.code(result.status).header("cache-control", "no-store").send(result.body);
    },
  );

  app.post<{ Params: { id: string } }>(
    "/stepups/:id/approve",
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
      const result = await approveStepUpById(req.params.id, parsed.data.approval_jws, {
        ...deps,
        db: deps.db,
        merchant: deps.merchant,
      });
      return reply.code(result.status).send(result.body);
    },
  );
};

const StepUpViewBody = z.object({ token: z.string().min(1).max(256) });
const StepUpApproveBody = ApproveRequest.extend({ token: z.string().min(1).max(256) });

const moved = (reply: FastifyReply) =>
  reply
    .code(410)
    .header("cache-control", "no-store")
    .send({
      error: "stepup_link_moved",
      message:
        "This approval link uses an old format and no longer works. Nothing was charged. " +
        "Open the shop in the browser you signed with to see the carts waiting for you",
    });
