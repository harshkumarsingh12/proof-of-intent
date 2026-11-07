import { isAiUnavailable, J4_PROMPT_VERSION, runStudioTurn, StudioTurn } from "@poi/ai";
import { DisputeClass, ReasonCode } from "@poi/contracts";
import { PayPalError } from "@poi/paypal";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { AppDeps } from "../app";
import { RATE_LIMITS } from "../rate-limits";
import { operator } from "./disputes";

const disputeId = z.string().regex(/^[A-Za-z0-9-]{1,64}$/);
const input = z.union([
  StudioTurn,
  z.object({ kind: z.literal("tool"), tool: z.literal("list_disputes") }).strict(),
  z
    .object({
      kind: z.literal("tool"),
      tool: z.enum(["get_dispute", "explain_dispute", "draft_buyer_message"]),
      disputeId,
    })
    .strict(),
]);

const recommendation = z.object({
  class: DisputeClass,
  action: z.enum(["PROVIDE_EVIDENCE", "ACCEPT_CLAIM", "MAKE_OFFER", "STANDARD_EVIDENCE"]),
  reasons: z.array(ReasonCode),
  constraintChecks: z.array(z.object({ name: z.string(), passed: z.boolean() })),
  mandateHash: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .optional(),
});

/** How many disputes the list tool returns to the chat (the counts cover all of them). */
const STUDIO_LIST_LIMIT = 12;

/** PayPal statuses that mean the merchant owes the next move. */
const NEEDS_RESPONSE = new Set(["WAITING_FOR_SELLER_RESPONSE", "ACTION_REQUIRED"]);

const draftMessages: Record<z.infer<typeof DisputeClass>, string> = {
  MANDATE_COMPLIANT:
    "We reviewed the order against the signed purchase instructions and are preparing the supporting record for review.",
  AGENT_OVERREACH:
    "Our review found that the purchase exceeded or conflicted with the instructions you signed. We are reviewing the appropriate resolution.",
  INTENT_MISREAD:
    "Our review found a difference between the purchase and the request. We are reviewing the appropriate resolution.",
  NO_MANDATE:
    "We are reviewing the information available for this purchase through the standard dispute process.",
};

