import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import {
  createMockClient,
  createPayPalClient,
  evidenceTypeFor,
  MOCK_WEBHOOK_SIGNATURE,
  parseMode,
  PayPalError,
  toPayPalAmount,
  type CreateOrderInput,
  type WebhookHeaders,
} from "./index";
import { orderBody, verifyBody } from "./sandbox";

const order: CreateOrderInput = {
  intent: "AUTHORIZE",
  ourOrderId: "ord_1",
  customId: "poi:0192f3a0-0000-7000-8000-000000000001:0123456789abcdef",
  total: { value: 7400, currency: "USD" },
  items: [
    {
      sku: "JKT-GRY-M",
      name: "Stride Running Jacket",
      unitAmount: { value: 7400, currency: "USD" },
      quantity: 1,
    },
  ],
};

const headers: WebhookHeaders = {
  transmissionId: "t-1",
  transmissionTime: "2026-11-04T10:00:00Z",
  transmissionSig: "sig",
  certUrl: "https://api.sandbox.paypal.com/v1/notifications/certs/CERT-1",
  authAlgo: "SHA256withRSA",
};

/** A recorded sandbox response from packages/paypal/fixtures/sandbox (pnpm sandbox:record-orders). */
const fixture = (name: string) =>
  JSON.parse(readFileSync(join(import.meta.dirname, "../fixtures/sandbox", `${name}.json`), "utf8")) as {
    status: number;
    body: unknown;
  };

/** A fake PayPal that serves recorded responses and keeps every request for inspection. */
function fakePayPal(routes: Record<string, { status: number; body: unknown }>) {
  const requests: {
    method: string;
    path: string;
    headers: Record<string, string>;
    body?: string | FormData;
  }[] = [];
  let tokenRequests = 0;
  const fetchFn: typeof fetch = async (url, init) => {
    const path = new URL(String(url)).pathname;
    if (path === "/v1/oauth2/token") {
      tokenRequests++;
      return Response.json({ access_token: `token-${tokenRequests}`, expires_in: 32400 });
    }
    requests.push({
      method: init?.method ?? "GET",
      path,
      headers: init?.headers as Record<string, string>,
      body: init?.body as string | FormData,
    });
    const key = Object.keys(routes).find((k) => path.endsWith(k));
    if (!key) return new Response("not routed", { status: 599 });
    const r = routes[key]!;
    return r.body === null
      ? new Response(null, { status: r.status })
      : Response.json(r.body, { status: r.status });
  };
  const client = createPayPalClient("sandbox", {
    clientId: "id",
    clientSecret: "secret",
    webhookId: "WH-1",
    fetch: fetchFn,
  });
  return { client, requests, tokenRequests: () => tokenRequests };
}

describe("mode and money", () => {
  test("defaults to mock so nobody needs credentials", () => {
    expect(parseMode(undefined)).toBe("mock");
    expect(parseMode("")).toBe("mock");
    expect(parseMode("sandbox")).toBe("sandbox");
    expect(() => parseMode("live")).toThrow();
  });

  test("sandbox mode refuses to start without credentials", () => {
    expect(() => createPayPalClient("sandbox", { clientId: "", clientSecret: "", webhookId: "" })).toThrow(
      "PAYPAL_CLIENT_ID",
    );
  });

  test("minor units become PayPal decimal strings with the currency's own exponent", () => {
    expect(toPayPalAmount({ value: 7400, currency: "USD" })).toEqual({
      currency_code: "USD",
      value: "74.00",
    });
    expect(toPayPalAmount({ value: 7405, currency: "USD" })).toEqual({
      currency_code: "USD",
      value: "74.05",
    });
    expect(toPayPalAmount({ value: 1, currency: "USD" })).toEqual({ currency_code: "USD", value: "0.01" });
    expect(toPayPalAmount({ value: 500, currency: "JPY" })).toEqual({ currency_code: "JPY", value: "500" });
  });
});

describe("order body", () => {
  test("carries the mandate pointer, our order id and item lines", () => {
    const unit = orderBody(order).purchase_units[0]!;
    expect(unit.custom_id).toBe(order.customId);
    expect(unit.invoice_id).toBe("ord_1");
    expect(unit.amount).toEqual({
      currency_code: "USD",
      value: "74.00",
      breakdown: { item_total: { currency_code: "USD", value: "74.00" } },
    });
    expect(unit.items).toEqual([
      {
        name: "Stride Running Jacket",
        sku: "JKT-GRY-M",
        quantity: "1",
        unit_amount: { currency_code: "USD", value: "74.00" },
      },
    ]);
    expect(orderBody(order)).not.toHaveProperty("payment_source");
  });

  test("agent-alone orders charge the vaulted wallet", () => {
    expect(orderBody({ ...order, intent: "CAPTURE", vaultId: "VAULT-1" }).payment_source).toEqual({
      paypal: { vault_id: "VAULT-1" },
    });
  });

  test("refuses totals that don't add up or mix currencies, rather than inventing shipping", () => {
    expect(() => orderBody({ ...order, total: { value: 7500, currency: "USD" } })).toThrow("item total");
    expect(() =>
      orderBody({ ...order, items: [{ ...order.items[0]!, unitAmount: { value: 7400, currency: "EUR" } }] }),
    ).toThrow("currency");
  });
});

