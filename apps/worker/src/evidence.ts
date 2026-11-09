/**
 * Evidence package for MANDATE_COMPLIANT disputes (docs/specs/0005): attestation PDF + JSON bundle.
 * It refuses rather than invents: no verified signature, no matching custom_id, no capture record,
 * or a cart that fails the hard rules means no defence package.
 */
import { draftEvidence, isAiUnavailable, parseAiMode, type AiMode, type EvidenceDraft } from "@poi/ai";
import { type CartMandate, type IntentMandate, type Money, type ReasonCode } from "@poi/contracts";
import type { Db } from "@poi/db";
import { mandateHash, verifyMandate, type KeyResolver } from "@poi/mandates";
import { evaluate, type MandateLedger } from "@poi/policy-engine";
import {
  parseCustomId,
  disputeFacts,
  runDisputeClassifier,
  type CaptureRecord,
  type DisputeDataLoader,
  type DisputeRecord,
} from "./classifier";
import { generateEvidencePdf, type ConstraintCheck, type TimelineEntry } from "./pdf";

export type EvidenceDraftStatus = "pending_human_approval" | "approved" | "rejected";

export interface EvidenceRequirement {
  id: string;
  label: string;
  description: string;
}

export const REQUIRED_EVIDENCE_BY_REASON: Record<string, EvidenceRequirement[]> = {
  MERCHANDISE_OR_SERVICE_NOT_RECEIVED: [
    { id: "signed_intent_mandate", label: "Signed Intent Mandate", description: "Verified shopper purchase authorization and constraints" },
    { id: "cart_mandate", label: "Cart Mandate", description: "Itemized cart contents evaluated against constraints" },
    { id: "proof_of_fulfillment", label: "Proof of Fulfillment", description: "Carrier shipment tracking or proof of delivery" },
  ],
  MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED: [
    { id: "signed_intent_mandate", label: "Signed Intent Mandate", description: "Shopper specifications and item attribute constraints" },
    { id: "cart_mandate", label: "Cart Mandate", description: "Purchased line items and attribute tags" },
    { id: "constraint_evaluation", label: "Policy Evaluation", description: "Deterministic rule check proving item attributes match" },
  ],
  UNAUTHORISED: [
    { id: "signed_intent_mandate", label: "Signed Intent Mandate", description: "Cryptographically verified shopper signature" },
    { id: "order_pointer_match", label: "Order Pointer Verification", description: "PayPal order custom_id bound to mandate hash" },
  ],
  INCORRECT_AMOUNT: [
    { id: "signed_intent_mandate", label: "Signed Intent Mandate", description: "Shopper budget ceiling constraint" },
    { id: "capture_record", label: "Capture Record", description: "Settled transaction amount matching authorized total" },
  ],
};

export interface EvidenceRequirementsReport {
  disputeReason: string;
  required: string[];
  available: string[];
  missing: string[];
  deliveryEvidence: "confirmed" | "not available";
  details: Array<{
    id: string;
    label: string;
    status: "available" | "missing";
    value?: string;
  }>;
}

export function evaluateEvidenceRequirements(
  disputeReason?: string,
  records?: {
    hasMandate?: boolean;
    hasCart?: boolean;
    hasCapture?: boolean;
    hasPolicyEvaluation?: boolean;
    hasOrderPointer?: boolean;
    tracking?: { trackingNumber?: string; carrier?: string };
  },
): EvidenceRequirementsReport {
  const reason = disputeReason ?? "UNKNOWN";
  const requirements = REQUIRED_EVIDENCE_BY_REASON[reason] ?? [
    { id: "signed_intent_mandate", label: "Signed Intent Mandate", description: "Verified shopper purchase authorization" },
    { id: "cart_mandate", label: "Cart Mandate", description: "Itemized cart contents" },
  ];

  const hasTracking = Boolean(records?.tracking?.trackingNumber);
  const isAvailable = (id: string): boolean => {
    switch (id) {
      case "signed_intent_mandate":
        return Boolean(records?.hasMandate);
      case "cart_mandate":
        return Boolean(records?.hasCart);
      case "proof_of_fulfillment":
        return hasTracking;
      case "constraint_evaluation":
        return Boolean(records?.hasPolicyEvaluation);
      case "order_pointer_match":
        return Boolean(records?.hasOrderPointer);
      case "capture_record":
        return Boolean(records?.hasCapture);
      default:
        return false;
    }
  };

  const details = requirements.map((req) => {
    const available = isAvailable(req.id);
    let value: string | undefined;
    if (req.id === "proof_of_fulfillment") {
      value = hasTracking
        ? `${records?.tracking?.carrier ?? "Carrier"}: ${records?.tracking?.trackingNumber}`
        : "not available";
    }
    return {
      id: req.id,
      label: req.label,
      status: available ? ("available" as const) : ("missing" as const),
      value,
    };
  });

  const requiredIds = requirements.map((r) => r.id);
  const availableIds = details.filter((d) => d.status === "available").map((d) => d.id);
  const missingIds = details.filter((d) => d.status === "missing").map((d) => d.id);

  return {
    disputeReason: reason,
    required: requiredIds,
    available: availableIds,
    missing: missingIds,
    deliveryEvidence: hasTracking ? "confirmed" : "not available",
    details,
  };
}

