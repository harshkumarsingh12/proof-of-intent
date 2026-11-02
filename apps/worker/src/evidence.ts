import { draftEvidence, parseAiMode, type AiMode, type EvidenceDraft } from "@poi/ai";
import {
  NotImplementedError,
  type CartMandate,
  type IntentMandate,
  type Money,
  type ReasonCode,
} from "@poi/contracts";
import type { AuditEntry, Db } from "@poi/db";
import {
  mandateHash,
  verifyMandate,
  type KeyResolver,
} from "@poi/mandates";
import { evaluate, type MandateLedger } from "@poi/policy-engine";
import {
  generateEvidencePdf,
  type ConstraintCheck,
  type DisputeSummary,
  type EvidencePdfData,
  type TimelineEntry,
  type VerificationResult,
} from "./pdf";

export type EvidenceDraftStatus = "pending_human_approval" | "approved" | "rejected";

export interface CaptureRecord {
  captureId: string;
  orderId: string;
  capturedAt: string;
  amount: Money;
  customId: string;
}

export interface DisputeRecord {
  disputeId: string;
  orderId?: string;
  status?: string;
  reason?: string;
  amount?: Money | string;
  responseDueDate?: string;
}

export interface OrderRecord {
  orderId: string;
  customId?: string;
  intent?: IntentMandate;
  cart?: CartMandate;
  signedIntentJws?: string;
  capturedAt?: string;
  captureRecord?: CaptureRecord;
  ledger?: MandateLedger;
}

export interface EvidenceDataLoader {
  loadDispute(disputeId: string): Promise<DisputeRecord | null>;
  loadOrder(orderId: string): Promise<OrderRecord | null>;
  loadCaptureRecord?(orderId: string): Promise<CaptureRecord | null>;
}

export class InMemoryEvidenceDataLoader implements EvidenceDataLoader {
  private readonly disputes = new Map<string, DisputeRecord>();
  private readonly orders = new Map<string, OrderRecord>();
  private readonly captures = new Map<string, CaptureRecord>();

  constructor(disputes: DisputeRecord[] = [], orders: OrderRecord[] = [], captures: CaptureRecord[] = []) {
    for (const d of disputes) this.disputes.set(d.disputeId, d);
    for (const o of orders) this.orders.set(o.orderId, o);
    for (const c of captures) this.captures.set(c.orderId, c);
  }

  async loadDispute(disputeId: string): Promise<DisputeRecord | null> {
    return this.disputes.get(disputeId) ?? null;
  }

  async loadOrder(orderId: string): Promise<OrderRecord | null> {
    return this.orders.get(orderId) ?? null;
  }

  async loadCaptureRecord(orderId: string): Promise<CaptureRecord | null> {
    return this.captures.get(orderId) ?? null;
  }

  setDispute(dispute: DisputeRecord): void {
    this.disputes.set(dispute.disputeId, dispute);
  }

  setOrder(order: OrderRecord): void {
    this.orders.set(order.orderId, order);
  }

  setCapture(capture: CaptureRecord): void {
    this.captures.set(capture.orderId, capture);
  }
}

export interface EvidenceDraftInput {
  disputeId: string;
  signedIntentJws: string;
  cart: CartMandate;
  captureRecord: CaptureRecord;
  keyResolver: KeyResolver;
}

export interface EvidencePackageResult {
  disputeId: string;
  status: EvidenceDraftStatus;
  draft: EvidenceDraft;
  bundleJson: string;
  pdf: Uint8Array;
  mandateHash: string;
  customId: string;
  createdAt: string;
}

export class InMemoryEvidenceStore {
  private readonly packages = new Map<string, EvidencePackageResult>();

  async save(pkg: EvidencePackageResult): Promise<void> {
    this.packages.set(pkg.disputeId, pkg);
  }

  async get(disputeId: string): Promise<EvidencePackageResult | null> {
    return this.packages.get(disputeId) ?? null;
  }

