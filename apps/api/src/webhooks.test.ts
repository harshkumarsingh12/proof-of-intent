import { describe, expect, test, vi } from "vitest";
import type { AuditEntry, Db, WebhookEventRecord } from "@poi/db";
import { createMockClient, MOCK_WEBHOOK_SIGNATURE, type PayPalClient } from "@poi/paypal";
import { buildApp } from "./app";

/** In-memory Db with the same once-only semantics as Postgres' primary key. */
function memoryDb() {
  const events = new Map<string, WebhookEventRecord>();
  const audit: AuditEntry[] = [];
  const db: Db = {
    claimNonce: async () => true,
    appendAudit: async (e) => void audit.push(e),
    auditTrail: async () => [],
    recordWebhookEvent: async (e) => (events.has(e.eventId) ? false : (events.set(e.eventId, e), true)),
    migrate: async () => [],
    close: async () => {},
  };
  return { db, events, audit };
}

const event = {
  id: "WH-58D329510W468432D-8HN650336L201105X",
  event_type: "PAYMENT.CAPTURE.COMPLETED",
  resource: {
    id: "2KY15744B4631653C",
    custom_id: "poi:0192f3a0-0000-7000-8000-000000000001:0123456789abcdef",
  },
};

const paypalHeaders = (sig = MOCK_WEBHOOK_SIGNATURE) => ({
  "content-type": "application/json",
  "paypal-transmission-id": "69cd13f0-d67a-11e5-baa3-778b53f4ae55",
  "paypal-transmission-time": "2026-11-04T10:00:00Z",
  "paypal-transmission-sig": sig,
  "paypal-cert-url": "https://api.sandbox.paypal.com/v1/notifications/certs/CERT-1",
  "paypal-auth-algo": "SHA256withRSA",
});

const deliver = (
  app: ReturnType<typeof buildApp>,
  body: string,
  headers: Record<string, string> = paypalHeaders(),
) => app.inject({ method: "POST", url: "/webhooks/paypal", headers, payload: body });

describe("POST /webhooks/paypal", () => {
  test("webhook receiver answers 400 to an unverified delivery", async () => {
    const res = await buildApp({ paypal: createMockClient(), db: memoryDb().db }).inject({
      method: "POST",
      url: "/webhooks/paypal",
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  test("a forged signature is refused and nothing is stored", async () => {
    const mem = memoryDb();
    const res = await deliver(
      buildApp({ paypal: createMockClient(), db: mem.db }),
      JSON.stringify(event),
      paypalHeaders("forged"),
    );
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("webhook_unverified");
    expect(mem.events.size).toBe(0);
    expect(mem.audit).toEqual([]);
  });

  test("a verified event is stored once even when delivered twice", async () => {
    const mem = memoryDb();
    const app = buildApp({ paypal: createMockClient(), db: mem.db });
    const first = await deliver(app, JSON.stringify(event));
    const second = await deliver(app, JSON.stringify(event));

    expect(first.statusCode).toBe(200);
    expect(first.json()).toEqual({ status: "stored" });
    expect(second.statusCode).toBe(200);
    expect(second.json()).toEqual({ status: "duplicate" });
    expect([...mem.events.values()]).toEqual([
      {
        eventId: event.id,
        eventType: "PAYMENT.CAPTURE.COMPLETED",
        resourceId: "2KY15744B4631653C",
        payload: event,
      },
    ]);
    expect(mem.audit).toEqual([
      {
        actor: "paypal",
        action: "webhook.received",
        subjectId: "2KY15744B4631653C",
        requestBody: {
          eventId: event.id,
          eventType: "PAYMENT.CAPTURE.COMPLETED",
          transmissionId: expect.any(String),
        },
      },
    ]);
  });

  test("PayPal gets the exact bytes it signed, not a re-serialized copy", async () => {
    const paypal = createMockClient();
    const spy = vi.spyOn(paypal, "verifyWebhook");
    const raw = `{"id":"WH-1",  "event_type":"X","resource":{"amount":"1.50","note":"caf\\u00e9"}}`;
    await deliver(buildApp({ paypal, db: memoryDb().db }), raw);
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ transmissionSig: MOCK_WEBHOOK_SIGNATURE }),
      raw,
    );
  });

  test("missing transmission headers, junk bodies and events without an id are 400", async () => {
    const app = buildApp({ paypal: createMockClient(), db: memoryDb().db });
    const { "paypal-transmission-sig": _sig, ...noSig } = paypalHeaders();
    expect((await deliver(app, JSON.stringify(event), noSig)).statusCode).toBe(400);
    expect((await deliver(app, "{not json")).statusCode).toBe(400);
    expect((await deliver(app, JSON.stringify({ event_type: "X" }))).statusCode).toBe(400);
  });

  test("when PayPal can't be reached to verify, answer 503 so PayPal redelivers", async () => {
    const paypal: PayPalClient = {
      ...createMockClient(),
      verifyWebhook: async () => {
        throw new Error("ECONNRESET");
      },
    };
    const mem = memoryDb();
    const res = await deliver(buildApp({ paypal, db: mem.db }), JSON.stringify(event));
    expect(res.statusCode).toBe(503);
    expect(mem.events.size).toBe(0);
  });

  test("without a database, a verified delivery is 503, not silently dropped", async () => {
    const res = await deliver(buildApp({ paypal: createMockClient() }), JSON.stringify(event));
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toBe("database_not_configured");
  });

  test("the raw-body parser is scoped: other JSON routes still parse normally", async () => {
    const res = await buildApp({ paypal: createMockClient() }).inject({
      method: "POST",
      url: "/checkout",
      payload: { hello: "world" },
    });
    expect(res.statusCode).toBe(501); // the stub, not a parser error
  });
});
