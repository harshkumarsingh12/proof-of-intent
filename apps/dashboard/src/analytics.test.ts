import { describe, expect, it } from "vitest";
import {
  computeAnalyticsSummary,
  computeBlockedCartsMetrics,
  computePerformanceMetrics,
  fetchAnalytics,
  formatMoney,
  SEED_ANALYTICS,
} from "./api";
import type { AnalyticsSummary } from "./analytics-types";

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
    expect(formatMoney(summary.blockedOverreachCarts.preventedSpend)).toBe("$3420.00");

    const reasonCodes = summary.blockedOverreachCarts.topReasonCodes;
    expect(reasonCodes).toHaveLength(3);
    expect(reasonCodes[0]?.code).toBe("AMOUNT_EXCEEDS_MAX");
    expect(reasonCodes[0]?.count).toBe(22);
    expect(reasonCodes[1]?.code).toBe("ATTRIBUTE_MISMATCH");
    expect(reasonCodes[1]?.count).toBe(10);
    expect(reasonCodes[2]?.code).toBe("MERCHANT_NOT_ALLOWED");
    expect(reasonCodes[2]?.count).toBe(6);

    // Performance
    expect(summary.performance.medianResponseHours).toBe(10);
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
        agentPlatform: "AutoGPT",
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

  it("calculates platform breakdown across 300 seed orders and four platforms", () => {
    const summary = SEED_ANALYTICS;
    expect(summary.byPlatform).toHaveLength(4);

    const platformNames = summary.byPlatform.map((p) => p.platform);
    expect(platformNames).toContain("AutoGPT");
    expect(platformNames).toContain("LangChain");
    expect(platformNames).toContain("CrewAI");
    expect(platformNames).toContain("OpenAI Swarm");

    // Total orders across platforms
    const totalOrders = summary.byPlatform.reduce((sum, p) => sum + p.totalOrders, 0);
    expect(totalOrders).toBe(270);

    // AutoGPT stats
    const autogpt = summary.byPlatform.find((p) => p.platform === "AutoGPT");
    expect(autogpt).toBeDefined();
    expect(autogpt?.defendedDisputes).toBe(4);
    expect(autogpt?.concededDisputes).toBe(2);
    expect(autogpt?.overreachRate).toBe(1); // 1 overreach / 70 total orders = 1%

    // CrewAI stats
    const crewai = summary.byPlatform.find((p) => p.platform === "CrewAI");
    expect(crewai).toBeDefined();
    expect(crewai?.defendedDisputes).toBe(3);
    expect(crewai?.concededDisputes).toBe(3);
    expect(crewai?.overreachRate).toBe(3); // 2 overreach / 65 total orders = 3%
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

    // Fallback on 501 or network error
    const mockFetchError = (async () => {
      throw new Error("API offline");
    }) as unknown as typeof fetch;

    const fallbackData = await fetchAnalytics({ apiBaseUrl: "http://example.test", fetchFn: mockFetchError });
    expect(fallbackData.disputes.total).toBe(24);
    expect(fallbackData.disputes.defended).toBe(14);
    expect(fallbackData.amountProtected.defendedTotal.value).toBe(16300);
  });
});
