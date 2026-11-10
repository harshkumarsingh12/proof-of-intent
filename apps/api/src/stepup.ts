/**
 * Step-up approval links (docs/specs/0003, #35). Agent alone and not sure enough, checkout stores the cart and
 * sends the shopper a link; no order exists and nothing is charged until the shopper approves it.
 *
 * The link token only locates the step-up. Approving takes a CartApproval signed with the key that signed the
 * Intent Mandate, so neither the agent nor anyone else who sees the link can approve on the shopper's behalf.
 *
 * Approval, stopping at the first failure:
 *   1. the link exists                                      → 404 stepup_not_found
 *   2. it hasn't expired (24 h, or the cart's or intent's
 *      expiry if sooner)                                    → 410 stepup_expired, nothing created
 *   3. the countersignature: the intent's key, this step-up
 *      and this exact cart                                  → 403 approval_invalid with reason codes
 *   4. the hard rules again, now (budget may have been
 *      spent since the link was sent)                       → 409 stepup_no_longer_valid with reason codes
 *   5. a saved wallet to charge                             → 409 no_vaulted_wallet (the link stays usable)
 *   6. Cart Mandate signed, order created with intent CAPTURE against the vault id → 200 CAPTURED
 */
import {
  CartApproval,
  CartMandate,
  IntentMandate,
  type ReasonCode,
  type StepUpApproveResponse,
  type StepUpView,
} from "@poi/contracts";
import type { Db, StoredStepUp } from "@poi/db";
import { keyValidAt, mandateHash, verifyMandate } from "@poi/mandates";
import type { PayPalClient } from "@poi/paypal";
import { evaluate } from "@poi/policy-engine";
import { importJWK, type JWK } from "jose";
import { ledgerFor, placeOrder, stepUpTokenHash, type Merchant } from "./checkout";
import { checkProof, isFailure, type Failure as ProofFailure } from "./vault";

export interface StepUpDeps {
  db: Db;
  paypal: PayPalClient;
  merchant: Merchant;
  now: () => string;
}

type Failure = {
  status: 402 | 403 | 404 | 409 | 410 | 502;
  body: { error: string; message: string; reasons?: ReasonCode[] };
};
export type StepUpViewResult = { status: 200; body: StepUpView } | Failure;
export type StepUpApproveResult = { status: 200; body: StepUpApproveResponse } | Failure;

const notFound: Failure = {
  status: 404,
  body: { error: "stepup_not_found", message: "This approval link is not valid" },
};
const expired: Failure = {
  status: 410,
  body: { error: "stepup_expired", message: "This approval link has expired; nothing was charged" },
};

const isExpired = (st: StoredStepUp, now: string) => Date.parse(st.expiresAt) <= Date.parse(now);

async function find(db: Db, token: string): Promise<StoredStepUp | null> {
  // Tokens are 43 base64url characters; anything else can't match and needn't reach the database.
  if (!/^[A-Za-z0-9_-]{20,128}$/.test(token)) return null;
  return db.findStepUp(stepUpTokenHash(token));
}

/** What the shopper sees before approving. An expired link still shows, marked EXPIRED, so the page can say so. */
export async function viewStepUp(
  token: string,
  deps: Pick<StepUpDeps, "db" | "now">,
): Promise<StepUpViewResult> {
  const st = await find(deps.db, token);
  if (!st) return notFound;
  return { status: 200, body: toView(st, deps.now()) };
}

function toView(st: StoredStepUp, now: string): StepUpView {
  const cart = CartMandate.parse(st.cart);
  const status = st.status === "PENDING" && isExpired(st, now) ? "EXPIRED" : st.status;
  return {
    stepup_id: st.id,
    status,
    lines: cart.contents.lines,
    total: cart.contents.total,
    merchant_name: cart.contents.merchant_name,
    agent_platform: st.agentPlatform,
    reasons: st.reasons as ReasonCode[],
    cart_mandate_hash: st.cartMandateHash,
    shopper_kid: st.shopperKid,
    expires_at: st.expiresAt,
    ...(st.orderId ? { order_id: st.orderId } : {}),
  };
}

export type StepUpListResult = { status: 200; body: { stepups: StepUpView[] } } | ProofFailure;

