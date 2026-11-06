import { randomUUID } from "node:crypto";
import { createDb } from "@poi/db";
import { createMockClient } from "@poi/paypal";
import pg from "pg";
import { expect, test } from "vitest";
import { seedDemo } from "../../../scripts/demo/seed-data";
import { buildApp } from "./app";

const adminUrl = process.env.DATABASE_URL;

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
    try {
      const now = new Date("2026-11-07T09:00:00Z");
      const results = await Promise.all([
        seedDemo(url.toString(), "mock", now),
        seedDemo(url.toString(), "mock", now),
      ]);
      expect(results.sort()).toEqual([false, true]);

      const first = await app.inject("/orders?limit=200");
      const rest = await app.inject("/orders?limit=200&offset=200");
      expect([first.statusCode, rest.statusCode]).toEqual([200, 200]);
      const orders = [...first.json().orders, ...rest.json().orders];
      expect(new Set(orders.map((o) => o.id)).size).toBe(300);
      expect(new Set(orders.map((o) => o.agentPlatform)).size).toBe(4);

      const queue = await app.inject("/disputes");
      expect(queue.statusCode).toBe(200);
      const { disputes } = queue.json();
      expect(disputes).toHaveLength(24);
      expect(disputes.slice(0, 2)).toMatchObject([
        { id: "PP-D-1001", decision: "defend", evidenceDrafted: true },
        { id: "PP-D-1002", decision: "concede", evidenceDrafted: false },
      ]);
      const overreach = await app.inject("/disputes/PP-D-1002/recommendation");
      expect(overreach.statusCode).toBe(200);
      expect(overreach.json()).toMatchObject({
        reasons: ["AMOUNT_EXCEEDS_MAX", "ATTRIBUTE_MISMATCH"],
        cartLines: [{ color: "red" }],
        cartTotal: { value: 9500, currency: "USD" },
      });
      const preview = await app.inject("/disputes/PP-D-1001/evidence.pdf");
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
    } finally {
      await app.close();
      await admin.query(`drop database ${name} with (force)`);
      await admin.end();
    }
  },
  30_000,
);
