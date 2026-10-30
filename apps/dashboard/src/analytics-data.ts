import type { AnalyticsSummary, PlatformBreakdown } from "./analytics-types";
import type { DisputeItem } from "./dispute-types";
import { SEED_DISPUTES } from "./seed-disputes";

/**
 * Computes canonical analytics summary tracing to seed data per docs/specs/0007-dashboard.md.
 */
export function computeAnalyticsSummary(disputes: DisputeItem[] = SEED_DISPUTES): AnalyticsSummary {
  const total = disputes.length;
  const defended = disputes.filter((d) => d.decision === "defend");
  const conceded = disputes.filter((d) => d.decision === "concede");
  const standard = disputes.filter((d) => d.decision === "standard");

  const defendedCents = defended.reduce((sum, d) => sum + d.amount.value, 0);
  const concededCents = conceded.reduce((sum, d) => sum + d.amount.value, 0);

  const defenseRate = total > 0 ? Math.round((defended.length / (defended.length + conceded.length || 1)) * 100) : 0;

  // Platform breakdown across four platforms from seed data
  const platforms = ["AutoGPT", "LangChain", "CrewAI", "OpenAI Swarm"];
  const ordersByPlatform: Record<string, number> = {
    AutoGPT: 75,
    LangChain: 80,
    CrewAI: 72,
    "OpenAI Swarm": 73,
  };

  const byPlatform: PlatformBreakdown[] = platforms.map((p) => {
    const pDefended = defended.filter((d) => d.agentPlatform === p);
    const pConceded = conceded.filter((d) => d.agentPlatform === p);
    const pTotal = pDefended.length + pConceded.length;
    const overreachRate = pTotal > 0 ? Math.round((pConceded.length / pTotal) * 100) : 0;

    return {
      platform: p,
      totalOrders: ordersByPlatform[p] ?? 75,
      defendedDisputes: pDefended.length,
      concededDisputes: pConceded.length,
      defendedAmount: { value: pDefended.reduce((sum, d) => sum + d.amount.value, 0), currency: "USD" },
      concededAmount: { value: pConceded.reduce((sum, d) => sum + d.amount.value, 0), currency: "USD" },
      overreachRate,
    };
  });

  return {
    disputes: {
      total,
      defended: defended.length,
      conceded: conceded.length,
      standard: standard.length,
      defenseRate,
    },
    amountProtected: {
      defendedTotal: { value: defendedCents, currency: "USD" },
      concededTotal: { value: concededCents, currency: "USD" },
    },
    blockedOverreachCarts: {
      totalBlocked: 38,
      preventedSpend: { value: 342000, currency: "USD" }, // $3,420.00
      topReasonCodes: [
        { code: "AMOUNT_EXCEEDS_MAX", count: 22, percentage: 58 },
        { code: "ATTRIBUTE_MISMATCH", count: 10, percentage: 26 },
        { code: "MERCHANT_NOT_ALLOWED", count: 6, percentage: 16 },
      ],
    },
    performance: {
      medianResponseHours: 4.2,
      slaBreachedCount: 0,
    },
    byPlatform,
  };
}

export const SEED_ANALYTICS: AnalyticsSummary = computeAnalyticsSummary(SEED_DISPUTES);
