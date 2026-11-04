// The real API stack against the PayPal sandbox and a Postgres, for scripts. Registers throwaway
// shopper and agent keys and a fresh intent per run, so nonces and expiry never collide with older runs.
import { randomUUID } from "node:crypto";
import pg from "pg";
import type { CartMandate } from "../../packages/contracts/src/index";
import { greyJacketIntent, MERCHANT_ID } from "../../packages/contracts/src/fixtures";
import { createDb } from "../../packages/db/src/index";
import { generateSigningKeyPair, mandateHash, signMandate } from "../../packages/mandates/src/index";
import { createPayPalClient } from "../../packages/paypal/src/index";
import { buildApp } from "../../apps/api/src/app";
import { party, signedCheckout } from "../../apps/api/src/test-helpers";

export async function sandboxStack() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  const db = createDb(url);
  await db.migrate();

  const run = randomUUID().slice(0, 8);
  const shopper = await party(`sandbox-shopper-${run}`);
  const agent = await party(`sandbox-agent-${run}`);
  const raw = new pg.Pool({ connectionString: url });
  await raw.query("insert into shoppers (id) values ($1)", [`sandbox-${run}`]);
  await raw.query("insert into shopper_keys (kid, shopper_id, public_jwk) values ($1, $2, $3)", [
    shopper.kid,
    `sandbox-${run}`,
    shopper.publicJwk,
  ]);
  await raw.query(
    "insert into agent_keys (kid, platform, owner, public_jwk) values ($1, 'Northstar', 'sandbox-script', $2)",
    [agent.kid, agent.publicJwk],
  );
  await raw.end();

  const now = Date.now();
  const iso = (offsetMs: number) => new Date(now + offsetMs).toISOString();
  const intent = {
    ...greyJacketIntent,
    mandate_id: randomUUID(),
    issuer: shopper.kid,
    nonce: `sandbox-${run}-${randomUUID()}`,
    created_at: iso(-60_000),
    intent_expiry: iso(86_400_000),
    constraints: { ...greyJacketIntent.constraints, valid_from: iso(-60_000) },
  };
  // The cart must outlive a shopper logging in to approve it.
  const fresh = (c: CartMandate): CartMandate => ({
    ...c,
    contents: { ...c.contents, cart_id: `${c.contents.cart_id}-${run}`, cart_expiry: iso(3_600_000) },
  });

  const app = buildApp({
    paypal: createPayPalClient("sandbox"),
    db,
    merchant: {
      id: MERCHANT_ID,
      kid: `sandbox-merchant-${run}`,
      privateKey: (await generateSigningKeyPair()).privateKey,
    },
    now: () => new Date().toISOString(),
  });

  return {
    app,
    intent,
    fresh,
    async checkout(cart: CartMandate) {
      const { body, cart: bound } = await signedCheckout({
        shopper,
        agent,
        intent,
        cart,
        timestamp: new Date().toISOString(),
      });
      const res = (await app.inject({ method: "POST", url: "/checkout", payload: body })).json();
      return { ...res, cartMandateHash: mandateHash(bound) };
    },
    /** The shopper's countersignature (spec 0001) and stage 2. */
    async approve(orderId: string, cartMandateHash: string) {
      const approval_jws = await signMandate(
        { order_id: orderId, cart_mandate_hash: cartMandateHash, approved_at: new Date().toISOString() },
        shopper.privateKey,
        shopper.kid,
      );
      return (
        await app.inject({ method: "POST", url: `/checkout/${orderId}/approve`, payload: { approval_jws } })
      ).json();
    },
    close: () => app.close(),
  };
}
