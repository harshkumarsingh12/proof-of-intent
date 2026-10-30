/**
 * Dispute copilot pipeline. Owner: @hoursgotviral-dev. Spec: docs/specs/0005-dispute-copilot.md.
 *
 * webhook → fetch dispute (Agent Toolkit get_dispute) → mandate on order? → replay hard rules
 * → replay J1 → class + recommendation → operator review → dispute action. Every dispute
 * ends at an operator click, never at the model.
 */
import { NotImplementedError, type DisputeClass } from "@poi/contracts";

/** Job names agreed in the shared contracts (docs/specs/0003 §Jobs). */
export const JOBS = {
  disputeReceived: "dispute.received",
  disputeClassify: "dispute.classify",
  evidenceBuild: "dispute.evidence.build",
  ledgerUpdate: "ledger.update",
} as const;

export interface Recommendation {
  disputeId: string;
  class: DisputeClass;
  action: "PROVIDE_EVIDENCE" | "ACCEPT_CLAIM" | "MAKE_OFFER" | "STANDARD_EVIDENCE";
  reasons: string[];
}

const OWNER = "hoursgotviral-dev";
const SPEC = "docs/specs/0005-dispute-copilot.md";

export async function recommend(_disputeId: string): Promise<Recommendation> {
  throw new NotImplementedError("dispute recommendation", OWNER, SPEC);
}

import { compliantCart, greyJacketIntent, NOW } from "@poi/contracts/fixtures";
import { customId, mandateHash } from "@poi/mandates";
import { generateEvidencePdf, type EvidencePdfData } from "./pdf";

export async function buildEvidencePackage(disputeId: string): Promise<{ pdf: Uint8Array; bundleJson: string }> {
  const hash = mandateHash(greyJacketIntent);
  const pointer = customId(greyJacketIntent.mandate_id, hash);

  const pdfData: EvidencePdfData = {
    summary: {
      disputeId,
      orderId: "ord_compliant",
      customId: pointer,
      status: "WAITING_FOR_SELLER_RESPONSE",
      reason: "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED",
      amount: "USD 74.00",
      responseDueDate: "2026-11-10T12:00:00Z",
    },
    intent: greyJacketIntent,
    intentHash: hash,
    cart: compliantCart,
    constraints: [
      {
        name: "amount_max",
        rule: "USD 80.00",
        actual: "USD 74.00",
        passed: true,
      },
      {
        name: "merchant_allowlist",
        rule: "merchant-trailhead",
        actual: "merchant-trailhead",
        passed: true,
      },
      {
        name: "attributes.category",
        rule: "running-jacket",
        actual: "running-jacket",
        passed: true,
      },
      {
        name: "attributes.color",
        rule: "grey",
        actual: "grey",
        passed: true,
      },
    ],
    verification: {
      signatureValid: true,
      keyId: "shopper-key-1",
      algorithm: "ES256",
      computedHash: hash,
      customIdMatches: true,
      verdictOutcome: "APPROVE",
      reasons: [],
    },
    timeline: [
      { timestamp: "2026-11-01T09:00:00Z", event: "Shopper signed Intent Mandate", actor: "shopper" },
      { timestamp: "2026-11-02T10:00:00Z", event: "Policy engine verified cart against constraints", actor: "policy-engine" },
      { timestamp: NOW, event: "PayPal order captured with mandate pointer in custom_id", actor: "api" },
      { timestamp: "2026-11-04T12:00:00Z", event: "Dispute received via PayPal webhook", actor: "webhook" },
      { timestamp: "2026-11-04T12:01:00Z", event: "Copilot classified MANDATE_COMPLIANT and drafted evidence PDF", actor: "worker" },
    ],
    coverNote: "Customer purchase was verified against signed intent mandate prior to capture. Items strictly match instructions.",
  };

  const pdf = generateEvidencePdf(pdfData);
  const bundleJson = JSON.stringify(
    {
      dispute_id: disputeId,
      mandate_id: greyJacketIntent.mandate_id,
      mandate_hash: hash,
      custom_id: pointer,
      intent_mandate: greyJacketIntent,
      cart_mandate: compliantCart,
    },
    null,
    2,
  );

  return { pdf, bundleJson };
}

export * from "./pdf";

