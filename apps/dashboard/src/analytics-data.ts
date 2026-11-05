import type { AnalyticsSummary, PlatformBreakdown, WeeklyDisputesByClass } from "./analytics-types";
import type { DisputeItem } from "./dispute-types";
import { SEED_DISPUTES } from "./seed-disputes";
import { SEED_ORDERS, type SeedOrder } from "./seed-orders";

/**
 * Computes metrics for checkout carts blocked by the policy engine.
 * Traces directly to seed orders data per AC4.
 */
export function computeBlockedCartsMetrics(orders: SeedOrder[] = SEED_ORDERS) {
  const blocked = orders.filter((o) => o.status === "BLOCKED");
  const totalBlocked = blocked.length;
  const preventedSpendValue = blocked.reduce((sum, o) => sum + o.amount.value, 0);

  const reasonCounts: Record<string, number> = {};
  for (const o of blocked) {
    for (const r of o.reasonCodes) {
      reasonCounts[r] = (reasonCounts[r] ?? 0) + 1;
    }
  }

  const totalReasons = Object.values(reasonCounts).reduce((a, b) => a + b, 0) || 1;
  const topReasonCodes = Object.entries(reasonCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([code, count]) => ({
      code,
      count,
      percentage: Math.round((count / totalReasons) * 100),
    }));

  return {
    totalBlocked,
    preventedSpend: { value: preventedSpendValue, currency: "USD" as const },
    topReasonCodes,
  };
}

/**
 * Computes dispute turnaround efficiency and SLA breach count.
 * Evaluates active dispute response deadlines per AC4.
 */
export function computePerformanceMetrics(
  disputes: DisputeItem[] = SEED_DISPUTES,
  referenceTimeInput?: string | Date
) {
  // Use creation of latest dispute as reference baseline if not provided
  const refTime = referenceTimeInput
    ? new Date(referenceTimeInput).getTime()
    : Math.max(...disputes.map((d) => new Date(d.createdAt).getTime()));

  // Count active disputes that missed their seller response due date
  const slaBreachedCount = disputes.filter((d) => {
    if (d.status === "RESOLVED") return false;
    const due = new Date(d.sellerResponseDueDate).getTime();
    return due < refTime;
  }).length;

  // Response window in hours (dispute opened -> seller deadline) for resolved or evidence-drafted disputes.
  // The seed data has no response timestamp, so this is the window, not the time actually taken.
  const responseHoursList: number[] = [];
  for (const d of disputes) {
    if (d.evidenceDrafted || d.status === "RESOLVED") {
      const created = new Date(d.createdAt).getTime();
      const due = new Date(d.sellerResponseDueDate).getTime();
      const hours = Math.round(((due - created) / (1000 * 60 * 60)) * 10) / 10;
      if (hours > 0) {
        responseHoursList.push(hours);
      }
    }
  }

  responseHoursList.sort((a, b) => a - b);
  let medianResponseHours = 0;
  if (responseHoursList.length > 0) {
    const mid = Math.floor(responseHoursList.length / 2);
    medianResponseHours =
      responseHoursList.length % 2 !== 0
        ? responseHoursList[mid]!
        : Math.round(((responseHoursList[mid - 1]! + responseHoursList[mid]!) / 2) * 10) / 10;
  }

  return {
    medianResponseHours,
    slaBreachedCount,
  };
}

/**
 * Computes weekly distribution of disputes by classification per docs/specs/0007-dashboard.md.
 */
export function computeDisputesByClassPerWeek(
  disputes: DisputeItem[] = SEED_DISPUTES
): WeeklyDisputesByClass[] {
  const weeks = new Map<number, WeeklyDisputesByClass>();
  const fmt = (x: Date) => x.toLocaleDateString("en-US", { month: "short", day: "2-digit", timeZone: "UTC" });

  for (const d of disputes) {
    // Monday 00:00 UTC of the dispute's week
    const monday = new Date(d.createdAt);
    monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
    monday.setUTCHours(0, 0, 0, 0);
    const key = monday.getTime();

    let item = weeks.get(key);
    if (!item) {
      const sunday = new Date(key);
      sunday.setUTCDate(sunday.getUTCDate() + 6);
      item = {
        week: `${fmt(monday)} - ${fmt(sunday)}`,
        mandateCompliant: 0,
        agentOverreach: 0,
        intentMisread: 0,
        noMandate: 0,
        total: 0,
      };
      weeks.set(key, item);
    }
    item.total++;
    if (d.disputeClass === "MANDATE_COMPLIANT") item.mandateCompliant++;
    else if (d.disputeClass === "AGENT_OVERREACH") item.agentOverreach++;
    else if (d.disputeClass === "INTENT_MISREAD") item.intentMisread++;
    else if (d.disputeClass === "NO_MANDATE") item.noMandate++;
  }

  return [...weeks.entries()].sort((a, b) => a[0] - b[0]).map(([, w]) => w);
}

