import type { Money } from "@poi/contracts";

export interface PlatformBreakdown {
  platform: string;
  totalOrders: number;
  defendedDisputes: number;
  concededDisputes: number;
  defendedAmount: Money;
  concededAmount: Money;
  overreachRate: number; // percentage e.g. 33
}

export interface WeeklyDisputesByClass {
  week: string; // e.g. "Oct 26 - Nov 01"
  mandateCompliant: number;
  agentOverreach: number;
  intentMisread: number;
  noMandate: number;
  total: number;
}

export interface AnalyticsSummary {
  disputes: {
    total: number;
    defended: number;
    conceded: number;
    standard: number;
    defenseRate: number; // percentage e.g. 61
  };
  amountProtected: {
    defendedTotal: Money;
    concededTotal: Money;
  };
  blockedOverreachCarts: {
    totalBlocked: number;
    preventedSpend: Money;
    topReasonCodes: Array<{ code: string; count: number; percentage: number }>;
  };
  performance: {
    medianResponseHours: number;
    slaBreachedCount: number;
  };
  byPlatform: PlatformBreakdown[];
  disputesByClassPerWeek: WeeklyDisputesByClass[];
  /** Set when the API was unreachable and these numbers are the built-in demo set. */
  isSample?: boolean;
}
