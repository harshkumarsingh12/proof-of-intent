import { Writable } from "node:stream";
import { beforeAll, describe, expect, test } from "vitest";
import type { SemanticFit } from "@poi/ai";
import { MERCHANT_ID, NOW, partialCart } from "@poi/contracts/fixtures";
import { generateSigningKeyPair } from "@poi/mandates";
import { createMockClient, MOCK_WEBHOOK_SIGNATURE } from "@poi/paypal";
import { buildApp } from "./app";
import { redactUrl } from "./logging";
import { memoryDb, party, signedCheckout, type Party } from "./test-helpers";

/** A stream that keeps what the app logs, one parsed line per entry. */
function capture() {
  const raw: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, done) {
      raw.push(...chunk.toString().split("\n").filter(Boolean));
      done();
    },
  });
  return { stream, text: () => raw.join("\n"), entries: () => raw.map((l) => JSON.parse(l) as Record<string, unknown>) };
}

const TOKEN = "SECRETTOKEN_Zk3pQ9vL2mXw7aRtB5nYc8dFgH1jKe4U";

describe("what the API logs (SECURITY.md: no secrets in logs)", () => {
  test("redactUrl hides only the step-up token and leaves every other path alone", () => {
    expect(redactUrl(`/stepup/${TOKEN}`)).toBe("/stepup/[redacted]");
    expect(redactUrl(`/stepup/${TOKEN}/approve`)).toBe("/stepup/[redacted]/approve");
    expect(redactUrl(`/stepup/${TOKEN}?x=1`)).toBe("/stepup/[redacted]?x=1");
    for (const path of ["/stepup/view", "/stepup/approve", "/stepup/approve?x=1", "/stepups/pending", "/stepups/stp_1/approve", "/checkout/ord_1/approve", "/healthz", "/readyz"]) {
      expect(redactUrl(path)).toBe(path);
    }
  });

  test("a step-up token sent in the body, the way the approval page sends it (#257), is not in the request log", async () => {
    const log = capture();
    const app = buildApp({ paypal: createMockClient(), db: memoryDb().db, logStream: log.stream });
    await app.inject({ method: "POST", url: "/stepup/view", payload: { token: TOKEN } });
    await app.inject({ method: "POST", url: "/stepup/approve", payload: { token: TOKEN, approval_jws: "a.b.c" } });
    await app.close();
    expect(log.text()).not.toContain(TOKEN);
    const urls = log.entries().flatMap((e) => (e.req as { url?: string } | undefined)?.url ?? []);
    expect(urls).toEqual(["/stepup/view", "/stepup/approve"]);
  });

  test("a step-up link's token in an old-style path is still not in the request log, for the view or the approval", async () => {
    const log = capture();
    const app = buildApp({ paypal: createMockClient(), db: memoryDb().db, logStream: log.stream });
    await app.inject({ method: "GET", url: `/stepup/${TOKEN}` });
    await app.inject({ method: "POST", url: `/stepup/${TOKEN}/approve`, payload: { approval_jws: "a.b.c" } });
    await app.close();
    expect(log.text()).not.toContain(TOKEN);
    const urls = log.entries().flatMap((e) => (e.req as { url?: string } | undefined)?.url ?? []);
    expect(urls).toEqual(["/stepup/[redacted]", "/stepup/[redacted]/approve"]);
    // The rest of the request log is kept: method, host, address and the response status.
    const first = log.entries().find((e) => e.req) as { req: Record<string, unknown> };
    expect(first.req).toMatchObject({ method: "GET", host: expect.any(String), remoteAddress: expect.any(String) });
    expect(log.entries().some((e) => (e.res as { statusCode?: number } | undefined)?.statusCode === 410)).toBe(true);
  });
});