export interface EvidenceDraftInput {
  dispute: DisputeRecord;
  signedIntentJws: string;
  cart: CartMandate;
  captureRecord: CaptureRecord;
  keyResolver: KeyResolver;
  ledger?: MandateLedger;
  /** audit_log rows for this order and dispute. Until packages/db lands, the caller passes them in. */
  auditTrail?: TimelineEntry[];
  tracking?: { trackingNumber?: string; carrier?: string; status?: string };
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
  evidenceReport?: EvidenceRequirementsReport;
}

export class InMemoryEvidenceStore {
  private readonly packages = new Map<string, EvidencePackageResult>();

  async save(pkg: EvidencePackageResult): Promise<void> {
    this.packages.set(pkg.disputeId, pkg);
  }

  async get(disputeId: string): Promise<EvidencePackageResult | null> {
    return this.packages.get(disputeId) ?? null;
  }
}

export interface EvidenceOptions {
  store?: InMemoryEvidenceStore;
  db?: Pick<Db, "appendAudit">;
  mode?: AiMode;
  now?: () => string;
}

const money = (m: Money) => `${m.currency} ${(m.value / 100).toFixed(2)}`;

export function buildConstraintChecks(
  intent: IntentMandate,
  cart: CartMandate,
  reasons: ReasonCode[] = [],
): ConstraintCheck[] {
  const c = intent.constraints;
  const checks: ConstraintCheck[] = [];
  if (c.amount_max) {
    checks.push({
      name: "amount_max",
      rule: money(c.amount_max),
      actual: money(cart.contents.total),
      passed: !reasons.includes("AMOUNT_EXCEEDS_MAX") && !reasons.includes("CURRENCY_MISMATCH"),
    });
  }
  if (c.merchant_allowlist) {
    checks.push({
      name: "merchant_allowlist",
      rule: c.merchant_allowlist.join(", "),
      actual: cart.contents.merchant_id,
      passed: !reasons.includes("MERCHANT_NOT_ALLOWED"),
    });
  }
  for (const [key, val] of Object.entries(c.attributes ?? {})) {
    // One check per attribute, judged the way the policy engine judges it (exact, case-insensitive, and a line
    // without the attribute fails): the engine reports one ATTRIBUTE_MISMATCH for all of them, so reading that
    // code would mark a matching category as broken whenever the color was wrong.
    const norm = (t: string) => t.trim().toLowerCase();
    const have = (line: CartMandate["contents"]["lines"][number]) =>
      Object.entries(line.attributes).find(([k]) => norm(k) === norm(key))?.[1];
    checks.push({
      name: `attributes.${key}`,
      rule: val,
      actual:
        cart.contents.lines
          .map((l) => l.attributes[key])
          .filter(Boolean)
          .join(", ") || "not available",
      passed: cart.contents.lines.every((l) => {
        const got = have(l);
        return got !== undefined && norm(got) === norm(val);
      }),
    });
  }
  if (c.quantity_max) {
    const q = c.quantity_max;
    checks.push({
      name: "quantity_max",
      rule: q.per_order !== undefined ? `max ${q.per_order} per order` : `max ${q.per_line} per line`,
      actual: `${cart.contents.lines.reduce((n, l) => n + l.quantity, 0)} items`,
      passed: !reasons.includes("QUANTITY_EXCEEDS_MAX"),
    });
  }
  return checks;
}

