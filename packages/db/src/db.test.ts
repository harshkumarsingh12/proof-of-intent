import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
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

  test("a killed idle connection doesn't crash the process; the next query reconnects", async () => {
    const victim = createDb(url.toString());
    await victim.claimNonce("n-before-kill"); // opens a pooled connection that now sits idle
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    // What a Postgres restart or failover does to an idle client.
    await raw.query(
      "select pg_terminate_backend(pid) from pg_stat_activity where datname = current_database() and pid <> pg_backend_pid() and query like 'insert into nonces%'",
    );
    await new Promise((r) => setTimeout(r, 200));
    expect(errors).toHaveBeenCalledWith(expect.stringContaining("idle connection lost"));
    expect(await victim.claimNonce("n-after-kill")).toBe(true);
    errors.mockRestore();
    await victim.close();
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

  test("webhook redelivery is a no-op at the schema level", async () => {
    const insert =
      "insert into webhook_events (event_id, event_type, payload) values ('WH-1', 'X', '{}') on conflict do nothing";
    expect((await raw.query(insert)).rowCount).toBe(1);
    expect((await raw.query(insert)).rowCount).toBe(0);
  });

  test("the schema refuses malformed hashes and oversized custom_id", async () => {
    await expect(
      raw.query(
        "insert into mandates (hash, kind, mandate_id, canonical, jws, kid) values ($1, 'intent', 'm1', '{}', 'j', 'k')",
        ["A".repeat(64)],
      ),
    ).rejects.toThrow();
    await raw.query(
      "insert into mandates (hash, kind, mandate_id, canonical, jws, kid) values ($1, 'intent', 'm2', '{}', 'j', 'k')",
      ["a".repeat(64)],
    );
    await expect(
      raw.query(
        "insert into orders (id, intent_mandate_id, intent_mandate_hash, custom_id, paypal_intent, status, total_value, currency, human_present) values ('o1', 'm2', $2, $1, 'AUTHORIZE', 'CREATED', 1, 'USD', true)",
        ["x".repeat(128), "a".repeat(64)],
      ),
    ).rejects.toThrow();
  });
});
