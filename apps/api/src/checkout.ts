/**
 * Checkout stage 1 (docs/specs/0003): verify the mandates, decide, and only then touch PayPal.
 * Owner: @harshkumarsingh12 (route, PayPal, persistence) with @srshriv (verification rules).
 *
 * Order of checks, stopping at the first stage that fails:
 *   1. structure       zod on the Intent Mandate, Payment Mandate and cart          → SCHEMA_INVALID
 *   2. signatures      shopper key for the intent, agent key for the payment        → SIGNATURE_INVALID / UNKNOWN_KEY
 *   3. bindings        payment commits to this intent and this cart, cart → intent  → MANDATE_MISMATCH
 *   4. replay          the Payment Mandate id is claimed once, ever                 → NONCE_REPLAYED
 *   5. hard rules      packages/policy-engine with the intent's capture ledger, and the merchant's own
 *                      catalog: every cart line's SKU, title, attributes and price must be what the
 *                      merchant sells (#158)                                            → CATALOG_MISMATCH
 *   6. semantic (J1)   only if every hard rule passed; can only lower the outcome
 * Invariant 1: no PayPal order exists for a REJECT.
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { APPROVE_AT, STEP_UP_AT, isAiUnavailable, type AiMode, type SemanticFit } from "@poi/ai";
import {
  CartLine,
  CartMandate,
  IntentMandate,
  PaymentMandate,
  type CheckoutRequest,
  type CheckoutResponse,
  type Outcome,
  type ReasonCode,
} from "@poi/contracts";
import { catalogMismatches } from "@poi/contracts/catalog";
import type { Db, KeyRecord, StepUpRecord } from "@poi/db";
import {
  customId,
  keyValidAt,
  mandateHash,
  signMandate,
  verifyMandate,
  type SigningKey,
} from "@poi/mandates";
import { PayPalError, captureOutcome, type PayPalClient } from "@poi/paypal";
import { evaluate, type EvaluateInput } from "@poi/policy-engine";
import { importJWK, type JWK } from "jose";

export interface Merchant {
  id: string;
  kid: string;
  privateKey: SigningKey;
}

/** The approval link for an agent-alone step-up. It goes to the shopper, never back to the agent. */
export interface StepUpLink {
  stepUpId: string;
  shopperId?: string;
  url: string;
  expiresAt: string;
}

export interface StepUpConfig {
  /** Where the shopper opens the link: the buyer app's /approve page. */
  linkBase: string;
  send: (link: StepUpLink) => Promise<void>;
}

export interface CheckoutDeps {
  /**
   * What the merchant sells: the facts a cart line must match. The agent proposes the cart and the merchant signs it,
   * so these come from here and never from the agent. Defaults to the demo store (packages/contracts catalog).
   */
  catalog?: readonly CartLine[];
  db: Db;
  paypal: PayPalClient;
  merchant: Merchant;
  aiMode: AiMode;
  semanticFit: (description: string, cart: CartMandate, mode: AiMode) => Promise<SemanticFit>;
  now: () => string;
  stepUp: StepUpConfig;
}

/** Spec 0003: the link is good for 24 h, and never longer than the cart or the intent it approves. */
export const STEP_UP_TTL_MS = 24 * 60 * 60 * 1000;

export const stepUpTokenHash = (token: string) => createHash("sha256").update(token).digest("hex");

export type CheckoutResult =
  { status: 200; body: CheckoutResponse } | { status: 402 | 409 | 502; body: ApiError };

interface ApiError {
  error: string;
  message: string;
  reasons?: ReasonCode[];
}

const reject = (reasons: ReasonCode[]): CheckoutResult => ({
  status: 200,
  body: { verdict: { outcome: "REJECT", reasons } },
});

