import { greyJacketIntent } from "@poi/contracts/fixtures";
import type { ConstraintCheck, DisputeDetail } from "./dispute-types";
import { generateSeedDisputes } from "./seed-disputes";

export interface ReasonEvidenceMapping {
  required: string[];
  missing: string[];
  deliveryEvidence: "CONFIRMED" | "not available";
  responseReadiness: "READY" | "INCOMPLETE";
  mandateCompliance: "COMPLIANT" | "NON_COMPLIANT" | "NO_MANDATE" | "MISREAD";
}

export function evaluateDisputeEvidence(
  buyerDisputeReason: string,
  disputeClass: string,
  options?: {
    hasMandate?: boolean;
    hasDeliveryEvidence?: boolean;
    hasPolicyEvaluation?: boolean;
    tracking?: { trackingNumber?: string };
  },
): ReasonEvidenceMapping {
  // 1. Mandate Compliance
  let mandateCompliance: "COMPLIANT" | "NON_COMPLIANT" | "NO_MANDATE" | "MISREAD" = "COMPLIANT";
  if (disputeClass === "MANDATE_COMPLIANT") {
    mandateCompliance = "COMPLIANT";
  } else if (disputeClass === "AGENT_OVERREACH") {
    mandateCompliance = "NON_COMPLIANT";
  } else if (disputeClass === "NO_MANDATE") {
    mandateCompliance = "NO_MANDATE";
  } else if (disputeClass === "INTENT_MISREAD") {
    mandateCompliance = "MISREAD";
  } else {
    mandateCompliance = "NON_COMPLIANT";
  }

  // 2. Reason to required evidence mapping
  const required: string[] = [];
  const missing: string[] = [];
  const hasMandate = options?.hasMandate ?? (disputeClass !== "NO_MANDATE");
  const hasDelivery = Boolean(options?.hasDeliveryEvidence || options?.tracking?.trackingNumber);

  switch (buyerDisputeReason) {
    case "MERCHANDISE_OR_SERVICE_NOT_RECEIVED": {
      required.push("Signed Intent Mandate", "Cart Mandate", "Proof of Fulfillment");
      if (!hasMandate) missing.push("Signed Intent Mandate");
      // "There is no tracking or fulfillment data in the worker, so delivery evidence shows 'not available' unless real data exists."
      if (!hasDelivery) {
        missing.push("Proof of Fulfillment (carrier tracking)");
      }
      break;
    }
    case "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED": {
      required.push("Signed Intent Mandate", "Cart Mandate", "Policy Evaluation");
      if (!hasMandate) missing.push("Signed Intent Mandate");
      if (options?.hasPolicyEvaluation === false) {
        missing.push("Constraint Check Passing Result");
      }
      break;
    }
    case "UNAUTHORISED": {
      required.push("Signed Intent Mandate", "Order Pointer Verification");
      if (!hasMandate) missing.push("Signed Intent Mandate");
      break;
    }
    case "INCORRECT_AMOUNT": {
      required.push("Signed Intent Mandate", "Capture Record");
      if (!hasMandate) missing.push("Signed Intent Mandate");
      break;
    }
    default: {
      required.push("Signed Intent Mandate", "Cart Mandate");
      if (!hasMandate) missing.push("Signed Intent Mandate");
      break;
    }
  }

  // A dispute the signed mandate does not back has nothing to defend with, however complete the records are: the cart broke
  // what the shopper signed, or did not fit their words. Without this, a conceded overreach read "Readiness: READY".
  if (mandateCompliance === "NON_COMPLIANT" || mandateCompliance === "MISREAD") {
    missing.push("A passing mandate check (the cart did not meet what the shopper signed)");
  }

  // 3. Delivery Evidence: "There is no tracking or fulfillment data in the worker, so delivery evidence shows 'not available' unless real data exists."
  const deliveryEvidence = hasDelivery ? "CONFIRMED" : "not available";

  // 4. Response Readiness: Ready only if no required items are missing
  const responseReadiness: "READY" | "INCOMPLETE" = missing.length === 0 ? "READY" : "INCOMPLETE";

  return {
    required,
    missing,
    deliveryEvidence,
    responseReadiness,
    mandateCompliance,
  };
}

