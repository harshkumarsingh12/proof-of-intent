import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createDb, type Db } from "./index";

const adminUrl = process.env.DATABASE_URL;
describe.runIf(adminUrl)("persistent AI usage (spec 0011)", () => {
  const name = `poi_ai_${randomUUID().replace(/-/g, "")}`;
  const url = new URL(adminUrl ?? "postgres://localhost/unused");
  url.pathname = `/${name}`;
  let db: Db;
  let raw: pg.Pool;
  beforeAll(async () => {
    const admin = new pg.Client({ connectionString: adminUrl });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${name}`);
    await admin.end();
    db = createDb(url.toString());
    await db.migrate();
    raw = new pg.Pool({ connectionString: url.toString() });
  });
  afterAll(async () => {
    await db?.close();
    await raw?.end();
    const admin = new pg.Client({ connectionString: adminUrl });
    await admin.connect();
    for (let i = 0; i < 50; i++) {
      if (!(await admin.query("SELECT 1 FROM pg_stat_activity WHERE datname=$1", [name])).rows.length) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    await admin.query(`DROP DATABASE ${name} WITH (FORCE)`);
    await admin.end();
  });
  test("a limit and zero kill switch deny without increasing the persisted counter", async () => {
    expect(await db.reserveAiCall("merchant-one", 2)).toEqual({ allowed: true, used: 1, limit: 2 });
    expect(await db.reserveAiCall("merchant-one", 2)).toEqual({ allowed: true, used: 2, limit: 2 });
    expect(await db.reserveAiCall("merchant-one", 2)).toEqual({ allowed: false, used: 2, limit: 2 });
    expect(await db.reserveAiCall("merchant-off", 0)).toEqual({ allowed: false, used: 0, limit: 0 });
  });
  test("independent pools racing for the last slot allow exactly one reservation", async () => {
    const other = createDb(url.toString(), { maxConnections: 2, allowExitOnIdle: true });
    try {
      await db.reserveAiCall("merchant-race", 2);
      const results = await Promise.all(
        Array.from({ length: 20 }, (_, i) => (i % 2 ? db : other).reserveAiCall("merchant-race", 2)),
      );
      expect(results.filter((r) => r.allowed)).toHaveLength(1);
      expect(results.every((r) => r.used === 2)).toBe(true);
    } finally {
      await other.close();
    }
  });
  test("restarting a caller cannot restore capacity and merchants have independent counters", async () => {
    await db.reserveAiCall("merchant-restart", 1);
    const restarted = createDb(url.toString());
    try {
      expect(await restarted.reserveAiCall("merchant-restart", 1)).toEqual({
        allowed: false,
        used: 1,
        limit: 1,
      });
    } finally {
      await restarted.close();
    }
    expect(await db.reserveAiCall("another-merchant", 1)).toEqual({ allowed: true, used: 1, limit: 1 });
  });
  test("a lower cap persists even when denied, so a stale process cannot raise it", async () => {
    await db.reserveAiCall("merchant-lower", 5);
    await db.reserveAiCall("merchant-lower", 5);
    expect(await db.reserveAiCall("merchant-lower", 1)).toEqual({ allowed: false, used: 2, limit: 1 });
    expect(await db.reserveAiCall("merchant-lower", 99)).toEqual({ allowed: false, used: 2, limit: 1 });
  });
  test("a previous UTC day's spent counter does not consume today's allowance", async () => {
    await raw.query(
      "INSERT INTO ai_daily_usage VALUES ('merchant-midnight', (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date-1, 10, 10, now())",
    );
    expect(await db.reserveAiCall("merchant-midnight", 1)).toEqual({ allowed: true, used: 1, limit: 1 });
    const rows = await raw.query(
      "SELECT used FROM ai_daily_usage WHERE merchant_id='merchant-midnight' ORDER BY utc_day",
    );
    expect(rows.rows.map((r) => Number(r.used))).toEqual([10, 1]);
  });
  test("retention removes only old counters and leaves current spending intact", async () => {
    await raw.query(
      "INSERT INTO ai_daily_usage VALUES ('merchant-old', (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date-8, 4, 4, now())",
    );
    await db.reserveAiCall("merchant-cleanup", 1);
    expect(
      (await raw.query("SELECT 1 FROM ai_daily_usage WHERE merchant_id='merchant-old'")).rows,
    ).toHaveLength(0);
    expect(await db.reserveAiCall("merchant-cleanup", 1)).toMatchObject({ allowed: false, used: 1 });
  });
  test("invalid limits and missing merchant scope fail before reserving", async () => {
    for (const limit of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])
      await expect(db.reserveAiCall("merchant-invalid", limit)).rejects.toThrow();
    await expect(db.reserveAiCall(" ", 1)).rejects.toThrow();
    expect(
      (await raw.query("SELECT 1 FROM ai_daily_usage WHERE merchant_id='merchant-invalid'")).rows,
    ).toHaveLength(0);
  });
  test("database failure never returns an allowed reservation", async () => {
    const unavailable = createDb(url.toString());
    await unavailable.close();
    await expect(unavailable.reserveAiCall("merchant-failure", 1)).rejects.toThrow();
  });
});
