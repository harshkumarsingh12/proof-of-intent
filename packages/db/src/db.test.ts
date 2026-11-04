import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createDb, type Db } from "./index";

// Runs against real Postgres. CI provides one (ci.yml services); locally:
//   docker run -d -p 127.0.0.1:5432:5432 -e POSTGRES_USER=poi -e POSTGRES_PASSWORD=poi -e POSTGRES_DB=poi postgres:16-alpine
//   DATABASE_URL=postgres://poi:poi@localhost:5432/poi pnpm vitest run packages/db
const ADMIN_URL = process.env.DATABASE_URL;

describe.runIf(ADMIN_URL)("db", () => {
  // A throwaway database per run, so every test starts from an empty schema.
  const name = `poi_test_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const url = new URL(ADMIN_URL!);
  url.pathname = `/${name}`;
  let db: Db;
  let raw: pg.Pool;

  beforeAll(async () => {
    const admin = new pg.Client({ connectionString: ADMIN_URL });
    await admin.connect();
    await admin.query(`create database ${name}`);
    await admin.end();
    db = createDb(url.toString());
    raw = new pg.Pool({ connectionString: url.toString() });
  });

  afterAll(async () => {
    await db?.close();
    await raw?.end();
    const admin = new pg.Client({ connectionString: ADMIN_URL });
    await admin.connect();
    await admin.query(`drop database if exists ${name} with (force)`);
    await admin.end();
  });

  test("migrations apply once, and concurrent runs don't collide", async () => {
    const other = createDb(url.toString());
    const [a, b] = await Promise.all([db.migrate(), other.migrate()]);
    await other.close();
    expect([...a, ...b]).toEqual(["0001_init.sql"]);
    expect(await db.migrate()).toEqual([]);
  });

  test("a nonce can be claimed once; the second claim returns false", async () => {
    expect(await db.claimNonce("n-test-1")).toBe(true);
    expect(await db.claimNonce("n-test-1")).toBe(false);
    expect(await db.claimNonce("n-test-2")).toBe(true);
  });

  test("concurrent claims of one nonce: exactly one wins", async () => {
    const results = await Promise.all(Array.from({ length: 10 }, () => db.claimNonce("n-race")));
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  test("audit log accepts appends", async () => {
    await expect(
      db.appendAudit({ actor: "system", action: "verdict", subjectId: "ord_1" }),
    ).resolves.toBeUndefined();
  });

  test("the audit trail returns a subject's rows oldest first, with timestamps and JSON intact", async () => {
    await db.appendAudit({
      actor: "api",
      action: "verdict",
      subjectId: "ord_2",
      requestBody: { reasons: ["A", "B"] },
    });
    await db.appendAudit({
      actor: "operator:sam",
      action: "dispute.accept",
      subjectId: "ord_2",
      priorState: { status: "OPEN" },
    });
    await db.appendAudit({ actor: "api", action: "verdict", subjectId: "ord_other" });

    const trail = await db.auditTrail("ord_2");
    expect(trail.map((r) => r.action)).toEqual(["verdict", "dispute.accept"]);
    expect(trail[0]).toMatchObject({
      actor: "api",
      subjectId: "ord_2",
      requestBody: { reasons: ["A", "B"] },
    });
    expect(trail[0]).not.toHaveProperty("priorState");
    expect(trail[1]!.priorState).toEqual({ status: "OPEN" });
    expect(Date.parse(trail[0]!.at)).not.toBeNaN();
  });

  test("the audit log is append-only: update, delete and truncate are refused", async () => {
    await expect(raw.query("update audit_log set actor = 'x'")).rejects.toThrow("append-only");
    await expect(raw.query("delete from audit_log")).rejects.toThrow("append-only");
    await expect(raw.query("truncate audit_log")).rejects.toThrow("append-only");
    expect((await db.auditTrail("ord_2")).length).toBe(2);
  });

  test("a webhook event is stored once; redelivery returns false and changes nothing", async () => {
    const event = {
      eventId: "WH-1",
      eventType: "PAYMENT.CAPTURE.COMPLETED",
      resourceId: "CAP-1",
      payload: { id: "WH-1", n: 1 },
    };
    expect(await db.recordWebhookEvent(event)).toBe(true);
    expect(await db.recordWebhookEvent({ ...event, payload: { id: "WH-1", n: 2 } })).toBe(false);
    const rows = (await raw.query("select * from webhook_events where event_id = 'WH-1'")).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      event_type: "PAYMENT.CAPTURE.COMPLETED",
      resource_id: "CAP-1",
      payload: { n: 1 },
      processed_at: null,
    });
  });

  test("the schema refuses malformed hashes and oversized custom_id", async () => {
    await expect(
      raw.query(
        "insert into mandates (id, kind, hash, canonical, jws, kid) values ('m1', 'intent', $1, '{}', 'j', 'k')",
        ["A".repeat(64)],
      ),
    ).rejects.toThrow();
    await raw.query(
      "insert into mandates (id, kind, hash, canonical, jws, kid) values ('m2', 'intent', $1, '{}', 'j', 'k')",
      ["a".repeat(64)],
    );
    await expect(
      raw.query(
        "insert into orders (id, intent_mandate_id, custom_id, paypal_intent, status, total_value, currency, human_present) values ('o1', 'm2', $1, 'AUTHORIZE', 'CREATED', 1, 'USD', true)",
        ["x".repeat(128)],
      ),
    ).rejects.toThrow();
  });
});
