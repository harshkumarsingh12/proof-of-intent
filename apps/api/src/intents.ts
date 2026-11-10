/**
 * The shopper's controls over a signed intent (docs/specs/0013, #176): revoke it, and read how much of its authority is left.
 * Owner: @srshriv with @harshkumarsingh12.
 *
 * Revoke, stopping at the first failure:
 *   1. the intent the revocation names: id and hash, stored as an intent      → 404 intent_not_found
 *   2. signed by the key that signed that intent (retired or not: revoking only
 *      takes authority away), for this intent, and fresh                      → 403 revocation_invalid with reason codes
 *   3. revoked_at set by our clock, unless already set (the first one wins)   → 200 { mandate_id, revoked_at }
 * The audit row holds the exact canonical bytes and signature that were verified.
 *
 * Receipt: a fresh `intent.receipt` proof from that same key (in good standing), then what the merchant's own records say
 * is spent, held and left, by the same rules checkout enforces.
 */
import {
  IntentMandate,
  IntentReceiptProof,
  IntentRevocation,
  type IntentReceipt,
  type IntentRevokeResponse,
  type Money,
  type ReasonCode,
} from "@poi/contracts";
import type { Db, MandateRecord, SpendLedger, StoredOrder } from "@poi/db";
import { verifyMandate } from "@poi/mandates";
import { importJWK, type JWK } from "jose";
import { checkProof, PROOF_MAX_AGE_MS, PROOF_MAX_SKEW_MS, isFailure, type Failure } from "./vault";

export interface IntentDeps {
  db: Db;
  now: () => string;
}

export type RevokeResult = { status: 200; body: IntentRevokeResponse } | Failure;
export type ReceiptResult = { status: 200; body: IntentReceipt } | Failure;

const notFound: Failure = {
  status: 404,
  body: { error: "intent_not_found", message: "The merchant has no record of this intent" },
};
const invalid = (reasons: ReasonCode[]): Failure => ({
  status: 403,
  body: {
    error: "revocation_invalid",
    message: "The revocation was not signed by this intent's key for this intent",
    reasons,
  },
});

/** The payload of a compact JWS, unverified: only used to find which stored intent to verify against. */
function unverifiedPayload(jws: string): unknown {
  const part = jws.split(".")[1];
  if (!part) return undefined;
  try {
    return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
  } catch {
    return undefined;
  }
}

async function storedIntent(db: Db, mandateId: string, hash: string): Promise<MandateRecord | null> {
  const row = await db.getMandate(hash);
  return row && row.kind === "intent" && row.mandateId === mandateId ? row : null;
}

export async function revokeIntent(
  mandateId: string,
  revocationJws: string,
  deps: IntentDeps,
): Promise<RevokeResult> {
  const now = deps.now();
  const claimed = IntentRevocation.safeParse(unverifiedPayload(revocationJws));
  if (!claimed.success) return invalid(["SCHEMA_INVALID"]);
  if (claimed.data.mandate_id !== mandateId) return invalid(["MANDATE_MISMATCH"]);

  // 1. The intent it names, by id and hash: a mandate id alone isn't unique.
  const row = await storedIntent(deps.db, mandateId, claimed.data.intent_mandate_hash);
  if (!row) return notFound;

  // 2. Only the key that signed this intent can revoke it. A retired key still can: revoking takes authority away, so a
  //    stolen key gains nothing, and a shopper whose key was retired can still stop their intents.
  const sig = await verifyMandate(revocationJws, async (kid) => {
    if (kid !== row.kid) return undefined;
    const key = await deps.db.findKey("shopper", kid);
    return key ? (importJWK(key.publicJwk as unknown as JWK, "ES256") as Promise<CryptoKey>) : undefined;
  });
  if (!sig.ok) return invalid([sig.reason]);
  const revocation = IntentRevocation.safeParse(sig.payload);
  if (!revocation.success) return invalid(["SCHEMA_INVALID"]);
  if (revocation.data.mandate_id !== mandateId || revocation.data.intent_mandate_hash !== row.hash) {
    return invalid(["MANDATE_MISMATCH"]);
  }
  const age = Date.parse(now) - Date.parse(revocation.data.issued_at);
  if (age > PROOF_MAX_AGE_MS || age < -PROOF_MAX_SKEW_MS) {
    return {
      status: 403,
      body: {
        error: "proof_expired",
        message: "The revocation is too old (or from the future); sign a new one",
      },
    };
  }

  // 3. The first revocation wins; a repeat answers with it.
  const revokedAt = await deps.db.revokeIntent(row.hash, now);
  if (!revokedAt) return notFound;
  if (revokedAt === now) {
    await deps.db.appendAudit({
      actor: "shopper",
      action: "intent.revoked",
      subjectId: mandateId,
      requestBody: { intentMandateHash: row.hash, canonical: sig.canonical, jws: revocationJws, revokedAt },
    });
  }
  return { status: 200, body: { mandate_id: mandateId, revoked_at: revokedAt } };
}

