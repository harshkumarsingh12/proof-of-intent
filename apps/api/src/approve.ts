/**
 * Checkout stage 2 (docs/specs/0003), human present only: the shopper approved on PayPal, we authorize,
 * re-check, and then capture or void. Owner: @harshkumarsingh12.
 *
 * Re-checks after authorizing (so a failure voids the hold instead of leaving money held):
 *   - the countersignature verifies with the key that signed the Intent Mandate      → SIGNATURE_INVALID / UNKNOWN_KEY
 *   - it names this order and the exact Cart Mandate we signed                       → MANDATE_MISMATCH
 *   - the cart hasn't expired                                                        → CART_EXPIRED
 */
import { CartApproval, CartMandate, type ApproveResponse, type ReasonCode } from "@poi/contracts";
import type { Db, StoredOrder } from "@poi/db";
import { verifyMandate } from "@poi/mandates";
import { PayPalError, type PayPalClient } from "@poi/paypal";
import { importJWK, type JWK } from "jose";

export interface ApproveDeps {
  db: Db;
  paypal: PayPalClient;
  now: () => string;
}

export type ApproveResult =
  | { status: 200; body: ApproveResponse }
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

  // 1. Authorize (PayPal refuses if the shopper hasn't approved yet).
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

  // 2. Re-check, then capture or void.
  const reasons = await recheck(order, approvalJws, deps);
  try {
    if (reasons.length === 0) {
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
    }
    await deps.paypal.voidAuthorization(authorizationId);
    await deps.db.updateOrder(order.id, { status: "VOIDED" });
    await deps.db.appendAudit({
      actor: "api",
      action: "paypal.void",
      subjectId: order.id,
      requestBody: { authorizationId, reasons },
    });
    return { status: 200, body: { status: "VOIDED", reasons } };
  } catch (err) {
    return paypalDown(deps, order, reasons.length === 0 ? "capture" : "void", err);
  }
}

async function recheck(order: StoredOrder, approvalJws: string, deps: ApproveDeps): Promise<ReasonCode[]> {
  const intent = await deps.db.getMandate(order.intentMandateHash);
  const cartRow = await deps.db.getMandate(order.cartMandateHash);
  if (!intent || !cartRow) return ["MANDATE_MISMATCH"];

  // Only the key that signed the intent may approve the cart bought under it.
  const sig = await verifyMandate(approvalJws, async (kid) => {
    if (kid !== intent.kid) return undefined;
    const key = await deps.db.findKey("shopper", kid);
    return key ? (importJWK(key.publicJwk as unknown as JWK, "ES256") as Promise<CryptoKey>) : undefined;
  });
  if (!sig.ok) return [sig.reason];
  const approval = CartApproval.safeParse(sig.payload);
  if (
    !approval.success ||
    approval.data.order_id !== order.id ||
    approval.data.cart_mandate_hash !== order.cartMandateHash
  ) {
    return ["MANDATE_MISMATCH"];
  }
  const cart = CartMandate.parse(JSON.parse(cartRow.canonical));
  return Date.parse(deps.now()) >= Date.parse(cart.contents.cart_expiry) ? ["CART_EXPIRED"] : [];
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
