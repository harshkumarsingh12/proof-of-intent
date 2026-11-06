import { APPROVE_AT, isAiUnavailable, parseAiMode, semanticFit, type AiMode } from "@poi/ai";
import {
  DisputeClass,
  type CartMandate,
  type IntentMandate,
  type Money,
  type ReasonCode,
  type Verdict,
} from "@poi/contracts";
import { mandateHash } from "@poi/mandates";
import { evaluate, type MandateLedger } from "@poi/policy-engine";

export interface DisputeRecord {
  disputeId: string;
  orderId?: string;
  status?: string;
  reason?: string;
  buyerNote?: string;
  amount?: Money;
  responseDueDate?: string;
}

export interface CaptureRecord {
  captureId: string;
  orderId: string;
  capturedAt: string;
  amount: Money;
  customId: string;
}

export interface OrderRecord {
  orderId: string;
  customId?: string;
  intent?: IntentMandate;
  cart?: CartMandate;
  /** The Intent Mandate JWS exactly as verified at checkout. */
  signedIntentJws?: string;
  captureRecord?: CaptureRecord;
  capturedAt?: string;
  /** Prior captures under this mandate, excluding this order: what checkout saw. */
  ledger?: MandateLedger;
  checkoutVerdict?: Verdict;
  j1Outcome?: {
    fit?: "match" | "partial" | "mismatch";
    reasons?: ReasonCode[];
  };
}

export interface DisputeDataLoader {
  loadDispute(disputeId: string): Promise<DisputeRecord | null>;
  loadOrder(orderId: string): Promise<OrderRecord | null>;
}

export interface Recommendation {
  disputeId: string;
  class: DisputeClass;
  action: "PROVIDE_EVIDENCE" | "ACCEPT_CLAIM" | "MAKE_OFFER" | "STANDARD_EVIDENCE";
  reasons: ReasonCode[];
}

/** Only product facts are needed for the AI jobs. Keep JWS, keys, hashes and addresses out. */
export function disputeFacts(dispute: DisputeRecord, intent?: IntentMandate, cart?: CartMandate): Record<string, string> {
  return {
    ...(dispute.reason ? { dispute_reason: dispute.reason } : {}),
    ...(dispute.buyerNote ? { buyer_note: dispute.buyerNote } : {}),
    ...(intent ? { intent_mandate: intent.natural_language_description } : {}),
    ...(cart ? {
      cart_mandate: cart.contents.lines.map((line) => `${line.quantity} × ${line.title}`).join(", "),
    } : {}),
  };
}

export function parseCustomId(rawCustomId?: string): { mandateId: string; hashPrefix: string } | null {
  if (!rawCustomId || !rawCustomId.startsWith("poi:")) return null;
  const parts = rawCustomId.split(":");
  if (parts.length !== 3) return null;
  const [, mandateId, hashPrefix] = parts;
  if (!mandateId || !hashPrefix || hashPrefix.length !== 16) return null;
  return { mandateId, hashPrefix };
}

export class InMemoryDisputeDataLoader implements DisputeDataLoader {
  private readonly disputes = new Map<string, DisputeRecord>();
  private readonly orders = new Map<string, OrderRecord>();

  constructor(disputes: DisputeRecord[] = [], orders: OrderRecord[] = []) {
    for (const d of disputes) this.disputes.set(d.disputeId, d);
    for (const o of orders) this.orders.set(o.orderId, o);
  }

  async loadDispute(disputeId: string): Promise<DisputeRecord | null> {
    return this.disputes.get(disputeId) ?? null;
  }

  async loadOrder(orderId: string): Promise<OrderRecord | null> {
    return this.orders.get(orderId) ?? null;
  }
}

/**
 * The deterministic tree from docs/specs/0005. The class never comes from a model: J2 only writes
 * the explanation and evidence plan, so a dispute verdict can't contradict the checkout verdict.
 */
export async function runDisputeClassifier(
  dispute: DisputeRecord,
  order: OrderRecord | null,
  options: { now?: string; mode?: AiMode; ledger?: MandateLedger } = {},
): Promise<Recommendation> {
  const result = (cls: DisputeClass, action: Recommendation["action"], reasons: ReasonCode[] = []) => ({
    disputeId: dispute.disputeId,
    class: cls,
    action,
    reasons,
  });

  // 1. No mandate on the order: standard PayPal path.
  const pointer = parseCustomId(order?.customId);
  if (!order || !pointer || !order.intent || !order.cart) return result("NO_MANDATE", "STANDARD_EVIDENCE");

  // 2. The pointer on PayPal doesn't match our stored mandate. That's our record being inconsistent,
  //    not the agent overreaching, so we can't defend with it: standard path, flagged.
  const expectedHash = mandateHash(order.intent);
  if (order.intent.mandate_id !== pointer.mandateId || pointer.hashPrefix !== expectedHash.slice(0, 16)) {
    return result("NO_MANDATE", "STANDARD_EVIDENCE", ["MANDATE_MISMATCH"]);
  }

  // 3. Replay hard rules at capture time, never at the wall clock.
  const now = options.now ?? order.capturedAt;
  if (!now)
    throw new Error(`Order ${order.orderId} has a mandate but no capture time to replay the rules at`);
  const ledger = options.ledger ?? order.ledger;
  const evalResult = evaluate({ intent: order.intent, cart: order.cart, now, ledger });
  if (!evalResult.pass) return result("AGENT_OVERREACH", "ACCEPT_CLAIM", evalResult.reasons);

  // 4. Semantic fit. A STEP_UP order only exists because the shopper approved this exact cart
  //    (docs/specs/0003), so the semantic doubt was resolved by the shopper: defend.
  if (order.checkoutVerdict?.outcome === "STEP_UP") return result("MANDATE_COMPLIANT", "PROVIDE_EVIDENCE");

  const storedMisread =
    (order.j1Outcome?.fit !== undefined && order.j1Outcome.fit !== "match") ||
    order.j1Outcome?.reasons?.includes("SEMANTIC_MISMATCH") ||
    order.checkoutVerdict?.reasons?.some((r) => r === "SEMANTIC_MISMATCH" || r === "SEMANTIC_UNCERTAIN");
  if (storedMisread) return result("INTENT_MISREAD", "ACCEPT_CLAIM", ["SEMANTIC_MISMATCH"]);

  if (!order.j1Outcome) {
    try {
      const mode = options.mode ?? parseAiMode(process.env.AI_MODE);
      const j1 = await semanticFit(order.intent.natural_language_description, order.cart, mode);
      if (j1.fit !== "match" || j1.confidence < APPROVE_AT) {
        return result("INTENT_MISREAD", "ACCEPT_CLAIM", ["SEMANTIC_MISMATCH"]);
      }
    } catch (err) {
      if (!isAiUnavailable(err)) throw err;
      // No J1 answer (no recording, model down): the hard rules passed, so fall through to compliant and
      // let the operator, who reviews every dispute, judge the wording.
    }
  }

  return result("MANDATE_COMPLIANT", "PROVIDE_EVIDENCE");
}
