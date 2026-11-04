// Test-only helpers for apps/api: an in-memory Db and signed mandate fixtures.
import { randomUUID } from "node:crypto";
import type { CartMandate, IntentMandate, PaymentMandate } from "@poi/contracts";
import { compliantCart, greyJacketIntent } from "@poi/contracts/fixtures";
import type {
  AuditEntry,
  Db,
  KeyRecord,
  MandateRecord,
  OrderPatch,
  OrderRecord,
  VerdictRecord,
  WebhookEventRecord,
} from "@poi/db";
import { generateSigningKeyPair, mandateHash, signMandate, type SigningKey } from "@poi/mandates";
import { exportJWK } from "jose";

/** In-memory Db with the same once-only semantics as the Postgres constraints. */
export function memoryDb() {
  const nonces = new Set<string>();
  const events = new Map<string, WebhookEventRecord>();
  const keys = new Map<string, KeyRecord & { kind: "shopper" | "agent" }>();
  const mandates = new Map<string, MandateRecord>();
  const orders = new Map<string, OrderRecord & Partial<OrderPatch>>();
  const verdicts: VerdictRecord[] = [];
  const audit: AuditEntry[] = [];
  const db: Db = {
    claimNonce: async (n) => (nonces.has(n) ? false : (nonces.add(n), true)),
    appendAudit: async (e) => void audit.push(e),
    auditTrail: async () => [],
    recordWebhookEvent: async (e) => (events.has(e.eventId) ? false : (events.set(e.eventId, e), true)),
    findKey: async (kind, kid) => {
      const k = keys.get(kid);
      if (!k || k.kind !== kind) return null;
      const { kind: _kind, ...rest } = k;
      return rest;
    },
    saveMandate: async (m) => void (mandates.has(m.hash) || mandates.set(m.hash, m)),
    mandateLedger: async (intentMandateId) => {
      const captured = [...orders.values()].filter(
        (o) => o.intentMandateId === intentMandateId && o.capturedAt,
      );
      return {
        capturedTotal: captured.reduce((s, o) => s + o.totalValue, 0),
        capturedOrderTimes: captured.map((o) => o.capturedAt!),
      };
    },
    recordVerdict: async (v) => void verdicts.push(v),
    createOrder: async (o) => {
      if (orders.has(o.id)) throw new Error("duplicate order id");
      orders.set(o.id, { ...o });
    },
    updateOrder: async (id, p) => {
      const o = orders.get(id);
      if (!o) throw new Error(`order ${id} does not exist`);
      orders.set(id, { ...o, ...Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined)) });
    },
    migrate: async () => [],
    close: async () => {},
  };
  return { db, nonces, events, keys, mandates, orders, verdicts, audit };
}

export interface Party {
  kid: string;
  privateKey: SigningKey;
  publicJwk: Record<string, unknown>;
}

export async function party(kid: string): Promise<Party> {
  const { privateKey, publicKey } = await generateSigningKeyPair();
  return { kid, privateKey, publicJwk: (await exportJWK(publicKey)) as unknown as Record<string, unknown> };
}

/** A signed checkout request: the intent signed by the shopper, the payment by the agent, both bound to `cart`. */
export async function signedCheckout(opts: {
  shopper: Party;
  agent: Party;
  intent?: IntentMandate;
  cart?: CartMandate;
  humanPresent?: boolean;
  platform?: string;
  timestamp?: string;
  paymentMandateId?: string;
}) {
  const intent = opts.intent ?? greyJacketIntent;
  const base = opts.cart ?? compliantCart;
  const cart: CartMandate = {
    ...base,
    intent_mandate_id: intent.mandate_id,
    intent_mandate_hash: mandateHash(intent),
  };
  const payment: PaymentMandate = {
    payment_mandate_id: opts.paymentMandateId ?? randomUUID(),
    cart_mandate_hash: mandateHash(cart),
    intent_mandate_hash: mandateHash(intent),
    agent_key_id: opts.agent.kid,
    agent_platform: opts.platform ?? "Northstar",
    human_present: opts.humanPresent ?? true,
    timestamp: opts.timestamp ?? "2026-11-02T09:59:00Z",
  };
  return {
    intent,
    cart,
    payment,
    body: {
      intent_jws: await signMandate(intent, opts.shopper.privateKey, opts.shopper.kid),
      payment_mandate_jws: await signMandate(payment, opts.agent.privateKey, opts.agent.kid),
      cart,
    },
  };
}