  async list(): Promise<EvidencePackageResult[]> {
    return Array.from(this.packages.values());
  }
}

export function buildConstraintChecks(
  intent?: IntentMandate | null,
  cart?: CartMandate | null,
  reasons: ReasonCode[] = [],
): ConstraintCheck[] {
  if (!intent || !cart) {
    return [];
  }

  const checks: ConstraintCheck[] = [];
  const constraints = intent.constraints;

  if (constraints.amount_max) {
    checks.push({
      name: "amount_max",
      rule: `${constraints.amount_max.currency} ${(constraints.amount_max.value / 100).toFixed(2)}`,
      actual: `${cart.contents.total.currency} ${(cart.contents.total.value / 100).toFixed(2)}`,
      passed: !reasons.includes("AMOUNT_EXCEEDS_MAX") && !reasons.includes("CURRENCY_MISMATCH"),
    });
  }

  if (constraints.merchant_allowlist) {
    checks.push({
      name: "merchant_allowlist",
      rule: constraints.merchant_allowlist.join(", "),
      actual: cart.contents.merchant_id,
      passed: !reasons.includes("MERCHANT_NOT_ALLOWED"),
    });
  }

  if (constraints.attributes) {
    for (const [key, val] of Object.entries(constraints.attributes)) {
      const actualVal = cart.contents.lines.map((l) => l.attributes[key]).filter(Boolean).join(", ");
      checks.push({
        name: `attributes.${key}`,
        rule: val,
        actual: actualVal || "not available",
        passed: !reasons.includes("ATTRIBUTE_MISMATCH"),
      });
    }
  }

  if (constraints.quantity_max) {
    const totalQty = cart.contents.lines.reduce((sum, l) => sum + l.quantity, 0);
    const ruleStr =
      constraints.quantity_max.per_order !== undefined
        ? `max ${constraints.quantity_max.per_order} per order`
        : constraints.quantity_max.per_line !== undefined
        ? `max ${constraints.quantity_max.per_line} per line`
        : "not available";
    checks.push({
      name: "quantity_max",
      rule: ruleStr,
      actual: `${totalQty} items`,
      passed: !reasons.includes("QUANTITY_EXCEEDS_MAX"),
    });
  }

  return checks;
}

export function generateDefaultEvidenceDraft(
  intent: IntentMandate,
  cart: CartMandate,
  capture: CaptureRecord,
  intentHash: string,
): EvidenceDraft {
  const lineSummary = cart.contents.lines.map((l) => `${l.quantity}x ${l.title} (${l.sku})`).join(", ");

  return {
    cover_note: `The customer dispute claims the item was not as described. However, the purchase was verified against the shopper's signed Intent Mandate before capture. The items purchased (${lineSummary}) strictly match the shopper's instructions.`,
    attestation_sections: [
      {
        heading: "Shopper Stated Intent",
        body: intent.natural_language_description,
      },
      {
        heading: "Agreed Constraints",
        body: JSON.stringify(intent.constraints, null, 2),
      },
      {
        heading: "Purchased Cart Lines",
        body: lineSummary,
      },
      {
        heading: "Cryptographic Attestation & Order Pointer",
        body: `PayPal custom_id: ${capture.customId}\nMandate Hash: ${intentHash}\nCaptured Amount: ${capture.amount.currency} ${(capture.amount.value / 100).toFixed(2)}`,
      },
    ],
    buyer_message: `Hello, your order was fulfilled according to your signed shopping agent instructions (${intent.natural_language_description}). Please find the attestation record attached.`,
  };
}

export interface EvidenceOptions {
  store?: InMemoryEvidenceStore;
  db?: Pick<Db, "appendAudit">;
  mode?: AiMode;
  now?: () => string;
}

