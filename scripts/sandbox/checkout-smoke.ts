// Checkout smoke test against the PayPal sandbox (docs/specs/0003, issue #20). Owner: @harshkumarsingh12.
//
//   DATABASE_URL=postgres://… pnpm sandbox:checkout-smoke     (sandbox credentials from .env)
//
// Registers a throwaway shopper and agent key, then runs journey B through the real API stack:
// the red $95 jacket must be rejected with no PayPal order, the grey $74 jacket must get a sandbox
// order whose custom_id (read back from PayPal) is the mandate pointer.
import { randomUUID } from "node:crypto";
import {
  compliantCart,
  greyJacketIntent,
  MERCHANT_ID,
  overreachingCart,
} from "../../packages/contracts/src/fixtures";
import { createDb } from "../../packages/db/src/index";
import { customId, generateSigningKeyPair, mandateHash } from "../../packages/mandates/src/index";
import { createPayPalClient, SANDBOX_BASE_URL } from "../../packages/paypal/src/index";
import { buildApp } from "../../apps/api/src/app";
import { party, signedCheckout } from "../../apps/api/src/test-helpers";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
const db = createDb(url);
await db.migrate();

const run = randomUUID().slice(0, 8);
const shopper = await party(`smoke-shopper-${run}`);
const agent = await party(`smoke-agent-${run}`);
const { default: pg } = await import("pg");
const raw = new pg.Pool({ connectionString: url });
await raw.query("insert into shoppers (id) values ($1)", [`smoke-${run}`]);
await raw.query("insert into shopper_keys (kid, shopper_id, public_jwk) values ($1, $2, $3)", [
  shopper.kid,
  `smoke-${run}`,
  shopper.publicJwk,
]);
await raw.query(
  "insert into agent_keys (kid, platform, owner, public_jwk) values ($1, 'Northstar', 'smoke', $2)",
  [agent.kid, agent.publicJwk],
);
await raw.end();

// A fresh intent per run, valid now, so nonces and expiry don't collide with earlier runs.
const now = new Date();
const intent = {
  ...greyJacketIntent,
  mandate_id: randomUUID(),
  issuer: shopper.kid,
  nonce: `smoke-${run}-${randomUUID()}`,
  created_at: new Date(now.getTime() - 60_000).toISOString(),
  intent_expiry: new Date(now.getTime() + 86_400_000).toISOString(),
  constraints: {
    ...greyJacketIntent.constraints,
    valid_from: new Date(now.getTime() - 60_000).toISOString(),
  },
};
const fresh = (c: typeof compliantCart) => ({
  ...c,
  contents: {
    ...c.contents,
    cart_id: `${c.contents.cart_id}-${run}`,
    cart_expiry: new Date(now.getTime() + 900_000).toISOString(),
  },
});

const paypal = createPayPalClient("sandbox");
const app = buildApp({
  paypal,
  db,
  merchant: {
    id: MERCHANT_ID,
    kid: `smoke-merchant-${run}`,
    privateKey: (await generateSigningKeyPair()).privateKey,
  },
  now: () => new Date().toISOString(),
});

const post = async (cart: typeof compliantCart) => {
  const { body } = await signedCheckout({
    shopper,
    agent,
    intent,
    cart,
    timestamp: new Date().toISOString(),
  });
  return (await app.inject({ method: "POST", url: "/checkout", payload: body })).json();
};

const red = await post(fresh(overreachingCart));
console.log(
  "red $95 jacket:",
  red.verdict.outcome,
  red.verdict.reasons.join(", "),
  "| paypal order:",
  red.paypal_order_id ?? "none",
);

const grey = await post(fresh(compliantCart));
console.log(
  "grey $74 jacket:",
  grey.verdict.outcome,
  grey.verdict.reasons.join(", ") || "-",
  "| paypal order:",
  grey.paypal_order_id,
);

// Read the order back from PayPal itself.
const id = process.env.PAYPAL_CLIENT_ID!;
const secret = process.env.PAYPAL_CLIENT_SECRET!;
const token = (await (
  await fetch(`${SANDBOX_BASE_URL}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  })
).json()) as { access_token: string };
const order = (await (
  await fetch(`${SANDBOX_BASE_URL}/v2/checkout/orders/${grey.paypal_order_id}`, {
    headers: { Authorization: `Bearer ${token.access_token}` },
  })
).json()) as { status: string; intent: string; purchase_units: { custom_id: string; invoice_id: string }[] };
const unit = order.purchase_units[0]!;
const expected = customId(intent.mandate_id, mandateHash(intent));
console.log(
  "on PayPal:",
  order.intent,
  order.status,
  "| custom_id",
  unit.custom_id,
  unit.custom_id === expected ? "(matches the mandate pointer)" : `(EXPECTED ${expected})`,
  "| invoice_id",
  unit.invoice_id,
);
await app.close();