/** Rule-only fallback when J3 cannot supply a grounded draft. */
export function generateDefaultEvidenceDraft(
  intent: IntentMandate,
  cart: CartMandate,
  capture: CaptureRecord,
  intentHash: string,
  disputeReason?: string,
  evidenceReport?: EvidenceRequirementsReport,
): EvidenceDraft {
  const lines = cart.contents.lines.map((l) => `${l.quantity}x ${l.title} (${l.sku})`).join(", ");
  const deliveryStatus = evidenceReport?.deliveryEvidence ?? "not available";
  const missingFulfillment = evidenceReport?.missing.includes("proof_of_fulfillment");

  const sections: Array<{ heading: string; body: string }> = [
    { heading: "Shopper Stated Intent", body: intent.natural_language_description },
    { heading: "Agreed Constraints", body: JSON.stringify(intent.constraints, null, 2) },
    { heading: "Purchased Cart Lines", body: lines },
    {
      heading: "Cryptographic Attestation & Order Pointer",
      body: `PayPal custom_id: ${capture.customId}\nMandate Hash: ${intentHash}\nCaptured Amount: ${money(capture.amount)}`,
    },
  ];

  if (disputeReason === "MERCHANDISE_OR_SERVICE_NOT_RECEIVED" || missingFulfillment) {
    sections.push({
      heading: "Delivery & Fulfillment Evidence",
      body: `Delivery evidence: ${deliveryStatus}`,
    });
  }

  const fulfillmentNote = missingFulfillment
    ? " Proof of fulfillment/delivery: not available."
    : "";

  return {
    cover_note:
      `The buyer opened a dispute${disputeReason ? ` (${disputeReason})` : ""}. Before PayPal captured payment, ` +
      `the cart (${lines}) was checked against the shopper's signed Intent Mandate and passed every hard rule. ` +
      `The signed mandate, its hash and the matching custom_id on the PayPal order are attached.${fulfillmentNote}`,
    attestation_sections: sections,
    buyer_message: `Hello, this order matched the instructions you signed for your shopping agent ("${intent.natural_language_description}"). The signed record is attached.`,
  };
}