export async function runCheckout(input: CheckoutRequest, deps: CheckoutDeps): Promise<CheckoutResult> {
  const now = deps.now();

  // 1–2. Signatures first (they decide whose words we're reading), then structure of what was signed.
  let shopperKey: KeyRecord | null = null;
  const intentSig = await verifyMandate(input.intent_jws, async (kid) => {
    shopperKey = await deps.db.findKey("shopper", kid);
    return shopperKey ? importKey(shopperKey) : undefined;
  });
  if (!intentSig.ok) return reject([intentSig.reason]);

  let agentKey: KeyRecord | null = null;
  const paymentSig = await verifyMandate(input.payment_mandate_jws, async (kid) => {
    agentKey = await deps.db.findKey("agent", kid);
    return agentKey ? importKey(agentKey) : undefined;
  });
  if (!paymentSig.ok) return reject([paymentSig.reason]);

  const intentParsed = IntentMandate.safeParse(intentSig.payload);
  const paymentParsed = PaymentMandate.safeParse(paymentSig.payload);
  const cartParsed = CartMandate.safeParse(input.cart);
  if (!intentParsed.success || !paymentParsed.success || !cartParsed.success)
    return reject(["SCHEMA_INVALID"]);
  const intent = intentParsed.data;
  const payment = paymentParsed.data;
  const cart = cartParsed.data;
  const lineTotal = cart.contents.lines.reduce((sum, l) => sum + l.unit_price.value * l.quantity, 0);
  if (lineTotal !== cart.contents.total.value) return reject(["SCHEMA_INVALID"]);

  // A retired key authorizes nothing new (spec 0001, #162), and "new" is judged by OUR clock, never by a date the signer
  // wrote: a retired or stolen key can sign a payment or an intent dated before it was retired.
  //   - The Payment Mandate is per attempt, so its key must be in good standing now.
  //   - An intent is long-lived. One we saw before the key was retired stays usable (it was authorized while the key was
  //     good), and retiring a key "as of" an earlier date still voids what we first saw after it. One we have never
  //     seen counts from now.
  const shopper = shopperKey as KeyRecord | null;
  const agent = agentKey as KeyRecord | null;
  const intentHash = mandateHash(intent);
  const storedIntent = await deps.db.getMandate(intentHash);
  const firstSeen = storedIntent?.seenAt ?? now;
  if (shopper && !keyValidAt(shopper, firstSeen)) return reject(["UNKNOWN_KEY"]);
  if (agent && !keyValidAt(agent, now)) return reject(["UNKNOWN_KEY"]);

  // 3. Bindings: one intent, one cart, one payment, all pointing at each other, addressed to us.
  const cartHash = mandateHash(cart);
  if (
    payment.intent_mandate_hash !== intentHash ||
    payment.cart_mandate_hash !== cartHash ||
    payment.agent_key_id !== paymentSig.kid ||
    (agent?.platform !== undefined && payment.agent_platform !== agent.platform) ||
    cart.intent_mandate_hash !== intentHash ||
    cart.contents.merchant_id !== deps.merchant.id
  ) {
    return reject(["MANDATE_MISMATCH"]);
  }

  // 4. Replay. The Payment Mandate is per attempt; one intent legitimately backs several (journey B's retry).
  await deps.db.saveMandate({
    hash: intentHash,
    kind: "intent",
    mandateId: intent.mandate_id,
    canonical: intentSig.canonical,
    jws: input.intent_jws,
    kid: intentSig.kid,
    seenAt: now,
  });
  await deps.db.saveMandate({
    hash: mandateHash(payment),
    kind: "payment",
    mandateId: payment.payment_mandate_id,
    canonical: paymentSig.canonical,
    jws: input.payment_mandate_jws,
    kid: paymentSig.kid,
    seenAt: now,
  });
  if (!(await deps.db.claimNonce(`payment:${payment.payment_mandate_id}`))) {
    return record(deps, intent.mandate_id, cart.contents.cart_id, "REJECT", ["NONCE_REPLAYED"]);
  }

  // 5. Hard rules, and the merchant's own facts. Both are reported together, so an agent that gets one wrong and also
  //    breaks a limit hears about both.
  const ledger = await ledgerFor(deps.db, intent.mandate_id, cartHash, payment.human_present, now);
  const rules = evaluate({ intent, cart, now, ledger });
  const misses = catalogMismatches(cart.contents.lines, deps.catalog);
  // Paying without the shopper is something the shopper signed, not something the agent declares (#157).
  const unattended = intent.constraints.unattended_payment;
  const unattendedRefused =
    !payment.human_present &&
    (!unattended ||
      (unattended.allowed_agent_platforms !== undefined &&
        !unattended.allowed_agent_platforms.includes(payment.agent_platform)));
  if (misses.length > 0) {
    // The agent only hears the reason code; the operator can see exactly which fact differed.
    await deps.db.appendAudit({
      actor: "api",
      action: "checkout.catalog_mismatch",
      subjectId: intent.mandate_id,
      requestBody: { cartId: cart.contents.cart_id, mismatches: misses },
    });
  }
  // The shopper stopped this intent (spec 0013, #176). The reservation re-checks it inside its lock, so a revocation that lands
  // after this check still refuses the order.
  const revoked = storedIntent?.revokedAt !== undefined && storedIntent.revokedAt <= now;
  if (misses.length > 0 || unattendedRefused || revoked || !rules.pass) {
    const reasons: ReasonCode[] = [
      ...(revoked ? (["MANDATE_REVOKED"] as const) : []),
      ...(misses.length > 0 ? (["CATALOG_MISMATCH"] as const) : []),
      ...(unattendedRefused ? (["UNATTENDED_NOT_PERMITTED"] as const) : []),
      ...rules.reasons,
    ];
    return record(deps, intent.mandate_id, cart.contents.cart_id, "REJECT", reasons);
  }

  // 6. Semantic fit, downgrade only.
  let outcome: Outcome = "APPROVE";
  const reasons: ReasonCode[] = [];
  let semantic: unknown;
  try {
    const fit = await deps.semanticFit(intent.natural_language_description, cart, deps.aiMode);
    semantic = fit;
    if (fit.fit === "mismatch" || fit.confidence < STEP_UP_AT) {
      return record(
        deps,
        intent.mandate_id,
        cart.contents.cart_id,
        "REJECT",
        ["SEMANTIC_MISMATCH"],
        semantic,
      );
    }
    if (fit.fit === "partial" || fit.confidence < APPROVE_AT) {
      outcome = "STEP_UP";
      reasons.push("SEMANTIC_UNCERTAIN");
    }
  } catch (err) {
    if (!isAiUnavailable(err)) throw err;
    // J1 unavailable (no recording, invalid output after a retry, timeout, no key): a human confirms instead.
    outcome = "STEP_UP";
    reasons.push("SEMANTIC_UNCERTAIN");
    semantic = { unavailable: true, why: (err as Error).message };
  }
  if (intent.user_cart_confirmation_required) outcome = "STEP_UP";

  // Agent alone and not sure enough: nothing is charged until the shopper approves the step-up link (#35).
  if (!payment.human_present && outcome === "STEP_UP") {
    const result = await record(deps, intent.mandate_id, cart.contents.cart_id, outcome, reasons, semantic);
    await createStepUp(deps, {
      intentMandateId: intent.mandate_id,
      intentMandateHash: intentHash,
      cartMandateHash: cartHash,
      cart,
      shopperKid: intentSig.kid,
      agentPlatform: payment.agent_platform,
      reasons,
      expiresAt: new Date(
        Math.min(
          Date.parse(now) + STEP_UP_TTL_MS,
          Date.parse(cart.contents.cart_expiry),
          Date.parse(intent.intent_expiry),
        ),
      ).toISOString(),
      shopperId: shopper?.shopperId,
    });
    return result;
  }
  const vaultId = shopper?.vaultId;
  if (!payment.human_present && !vaultId) {
    await deps.db.recordVerdict({
      intentMandateId: intent.mandate_id,
      cartId: cart.contents.cart_id,
      outcome,
      reasons,
      semantic,
    });
    return {
      status: 409,
      body: {
        error: "no_vaulted_wallet",
        message: "Agent-alone checkout needs the shopper's saved PayPal wallet",
      },
    };
  }

  return placeOrder(deps, {
    intent,
    intentHash,
    cart,
    cartHash,
    shopperId: shopper?.shopperId,
    agentPlatform: payment.agent_platform,
    humanPresent: payment.human_present,
    vaultId,
    outcome,
    reasons,
    semantic,
  });
}