/**
 * The carts waiting for this shopper, for the shop to show next to the agent's answer. The shopper proves who they
 * are with a fresh signature from the key that signed the intent, so no link (and no token) is needed or exposed:
 * approving still takes their own CartApproval signature, exactly as with the emailed link.
 */
export async function listPendingStepUps(
  proofJws: string,
  deps: Pick<StepUpDeps, "db" | "now">,
): Promise<StepUpListResult> {
  const checked = await checkProof(proofJws, "stepup.list", deps);
  if (isFailure(checked)) return checked;
  const rows = await deps.db.listPendingStepUps(checked.shopper.kid, deps.now());
  return { status: 200, body: { stepups: rows.map((st) => toView(st, deps.now())) } };
}

export async function approveStepUp(
  token: string,
  approvalJws: string,
  deps: StepUpDeps,
): Promise<StepUpApproveResult> {
  const st = await find(deps.db, token);
  return st ? approveFound(st, approvalJws, deps) : notFound;
}

/** The same approval by step-up id, for the shop's own list (listPendingStepUps). The signature is what authorizes. */
export async function approveStepUpById(
  id: string,
  approvalJws: string,
  deps: StepUpDeps,
): Promise<StepUpApproveResult> {
  const st = /^stp_[0-9a-f-]{36}$/.test(id) ? await deps.db.findStepUpById(id) : null;
  return st ? approveFound(st, approvalJws, deps) : notFound;
}

async function approveFound(
  st: StoredStepUp,
  approvalJws: string,
  deps: StepUpDeps,
): Promise<StepUpApproveResult> {
  const now = deps.now();

  // A retry after success answers the same; nothing is charged twice.
  if (st.status === "APPROVED" && st.orderId)
    return { status: 200, body: await approved(deps.db, st.orderId) };
  if (st.status === "EXPIRED" || (st.status === "PENDING" && isExpired(st, now))) {
    if (st.status === "PENDING") await finish(deps.db, st.id, "EXPIRED");
    return expired;
  }
  if (st.status !== "PENDING") {
    return {
      status: 409,
      body: { error: "stepup_not_pending", message: `This approval is ${st.status.toLowerCase()}` },
    };
  }

  // 3. The shopper's own signature over this step-up and this exact cart.
  const sigReasons = await checkApproval(st, approvalJws, now, deps.db);
  if (sigReasons.length > 0) {
    return {
      status: 403,
      body: {
        error: "approval_invalid",
        message: "The approval was not signed for this cart",
        reasons: sigReasons,
      },
    };
  }

  // The stored rows must still be what checkout verified.
  const cart = CartMandate.parse(st.cart);
  const intentRow = await deps.db.getMandate(st.intentMandateHash);
  if (!intentRow || mandateHash(cart) !== st.cartMandateHash) {
    await finish(deps.db, st.id, "FAILED");
    return notFound;
  }
  const intent = IntentMandate.parse(JSON.parse(intentRow.canonical));

  // Exactly one request gets past here; a double click waits for nothing and charges nothing.
  if (!(await deps.db.claimStepUp(st.id, now))) {
    const again = await deps.db.findStepUp(st.tokenHash);
    if (again?.status === "APPROVED" && again.orderId)
      return { status: 200, body: await approved(deps.db, again.orderId) };
    if (again?.status === "PENDING" && isExpired(again, now)) return expired;
    return {
      status: 409,
      body: { error: "stepup_not_pending", message: "This approval is already being processed" },
    };
  }

  // 4. The hard rules again: the link may be hours old and the budget spent in the meantime. And the shopper may have
  //    revoked the intent since (spec 0013, #176).
  const rules = evaluate({
    intent,
    cart,
    now,
    ledger: await ledgerFor(deps.db, intent.mandate_id, st.cartMandateHash, false, now),
  });
  const revoked = intentRow.revokedAt !== undefined && intentRow.revokedAt <= now;
  const refused: ReasonCode[] = [...(revoked ? (["MANDATE_REVOKED"] as const) : []), ...rules.reasons];
  if (refused.length > 0) return noLongerValid(deps.db, st, cart, refused);

  const shopper = await deps.db.findKey("shopper", st.shopperKid);
  if (!shopper?.vaultId) {
    await deps.db.finishStepUp(st.id, { status: "PENDING" });
    return {
      status: 409,
      body: {
        error: "no_vaulted_wallet",
        message: "Save a PayPal wallet first; this link stays valid until it expires",
      },
    };
  }

  const placed = await placeOrder(deps, {
    intent,
    intentHash: st.intentMandateHash,
    cart,
    cartHash: st.cartMandateHash,
    shopperId: shopper.shopperId,
    agentPlatform: st.agentPlatform,
    humanPresent: false,
    vaultId: shopper.vaultId,
    outcome: "STEP_UP",
    reasons: st.reasons as ReasonCode[],
    semantic: { approvedBy: "shopper", stepUpId: st.id },
  });
  // The reservation refused it inside its lock (a budget spent, or the intent revoked, a moment ago): no order exists.
  if (placed.status === 200 && placed.body.verdict.outcome === "REJECT") {
    return noLongerValid(deps.db, st, cart, placed.body.verdict.reasons, false);
  }
  if (placed.status !== 200) {
    // PayPal's answer was lost on an unattended charge: it may have been made. The link stays usable, and opening it
    // again confirms that same order with PayPal instead of creating a second one (#159).
    if (placed.body.error === "paypal_outcome_unknown" || placed.body.error === "payment_outcome_unknown") {
      await deps.db.finishStepUp(st.id, { status: "PENDING" });
      return { status: placed.status, body: placed.body };
    }
    // PayPal refused, or declined the wallet (#225). Nothing was charged; the agent starts a new checkout.
    await finish(deps.db, st.id, "FAILED");
    return { status: placed.status === 402 ? 402 : 502, body: placed.body };
  }
  const orderId = placed.body.order_id!;
  await deps.db.finishStepUp(st.id, { status: "APPROVED", orderId, approvedAt: now });
  await deps.db.appendAudit({
    actor: "shopper",
    action: "stepup.approved",
    subjectId: st.id,
    requestBody: { orderId, cartMandateHash: st.cartMandateHash },
  });
  return { status: 200, body: await approved(deps.db, orderId) };
}

