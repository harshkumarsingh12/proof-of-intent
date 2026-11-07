/**
 * Checkout stage 2 (docs/specs/0003), human present only: the shopper approved on PayPal; we check their
 * countersignature, then authorize and capture. Owner: @harshkumarsingh12.
 *
 * Nothing is sent to PayPal until the approval has been checked (#160), so a caller with no valid signature changes
 * nothing there and can't void anyone's order:
 *   1. the countersignature verifies with the key that signed the Intent Mandate, and
 *        that key hasn't been retired as of now                                        → 403 approval_invalid
 *        (SIGNATURE_INVALID / UNKNOWN_KEY / SCHEMA_INVALID)
 *   2. it names this order and the exact Cart Mandate we signed                       → 403 approval_invalid
 *        (MANDATE_MISMATCH): a genuine signature for another order can't void this one either
 *   3. the authority is still current (#161): the intent has started and hasn't expired and
 *        the cart hasn't expired, by the same rules checkout used, and the order's reservation
 *        still fits the intent's budget and recurrence (#155)                          → 200 VOIDED
 *        (MANDATE_NOT_YET_VALID / MANDATE_EXPIRED / CART_EXPIRED / BUDGET_EXCEEDED /
 *        RECURRENCE_EXCEEDED); any authorization we already
 *        hold is voided; with none, nothing was held and PayPal isn't called
 *   4. authorize (409 if the shopper hasn't approved at PayPal yet), then capture
 */
import { CartApproval, CartMandate, IntentMandate, type ApproveResponse, type ReasonCode } from "@poi/contracts";
import type { Db, StoredOrder } from "@poi/db";
import { keyValidAt, verifyMandate } from "@poi/mandates";
import { PayPalError, type PayPalClient } from "@poi/paypal";
import { freshness } from "@poi/policy-engine";
import { aggregateReasons } from "./checkout";
import { importJWK, type JWK } from "jose";

export interface ApproveDeps {
  db: Db;
  paypal: PayPalClient;
  now: () => string;
}

export type ApproveResult =
  | { status: 200; body: ApproveResponse }
  | { status: 403; body: { error: string; message: string; reasons: ReasonCode[] } }
  | { status: 404 | 409 | 502; body: { error: string; message: string } };

const AWAITING = new Set(["CREATED", "APPROVED", "AUTHORIZED"]);

export async function approveOrder(
  orderId: string,
  approvalJws: string,
  deps: ApproveDeps,
): Promise<ApproveResult> {
  const order = await deps.db.getOrder(orderId);
  if (!order) return { status: 404, body: { error: "order_not_found", message: `No order ${orderId}` } };
  if (!order.humanPresent || order.paypalIntent !== "AUTHORIZE" || !order.paypalOrderId) {
    return {
      status: 409,
      body: { error: "not_a_human_present_order", message: "Only human-present orders are approved here" },
    };
  }
  // A retry after we already finished answers with the same outcome; nothing is charged twice.
  if (order.status === "CAPTURED")
    return { status: 200, body: { status: "CAPTURED", capture_id: order.captureId } };
  if (order.status === "VOIDED") return { status: 200, body: { status: "VOIDED" } };
  if (!AWAITING.has(order.status)) {
    return {
      status: 409,
      body: { error: "order_not_awaiting_approval", message: `Order is ${order.status}` },
    };
  }

  // 1. Is this the shopper's own approval of this order and this exact cart? Before PayPal is contacted at all.
  const invalid = await checkApproval(order, approvalJws, deps);
  if (invalid.length > 0) {
    return {
      status: 403,
      body: {
        error: "approval_invalid",
        message: "The approval was not signed by the shopper for this order and cart",
        reasons: invalid,
      },
    };
  }

  // 2. Still within what the shopper authorized, as of now? If not, release any hold we have and stop.
  const stale = await staleReasons(order, deps);
  if (stale.length > 0) return release(order, stale, deps);

  // 3. Authorize (PayPal refuses if the shopper hasn't approved yet), then capture.
  let authorizationId = order.authorizationId;
  if (!authorizationId) {
    try {
      ({ authorizationId } = await deps.paypal.authorizeOrder(order.paypalOrderId));
    } catch (err) {
      if (err instanceof PayPalError && err.issue === "ORDER_NOT_APPROVED") {
        return {
          status: 409,
          body: { error: "shopper_has_not_approved", message: "PayPal has no approval for this order yet" },
        };
      }
      return paypalDown(deps, order, "authorize", err);
    }
    await deps.db.updateOrder(order.id, { status: "AUTHORIZED", authorizationId });
    await deps.db.appendAudit({
      actor: "api",
      action: "paypal.authorize",
      subjectId: order.id,
      requestBody: { authorizationId },
    });
  }
  try {
    const { captureId } = await deps.paypal.captureAuthorization(authorizationId);
    const capturedAt = deps.now();
    await deps.db.updateOrder(order.id, { status: "CAPTURED", captureId, capturedAt });
    await deps.db.appendAudit({
      actor: "api",
      action: "paypal.capture",
      subjectId: order.id,
      requestBody: { authorizationId, captureId, approvalJws },
    });
    return { status: 200, body: { status: "CAPTURED", capture_id: captureId } };
  } catch (err) {
    return paypalDown(deps, order, "capture", err);
  }
}

