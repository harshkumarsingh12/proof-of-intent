/**
 * The worker's inbox (docs/specs/0005): verified CUSTOMER.DISPUTE.* deliveries in webhook_events that have
 * no processed_at yet. For each one: match the dispute to our order, replay the checkout rules through the
 * deterministic tree, build the evidence package when the order was compliant, and store it all on the
 * dispute row for the operator. The worker only reads from PayPal, through the Agent Toolkit (`get_dispute`,
 * `list_disputes`); dispute actions only follow an operator click in the API.
 *
 * Handling an event twice gives the same dispute row, so a crash between saving and marking the event
 * processed just repeats the work once, when its claim lease runs out.
 */
import { classifyDispute, isAiUnavailable, parseAiMode, type AiMode } from "@poi/ai";
import { CartMandate, IntentMandate, type Outcome, type ReasonCode } from "@poi/contracts";
import type { Db, StoredOrder } from "@poi/db";
import { fromPayPalAmount, PayPalError, type PayPalClient, type PayPalDispute } from "@poi/paypal";
import { importJWK, type JWK } from "jose";
import { disputeFacts, runDisputeClassifier, type DisputeRecord, type OrderRecord } from "./classifier";
import { buildConstraintChecks, draftEvidenceForDefend, type EvidencePackageResult } from "./evidence";
import { logger } from "./logger";

export interface InboxDeps {
  db: Db;
  /** Absent: the webhook payload is all we know. Present: every dispute is re-read from PayPal first. */
  paypal?: Pick<PayPalClient, "getDispute" | "listDisputes">;
  aiMode?: AiMode;
  now?: () => string;
  log?: (msg: string) => void;
}

/** How many times an event is tried before it is quarantined (#164). */
export const MAX_EVENT_ATTEMPTS = 5;
/** How long a claim holds an event: past it, another poll (or worker) may take the event again. */
export const CLAIM_LEASE_MS = 5 * 60_000;
const RETRY_BASE_MS = 30_000;
const RETRY_CAP_MS = 60 * 60_000;

/** Wait before try number `attempts + 1`: 30 s, 1 min, 2 min, 4 min, ... capped at an hour. */
export const retryDelayMs = (attempts: number): number =>
  Math.min(RETRY_BASE_MS * 2 ** Math.max(attempts - 1, 0), RETRY_CAP_MS);

/**
 * Handles up to `limit` dispute events that are due. Returns how many were handled.
 *
 * A failed event is not retried on the next poll: it waits (`retryDelayMs`) and, after MAX_EVENT_ATTEMPTS, is quarantined,
 * so ten events that always fail cannot fill every batch and block newer disputes (#164). A quarantined event stays in
 * `webhook_events` with its last error and shows in `/readyz`; `syncDisputes` still picks its dispute up from PayPal's
 * list, so nothing is dropped silently.
 */
export async function processDisputeEvents(deps: InboxDeps, limit = 10): Promise<number> {
  const log = deps.log ?? ((msg: string) => logger.warn(msg));
  const now = () => deps.now?.() ?? new Date().toISOString();
  let handled = 0;
  for (const event of await deps.db.claimDisputeEvents(limit, now(), CLAIM_LEASE_MS)) {
    try {
      await handleDisputeEvent(event.payload, deps);
      await deps.db.markEventProcessed(event.eventId);
      handled++;
    } catch (err) {
      const error = (err as Error).message;
      if (event.attempts >= MAX_EVENT_ATTEMPTS) {
        await deps.db.failDisputeEvent(event.eventId, { error, quarantine: true }, now());
        log(`dispute event ${event.eventId} quarantined after ${event.attempts} failed attempts: ${error}`);
      } else {
        const retryAt = new Date(Date.parse(now()) + retryDelayMs(event.attempts)).toISOString();
        await deps.db.failDisputeEvent(event.eventId, { error, retryAt }, now());
        log(
          `dispute event ${event.eventId} failed (attempt ${event.attempts}), will retry at ${retryAt}: ${error}`,
        );
      }
    }
  }
  return handled;
}

