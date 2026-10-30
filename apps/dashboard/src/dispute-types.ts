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
