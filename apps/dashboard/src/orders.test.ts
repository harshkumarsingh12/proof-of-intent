import { describe, expect, it } from "vitest";
import { fetchOrders, joinOrders, orderKpis, PAGE_SIZE, sampleOrders, type VerdictRow } from "./orders";
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
      [
        verdict(1, "STEP_UP", "ord_1", ["SEMANTIC_UNCERTAIN"]),
        verdict(3, "APPROVE", "ord_1"),
        verdict(2, "REJECT"),
      ],
    );
    expect(rows[0]).toMatchObject({ orderId: "ord_1", verdict: "APPROVE", reasons: [] });
    expect(rows[1]!.verdict).toBeUndefined();
    expect(rows[0]!.amount).toEqual({ value: 7400, currency: "USD" });
  });

  it("counts blocked carts and sums captured money per currency", () => {
    const k = orderKpis({
      orders: joinOrders(
        [order("a"), order("b", "COMPLETED", 100), order("c", "CREATED"), order("d", "CAPTURED", 50, "EUR")],
        [],
      ),
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

  it("reads every page, so totals cover all orders and late orders keep their verdict (#99)", async () => {
    // 320 orders, newest first like the API; 330 verdicts, highest id first, in a different order.
    const orders = Array.from({ length: 320 }, (_, i) => order(`ord_${i}`, "CAPTURED", 100 + i));
    const verdicts = [
      ...orders.map((o, i) => verdict(1000 - i, "APPROVE", o.id)),
      ...Array.from({ length: 10 }, (_, i) => verdict(i + 1, "REJECT")),
    ].reverse(); // ord_319's verdict is now near the top, ord_0's near the bottom
    const seen: string[] = [];
    const api = (async (input: string | URL | Request) => {
      const url = new URL(String(input));
      seen.push(`${url.pathname}?${url.searchParams}`);
      const limit = Math.min(Number(url.searchParams.get("limit")) || 50, PAGE_SIZE);
      const offset = Number(url.searchParams.get("offset")) || 0;
      const all = url.pathname === "/orders" ? orders : verdicts;
      const page = all.slice(offset, offset + limit);
      const key = url.pathname === "/orders" ? "orders" : "verifications";
      return new Response(JSON.stringify({ [key]: page }), { status: 200 });
    }) as typeof fetch;

    const data = await fetchOrders({ apiBaseUrl: "http://api", fetchFn: api });
    expect(data.isSample).toBe(false);
    expect(data.orders).toHaveLength(320);
    expect(data.verdicts).toHaveLength(330);
    expect(data.orders.every((o) => o.verdict === "APPROVE")).toBe(true);
    expect(data.orders[0]).toMatchObject({ orderId: "ord_0", verdict: "APPROVE" });
    expect(orderKpis(data)).toEqual({
      captured: 320,
      capturedValue: [{ value: orders.reduce((sum, o) => sum + o.totalValue, 0), currency: "USD" }],
      blocked: 10,
      stepUp: 0,
    });
    expect(seen.filter((u) => u.startsWith("/orders")).sort()).toEqual([
      "/orders?limit=200&offset=0",
      "/orders?limit=200&offset=200",
    ]);
  });

  it("drops a row repeated across pages, and an error on a later page falls back to sample data", async () => {
    const rows = Array.from({ length: 201 }, (_, i) => order(`ord_${i}`));
    const shifted = (async (input: string | URL | Request) => {
      const url = new URL(String(input));
      const offset = Number(url.searchParams.get("offset")) || 0;
      // A new order arrived between the two reads: page 2 repeats the last row of page 1.
      const page = url.pathname === "/orders" ? (offset ? rows.slice(199) : rows.slice(0, 200)) : [];
      return new Response(
        JSON.stringify(url.pathname === "/orders" ? { orders: page } : { verifications: page }),
      );
    }) as typeof fetch;
    expect((await fetchOrders({ apiBaseUrl: "http://api", fetchFn: shifted })).orders).toHaveLength(201);

    const failsLater = (async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.searchParams.get("offset") !== "0") return new Response("{}", { status: 503 });
      return new Response(JSON.stringify({ orders: rows.slice(0, 200), verifications: [] }));
    }) as typeof fetch;
    expect((await fetchOrders({ apiBaseUrl: "http://api", fetchFn: failsLater })).isSample).toBe(true);
  });
});
