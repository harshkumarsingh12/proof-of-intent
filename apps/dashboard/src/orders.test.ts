import { describe, expect, it } from "vitest";
import { fetchOrders, joinOrders, orderKpis, sampleOrders, type VerdictRow } from "./orders";
import { SEED_ORDERS } from "./seed-orders";

const order = (id: string, status = "CAPTURED", totalValue = 7400, currency = "USD") => ({
  id,
  agentPlatform: "Northstar",
  humanPresent: true,
  status,
  totalValue,
  currency,
});

const verdict = (id: number, outcome: VerdictRow["outcome"], orderId?: string, reasons: string[] = []) => ({
  id,
  cartId: `cart_${id}`,
  intentMandateId: "m1",
  ...(orderId ? { orderId } : {}),
  outcome,
  reasons,
  createdAt: "2026-11-06T10:00:00Z",
});

describe("orders page data", () => {
  it("joins each order to its latest verdict", () => {
    const rows = joinOrders(
      [order("ord_1"), order("ord_2")],
      [verdict(1, "STEP_UP", "ord_1", ["SEMANTIC_UNCERTAIN"]), verdict(3, "APPROVE", "ord_1"), verdict(2, "REJECT")],
    );
    expect(rows[0]).toMatchObject({ orderId: "ord_1", verdict: "APPROVE", reasons: [] });
    expect(rows[1]!.verdict).toBeUndefined();
    expect(rows[0]!.amount).toEqual({ value: 7400, currency: "USD" });
  });

  it("counts blocked carts and sums captured money per currency", () => {
    const k = orderKpis({
      orders: joinOrders([order("a"), order("b", "COMPLETED", 100), order("c", "CREATED"), order("d", "CAPTURED", 50, "EUR")], []),
      verdicts: [verdict(1, "REJECT"), verdict(2, "REJECT"), verdict(3, "STEP_UP", "c")],
    });
    expect(k).toEqual({
      captured: 3,
      capturedValue: [
        { value: 7500, currency: "USD" },
        { value: 50, currency: "EUR" },
      ],
      blocked: 2,
      stepUp: 1,
    });
  });

  it("sample data keeps rejected carts off PayPal (no order rows for them)", () => {
    const s = sampleOrders();
    const blocked = SEED_ORDERS.filter((o) => o.status === "BLOCKED").length;
    expect(s.isSample).toBe(true);
    expect(s.verdicts).toHaveLength(SEED_ORDERS.length);
    expect(s.orders).toHaveLength(SEED_ORDERS.length - blocked);
    expect(s.verdicts.filter((v) => v.outcome === "REJECT").every((v) => !v.orderId)).toBe(true);
  });

  it("reads the API, and falls back to sample data when it is down or answers an error", async () => {
    const api = (async (url: string) => {
      const body = String(url).includes("/orders")
        ? { orders: [order("ord_live")] }
        : { verifications: [verdict(9, "APPROVE", "ord_live")] };
      return new Response(JSON.stringify(body), { status: 200 });
    }) as typeof fetch;
    const live = await fetchOrders({ apiBaseUrl: "http://api", fetchFn: api });
    expect(live.isSample).toBe(false);
    expect(live.orders[0]).toMatchObject({ orderId: "ord_live", verdict: "APPROVE" });

    const down = (async () => {
      throw new Error("ECONNREFUSED");
    }) as typeof fetch;
    expect((await fetchOrders({ fetchFn: down })).isSample).toBe(true);
    const err = (async () => new Response("{}", { status: 503 })) as typeof fetch;
    expect((await fetchOrders({ fetchFn: err })).isSample).toBe(true);
  });
});
