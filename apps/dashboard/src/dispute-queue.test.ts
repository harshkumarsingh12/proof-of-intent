import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  aggregateCurrencyTotals,
  calculateAge,
  calculateSla,
  fetchDisputes,
  fetchDisputesDetailed,
  filterDisputes,
  formatCurrencyTotals,
  formatMoney,
  isPartialList,
  MAX_DISPUTES_PER_REQUEST,
  sortDisputes,
} from "./api";
import type { DisputeFilters, DisputeItem, DisputeSorting } from "./dispute-types";
import { generateSeedDisputes, SEED_DISPUTES } from "./seed-disputes";

describe("dispute queue data & helpers (spec 0007)", () => {
  it("formats integer minor units as currency string", () => {
    expect(formatMoney({ value: 7400, currency: "USD" })).toBe("$74.00");
    expect(formatMoney({ value: 9500, currency: "USD" })).toBe("$95.00");
    expect(formatMoney({ value: 0, currency: "USD" })).toBe("$0.00");
    expect(formatMoney({ value: 50, currency: "USD" })).toBe("$0.50");
    expect(formatMoney({ value: 1250, currency: "EUR" })).toBe("12.50 EUR");
  });

  it("aggregates dispute amounts per currency without summing mixed currencies into USD", () => {
    expect(formatCurrencyTotals([])).toBe("$0.00");
    expect(aggregateCurrencyTotals([])).toEqual({});

    const usdOnly = [
      { amount: { value: 7400, currency: "USD" } },
      { amount: { value: 2600, currency: "USD" } },
    ];
    expect(aggregateCurrencyTotals(usdOnly)).toEqual({ USD: 10000 });
    expect(formatCurrencyTotals(usdOnly)).toBe("$100.00");

    const mixed = [
      { amount: { value: 5000, currency: "USD" } },
      { amount: { value: 4500, currency: "EUR" } },
      { amount: { value: 2500, currency: "USD" } },
      { amount: { value: 3000, currency: "GBP" } },
    ];
    expect(aggregateCurrencyTotals(mixed)).toEqual({
      USD: 7500,
      EUR: 4500,
      GBP: 3000,
    });
    expect(formatCurrencyTotals(mixed)).toBe("$75.00 + 45.00 EUR + 30.00 GBP");
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
    expect(searchResults[0]?.agentPlatform).toBe("Wayfinder");

    const platformFilter: DisputeFilters = { decision: "all", status: "all", search: "Northstar" };
    const platformResults = filterDisputes(SEED_DISPUTES, platformFilter);
    expect(platformResults.length).toBeGreaterThan(0);
    expect(platformResults.every((d) => d.agentPlatform === "Northstar")).toBe(true);
  });

  it("sorts disputes while keeping the two scripted demo disputes pinned at the top", () => {
    // Sort by due date ascending (earliest response deadline first)
    const dueDateSort: DisputeSorting = { field: "dueDate", direction: "asc" };
    const byDueDate = sortDisputes(SEED_DISPUTES, dueDateSort);
    expect(byDueDate[0]?.id).toBe("PP-D-1001");
    expect(byDueDate[1]?.id).toBe("PP-D-1002");

    const nonPinnedByDueDate = byDueDate.slice(2);
    for (let i = 0; i < nonPinnedByDueDate.length - 1; i++) {
      const item1 = nonPinnedByDueDate[i];
      const item2 = nonPinnedByDueDate[i + 1];
      expect(item1).toBeDefined();
      expect(item2).toBeDefined();
      const t1 = new Date(item1!.sellerResponseDueDate).getTime();
      const t2 = new Date(item2!.sellerResponseDueDate).getTime();
      expect(t1).toBeLessThanOrEqual(t2);
    }

    // Sort by amount descending (highest disputed amount first)
    const amountDescSort: DisputeSorting = { field: "amount", direction: "desc" };
    const byAmountDesc = sortDisputes(SEED_DISPUTES, amountDescSort);
    expect(byAmountDesc[0]?.id).toBe("PP-D-1001");
    expect(byAmountDesc[1]?.id).toBe("PP-D-1002");

    const nonPinnedByAmountDesc = byAmountDesc.slice(2);
    expect(nonPinnedByAmountDesc[0]?.amount.value).toBe(21000); // PP-D-1011 $210.00
    for (let i = 0; i < nonPinnedByAmountDesc.length - 1; i++) {
      expect(nonPinnedByAmountDesc[i]!.amount.value).toBeGreaterThanOrEqual(
        nonPinnedByAmountDesc[i + 1]!.amount.value,
      );
    }

    // Sort by amount ascending
    const amountAscSort: DisputeSorting = { field: "amount", direction: "asc" };
    const byAmountAsc = sortDisputes(SEED_DISPUTES, amountAscSort);
    expect(byAmountAsc[0]?.id).toBe("PP-D-1001");
    expect(byAmountAsc[1]?.id).toBe("PP-D-1002");

    const nonPinnedByAmountAsc = byAmountAsc.slice(2);
    expect(nonPinnedByAmountAsc[0]?.amount.value).toBe(3900); // PP-D-1015 $39.00
    for (let i = 0; i < nonPinnedByAmountAsc.length - 1; i++) {
      expect(nonPinnedByAmountAsc[i]!.amount.value).toBeLessThanOrEqual(
        nonPinnedByAmountAsc[i + 1]!.amount.value,
      );
    }
  });

  it("generates seed due dates relative to current date or provided base time", () => {
    const fixedBase = "2026-12-01T12:00:00Z";
    const generated = generateSeedDisputes(fixedBase);
    expect(generated).toHaveLength(24);

    const baseMs = new Date(fixedBase).getTime();
    const d1 = generated.find((d) => d.id === "PP-D-1001");
    expect(d1).toBeDefined();
    // Due 48h after base
    const d1DueMs = new Date(d1!.sellerResponseDueDate).getTime();
    expect(d1DueMs - baseMs).toBe(48 * 60 * 60 * 1000);

    const urgentDispute = generated.find((d) => d.id === "PP-D-1006");
    expect(urgentDispute).toBeDefined();
    // Due 22h after base
    const urgentDueMs = new Date(urgentDispute!.sellerResponseDueDate).getTime();
    expect(urgentDueMs - baseMs).toBe(22 * 60 * 60 * 1000);
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

    const detailedSuccess = await fetchDisputesDetailed({
      apiBaseUrl: "http://example.test",
      fetchFn: mockFetchSuccess,
    });
    expect(detailedSuccess.isFallback).toBe(false);
    expect(detailedSuccess.disputes).toHaveLength(1);

    // Mock 501 Not Implemented response -> falls back to seed data
    const mockFetch501 = (async () => ({
      ok: false,
      status: 501,
      json: async () => ({ error: "not_implemented" }),
    })) as unknown as typeof fetch;

    const fallbackData = await fetchDisputes({ apiBaseUrl: "http://example.test", fetchFn: mockFetch501 });
    expect(fallbackData.map((d) => d.id)).toEqual(SEED_DISPUTES.map((d) => d.id));

    const detailed501 = await fetchDisputesDetailed({
      apiBaseUrl: "http://example.test",
      fetchFn: mockFetch501,
    });
    expect(detailed501.isFallback).toBe(true);
    expect(detailed501.disputes.map((d) => d.id)).toEqual(SEED_DISPUTES.map((d) => d.id));

    // Mock network throw -> falls back to seed data
    const mockFetchError = (async () => {
      throw new Error("connection refused");
    }) as unknown as typeof fetch;

    const networkFallbackData = await fetchDisputes({
      apiBaseUrl: "http://example.test",
      fetchFn: mockFetchError,
    });
    expect(networkFallbackData.map((d) => d.id)).toEqual(SEED_DISPUTES.map((d) => d.id));

    const detailedError = await fetchDisputesDetailed({
      apiBaseUrl: "http://example.test",
      fetchFn: mockFetchError,
    });
    expect(detailedError.isFallback).toBe(true);
    expect(detailedError.disputes.map((d) => d.id)).toEqual(SEED_DISPUTES.map((d) => d.id));
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
    expect(platforms.has("Northstar")).toBe(true);
    expect(platforms.has("Wayfinder")).toBe(true);
    expect(platforms.has("Errandly")).toBe(true);
    expect(platforms.has("Tote")).toBe(true);
  });

  // #173, #234: `GET /disputes` now says how many disputes exist (`total`, `limit`, `offset`, `hasMore`). The dashboard asks for as
  // many as the API gives, and only says "partial" when the server said it did not send them all.
  describe("paging and the partial data indicator (#234)", () => {
    const answer = (body: unknown) =>
      (async (url: string) => {
        seen.push(url);
        return { ok: true, json: async () => body };
      }) as unknown as typeof fetch;
    const seen: string[] = [];
    const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `PP-D-${i + 1}` }));
    const get = (body: unknown, extra: object = {}) =>
      fetchDisputesDetailed({ apiBaseUrl: "http://example.test", fetchFn: answer(body), ...extra });

    it("asks for as many disputes as the API gives, from the start, unless told otherwise", async () => {
      seen.length = 0;
      await get({ disputes: [] });
      expect(MAX_DISPUTES_PER_REQUEST).toBe(200);
      expect(seen).toEqual(["http://example.test/disputes?limit=200&offset=0"]);
    });

    it("passes limit and offset through when given", async () => {
      seen.length = 0;
      await get({ disputes: [] }, { limit: 25, offset: 50 });
      expect(seen).toEqual(["http://example.test/disputes?limit=25&offset=50"]);
    });

    it("reads the paging the API sends, and a list with more behind it is partial", async () => {
      const res = await get({ disputes: rows(2), total: 100, limit: 2, offset: 0, hasMore: true });
      expect(res.isFallback).toBe(false);
      expect(res.paging).toEqual({ total: 100, limit: 2, offset: 0, hasMore: true });
      expect(isPartialList(res.paging, res.disputes.length)).toBe(true);
    });

    it("a complete list is not partial, even when it is exactly as big as the limit", async () => {
      const res = await get({ disputes: rows(3), total: 3, limit: 3, offset: 0, hasMore: false });
      expect(isPartialList(res.paging, res.disputes.length)).toBe(false);
    });

    it("works out hasMore from the total when the API leaves it out", async () => {
      const res = await get({ disputes: rows(2), total: 5, limit: 2, offset: 2 });
      expect(res.paging).toEqual({ total: 5, limit: 2, offset: 2, hasMore: true });
      const last = await get({ disputes: rows(1), total: 5, limit: 2, offset: 4 });
      expect(last.paging?.hasMore).toBe(false);
    });

    it("no total means unknown, never partial: nothing is guessed", async () => {
      const res = await get({ disputes: rows(1) });
      expect(res.isFallback).toBe(false);
      expect(res.paging).toBeUndefined();
      expect(isPartialList(res.paging, res.disputes.length)).toBe(false);
    });

    it("ignores paging numbers that are not valid counts", async () => {
      const res = await get({ disputes: rows(1), total: "many", limit: -1 });
      expect(res.paging).toBeUndefined();
    });

    it("isPartialList: more behind this answer, or a total larger than what is held", () => {
      expect(isPartialList(undefined, 10)).toBe(false);
      expect(isPartialList({ total: 10, limit: 50, offset: 0, hasMore: false }, 10)).toBe(false);
      expect(isPartialList({ total: 11, limit: 10, offset: 0, hasMore: true }, 10)).toBe(true);
      expect(isPartialList({ total: 11, limit: 10, offset: 0, hasMore: false }, 10)).toBe(true); // the total still says so
      expect(isPartialList({ total: 10, limit: 5, offset: 5, hasMore: false }, 5)).toBe(false); // the second of two pages
    });

    // The banner is what a shopper-facing operator reads, so it is rendered from the real component, not re-derived.
    describe("the queue's banner", () => {
      // The component's JSX is compiled for Next's runtime; under vitest it needs React in scope, and it is imported after that.
      const render = async (disputes: DisputeItem[], paging?: Parameters<typeof isPartialList>[0]) => {
        (globalThis as { React?: unknown }).React = React;
        const { DisputeQueue } = await import("../app/disputes/DisputeQueue");
        return renderToStaticMarkup(
          React.createElement(DisputeQueue, {
            initialDisputes: disputes,
            initialIsDemo: false,
            initialPaging: paging,
          }),
        );
      };
      const some = generateSeedDisputes().slice(0, 3);

      it("says how many of how many it shows when the server did not send them all", async () => {
        const html = await render(some, { total: 90, limit: 3, offset: 0, hasMore: true });
        expect(html).toContain('data-testid="partial-data-indicator"');
        expect(html).toContain("showing 3 of 90 disputes");
        expect(html).not.toContain("first page");
      });

      it("is absent for a complete list, and for one whose paging is unknown", async () => {
        expect(await render(some, { total: 3, limit: 50, offset: 0, hasMore: false })).not.toContain(
          "partial-data-indicator",
        );
        expect(await render(some, undefined)).not.toContain("partial-data-indicator");
      });
    });
  });
});