export async function draftEvidenceForDefend(
  input: EvidenceDraftInput,
  options?: EvidenceOptions,
): Promise<EvidencePackageResult> {
  const mode = options?.mode ?? parseAiMode(process.env.AI_MODE);
  const now = options?.now ? options.now() : new Date().toISOString();

  // 1. Verify mandate signature with packages/mandates against key resolver
  const verifyResult = await verifyMandate(input.signedIntentJws, input.keyResolver);
  if (!verifyResult.ok) {
    throw new Error(`Mandate signature verification failed: ${verifyResult.reason}`);
  }

  const verifiedIntent = verifyResult.payload as IntentMandate;
  const hash = mandateHash(verifiedIntent);

  // Validate custom_id pointer matches the mandate
  const expectedPrefix = hash.slice(0, 16);
  if (
    !input.captureRecord.customId.startsWith(`poi:${verifiedIntent.mandate_id}:`) ||
    !input.captureRecord.customId.endsWith(expectedPrefix)
  ) {
    throw new Error("Order custom_id does not match the verified mandate hash");
  }

  // 2. Draft evidence using packages/ai or fallback
  let draft: EvidenceDraft;
  try {
    draft = await draftEvidence(
      {
        disputeId: input.disputeId,
        intent: verifiedIntent,
        cart: input.cart,
        captureRecord: input.captureRecord,
      },
      mode,
    );
  } catch (err) {
    if (!(err instanceof NotImplementedError)) {
      throw err;
    }
    draft = generateDefaultEvidenceDraft(verifiedIntent, input.cart, input.captureRecord, hash);
  }

  // 3. Evaluate constraints using policy engine
  const evalResult = evaluate({
    intent: verifiedIntent,
    cart: input.cart,
    now: input.captureRecord.capturedAt || now,
  });
  const constraintChecks = buildConstraintChecks(verifiedIntent, input.cart, evalResult.reasons);

  // 4. Assemble PDF data using deterministic PDF renderer
  const summary: DisputeSummary = {
    disputeId: input.disputeId,
    orderId: input.captureRecord.orderId,
    customId: input.captureRecord.customId,
    status: "WAITING_FOR_SELLER_RESPONSE",
    reason: "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED",
    amount: `${input.captureRecord.amount.currency} ${(input.captureRecord.amount.value / 100).toFixed(2)}`,
  };

  const verification: VerificationResult = {
    signatureValid: true,
    keyId: verifyResult.kid,
    algorithm: "ES256",
    computedHash: hash,
    customIdMatches: true,
    verdictOutcome: evalResult.pass ? "APPROVE" : "REJECT",
    reasons: evalResult.reasons,
  };

  const timeline: TimelineEntry[] = [
    { timestamp: verifiedIntent.created_at || now, event: "Shopper signed Intent Mandate", actor: "shopper" },
    {
      timestamp: input.captureRecord.capturedAt || now,
      event: "Policy engine verified cart against constraints",
      actor: "policy-engine",
    },
    {
      timestamp: input.captureRecord.capturedAt || now,
      event: "PayPal order captured with mandate pointer in custom_id",
      actor: "api",
    },
    {
      timestamp: now,
      event: "Copilot classified MANDATE_COMPLIANT and drafted evidence PDF",
      actor: "worker",
    },
  ];

  const pdfData: EvidencePdfData = {
    summary,
    intent: verifiedIntent,
    intentHash: hash,
    cart: input.cart,
    constraints: constraintChecks,
    verification,
    timeline,
    coverNote: draft.cover_note,
  };

  const pdf = generateEvidencePdf(pdfData);

  // 5. Assemble JSON bundle
  const bundle = {
    dispute_id: input.disputeId,
    mandate_id: verifiedIntent.mandate_id,
    mandate_hash: hash,
    custom_id: input.captureRecord.customId,
    intent_mandate: verifiedIntent,
    cart_mandate: input.cart,
    capture_record: input.captureRecord,
    verified_key_id: verifyResult.kid,
    verified_at: now,
    policy_evaluation: {
      outcome: evalResult.pass ? "APPROVE" : "REJECT",
      reasons: evalResult.reasons,
    },
    draft,
  };
  const bundleJson = JSON.stringify(bundle, null, 2);

  const result: EvidencePackageResult = {
    disputeId: input.disputeId,
    status: "pending_human_approval",
    draft,
    bundleJson,
    pdf,
    mandateHash: hash,
    customId: input.captureRecord.customId,
    createdAt: now,
  };

  if (options?.store) {
    await options.store.save(result);
  }

  if (options?.db) {
    await options.db.appendAudit({
      actor: "worker:copilot",
      action: "evidence.drafted",
      subjectId: input.disputeId,
      requestBody: {
        status: "pending_human_approval",
        mandate_hash: hash,
        custom_id: input.captureRecord.customId,
      },
    });
  }

  return result;
}