export function withEvidenceEvaluation(detail: DisputeDetail): DisputeDetail {
  const evalResult = evaluateDisputeEvidence(detail.buyerDisputeReason, detail.disputeClass, {
    hasMandate: Boolean(detail.mandateId),
    hasPolicyEvaluation: detail.constraintChecks.every((c) => c.status === "PASS"),
  });
  return {
    ...detail,
    mandateCompliance: evalResult.mandateCompliance,
    deliveryEvidence: evalResult.deliveryEvidence,
    responseReadiness: evalResult.responseReadiness,
    requiredEvidence: evalResult.required,
    missingEvidence: evalResult.missing,
  };
}

function buildRawDisputeDetail(disputeId: string): DisputeDetail | undefined {
  const base = generateSeedDisputes().find((d) => d.id === disputeId);
  if (!base) return undefined;

  // Pinned Scripted Dispute 1: Compliant grey jacket order ($74) -> Defend
  if (base.id === "PP-D-1001") {
    return {
      ...base,
      checkoutVerdict: "APPROVE",
      shopperIntentText: greyJacketIntent.natural_language_description,
      mandateId: greyJacketIntent.mandate_id,
      mandateNonce: greyJacketIntent.nonce,
      mandateIssuer: greyJacketIntent.issuer,
      mandateCreatedAt: greyJacketIntent.created_at,
      mandateExpiry: greyJacketIntent.intent_expiry,
      cartLines: [
        {
          sku: "JKT-GRY-M",
          title: "Stride Running Jacket",
          color: "grey",
          category: "running-jacket",
          unitPrice: { value: 7400, currency: "USD" },
          quantity: 1,
        },
      ],
      cartTotal: { value: 7400, currency: "USD" },
      cartMerchantName: "Trailhead Outfitters",
      constraints: {
        amountMax: { value: 8000, currency: "USD" },
        merchantAllowlist: ["merchant-trailhead"],
        attributes: { category: "running-jacket", color: "grey" },
        quantityMax: { perLine: 1, perOrder: 1 },
      },
      constraintChecks: [
        {
          id: "rule-amount",
          name: "Maximum Budget",
          mandateRule: "≤ $80.00",
          cartActual: "$74.00",
          status: "PASS",
          explanation: "Cart total of $74.00 is strictly within the $80.00 budget cap.",
        },
        {
          id: "rule-color",
          name: "Color Attribute",
          mandateRule: "grey",
          cartActual: "grey",
          status: "PASS",
          explanation: "Selected item matches the required grey color.",
        },
        {
          id: "rule-category",
          name: "Category",
          mandateRule: "running-jacket",
          cartActual: "running-jacket",
          status: "PASS",
          explanation: "Selected item category is running jacket.",
        },
        {
          id: "rule-merchant",
          name: "Merchant Allowlist",
          mandateRule: "merchant-trailhead",
          cartActual: "merchant-trailhead (Trailhead Outfitters)",
          status: "PASS",
          explanation: "Merchant is on the approved merchant allowlist.",
        },
        {
          id: "rule-quantity",
          name: "Quantity Limit",
          mandateRule: "≤ 1 item",
          cartActual: "1 item",
          status: "PASS",
          explanation: "Order contains 1 line item as permitted.",
        },
      ],
      classificationInfo: {
        disputeClass: "MANDATE_COMPLIANT",
        confidence: null,
        recommendedAction: "PROVIDE_EVIDENCE",
        reasons: [
          {
            text: "Cart items and amount strictly comply with signed shopper intent constraints.",
            cites: ["mandates.intent", "mandates.cart"],
          },
          {
            text: "Shopper presence confirmed at checkout with valid cryptographic countersignature.",
            cites: ["mandates.payment"],
          },
        ],
        evidencePlan: [
          "Compile signed intent mandate JWS",
          "Include cart mandate hash verification",
          "Attach carrier shipment tracking confirmation",
          "Generate attestation PDF",
        ],
      },
      evidenceDraftInfo: {
        coverNote:
          "The buyer authorized a verifiable intent mandate specifying a grey running jacket under $80. The merchant fulfilled the order matching these constraints for $74.00, cryptographically countersigned at checkout.",
        attestationSections: [
          {
            heading: "1. Shopper Mandate & Intent Statement",
            body: "Shopper signed mandate 0192f3a0-0000-7000-8000-000000000001: 'Find me a grey running jacket under $80, ship to my home address.'",
          },
          {
            heading: "2. Cart Fulfillment & Policy Rules",
            body: "Cart total $74.00, SKU JKT-GRY-M (grey, size M). All policy engine checks evaluated to APPROVE at checkout.",
          },
          {
            heading: "3. Cryptographic Verification & Hashes",
            body: "Attestation hash matches PayPal custom_id pointer (poi:0192f3a0-0000-7000-8000-000000000001:82db739af7040831). All ES256 signatures verified against the key registry.",
          },
          {
            heading: "4. Fulfillment & Tracking",
            body: "Carrier tracking confirms delivery to the mandate shipping address hash.",
          },
        ],
        buyerMessage:
          "Your order for the Stride Running Jacket was fulfilled according to your signed mandate (max $80, grey running jacket). Delivery was confirmed by carrier tracking.",
        attestationHash: "82db739af70408317d95f4eefeb744a7c47267451a0a3e9a1ad679e1e9e9956d",
        customId: "poi:0192f3a0-0000-7000-8000-000000000001:82db739af7040831",
        pdfFilename: "evidence-PP-D-1001.pdf",
        generatedAt: "2026-11-02T08:35:00Z",
      },
    };
  }

  // Pinned Scripted Dispute 2: Overreaching red jacket order ($95) -> Concede
  if (base.id === "PP-D-1002") {
    return {
      ...base,
      checkoutVerdict: "REJECT",
      shopperIntentText: greyJacketIntent.natural_language_description,
      mandateId: greyJacketIntent.mandate_id,
      mandateNonce: greyJacketIntent.nonce,
      mandateIssuer: greyJacketIntent.issuer,
      mandateCreatedAt: greyJacketIntent.created_at,
      mandateExpiry: greyJacketIntent.intent_expiry,
      cartLines: [
        {
          sku: "JKT-RED-M",
          title: "Stride Running Jacket",
          color: "red",
          category: "running-jacket",
          unitPrice: { value: 9500, currency: "USD" },
          quantity: 1,
        },
      ],
      cartTotal: { value: 9500, currency: "USD" },
      cartMerchantName: "Trailhead Outfitters",
      constraints: {
        amountMax: { value: 8000, currency: "USD" },
        merchantAllowlist: ["merchant-trailhead"],
        attributes: { category: "running-jacket", color: "grey" },
        quantityMax: { perLine: 1, perOrder: 1 },
      },
      constraintChecks: [
        {
          id: "rule-amount",
          name: "Maximum Budget",
          mandateRule: "≤ $80.00",
          cartActual: "$95.00",
          status: "FAIL",
          reasonCode: "AMOUNT_EXCEEDS_MAX",
          explanation:
            "Cart total of $95.00 exceeded the shopper's maximum budget ceiling of $80.00 by $15.00.",
        },
        {
          id: "rule-color",
          name: "Color Attribute",
          mandateRule: "grey",
          cartActual: "red",
          status: "FAIL",
          reasonCode: "ATTRIBUTE_MISMATCH",
          explanation:
            "Agent purchased a red jacket, directly violating the explicit constraint requiring grey.",
        },
        {
          id: "rule-category",
          name: "Category",
          mandateRule: "running-jacket",
          cartActual: "running-jacket",
          status: "PASS",
          explanation: "Selected item category is running jacket.",
        },
        {
          id: "rule-merchant",
          name: "Merchant Allowlist",
          mandateRule: "merchant-trailhead",
          cartActual: "merchant-trailhead (Trailhead Outfitters)",
          status: "PASS",
          explanation: "Merchant is on the approved merchant allowlist.",
        },
        {
          id: "rule-quantity",
          name: "Quantity Limit",
          mandateRule: "≤ 1 item",
          cartActual: "1 item",
          status: "PASS",
          explanation: "Order contains 1 line item as permitted.",
        },
      ],
      classificationInfo: {
        disputeClass: "AGENT_OVERREACH",
        confidence: null,
        recommendedAction: "ACCEPT_CLAIM",
        reasons: [
          {
            text: "Autonomous buyer agent exceeded maximum authorized spend cap ($95.00 vs $80.00).",
            cites: ["constraints.amount_max"],
          },
          {
            text: "Autonomous buyer agent substituted red color for required grey attribute.",
            cites: ["constraints.attributes.color"],
          },
        ],
        evidencePlan: ["Concession recommended; initiate automated refund claim acceptance"],
      },
      evidenceDraftInfo: undefined,
    };
  }

  // Special case: NO_MANDATE disputes (e.g. PP-D-1015) have no mandate, no passing checks, and STANDARD_EVIDENCE
  if (base.disputeClass === "NO_MANDATE" || base.id === "PP-D-1015") {
    return {
      ...base,
      shopperIntentText: undefined,
      mandateId: undefined,
      mandateNonce: undefined,
      mandateIssuer: undefined,
      mandateCreatedAt: undefined,
      mandateExpiry: undefined,
      checkoutVerdict: "NONE",
      cartLines: [
        {
          sku: "ITEM-GENERIC-1",
          title: "Standard Merchandise",
          unitPrice: base.amount,
          quantity: 1,
        },
      ],
      cartTotal: base.amount,
      cartMerchantName: "Trailhead Outfitters",
      constraints: {
        amountMax: { value: 0, currency: "USD" },
        merchantAllowlist: [],
        attributes: {},
        quantityMax: { perLine: 1, perOrder: 1 },
      },
      constraintChecks: [], // No passing checks on unmandated order
      classificationInfo: {
        disputeClass: "NO_MANDATE",
        confidence: null,
        recommendedAction: "STANDARD_EVIDENCE",
        reasons: [
          {
            text: "No verifiable shopper mandate recorded at checkout for this order.",
            cites: ["mandates.missing"],
          },
        ],
        evidencePlan: ["Compile merchant standard evidence (receipt, proof of delivery)"],
      },
      evidenceDraftInfo: undefined,
    };
  }

  // Fallback for remaining disputes: generate unique mandate ID and honest constraint checks
  const suffix = base.id.replace(/^PP-D-/, "").padStart(12, "0");
  const disputeMandateId = `0192f3a0-0000-7000-8000-${suffix}`;
  const isIntentMisread = base.disputeClass === "INTENT_MISREAD";
  const isAgentOverreach = base.disputeClass === "AGENT_OVERREACH";

  const checks: ConstraintCheck[] = [];

  if (isIntentMisread) {
    // Intent misread: Budget passes honest evaluation; natural language interpretation failed
    checks.push({
      id: "rule-amount",
      name: "Maximum Budget",
      mandateRule: `≤ $${((base.amount.value + 1000) / 100).toFixed(2)}`,
      cartActual: `$${(base.amount.value / 100).toFixed(2)}`,
      status: "PASS",
      explanation: "Cart amount complies with authorized budget ceiling.",
    });
    checks.push({
      id: "rule-intent-interpretation",
      name: "Shopper Intent Semantic Match",
      mandateRule: "Natural language query match",
      cartActual: "Purchased item ambiguous or divergent",
      status: "FAIL",
      reasonCode: base.reasons[0] ?? "SEMANTIC_UNCERTAIN",
      explanation:
        "Purchased item failed semantic verification against natural language shopper description.",
    });
    checks.push({
      id: "rule-merchant",
      name: "Merchant Allowlist",
      mandateRule: "Approved merchant only",
      cartActual: "Trailhead Outfitters",
      status: "PASS",
      explanation: "Merchant is allowlisted.",
    });
  } else if (isAgentOverreach) {
    const hasAmountViolation = base.reasons.includes("AMOUNT_EXCEEDS_MAX");
    const hasAddressViolation = base.reasons.includes("ADDRESS_MISMATCH");

    checks.push({
      id: "rule-amount",
      name: "Maximum Budget",
      mandateRule: `≤ $${((base.amount.value + (hasAmountViolation ? -2000 : 1000)) / 100).toFixed(2)}`,
      cartActual: `$${(base.amount.value / 100).toFixed(2)}`,
      status: hasAmountViolation ? "FAIL" : "PASS",
      reasonCode: hasAmountViolation ? "AMOUNT_EXCEEDS_MAX" : undefined,
      explanation: hasAmountViolation
        ? "Cart amount exceeded the specified constraint limit."
        : "Cart amount complies with the specified mandate limit.",
    });

    if (hasAddressViolation) {
      checks.push({
        id: "rule-address",
        name: "Shipping Address Allowlist",
        mandateRule: "Approved shipping address hash",
        cartActual: "Unverified alternate shipping destination",
        status: "FAIL",
        reasonCode: "ADDRESS_MISMATCH",
        explanation: "Shipping destination deviated from mandate shipping address constraint.",
      });
    }

    checks.push({
      id: "rule-merchant",
      name: "Merchant Allowlist",
      mandateRule: "Approved merchant only",
      cartActual: "Trailhead Outfitters",
      status: "PASS",
      explanation: "Merchant is allowlisted.",
    });
  } else {
    // Compliant / defend disputes
    checks.push({
      id: "rule-amount",
      name: "Maximum Budget",
      mandateRule: `≤ $${((base.amount.value + 1000) / 100).toFixed(2)}`,
      cartActual: `$${(base.amount.value / 100).toFixed(2)}`,
      status: "PASS",
      explanation: "Cart amount complies with the specified mandate limit.",
    });
    checks.push({
      id: "rule-merchant",
      name: "Merchant Allowlist",
      mandateRule: "Approved merchant only",
      cartActual: "Trailhead Outfitters",
      status: "PASS",
      explanation: "Merchant is allowlisted.",
    });
  }

  // Deterministic 64-char hex hash from unique mandate ID (never empty string)
  const pseudoHash = `${disputeMandateId.replace(/-/g, "")}abcdef0123456789fedcba9876543210`.slice(0, 64);
  const checkoutVerdict = base.decision === "defend" ? "APPROVE" : "REJECT";

  return {
    ...base,
    checkoutVerdict,
    shopperIntentText: `Automated shopper mandate for order ${base.orderId}. Handled by ${base.agentPlatform}.`,
    mandateId: disputeMandateId,
    mandateNonce: `n-${suffix}`,
    mandateIssuer: "shopper-key-demo",
    mandateCreatedAt: base.createdAt,
    mandateExpiry: "2026-11-15T00:00:00Z",
    cartLines: [
      {
        sku: "ITEM-DEMO-1",
        title: "Outdoor Apparel & Gear",
        unitPrice: base.amount,
        quantity: 1,
      },
    ],
    cartTotal: base.amount,
    cartMerchantName: "Trailhead Outfitters",
    constraints: {
      amountMax: { value: base.amount.value + (base.decision === "concede" ? -2000 : 1000), currency: "USD" },
      merchantAllowlist: ["merchant-trailhead"],
      attributes: {},
      quantityMax: { perLine: 1, perOrder: 1 },
    },
    constraintChecks: checks,
    classificationInfo: {
      disputeClass: base.disputeClass,
      confidence: null,
      recommendedAction: base.decision === "defend" ? "PROVIDE_EVIDENCE" : "ACCEPT_CLAIM",
      reasons: base.reasons.map((r) => ({ text: `Reason code evaluated: ${r}`, cites: [r] })),
      evidencePlan: base.decision === "defend" ? ["Compile signed mandate JWS"] : ["Accept claim"],
    },
    evidenceDraftInfo:
      base.decision === "defend"
        ? {
            coverNote: `Evidence package for ${base.id}. Order fulfilled within shopper intent parameters.`,
            attestationSections: [
              {
                heading: "1. Mandate & Checkout Verification",
                body: `Order ${base.orderId} satisfied intent mandate rules verified at checkout.`,
              },
              {
                heading: "2. Cryptographic Attestation",
                body: `Demo seed dispute: no signed mandate is on file, so the pointer (poi:${disputeMandateId}:${pseudoHash.slice(0, 16)}) and hash are placeholders and have not been verified.`,
              },
            ],
            buyerMessage: "Order was fulfilled in accordance with your signed mandate.",
            attestationHash: pseudoHash,
            customId: `poi:${disputeMandateId}:${pseudoHash.slice(0, 16)}`,
            pdfFilename: `evidence-${base.id}.pdf`,
            generatedAt: base.createdAt,
          }
        : undefined,
  };
}

/**
 * Builds canonical DisputeDetail for a dispute ID, matching specs 0005 and 0007,
 * and attaches reason-based evidence requirements, delivery status, and readiness.
 */
export function getDisputeDetail(disputeId: string): DisputeDetail | undefined {
  const detail = buildRawDisputeDetail(disputeId);
  return detail ? withEvidenceEvaluation(detail) : undefined;
}
