/**
 * The worker's inbox (docs/specs/0005): verified CUSTOMER.DISPUTE.* deliveries in webhook_events that have
 * no processed_at yet. For each one: match the dispute to our order, replay the checkout rules through the
 * deterministic tree, build the evidence package when the order was compliant, and store it all on the
 * dispute row for the operator. Nothing here calls PayPal: dispute actions only follow an operator click (API).
 *
 * Handling an event twice gives the same dispute row, so a crash between saving and marking the event
 * processed just repeats the work once on restart.
 */
import type { AiMode } from "@poi/ai";
import { CartMandate, IntentMandate, type Outcome, type ReasonCode } from "@poi/contracts";
import type { Db, StoredOrder } from "@poi/db";
import { fromPayPalAmount } from "@poi/paypal";
import { importJWK, type JWK } from "jose";
import { runDisputeClassifier, type DisputeRecord, type OrderRecord } from "./classifier";
import { buildConstraintChecks, draftEvidenceForDefend, type EvidencePackageResult } from "./evidence";

/** The parts of a PayPal dispute object we read. */
export interface PayPalDispute {
  dispute_id: string;
  create_time?: string;
  update_time?: string;
  status?: string;
  reason?: string;
  dispute_amount?: { currency_code: string; value: string };
  seller_response_due_date?: string;
  disputed_transactions?: {
    seller_transaction_id?: string;
    /** Our order id: we send it to PayPal as invoice_id. */
    invoice_number?: string;
    /** The mandate pointer PayPal holds for the order (our custom_id). */
    custom?: string;
    items?: { notes?: string }[];
  }[];
}

export interface InboxDeps {
  db: Db;
  aiMode?: AiMode;
  now?: () => string;
  log?: (msg: string) => void;
}

/** Handles up to `limit` pending dispute events. Returns how many were handled. */
export async function processDisputeEvents(deps: InboxDeps, limit = 10): Promise<number> {
  const log = deps.log ?? console.log;
  let handled = 0;
  for (const event of await deps.db.pendingDisputeEvents(limit)) {
    try {
      await handleDisputeEvent(event.payload, deps);
      await deps.db.markEventProcessed(event.eventId);
      handled++;
    } catch (err) {
      // Left in the inbox and retried on the next poll: a dispute must never be dropped silently.
      log(`dispute event ${event.eventId} failed, will retry: ${(err as Error).message}`);
    }
  }
  return handled;
}

export async function handleDisputeEvent(payload: unknown, deps: InboxDeps): Promise<void> {
  const d = (payload as { resource?: PayPalDispute } | null)?.resource;
  if (!d?.dispute_id) throw new Error("event has no resource.dispute_id");
  const now = deps.now?.() ?? new Date().toISOString();
  const tx = d.disputed_transactions?.[0];

  // Some updates carry a partial resource; keep the order we matched before.
  const previous = await deps.db.getDispute(d.dispute_id);
  const orderId = tx?.invoice_number ?? previous?.orderId;
  const stored = orderId ? await deps.db.getOrder(orderId) : null;
  const order = stored ? await loadOrder(stored, tx?.custom, deps.db) : null;

  const amount = d.dispute_amount ? fromPayPalAmount(d.dispute_amount) : undefined;
  const dispute: DisputeRecord = {
    disputeId: d.dispute_id,
    ...(stored ? { orderId: stored.id } : {}),
    ...(d.status ? { status: d.status } : {}),
    ...(d.reason ? { reason: d.reason } : {}),
    ...(amount ? { amount } : {}),
    ...(d.seller_response_due_date ? { responseDueDate: d.seller_response_due_date } : {}),
  };

  const rec = await runDisputeClassifier(dispute, order, { mode: deps.aiMode });

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
      { mode: deps.aiMode, now: () => now },
    ).catch((err: Error) => {
      evidenceError = err.message;
      return undefined;
    });
  }

  const recommendation = {
    ...rec,
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
