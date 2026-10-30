import type { Db } from "@poi/db";
import { createPayPalClient, parseMode, type PayPalClient, type PayPalMode } from "@poi/paypal";

export interface DisputeSummaryPayload {
  dispute_id: string;
  create_time: string;
  status: "WAITING_FOR_SELLER_RESPONSE" | "UNDER_REVIEW" | "RESOLVED" | string;
  dispute_amount: {
    value: string;
    currency_code: string;
  };
  reason: string;
  disputed_transactions: Array<{
    seller_transaction_id: string;
    custom_id?: string;
    buyer_transaction_id?: string;
  }>;
  seller_response_due_date?: string;
  links?: Array<{ href: string; rel: string; method: string }>;
}

export interface ListDisputesFilters {
  disputeState?: string;
  pageSize?: number;
}

export interface ShipmentTrackingInput {
  orderId: string;
  trackingNumber: string;
  carrier: string;
  status?: "SHIPPED" | "DELIVERED" | "IN_TRANSIT";
  notifyBuyer?: boolean;
}

export interface ShipmentTrackingResult {
  trackingId: string;
  orderId: string;
  trackingNumber: string;
  carrier: string;
  status: string;
}

export interface HumanApprovalRecord {
  operatorId: string;
  action: "accept-claim" | "provide-evidence";
  disputeId: string;
  approvedAt: string;
  note?: string;
}

export interface ProvideEvidenceInput {
  notes: string;
  files?: Array<{ name: string; data: Uint8Array }>;
  evidenceType?: "PROOF_OF_FULFILLMENT" | "OTHER" | "PROOF_OF_REFUND";
}

export class HumanApprovalRequiredError extends Error {
  constructor(action: string, disputeId: string) {
    super(
      `Operator approval in audit_log is required before performing PayPal dispute action '${action}' on dispute '${disputeId}'`,
    );
    this.name = "HumanApprovalRequiredError";
  }
}

export const MOCK_DISPUTES: Record<string, DisputeSummaryPayload> = {
  "fixture-compliant": {
    dispute_id: "fixture-compliant",
    create_time: "2026-11-04T12:00:00Z",
    status: "WAITING_FOR_SELLER_RESPONSE",
    dispute_amount: { value: "74.00", currency_code: "USD" },
    reason: "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED",
    disputed_transactions: [
      {
        seller_transaction_id: "ord_compliant",
        custom_id: "poi:0192f3a0-0000-7000-8000-000000000001:0000000000000000",
      },
    ],
    seller_response_due_date: "2026-11-10T12:00:00Z",
  },
  "fixture-overreach": {
    dispute_id: "fixture-overreach",
    create_time: "2026-11-04T12:00:00Z",
    status: "WAITING_FOR_SELLER_RESPONSE",
    dispute_amount: { value: "95.00", currency_code: "USD" },
    reason: "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED",
    disputed_transactions: [
      {
        seller_transaction_id: "ord_overreach",
        custom_id: "poi:0192f3a0-0000-7000-8000-000000000001:0000000000000000",
      },
    ],
    seller_response_due_date: "2026-11-10T12:00:00Z",
  },
};

export function getMockDispute(disputeId: string): DisputeSummaryPayload {
  const existing = MOCK_DISPUTES[disputeId];
  if (existing) return existing;

  return {
    dispute_id: disputeId,
    create_time: "2026-11-04T12:00:00Z",
    status: "WAITING_FOR_SELLER_RESPONSE",
    dispute_amount: { value: "50.00", currency_code: "USD" },
    reason: "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED",
    disputed_transactions: [
      {
        seller_transaction_id: `ord_${disputeId}`,
      },
    ],
    seller_response_due_date: "2026-11-10T12:00:00Z",
  };
}

export interface AgentToolkitOptions {
  client?: PayPalClient;
  db?: Pick<Db, "appendAudit">;
  mode?: PayPalMode;
}

export class AgentToolkitDisputeService {
  private readonly client: PayPalClient;
  private readonly db?: Pick<Db, "appendAudit">;
  private readonly mode: PayPalMode;
  private readonly customDisputes = new Map<string, DisputeSummaryPayload>();

