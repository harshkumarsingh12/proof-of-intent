import { exportJWK } from "jose";
import pg from "pg";
import { compliantCart, greyJacketIntent, overreachingCart } from "../../packages/contracts/src/fixtures";
import { createDb } from "../../packages/db/src/index";
import {
  canonicalJson,
  customId,
  generateSigningKeyPair,
  keyIdFor,
  mandateHash,
  signMandate,
} from "../../packages/mandates/src/index";
import { runDisputeClassifier } from "../../apps/worker/src/classifier";
import { buildConstraintChecks, draftEvidenceForDefend } from "../../apps/worker/src/evidence";

const platforms = ["Northstar", "Wayfinder", "Errandly", "Tote"];
const hour = 3_600_000;
const marker = "proof-of-intent-demo-v1";
const seedLock = 7_007_041;

/** Seed one isolated mock database. A retry after success leaves the dataset and deadlines intact. */
export async function seedDemo(databaseUrl: string, mode = "mock", now = new Date()): Promise<boolean> {
  if (mode !== "mock") throw new Error("Demo seeding requires PAYPAL_MODE=mock.");
  const url = new URL(databaseUrl);
  if (
    url.searchParams.has("host") ||
    !["localhost", "127.0.0.1", "[::1]", "postgres"].includes(url.hostname)
  ) {
    throw new Error("Demo seeding requires a local or Compose Postgres database.");
  }

  const db = createDb(databaseUrl);
  try {
    await db.migrate();
  } finally {
    await db.close();
  }

  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock($1)", [seedLock]);
    const {
      rows: [state],
    } = await client.query<{ seeded: boolean; occupied: boolean }>(
      `
      select exists(select 1 from audit_log where actor = 'demo-seed' and subject_id = $1) as seeded,
        exists(select 1 from orders) or exists(select 1 from disputes) or exists(select 1 from verdicts)
        or exists(select 1 from audit_log) or exists(select 1 from mandates) or exists(select 1 from nonces)
        or exists(select 1 from webhook_events) or exists(select 1 from shoppers)
        or exists(select 1 from agent_keys) as occupied`,
      [marker],
    );
    if (state!.seeded) {
      await client.query("commit");
      return false;
    }
    if (state!.occupied) throw new Error("Demo seeding requires an empty database.");

    await insertDemo(client, now);
    await client.query(
      "insert into audit_log (actor, action, subject_id) values ('demo-seed', 'demo.seeded', $1)",
      [marker],
    );
    await client.query("commit");
    return true;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    await client.end();
  }
}