describe("sandbox client against recorded sandbox responses", () => {
  test("createOrder returns the id, status and approval link, idempotent on our order id", async () => {
    const { client, requests } = fakePayPal({ "/v2/checkout/orders": fixture("create-order-created") });
    const res = await client.createOrder(order);
    expect(res.status).toBe("CREATED");
    expect(res.id).toMatch(/^[0-9A-Z]{17}$/);
    expect(res.approvalUrl).toMatch(/^https:\/\/www\.sandbox\.paypal\.com\//);
    expect(requests[0]!.headers["PayPal-Request-Id"]).toBe("ord_1");
    expect(JSON.parse(requests[0]!.body as string)).toEqual(orderBody(order));
  });

  test("captures and voids authorizations", async () => {
    const { client, requests } = fakePayPal({
      "/capture": fixture("capture-authorization"),
      "/void": fixture("void-authorization"),
    });
    const { captureId } = await client.captureAuthorization("AUTH-1");
    expect(captureId).toMatch(/^[0-9A-Z]{17}$/);
    await expect(client.voidAuthorization("AUTH-2")).resolves.toBeUndefined();
    expect(requests.map((r) => [r.path, r.headers["PayPal-Request-Id"]])).toEqual([
      ["/v2/payments/authorizations/AUTH-1/capture", "AUTH-1-capture"],
      ["/v2/payments/authorizations/AUTH-2/void", "AUTH-2-void"],
    ]);
  });

  test("a PayPal refusal becomes a PayPalError with the issue and debug id", async () => {
    const { client } = fakePayPal({ "/authorize": fixture("authorize-not-approved") });
    const err = await client.authorizeOrder("ORDER-1").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PayPalError);
    expect(err).toMatchObject({ status: 422, issue: "ORDER_NOT_APPROVED" });
    expect((err as PayPalError).debugId).toBeTruthy();
  });

  test("authorizeOrder reads the authorization id from an approved order", async () => {
    // Shape of the authorize response: the same purchase_units.payments block the sandbox returned
    // when a funded order authorized at creation.
    const { client } = fakePayPal({ "/authorize": fixture("create-order-authorized") });
    const { authorizationId } = await client.authorizeOrder("ORDER-1");
    expect(authorizationId).toMatch(/^[0-9A-Z]{17}$/);
  });

  test("one token serves many calls, and concurrent first calls share one token request", async () => {
    const fake = fakePayPal({ "/void": fixture("void-authorization") });
    await Promise.all([fake.client.voidAuthorization("A"), fake.client.voidAuthorization("B")]);
    await fake.client.voidAuthorization("C");
    expect(fake.tokenRequests()).toBe(1);
    expect(fake.requests.every((r) => r.headers.Authorization === "Bearer token-1")).toBe(true);
  });

  test("webhook verification rejects a forged signature", async () => {
    const { client } = fakePayPal({ "/verify-webhook-signature": fixture("verify-webhook-forged") });
    expect(await client.verifyWebhook(headers, '{"id":"WH-1"}')).toBe(false);
  });

  test("webhook verification passes PayPal's SUCCESS and sends the raw body byte for byte", async () => {
    const { client, requests } = fakePayPal({
      "/verify-webhook-signature": { status: 200, body: { verification_status: "SUCCESS" } },
    });
    const raw = '{"id":"WH-1",  "amount":1.50,"resource":{"note":"caf\\u00e9"}}';
    expect(await client.verifyWebhook(headers, raw)).toBe(true);
    expect((requests[0]!.body as string).endsWith(`"webhook_event":${raw}}`)).toBe(true);
    expect(JSON.parse(requests[0]!.body as string)).toMatchObject({
      webhook_id: "WH-1",
      transmission_sig: "sig",
    });
  });

  test("webhook verification: 4xx and junk bodies are 'not verified'; outages throw so PayPal redelivers", async () => {
    const bad = fakePayPal({
      "/verify-webhook-signature": { status: 400, body: { name: "VALIDATION_ERROR" } },
    });
    expect(await bad.client.verifyWebhook(headers, "{}")).toBe(false);
    expect(await bad.client.verifyWebhook(headers, "not json")).toBe(false);
    const down = fakePayPal({
      "/verify-webhook-signature": { status: 503, body: { name: "SERVICE_UNAVAILABLE" } },
    });
    await expect(down.client.verifyWebhook(headers, "{}")).rejects.toMatchObject({ status: 503 });
  });

  test("verifyBody is valid JSON with the event spliced in unchanged", () => {
    const body = verifyBody(headers, "WH-1", '{"a":1}');
    expect(JSON.parse(body)).toEqual({
      auth_algo: "SHA256withRSA",
      cert_url: headers.certUrl,
      transmission_id: "t-1",
      transmission_sig: "sig",
      transmission_time: headers.transmissionTime,
      webhook_id: "WH-1",
      webhook_event: { a: 1 },
    });
  });
});