/**
 * What the intent has spent or set aside, for judging this cart. An unattended cart whose earlier charge has an unknown
 * outcome (#159) is being retried, not bought a second time: that order is left out, so the retry does not count against
 * itself (and a default intent's one purchase is not "already used" by the very order being confirmed).
 */
export async function ledgerFor(
  db: Db,
  intentMandateId: string,
  cartHash: string,
  humanPresent: boolean,
  now: string,
) {
  const resumable = humanPresent
    ? undefined
    : (await db.unknownOutcomeOrders(intentMandateId)).find((u) => u.cartMandateHash === cartHash);
  return db.activeLedger(intentMandateId, now, resumable?.id);
}

/**
 * The rules that depend on what else the intent has spent or set aside: a signed budget, a signed order count, and the
 * default intent's one purchase (#156). They are what a reservation re-checks inside its lock, and what approval
 * re-checks before capture; every other rule already passed for this cart. Leaving INTENT_ALREADY_USED out let two
 * checkouts under a default intent that arrived together both pass the earlier check and both be charged.
 */
const AGGREGATE_REASONS: readonly ReasonCode[] = [
  "BUDGET_EXCEEDED",
  "RECURRENCE_EXCEEDED",
  "INTENT_ALREADY_USED",
];

export function aggregateReasons(input: EvaluateInput): ReasonCode[] {
  return evaluate(input).reasons.filter((r) => AGGREGATE_REASONS.includes(r));
}