/**
 * The shopper's countersignature: signed by the key that signed the intent, and naming this order and the exact Cart
 * Mandate we signed. Any failure is the caller's, not the order's: it is refused and nothing changes.
 */
async function checkApproval(order: StoredOrder, approvalJws: string, deps: ApproveDeps): Promise<ReasonCode[]> {
  const intent = await deps.db.getMandate(order.intentMandateHash);
  const cartRow = await deps.db.getMandate(order.cartMandateHash);
  if (!intent || !cartRow) return ["MANDATE_MISMATCH"];

  // Only the key that signed the intent may approve the cart bought under it, and only while that key is still in
  // good standing: the approval is a new signature made now, so it is judged by the server's clock, not by the
  // `approved_at` the signer wrote (spec 0001; the same rule step-up approval applies).
  const sig = await verifyMandate(approvalJws, async (kid) => {
    if (kid !== intent.kid) return undefined;
    const key = await deps.db.findKey("shopper", kid);
    if (!key || !keyValidAt(key, deps.now())) return undefined;
    return importJWK(key.publicJwk as unknown as JWK, "ES256") as Promise<CryptoKey>;
  });
  if (!sig.ok) return [sig.reason];
  const approval = CartApproval.safeParse(sig.payload);
  if (!approval.success) return ["SCHEMA_INVALID"];
  if (approval.data.order_id !== order.id || approval.data.cart_mandate_hash !== order.cartMandateHash) {
    return ["MANDATE_MISMATCH"];
  }
  return [];
}

/**
 * What changed since checkout that makes this approval too late: the intent's own start and expiry as well as the
 * cart's, judged by the same `freshness` rules checkout ran (#161). The intent used to be left out here, so a
 * capture could succeed after the shopper's authority had expired as long as the cart (which the agent picks) hadn't.
 * Only run for a genuine approval.
 */
async function staleReasons(order: StoredOrder, deps: ApproveDeps): Promise<ReasonCode[]> {
  const [intentRow, cartRow] = await Promise.all([
    deps.db.getMandate(order.intentMandateHash),
    deps.db.getMandate(order.cartMandateHash),
  ]);
  if (!intentRow || !cartRow) return ["MANDATE_MISMATCH"];
  const intent = IntentMandate.parse(JSON.parse(intentRow.canonical));
  const cart = CartMandate.parse(JSON.parse(cartRow.canonical));
  const now = deps.now();
  const late = freshness({ intent, cart, now });
  if (late.length > 0) return late;
  // The reservation is still good only if the intent's other holds still leave room for this order (#155): the order's
  // own hold is left out, and what remains is what everything else under the intent has spent or set aside.
  const others = await deps.db.activeLedger(order.intentMandateId, now, order.id);
  return aggregateReasons({ intent, cart, now, ledger: others });
}

/**
 * A genuine approval that arrived too late. If we already authorized the order (an earlier capture failed), the hold is
 * voided so the shopper's money isn't left held; if not, nothing was held and PayPal isn't called.
 */
async function release(order: StoredOrder, reasons: ReasonCode[], deps: ApproveDeps): Promise<ApproveResult> {
  const { authorizationId } = order;
  try {
    if (authorizationId) await deps.paypal.voidAuthorization(authorizationId);
  } catch (err) {
    return paypalDown(deps, order, "void", err);
  }
  await deps.db.updateOrder(order.id, { status: "VOIDED" });
  await deps.db.appendAudit({
    actor: "api",
    action: authorizationId ? "paypal.void" : "checkout.voided",
    subjectId: order.id,
    requestBody: { authorizationId, reasons },
  });
  return { status: 200, body: { status: "VOIDED", reasons } };
}

async function paypalDown(
  deps: ApproveDeps,
  order: StoredOrder,
  step: string,
  err: unknown,
): Promise<ApproveResult> {
  await deps.db.appendAudit({
    actor: "api",
    action: `paypal.${step}.failed`,
    subjectId: order.id,
    requestBody: { message: (err as Error).message },
  });
  // The order keeps its last known status, so a retry of this call picks up where it stopped.
  return {
    status: 502,
    body: { error: "paypal_unavailable", message: `PayPal ${step} failed; retry the approval` },
  };
}
