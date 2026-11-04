import type { DisputeClass, ReasonCode, Verdict } from "@poi/contracts";
import type { Db } from "@poi/db";

export type DisputeDecision = "defend" | "concede" | "standard";

export interface DecisionInput {
  disputeId: string;
  classification: {
    class: DisputeClass;
    reasons?: ReasonCode[];
    action?: "PROVIDE_EVIDENCE" | "ACCEPT_CLAIM" | "MAKE_OFFER" | "STANDARD_EVIDENCE";
  };
  checkoutVerdict?: Verdict | null;
  order?: {
    orderId?: string;
    hasMandate?: boolean;
    customId?: string;
  } | null;
}

export interface DisputeDecisionResult {
  disputeId: string;
  decision: DisputeDecision;
  class: DisputeClass;
  action: "PROVIDE_EVIDENCE" | "ACCEPT_CLAIM" | "MAKE_OFFER" | "STANDARD_EVIDENCE";
  reasons: ReasonCode[];
  isBlocked: boolean;
  explanation: string;
}

export class InMemoryDecisionStore {
  private readonly decisions = new Map<string, DisputeDecisionResult>();

  async save(result: DisputeDecisionResult): Promise<void> {
    this.decisions.set(result.disputeId, result);
  }

  async get(disputeId: string): Promise<DisputeDecisionResult | null> {
    return this.decisions.get(disputeId) ?? null;
  }

  async list(): Promise<DisputeDecisionResult[]> {
    return Array.from(this.decisions.values());
  }
}

export function decideDispute(input: DecisionInput): DisputeDecisionResult {
  const { disputeId, classification, checkoutVerdict, order } = input;

  // Orders without a mandate must fall through to the standard dispute path, never blocked.
  if (classification.class === "NO_MANDATE" || order?.hasMandate === false) {

    return {
      disputeId,
      decision: "standard",
      class: "NO_MANDATE",
      action: "STANDARD_EVIDENCE",
      reasons: classification.reasons ?? [],
      isBlocked: false,
      explanation: "No signed mandate attached to order; routing to standard PayPal dispute path.",
    };
  }

  // Agent overreached constraints: concede and attach reasons from checkout and replay.
  if (classification.class === "AGENT_OVERREACH" || checkoutVerdict?.outcome === "REJECT") {
    const combinedReasons = Array.from(
      new Set([...(checkoutVerdict?.reasons ?? []), ...(classification.reasons ?? [])]),
    );

    return {
      disputeId,
      decision: "concede",
      class: "AGENT_OVERREACH",
      action: "ACCEPT_CLAIM",
      reasons: combinedReasons,
      isBlocked: false,
      explanation: "Agent purchase violated signed shopper constraints; recommending fair concession.",
    };
  }

  // Intent misread (semantic mismatch between shopper request and purchased items): concede.
  if (classification.class === "INTENT_MISREAD") {
    const combinedReasons = Array.from(
      new Set([...(classification.reasons ?? []), "SEMANTIC_MISMATCH" as ReasonCode]),
    );

    return {
      disputeId,
      decision: "concede",
      class: "INTENT_MISREAD",
      action: "ACCEPT_CLAIM",
      reasons: combinedReasons,
      isBlocked: false,
      explanation: "Purchased items failed semantic fit check against shopper intent; recommending concession.",
    };
  }

  // Compliant order: defend using the signed intent mandate attestation package.
  return {
    disputeId,
    decision: "defend",
    class: "MANDATE_COMPLIANT",
    action: "PROVIDE_EVIDENCE",
    reasons: classification.reasons ?? [],
    isBlocked: false,
    explanation: "Cart was verified compliant with signed intent; recommending defense with attestation package.",
  };
}

export interface DecisionOptions {
  store?: InMemoryDecisionStore;
  db?: Pick<Db, "appendAudit">;
}

export async function recordDisputeDecision(
  input: DecisionInput,
  options?: DecisionOptions,
): Promise<DisputeDecisionResult> {
  const result = decideDispute(input);

  if (options?.store) {
    await options.store.save(result);
  }

  if (options?.db) {
    await options.db.appendAudit({
      actor: "worker:copilot",
      action: "dispute.decision",
      subjectId: input.disputeId,
      requestBody: {
        decision: result.decision,
        class: result.class,
        action: result.action,
        reasons: result.reasons,
        isBlocked: result.isBlocked,
      },
    });
  }

  return result;
}
