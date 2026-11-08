import { randomUUID } from "node:crypto";
import { createDb } from "@poi/db";
import { createMockClient } from "@poi/paypal";
import pg from "pg";
import { afterEach, expect, test, vi } from "vitest";
import { seedDemo } from "../../../scripts/demo/seed-data";
import { fetchOrders, orderKpis } from "../../dashboard/src/orders";
import { buildApp } from "./app";

const adminUrl = process.env.DATABASE_URL;

afterEach(() => vi.unstubAllEnvs());

test("demo seed refuses sandbox mode and remote Postgres before connecting", async () => {
  await expect(seedDemo("postgres://localhost/demo", "sandbox")).rejects.toThrow("PAYPAL_MODE=mock");
  await expect(seedDemo("postgres://example.invalid/demo")).rejects.toThrow("local or Compose Postgres");
  await expect(seedDemo("postgres://localhost/demo?host=example.invalid")).rejects.toThrow(
    "local or Compose Postgres",
  );
});

test.runIf(adminUrl)(
  "a fresh mock database serves the full demo through the merchant API",
  async () => {
    const name = `poi_demo_test_${randomUUID().replaceAll("-", "")}`;
    const url = new URL(adminUrl!);
    url.pathname = `/${name}`;
    const admin = new pg.Client({ connectionString: adminUrl });
    await admin.connect();
    await admin.query(`create database ${name}`);

    const paypal = createMockClient();
    const app = buildApp({ db: createDb(url.toString()), paypal, operatorToken: "test-only" });
    // Merchant reads need the operator token (#163); the dashboard's server sends the one in its environment.
    const read = { authorization: "Bearer test-only" };
    vi.stubEnv("OPERATOR_TOKEN", "test-only");
    try {
      const now = new Date("2026-11-07T09:00:00Z");
      const results = await Promise.all([
        seedDemo(url.toString(), "mock", now),
        seedDemo(url.toString(), "mock", now),
      ]);
      expect(results.sort()).toEqual([false, true]);

      const first = await app.inject({ method: "GET", url: "/orders?limit=200", headers: read });
      const rest = await app.inject({ method: "GET", url: "/orders?limit=200&offset=200", headers: read });
      expect([first.statusCode, rest.statusCode]).toEqual([200, 200]);
      const orders = [...first.json().orders, ...rest.json().orders];
      expect(new Set(orders.map((o) => o.id)).size).toBe(300);
      expect(new Set(orders.map((o) => o.agentPlatform)).size).toBe(4);

      // The dashboard's loader reads every page (#99): all 300 orders, every verdict, and the totals.
      const viaApi = (async (input: string | URL | Request, init?: RequestInit) => {
        // What the dashboard's loader sends (read-auth.ts) reaches the API, so the token it holds is what is tested.
        const res = await app.inject({
          method: "GET",
          url: String(input).replace("http://api", ""),
          headers: (init?.headers ?? {}) as Record<string, string>,
        });
        return new Response(res.body, { status: res.statusCode });
      }) as typeof fetch;
      const loaded = await fetchOrders({ apiBaseUrl: "http://api", fetchFn: viaApi });
      const testDb = new pg.Client({ connectionString: url.toString() });
      await testDb.connect();
      const { rows } = await testDb.query<{ verdicts: number; value: number; approved: string[] }>(
        `select (select count(*)::int from verdicts) as verdicts,
          (select sum(total_value)::int from orders where status = 'CAPTURED') as value,
          (select array_agg(order_id) from verdicts where outcome = 'APPROVE') as approved`,
      );
      await testDb.end();
      const [truth] = rows;
      expect(loaded.isSample).toBe(false);
      expect(loaded.orders).toHaveLength(300);
      expect(truth!.verdicts).toBeGreaterThan(200);
      expect(loaded.verdicts).toHaveLength(truth!.verdicts);
      expect(orderKpis(loaded)).toMatchObject({
        captured: 300,
        capturedValue: [{ value: truth!.value, currency: "USD" }],
      });
      // Orders past the first page keep their verdict, wherever the verdict landed in its own list.
      const approved = new Set(truth!.approved);
      const late = loaded.orders.slice(200);
      expect(late.some((o) => approved.has(o.orderId))).toBe(true);
      for (const o of loaded.orders) expect(o.verdict).toBe(approved.has(o.orderId) ? "APPROVE" : undefined);

      const queue = await app.inject({ method: "GET", url: "/disputes", headers: read });
      expect(queue.statusCode).toBe(200);
      const { disputes } = queue.json();
      expect(disputes).toHaveLength(24);
      expect(disputes.slice(0, 2)).toMatchObject([
        { id: "PP-D-1001", decision: "defend", evidenceDrafted: true },
        { id: "PP-D-1002", decision: "concede", evidenceDrafted: false },
      ]);
      const overreach = await app.inject({
        method: "GET",
        url: "/disputes/PP-D-1002/recommendation",
        headers: read,
      });
      expect(overreach.statusCode).toBe(200);
      expect(overreach.json()).toMatchObject({
        isDemoData: true,
        reasons: ["AMOUNT_EXCEEDS_MAX", "ATTRIBUTE_MISMATCH"],
        cartLines: [{ color: "red" }],
        cartTotal: { value: 9500, currency: "USD" },
      });
      // The other overreach disputes come from across the catalog, each failing its own signed limit.
      const others = await Promise.all(
        ["PP-D-1007", "PP-D-1012", "PP-D-1017"].map(async (id) => {
          const res = await app.inject({
            method: "GET",
            url: `/disputes/${id}/recommendation`,
            headers: read,
          });
          return {
            status: res.statusCode,
            reasons: res.json().reasons,
            title: res.json().cartLines?.[0]?.title,
          };
        }),
      );
      expect(others).toMatchObject([
        { status: 200, reasons: ["ATTRIBUTE_MISMATCH"], title: "Tempo Road Running Shoe, size 10" },
        { status: 200, reasons: ["AMOUNT_EXCEEDS_MAX"], title: "Cushioned Running Socks, 6-pack" },
        { status: 200, reasons: ["ATTRIBUTE_MISMATCH"], title: "Stride Running Jacket" },
      ]);
      expect(
        new Set(disputes.map((d: { amount?: { value: number } }) => d.amount?.value)).size,
      ).toBeGreaterThan(2);

      const preview = await app.inject({
        method: "GET",
        url: "/disputes/PP-D-1001/evidence.pdf",
        headers: read,
      });
      expect(preview.statusCode).toBe(200);
      expect(preview.headers["content-type"]).toContain("application/pdf");
      expect(preview.body.startsWith("%PDF-")).toBe(true);

      const action = await app.inject({
        method: "POST",
        url: "/disputes/PP-D-1002/actions/accept-claim",
        headers: { authorization: "Bearer test-only" },
      });
      expect(action.statusCode).toBe(409);
      expect(action.json().error).toBe("demo_read_only");
      const tracking = await app.inject({
        method: "POST",
        url: `/orders/${orders[0].id}/tracking`,
        headers: { authorization: "Bearer test-only" },
        payload: { trackingNumber: "sample", carrier: "UPS" },
      });
      expect(tracking.statusCode).toBe(409);
      expect(tracking.json().error).toBe("demo_read_only");
      expect(paypal.disputeActions).toEqual([]);

      const studio = (payload: object) =>
        app.inject({
          method: "POST",
          url: "/ai/studio",
          headers: { authorization: "Bearer test-only" },
          payload,
        });
      const defend = await studio({ kind: "tool", tool: "explain_dispute", disputeId: "PP-D-1001" });
      expect(defend.statusCode).toBe(200);
      expect(defend.json()).toMatchObject({
        class: "MANDATE_COMPLIANT",
        action: "PROVIDE_EVIDENCE",
        failedChecks: [],
      });
      expect(defend.json()).not.toHaveProperty("shopperNotes");
      const concede = await studio({ kind: "tool", tool: "explain_dispute", disputeId: "PP-D-1002" });
      expect(concede.json()).toMatchObject({
        class: "AGENT_OVERREACH",
        action: "ACCEPT_CLAIM",
        reasons: ["AMOUNT_EXCEEDS_MAX", "ATTRIBUTE_MISMATCH"],
      });
      const draft = await studio({ kind: "tool", tool: "draft_buyer_message", disputeId: "PP-D-1002" });
      expect(draft.json()).toMatchObject({
        id: "PP-D-1002",
        draft: expect.stringContaining("exceeded"),
        sent: false,
      });
      expect((await studio({ kind: "tool", tool: "explain_dispute", disputeId: "unknown" })).statusCode).toBe(
        404,
      );
      for (const tool of ["accept_claim", "send_message", "provide_evidence"]) {
        expect((await studio({ kind: "tool", tool, disputeId: "PP-D-1002" })).statusCode).toBe(400);
      }
      expect(paypal.disputeActions).toEqual([]);
    } finally {
      await app.close();
      await admin.query(`drop database ${name} with (force)`);
      await admin.end();
    }
  },
  30_000,
);
