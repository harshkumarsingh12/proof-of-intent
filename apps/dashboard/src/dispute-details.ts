import { greyJacketIntent } from "@poi/contracts/fixtures";
import type { DisputeDetail } from "./dispute-types";
import { SEED_DISPUTES } from "./seed-disputes";

/**
 * Builds canonical DisputeDetail for a dispute ID, matching specs 0005 and 0007.
 */
export function getDisputeDetail(disputeId: string): DisputeDetail | undefined {
  const base = SEED_DISPUTES.find((d) => d.id === disputeId);
  if (!base) return undefined;

  // Pinned Scripted Dispute 1: Compliant grey jacket order ($74) -> Defend
  if (base.id === "PP-D-1001") {
    return {
      ...base,
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
        confidence: 0.99,
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
            body: "Attestation hash matches PayPal custom_id pointer (poi:0192f3a0...:e3b0c442). All Ed25519 signatures verified.",
          },
          {
            heading: "4. Fulfillment & Tracking",
            body: "Carrier tracking confirms delivery to the mandate shipping address hash.",
          },
        ],
        buyerMessage:
          "Your order for the Stride Running Jacket was fulfilled according to your signed mandate (max $80, grey running jacket). Delivery was confirmed by carrier tracking.",
        attestationHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        customId: "poi:0192f3a0-0000-7000-8000-000000000001:e3b0c44298fc1c14",
        pdfFilename: "evidence-PP-D-1001.pdf",
        generatedAt: "2026-11-02T08:35:00Z",
      },
      auditLog: [
        {
          id: "audit-1001-1",
          disputeId: "PP-D-1001",
          who: "system:webhook",
          what: "DISPUTE_RECEIVED",
          when: "2026-11-02T08:30:00Z",
          notes: "Verified PayPal dispute webhook received for order ord_0192f3a0_1001.",
        },
        {
          id: "audit-1001-2",
          disputeId: "PP-D-1001",
          who: "copilot:pipeline",
          what: "CLASSIFICATION_COMPLETED",
          when: "2026-11-02T08:31:00Z",
          notes: "Replayed policy engine: class MANDATE_COMPLIANT, recommended PROVIDE_EVIDENCE.",
          metadata: { attestationHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" },
        },
      ],
    };
  }

  // Pinned Scripted Dispute 2: Overreaching red jacket order ($95) -> Concede
  if (base.id === "PP-D-1002") {
    return {
      ...base,
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
          explanation: "Cart total of $95.00 exceeded the shopper's maximum budget ceiling of $80.00 by $15.00.",
        },
        {
          id: "rule-color",
          name: "Color Attribute",
          mandateRule: "grey",
          cartActual: "red",
          status: "FAIL",
          reasonCode: "ATTRIBUTE_MISMATCH",
          explanation: "Agent purchased a red jacket, directly violating the explicit constraint requiring grey.",
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
        confidence: 0.98,
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
      auditLog: [
        {
          id: "audit-1002-1",
          disputeId: "PP-D-1002",
          who: "system:webhook",
          what: "DISPUTE_RECEIVED",
          when: "2026-11-02T09:15:00Z",
          notes: "Verified PayPal dispute webhook received for order ord_0192f3a0_1002.",
        },
        {
          id: "audit-1002-2",
          disputeId: "PP-D-1002",
          who: "copilot:pipeline",
          what: "CLASSIFICATION_COMPLETED",
          when: "2026-11-02T09:16:00Z",
          notes: "Replayed policy engine: class AGENT_OVERREACH (AMOUNT_EXCEEDS_MAX, ATTRIBUTE_MISMATCH). Concession recommended.",
        },
      ],
    };
  }

  // Fallback for remaining disputes
  const hasViolations = base.decision === "concede";
  const checks = [
    {
      id: "rule-amount",
      name: "Maximum Budget",
      mandateRule: `≤ $${((base.amount.value + (hasViolations ? -2000 : 1000)) / 100).toFixed(2)}`,
      cartActual: `$${(base.amount.value / 100).toFixed(2)}`,
      status: (hasViolations ? "FAIL" : "PASS") as "PASS" | "FAIL",
      reasonCode: hasViolations ? base.reasons[0] ?? "AMOUNT_EXCEEDS_MAX" : undefined,
      explanation: hasViolations
        ? "Cart amount exceeded the specified constraint limit."
        : "Cart amount complies with the specified mandate limit.",
    },
    {
      id: "rule-merchant",
      name: "Merchant Allowlist",
      mandateRule: "Approved merchant only",
      cartActual: "Trailhead Outfitters",
      status: "PASS" as const,
      explanation: "Merchant is allowlisted.",
    },
  ];

  const isResolved = base.status === "RESOLVED";

  return {
    ...base,
    shopperIntentText: `Automated shopper mandate for order ${base.orderId}. Handled by ${base.agentPlatform}.`,
    mandateId: "0192f3a0-0000-7000-8000-000000000099",
    mandateNonce: "n-canonical-fixture-nonce",
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
      amountMax: { value: base.amount.value + (hasViolations ? -2000 : 1000), currency: "USD" },
      merchantAllowlist: ["merchant-trailhead"],
      attributes: {},
      quantityMax: { perLine: 1, perOrder: 1 },
    },
    constraintChecks: checks,
    classificationInfo: {
      disputeClass: base.disputeClass,
      confidence: 0.95,
      recommendedAction: base.decision === "defend" ? "PROVIDE_EVIDENCE" : "ACCEPT_CLAIM",
      reasons: base.reasons.map((r) => ({ text: `Violation code detected: ${r}`, cites: [r] })),
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
            ],
            buyerMessage: "Order was fulfilled in accordance with your signed mandate.",
            attestationHash: "a1b2c3d4e5f60000111122223333444455556666777788889999aaaabbbbcccc",
            customId: `poi:0192f3a0-0000-7000-8000-000000000099:${base.id.toLowerCase()}`,
            pdfFilename: `evidence-${base.id}.pdf`,
            generatedAt: base.createdAt,
          }
        : undefined,
    auditLog: [
      {
        id: `audit-${base.id}-1`,
        disputeId: base.id,
        who: "system:webhook",
        what: "DISPUTE_RECEIVED",
        when: base.createdAt,
        notes: `Dispute event ingested from PayPal for order ${base.orderId}.`,
      },
      {
        id: `audit-${base.id}-2`,
        disputeId: base.id,
        who: isResolved ? "operator:hoursgotviral-dev" : "copilot:pipeline",
        what: isResolved
          ? base.decision === "defend"
            ? "SUBMIT_EVIDENCE"
            : "ACCEPT_CLAIM"
          : "CLASSIFICATION_COMPLETED",
        when: isResolved ? base.sellerResponseDueDate : base.createdAt,
        notes: isResolved
          ? `Dispute resolved by human operator (${base.decision === "defend" ? "evidence submitted" : "claim accepted"}).`
          : `Copilot evaluated dispute as ${base.disputeClass}; recommended action: ${base.decision.toUpperCase()}.`,
        metadata: isResolved
          ? {
              previousStatus: "ACTION_REQUIRED",
              newStatus: "RESOLVED",
              refundAmount: base.decision === "concede" ? base.amount : undefined,
            }
          : undefined,
      },
    ],
  };
}
