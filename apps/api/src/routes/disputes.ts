/**
 * Dashboard reads and operator actions (docs/specs/0003, 0005, 0007).
 *
 * The worker writes each dispute's recommendation and evidence package; these routes shape it for the
 * dashboard (its DisputeItem / DisputeDetail types) and carry out the one PayPal action an operator clicks.
 * Invariant 4: the operator's audit row is written before PayPal is called, and no other path calls it.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { CartMandate, IntentMandate, type DisputeClass, type Money, type ReasonCode } from "@poi/contracts";
import type { AuditRecord, Db, DisputeRow, DisputeSummary, StoredOrder } from "@poi/db";
import { evidenceTypeFor, fromPayPalAmount, PayPalError } from "@poi/paypal";
import type { AppDeps } from "../app";

/** What the worker stores in disputes.recommendation (apps/worker/src/inbox.ts). */
interface Recommendation {
  demo?: boolean;
  class: DisputeClass;
  action: "PROVIDE_EVIDENCE" | "ACCEPT_CLAIM" | "MAKE_OFFER" | "STANDARD_EVIDENCE";
  reasons: ReasonCode[];
  constraintChecks: { name: string; rule: string; actual: string; passed: boolean }[];
  checkoutVerdict: string | null;
  draft?: {
    cover_note: string;
    attestation_sections: { heading: string; body: string }[];
    buyer_message: string;
  };
  mandateHash?: string;
  customId?: string;
  evidenceError?: string;
  /** J2 (packages/ai): cited explanation of the deterministic class. Absent when the model couldn't answer. */
  ai?: {
    confidence?: number;
    grounding_version?: string;
    reasons: { text: string; cites: string[] }[];
    evidence_plan: { text: string; cites: string[] }[];
  };
  analyzedAt: string;
}

const DECISION: Record<DisputeClass, "defend" | "concede" | "standard"> = {
  MANDATE_COMPLIANT: "defend",
  AGENT_OVERREACH: "concede",
  INTENT_MISREAD: "concede",
  NO_MANDATE: "standard",
};

const EXPLANATION: Record<DisputeClass, string> = {
  MANDATE_COMPLIANT:
    "The cart passed every hard rule in the shopper's signed Intent Mandate at capture time.",
  AGENT_OVERREACH:
    "Replaying the checkout rules at capture time, the agent's cart breaks the signed mandate.",
  INTENT_MISREAD: "The cart fits the hard rules but not the shopper's own words.",
  NO_MANDATE: "No signed mandate matches this order, so it takes PayPal's standard dispute path.",
};

const ACTIONS = ["provide-evidence", "accept-claim", "send-message", "escalate"] as const;
type Action = (typeof ACTIONS)[number];

const page = (q: unknown) => {
  const { limit, offset } = (q ?? {}) as { limit?: string; offset?: string };
  return {
    limit: Math.min(Math.max(Number(limit) || 50, 1), 200),
    offset: Math.max(Number(offset) || 0, 0),
  };
};

const notesOf = (d: DisputeSummary | DisputeRow) =>
  (d.paypal as { disputed_transactions?: { items?: { notes?: string }[] }[] } | null)
    ?.disputed_transactions?.[0]?.items?.[0]?.notes;

/**
 * How PayPal closed the dispute, from the PayPal dispute object we stored (`dispute_outcome`), or nothing while it is open
 * or PayPal gave no outcome. The dashboard's wins, refunds and protected amounts read this, never the copilot's
 * recommendation (#165). Both spellings of "favour" appear in PayPal's documentation, so both are read.
 */
export function outcomeOf(d: Pick<DisputeSummary, "status" | "paypal">) {
  if (d.status !== "RESOLVED") return undefined;
  const o = (
    d.paypal as {
      dispute_outcome?: {
        outcome_code?: string;
        amount_refunded?: { currency_code?: string; value?: string };
      };
    } | null
  )?.dispute_outcome;
  const code = o?.outcome_code;
  if (!code) return undefined;
  const result = /SELLER_FAVOU?R/.test(code)
    ? "SELLER_FAVOUR"
    : /BUYER_FAVOU?R/.test(code)
      ? "BUYER_FAVOUR"
      : "OTHER";
  const r = o?.amount_refunded;
  const refunded =
    r?.currency_code && r.value !== undefined && Number.isFinite(Number(r.value))
      ? fromPayPalAmount({ currency_code: r.currency_code, value: r.value })
      : undefined;
  return { result, code, ...(refunded ? { refunded } : {}) } as const;
}

