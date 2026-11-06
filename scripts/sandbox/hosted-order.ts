// One compliant order through a deployed API, over HTTP only (no database access): registers a fresh shopper
// key (public route) and agent key (operator route), checks out, waits for the shopper's PayPal approval,
// then sends the countersignature for stage 2 capture.
//
//   POI_API_URL=https://poi-api.iotkiit.in OPERATOR_TOKEN=… pnpm sandbox:hosted-order
//
// The order then lives in that server's database, so a dispute on it is classified there (not NO_MANDATE).
import { randomUUID } from "node:crypto";
import { compliantCart, greyJacketIntent } from "../../packages/contracts/src/fixtures";
import { generateSigningKeyPair, mandateHash, signMandate } from "../../packages/mandates/src/index";
import { signedCheckout, type Party } from "../../apps/api/src/test-helpers";
import { exportJWK } from "jose";

const api = (process.env.POI_API_URL ?? "https://poi-api.iotkiit.in").replace(/\/$/, "");
const token = process.env.OPERATOR_TOKEN;
if (!token) throw new Error("OPERATOR_TOKEN is required (agent keys are registered by the operator)");

async function post(path: string, body: unknown, auth = false) {
  const res = await fetch(`${api}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(auth ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

async function register(kind: "shopper" | "agent"): Promise<Party> {
  const { privateKey, publicKey } = await generateSigningKeyPair();
  const publicJwk = await exportJWK(publicKey);
  const res = await post(`/keys/${kind}`, { public_jwk: publicJwk, platform: "Northstar" }, kind === "agent");
  if (res.status >= 300) throw new Error(`register ${kind} key → ${res.status} ${JSON.stringify(res.body)}`);
  console.log(`${kind} key ${res.body.kid}${res.body.shopper_id ? ` (${res.body.shopper_id})` : ""}`);
  return {
    kid: res.body.kid as string,
    privateKey,
    publicJwk: publicJwk as unknown as Record<string, unknown>,
  };
}

const shopper = await register("shopper");
const agent = await register("agent");

const now = Date.now();
const iso = (offsetMs: number) => new Date(now + offsetMs).toISOString();
const run = randomUUID().slice(0, 8);
const intent = {
  ...greyJacketIntent,
  mandate_id: randomUUID(),
  issuer: shopper.kid,
  nonce: `hosted-${run}-${randomUUID()}`,
  created_at: iso(-60_000),
  intent_expiry: iso(86_400_000),
  constraints: { ...greyJacketIntent.constraints, valid_from: iso(-60_000) },
};
// The cart must outlive a shopper logging in to approve it.
const cart = {
  ...compliantCart,
  contents: { ...compliantCart.contents, cart_id: `cart-hosted-${run}`, cart_expiry: iso(3_600_000) },
};
const { body, cart: bound } = await signedCheckout({
  shopper,
  agent,
  intent,
  cart,
  timestamp: new Date().toISOString(),
});
const checkout = await post("/checkout", body);
const verdict = checkout.body.verdict as { outcome: string; reasons: string[] } | undefined;
console.log(`checkout → ${checkout.status} ${verdict?.outcome} ${verdict?.reasons.join(",") ?? ""}`);
if (!checkout.body.approval_url) throw new Error(`no order: ${JSON.stringify(checkout.body)}`);
const orderId = checkout.body.order_id as string;
console.log(`order ${orderId}\napprove as the sandbox shopper: ${checkout.body.approval_url}`);

// Stage 2 answers 409 shopper_has_not_approved until PayPal has the approval; nothing is charged meanwhile.
const deadline = Date.now() + 9 * 60_000;
for (;;) {
  const approval_jws = await signMandate(
    { order_id: orderId, cart_mandate_hash: mandateHash(bound), approved_at: new Date().toISOString() },
    shopper.privateKey,
    shopper.kid,
  );
  const res = await post(`/checkout/${orderId}/approve`, { approval_jws });
  if (res.status !== 409 || res.body.error !== "shopper_has_not_approved") {
    console.log(`stage 2 → ${res.status} ${JSON.stringify(res.body)}`);
    break;
  }
  if (Date.now() > deadline) throw new Error("no approval within 9 minutes; the order stays uncaptured");
  await new Promise((r) => setTimeout(r, 10_000));
}
