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
}