function item(
  d: DisputeSummary | DisputeRow,
  order: StoredOrder | null,
  rec: Recommendation,
  hasPdf: boolean,
) {
  const createdAt = d.createdAt ?? rec.analyzedAt;
  const notes = notesOf(d);
  const outcome = outcomeOf(d);
  return {
    id: d.id,
    orderId: d.orderId ?? "",
    paypalOrderId: order?.paypalOrderId ?? "",
    status: d.status ?? "OPEN",
    decision: DECISION[rec.class],
    disputeClass: rec.class,
    amount: { value: d.amountValue ?? 0, currency: d.currency ?? "USD" } satisfies Money,
    createdAt,
    // PayPal only sets a deadline while it waits on us; without one there is nothing left to answer.
    sellerResponseDueDate: d.sellerResponseDueDate ?? createdAt,
    reasons: rec.reasons,
    agentPlatform: order?.agentPlatform ?? "none",
    buyerDisputeReason: d.reason ?? "",
    ...(notes ? { shopperNotes: notes } : {}),
    evidenceDrafted: hasPdf,
    ...(outcome ? { outcome } : {}),
  };
}

async function detail(db: Db, d: DisputeRow, rec: Recommendation) {
  const order = d.orderId ? await db.getOrder(d.orderId) : null;
  const intentRow = order ? await db.getMandate(order.intentMandateHash) : null;
  const cartRow = order?.cartMandateHash ? await db.getMandate(order.cartMandateHash) : null;
  const intent = intentRow ? IntentMandate.parse(JSON.parse(intentRow.canonical)) : null;
  const cart = cartRow ? CartMandate.parse(JSON.parse(cartRow.canonical)) : null;
  const base = item(d, order, rec, d.evidencePdf !== undefined);
  const c = intent?.constraints;
  const modelConfidence = rec.ai?.confidence;
  const groundedAi = rec.ai?.grounding_version === "source-excerpts-v1" ? rec.ai : undefined;
  return {
    ...base,
    ...(intent
      ? {
          shopperIntentText: intent.natural_language_description,
          mandateId: intent.mandate_id,
          mandateNonce: intent.nonce,
          mandateIssuer: intent.issuer,
          mandateCreatedAt: intent.created_at,
          mandateExpiry: intent.intent_expiry,
        }
      : {}),
    checkoutVerdict: rec.checkoutVerdict ?? "NONE",
    cartLines: (cart?.contents.lines ?? []).map((l) => ({
      sku: l.sku,
      title: l.title,
      ...(l.attributes.color ? { color: l.attributes.color } : {}),
      ...(l.attributes.category ? { category: l.attributes.category } : {}),
      unitPrice: l.unit_price,
      quantity: l.quantity,
    })),
    cartTotal: cart?.contents.total ?? base.amount,
    cartMerchantName: cart?.contents.merchant_name ?? "",
    constraints: {
      amountMax: c?.amount_max ?? { value: 0, currency: base.amount.currency },
      merchantAllowlist: c?.merchant_allowlist ?? [],
      attributes: c?.attributes ?? {},
      quantityMax: { perLine: c?.quantity_max?.per_line ?? 0, perOrder: c?.quantity_max?.per_order ?? 0 },
    },
    constraintChecks: rec.constraintChecks.map((k) => ({
      id: k.name,
      name: k.name,
      mandateRule: k.rule,
      cartActual: k.actual,
      status: k.passed ? "PASS" : "FAIL",
      explanation: k.passed ? "Within the signed limit." : "Outside the signed limit.",
    })),
    classificationInfo: {
      disputeClass: rec.class,
      // This is a model's uncalibrated estimate, never certainty assigned to the deterministic class.
      confidence:
        typeof modelConfidence === "number" &&
        Number.isFinite(modelConfidence) &&
        modelConfidence >= 0 &&
        modelConfidence <= 1
          ? modelConfidence
          : null,
      recommendedAction: rec.action,
      reasons: [
        { text: EXPLANATION[rec.class], cites: rec.mandateHash ? [`intent_mandate:${rec.mandateHash}`] : [] },
        // J2 explains the class in the dispute's own terms; every line cites a fact the model was given.
        ...(groundedAi?.reasons ?? []),
        ...rec.reasons.map((r) => ({
          text: r,
          cites: intent ? [`intent_mandate:${intent.mandate_id}`] : [],
        })),
        ...(rec.evidenceError ? [{ text: `No evidence package: ${rec.evidenceError}`, cites: [] }] : []),
      ],
      evidencePlan: groundedAi?.evidence_plan.length
        ? groundedAi.evidence_plan.map((p) => p.text)
        : rec.action === "PROVIDE_EVIDENCE"
          ? ["Attestation PDF generated from the audit log", "JSON bundle: signed mandates and hashes"]
          : rec.action === "ACCEPT_CLAIM"
            ? ["Accept the claim; PayPal refunds the buyer"]
            : ["Respond through PayPal's standard dispute path"],
    },
    ...(rec.draft && rec.mandateHash && rec.customId
      ? {
          evidenceDraftInfo: {
            coverNote: rec.draft.cover_note,
            attestationSections: rec.draft.attestation_sections,
            buyerMessage: rec.draft.buyer_message,
            attestationHash: rec.mandateHash,
            customId: rec.customId,
            pdfFilename: pdfName(d.id),
            generatedAt: rec.analyzedAt,
          },
        }
      : {}),
  };
}

