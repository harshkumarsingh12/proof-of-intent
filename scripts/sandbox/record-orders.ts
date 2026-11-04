// Records real PayPal sandbox responses as fixtures for CI (docs/specs/0004, acceptance criterion 2).
// Owner: @harshkumarsingh12.
//
//   pnpm sandbox:record-orders     (needs PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_WEBHOOK_ID in .env)
//
// Runs the order lifecycle through the production client and writes every PayPal response to
// packages/paypal/fixtures/sandbox/. Card funding is a sandbox-only trick to authorize without a
// shopper clicking through PayPal; it lives here, never in the client.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createPayPalClient, PayPalError, type CreateOrderInput } from "../../packages/paypal/src/index";

const OUT = join(import.meta.dirname, "../../packages/paypal/fixtures/sandbox");
// PayPal's published sandbox Visa; it never charges anything.
const TEST_CARD = { number: "4032039317984658", expiry: "2030-12", name: "Test Shopper" };

let fundWithCard = false;
const recorded: Record<string, unknown> = {};
let nextName = "";

const recordingFetch: typeof fetch = async (url, init) => {
  const path = new URL(String(url)).pathname;
  let body = init?.body;
  if (fundWithCard && path === "/v2/checkout/orders" && typeof body === "string") {
    body = JSON.stringify({ ...JSON.parse(body), payment_source: { card: TEST_CARD } });
  }
  const res = await fetch(url, { ...init, body });
  if (path === "/v1/oauth2/token") return res; // never write a token to disk
  const text = await res.text();
  recorded[nextName] = { status: res.status, body: text ? sanitize(JSON.parse(text)) : null };
  return new Response(text || null, { status: res.status, headers: res.headers });
};

/** Strips account identifiers so fixtures are safe in a public repo. */
function sanitize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => {
        if (k === "email_address") return [k, "redacted@example.com"];
        if (k === "merchant_id" || k === "payer_id" || k === "account_id") return [k, "REDACTEDID000"];
        return [k, sanitize(v)];
      }),
    );
  }
  return value;
}

const client = createPayPalClient("sandbox", { fetch: recordingFetch });
const runId = Date.now().toString(36);
const order = (n: string): CreateOrderInput => ({
  intent: "AUTHORIZE",
  ourOrderId: `ord_fixture_${runId}_${n}`,
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
});
const authorizationOf = (name: string) =>
  (recorded[name] as { body: { purchase_units: { payments: { authorizations: { id: string }[] } }[] } }).body
    .purchase_units[0]!.payments.authorizations[0]!.id;

// 1. Human-present order before the shopper approves.
nextName = "create-order-created";
const created = await client.createOrder(order("a"));
console.log(
  "created",
  created.id,
  created.status,
  created.approvalUrl ? "with approval url" : "NO approval url",
);

// 2. Authorizing before approval is refused.
nextName = "authorize-not-approved";
await client.authorizeOrder(created.id).then(
  () => console.log("UNEXPECTED: authorized an unapproved order"),
  (e: PayPalError) => console.log("authorize before approval:", e.status, e.issue),
);

// 3. A funded authorization, then capture.
fundWithCard = true;
nextName = "create-order-authorized";
await client.createOrder(order("b"));
nextName = "capture-authorization";
console.log(
  "captured",
  (await client.captureAuthorization(authorizationOf("create-order-authorized"))).captureId,
);

// 4. Capturing twice is refused.
nextName = "capture-retry-idempotent";
await client.captureAuthorization(authorizationOf("create-order-authorized")).then(
  () => console.log("capture retry returned the same capture (idempotent request id)"),
  (e: PayPalError) => console.log("second capture:", e.status, e.issue),
);

// 5. Another authorization, voided.
nextName = "create-order-authorized-2";
await client.createOrder(order("c"));
nextName = "void-authorization";
await client.voidAuthorization(authorizationOf("create-order-authorized-2"));
console.log("voided");
fundWithCard = false;

// 6. A forged webhook delivery.
nextName = "verify-webhook-forged";
const ok = await client.verifyWebhook(
  {
    transmissionId: "69cd13f0-d67a-11e5-baa3-778b53f4ae55",
    transmissionTime: new Date().toISOString(),
    transmissionSig: "Zm9yZ2Vk",
    certUrl: "https://api.sandbox.paypal.com/v1/notifications/certs/CERT-360caa42-fca2a594-a5cafa77",
    authAlgo: "SHA256withRSA",
  },
  JSON.stringify({ id: "WH-FORGED", event_type: "PAYMENT.CAPTURE.COMPLETED", resource: {} }),
);
console.log("forged webhook verified:", ok);

mkdirSync(OUT, { recursive: true });
for (const [name, value] of Object.entries(recorded)) {
  writeFileSync(join(OUT, `${name}.json`), JSON.stringify(value, null, 2) + "\n");
}
console.log(`wrote ${Object.keys(recorded).length} fixtures to packages/paypal/fixtures/sandbox/`);