export interface OrderToPlace {
  intent: IntentMandate;
  intentHash: string;
  cart: CartMandate;
  cartHash: string;
  shopperId?: string;
  agentPlatform: string;
  humanPresent: boolean;
  /** Agent alone: the shopper's saved wallet, charged with intent CAPTURE. */
  vaultId?: string;
  outcome: Outcome;
  reasons: ReasonCode[];
  semantic?: unknown;
}

/**
 * Signs the Cart Mandate, writes the order and its verdict, then creates the PayPal order. Used by checkout for
 * an APPROVE (and a human-present STEP_UP) and by step-up approval once the shopper has signed.
 */
export async function placeOrder(
  deps: Pick<CheckoutDeps, "db" | "paypal" | "merchant" | "now">,
  o: OrderToPlace,
): Promise<CheckoutResult> {
  const now = deps.now();
  const { intent, intentHash, cart, cartHash, outcome, reasons, semantic } = o;

  // An unattended charge whose PayPal result we never learned may already have happened (#159). The same cart is
  // retried under the SAME order id, which is also PayPal's PayPal-Request-Id, so PayPal answers with the original
  // result instead of charging again. Anything else under this intent waits until that is settled.
  let orderId = `ord_${randomUUID()}`;
  let resumed = false;
  if (!o.humanPresent) {
    const unknown = await deps.db.unknownOutcomeOrders(intent.mandate_id);
    const same = unknown.find((u) => u.cartMandateHash === cartHash);
    if (same) {
      orderId = same.id;
      resumed = true;
    } else if (unknown.length > 0) {
      return {
        status: 409,
        body: {
          error: "payment_outcome_unknown",
          message:
            "An earlier payment under this intent is unconfirmed and the shopper may have been charged. " +
            "Retry that same checkout to confirm it before anything else is attempted",
        },
      };
    }
  }

  // Sign the Cart Mandate: the merchant's commitment, issued only after the checks above.
  const cartJws = await signMandate(cart, deps.merchant.privateKey, deps.merchant.kid);
  await deps.db.saveMandate({
    hash: cartHash,
    kind: "cart",
    mandateId: cart.contents.cart_id,
    canonical: verifiedCanonical(cartJws),
    jws: cartJws,
    kid: deps.merchant.kid,
    seenAt: now,
  });

  const pointer = customId(intent.mandate_id, intentHash);
  const paypalIntent = o.humanPresent ? "AUTHORIZE" : "CAPTURE";
  if (resumed) {
    await deps.db.appendAudit({
      actor: "api",
      action: "paypal.create_order.reconcile",
      subjectId: orderId,
      requestBody: { cartHash },
    });
  } else {
    // Reserve the amount and create the order in one step, before PayPal is contacted (#155). The check above saw the
    // ledger a moment ago; this one sees it inside the reservation, so two carts created at the same time cannot both
    // fit under a cap that only one fits.
    const reservation = await deps.db.reserveOrder(
      {
        id: orderId,
        intentMandateId: intent.mandate_id,
        intentMandateHash: intentHash,
        cartMandateHash: cartHash,
        customId: pointer,
        paypalIntent,
        status: "PENDING",
        totalValue: cart.contents.total.value,
        currency: cart.contents.total.currency,
        shopperId: o.shopperId,
        agentPlatform: o.agentPlatform,
        humanPresent: o.humanPresent,
        reservedUntil: cart.contents.cart_expiry,
      },
      now,
      (ledger) => aggregateReasons({ intent, cart, now, ledger }),
    );
    if (!reservation.ok) {
      const refused = reservation.reasons as ReasonCode[];
      await deps.db.recordVerdict({
        intentMandateId: intent.mandate_id,
        cartId: cart.contents.cart_id,
        outcome: "REJECT",
        reasons: refused,
      });
      await deps.db.appendAudit({
        actor: "api",
        action: "checkout.verdict",
        subjectId: intent.mandate_id,
        requestBody: { cartId: cart.contents.cart_id, outcome: "REJECT", reasons: refused },
      });
      return reject(refused);
    }
    await deps.db.recordVerdict({
      intentMandateId: intent.mandate_id,
      cartId: cart.contents.cart_id,
      orderId,
      outcome,
      reasons,
      semantic,
    });
    await deps.db.appendAudit({
      actor: "api",
      action: "checkout.verdict",
      subjectId: orderId,
      requestBody: { outcome, reasons, intentHash, cartHash, semantic },
    });
  }

  let created;
  try {
    created = await deps.paypal.createOrder({
      intent: paypalIntent,
      ourOrderId: orderId,
      customId: pointer,
      total: cart.contents.total,
      items: cart.contents.lines.map((l) => ({
        sku: l.sku,
        name: l.title,
        unitAmount: l.unit_price,
        quantity: l.quantity,
      })),
      vaultId: o.humanPresent ? undefined : o.vaultId,
    });
  } catch (err) {
    // "Nothing was charged" is only known when PayPal answered with a refusal (a 4xx), or when creating the order
    // charges nothing (AUTHORIZE). A lost response, a timeout or a 5xx on an unattended CAPTURE can follow a completed
    // charge, so that order is UNKNOWN_OUTCOME and must be confirmed, not retried blind (#159).
    const refused = err instanceof PayPalError && err.status >= 400 && err.status < 500 && err.status !== 408;
    const unknown = paypalIntent === "CAPTURE" && !refused;
    await deps.db.updateOrder(orderId, { status: unknown ? "UNKNOWN_OUTCOME" : "PAYPAL_FAILED" });
    await deps.db.appendAudit({
      actor: "api",
      action: unknown ? "paypal.create_order.unknown_outcome" : "paypal.create_order.failed",
      subjectId: orderId,
      requestBody: { message: (err as Error).message },
    });
    return {
      status: 502,
      body: unknown
        ? {
            error: "paypal_outcome_unknown",
            message:
              "PayPal did not confirm the payment, and the shopper may have been charged. " +
              "Retry the same checkout to confirm it; nothing else is accepted under this intent until then",
          }
        : { error: "paypal_unavailable", message: "PayPal did not create the order; nothing was charged" },
    };
  }
  // A vaulted CAPTURE makes its capture with the order, and the ORDER can be COMPLETED while that capture is PENDING or
  // DECLINED. Only a COMPLETED capture is money received (#225): a pending one is CAPTURE_PENDING (still counted against
  // the intent, settled by PayPal's webhook) and is never shown as paid; a declined one took nothing.
  const capture = created.captureId ? captureOutcome(created.captureStatus) : undefined;
  const status =
    capture === "PENDING" ? "CAPTURE_PENDING" : capture === "DECLINED" ? "CAPTURE_DECLINED" : created.status;
  await deps.db.updateOrder(orderId, {
    status,
    paypalOrderId: created.id,
    captureId: created.captureId,
    capturedAt: capture === "COMPLETED" ? now : undefined,
  });
  await deps.db.appendAudit({
    actor: "api",
    action: "paypal.create_order",
    subjectId: orderId,
    requestBody: {
      paypalOrderId: created.id,
      status: created.status,
      ...(created.captureId ? { captureId: created.captureId, captureStatus: created.captureStatus } : {}),
      customId: pointer,
      intent: paypalIntent,
    },
  });
  if (capture === "DECLINED") {
    return {
      status: 402,
      body: {
        error: "payment_declined",
        message: "PayPal declined the payment from the saved wallet, so nothing was charged",
      },
    };
  }

  return {
    status: 200,
    body: {
      verdict: { outcome, reasons },
      order_id: orderId,
      cart_mandate_jws: cartJws,
      paypal_order_id: created.id,
      ...(created.approvalUrl ? { approval_url: created.approvalUrl } : {}),
      ...(created.captureId ? { capture_id: created.captureId } : {}),
      ...(capture ? { capture_status: capture } : {}),
    },
  };
}