/**
 * Computes canonical analytics summary tracing to seed data per docs/specs/0007-dashboard.md.
 */
export function computeAnalyticsSummary(
  disputes: DisputeItem[] = SEED_DISPUTES,
  orders: SeedOrder[] = SEED_ORDERS
): AnalyticsSummary {
  const total = disputes.length;
  const defended = disputes.filter((d) => d.decision === "defend");
  const conceded = disputes.filter((d) => d.decision === "concede");
  const standard = disputes.filter((d) => d.decision === "standard");

  // Actual dispute outcomes from resolved disputes (excluding unresolved/active disputes)
  const resolved = disputes.filter((d) => d.status === "RESOLVED");
  const resolvedWins = resolved.filter((d) => d.decision === "defend");
  const resolvedLosses = resolved.filter((d) => d.decision === "concede");

  const defenseRate = resolved.length > 0
    ? Math.round((resolvedWins.length / resolved.length) * 100)
    : 0;

  const actualProtectedCents = resolvedWins.reduce((sum, d) => sum + d.amount.value, 0);
  const actualConcededCents = resolvedLosses.reduce((sum, d) => sum + d.amount.value, 0);

  // Platform breakdown: every platform that appears in the orders or the disputes, busiest first
  const ordersByPlatform: Record<string, number> = {};
  for (const o of orders) {
    ordersByPlatform[o.agentPlatform] = (ordersByPlatform[o.agentPlatform] ?? 0) + 1;
  }
  const platforms = [...new Set([...orders.map((o) => o.agentPlatform), ...disputes.map((d) => d.agentPlatform)])].sort(
    (a, b) => (ordersByPlatform[b] ?? 0) - (ordersByPlatform[a] ?? 0) || a.localeCompare(b),
  );

  const byPlatform: PlatformBreakdown[] = platforms.map((p) => {
    const pDisputes = disputes.filter((d) => d.agentPlatform === p);
    const pDefended = pDisputes.filter((d) => d.decision === "defend");
    const pConceded = pDisputes.filter((d) => d.decision === "concede");
    // Overreach count strictly excludes INTENT_MISREAD
    const pOverreach = pDisputes.filter((d) => d.disputeClass === "AGENT_OVERREACH");
    const totalOrders = ordersByPlatform[p] ?? 0;
    // Overreach rate = overreach count divided by total orders
    const overreachRate = totalOrders > 0 ? Math.round((pOverreach.length / totalOrders) * 100) : 0;

    return {
      platform: p,
      totalOrders,
      defendedDisputes: pDefended.length,
      concededDisputes: pConceded.length,
      defendedAmount: { value: pDefended.reduce((sum, d) => sum + d.amount.value, 0), currency: "USD" },
      concededAmount: { value: pConceded.reduce((sum, d) => sum + d.amount.value, 0), currency: "USD" },
      overreachRate,
    };
  });

  const blockedOverreachCarts = computeBlockedCartsMetrics(orders);
  const performance = computePerformanceMetrics(disputes);
  const disputesByClassPerWeek = computeDisputesByClassPerWeek(disputes);

  return {
    disputes: {
      total,
      defended: defended.length,
      conceded: conceded.length,
      standard: standard.length,
      defenseRate,
    },
    amountProtected: {
      defendedTotal: { value: actualProtectedCents, currency: "USD" },
      concededTotal: { value: actualConcededCents, currency: "USD" },
    },
    blockedOverreachCarts,
    performance,
    byPlatform,
    disputesByClassPerWeek,
  };
}

export const SEED_ANALYTICS: AnalyticsSummary = computeAnalyticsSummary(SEED_DISPUTES);
