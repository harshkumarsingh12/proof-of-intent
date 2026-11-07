import { describe, expect, test } from "vitest";
import { createMockClient } from "@poi/paypal";
import { buildApp } from "./app";
import { memoryDb } from "./test-helpers";

describe("api", () => {
  test("healthz returns ok", async () => {
    const res = await buildApp({ paypal: createMockClient() }).inject({ method: "GET", url: "/healthz" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
  });

  test("unbuilt routes say who owns them", async () => {
    const res = await buildApp({ paypal: createMockClient() }).inject({
      method: "GET",
      url: "/analytics/overview",
    });
    expect(res.statusCode).toBe(501);
    expect(res.json().owner).toBe("hoursgotviral-dev");
  });

  describe("readyz", () => {
    const ready = (db?: ReturnType<typeof memoryDb>["db"], readyDbTimeoutMs?: number) =>
      buildApp({ paypal: createMockClient(), db, readyDbTimeoutMs }).inject({ method: "GET", url: "/readyz" });

    test("without a DATABASE_URL there is nothing to ask, so it is ok", async () => {
      const res = await ready();
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ status: "ok", database: "not_configured" });
    });

    test("a database that answers is ok, with the webhook count", async () => {
      const res = await ready(memoryDb().db);
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ status: "ok", database: "configured", webhooks: { received: 0 } });
    });

    test("a database that errors is 503 unreachable, and the webhook count is not attempted", async () => {
      const { db } = memoryDb();
      db.ping = async () => {
        throw new Error("getaddrinfo ENOTFOUND postgres");
      };
      db.webhookStats = async () => {
        throw new Error("webhookStats must not run against a database that failed its ping");
      };
      const res = await ready(db);
      expect(res.statusCode).toBe(503);
      expect(res.json()).toMatchObject({ status: "unavailable", database: "unreachable", webhooks: null });
    });

    test("a database that never answers is 503 within the timeout, not a hung request", async () => {
      const { db } = memoryDb();
      db.ping = () => new Promise<void>(() => {});
      const started = Date.now();
      const res = await ready(db, 50);
      expect(res.statusCode).toBe(503);
      expect(res.json().database).toBe("unreachable");
      expect(Date.now() - started).toBeLessThan(1000);
    });

    test("healthz stays 200 when the database is down: it is liveness, not readiness", async () => {
      const { db } = memoryDb();
      db.ping = async () => {
        throw new Error("down");
      };
      const res = await buildApp({ paypal: createMockClient(), db }).inject({ method: "GET", url: "/healthz" });
      expect(res.statusCode).toBe(200);
    });
  });
});