/** Stores the waiting cart and sends the shopper its link. The token exists only in that link. */
async function createStepUp(
  deps: CheckoutDeps,
  st: Omit<StepUpRecord, "id" | "tokenHash"> & { shopperId?: string },
): Promise<void> {
  const { shopperId, ...row } = st;
  const token = randomBytes(32).toString("base64url");
  const id = `stp_${randomUUID()}`;
  await deps.db.createStepUp({ ...row, id, tokenHash: stepUpTokenHash(token) });
  await deps.db.appendAudit({
    actor: "api",
    action: "stepup.created",
    subjectId: id,
    requestBody: {
      intentMandateId: st.intentMandateId,
      cartMandateHash: st.cartMandateHash,
      expiresAt: st.expiresAt,
    },
  });
  // After `#`: a browser never sends the fragment to a server, so no proxy, CDN or access log sees the token (#257).
  const url = `${deps.stepUp.linkBase.replace(/\/+$/, "")}/approve#${token}`;
  await deps.stepUp.send({ stepUpId: id, shopperId, url, expiresAt: st.expiresAt });
}

/**
 * A stored public JWK as a verification key. The row was written by our own key registration; a malformed
 * one makes importJWK throw, which verifyMandate reports as SIGNATURE_INVALID rather than crashing.
 */
const importKey = (k: KeyRecord) => importJWK(k.publicJwk as unknown as JWK, "ES256") as Promise<CryptoKey>;

/** Records a verdict that creates no order (and so no PayPal call). */
async function record(
  deps: CheckoutDeps,
  intentMandateId: string,
  cartId: string,
  outcome: Outcome,
  reasons: ReasonCode[],
  semantic?: unknown,
): Promise<CheckoutResult> {
  await deps.db.recordVerdict({ intentMandateId, cartId, outcome, reasons, semantic });
  await deps.db.appendAudit({
    actor: "api",
    action: "checkout.verdict",
    subjectId: intentMandateId,
    requestBody: { cartId, outcome, reasons, semantic },
  });
  return { status: 200, body: { verdict: { outcome, reasons } } };
}

/** The canonical bytes inside a compact JWS we just produced. */
const verifiedCanonical = (jws: string) => Buffer.from(jws.split(".")[1]!, "base64url").toString("utf8");