describe("mock client", () => {
  test("mock createOrder returns a realistic order id and CREATED status", async () => {
    const res = await createMockClient().createOrder(order);
    expect(res.status).toBe("CREATED");
    expect(res.id).toMatch(/^[0-9A-Z]{17}$/);
    expect(res.approvalUrl).toContain(res.id);
  });

  test("mock authorize then capture returns a capture id", async () => {
    const mock = createMockClient();
    const { id } = await mock.createOrder(order);
    const { authorizationId } = await mock.authorizeOrder(id);
    expect((await mock.captureAuthorization(authorizationId)).captureId).toMatch(/^[0-9A-Z]{17}$/);
  });

  test("follows PayPal's rules: idempotent create, no double capture, no capture after void", async () => {
    const mock = createMockClient();
    const first = await mock.createOrder(order);
    expect(await mock.createOrder(order)).toEqual(first);
    const a = await mock.authorizeOrder(first.id);
    expect(await mock.authorizeOrder(first.id)).toEqual(a);
    await mock.captureAuthorization(a.authorizationId);
    await expect(mock.captureAuthorization(a.authorizationId)).rejects.toMatchObject({
      issue: "AUTHORIZATION_ALREADY_CAPTURED",
    });
    await expect(mock.voidAuthorization(a.authorizationId)).rejects.toMatchObject({
      issue: "AUTHORIZATION_ALREADY_CAPTURED",
    });

    const second = await mock.createOrder({ ...order, ourOrderId: "ord_2" });
    const b = await mock.authorizeOrder(second.id);
    await mock.voidAuthorization(b.authorizationId);
    await expect(mock.captureAuthorization(b.authorizationId)).rejects.toMatchObject({
      issue: "AUTHORIZATION_VOIDED",
    });
    await expect(mock.authorizeOrder("NOPE")).rejects.toMatchObject({
      status: 404,
      issue: "RESOURCE_NOT_FOUND",
    });
  });

  test("a vaulted CAPTURE order completes at once with a capture id", async () => {
    const res = await createMockClient().createOrder({ ...order, intent: "CAPTURE", vaultId: "VAULT-1" });
    expect(res).toMatchObject({ status: "COMPLETED", captureId: expect.stringMatching(/^[0-9A-Z]{17}$/) });
    expect(res.approvalUrl).toBeUndefined();
  });

  test("validates orders like the sandbox does", async () => {
    await expect(
      createMockClient().createOrder({ ...order, total: { value: 1, currency: "USD" } }),
    ).rejects.toThrow(RangeError);
  });

  test("accepts only webhooks carrying the mock signature", async () => {
    const mock = createMockClient();
    expect(await mock.verifyWebhook({ ...headers, transmissionSig: MOCK_WEBHOOK_SIGNATURE }, "{}")).toBe(
      true,
    );
    expect(await mock.verifyWebhook(headers, "{}")).toBe(false);
    expect(await mock.verifyWebhook({ ...headers, transmissionSig: MOCK_WEBHOOK_SIGNATURE }, "nope")).toBe(
      false,
    );
  });

  test("records dispute actions so tests can prove what was sent", async () => {
    const mock = createMockClient();
    await mock.provideEvidence("PP-D-1", {
      notes: "n",
      files: [{ name: "attestation.pdf", data: new Uint8Array([1]) }],
    });
    await mock.sendMessage("PP-D-1", "hello");
    expect(mock.disputeActions).toEqual([
      {
        kind: "provide-evidence",
        disputeId: "PP-D-1",
        evidenceType: "OTHER",
        notes: "n",
        files: ["attestation.pdf"],
      },
      { kind: "send-message", disputeId: "PP-D-1", message: "hello" },
    ]);
  });
});