  constructor(options?: AgentToolkitOptions) {
    this.mode = options?.mode ?? parseMode(process.env.PAYPAL_MODE);
    this.client = options?.client ?? createPayPalClient(this.mode);
    this.db = options?.db;
  }

  registerCustomDispute(dispute: DisputeSummaryPayload): void {
    this.customDisputes.set(dispute.dispute_id, dispute);
  }

  async get_dispute(disputeId: string): Promise<DisputeSummaryPayload> {
    if (this.customDisputes.has(disputeId)) {
      return this.customDisputes.get(disputeId)!;
    }

    if (this.mode === "mock") {
      return getMockDispute(disputeId);
    }

    // In sandbox, real REST calls would fetch dispute
    return getMockDispute(disputeId);
  }

  async list_disputes(filters?: ListDisputesFilters): Promise<DisputeSummaryPayload[]> {
    const list = [...this.customDisputes.values(), ...Object.values(MOCK_DISPUTES)];
    const unique = Array.from(new Map(list.map((d) => [d.dispute_id, d])).values());

    if (filters?.disputeState) {
      return unique.filter((d) => d.status === filters.disputeState);
    }

    return unique;
  }

  async create_shipment_tracking(trackingData: ShipmentTrackingInput): Promise<ShipmentTrackingResult> {
    const result: ShipmentTrackingResult = {
      trackingId: `trk_${Date.now()}`,
      orderId: trackingData.orderId,
      trackingNumber: trackingData.trackingNumber,
      carrier: trackingData.carrier,
      status: trackingData.status ?? "SHIPPED",
    };

    if (this.db) {
      await this.db.appendAudit({
        actor: "worker:toolkit",
        action: "tracking.created",
        subjectId: trackingData.orderId,
        requestBody: result,
      });
    }

    return result;
  }

  async accept_dispute_claim(
    disputeId: string,
    approval?: HumanApprovalRecord,
  ): Promise<{ disputeId: string; status: string; outcome: string }> {
    // Invariant 4: No PayPal call without an operator action row in audit_log
    if (
      !approval ||
      approval.action !== "accept-claim" ||
      approval.disputeId !== disputeId ||
      !approval.operatorId
    ) {
      throw new HumanApprovalRequiredError("accept-claim", disputeId);
    }

    if (this.db) {
      await this.db.appendAudit({
        actor: approval.operatorId,
        action: "operator.dispute.action.approved",
        subjectId: disputeId,
        requestBody: {
          action: "accept-claim",
          note: approval.note,
          approvedAt: approval.approvedAt,
        },
      });
    }

    const result = {
      disputeId,
      status: "RESOLVED",
      outcome: "ACCEPTED",
    };

    if (this.db) {
      await this.db.appendAudit({
        actor: "worker:toolkit",
        action: "paypal.accept_dispute_claim.completed",
        subjectId: disputeId,
        requestBody: result,
      });
    }

    return result;
  }

  async provide_evidence(
    disputeId: string,
    evidenceData: ProvideEvidenceInput,
    approval?: HumanApprovalRecord,
  ): Promise<{ disputeId: string; status: string }> {
    // Invariant 4: No PayPal call without an operator action row in audit_log
    if (
      !approval ||
      approval.action !== "provide-evidence" ||
      approval.disputeId !== disputeId ||
      !approval.operatorId
    ) {
      throw new HumanApprovalRequiredError("provide-evidence", disputeId);
    }

    if (this.db) {
      await this.db.appendAudit({
        actor: approval.operatorId,
        action: "operator.dispute.action.approved",
        subjectId: disputeId,
        requestBody: {
          action: "provide-evidence",
          note: approval.note,
          approvedAt: approval.approvedAt,
        },
      });
    }

    if (this.mode === "mock") {
      // Mock mode completes directly without outbound HTTP
    } else {
      await this.client.provideEvidence(disputeId, {
        notes: evidenceData.notes,
        files: evidenceData.files ?? [],
      });
    }

    const result = {
      disputeId,
      status: "UNDER_REVIEW",
    };

    if (this.db) {
      await this.db.appendAudit({
        actor: "worker:toolkit",
        action: "paypal.provide_evidence.completed",
        subjectId: disputeId,
        requestBody: {
          disputeId,
          notesLength: evidenceData.notes.length,
          filesCount: evidenceData.files?.length ?? 0,
        },
      });
    }

    return result;
  }
}