async function checkApproval(st: StoredStepUp, jws: string, now: string, db: Db): Promise<ReasonCode[]> {
  const key = await db.findKey("shopper", st.shopperKid);
  if (!key || !keyValidAt(key, now)) return ["UNKNOWN_KEY"];
  const sig = await verifyMandate(jws, async (kid) =>
    kid === st.shopperKid
      ? (importJWK(key.publicJwk as unknown as JWK, "ES256") as Promise<CryptoKey>)
      : undefined,
  );
  if (!sig.ok) return [sig.reason];
  const approval = CartApproval.safeParse(sig.payload);
  if (!approval.success) return ["SCHEMA_INVALID"];
  if (approval.data.order_id !== st.id || approval.data.cart_mandate_hash !== st.cartMandateHash)
    return ["MANDATE_MISMATCH"];
  return [];
}

async function approved(db: Db, orderId: string): Promise<StepUpApproveResponse> {
  const order = await db.getOrder(orderId);
  return {
    // Approved by the shopper, but not paid until PayPal completes the capture (#225).
    status: order?.status === "CAPTURE_PENDING" ? "CAPTURE_PENDING" : "CAPTURED",
    order_id: orderId,
    ...(order?.paypalOrderId ? { paypal_order_id: order.paypalOrderId } : {}),
    ...(order?.captureId ? { capture_id: order.captureId } : {}),
  };
}

/** The cart no longer fits what the shopper authorized: the step-up is REJECTED and nothing was charged. */
async function noLongerValid(
  db: Db,
  st: StoredStepUp,
  cart: CartMandate,
  reasons: ReasonCode[],
  recordIt = true,
): Promise<Failure> {
  // placeOrder already recorded the verdict when its reservation refused.
  if (recordIt) {
    await db.recordVerdict({
      intentMandateId: st.intentMandateId,
      cartId: cart.contents.cart_id,
      outcome: "REJECT",
      reasons,
    });
  }
  await finish(db, st.id, "REJECTED");
  return {
    status: 409,
    body: {
      error: "stepup_no_longer_valid",
      message: "The cart no longer fits the signed intent; nothing was charged",
      reasons,
    },
  };
}

async function finish(db: Db, id: string, status: "EXPIRED" | "REJECTED" | "FAILED") {
  await db.finishStepUp(id, { status });
  await db.appendAudit({ actor: "api", action: `stepup.${status.toLowerCase()}`, subjectId: id });
}
