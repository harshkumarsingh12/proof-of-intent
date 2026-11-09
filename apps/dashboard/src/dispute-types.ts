import type { DisputeClass, Money, ReasonCode } from "@poi/contracts";

export type DisputeDecision = "defend" | "concede" | "standard";

export type DisputeStatus =
  | "ACTION_REQUIRED"
  | "UNDER_REVIEW"
  | "WAITING_FOR_BUYER_RESPONSE"
  | "WAITING_FOR_SELLER_RESPONSE"
  | "RESOLVED";

/**
 * How PayPal actually closed a dispute (its `dispute_outcome`), read from the dispute object the worker stores. The copilot's
 * `decision` is only a recommendation: a defended dispute can still be lost, and a conceded one is not a win. Wins, refunds
 * and protected amounts come from this and nothing else (#165). `OTHER` is any closure that is neither side's favour
 * (the buyer withdrew, PayPal paid out under protection, ...): it counts as neither a win nor a loss.
 */
export type DisputeResult = "SELLER_FAVOUR" | "BUYER_FAVOUR" | "OTHER";

export interface DisputeOutcome {
  result: DisputeResult;
  /** PayPal's own code, for example RESOLVED_SELLER_FAVOUR. */
  code: string;
  /** What PayPal says was refunded to the buyer, when it says. */
  refunded?: Money;
}

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
  reasons: ReasonCode[];
  agentPlatform: string;
  buyerDisputeReason: string;
  shopperNotes?: string;
  evidenceDrafted?: boolean;
  /** Present only once PayPal has resolved the dispute and said how. Absent means not confirmed. */
  outcome?: DisputeOutcome;
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
  /** Optional model self-estimate, uncalibrated; null when the model supplied no valid score. */
  confidence: number | null;
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

export type MandateComplianceBadge = "COMPLIANT" | "NON_COMPLIANT" | "NO_MANDATE" | "MISREAD";
export type DeliveryEvidenceBadge = "CONFIRMED" | "NOT_AVAILABLE" | "NOT_REQUIRED" | string;
export type ResponseReadinessBadge = "READY" | "INCOMPLETE";

export interface DisputeDetail extends DisputeItem {
  isDemoData?: boolean;
  mandateCompliance?: MandateComplianceBadge;
  deliveryEvidence?: DeliveryEvidenceBadge;
  responseReadiness?: ResponseReadinessBadge;
  requiredEvidence?: string[];
  missingEvidence?: string[];
  shopperIntentText?: string;
  mandateId?: string;
  mandateNonce?: string;
  mandateIssuer?: string;
  mandateCreatedAt?: string;
  mandateExpiry?: string;
  checkoutVerdict?: "APPROVE" | "REJECT" | "STEP_UP" | "NONE" | string;
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
}