// Against the real sandbox, only when credentials are present (never in CI).
describe.runIf(
  process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET && process.env.PAYPAL_WEBHOOK_ID,
)("live sandbox", () => {
  test("PayPal itself rejects a forged webhook signature", async () => {
    const ok = await createPayPalClient("sandbox").verifyWebhook(
      { ...headers, transmissionSig: "Zm9yZ2Vk" },
      JSON.stringify({ id: "WH-FORGED", event_type: "PAYMENT.CAPTURE.COMPLETED", resource: {} }),
    );
    expect(ok).toBe(false);
  });
});

describe("sandbox disputes", () => {
  const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]); // "%PDF-"

  test("provide-evidence sends a multipart request with the attestation PDF", async () => {
    const { client, requests } = fakePayPal({ "/provide-evidence": { status: 200, body: { links: [] } } });
    await client.provideEvidence("PP-D-1", {
      notes: "mandate attestation",
      evidenceType: "OTHER",
      files: [{ name: "attestation.pdf", data: pdf }],
    });
    const req = requests[0]!;
    expect(req.path).toBe("/v1/customer/disputes/PP-D-1/provide-evidence");
    expect(req.headers["Content-Type"]).toBeUndefined(); // fetch adds multipart/form-data with the boundary
    const form = req.body as unknown as FormData;
    const input = JSON.parse(await (form.get("input") as Blob).text());
    expect(input).toEqual({
      evidences: [
        { evidence_type: "OTHER", notes: "mandate attestation", documents: [{ name: "attestation.pdf" }] },
      ],
    });
    const file = form.get("file1") as File;
    expect(file.name).toBe("attestation.pdf");
    expect(file.type).toBe("application/pdf");
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(pdf);
  });

  test("the multipart body PayPal receives is well formed", async () => {
    const { evidenceForm } = await import("./sandbox");
    const res = new Response(evidenceForm({ notes: "n", files: [{ name: "a.pdf", data: pdf }] }));
    const text = await res.text();
    expect(res.headers.get("content-type")).toMatch(/^multipart\/form-data; boundary=/);
    expect(text).toContain('name="input"');
    expect(text).toContain('name="file1"; filename="a.pdf"');
    expect(text).toContain("Content-Type: application/pdf");
  });

  test("refuses evidence PayPal would reject: no files, non-PDF, over 10 MB", async () => {
    const { client } = fakePayPal({});
    await expect(client.provideEvidence("PP-D-1", { notes: "n", files: [] })).rejects.toThrow(
      "at least one file",
    );
    await expect(
      client.provideEvidence("PP-D-1", { notes: "n", files: [{ name: "a.png", data: pdf }] }),
    ).rejects.toThrow("PDF");
    const big = new Uint8Array(10 * 1024 * 1024 + 1);
    await expect(
      client.provideEvidence("PP-D-1", { notes: "n", files: [{ name: "a.pdf", data: big }] }),
    ).rejects.toThrow("10 MB");
  });

  test("send-message posts the message as the multipart input part", async () => {
    const { client, requests } = fakePayPal({ "/send-message": { status: 200, body: { links: [] } } });
    await client.sendMessage("PP-D-1", "Here is the signed record of your instructions.");
    expect(requests[0]!.path).toBe("/v1/customer/disputes/PP-D-1/send-message");
    const form = requests[0]!.body as unknown as FormData;
    expect(JSON.parse(await (form.get("input") as Blob).text())).toEqual({
      message: "Here is the signed record of your instructions.",
    });
  });

  test("a refused dispute action surfaces PayPal's issue", async () => {
    const { client } = fakePayPal({
      "/provide-evidence": {
        status: 422,
        body: { name: "UNPROCESSABLE_ENTITY", details: [{ issue: "NOT_ELIGIBLE" }], debug_id: "d" },
      },
    });
    await expect(
      client.provideEvidence("PP-D-1", { notes: "n", files: [{ name: "a.pdf", data: pdf }] }),
    ).rejects.toMatchObject({
      status: 422,
      issue: "NOT_ELIGIBLE",
    });
  });

  test("evidence type follows the dispute reason (spec 0004)", () => {
    expect(evidenceTypeFor("MERCHANDISE_OR_SERVICE_NOT_RECEIVED")).toBe("PROOF_OF_FULFILLMENT");
    expect(evidenceTypeFor("CREDIT_NOT_PROCESSED")).toBe("PROOF_OF_REFUND");
    expect(evidenceTypeFor("MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED")).toBe("OTHER");
    expect(evidenceTypeFor("UNAUTHORISED")).toBe("OTHER");
  });
});
