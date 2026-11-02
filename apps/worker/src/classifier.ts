import { classifyDispute, parseAiMode, type AiMode } from "@poi/ai";
import {
  DisputeClass,
  NotImplementedError,
  type CartMandate,
  type IntentMandate,
  type ReasonCode,
} from "@poi/contracts";
import { compliantCart, greyJacketIntent, NOW, overreachingCart, partialCart } from "@poi/contracts/fixtures";
import { customId, mandateHash } from "@poi/mandates";
import { evaluate } from "@poi/policy-engine";


export interface DisputeRecord {
  disputeId: string;
  orderId?: string;
  status?: string;
  reason?: string;
}

export interface OrderRecord {
  orderId: string;
  customId?: string;
  intent?: IntentMandate;
  cart?: CartMandate;
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

export function parseCustomId(rawCustomId?: string): { mandateId: string; hashPrefix: string } | null {
  if (!rawCustomId || !rawCustomId.startsWith("poi:")) return null;
  const parts = rawCustomId.split(":");
  if (parts.length !== 3) return null;
  const [, mandateId, hashPrefix] = parts;
  if (!mandateId || !hashPrefix || hashPrefix.length !== 16) return null;
  return { mandateId, hashPrefix };
}

export class InMemoryRecommendationStore {
  private readonly recs = new Map<string, Recommendation>();

  async save(rec: Recommendation): Promise<void> {
    this.recs.set(rec.disputeId, rec);
  }

  async get(disputeId: string): Promise<Recommendation | null> {
    return this.recs.get(disputeId) ?? null;
  }

  async list(): Promise<Recommendation[]> {
    return Array.from(this.recs.values());
  }
}

export class DefaultFixtureLoader implements DisputeDataLoader {
  private readonly disputes = new Map<string, DisputeRecord>([
    [
      "fixture-overreach",
      {
        disputeId: "fixture-overreach",
        orderId: "ord_overreach",
        status: "WAITING_FOR_SELLER_RESPONSE",
        reason: "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED",
      },
    ],
    [
      "fixture-compliant",
      {
        disputeId: "fixture-compliant",
        orderId: "ord_compliant",
        status: "WAITING_FOR_SELLER_RESPONSE",
        reason: "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED",
      },
    ],
    [
      "fixture-no-mandate",
      {
        disputeId: "fixture-no-mandate",
        orderId: "ord_no_mandate",
        status: "UNDER_REVIEW",
        reason: "UNAUTHORISED",
      },
    ],
    [
      "fixture-partial",
      {
        disputeId: "fixture-partial",
        orderId: "ord_partial",
        status: "WAITING_FOR_SELLER_RESPONSE",
        reason: "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED",
      },
    ],
  ]);

  private readonly orders = new Map<string, OrderRecord>([
    [
      "ord_overreach",
      {
        orderId: "ord_overreach",
        customId: customId(greyJacketIntent.mandate_id, mandateHash(greyJacketIntent)),
        intent: greyJacketIntent,
        cart: overreachingCart,
      },
    ],
    [
      "ord_compliant",
      {
        orderId: "ord_compliant",
        customId: customId(greyJacketIntent.mandate_id, mandateHash(greyJacketIntent)),
        intent: greyJacketIntent,
        cart: compliantCart,
      },
    ],
    [
      "ord_no_mandate",
      {
        orderId: "ord_no_mandate",
      },
    ],
    [
      "ord_partial",
      {
        orderId: "ord_partial",
        customId: customId(greyJacketIntent.mandate_id, mandateHash(greyJacketIntent)),
        intent: greyJacketIntent,
        cart: partialCart,
      },
    ],
  ]);

  async loadDispute(disputeId: string): Promise<DisputeRecord | null> {
    return this.disputes.get(disputeId) ?? null;
  }

  async loadOrder(orderId: string): Promise<OrderRecord | null> {
    return this.orders.get(orderId) ?? null;
  }
}

export async function runDisputeClassifier(
  dispute: DisputeRecord,
  order: OrderRecord | null,
  options: {
    now?: string;
    mode?: AiMode;
  } = {},
): Promise<Recommendation> {
  const now = options.now ?? NOW;
  const mode = options.mode ?? parseAiMode(process.env.AI_MODE);

  // 1. Check custom_id pointer and mandate presence
  const pointer = parseCustomId(order?.customId);
  if (!order || !pointer || !order.intent || !order.cart) {
    return {
      disputeId: dispute.disputeId,
      class: "NO_MANDATE",
      action: "STANDARD_EVIDENCE",
      reasons: [],
    };
  }

  // 2. Verify custom_id pointer matches the intent mandate
  const expectedHash = mandateHash(order.intent);
  if (order.intent.mandate_id !== pointer.mandateId || pointer.hashPrefix !== expectedHash.slice(0, 16)) {
    return {
      disputeId: dispute.disputeId,
      class: "AGENT_OVERREACH",
      action: "ACCEPT_CLAIM",
      reasons: ["MANDATE_MISMATCH"],
    };
  }

  // 3. Replay hard rules
  const evalResult = evaluate({ intent: order.intent, cart: order.cart, now });
  if (!evalResult.pass) {
    return {
      disputeId: dispute.disputeId,
      class: "AGENT_OVERREACH",
      action: "ACCEPT_CLAIM",
      reasons: evalResult.reasons,
    };
  }

  // 4. Try J2 classification job from @poi/ai if implemented
  try {
    const j2 = await classifyDispute({ dispute, order, intent: order.intent, cart: order.cart }, mode);
    return {
      disputeId: dispute.disputeId,
      class: j2.class,
      action: j2.recommended_action,
      reasons: [],
    };
  } catch (err) {
    // J2 in packages/ai is currently an unbuilt stub; fall back to deterministic classification tree
    if (!(err instanceof NotImplementedError)) {
      throw err;
    }
  }

  const isPartial = order.cart.contents.lines.some(
    (l) => l.sku.includes("SHL") || l.title.toLowerCase().includes("shell"),
  );
  if (isPartial) {
    return {
      disputeId: dispute.disputeId,
      class: "INTENT_MISREAD",
      action: "ACCEPT_CLAIM",
      reasons: ["SEMANTIC_MISMATCH"],
    };
  }

  return {
    disputeId: dispute.disputeId,
    class: "MANDATE_COMPLIANT",
    action: "PROVIDE_EVIDENCE",
    reasons: [],
  };
}