/**
 * Catch-up for missed webhooks: lists the merchant's recent disputes (Agent Toolkit `list_disputes`) and
 * handles any we don't hold yet or hold an older version of. Returns how many it handled.
 */
export async function syncDisputes(deps: InboxDeps): Promise<number> {
  if (!deps.paypal) return 0;
  const log = deps.log ?? ((msg: string) => logger.warn(msg));
  let handled = 0;
  for (const item of await deps.paypal.listDisputes()) {
    const held = await deps.db.getDispute(item.dispute_id);
    const stale =
      !held ||
      (item.update_time &&
        (!held.paypalUpdatedAt || Date.parse(item.update_time) > Date.parse(held.paypalUpdatedAt)));
    if (!stale) continue;
    try {
      await handleDisputeEvent({ resource: { dispute_id: item.dispute_id } }, deps);
      handled++;
    } catch (err) {
      log(`dispute sync ${item.dispute_id} failed, will retry: ${(err as Error).message}`);
    }
  }
  return handled;
}

export async function handleDisputeEvent(payload: unknown, deps: InboxDeps): Promise<void> {
  const delivered = (payload as { resource?: PayPalDispute } | null)?.resource;
  if (!delivered?.dispute_id) throw new Error("event has no resource.dispute_id");
  // The webhook body can be partial or already outdated; PayPal's current object is the truth (get_dispute).
  // A 404 (mock mode, or PayPal not serving it yet) falls back to what was delivered; anything else retries.
  const d = deps.paypal
    ? await deps.paypal.getDispute(delivered.dispute_id).catch((err: unknown) => {
        if (err instanceof PayPalError && err.status === 404) return delivered;
        throw err;
      })
    : delivered;
  const now = deps.now?.() ?? new Date().toISOString();
  const tx = d.disputed_transactions?.[0];

  // Some updates carry a partial resource; keep the order we matched before.
  const previous = await deps.db.getDispute(d.dispute_id);
  const orderId = tx?.invoice_number ?? previous?.orderId;
  const stored = orderId ? await deps.db.getOrder(orderId) : null;
  const order = stored ? await loadOrder(stored, tx?.custom, deps.db) : null;

  const amount = d.dispute_amount ? fromPayPalAmount(d.dispute_amount) : undefined;
  const buyerNote = tx?.items?.flatMap((item) => (item.notes ? [item.notes] : [])).join("\n");
  const dispute: DisputeRecord = {
    disputeId: d.dispute_id,
    ...(stored ? { orderId: stored.id } : {}),
    ...(d.status ? { status: d.status } : {}),
    ...(d.reason ? { reason: d.reason } : {}),
    ...(buyerNote ? { buyerNote } : {}),
    ...(amount ? { amount } : {}),
    ...(d.seller_response_due_date ? { responseDueDate: d.seller_response_due_date } : {}),
  };

  const mode = deps.aiMode ?? parseAiMode(process.env.AI_MODE);
  const rec = await runDisputeClassifier(dispute, order, { mode });
  const ai = await classifyDispute(
    {
      decision: { class: rec.class, action: rec.action },
      bundle: {
        ...disputeFacts(dispute, order?.intent, order?.cart),
        policy_evaluation: rec.reasons.length ? rec.reasons.join(", ") : rec.class,
        ...(order?.checkoutVerdict ? { checkout_verdict: order.checkoutVerdict.outcome } : {}),
        ...(order?.capturedAt ? { capture_record: "PayPal recorded a capture for this order." } : {}),
      },
    },
    mode,
  ).catch((err: unknown) => {
    if (!isAiUnavailable(err)) throw err;
    return undefined;
  });

  let pkg: EvidencePackageResult | undefined;
  let evidenceError: string | undefined;
  if (rec.class === "MANDATE_COMPLIANT" && order?.signedIntentJws && order.cart && order.captureRecord) {
    const trail = stored ? await deps.db.auditTrail(stored.id) : [];
    // It refuses rather than invents (unknown key, pointer mismatch); the operator sees why, with no package.
    pkg = await draftEvidenceForDefend(
      {
        dispute,
        signedIntentJws: order.signedIntentJws,
        cart: order.cart,
        captureRecord: order.captureRecord,
        keyResolver: async (kid) => {
          const key = await deps.db.findKey("shopper", kid);
          return key ? ((await importJWK(key.publicJwk as unknown as JWK, "ES256")) as CryptoKey) : undefined;
        },
        ledger: order.ledger,
        auditTrail: trail.map((a) => ({ timestamp: a.at, event: a.action, actor: a.actor })),
      },
      { mode, now: () => now },
    ).catch((err: Error) => {
      evidenceError = err.message;
      return undefined;
    });
  }

  const recommendation = {
    ...rec,
    ...(ai ? { ai } : {}),
    constraintChecks:
      order?.intent && order.cart ? buildConstraintChecks(order.intent, order.cart, rec.reasons) : [],
    checkoutVerdict: order?.checkoutVerdict?.outcome ?? null,
    ...(pkg ? { draft: pkg.draft, mandateHash: pkg.mandateHash, customId: pkg.customId } : {}),
    ...(evidenceError ? { evidenceError } : {}),
    analyzedAt: now,
  };

  const saved = await deps.db.saveDispute({
    id: d.dispute_id,
    ...(stored ? { orderId: stored.id } : {}),
    ...(d.reason ? { reason: d.reason } : {}),
    ...(d.status ? { status: d.status } : {}),
    ...(amount ? { amountValue: amount.value, currency: amount.currency } : {}),
    ...(d.seller_response_due_date ? { sellerResponseDueDate: d.seller_response_due_date } : {}),
    ...(d.create_time ? { createdAt: d.create_time } : {}),
    paypal: d,
    ...(d.update_time ? { paypalUpdatedAt: d.update_time } : {}),
    recommendation,
    ...(pkg ? { evidencePdf: pkg.pdf, evidenceBundle: JSON.parse(pkg.bundleJson) } : {}),
  });
  if (!saved) return; // we already hold a newer version of this dispute

  await deps.db.appendAudit({
    actor: "worker:copilot",
    action: "dispute.classified",
    subjectId: d.dispute_id,
    requestBody: {
      orderId: stored?.id ?? null,
      paypalStatus: d.status ?? null,
      class: rec.class,
      action: rec.action,
      reasons: rec.reasons,
      ...(ai ? { j2: { prompt_version: ai.prompt_version, source: ai.source } } : {}),
      ...(pkg ? { evidence: { mandateHash: pkg.mandateHash, customId: pkg.customId } } : {}),
    },
  });
}