export const studioRoutes: FastifyPluginAsync<AppDeps> = async (app, deps) => {
  // Depend on the Agent Toolkit-backed read methods only.
  const { getDispute, listDisputes } = deps.paypal;
  app.post(
    "/ai/studio",
    { bodyLimit: 128 * 1024, config: { rateLimit: RATE_LIMITS.studio } },
    async (req, reply) => {
      if (!operator(req, reply, deps.operatorToken)) return;
      const parsed = input.safeParse(req.body);
      if (!parsed.success)
        return reply
          .code(400)
          .send({ error: "invalid_request", message: "Unknown Studio operation or invalid arguments" });
      const body = parsed.data;
      try {
        if (body.kind === "turn") {
          reply.header("x-poi-ai-mode", deps.aiMode ?? "replay");
          reply.header("x-poi-ai-prompt-version", J4_PROMPT_VERSION);
          return await runStudioTurn(body, deps.aiMode ?? "replay");
        }
        if (body.tool === "list_disputes" && deps.db) {
          // Our own table, so the chat can say which disputes need a response and why (and it works in mock mode,
          // where PayPal's list is empty). Counts first, then the ones needing a response soonest-first, then the
          // rest, capped: the full 24-row JSON was more than the live model would summarise.
          const rows = await deps.db.listDisputes({ limit: 100, offset: 0 });
          const items = rows.map((row) => {
            const rec = recommendation.safeParse(row.recommendation);
            return {
              id: row.id,
              status: row.status,
              needsResponse: NEEDS_RESPONSE.has(row.status ?? ""),
              ...(rec.success ? { class: rec.data.class, action: rec.data.action } : {}),
              ...(row.amountValue !== undefined
                ? { amount: `${row.currency ?? "USD"} ${(row.amountValue / 100).toFixed(2)}` }
                : {}),
              ...(row.sellerResponseDueDate ? { respondBy: row.sellerResponseDueDate } : {}),
            };
          });
          const due = (d: { respondBy?: string }) => Date.parse(d.respondBy ?? "") || Infinity;
          const waiting = items.filter((d) => d.needsResponse).sort((a, b) => due(a) - due(b));
          const others = items.filter((d) => !d.needsResponse);
          // Counts by class over every dispute, not just the rows returned: without them the model guessed
          // ("7 are agent overreach" when 7 was the number NOT waiting for a response and 5 were overreach).
          const byClass: Record<string, number> = {};
          for (const d of items) if ("class" in d && d.class) byClass[d.class] = (byClass[d.class] ?? 0) + 1;
          return {
            counts: { total: items.length, needResponse: waiting.length, other: others.length, byClass },
            disputes: [...waiting, ...others].slice(0, STUDIO_LIST_LIMIT),
            ...(items.length > STUDIO_LIST_LIMIT
              ? { note: `Showing the first ${STUDIO_LIST_LIMIT} of ${items.length}.` }
              : {}),
          };
        }
        if (body.tool === "list_disputes") {
          const disputes = await listDisputes();
          return { disputes: disputes.map(({ dispute_id, status }) => ({ id: dispute_id, status })) };
        }
        if (body.tool === "get_dispute") {
          const d = await getDispute(body.disputeId);
          return { id: d.dispute_id, status: d.status, reason: d.reason, stage: d.dispute_life_cycle_stage };
        }
        if (!deps.db)
          return reply
            .code(503)
            .send({ error: "database_not_configured", message: "The dispute database is unavailable" });
        const dispute = await deps.db.getDispute(body.disputeId);
        const result = recommendation.safeParse(dispute?.recommendation);
        if (!dispute || !result.success)
          return reply
            .code(404)
            .send({ error: "dispute_not_found", message: "No analyzed dispute with this id" });
        const rec = result.data;
        if (body.tool === "draft_buyer_message") {
          return {
            id: dispute.id,
            draft: draftMessages[rec.class],
            sent: false,
            note: "Quote this draft in your answer and call it a draft. Nothing has been sent to the buyer.",
          };
        }
        return {
          id: dispute.id,
          class: rec.class,
          action: rec.action,
          reasons: rec.reasons,
          failedChecks: rec.constraintChecks.filter((check) => !check.passed).map((check) => check.name),
          ...(rec.mandateHash ? { mandateHash: rec.mandateHash } : {}),
          // So "when is it due?" and "how much?" are answered from the dispute itself.
          ...(dispute.status ? { status: dispute.status } : {}),
          ...(dispute.amountValue !== undefined
            ? { amount: `${dispute.currency ?? "USD"} ${(dispute.amountValue / 100).toFixed(2)}` }
            : {}),
          ...(dispute.sellerResponseDueDate ? { respondBy: dispute.sellerResponseDueDate } : {}),
        };
      } catch (error) {
        if (isAiUnavailable(error)) {
          // The caller only sees "unavailable"; the log says why (no recording, invalid output, timeout, budget).
          req.log.warn({ reason: (error as Error).message }, "Studio AI unavailable");
          return reply.code(503).send({
            error: "studio_ai_unavailable",
            message:
              deps.aiMode === "live"
                ? "Studio AI is unavailable. The Analytics and Disputes views are still available."
                : "This question needs live AI, and this deployment is running without it. Without live AI the chat still answers questions about a dispute, counts, what needs attention, a buyer reply draft and what a term means. Analytics and Disputes are available either way.",
          });
        }
        if (error instanceof PayPalError && error.status === 404) {
          return reply.code(404).send({ error: "dispute_not_found", message: "PayPal has no such dispute" });
        }
        req.log.error({ err: error }, "Studio operation failed");
        return reply
          .code(503)
          .send({ error: "studio_unavailable", message: "The Studio data source is unavailable" });
      }
    },
  );
};