export async function intentReceipt(
  mandateId: string,
  proofJws: string,
  deps: IntentDeps,
): Promise<ReceiptResult> {
  const checked = await checkProof(proofJws, "intent.receipt", deps);
  if (isFailure(checked)) return checked;
  const proof = IntentReceiptProof.parse(checked.proof);
  const row = await storedIntent(deps.db, mandateId, proof.intent_mandate_hash);
  // Another shopper's intent reads exactly like one we never saw.
  if (!row || row.kid !== checked.shopper.kid) return notFound;
  const now = deps.now();
  const intent = IntentMandate.parse(JSON.parse(row.canonical));
  return {
    status: 200,
    body: receiptFor({
      intent,
      hash: row.hash,
      now,
      revokedAt: row.revokedAt,
      spent: await deps.db.mandateLedger(mandateId),
      active: await deps.db.activeLedger(mandateId, now),
      orders: await deps.db.ordersForIntent(mandateId),
    }),
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * What is left of an intent, by the rules checkout enforces (spec 0002): the per-purchase cap, a signed budget against what is
 * captured or set aside, a signed order count in its window, or one purchase by default (#156). Pure.
 */
export function receiptFor(input: {
  intent: IntentMandate;
  hash: string;
  now: string;
  revokedAt?: string;
  /** Captured orders (Db.mandateLedger). */
  spent: SpendLedger;
  /** Captured and set aside (Db.activeLedger). */
  active: SpendLedger;
  orders: StoredOrder[];
}): IntentReceipt {
  const { intent, now, revokedAt, spent, active } = input;
  const { amount_max, budget_cap, recurrence } = intent.constraints;
  const currency = amount_max?.currency ?? budget_cap?.currency ?? "USD";
  const money = (value: number): Money => ({ value: Math.max(0, value), currency });
  const t = Date.parse(now);

  let total = budget_cap ? Math.max(0, budget_cap.value - active.capturedTotal) : null;
  let purchases: number | null;
  if (recurrence) {
    const start = t - recurrence.window_days * DAY_MS;
    const inWindow = active.capturedOrderTimes.filter(
      (iso) => Date.parse(iso) > start && Date.parse(iso) <= t,
    );
    purchases = Math.max(0, recurrence.max_orders - inWindow.length);
  } else if (budget_cap) {
    purchases = null; // a budget alone limits the amount, not the count
  } else {
    purchases = active.capturedOrderTimes.length > 0 ? 0 : 1;
  }

  const revoked = revokedAt !== undefined && revokedAt <= now;
  const expired = t >= Date.parse(intent.intent_expiry);
  const usedUp = purchases === 0 || total === 0;
  const state: IntentReceipt["state"] = revoked
    ? "REVOKED"
    : expired
      ? "EXPIRED"
      : usedUp
        ? "USED_UP"
        : t < Date.parse(intent.constraints.valid_from)
          ? "NOT_YET_VALID"
          : "ACTIVE";
  const over = state === "REVOKED" || state === "EXPIRED" || state === "USED_UP";
  if (over) {
    total = budget_cap ? 0 : null;
    purchases = purchases === null ? null : 0;
  }
  const perPurchase = over
    ? 0
    : amount_max && total !== null
      ? Math.min(amount_max.value, total)
      : (amount_max?.value ?? total);

  return {
    mandate_id: intent.mandate_id,
    intent_mandate_hash: input.hash,
    state,
    expires_at: intent.intent_expiry,
    ...(revokedAt ? { revoked_at: revokedAt } : {}),
    spent: money(spent.capturedTotal),
    held: money(active.capturedTotal - spent.capturedTotal),
    remaining: {
      per_purchase: perPurchase === null || perPurchase === undefined ? null : money(perPurchase),
      total: total === null ? null : money(total),
      purchases,
    },
    purchases: input.orders.map((o) => ({
      order_id: o.id,
      status: o.status,
      total: { value: o.totalValue, currency: o.currency },
      ...(o.capturedAt ? { captured_at: o.capturedAt } : {}),
    })),
  };
}