async function insertDemo(client: pg.Client, now: Date): Promise<void> {
  const shopper = await generateSigningKeyPair();
  const merchant = await generateSigningKeyPair();
  const publicKey = await exportJWK(shopper.publicKey);
  const shopperKid = await keyIdFor("shp", publicKey);
  const merchantKid = "demo-merchant";
  const shopperId = "shopper-demo";
  await client.query("insert into shoppers (id) values ($1)", [shopperId]);
  await client.query("insert into shopper_keys (kid, shopper_id, public_jwk) values ($1, $2, $3)", [
    shopperKid,
    shopperId,
    publicKey,
  ]);

  const iso = (offsetMs: number) => new Date(now.getTime() + offsetMs).toISOString();
  for (let index = 0; index < 300; index++) {
    const suffix = String(index + 1).padStart(12, "0");
    const orderId = `ord_0192f3a1-0000-7000-8000-${suffix}`;
    const createdAt = iso(-((index + 4) * hour) - 300_000);
    const capturedAt = iso(-(index + 4) * hour);
    const disputed = index < 24;
    const overreach = disputed && index % 5 === 1;
    const template = overreach ? overreachingCart : compliantCart;
    const intent = {
      ...greyJacketIntent,
      mandate_id: `0192f3a0-0000-7000-8000-${suffix}`,
      nonce: `demo-nonce-${suffix}`,
      issuer: shopperKid,
      created_at: createdAt,
      intent_expiry: iso(-(index + 3) * hour),
      constraints: { ...greyJacketIntent.constraints, valid_from: createdAt },
    };
    const intentHash = mandateHash(intent);
    const cart = {
      ...template,
      contents: {
        ...template.contents,
        cart_id: `cart-demo-${suffix}`,
        cart_expiry: iso(-((index + 4) * hour) + 600_000),
      },
      intent_mandate_id: intent.mandate_id,
      intent_mandate_hash: intentHash,
    };
    const intentJws = await signMandate(intent, shopper.privateKey, shopperKid);
    const cartJws = await signMandate(cart, merchant.privateKey, merchantKid);
    const cartHash = mandateHash(cart);
    await client.query(
      `insert into mandates (hash, kind, mandate_id, canonical, jws, kid, created_at)
      values ($1, 'intent', $2, $3, $4, $5, $6), ($7, 'cart', $8, $9, $10, $11, $6)`,
      [
        intentHash,
        intent.mandate_id,
        canonicalJson(intent),
        intentJws,
        shopperKid,
        createdAt,
        cartHash,
        cart.contents.cart_id,
        canonicalJson(cart),
        cartJws,
        merchantKid,
      ],
    );

    const pointer = customId(intent.mandate_id, intentHash);
    const captureId = `DEMO-CAPTURE-${suffix}`;
    const amount = cart.contents.total;
    await client.query(
      `insert into orders (id, intent_mandate_id, intent_mandate_hash, cart_mandate_hash,
      custom_id, paypal_intent, paypal_order_id, capture_id, status, total_value, currency, shopper_id,
      agent_platform, human_present, created_at, captured_at, updated_at)
      values ($1, $2, $3, $4, $5, 'AUTHORIZE', $6, $7, 'CAPTURED', $8, $9, $10, $11, true, $12, $13, $13)`,
      [
        orderId,
        intent.mandate_id,
        intentHash,
        cartHash,
        pointer,
        `DEMO-ORDER-${suffix}`,
        captureId,
        amount.value,
        amount.currency,
        shopperId,
        platforms[index % platforms.length],
        createdAt,
        capturedAt,
      ],
    );

    // Overreach is a historical mock capture from before checkout enforcement.
    const checkoutVerdict = overreach ? undefined : "APPROVE";
    if (checkoutVerdict) {
      await client.query(
        `insert into verdicts (intent_mandate_id, cart_id, order_id, outcome, created_at)
        values ($1, $2, $3, $4, $5)`,
        [intent.mandate_id, cart.contents.cart_id, orderId, checkoutVerdict, createdAt],
      );
    }
    if (!disputed) continue;

    const dispute = {
      disputeId: `PP-D-${1001 + index}`,
      orderId,
      reason: "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED",
      status: index < 2 || index % 3 !== 0 ? "WAITING_FOR_SELLER_RESPONSE" : "RESOLVED",
      amount,
      responseDueDate: iso((2 + index) * hour),
    };
    const rec = await runDisputeClassifier(
      dispute,
      {
        orderId,
        customId: pointer,
        intent,
        cart,
        capturedAt,
        j1Outcome: { fit: "match" },
      },
      { mode: "replay" },
    );
    const evidence =
      rec.class === "MANDATE_COMPLIANT"
        ? await draftEvidenceForDefend(
            {
              dispute,
              signedIntentJws: intentJws,
              cart,
              captureRecord: { captureId, orderId, capturedAt, amount, customId: pointer },
              keyResolver: async (kid) => (kid === shopperKid ? shopper.publicKey : undefined),
            },
            { mode: "replay", now: () => now.toISOString() },
          )
        : undefined;
    const recommendation = {
      ...rec,
      demo: true,
      checkoutVerdict,
      constraintChecks: buildConstraintChecks(intent, cart, rec.reasons),
      analyzedAt: now.toISOString(),
      ...(evidence ? { draft: evidence.draft, mandateHash: intentHash, customId: pointer } : {}),
    };
    await client.query(
      `insert into disputes (id, order_id, reason, status, amount_value, currency,
      seller_response_due_date, created_at, recommendation, evidence_pdf, evidence_bundle)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        dispute.disputeId,
        orderId,
        dispute.reason,
        dispute.status,
        amount.value,
        amount.currency,
        dispute.responseDueDate,
        iso(-(index + 1) * hour),
        recommendation,
        evidence ? Buffer.from(evidence.pdf) : null,
        evidence?.bundleJson ?? null,
      ],
    );
  }
}
