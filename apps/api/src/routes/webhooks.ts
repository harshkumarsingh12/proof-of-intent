/**
 * POST /webhooks/paypal (docs/specs/0004 §Webhooks). Verify, persist once, answer fast.
 *
 * - Unverified or malformed delivery → 400, nothing stored.
 * - PayPal unreachable for verification, or the database down → 503, so PayPal redelivers later.
 * - Redelivery of an event we already have → 200, nothing done twice.
 * The stored row (processed_at null) is the worker's inbox; it never trusts an unverified body.
 */
import type { FastifyPluginAsync } from "fastify";
import type { WebhookHeaders } from "@poi/paypal";
import type { Db } from "@poi/db";
import type { AppDeps } from "../app";
import { RATE_LIMITS } from "../rate-limits";

interface PayPalEvent {
  id?: unknown;
  event_type?: unknown;
  resource?: {
    id?: unknown;
    /** Our order id: we send it as invoice_id. */
    invoice_id?: unknown;
    supplementary_data?: { related_ids?: { order_id?: unknown } };
  };
}

const header = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export const webhookRoutes: FastifyPluginAsync<AppDeps> = async (app, deps) => {
  // Keep the body as the exact string PayPal signed; this parser applies only inside this plugin.
  app.addContentTypeParser("application/json", { parseAs: "string" }, (_req, body, done) => done(null, body));

  app.post(
    "/webhooks/paypal",
    { bodyLimit: 256 * 1024, config: { rateLimit: RATE_LIMITS.webhook } },
    async (req, reply) => {
      const raw = typeof req.body === "string" ? req.body : "";
      const transmissionId = header(req.headers["paypal-transmission-id"]);
      const transmissionTime = header(req.headers["paypal-transmission-time"]);
      const transmissionSig = header(req.headers["paypal-transmission-sig"]);
      const certUrl = header(req.headers["paypal-cert-url"]);
      const authAlgo = header(req.headers["paypal-auth-algo"]);
      if (!raw || !transmissionId || !transmissionTime || !transmissionSig || !certUrl || !authAlgo) {
        return reply
          .code(400)
          .send({ error: "webhook_unverified", message: "Missing PayPal transmission headers or body" });
      }
      const h: WebhookHeaders = { transmissionId, transmissionTime, transmissionSig, certUrl, authAlgo };

      let event: PayPalEvent;
      try {
        event = JSON.parse(raw) as PayPalEvent;
      } catch {
        return reply.code(400).send({ error: "webhook_unverified", message: "Body is not JSON" });
      }
      if (typeof event.id !== "string" || typeof event.event_type !== "string") {
        return reply
          .code(400)
          .send({ error: "webhook_unverified", message: "Event has no id or event_type" });
      }

      let verified: boolean;
      try {
        verified = await deps.paypal.verifyWebhook(h, raw);
      } catch (err) {
        req.log.error({ err, eventId: event.id }, "webhook verification unavailable");
        return reply
          .code(503)
          .send({ error: "verification_unavailable", message: "Could not reach PayPal to verify" });
      }
      if (!verified) {
        req.log.warn({ eventId: event.id, eventType: event.event_type }, "rejected unverified webhook");
        return reply
          .code(400)
          .send({ error: "webhook_unverified", message: "PayPal did not verify this delivery" });
      }

      if (!deps.db) {
        return reply.code(503).send({ error: "database_not_configured", message: "DATABASE_URL is not set" });
      }
      const resourceId = typeof event.resource?.id === "string" ? event.resource.id : undefined;
      const stored = await deps.db.recordWebhookEvent({
        eventId: event.id,
        eventType: event.event_type,
        resourceId,
        payload: event,
      });
      if (stored) {
        await deps.db.appendAudit({
          actor: "paypal",
          action: "webhook.received",
          subjectId: resourceId ?? event.id,
          requestBody: { eventId: event.id, eventType: event.event_type, transmissionId: h.transmissionId },
        });
      }
      await settleUnknownOutcome(deps.db, event);
      req.log.info(
        { eventId: event.id, eventType: event.event_type, duplicate: !stored },
        "webhook accepted",
      );
      return reply.code(200).send({ status: stored ? "stored" : "duplicate" });
    },
  );
};

/**
 * A verified PAYMENT.CAPTURE.COMPLETED for an order whose create-order answer was lost (UNKNOWN_OUTCOME) settles it:
 * the charge happened (#159). `invoice_id` is our order id. Nothing else here changes an order.
 */
async function settleUnknownOutcome(db: Db, event: PayPalEvent): Promise<void> {
  if (event.event_type !== "PAYMENT.CAPTURE.COMPLETED") return;
  const { id, invoice_id: invoiceId, supplementary_data: extra } = event.resource ?? {};
  if (typeof id !== "string" || typeof invoiceId !== "string") return;
  const order = await db.getOrder(invoiceId);
  if (order?.status !== "UNKNOWN_OUTCOME") return;
  const paypalOrderId = extra?.related_ids?.order_id;
  await db.updateOrder(order.id, {
    status: "COMPLETED",
    captureId: id,
    capturedAt: new Date().toISOString(),
    ...(typeof paypalOrderId === "string" ? { paypalOrderId } : {}),
  });
  await db.appendAudit({
    actor: "paypal",
    action: "order.outcome_confirmed",
    subjectId: order.id,
    requestBody: { captureId: id, via: event.event_type },
  });
}