export async function draftEvidenceForDefend(
  input: EvidenceDraftInput,
  options: EvidenceOptions = {},
): Promise<EvidencePackageResult> {
  const now = options.now ? options.now() : new Date().toISOString();
  const { dispute, cart, captureRecord } = input;

  const verified = await verifyMandate(input.signedIntentJws, input.keyResolver);
  if (!verified.ok) throw new Error(`Mandate signature verification failed: ${verified.reason}`);
  const intent = verified.payload as IntentMandate;
  const hash = mandateHash(intent);

  const pointer = parseCustomId(captureRecord.customId);
  if (!pointer || pointer.mandateId !== intent.mandate_id || pointer.hashPrefix !== hash.slice(0, 16)) {
    throw new Error("Order custom_id does not match the verified mandate hash");
  }

  const evalResult = evaluate({ intent, cart, now: captureRecord.capturedAt, ledger: input.ledger });
  if (!evalResult.pass) {
    throw new Error(
      `Cart fails the hard rules (${evalResult.reasons.join(", ")}); this dispute should be conceded, not defended`,
    );
  }

  const evidenceReport = evaluateEvidenceRequirements(dispute.reason, {
    hasMandate: verified.ok,
    hasCart: Boolean(cart),
    hasCapture: Boolean(captureRecord),
    hasPolicyEvaluation: evalResult.pass,
    hasOrderPointer: Boolean(pointer),
    tracking: input.tracking,
  });

  let generated: Awaited<ReturnType<typeof draftEvidence>> | undefined;
  try {
    generated = await draftEvidence(
      {
        decision: { class: "MANDATE_COMPLIANT", action: "PROVIDE_EVIDENCE" },
        bundle: {
          // Not the buyer's note: J3 writes the text sent to PayPal under the merchant's name, so buyer-written
          // words stay out of its input (J2, which only explains, still sees them).
          ...disputeFacts({ ...dispute, buyerNote: undefined }, intent, cart),
          capture_record: `PayPal recorded a capture of ${money(captureRecord.amount)}.`,
          policy_evaluation:
            "The Intent Mandate signature verified, the order pointer matched and every hard rule passed.",
        },
      },
      options.mode ?? parseAiMode(process.env.AI_MODE),
    );
  } catch (err) {
    if (!isAiUnavailable(err)) throw err;
  }
  const draft = generated ?? generateDefaultEvidenceDraft(intent, cart, captureRecord, hash, dispute.reason, evidenceReport);

  // Only events with a real timestamp: the signed mandate, the capture, audit rows, and this draft.
  const timeline: TimelineEntry[] = [
    { timestamp: intent.created_at, event: "Shopper signed Intent Mandate", actor: "shopper" },
    {
      timestamp: captureRecord.capturedAt,
      event: `PayPal capture ${captureRecord.captureId} with custom_id ${captureRecord.customId}`,
      actor: "paypal",
    },
    ...(input.auditTrail ?? []),
    { timestamp: now, event: "Copilot drafted this evidence package for operator review", actor: "worker" },
  ].sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  const pdf = generateEvidencePdf({
    summary: {
      disputeId: dispute.disputeId,
      orderId: captureRecord.orderId,
      customId: captureRecord.customId,
      status: dispute.status ?? "not available",
      reason: dispute.reason ?? "not available",
      amount: money(dispute.amount ?? captureRecord.amount),
      responseDueDate: dispute.responseDueDate,
    },
    intent,
    intentHash: hash,
    cart,
    constraints: buildConstraintChecks(intent, cart, evalResult.reasons),
    verification: {
      signatureValid: true,
      keyId: verified.kid,
      algorithm: "ES256",
      computedHash: hash,
      customIdMatches: true,
      verdictOutcome: "APPROVE",
      reasons: evalResult.reasons,
    },
    timeline,
    coverNote: draft.cover_note,
  });

  const bundleJson = JSON.stringify(
    {
      dispute_id: dispute.disputeId,
      dispute_reason: dispute.reason ?? "not available",
      order_id: captureRecord.orderId,
      mandate_id: intent.mandate_id,
      mandate_hash: hash,
      custom_id: captureRecord.customId,
      intent_mandate_jws: input.signedIntentJws,
      intent_mandate: intent,
      cart_mandate: cart,
      capture_record: captureRecord,
      verified_key_id: verified.kid,
      verified_at: now,
      policy_evaluation: { outcome: "APPROVE", reasons: evalResult.reasons },
      timeline,
      draft,
      required_evidence: evidenceReport.required,
      missing_evidence: evidenceReport.missing,
      evidence_report: evidenceReport,
    },
    null,
    2,
  );

  const result: EvidencePackageResult = {
    disputeId: dispute.disputeId,
    status: "pending_human_approval",
    draft,
    bundleJson,
    pdf,
    mandateHash: hash,
    customId: captureRecord.customId,
    createdAt: now,
    evidenceReport,
  };

  await options.store?.save(result);
  await options.db?.appendAudit({
    actor: "worker:copilot",
    action: "evidence.drafted",
    subjectId: dispute.disputeId,
    requestBody: {
      status: result.status,
      mandate_hash: hash,
      custom_id: captureRecord.customId,
      ...(generated ? { prompt_version: generated.prompt_version, source: generated.source } : {}),
    },
  });

  return result;
}

export interface BuildEvidenceOptions extends EvidenceOptions {
  loader: DisputeDataLoader;
  keyResolver: KeyResolver;
  auditTrail?: TimelineEntry[];
  tracking?: { trackingNumber?: string; carrier?: string; status?: string };
}

/** Loads the dispute's order and builds its package. Only MANDATE_COMPLIANT disputes get one. */
export async function buildEvidencePackage(
  disputeId: string,
  options: BuildEvidenceOptions,
): Promise<EvidencePackageResult> {
  const dispute = await options.loader.loadDispute(disputeId);
  if (!dispute) throw new Error(`Dispute not found: ${disputeId}`);
  const order = dispute.orderId ? await options.loader.loadOrder(dispute.orderId) : null;
  if (!order) throw new Error(`Dispute ${disputeId} has no order on record`);

  const rec = await runDisputeClassifier(dispute, order, { mode: options.mode });
  if (rec.class !== "MANDATE_COMPLIANT") {
    throw new Error(
      `Dispute ${disputeId} is ${rec.class}; only MANDATE_COMPLIANT disputes get a defence package`,
    );
  }
  if (!order.signedIntentJws || !order.cart || !order.captureRecord) {
    throw new Error(`Order ${order.orderId} is missing its signed mandate, cart or capture record`);
  }

  return draftEvidenceForDefend(
    {
      dispute,
      signedIntentJws: order.signedIntentJws,
      cart: order.cart,
      captureRecord: order.captureRecord,
      keyResolver: options.keyResolver,
      ledger: order.ledger,
      auditTrail: options.auditTrail,
      tracking: options.tracking,
    },
    options,
  );
}

export * from "./pdf";
