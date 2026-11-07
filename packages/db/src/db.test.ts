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
  // Vitest still runs a skipped suite's body while collecting, so don't parse a missing URL.
  const url = new URL(ADMIN_URL ?? "postgres://localhost/unused");
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
    // pool.end() resolves before its sockets close; force-dropping under them makes Postgres kill those
    // connections, which pg reports as an unhandled error. Let them go first.
    for (let i = 0; i < 50; i++) {
      const left = await admin.query("select count(*)::int as n from pg_stat_activity where datname = $1", [
        name,
      ]);
      if (left.rows[0].n === 0) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    await admin.query(`drop database if exists ${name} with (force)`);
    await admin.end();
  });

  test("migrations apply once, and concurrent runs don't collide", async () => {
    const other = createDb(url.toString());
    const [a, b] = await Promise.all([db.migrate(), other.migrate()]);
    await other.close();
    expect([...a, ...b]).toEqual([
      "0001_init.sql",
      "0002_dispute_copilot.sql",
      "0003_stepups.sql",
      "0004_vault_setups.sql",
      "0005_shared_vault_id.sql",
    ]);
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

  test("ping resolves against a live database", async () => {
    await expect(db.ping()).resolves.toBeUndefined();
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
    expect(await db.webhookStats()).toMatchObject({ received: 1, lastEventType: event.eventType });
    const rows = (await raw.query("select * from webhook_events where event_id = 'WH-1'")).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      event_type: "PAYMENT.CAPTURE.COMPLETED",
      resource_id: "CAP-1",
      payload: { n: 1 },
      processed_at: null,
    });
  });

  test("mandates, orders and the capture ledger round-trip through Postgres", async () => {
    const h = (c: string) => c.repeat(64);
    await raw.query("insert into shoppers (id) values ('shopper-rt')");
    await raw.query(
      `insert into shopper_keys (kid, shopper_id, public_jwk, retired_at) values ('kid-rt', 'shopper-rt', '{"kty":"EC"}', '2026-11-03T00:00:00Z')`,
    );
    expect(await db.findKey("shopper", "kid-rt")).toEqual({
      kid: "kid-rt",
      publicJwk: { kty: "EC" },
      retiredAt: "2026-11-03T00:00:00.000Z",
      shopperId: "shopper-rt",
    });
    expect(await db.findKey("agent", "kid-rt")).toBeNull();

    const mandate = {
      hash: h("b"),
      kind: "intent" as const,
      mandateId: "m-rt",
      canonical: '{"a":1}',
      jws: "j",
      kid: "kid-rt",
    };
    await db.saveMandate(mandate);
    await db.saveMandate({ ...mandate, canonical: "changed" }); // same hash: no-op
    expect(await db.getMandate(h("b"))).toEqual(mandate);
    await db.saveMandate({ ...mandate, hash: h("c"), kind: "cart", mandateId: "cart-rt" });

    const order = {
      id: "ord_rt",
      intentMandateId: "m-rt",
      intentMandateHash: h("b"),
      cartMandateHash: h("c"),
      customId: "poi:m-rt:bbbbbbbbbbbbbbbb",
      paypalIntent: "AUTHORIZE" as const,
      status: "PENDING",
      totalValue: 7400,
      currency: "USD",
      shopperId: "shopper-rt",
      agentPlatform: "Northstar",
      humanPresent: true,
    };
    await db.createOrder(order);
    expect(await db.mandateLedger("m-rt")).toEqual({ capturedTotal: 0, capturedOrderTimes: [] });
    await db.updateOrder("ord_rt", { status: "CREATED", paypalOrderId: "PP-RT" });
    await db.updateOrder("ord_rt", {
      status: "CAPTURED",
      captureId: "CAP-RT",
      capturedAt: "2026-11-02T10:05:00Z",
    });
    expect(await db.getOrder("ord_rt")).toEqual({
      ...order,
      status: "CAPTURED",
      paypalOrderId: "PP-RT", // kept from the earlier update
      captureId: "CAP-RT",
      capturedAt: "2026-11-02T10:05:00.000Z",
      createdAt: expect.any(String),
    });
    expect(await db.mandateLedger("m-rt")).toEqual({
      capturedTotal: 7400,
      capturedOrderTimes: ["2026-11-02T10:05:00.000Z"],
    });
    await expect(db.updateOrder("ord_missing", { status: "X" })).rejects.toThrow("does not exist");
    expect(await db.getOrder("ord_missing")).toBeNull();

    await db.recordVerdict({
      intentMandateId: "m-rt",
      cartId: "cart-rt",
      orderId: "ord_rt",
      outcome: "APPROVE",
      reasons: ["A"],
    });
    expect((await raw.query("select outcome, reasons from verdicts where order_id = 'ord_rt'")).rows).toEqual(
      [{ outcome: "APPROVE", reasons: ["A"] }],
    );
    expect(await db.orderVerdict("ord_rt")).toEqual({
      intentMandateId: "m-rt",
      cartId: "cart-rt",
      orderId: "ord_rt",
      outcome: "APPROVE",
      reasons: ["A"],
    });
    expect(await db.orderVerdict("ord_missing")).toBeNull();
    expect((await db.listOrders({ limit: 10, offset: 0 })).map((o) => o.id)).toContain("ord_rt");
    expect((await db.listVerdicts({ limit: 1, offset: 0 }))[0]).toMatchObject({
      orderId: "ord_rt",
      id: expect.any(Number),
    });

    // A second order under the same mandate: its checkout only saw the first capture, not its own.
    await db.createOrder({ ...order, id: "ord_rt2" });
    await db.updateOrder("ord_rt2", {
      status: "CAPTURED",
      captureId: "CAP-RT2",
      capturedAt: new Date().toISOString(),
    });
    expect((await db.mandateLedger("m-rt", "ord_rt2")).capturedTotal).toBe(7400);
    expect((await db.mandateLedger("m-rt")).capturedTotal).toBe(14800);
  });

  test("dispute events form the worker's inbox until marked processed", async () => {
    await db.recordWebhookEvent({
      eventId: "WH-D1",
      eventType: "CUSTOMER.DISPUTE.CREATED",
      payload: { a: 1 },
    });
    await db.recordWebhookEvent({ eventId: "WH-C1", eventType: "PAYMENT.CAPTURE.COMPLETED", payload: {} });
    const pending = await db.pendingDisputeEvents(10);
    expect(pending.map((e) => e.eventId)).toContain("WH-D1");
    expect(pending.map((e) => e.eventId)).not.toContain("WH-C1");
    expect(pending.find((e) => e.eventId === "WH-D1")!.payload).toEqual({ a: 1 });
    await db.markEventProcessed("WH-D1");
    expect((await db.pendingDisputeEvents(10)).map((e) => e.eventId)).not.toContain("WH-D1");
  });

  test("disputes upsert, never regress to an older PayPal version, and list deadline first", async () => {
    const base = {
      id: "PP-D-RT",
      reason: "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED",
      status: "OPEN",
      amountValue: 7400,
      currency: "USD",
      sellerResponseDueDate: "2026-11-20T00:00:00.000Z",
      createdAt: "2026-11-05T00:00:00.000Z",
      paypal: { status: "OPEN" },
      paypalUpdatedAt: "2026-11-05T01:00:00.000Z",
      recommendation: { class: "MANDATE_COMPLIANT" },
      evidencePdf: new Uint8Array([37, 80, 68, 70]),
      evidenceBundle: { mandate_hash: "x" },
    };
    expect(await db.saveDispute(base)).toBe(true);
    expect(await db.getDispute("PP-D-RT")).toEqual(base);

    const newer = { ...base, status: "UNDER_REVIEW", paypalUpdatedAt: "2026-11-05T02:00:00.000Z" };
    expect(await db.saveDispute(newer)).toBe(true);
    expect(await db.saveDispute({ ...base, status: "STALE" })).toBe(false); // older update_time
    expect((await db.getDispute("PP-D-RT"))!.status).toBe("UNDER_REVIEW");

    await db.saveDispute({ id: "PP-D-SOON", paypal: {}, sellerResponseDueDate: "2026-11-07T00:00:00.000Z" });
    const list = await db.listDisputes({ limit: 10, offset: 0 });
    expect(list.map((d) => d.id)).toEqual(["PP-D-SOON", "PP-D-RT"]);
    expect(list[1]).toMatchObject({ hasEvidencePdf: true, recommendation: { class: "MANDATE_COMPLIANT" } });
    expect(list[1]).not.toHaveProperty("evidencePdf");
    expect(list[0]!.hasEvidencePdf).toBe(false);
    expect(await db.getDispute("PP-D-NONE")).toBeNull();
  });

  test("key registration: idempotent per kid, concurrent-safe, retirement keeps the first date", async () => {
    const jwk = { kty: "EC", crv: "P-256", x: "x".repeat(43), y: "y".repeat(43) };
    const [a, b] = await Promise.all([
      db.registerShopperKey({ kid: "shp_reg", publicJwk: jwk }),
      db.registerShopperKey({ kid: "shp_reg", publicJwk: jwk }),
    ]);
    expect(a.shopperId).toBe(b.shopperId);
    expect([a.created, b.created].sort()).toEqual([false, true]);
    expect(await db.findKey("shopper", "shp_reg")).toEqual({
      kid: "shp_reg",
      publicJwk: jwk,
      shopperId: a.shopperId,
    });

    expect(
      await db.registerAgentKey({ kid: "agt_reg", platform: "Northstar", owner: "operator", publicJwk: jwk }),
    ).toBe(true);
    expect(await db.registerAgentKey({ kid: "agt_reg", platform: "Other", owner: "x", publicJwk: jwk })).toBe(
      false,
    );
    expect(await db.findKey("agent", "agt_reg")).toMatchObject({ platform: "Northstar" });

    expect(await db.retireKey("shopper", "shp_reg", "2026-11-06T10:00:00Z")).toBe("2026-11-06T10:00:00.000Z");
    expect(await db.retireKey("shopper", "shp_reg", "2026-12-01T00:00:00Z")).toBe("2026-11-06T10:00:00.000Z");
    expect(await db.retireKey("agent", "agt_missing", "2026-11-06T10:00:00Z")).toBeNull();
  });

  test("a vault setup token is claimed once, by its own shopper, and can be released after a PayPal failure", async () => {
    const jwk = { kty: "EC", crv: "P-256", x: "x".repeat(43), y: "y".repeat(43) };
    const a = await db.registerShopperKey({ kid: "shp_vault_a", publicJwk: jwk });
    const b = await db.registerShopperKey({ kid: "shp_vault_b", publicJwk: jwk });
    await db.createVaultSetup("SETUP-A", a.shopperId);

    expect(await db.claimVaultSetup("SETUP-A", b.shopperId)).toBe(false); // someone else's token
    expect(await db.claimVaultSetup("SETUP-MISSING", a.shopperId)).toBe(false);
    const claims = await Promise.all([1, 2, 3].map(() => db.claimVaultSetup("SETUP-A", a.shopperId)));
    expect(claims.filter(Boolean)).toHaveLength(1);

    await db.releaseVaultSetup("SETUP-A"); // PayPal failed before making the payment token
    expect(await db.claimVaultSetup("SETUP-A", a.shopperId)).toBe(true);

    expect((await db.findKey("shopper", "shp_vault_a"))?.vaultId).toBeUndefined();
    await db.saveVaultId(a.shopperId, "VAULT-A1");
    expect((await db.findKey("shopper", "shp_vault_a"))?.vaultId).toBe("VAULT-A1");
    await db.saveVaultId(a.shopperId, "VAULT-A2"); // a newer wallet replaces it
    expect((await db.findKey("shopper", "shp_vault_a"))?.vaultId).toBe("VAULT-A2");
    expect((await db.findKey("shopper", "shp_vault_b"))?.vaultId).toBeUndefined();
    await db.clearVaultId(a.shopperId); // "Remove my wallet"
    expect((await db.findKey("shopper", "shp_vault_a"))?.vaultId).toBeUndefined();
  });

  test("two shoppers can hold the same PayPal wallet (the 'Use a new key' failure), counted and cleared one at a time", async () => {
    const jwk = { kty: "EC", crv: "P-256", x: "x".repeat(43), y: "y".repeat(43) };
    const oldKey = await db.registerShopperKey({ kid: "shp_old_browser_key", publicJwk: jwk });
    const newKey = await db.registerShopperKey({ kid: "shp_new_browser_key", publicJwk: jwk });
    await db.saveVaultId(oldKey.shopperId, "VAULT-SHARED");
    // This used to throw: duplicate key value violates unique constraint "shoppers_vault_id_key".
    await expect(db.saveVaultId(newKey.shopperId, "VAULT-SHARED")).resolves.toBeUndefined();
    expect((await db.findKey("shopper", "shp_new_browser_key"))?.vaultId).toBe("VAULT-SHARED");
    expect(await db.countVaultHolders("VAULT-SHARED")).toBe(2);
    await db.clearVaultId(oldKey.shopperId);
    expect(await db.countVaultHolders("VAULT-SHARED")).toBe(1);
    expect((await db.findKey("shopper", "shp_new_browser_key"))?.vaultId).toBe("VAULT-SHARED");
    await db.clearVaultId(newKey.shopperId);
    expect(await db.countVaultHolders("VAULT-SHARED")).toBe(0);
    expect(await db.countVaultHolders("VAULT-NEVER-SAVED")).toBe(0);
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

// Needs no Postgres: nothing listens on port 1, which is how an unreachable database looks to /readyz (#120).
describe("db ping", () => {
  test("rejects when the database can't be reached", async () => {
    const db = createDb("postgres://poi:poi@127.0.0.1:1/poi");
    await expect(db.ping()).rejects.toThrow();
    await db.close();
  });
});
