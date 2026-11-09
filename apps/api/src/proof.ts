/**
 * Assembles an order's proof package (#177, spec 0001 §Proof package) from what checkout stored: the three signed mandates as
 * they were signed, the public keys that verify them, the PayPal references and the policy version. Read-only: it signs
 * nothing, changes nothing and calls no one. The package is checked elsewhere (`@poi/proof`, `pnpm proof:verify`) by anyone,
 * with no access to this server.
 */
import type { Db } from "@poi/db";
import { publicJwkOfSigningKey } from "@poi/mandates";
import { buildProofPackage, type ProofKeyInput, type ProofPackage } from "@poi/proof";
import type { Merchant } from "./checkout";

export type ProofResult =
  { status: 200; body: ProofPackage } | { status: 404 | 409 | 503; body: { error: string; message: string } };

const unavailable = (message: string): ProofResult => ({
  status: 409,
  body: { error: "proof_unavailable", message },
});

export async function assembleProof(
  db: Db,
  merchant: Merchant | undefined,
  orderId: string,
  now: string,
): Promise<ProofResult> {
  if (!merchant) {
    return {
      status: 503,
      body: {
        error: "merchant_not_configured",
        message: "The merchant signing key is not configured on this server",
      },
    };
  }
  const order = await db.getOrder(orderId);
  if (!order) return { status: 404, body: { error: "order_not_found", message: `No order ${orderId}` } };

  const [intent, cart, payment] = await Promise.all([
    db.getMandate(order.intentMandateHash),
    db.getMandate(order.cartMandateHash),
    db.findPaymentMandateForCart(order.cartMandateHash),
  ]);
  const missing = [
    !intent && "the signed Intent Mandate",
    !cart && "the signed Cart Mandate",
    !payment && "the signed Payment Mandate",
  ].filter(Boolean);
  if (!intent || !cart || !payment)
    return unavailable(`This order has no stored copy of ${missing.join(" and ")}`);

  // The cart is signed by the merchant's key; the package has to carry that key, and only this server's current key is known here.
  if (cart.kid !== merchant.kid) {
    return unavailable(
      `The Cart Mandate was signed by merchant key ${cart.kid}, which this server no longer holds (it holds ${merchant.kid})`,
    );
  }
  const merchantJwk = await publicJwkOfSigningKey(merchant.privateKey);
  if (!merchantJwk) return unavailable("The merchant key cannot be exported as a public key on this server");

  const [shopperKey, agentKey] = await Promise.all([
    db.findKey("shopper", intent.kid),
    db.findKey("agent", payment.kid),
  ]);
  if (!shopperKey || !agentKey) {
    return unavailable(
      `The registry has no ${[!shopperKey && `shopper key ${intent.kid}`, !agentKey && `agent key ${payment.kid}`].filter(Boolean).join(" or ")}`,
    );
  }

  const keys: ProofKeyInput[] = [
    {
      role: "shopper",
      kid: shopperKey.kid,
      publicJwk: shopperKey.publicJwk,
      ...(shopperKey.retiredAt ? { retiredAt: shopperKey.retiredAt } : {}),
    },
    {
      role: "agent",
      kid: agentKey.kid,
      publicJwk: agentKey.publicJwk,
      ...(agentKey.platform ? { platform: agentKey.platform } : {}),
      ...(agentKey.retiredAt ? { retiredAt: agentKey.retiredAt } : {}),
    },
    { role: "merchant", kid: merchant.kid, publicJwk: { ...merchantJwk } },
  ];

  return {
    status: 200,
    body: buildProofPackage({
      createdAt: now,
      intentJws: intent.jws,
      paymentJws: payment.jws,
      cartJws: cart.jws,
      keys,
      // Only what the order already says; the shopper's id, their wallet and anything private stay out.
      references: {
        order_id: order.id,
        merchant_id: merchant.id,
        custom_id: order.customId,
        ...(order.paypalOrderId ? { paypal_order_id: order.paypalOrderId } : {}),
        ...(order.authorizationId ? { authorization_id: order.authorizationId } : {}),
        ...(order.captureId ? { capture_id: order.captureId } : {}),
        ...(order.capturedAt ? { captured_at: order.capturedAt } : {}),
        order_status: order.status,
        agent_platform: order.agentPlatform,
        human_present: order.humanPresent,
      },
    }),
  };
}
