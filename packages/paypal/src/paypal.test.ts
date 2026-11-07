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
import { toolkitDisputes, type ToolkitTool } from "./agent-toolkit";
import { orderBody, vaultSetupBody, verifyBody } from "./sandbox";

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
    await mock.acceptClaim("PP-D-2", "refund");
    expect(mock.disputeActions).toEqual([
      {
        kind: "provide-evidence",
        disputeId: "PP-D-1",
        evidenceType: "OTHER",
        notes: "n",
        files: ["attestation.pdf"],
      },
      { kind: "send-message", disputeId: "PP-D-1", message: "hello" },
      { kind: "accept-claim", disputeId: "PP-D-2", note: "refund" },
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

  test("escalate posts the note as JSON (plain REST: not an Agent Toolkit tool)", async () => {
    const { client, requests } = fakePayPal({ "/escalate": { status: 200, body: { links: [] } } });
    await client.escalate("PP-D-1", "Escalating to provide the signed record");
    expect(requests[0]!.path).toBe("/v1/customer/disputes/PP-D-1/escalate");
    expect(JSON.parse(requests[0]!.body as string)).toEqual({
      note: "Escalating to provide the signed record",
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

/** Fake Agent Toolkit tools with the real contract: execute resolves to a JSON string, errors included. */
function fakeToolkit(answers: Record<string, unknown>) {
  const calls: { name: string; args: unknown }[] = [];
  const tools: Record<string, ToolkitTool> = {};
  for (const [name, answer] of Object.entries(answers)) {
    tools[name] = {
      execute: (async (args: unknown) => {
        calls.push({ name, args });
        return JSON.stringify(answer);
      }) as ToolkitTool["execute"],
    };
  }
  return { disputes: toolkitDisputes(tools), calls };
}

describe("Agent Toolkit transport (sandbox disputes and tracking)", () => {
  test("the sandbox client sends accept-claim, dispute reads and tracking through the toolkit", async () => {
    const { disputes, calls } = fakeToolkit({
      get_dispute: { dispute_id: "PP-D-1", status: "UNDER_REVIEW" },
      list_disputes: { items: [{ dispute_id: "PP-D-1", update_time: "2026-11-06T00:00:00Z" }] },
      accept_dispute_claim: { links: [] },
      create_shipment_tracking: { tracker_identifiers: [{ transaction_id: "CAP-1" }], errors: [] },
    });
    const client = createPayPalClient("sandbox", {
      clientId: "id",
      clientSecret: "secret",
      webhookId: "WH-1",
      fetch: async () => new Response("no fetch expected", { status: 599 }),
      toolkit: disputes,
    });
    expect(await client.getDispute("PP-D-1")).toEqual({ dispute_id: "PP-D-1", status: "UNDER_REVIEW" });
    expect(await client.listDisputes()).toEqual([
      { dispute_id: "PP-D-1", update_time: "2026-11-06T00:00:00Z" },
    ]);
    await client.acceptClaim("PP-D-1", "Agent bought outside the signed budget; refunding.");
    await client.addTracking({
      captureId: "CAP-1",
      trackingNumber: "9400100000000000000000",
      carrier: "USPS",
    });
    expect(calls).toEqual([
      { name: "get_dispute", args: { dispute_id: "PP-D-1" } },
      { name: "list_disputes", args: { page_size: 50 } },
      {
        name: "accept_dispute_claim",
        args: { dispute_id: "PP-D-1", note: "Agent bought outside the signed budget; refunding." },
      },
      {
        name: "create_shipment_tracking",
        args: {
          transaction_id: "CAP-1",
          tracking_number: "9400100000000000000000",
          carrier: "USPS",
          status: "SHIPPED",
        },
      },
    ]);
  });

  test("a PayPal error inside the toolkit's JSON becomes a PayPalError with its status", async () => {
    const { disputes } = fakeToolkit({
      accept_dispute_claim: {
        ok: false,
        status: 422,
        code: "PAYPAL_API_HTTP_ERROR",
        message: "Unprocessable Entity: NOT_ELIGIBLE",
      },
      get_dispute: { error: { message: "boom", type: "paypal_error" } },
    });
    await expect(disputes.acceptClaim("PP-D-1", "n")).rejects.toMatchObject({
      status: 422,
      issue: "NOT_ELIGIBLE",
    });
    await expect(disputes.getDispute("PP-D-1")).rejects.toBeInstanceOf(PayPalError);
  });

  test("a tracker refused inside a 200 batch answer is an error, not a success", async () => {
    const { disputes } = fakeToolkit({
      create_shipment_tracking: {
        tracker_identifiers: [],
        errors: [{ message: "Invalid transaction", details: [{ issue: "INVALID_TRANSACTION_ID" }] }],
      },
    });
    await expect(
      disputes.addTracking({ captureId: "CAP-X", trackingNumber: "1", carrier: "USPS" }),
    ).rejects.toMatchObject({ status: 422, issue: "INVALID_TRANSACTION_ID" });
  });

  test("a token or DNS failure is retried (nothing reached PayPal); a PayPal refusal is not", async () => {
    let calls = 0;
    const flaky: Record<string, ToolkitTool> = {
      accept_dispute_claim: {
        execute: (async () => {
          calls++;
          return JSON.stringify(
            calls === 1
              ? {
                  error: {
                    message: "Failed to fetch access token: getaddrinfo EAI_AGAIN api.sandbox.paypal.com",
                    type: "paypal_error",
                  },
                }
              : { links: [] },
          );
        }) as ToolkitTool["execute"],
      },
      get_dispute: {
        execute: (async () => {
          calls++;
          return JSON.stringify({
            ok: false,
            status: 422,
            code: "PAYPAL_API_HTTP_ERROR",
            message: "NOT_ELIGIBLE",
          });
        }) as ToolkitTool["execute"],
      },
    };
    await toolkitDisputes(flaky).acceptClaim("PP-D-1", "note");
    expect(calls).toBe(2);
    calls = 0;
    await expect(toolkitDisputes(flaky).getDispute("PP-D-1")).rejects.toMatchObject({ status: 422 });
    expect(calls).toBe(1);
  });

  test("the sandbox client retries its own token request on a network error", async () => {
    let tokenTries = 0;
    const client = createPayPalClient("sandbox", {
      clientId: "id",
      clientSecret: "secret",
      webhookId: "WH-1",
      fetch: async (url) => {
        if (String(url).endsWith("/v1/oauth2/token")) {
          tokenTries++;
          if (tokenTries === 1) throw new TypeError("fetch failed (getaddrinfo EAI_AGAIN)");
          return Response.json({ access_token: "t", expires_in: 32400 });
        }
        return Response.json({ links: [] });
      },
    });
    await client.sendMessage("PP-D-1", "hello");
    expect(tokenTries).toBe(2);
  });

  test("a tool that isn't enabled fails loudly", async () => {
    await expect(toolkitDisputes({}).getDispute("PP-D-1")).rejects.toThrow("not enabled");
  });

  test("mock: seeded disputes are readable, unknown ones are 404, tracking is recorded", async () => {
    const mock = createMockClient();
    await expect(mock.getDispute("PP-D-9")).rejects.toMatchObject({ status: 404 });
    mock.seedDispute({ dispute_id: "PP-D-9", status: "OPEN", update_time: "2026-11-06T00:00:00Z" });
    expect(await mock.getDispute("PP-D-9")).toMatchObject({ status: "OPEN" });
    expect(await mock.listDisputes()).toEqual([
      { dispute_id: "PP-D-9", status: "OPEN", update_time: "2026-11-06T00:00:00Z" },
    ]);
    await mock.addTracking({ captureId: "CAP-1", trackingNumber: "T1", carrier: "UPS" });
    expect(mock.disputeActions.at(-1)).toEqual({
      kind: "add-tracking",
      captureId: "CAP-1",
      trackingNumber: "T1",
      carrier: "UPS",
      status: "SHIPPED",
    });
  });
});

describe("Vault v3 wallet saving", () => {
  test("the setup token asks for a MERCHANT wallet and comes back with PayPal's approval link", async () => {
    const { client, requests } = fakePayPal({
      "/v3/vault/setup-tokens": {
        status: 200,
        body: {
          id: "SETUP-1",
          status: "PAYER_ACTION_REQUIRED",
          links: [
            { rel: "self", href: "https://api-m.sandbox.paypal.com/v3/vault/setup-tokens/SETUP-1" },
            {
              rel: "approve",
              href: "https://www.sandbox.paypal.com/agreements/approve?approval_session_id=SETUP-1",
            },
          ],
        },
      },
    });
    const res = await client.createVaultSetupToken({
      returnUrl: "https://shop.example/shop/wallet",
      cancelUrl: "https://shop.example/shop",
    });
    expect(res).toEqual({
      setupTokenId: "SETUP-1",
      approvalUrl: "https://www.sandbox.paypal.com/agreements/approve?approval_session_id=SETUP-1",
    });
    const sent = JSON.parse(requests[0]!.body as string);
    expect(sent).toEqual(vaultSetupBody("https://shop.example/shop/wallet", "https://shop.example/shop"));
    expect(sent.payment_source.paypal.usage_type).toBe("MERCHANT");
    expect(requests[0]!.headers["PayPal-Request-Id"]).toBeTruthy();
  });

  test("a setup token with no approval link is an error, not a dead end for the shopper", async () => {
    const { client } = fakePayPal({ "/v3/vault/setup-tokens": { status: 200, body: { id: "SETUP-2" } } });
    await expect(
      client.createVaultSetupToken({ returnUrl: "https://a.example/r", cancelUrl: "https://a.example/c" }),
    ).rejects.toThrow("no approval link");
  });

  test("the payment token is made from the approved setup token, and its id is the vault id", async () => {
    const { client, requests } = fakePayPal({
      "/v3/vault/payment-tokens": { status: 200, body: { id: "VAULT-9", status: "CREATED" } },
    });
    expect(await client.createVaultPaymentToken("SETUP-1")).toEqual({ vaultId: "VAULT-9" });
    expect(JSON.parse(requests[0]!.body as string)).toEqual({
      payment_source: { token: { id: "SETUP-1", type: "SETUP_TOKEN" } },
    });
    expect(requests[0]!.headers["PayPal-Request-Id"]).toBe("SETUP-1-payment-token");
  });

  test("PayPal refusing an unapproved setup token surfaces as a PayPalError", async () => {
    const { client } = fakePayPal({
      "/v3/vault/payment-tokens": {
        status: 422,
        body: { name: "UNPROCESSABLE_ENTITY", details: [{ issue: "SETUP_TOKEN_NOT_APPROVED" }] },
      },
    });
    await expect(client.createVaultPaymentToken("SETUP-3")).rejects.toMatchObject({
      status: 422,
      issue: "SETUP_TOKEN_NOT_APPROVED",
    });
  });

  test("mock: approval sends the shopper straight back with the setup token, which converts once", async () => {
    const mock = createMockClient();
    const setup = await mock.createVaultSetupToken({
      returnUrl: "https://shop.example/shop/wallet",
      cancelUrl: "https://shop.example/shop",
    });
    const back = new URL(setup.approvalUrl);
    expect(back.origin + back.pathname).toBe("https://shop.example/shop/wallet");
    expect(back.searchParams.get("approval_token_id")).toBe(setup.setupTokenId);

    const { vaultId } = await mock.createVaultPaymentToken(setup.setupTokenId);
    expect(vaultId).toMatch(/^[A-Z0-9]{17}$/);
    await expect(mock.createVaultPaymentToken(setup.setupTokenId)).rejects.toMatchObject({
      issue: "SETUP_TOKEN_ALREADY_USED",
    });
    await expect(mock.createVaultPaymentToken("NOPE")).rejects.toMatchObject({ status: 404 });
    // ...and the vault id charges at once, as in agent-alone checkout.
    expect((await mock.createOrder({ ...order, intent: "CAPTURE", vaultId })).status).toBe("COMPLETED");
  });
});
