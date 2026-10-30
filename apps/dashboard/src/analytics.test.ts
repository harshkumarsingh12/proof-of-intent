import { describe, expect, it } from "vitest";
import { computeAnalyticsSummary, fetchAnalytics, formatMoney, SEED_ANALYTICS } from "./api";
import type { AnalyticsSummary } from "./analytics-types";

describe("analytics panel & overreach metrics (spec 0007)", () => {
  it("computes analytics summary tracing exactly to seed data per spec 0007", () => {
    const summary = computeAnalyticsSummary();

    // Disputes defended vs conceded
    expect(summary.disputes.total).toBe(24);
    expect(summary.disputes.defended).toBe(14);
    expect(summary.disputes.conceded).toBe(9);
    expect(summary.disputes.standard).toBe(1);
    expect(summary.disputes.defenseRate).toBe(61); // 14 / (14 + 9) ≈ 60.8% -> 61%

    // Amount protected
    expect(summary.amountProtected.defendedTotal.value).toBe(104100); // $1,041.00
    expect(formatMoney(summary.amountProtected.defendedTotal)).toBe("$1041.00");
    expect(summary.amountProtected.concededTotal.value).toBe(118600); // $1,186.00
    expect(formatMoney(summary.amountProtected.concededTotal)).toBe("$1186.00");

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
    expect(summary.performance.medianResponseHours).toBe(4.2);
    expect(summary.performance.slaBreachedCount).toBe(0);
  });

  it("calculates platform breakdown across 300 seed orders and four platforms", () => {
    const summary = SEED_ANALYTICS;
    expect(summary.byPlatform).toHaveLength(4);

    const platformNames = summary.byPlatform.map((p) => p.platform);
    expect(platformNames).toContain("AutoGPT");
    expect(platformNames).toContain("LangChain");
    expect(platformNames).toContain("CrewAI");
    expect(platformNames).toContain("OpenAI Swarm");

    // Total orders trace to 300
    const totalOrders = summary.byPlatform.reduce((sum, p) => sum + p.totalOrders, 0);
    expect(totalOrders).toBe(300);

    // AutoGPT stats
    const autogpt = summary.byPlatform.find((p) => p.platform === "AutoGPT");
    expect(autogpt).toBeDefined();
    expect(autogpt?.defendedDisputes).toBe(4);
    expect(autogpt?.concededDisputes).toBe(2);
    expect(autogpt?.overreachRate).toBe(33);

    // CrewAI stats
    const crewai = summary.byPlatform.find((p) => p.platform === "CrewAI");
    expect(crewai).toBeDefined();
    expect(crewai?.defendedDisputes).toBe(3);
    expect(crewai?.concededDisputes).toBe(3);
    expect(crewai?.overreachRate).toBe(50);
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
    expect(fallbackData.amountProtected.defendedTotal.value).toBe(104100);
  });
});
