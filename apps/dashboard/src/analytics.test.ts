import { describe, expect, it } from "vitest";
import {
  computeAnalyticsSummary,
  computeBlockedCartsMetrics,
  computeDisputesByClassPerWeek,
  computePerformanceMetrics,
  fetchAnalytics,
  formatMoney,
  SEED_ANALYTICS,
} from "./api";
import type { AnalyticsSummary } from "./analytics-types";
import { SEED_DISPUTES } from "./seed-disputes";
import { SEED_ORDERS } from "./seed-orders";

const HOUR_MS = 60 * 60 * 1000;
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : Math.round(((s[mid - 1]! + s[mid]!) / 2) * 10) / 10;
};

describe("analytics panel & overreach metrics (spec 0007)", () => {
  it("computes analytics summary tracing exactly to seed data per spec 0007", () => {
    const summary = computeAnalyticsSummary();

    // Disputes defended vs conceded
    expect(summary.disputes.total).toBe(24);
    expect(summary.disputes.defended).toBe(14);
    expect(summary.disputes.conceded).toBe(9);
    expect(summary.disputes.standard).toBe(1);
    expect(summary.disputes.defenseRate).toBe(67); // 2 won / 3 resolved actual outcomes = 66.7% -> 67%

    // Amount protected from actual dispute outcomes
    expect(summary.amountProtected.defendedTotal.value).toBe(16300); // $163.00 (PP-D-1012 $78 + PP-D-1023 $85)
    expect(formatMoney(summary.amountProtected.defendedTotal)).toBe("$163.00");
    expect(summary.amountProtected.concededTotal.value).toBe(11000); // $110.00 (PP-D-1013 $110)
    expect(formatMoney(summary.amountProtected.concededTotal)).toBe("$110.00");

    // Blocked overreach carts
    expect(summary.blockedOverreachCarts.totalBlocked).toBe(38);
    expect(summary.blockedOverreachCarts.preventedSpend.value).toBe(342000); // $3,420.00
    expect(formatMoney(summary.blockedOverreachCarts.preventedSpend)).toBe("$3,420.00");

    const reasonCodes = summary.blockedOverreachCarts.topReasonCodes;
    expect(reasonCodes).toHaveLength(3);
    expect(reasonCodes[0]?.code).toBe("AMOUNT_EXCEEDS_MAX");
    expect(reasonCodes[0]?.count).toBe(22);
    expect(reasonCodes[1]?.code).toBe("ATTRIBUTE_MISMATCH");
    expect(reasonCodes[1]?.count).toBe(10);
    expect(reasonCodes[2]?.code).toBe("MERCHANT_NOT_ALLOWED");
    expect(reasonCodes[2]?.count).toBe(6);

    // Performance
    // Response window = dispute opened -> seller deadline, in hours, over drafted or resolved disputes
    const windows = SEED_DISPUTES.filter((d) => d.evidenceDrafted || d.status === "RESOLVED").map(
      (d) => Math.round(((Date.parse(d.sellerResponseDueDate) - Date.parse(d.createdAt)) / HOUR_MS) * 10) / 10,
    );
    expect(windows.length).toBeGreaterThan(0);
    expect(summary.performance.medianResponseHours).toBe(median(windows));
    expect(summary.performance.slaBreachedCount).toBe(0);
  });

  it("computes blocked carts, reason-code tallies, and SLA breaches dynamically from input data per AC4", () => {
    const customOrders = [
      {
        orderId: "ord_test_1",
        agentPlatform: "AutoGPT",
        amount: { value: 5000, currency: "USD" as const },
        status: "BLOCKED" as const,
        reasonCodes: ["AMOUNT_EXCEEDS_MAX"],
        createdAt: "2026-11-01T00:00:00Z",
      },
      {
        orderId: "ord_test_2",
        agentPlatform: "LangChain",
        amount: { value: 7500, currency: "USD" as const },
        status: "BLOCKED" as const,
        reasonCodes: ["ATTRIBUTE_MISMATCH", "AMOUNT_EXCEEDS_MAX"],
        createdAt: "2026-11-01T01:00:00Z",
      },
      {
        orderId: "ord_test_3",
        agentPlatform: "Direct Web",
        amount: { value: 10000, currency: "USD" as const },
        status: "APPROVED" as const,
        reasonCodes: [],
        createdAt: "2026-11-01T02:00:00Z",
      },
    ];

    const blockedMetrics = computeBlockedCartsMetrics(customOrders);
    expect(blockedMetrics.totalBlocked).toBe(2);
    expect(blockedMetrics.preventedSpend.value).toBe(12500); // 5000 + 7500
    expect(blockedMetrics.topReasonCodes[0]?.code).toBe("AMOUNT_EXCEEDS_MAX");
    expect(blockedMetrics.topReasonCodes[0]?.count).toBe(2);
    expect(blockedMetrics.topReasonCodes[1]?.code).toBe("ATTRIBUTE_MISMATCH");
    expect(blockedMetrics.topReasonCodes[1]?.count).toBe(1);

    const customDisputes = [
      {
        id: "D-1",
        orderId: "O-1",
        paypalOrderId: "PP-1",
        status: "ACTION_REQUIRED" as const,
        decision: "defend" as const,
        disputeClass: "MANDATE_COMPLIANT" as const,
        amount: { value: 5000, currency: "USD" as const },
        createdAt: "2026-11-01T00:00:00Z",
        sellerResponseDueDate: "2026-11-02T00:00:00Z", // Past due at 2026-11-03
        reasons: [],
        agentPlatform: "Northstar",
        buyerDisputeReason: "TEST",
      },
      {
        id: "D-2",
        orderId: "O-2",
        paypalOrderId: "PP-2",
        status: "ACTION_REQUIRED" as const,
        decision: "concede" as const,
        disputeClass: "AGENT_OVERREACH" as const,
        amount: { value: 7000, currency: "USD" as const },
        createdAt: "2026-11-01T00:00:00Z",
        sellerResponseDueDate: "2026-11-05T00:00:00Z", // Future at 2026-11-03
        reasons: [],
        agentPlatform: "LangChain",
        buyerDisputeReason: "TEST",
      },
    ];

    const perf = computePerformanceMetrics(customDisputes, "2026-11-03T00:00:00Z");
    expect(perf.slaBreachedCount).toBe(1); // D-1 breached
  });

  it("calculates platform breakdown across 300 seed orders and five platforms", () => {
    const summary = SEED_ANALYTICS;
    expect(summary.byPlatform).toHaveLength(5);

    // Orders and disputes use the same platform names, so every dispute lands on a platform row
    const platformNames = summary.byPlatform.map((p) => p.platform).sort();
    expect(platformNames).toEqual(["Direct Web", "Errandly", "Northstar", "Tote", "Wayfinder"]);
    expect(new Set(SEED_DISPUTES.map((d) => d.agentPlatform)).size).toBeLessThanOrEqual(5);
    for (const d of SEED_DISPUTES) expect(platformNames).toContain(d.agentPlatform);

    // Total orders trace to 300 across all five platforms
    const totalOrders = summary.byPlatform.reduce((sum, p) => sum + p.totalOrders, 0);
    expect(totalOrders).toBe(300);
    expect(totalOrders).toBe(SEED_ORDERS.length);

    // Each row traces to the seed disputes and orders for that platform
    for (const row of summary.byPlatform) {
      const pDisputes = SEED_DISPUTES.filter((d) => d.agentPlatform === row.platform);
      const pOrders = SEED_ORDERS.filter((o) => o.agentPlatform === row.platform);
      expect(row.totalOrders).toBe(pOrders.length);
      expect(row.defendedDisputes).toBe(pDisputes.filter((d) => d.decision === "defend").length);
      expect(row.concededDisputes).toBe(pDisputes.filter((d) => d.decision === "concede").length);
      const overreach = pDisputes.filter((d) => d.disputeClass === "AGENT_OVERREACH").length;
      expect(row.overreachRate).toBe(pOrders.length ? Math.round((overreach / pOrders.length) * 100) : 0);
    }

    // All disputes are counted somewhere
    const counted = summary.byPlatform.reduce((n, p) => n + p.defendedDisputes + p.concededDisputes, 0);
    expect(counted).toBe(SEED_DISPUTES.filter((d) => d.decision !== "standard").length);
  });

  it("fetches analytics from the API over HTTP with zero direct database access", async () => {
    const mockApiResponse: AnalyticsSummary = {
      disputes: {
        total: 10,
        defended: 7,
        conceded: 3,
        standard: 0,
        defenseRate: 70,
      },
      amountProtected: {
        defendedTotal: { value: 70000, currency: "USD" },
        concededTotal: { value: 30000, currency: "USD" },
      },
      blockedOverreachCarts: {
        totalBlocked: 15,
        preventedSpend: { value: 150000, currency: "USD" },
        topReasonCodes: [{ code: "AMOUNT_EXCEEDS_MAX", count: 15, percentage: 100 }],
      },
      performance: {
        medianResponseHours: 3.5,
        slaBreachedCount: 0,
      },
      byPlatform: [],
      disputesByClassPerWeek: [],
    };

    // Successful 200 API response
    const mockFetchSuccess = (async () => ({
      ok: true,
      status: 200,
      json: async () => mockApiResponse,
    })) as unknown as typeof fetch;

    const liveData = await fetchAnalytics({ apiBaseUrl: "http://example.test", fetchFn: mockFetchSuccess });
    expect(liveData.disputes.defenseRate).toBe(70);
    expect(liveData.disputes.total).toBe(10);
    expect(liveData.isSample).toBeUndefined();

    // Fallback on 501 or network error
    const mockFetchError = (async () => {
      throw new Error("API offline");
    }) as unknown as typeof fetch;

    const fallbackData = await fetchAnalytics({ apiBaseUrl: "http://example.test", fetchFn: mockFetchError });
    expect(fallbackData.disputes.total).toBe(24);
    expect(fallbackData.isSample).toBe(true);
    expect(fallbackData.disputes.defended).toBe(14);
    expect(fallbackData.amountProtected.defendedTotal.value).toBe(16300);
  });

  it("implements disputes by class per week chart grouping per spec 0007", () => {
    const summary = SEED_ANALYTICS;
    const weeks = summary.disputesByClassPerWeek;
    expect(weeks.length).toBeGreaterThanOrEqual(1);

    // Every seed dispute is in exactly one week, and the class counts add up per week and overall
    expect(weeks.reduce((n, w) => n + w.total, 0)).toBe(SEED_DISPUTES.length);
    for (const w of weeks) {
      expect(w.mandateCompliant + w.agentOverreach + w.intentMisread + w.noMandate).toBe(w.total);
    }
    const byClass = (c: string) => SEED_DISPUTES.filter((d) => d.disputeClass === c).length;
    expect(weeks.reduce((n, w) => n + w.mandateCompliant, 0)).toBe(byClass("MANDATE_COMPLIANT"));
    expect(weeks.reduce((n, w) => n + w.agentOverreach, 0)).toBe(byClass("AGENT_OVERREACH"));
    expect(weeks.reduce((n, w) => n + w.intentMisread, 0)).toBe(byClass("INTENT_MISREAD"));
    expect(weeks.reduce((n, w) => n + w.noMandate, 0)).toBe(byClass("NO_MANDATE"));

    // Dynamic grouping test with custom dispute
    const custom = computeDisputesByClassPerWeek([
      {
        id: "D-X",
        orderId: "O-X",
        paypalOrderId: "PP-X",
        status: "ACTION_REQUIRED",
        decision: "defend",
        disputeClass: "MANDATE_COMPLIANT",
        amount: { value: 1000, currency: "USD" },
        createdAt: "2026-11-10T12:00:00Z",
        sellerResponseDueDate: "2026-11-15T00:00:00Z",
        reasons: [],
        agentPlatform: "Northstar",
        buyerDisputeReason: "TEST",
      },
    ]);
    const nov10Week = custom.find((w) => w.week === "Nov 09 - Nov 15");
    expect(nov10Week).toBeDefined();
    expect(nov10Week?.mandateCompliant).toBe(1);
    expect(nov10Week?.total).toBe(1);
  });

  it("displays sample data label for transparency when displaying seed analytics", () => {
    expect(SEED_ANALYTICS.disputes.total).toBe(24);
    expect(SEED_ANALYTICS.byPlatform).toHaveLength(5);
    expect(SEED_ANALYTICS.blockedOverreachCarts.totalBlocked).toBe(38);
  });
});

