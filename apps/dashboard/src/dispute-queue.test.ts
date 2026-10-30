import { describe, expect, it } from "vitest";
import {
  calculateAge,
  calculateSla,
  fetchDisputes,
  filterDisputes,
  formatMoney,
  sortDisputes,
} from "./api";
import type { DisputeFilters, DisputeItem, DisputeSorting } from "./dispute-types";
import { SEED_DISPUTES } from "./seed-disputes";

describe("dispute queue data & helpers (spec 0007)", () => {
  it("formats integer minor units as currency string", () => {
    expect(formatMoney({ value: 7400, currency: "USD" })).toBe("$74.00");
    expect(formatMoney({ value: 9500, currency: "USD" })).toBe("$95.00");
    expect(formatMoney({ value: 0, currency: "USD" })).toBe("$0.00");
    expect(formatMoney({ value: 50, currency: "USD" })).toBe("$0.50");
    expect(formatMoney({ value: 1250, currency: "EUR" })).toBe("12.50 EUR");
  });

  it("calculates age accurately against a reference time", () => {
    const now = "2026-11-02T12:00:00Z";
    expect(calculateAge("2026-11-02T11:45:00Z", now).text).toBe("15m ago");
    expect(calculateAge("2026-11-02T09:00:00Z", now).text).toBe("3h ago");
    expect(calculateAge("2026-10-31T12:00:00Z", now).text).toBe("2d ago");
  });

  it("calculates SLA urgency where under 48 hours is urgent", () => {
    const now = "2026-11-02T12:00:00Z";

    // 18 hours left (< 48h) -> urgent
    const urgentSla = calculateSla("2026-11-03T06:00:00Z", now);
    expect(urgentSla.isUrgent).toBe(true);
    expect(urgentSla.isExpired).toBe(false);
    expect(urgentSla.hoursRemaining).toBe(18);

    // 72 hours left (> 48h) -> not urgent
    const normalSla = calculateSla("2026-11-05T12:00:00Z", now);
    expect(normalSla.isUrgent).toBe(false);
    expect(normalSla.hoursRemaining).toBe(72);

    // Past deadline -> expired
    const expiredSla = calculateSla("2026-11-01T12:00:00Z", now);
    expect(expiredSla.isExpired).toBe(true);
    expect(expiredSla.text).toBe("Expired");
  });

  it("filters disputes by decision (defend / concede)", () => {
    const defendFilter: DisputeFilters = { decision: "defend", status: "all", search: "" };
    const defendResults = filterDisputes(SEED_DISPUTES, defendFilter);
    expect(defendResults.length).toBeGreaterThan(0);
    expect(defendResults.every((d) => d.decision === "defend")).toBe(true);

    const concedeFilter: DisputeFilters = { decision: "concede", status: "all", search: "" };
    const concedeResults = filterDisputes(SEED_DISPUTES, concedeFilter);
    expect(concedeResults.length).toBeGreaterThan(0);
    expect(concedeResults.every((d) => d.decision === "concede")).toBe(true);
  });

  it("filters disputes by status and search keyword", () => {
    const statusFilter: DisputeFilters = { decision: "all", status: "ACTION_REQUIRED", search: "" };
    const statusResults = filterDisputes(SEED_DISPUTES, statusFilter);
    expect(statusResults.every((d) => d.status === "ACTION_REQUIRED")).toBe(true);

    const searchFilter: DisputeFilters = { decision: "all", status: "all", search: "PP-D-1002" };
    const searchResults = filterDisputes(SEED_DISPUTES, searchFilter);
    expect(searchResults).toHaveLength(1);
    expect(searchResults[0]?.id).toBe("PP-D-1002");
    expect(searchResults[0]?.agentPlatform).toBe("LangChain");

    const platformFilter: DisputeFilters = { decision: "all", status: "all", search: "AutoGPT" };
    const platformResults = filterDisputes(SEED_DISPUTES, platformFilter);
    expect(platformResults.length).toBeGreaterThan(0);
    expect(platformResults.every((d) => d.agentPlatform === "AutoGPT")).toBe(true);
  });

  it("sorts disputes by response due date, amount, and age", () => {
    // Sort by due date ascending (earliest response deadline first)
    const dueDateSort: DisputeSorting = { field: "dueDate", direction: "asc" };
    const byDueDate = sortDisputes(SEED_DISPUTES, dueDateSort);
    for (let i = 0; i < byDueDate.length - 1; i++) {
      const item1 = byDueDate[i];
      const item2 = byDueDate[i + 1];
      expect(item1).toBeDefined();
      expect(item2).toBeDefined();
      const t1 = new Date(item1!.sellerResponseDueDate).getTime();
      const t2 = new Date(item2!.sellerResponseDueDate).getTime();
      expect(t1).toBeLessThanOrEqual(t2);
    }

    // Sort by amount descending (highest disputed amount first)
    const amountDescSort: DisputeSorting = { field: "amount", direction: "desc" };
    const byAmountDesc = sortDisputes(SEED_DISPUTES, amountDescSort);
    const desc0 = byAmountDesc[0];
    const desc1 = byAmountDesc[1];
    expect(desc0).toBeDefined();
    expect(desc1).toBeDefined();
    expect(desc0!.amount.value).toBeGreaterThanOrEqual(desc1!.amount.value);
    expect(desc0!.amount.value).toBe(21000); // PP-D-1011 $210.00

    // Sort by amount ascending
    const amountAscSort: DisputeSorting = { field: "amount", direction: "asc" };
    const byAmountAsc = sortDisputes(SEED_DISPUTES, amountAscSort);
    const asc0 = byAmountAsc[0];
    const asc1 = byAmountAsc[1];
    expect(asc0).toBeDefined();
    expect(asc1).toBeDefined();
    expect(asc0!.amount.value).toBeLessThanOrEqual(asc1!.amount.value);
    expect(asc0!.amount.value).toBe(3900); // PP-D-1015 $39.00
  });

  it("reads disputes from the api via HTTP and falls back on error", async () => {
    const mockApiResponse: DisputeItem[] = [
      {
        id: "PP-D-API-1",
        orderId: "ord_api_1",
        paypalOrderId: "PAYPAL_1",
        status: "ACTION_REQUIRED",
        decision: "defend",
        disputeClass: "MANDATE_COMPLIANT",
        amount: { value: 5000, currency: "USD" },
        createdAt: "2026-11-01T00:00:00Z",
        sellerResponseDueDate: "2026-11-05T00:00:00Z",
        reasons: [],
        agentPlatform: "TestAgent",
        buyerDisputeReason: "TEST",
      },
    ];

    // Mock successful 200 response
    const mockFetchSuccess = (async () => ({
      ok: true,
      status: 200,
      json: async () => mockApiResponse,
    })) as unknown as typeof fetch;

    const data = await fetchDisputes({ apiBaseUrl: "http://example.test", fetchFn: mockFetchSuccess });
    expect(data).toHaveLength(1);
    expect(data[0]?.id).toBe("PP-D-API-1");

    // Mock 501 Not Implemented response -> falls back to seed data
    const mockFetch501 = (async () => ({
      ok: false,
      status: 501,
      json: async () => ({ error: "not_implemented" }),
    })) as unknown as typeof fetch;

    const fallbackData = await fetchDisputes({ apiBaseUrl: "http://example.test", fetchFn: mockFetch501 });
    expect(fallbackData).toEqual(SEED_DISPUTES);

    // Mock network throw -> falls back to seed data
    const mockFetchError = (async () => {
      throw new Error("connection refused");
    }) as unknown as typeof fetch;

    const networkFallbackData = await fetchDisputes({ apiBaseUrl: "http://example.test", fetchFn: mockFetchError });
    expect(networkFallbackData).toEqual(SEED_DISPUTES);
  });

  it("contains 24 canonical seeded disputes with scripted disputes pinned on top per spec 0007", () => {
    expect(SEED_DISPUTES).toHaveLength(24);

    // Pinned 1: Compliant grey jacket order ($74) -> defend
    const pinned1 = SEED_DISPUTES[0];
    expect(pinned1).toBeDefined();
    expect(pinned1!.id).toBe("PP-D-1001");
    expect(pinned1!.decision).toBe("defend");
    expect(pinned1!.disputeClass).toBe("MANDATE_COMPLIANT");
    expect(pinned1!.amount.value).toBe(7400);

    // Pinned 2: Overreach red jacket order ($95) -> concede
    const pinned2 = SEED_DISPUTES[1];
    expect(pinned2).toBeDefined();
    expect(pinned2!.id).toBe("PP-D-1002");
    expect(pinned2!.decision).toBe("concede");
    expect(pinned2!.disputeClass).toBe("AGENT_OVERREACH");
    expect(pinned2!.amount.value).toBe(9500);
    expect(pinned2!.reasons).toContain("AMOUNT_EXCEEDS_MAX");
    expect(pinned2!.reasons).toContain("ATTRIBUTE_MISMATCH");

    // All four platforms represented
    const platforms = new Set(SEED_DISPUTES.map((d) => d.agentPlatform));
    expect(platforms.has("AutoGPT")).toBe(true);
    expect(platforms.has("LangChain")).toBe(true);
    expect(platforms.has("CrewAI")).toBe(true);
    expect(platforms.has("OpenAI Swarm")).toBe(true);
  });
});