const pdfName = (id: string) => `evidence-${id}.pdf`;

/** Bearer OPERATOR_TOKEN. Unset → operator actions are off; nobody can move money by default. */
export function operator(req: FastifyRequest, reply: FastifyReply, token: string | undefined): string | null {
  if (!token) {
    reply.code(503).send({ error: "operator_actions_disabled", message: "OPERATOR_TOKEN is not set" });
    return null;
  }
  const sent = /^Bearer (.+)$/.exec(req.headers.authorization ?? "")?.[1] ?? "";
  const digest = (s: string) => createHash("sha256").update(s).digest();
  if (!timingSafeEqual(digest(sent), digest(token))) {
    reply.code(401).send({ error: "operator_unauthorized", message: "A valid operator token is required" });
    return null;
  }
  const name = req.headers["x-operator"];
  return `operator:${typeof name === "string" && /^[\w.@-]{1,64}$/.test(name) ? name : "dashboard"}`;
}

/** One audit row as the dashboard's panel shows it: who did what and when, with the few fields worth reading. */
export interface DisputeAuditEntry {
  id: number;
  at: string;
  actor: string;
  action: string;
  /** What the copilot recommended when the operator acted (its class), for operator rows. */
  recommended?: string;
  /** True when the operator accepted the claim although the copilot recommended defending (docs/specs/0005). */
  override?: boolean;
  /** The operator's own note or message, as sent to PayPal. */
  note?: string;
  /** Webhook event type, or the failure message of a PayPal call. */
  detail?: string;
}

const short = (v: unknown, max = 500) =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined;

/** Whitelists what leaves the API: never the raw request body, which can hold evidence text or ids we do not need. */
export function auditView(rec: AuditRecord): DisputeAuditEntry {
  const body = (rec.requestBody ?? {}) as Record<string, unknown>;
  const recommended = (
    (rec.priorState ?? {}) as { recommendation?: { class?: string; action?: string } | null }
  ).recommendation;
  const entry: DisputeAuditEntry = { id: rec.id, at: rec.at, actor: rec.actor, action: rec.action };
  if (rec.action.startsWith("operator.")) {
    if (recommended?.class) entry.recommended = recommended.class;
    if (rec.action === "operator.accept-claim" && recommended?.action === "PROVIDE_EVIDENCE")
      entry.override = true;
    const note = short(body.note) ?? short(body.notes) ?? short(body.message);
    if (note) entry.note = note;
  } else if (rec.action === "webhook.received") {
    const detail = short(body.eventType, 100);
    if (detail) entry.detail = detail;
  } else if (rec.action.endsWith(".failed")) {
    const detail = short(body.message, 300);
    if (detail) entry.detail = detail;
  }
  return entry;
}