describe("the step-up link written when a cart is held", () => {
  let shopper: Party, agent: Party, merchantKey: Awaited<ReturnType<typeof generateSigningKeyPair>>;
  beforeAll(async () => {
    shopper = await party("shopper-key-1");
    agent = await party("agent-key-1");
    merchantKey = await generateSigningKeyPair();
  });
  const partial = async (): Promise<SemanticFit> => ({
    fit: "partial",
    confidence: 0.9,
    reasons: [],
    matched_attributes: [],
    conflicting_attributes: [],
  });

  /** An agent-alone checkout that steps up, with the app's own default link delivery. */
  async function heldCart() {
    const log = capture();
    const mem = memoryDb();
    mem.keys.set(shopper.kid, { kind: "shopper", kid: shopper.kid, publicJwk: shopper.publicJwk, shopperId: "s1" });
    mem.keys.set(agent.kid, { kind: "agent", kid: agent.kid, publicJwk: agent.publicJwk, platform: "Northstar" });
    const app = buildApp({
      paypal: createMockClient(),
      db: mem.db,
      merchant: { id: MERCHANT_ID, kid: "m1", privateKey: merchantKey.privateKey },
      semanticFit: partial,
      now: () => NOW,
      logStream: log.stream,
    });
    // Valid for days, so the 24 h link limit is what applies.
    const cart = { ...partialCart, contents: { ...partialCart.contents, cart_expiry: "2026-11-05T00:00:00Z" } };
    const { body } = await signedCheckout({ shopper, agent, cart, humanPresent: false });
    const res = await app.inject({ method: "POST", url: "/checkout", payload: body });
    await app.close();
    return { log, verdict: res.json().verdict };
  }

  test("by default the link, which carries a secret, is not logged", async () => {
    const { log, verdict } = await heldCart();
    expect(verdict.outcome).toBe("STEP_UP");
    expect(log.text()).toContain("step-up created");
    expect(log.text()).not.toMatch(/\/approve[#/][A-Za-z0-9_-]{20,}/);
    expect(log.text()).not.toContain("localhost:3001/approve");
    // What is useful stays: which step-up, for whom and until when.
    const row = log.entries().find((e) => e.stepUpId);
    expect(row).toMatchObject({ stepUpId: expect.stringMatching(/^stp_/), expiresAt: expect.any(String) });
    expect(row?.url).toBeUndefined();
  });

  test("LOG_STEPUP_LINKS=1 logs it, for local development without an email provider", async () => {
    process.env.LOG_STEPUP_LINKS = "1";
    try {
      const { log } = await heldCart();
      expect(log.text()).toMatch(/\/approve#[A-Za-z0-9_-]{20,}/);
    } finally {
      delete process.env.LOG_STEPUP_LINKS;
    }
  });
});

describe("a forged webhook signature", () => {
  test("is refused with 400 and is logged as a warning, without the forged signature or the body", async () => {
    const log = capture();
    const app = buildApp({ paypal: createMockClient(), db: memoryDb().db, logStream: log.stream });
    const event = { id: "WH-1", event_type: "PAYMENT.CAPTURE.COMPLETED", resource: { id: "CAP-1" } };
    const res = await app.inject({
      method: "POST",
      url: "/webhooks/paypal",
      headers: {
        "content-type": "application/json",
        "paypal-transmission-id": "t-1",
        "paypal-transmission-time": "2026-11-04T10:00:00Z",
        "paypal-transmission-sig": "forged-signature-value",
        "paypal-cert-url": "https://api.sandbox.paypal.com/v1/notifications/certs/CERT-1",
        "paypal-auth-algo": "SHA256withRSA",
      },
      payload: JSON.stringify(event),
    });
    await app.close();
    expect(res.statusCode).toBe(400);
    const warning = log.entries().find((e) => e.msg === "rejected unverified webhook");
    expect(warning).toMatchObject({ level: 40, eventId: "WH-1", eventType: "PAYMENT.CAPTURE.COMPLETED" });
    expect(log.text()).not.toContain("forged-signature-value");
    expect(log.text()).not.toContain("CAP-1"); // the resource id and body stay out of the log

    // And a genuine delivery is not warned about.
    const ok = capture();
    const app2 = buildApp({ paypal: createMockClient(), db: memoryDb().db, logStream: ok.stream });
    await app2.inject({
      method: "POST",
      url: "/webhooks/paypal",
      headers: {
        "content-type": "application/json",
        "paypal-transmission-id": "t-2",
        "paypal-transmission-time": "2026-11-04T10:00:00Z",
        "paypal-transmission-sig": MOCK_WEBHOOK_SIGNATURE,
        "paypal-cert-url": "https://api.sandbox.paypal.com/v1/notifications/certs/CERT-1",
        "paypal-auth-algo": "SHA256withRSA",
      },
      payload: JSON.stringify(event),
    });
    await app2.close();
    expect(ok.entries().some((e) => e.msg === "rejected unverified webhook")).toBe(false);
  });
});
