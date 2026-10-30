import type { DisputeClass, Money, ReasonCode } from "@poi/contracts";

export type DisputeDecision = "defend" | "concede" | "standard";

export type DisputeStatus =
  | "ACTION_REQUIRED"
  | "UNDER_REVIEW"
  | "WAITING_FOR_BUYER_RESPONSE"
  | "WAITING_FOR_SELLER_RESPONSE"
  | "RESOLVED";

export interface DisputeItem {
  id: string;
  orderId: string;
  paypalOrderId: string;
  status: DisputeStatus;
  decision: DisputeDecision;
  disputeClass: DisputeClass;
  amount: Money;
  createdAt: string;
  sellerResponseDueDate: string;
  reasons: ReasonCode[] | string[];
  agentPlatform: string;
  buyerDisputeReason: string;
  shopperNotes?: string;
  evidenceDrafted?: boolean;
}

export type DecisionFilter = "all" | DisputeDecision;

export interface DisputeFilters {
  decision: DecisionFilter;
  status: "all" | DisputeStatus | string;
  search: string;
}

export type SortField = "dueDate" | "age" | "amount";
export type SortDirection = "asc" | "desc";

export interface DisputeSorting {
  field: SortField;
  direction: SortDirection;
}

export interface ConstraintCheck {
  id: string;
  name: string;
  mandateRule: string;
  cartActual: string;
  status: "PASS" | "FAIL";
  reasonCode?: ReasonCode | string;
  explanation: string;
}

export interface DisputeClassificationInfo {
  disputeClass: DisputeClass;
  confidence: number;
  recommendedAction: "PROVIDE_EVIDENCE" | "ACCEPT_CLAIM" | "MAKE_OFFER" | "STANDARD_EVIDENCE";
  reasons: Array<{ text: string; cites: string[] }>;
  evidencePlan: string[];
}

export interface EvidenceDraftInfo {
  coverNote: string;
  attestationSections: Array<{ heading: string; body: string }>;
  buyerMessage: string;
  attestationHash: string;
  customId: string;
  pdfFilename: string;
  generatedAt: string;
}

export type OperatorActionType =
  | "SUBMIT_EVIDENCE"
  | "ACCEPT_CLAIM"
  | "REJECT_RECOMMENDATION"
  | "DISPUTE_RECEIVED"
  | "CLASSIFICATION_COMPLETED";

export interface AuditLogEntry {
  id: string;
  disputeId: string;
  who: string;
  what: OperatorActionType | string;
  when: string;
  notes: string;
  metadata?: {
    actionUrl?: string;
    previousStatus?: DisputeStatus;
    newStatus?: DisputeStatus;
    refundAmount?: Money;
    attestationHash?: string;
    overrideDecision?: "defend" | "concede";
    agentPlatform?: string;
  };
}

export interface DisputeDetail extends DisputeItem {
  shopperIntentText: string;
  mandateId: string;
  mandateNonce: string;
  mandateIssuer: string;
  mandateCreatedAt: string;
  mandateExpiry: string;
  cartLines: Array<{
    sku: string;
    title: string;
    color?: string;
    category?: string;
    unitPrice: Money;
    quantity: number;
  }>;
  cartTotal: Money;
  cartMerchantName: string;
  constraints: {
    amountMax: Money;
    merchantAllowlist: string[];
    attributes: Record<string, string>;
    quantityMax: { perLine: number; perOrder: number };
  };
  constraintChecks: ConstraintCheck[];
  classificationInfo: DisputeClassificationInfo;
  evidenceDraftInfo?: EvidenceDraftInfo;
  auditLog: AuditLogEntry[];
}