/**
 * Reads of merchant data (#163): the orders, verdicts, disputes, their audit rows and the evidence PDFs. With
 * OPERATOR_TOKEN set they need it as a bearer token, which only the dashboard's server holds; a browser reaches them
 * through the dashboard, never directly. With it unset the API runs open, as the zero-credential mock stack does, and
 * `/readyz` says `reads: "open"` so a deployment can be checked from outside.
 */
export function readsAllowed(req: FastifyRequest, token: string | undefined): boolean {
  if (!token) return true;
  const sent = /^Bearer (.+)$/.exec(req.headers.authorization ?? "")?.[1] ?? "";
  const digest = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(digest(sent), digest(token));
}

export const disputeRoutes: FastifyPluginAsync<AppDeps> = async (app, deps) => {
  // Every GET in this plugin returns merchant data; its POSTs carry their own operator check.
  app.addHook("onRequest", async (req, reply) => {
    if (req.method !== "GET" || readsAllowed(req, deps.operatorToken)) return;
    return reply.code(401).header("www-authenticate", "Bearer").send({
      error: "read_unauthorized",
      message: "A valid operator token is required to read merchant data",
    });
  });

  const needDb = (reply: FastifyReply): Db | null => {
    if (deps.db) return deps.db;
    reply.code(503).send({ error: "database_not_configured", message: "DATABASE_URL is not set" });
    return null;
  };

  app.get("/orders", async (req, reply) => {
    const db = needDb(reply);
    return db && { orders: await db.listOrders(page(req.query)) };
  });

  app.get("/verifications", async (req, reply) => {
    const db = needDb(reply);
    return db && { verifications: await db.listVerdicts(page(req.query)) };
  });

  // Fulfillment: tracking on the capture is the evidence PayPal wants for "not received" disputes (spec 0005 §3).
  app.post<{
    Params: { id: string };
    Body: { trackingNumber?: unknown; carrier?: unknown; status?: unknown } | undefined;
  }>("/orders/:id/tracking", { bodyLimit: 8 * 1024 }, async (req, reply) => {
    const actor = operator(req, reply, deps.operatorToken);
    if (!actor) return;
    const db = needDb(reply);
    if (!db) return;
    const { trackingNumber, carrier, status } = req.body ?? {};
    const STATUSES = ["SHIPPED", "ON_HOLD", "DELIVERED", "CANCELLED"] as const;
    if (
      typeof trackingNumber !== "string" ||
      !/^[A-Za-z0-9-]{1,64}$/.test(trackingNumber) ||
      typeof carrier !== "string" ||
      !/^[A-Z0-9_]{2,64}$/.test(carrier) ||
      (status !== undefined && !STATUSES.includes(status as (typeof STATUSES)[number]))
    ) {
      return reply.code(400).send({
        error: "invalid_request",
        message: "Expected { trackingNumber, carrier (PayPal code, e.g. USPS), status? }",
      });
    }
    const order = await db.getOrder(req.params.id);
    if (!order) return reply.code(404).send({ error: "order_not_found", message: "Unknown order" });
    if (!order.captureId) {
      return reply
        .code(409)
        .send({ error: "order_not_captured", message: "Tracking needs a captured payment" });
    }
    if (order.captureId.startsWith("DEMO-CAPTURE-")) {
      return reply.code(409).send({ error: "demo_read_only", message: "Seeded orders are read-only" });
    }
    const input = {
      captureId: order.captureId,
      trackingNumber,
      carrier,
      status: (status as (typeof STATUSES)[number] | undefined) ?? "SHIPPED",
    };
    await db.appendAudit({ actor, action: "operator.add-tracking", subjectId: order.id, requestBody: input });
    try {
      await deps.paypal.addTracking(input);
    } catch (err) {
      await db.appendAudit({
        actor: "api",
        action: "paypal.add-tracking.failed",
        subjectId: order.id,
        requestBody: { message: (err as Error).message },
      });
      if (err instanceof PayPalError && err.status < 500) {
        return reply.code(409).send({ error: "paypal_refused", message: err.message, issue: err.issue });
      }
      return reply
        .code(503)
        .header("retry-after", "5")
        .send({ error: "paypal_unavailable", message: "PayPal tracking failed; try again" });
    }
    await db.appendAudit({
      actor: "api",
      action: "paypal.add-tracking",
      subjectId: order.id,
      requestBody: input,
    });
    return { status: "sent", captureId: order.captureId };
  });

  app.get("/disputes", async (req, reply) => {
    const db = needDb(reply);
    if (!db) return;
    const rows = (await db.listDisputes(page(req.query))).filter((d) => d.recommendation);
    // ponytail: one order lookup per dispute; fine for a demo merchant, join in listDisputes if it grows.
    const disputes = await Promise.all(
      rows.map(async (d) =>
        item(
          d,
          d.orderId ? await db.getOrder(d.orderId) : null,
          d.recommendation as Recommendation,
          d.hasEvidencePdf,
        ),
      ),
    );
    return { disputes };
  });

  app.get<{ Params: { id: string } }>("/disputes/:id/recommendation", async (req, reply) => {
    const db = needDb(reply);
    if (!db) return;
    const d = await db.getDispute(req.params.id);
    if (!d?.recommendation) {
      return reply
        .code(404)
        .send({ error: "dispute_not_found", message: "No analyzed dispute with this id" });
    }
    return detail(db, d, d.recommendation as Recommendation);
  });

  // The dispute's audit trail, oldest first, read from audit_log (not from the page's state). The operator's row sits
  // before the PayPal call it authorized, so this is also how to see invariant 4 on a deployed server.
  app.get<{ Params: { id: string } }>("/disputes/:id/audit", async (req, reply) => {
    const db = needDb(reply);
    if (!db) return;
    if (!(await db.getDispute(req.params.id))) {
      return reply
        .code(404)
        .send({ error: "dispute_not_found", message: "No analyzed dispute with this id" });
    }
    return { entries: (await db.auditTrail(req.params.id)).map(auditView) };
  });

  // What PayPal allows on this dispute right now, asked live (get_dispute): the worker's copy can be minutes old,
  // and a button disabled from stale data could block a valid action. Rel names map to our action names.
  app.get<{ Params: { id: string } }>("/disputes/:id/paypal-actions", async (req, reply) => {
    try {
      const live = await deps.paypal.getDispute(req.params.id);
      const rels = new Set((live.links ?? []).map((l) => l.rel));
      const allowed = ACTIONS.filter((a) => rels.has(a.replace("-", "_")));
      return { stage: live.dispute_life_cycle_stage ?? null, status: live.status ?? null, allowed };
    } catch (err) {
      if (err instanceof PayPalError && err.status === 404) {
        return reply.code(404).send({ error: "dispute_not_found", message: "PayPal has no such dispute" });
      }
      return reply
        .code(503)
        .header("retry-after", "5")
        .send({ error: "paypal_unavailable", message: "Could not reach PayPal" });
    }
  });

  app.get<{ Params: { id: string } }>("/disputes/:id/evidence.pdf", async (req, reply) => {
    const db = needDb(reply);
    if (!db) return;
    const d = await db.getDispute(req.params.id);
    if (!d?.evidencePdf) {
      return reply
        .code(404)
        .send({ error: "no_evidence_package", message: "This dispute has no evidence package" });
    }
    return reply
      .type("application/pdf")
      .header("content-disposition", `inline; filename="${pdfName(d.id)}"`)
      .send(Buffer.from(d.evidencePdf));
  });

  app.post<{
    Params: { id: string; action: string };
    Body: { note?: unknown; message?: unknown } | undefined;
  }>("/disputes/:id/actions/:action", { bodyLimit: 32 * 1024 }, async (req, reply) => {
    const actor = operator(req, reply, deps.operatorToken);
    if (!actor) return;
    const action = req.params.action as Action;
    if (!ACTIONS.includes(action)) {
      const outOfScope = req.params.action === "make-offer";
      return reply.code(outOfScope ? 501 : 404).send({
        error: outOfScope ? "not_implemented" : "unknown_action",
        message: outOfScope ? "Make-offer is out of scope (spec 0005)" : `Actions: ${ACTIONS.join(", ")}`,
      });
    }
    const db = needDb(reply);
    if (!db) return;
    const d = await db.getDispute(req.params.id);
    if (!d) return reply.code(404).send({ error: "dispute_not_found", message: "Unknown dispute" });
    const rec = d.recommendation as Recommendation | undefined;
    if (rec?.demo) {
      return reply.code(409).send({ error: "demo_read_only", message: "Seeded disputes are read-only" });
    }
    const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 2000) : undefined);
    const note = text(req.body?.note);

    let send: () => Promise<void>;
    let request: Record<string, unknown>;
    if (action === "provide-evidence") {
      if (!d.evidencePdf) {
        return reply
          .code(409)
          .send({ error: "no_evidence_package", message: "This dispute has no evidence package" });
      }
      const notes = note ?? rec?.draft?.cover_note ?? "Signed mandate attestation attached.";
      const evidenceType = evidenceTypeFor(d.reason ?? "");
      // The worker re-renders the PDF on each dispute update; the hash records exactly which bytes went to PayPal.
      const pdfSha256 = createHash("sha256").update(d.evidencePdf).digest("hex");
      request = { notes, evidenceType, file: pdfName(d.id), pdfSha256, mandateHash: rec?.mandateHash };
      send = () =>
        deps.paypal.provideEvidence(d.id, {
          notes,
          evidenceType,
          files: [{ name: pdfName(d.id), data: d.evidencePdf! }],
        });
    } else if (action === "accept-claim") {
      const reasons = rec?.reasons.length ? ` (${rec.reasons.join(", ")})` : "";
      const claimNote =
        note ?? `Accepted after review: the purchase did not match the shopper's signed intent${reasons}.`;
      request = { note: claimNote, amount: { value: d.amountValue, currency: d.currency } };
      send = () => deps.paypal.acceptClaim(d.id, claimNote);
    } else if (action === "escalate") {
      const escalateNote =
        note ?? "Escalating so PayPal can review the signed record of the shopper's instructions.";
      request = { note: escalateNote };
      send = () => deps.paypal.escalate(d.id, escalateNote);
    } else {
      const message = text(req.body?.message) ?? rec?.draft?.buyer_message;
      if (!message)
        return reply.code(400).send({ error: "invalid_request", message: "Expected { message }" });
      request = { message };
      send = () => deps.paypal.sendMessage(d.id, message);
    }

    // The click is on record before PayPal hears about it (invariant 4).
    await db.appendAudit({
      actor,
      action: `operator.${action}`,
      subjectId: d.id,
      priorState: {
        status: d.status ?? null,
        recommendation: rec ? { class: rec.class, action: rec.action } : null,
      },
      requestBody: request,
    });
    try {
      await send();
    } catch (err) {
      await db.appendAudit({
        actor: "api",
        action: `paypal.${action}.failed`,
        subjectId: d.id,
        requestBody: { message: (err as Error).message },
      });
      if (err instanceof PayPalError && err.status < 500) {
        return reply.code(409).send({
          error: "paypal_refused",
          message: `PayPal refused ${action}: ${err.issue}`,
          issue: err.issue,
          debugId: err.debugId,
        });
      }
      req.log.error({ err, disputeId: d.id, action }, "dispute action failed");
      return reply
        .code(503)
        .header("retry-after", "5")
        .send({ error: "paypal_unavailable", message: `PayPal ${action} failed; try again` });
    }
    await db.appendAudit({ actor: "api", action: `paypal.${action}`, subjectId: d.id, requestBody: request });
    return { status: "sent", action };
  });
};