/** Rebuilds what checkout knew about an order, from the rows it wrote. */
async function loadOrder(
  order: StoredOrder,
  paypalCustomId: string | undefined,
  db: Db,
): Promise<OrderRecord> {
  const intentRow = await db.getMandate(order.intentMandateHash);
  const cartRow = order.cartMandateHash ? await db.getMandate(order.cartMandateHash) : null;
  const verdict = await db.orderVerdict(order.id);
  const semantic = verdict?.semantic as { fit?: "match" | "partial" | "mismatch" } | undefined;
  // The pointer PayPal holds is what the dispute is about; ours is the fallback if PayPal omitted it.
  const customId = paypalCustomId ?? order.customId;
  return {
    orderId: order.id,
    customId,
    ...(intentRow
      ? { intent: IntentMandate.parse(JSON.parse(intentRow.canonical)), signedIntentJws: intentRow.jws }
      : {}),
    ...(cartRow ? { cart: CartMandate.parse(JSON.parse(cartRow.canonical)) } : {}),
    ...(order.capturedAt ? { capturedAt: order.capturedAt } : {}),
    ...(order.captureId && order.capturedAt
      ? {
          captureRecord: {
            captureId: order.captureId,
            orderId: order.id,
            capturedAt: order.capturedAt,
            amount: { value: order.totalValue, currency: order.currency },
            customId,
          },
        }
      : {}),
    ledger: await db.mandateLedger(order.intentMandateId, order.id),
    ...(verdict
      ? { checkoutVerdict: { outcome: verdict.outcome as Outcome, reasons: verdict.reasons as ReasonCode[] } }
      : {}),
    ...(semantic?.fit ? { j1Outcome: { fit: semantic.fit } } : {}),
  };
}