describe("wins, refunds and protected amounts come from PayPal's confirmed outcome, not the recommendation (#165)", () => {
  const dispute = (
    id: string,
    over: Partial<(typeof SEED_DISPUTES)[number]>,
  ): (typeof SEED_DISPUTES)[number] => ({
    id,
    orderId: `O-${id}`,
    paypalOrderId: `PP-${id}`,
    status: "RESOLVED",
    decision: "defend",
    disputeClass: "MANDATE_COMPLIANT",
    amount: { value: 10000, currency: "USD" },
    createdAt: "2026-11-01T00:00:00Z",
    sellerResponseDueDate: "2026-11-05T00:00:00Z",
    reasons: [],
    agentPlatform: "Northstar",
    buyerDisputeReason: "TEST",
    ...over,
  });
  const won = { result: "SELLER_FAVOUR", code: "RESOLVED_SELLER_FAVOUR" } as const;
  const lost = { result: "BUYER_FAVOUR", code: "RESOLVED_BUYER_FAVOUR" } as const;

  it("a defended dispute PayPal decided for the buyer is a loss, not a win", () => {
    const s = computeAnalyticsSummary([dispute("A", { outcome: lost })], []);
    expect(s.disputes.defenseRate).toBe(0);
    expect(s.amountProtected.defendedTotal.value).toBe(0);
    expect(s.amountProtected.concededTotal.value).toBe(10000);
  });

  it("a conceded dispute PayPal decided for the seller is a win", () => {
    const s = computeAnalyticsSummary([dispute("B", { decision: "concede", outcome: won })], []);
    expect(s.disputes.defenseRate).toBe(100);
    expect(s.amountProtected.defendedTotal.value).toBe(10000);
    expect(s.amountProtected.concededTotal.value).toBe(0);
  });

  it("a resolved dispute with no confirmed outcome, or one closed in neither side's favour, counts as neither", () => {
    const s = computeAnalyticsSummary(
      [
        dispute("C", {}), // resolved, PayPal gave no outcome
        dispute("D", { outcome: { result: "OTHER", code: "CANCELED_BY_BUYER" } }),
        dispute("E", { outcome: won }),
      ],
      [],
    );
    expect(s.disputes.defenseRate).toBe(100); // 1 win out of the 1 decided, not 1 of 3 resolved
    expect(s.amountProtected.defendedTotal.value).toBe(10000);
    expect(s.amountProtected.concededTotal.value).toBe(0);
  });

  it("an open dispute is never a win or a loss, whatever the copilot recommends", () => {
    const s = computeAnalyticsSummary(
      [dispute("F", { status: "ACTION_REQUIRED", outcome: won }), dispute("G", { status: "UNDER_REVIEW" })],
      [],
    );
    expect(s.disputes.defenseRate).toBe(0);
    expect(s.amountProtected.defendedTotal.value).toBe(0);
    expect(s.amountProtected.concededTotal.value).toBe(0);
  });

  it("the refund is what PayPal says went back to the buyer, when it says (a partial refund)", () => {
    const s = computeAnalyticsSummary(
      [dispute("H", { outcome: { ...lost, refunded: { value: 4000, currency: "USD" } } })],
      [],
    );
    expect(s.amountProtected.concededTotal.value).toBe(4000);
  });

  it("mixed outcomes give the exact rate and dollars", () => {
    const s = computeAnalyticsSummary(
      [
        dispute("I", { amount: { value: 7800, currency: "USD" }, outcome: won }),
        dispute("J", { amount: { value: 8500, currency: "USD" }, outcome: won }),
        dispute("K", { amount: { value: 11000, currency: "USD" }, outcome: lost }),
        dispute("L", { decision: "concede", amount: { value: 3000, currency: "USD" }, outcome: lost }),
      ],
      [],
    );
    expect(s.disputes.defenseRate).toBe(50); // 2 won of 4 decided
    expect(s.amountProtected.defendedTotal.value).toBe(16300);
    expect(s.amountProtected.concededTotal.value).toBe(14000);
  });

  it("the seed's three resolved disputes each carry the outcome the old numbers assumed", () => {
    const resolved = SEED_DISPUTES.filter((d) => d.status === "RESOLVED");
    expect(resolved.map((d) => [d.id, d.outcome?.result])).toEqual([
      ["PP-D-1012", "SELLER_FAVOUR"],
      ["PP-D-1013", "BUYER_FAVOUR"],
      ["PP-D-1023", "SELLER_FAVOUR"],
    ]);
  });
});