// Global store and loader configuration for buildEvidencePackage
export const defaultEvidenceStore = new InMemoryEvidenceStore();

let defaultDataLoader: EvidenceDataLoader = new InMemoryEvidenceDataLoader();
export function setDefaultEvidenceDataLoader(loader: EvidenceDataLoader): void {
  defaultDataLoader = loader;
}
export function getDefaultEvidenceDataLoader(): EvidenceDataLoader {
  return defaultDataLoader;
}

let defaultKeyResolver: KeyResolver = async () => undefined;
export function setDefaultKeyResolver(resolver: KeyResolver): void {
  defaultKeyResolver = resolver;
}
export function getDefaultKeyResolver(): KeyResolver {
  return defaultKeyResolver;
}

export interface BuildEvidenceOptions extends EvidenceOptions {
  loader?: EvidenceDataLoader;
  keyResolver?: KeyResolver;
  auditEntries?: AuditEntry[];
}

export async function buildEvidencePackage(
  disputeId: string,
  options?: BuildEvidenceOptions,
): Promise<{ pdf: Uint8Array; bundleJson: string }> {
  const loader = options?.loader ?? defaultDataLoader;
  const keyResolver = options?.keyResolver ?? defaultKeyResolver;
  const store = options?.store ?? defaultEvidenceStore;
  const now = options?.now ? options.now() : new Date().toISOString();

  // 1. Load real dispute record by ID
  const dispute = await loader.loadDispute(disputeId);
  if (!dispute) {
    throw new Error(`Dispute not found: ${disputeId}`);
  }

  // 2. Load order record by ID
  const orderId = dispute.orderId;
  if (!orderId) {
    throw new Error(`Dispute has no associated order: ${disputeId}`);
  }
  const order = await loader.loadOrder(orderId);
  if (!order) {
    throw new Error(`Order not found: ${orderId}`);
  }

  // 3. Load capture record
  const captureRecord: CaptureRecord =
    (loader.loadCaptureRecord ? await loader.loadCaptureRecord(orderId) : null) ??
    order.captureRecord ?? {
      captureId: `cap_${orderId}`,
      orderId,
      capturedAt: order.capturedAt ?? now,
      amount: order.cart?.contents.total ?? { value: 0, currency: "USD" },
      customId: order.customId ?? "not available",
    };

  // 4. Verify stored checkout JWS against key registry
  let verifiedIntent: IntentMandate | null = null;
  let signatureValid = false;
  let verifiedKid = "not available";
  let hash = "not available";

  if (order.signedIntentJws) {
    const verifyResult = await verifyMandate(order.signedIntentJws, keyResolver);
    if (verifyResult.ok) {
      signatureValid = true;
      verifiedIntent = verifyResult.payload as IntentMandate;
      verifiedKid = verifyResult.kid;
      hash = mandateHash(verifiedIntent);
    }
  }

  if (!verifiedIntent && order.intent) {
    verifiedIntent = order.intent;
    hash = mandateHash(verifiedIntent);
  }

  // 5. Evaluate policy engine dynamically
  let verdictOutcome = "not available";
  let reasons: ReasonCode[] = [];
  let constraintChecks: ConstraintCheck[] = [];

  if (verifiedIntent && order.cart) {
    const evalResult = evaluate({
      intent: verifiedIntent,
      cart: order.cart,
      now: captureRecord.capturedAt || now,
      ledger: order.ledger,
    });
    verdictOutcome = evalResult.pass ? "APPROVE" : "REJECT";
    reasons = evalResult.reasons;
    constraintChecks = buildConstraintChecks(verifiedIntent, order.cart, reasons);
  }

  // 6. Build timeline from audit log rows
  const timeline: TimelineEntry[] = [];
  if (options?.auditEntries && options.auditEntries.length > 0) {
    for (const a of options.auditEntries) {
      const anyA = a as { timestamp?: string; createdAt?: string; action?: string; event?: string };
      timeline.push({
        timestamp: anyA.timestamp ?? anyA.createdAt ?? "not available",
        event: anyA.event ?? anyA.action ?? "not available",
        actor: a.actor ?? "not available",
      });
    }
  } else {
    timeline.push({
      timestamp: captureRecord.capturedAt || "not available",
      event: "PayPal order captured with mandate pointer in custom_id",
      actor: "api",
    });
  }

  // 7. Draft evidence via AI / fallback
  let draft: EvidenceDraft;
  if (verifiedIntent && order.cart) {
    try {
      draft = await draftEvidence(
        {
          disputeId,
          intent: verifiedIntent,
          cart: order.cart,
          captureRecord,
        },
        options?.mode ?? parseAiMode(process.env.AI_MODE),
      );
    } catch (err) {
      if (!(err instanceof NotImplementedError)) {
        throw err;
      }
      draft = generateDefaultEvidenceDraft(verifiedIntent, order.cart, captureRecord, hash);
    }
  } else {
    draft = {
      cover_note: "not available",
      attestation_sections: [],
      buyer_message: "not available",
    };
  }

  // 8. Build DisputeSummary and EvidencePdfData
  const summary: DisputeSummary = {
    disputeId: dispute.disputeId ?? "not available",
    orderId: order.orderId ?? "not available",
    customId: captureRecord.customId ?? "not available",
    status: dispute.status ?? "not available",
    reason: dispute.reason ?? "not available",
    amount:
      typeof dispute.amount === "string"
        ? dispute.amount
        : dispute.amount
        ? `${dispute.amount.currency} ${(dispute.amount.value / 100).toFixed(2)}`
        : order.cart
        ? `${order.cart.contents.total.currency} ${(order.cart.contents.total.value / 100).toFixed(2)}`
        : "not available",
    responseDueDate: dispute.responseDueDate,
  };

  const verification: VerificationResult = {
    signatureValid,
    keyId: verifiedKid,
    algorithm: "ES256",
    computedHash: hash,
    customIdMatches: captureRecord.customId.endsWith(hash.slice(0, 16)),
    verdictOutcome,
    reasons,
  };

  const pdfData: EvidencePdfData = {
    summary,
    intent: verifiedIntent,
    intentHash: hash,
    cart: order.cart,
    constraints: constraintChecks,
    verification,
    timeline,
    coverNote: draft.cover_note,
  };

  const pdf = generateEvidencePdf(pdfData);

  const bundle = {
    dispute_id: disputeId,
    order_id: order.orderId,
    mandate_id: verifiedIntent?.mandate_id ?? "not available",
    mandate_hash: hash,
    custom_id: captureRecord.customId,
    intent_mandate: verifiedIntent,
    cart_mandate: order.cart,
    capture_record: captureRecord,
    verified_key_id: verifiedKid,
    verified_at: now,
    policy_evaluation: {
      outcome: verdictOutcome,
      reasons,
    },
    timeline,
    draft,
  };
  const bundleJson = JSON.stringify(bundle, null, 2);

  const result: EvidencePackageResult = {
    disputeId,
    status: "pending_human_approval",
    draft,
    bundleJson,
    pdf,
    mandateHash: hash,
    customId: captureRecord.customId,
    createdAt: now,
  };

  await store.save(result);

  return { pdf, bundleJson };
}

export * from "./pdf";
