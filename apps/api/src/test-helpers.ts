// Test-only helpers for apps/api: an in-memory Db and signed mandate fixtures.
import { randomUUID } from "node:crypto";
import type { CartMandate, IntentMandate, PaymentMandate } from "@poi/contracts";
import { compliantCart, greyJacketIntent } from "@poi/contracts/fixtures";
import type {
  AuditEntry,
  AuditRecord,
  Db,
  DisputeRow,
  KeyRecord,
  MandateRecord,
  OrderPatch,
  OrderRecord,
  StoredStepUp,
  VerdictRecord,
  WebhookEventRecord,
} from "@poi/db";
import { generateSigningKeyPair, mandateHash, signMandate, type SigningKey } from "@poi/mandates";
import { exportJWK } from "jose";

/** In-memory Db with the same once-only semantics as the Postgres constraints. */
export function memoryDb() {
  const nonces = new Set<string>();
  const events = new Map<string, WebhookEventRecord>();
  let lastWebhook: { at: string; type: string } | undefined;
  const keys = new Map<string, KeyRecord & { kind: "shopper" | "agent" }>();
  const mandates = new Map<string, MandateRecord>();
  const orders = new Map<string, OrderRecord & Partial<OrderPatch> & { createdAt?: string }>();
  const verdicts: VerdictRecord[] = [];
  const audit: AuditEntry[] = [];
  const processed = new Set<string>();
  const disputes = new Map<string, DisputeRow>();
  const stepups = new Map<string, StoredStepUp>();
  const vaultSetups = new Map<string, { shopperId: string; claimed: boolean }>();
  const page = <T>(rows: T[], p: { limit: number; offset: number }) =>
    rows.slice(p.offset, p.offset + p.limit);
  const db: Db = {
    ping: async () => {},
    claimNonce: async (n) => (nonces.has(n) ? false : (nonces.add(n), true)),
    appendAudit: async (e) => void audit.push(e),
    // Row order stands in for time: ids and timestamps both increase with insertion.
    auditTrail: async (subjectId) =>
      audit.flatMap((a, i): AuditRecord[] =>
        a.subjectId === subjectId
          ? [{ ...a, id: i + 1, at: new Date(Date.UTC(2026, 10, 1) + i * 1000).toISOString() }]
          : [],
      ),
    recordWebhookEvent: async (e) => {
      if (events.has(e.eventId)) return false;
      events.set(e.eventId, e);
      lastWebhook = { at: new Date().toISOString(), type: e.eventType };
      return true;
    },
    webhookStats: async () => ({
      received: events.size,
      lastReceivedAt: lastWebhook?.at ?? null,
      lastEventType: lastWebhook?.type ?? null,
    }),
    findKey: async (kind, kid) => {
      const k = keys.get(kid);
      if (!k || k.kind !== kind) return null;
      const { kind: _kind, ...rest } = k;
      return rest;
    },
    registerShopperKey: async ({ kid, publicJwk }) => {
      const k = keys.get(kid);
      if (k) return { shopperId: k.shopperId!, created: false };
      const shopperId = `shopper_${randomUUID()}`;
      keys.set(kid, { kind: "shopper", kid, publicJwk, shopperId });
      return { shopperId, created: true };
    },
    registerAgentKey: async ({ kid, platform, publicJwk }) =>
      keys.has(kid) ? false : (keys.set(kid, { kind: "agent", kid, publicJwk, platform }), true),
    retireKey: async (kind, kid, at) => {
      const k = keys.get(kid);
      if (!k || k.kind !== kind) return null;
      k.retiredAt ??= new Date(at).toISOString();
      return k.retiredAt;
    },
    createVaultSetup: async (id, shopperId) => void vaultSetups.set(id, { shopperId, claimed: false }),
    claimVaultSetup: async (id, shopperId) => {
      const v = vaultSetups.get(id);
      if (!v || v.shopperId !== shopperId || v.claimed) return false;
      v.claimed = true;
      return true;
    },
    releaseVaultSetup: async (id) => {
      const v = vaultSetups.get(id);
      if (v) v.claimed = false;
    },
    saveVaultId: async (shopperId, vaultId) => {
      for (const k of keys.values()) if (k.shopperId === shopperId) k.vaultId = vaultId;
    },
    countVaultHolders: async (vaultId) => [...keys.values()].filter((k) => k.vaultId === vaultId).length,
    clearVaultId: async (shopperId) => {
      for (const k of keys.values()) if (k.shopperId === shopperId) delete k.vaultId;
    },
    saveMandate: async (m) => void (mandates.has(m.hash) || mandates.set(m.hash, m)),
    mandateLedger: async (intentMandateId, asOfOrderId) => {
      const asOf = asOfOrderId ? orders.get(asOfOrderId)?.createdAt : undefined;
      const captured = [...orders.values()].filter(
        (o) =>
          o.intentMandateId === intentMandateId &&
          o.capturedAt &&
          (!asOfOrderId || (o.id !== asOfOrderId && asOf && o.capturedAt < asOf)),
      );
      return {
        capturedTotal: captured.reduce((s, o) => s + o.totalValue, 0),
        capturedOrderTimes: captured.map((o) => o.capturedAt!),
      };
    },
    recordVerdict: async (v) => void verdicts.push(v),
    createOrder: async (o) => {
      if (orders.has(o.id)) throw new Error("duplicate order id");
      orders.set(o.id, { ...o, createdAt: new Date().toISOString() });
    },
    getOrder: async (id) => orders.get(id) ?? null,
    getMandate: async (hash) => mandates.get(hash) ?? null,
    updateOrder: async (id, p) => {
      const o = orders.get(id);
      if (!o) throw new Error(`order ${id} does not exist`);
      orders.set(id, { ...o, ...Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined)) });
    },
    orderVerdict: async (orderId) => verdicts.findLast((v) => v.orderId === orderId) ?? null,
    listOrders: async (p) => page([...orders.values()].reverse(), p),
    listVerdicts: async (p) =>
      page(verdicts.map((v, i) => ({ ...v, id: i + 1, createdAt: new Date().toISOString() })).reverse(), p),
    createStepUp: async (st) => {
      if (stepups.has(st.id) || [...stepups.values()].some((x) => x.tokenHash === st.tokenHash))
        throw new Error("duplicate step-up");
      stepups.set(st.id, { ...st, status: "PENDING", createdAt: new Date().toISOString() });
    },
    findStepUp: async (tokenHash) => {
      const st = [...stepups.values()].find((x) => x.tokenHash === tokenHash);
      return st ? { ...st } : null;
    },
    findStepUpById: async (id) => {
      const st = stepups.get(id);
      return st ? { ...st } : null;
    },
    listPendingStepUps: async (kid, now) =>
      [...stepups.values()]
        .filter(
          (x) => x.shopperKid === kid && x.status === "PENDING" && Date.parse(x.expiresAt) > Date.parse(now),
        )
        .reverse()
        .map((x) => ({ ...x })),
    claimStepUp: async (id, now) => {
      const st = stepups.get(id);
      if (!st || st.status !== "PENDING" || Date.parse(st.expiresAt) <= Date.parse(now)) return false;
      st.status = "APPROVING";
      return true;
    },
    finishStepUp: async (id, { status, orderId, approvedAt }) => {
      const st = stepups.get(id);
      if (!st) throw new Error(`step-up ${id} does not exist`);
      Object.assign(st, { status }, orderId ? { orderId } : {}, approvedAt ? { approvedAt } : {});
    },
    pendingDisputeEvents: async (limit) =>
      [...events.values()]
        .filter((e) => !processed.has(e.eventId) && e.eventType.startsWith("CUSTOMER.DISPUTE."))
        .slice(0, limit)
        .map(({ eventId, eventType, payload }) => ({ eventId, eventType, payload })),
    markEventProcessed: async (eventId) => void processed.add(eventId),
    saveDispute: async (d) => {
      const prev = disputes.get(d.id);
      if (prev?.paypalUpdatedAt && d.paypalUpdatedAt && d.paypalUpdatedAt < prev.paypalUpdatedAt)
        return false;
      disputes.set(d.id, { ...d, createdAt: d.createdAt ?? prev?.createdAt ?? new Date().toISOString() });
      return true;
    },
    getDispute: async (id) => disputes.get(id) ?? null,
    listDisputes: async (p) =>
      page(
        [...disputes.values()]
          .sort((a, b) => (a.sellerResponseDueDate ?? "~").localeCompare(b.sellerResponseDueDate ?? "~"))
          .map(({ evidencePdf, ...d }) => ({ ...d, hasEvidencePdf: evidencePdf !== undefined })),
        p,
      ),
    migrate: async () => [],
    close: async () => {},
  };
  return {
    db,
    nonces,
    events,
    keys,
    mandates,
    orders,
    verdicts,
    audit,
    disputes,
    processed,
    stepups,
    vaultSetups,
  };
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
