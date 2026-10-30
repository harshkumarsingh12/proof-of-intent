import { describe, expect, it } from "vitest";
import { compliantCart, greyJacketIntent, NOW } from "@poi/contracts/fixtures";
import { customId, mandateHash } from "@poi/mandates";
import {
  generateEvidencePdf,
  renderEvidencePdfText,
  type EvidencePdfData,
} from "./pdf";

describe("evidence PDF generation", () => {
  const hash = mandateHash(greyJacketIntent);
  const pointer = customId(greyJacketIntent.mandate_id, hash);

  const sampleData: EvidencePdfData = {
    summary: {
      disputeId: "PP-D-778899",
      orderId: "ord_compliant_001",
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

  it("renders a valid PDF 1.4 document structure", () => {
    const pdfBytes = generateEvidencePdf(sampleData);
    const text = new TextDecoder().decode(pdfBytes);

    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text).toContain("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj");
    expect(text).toContain("2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj");
    expect(text).toContain("xref\n0 6\n");
    expect(text).toContain("trailer\n<< /Size 6 /Root 1 0 R >>");
    expect(text).toContain("startxref\n");
    expect(text.trim().endsWith("%%EOF")).toBe(true);
  });

  it("contains all five required sections in rendered text", () => {
    const text = renderEvidencePdfText(sampleData);

    // 1. Dispute summary
    expect(text).toContain("1. DISPUTE SUMMARY");
    expect(text).toContain("Dispute ID:               PP-D-778899");
    expect(text).toContain("PayPal custom_id:         poi:0192f3a0-0000-7000-8000-000000000001:");
    expect(text).toContain("MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED");

    // 2. Signed intent text
    expect(text).toContain("2. SIGNED INTENT MANDATE (SHOPPER WORDS & CONSTRAINTS)");
    expect(text).toContain('Shopper Description:      "Find me a grey running jacket under $80, ship to my home address."');
    expect(text).toContain(hash);

    // 3. Cart vs mandate comparison
    expect(text).toContain("3. CART VS MANDATE COMPARISON");
    expect(text).toContain("Trailhead Outfitters");
    expect(text).toContain("Stride Running Jacket");
    expect(text).toContain("[PASS] amount_max: limit USD 80.00 | actual: USD 74.00");

    // 4. Verification result
    expect(text).toContain("4. VERIFICATION RESULT & CRYPTOGRAPHIC ATTESTATION");
    expect(text).toContain("Shopper JWS Signature:    VALID (ES256, key: shopper-key-1)");
    expect(text).toContain("Order Pointer Match:      VERIFIED MATCH");

    // 5. Timeline
    expect(text).toContain("5. AUDIT TIMELINE");
    expect(text).toContain("[2026-11-01T09:00:00Z] [shopper] Shopper signed Intent Mandate");
    expect(text).toContain("Copilot classified MANDATE_COMPLIANT and drafted evidence PDF");

    // Cover note
    expect(text).toContain("6. COPILOT COVER NOTE");
  });

  it("produces deterministic, byte-for-byte identical PDF output", () => {
    const first = generateEvidencePdf(sampleData);
    const second = generateEvidencePdf(sampleData);

    expect(first.length).toBe(second.length);
    for (let i = 0; i < first.length; i++) {
      expect(first[i]).toBe(second[i]);
    }
  });

  it("matches the deterministic snapshot of the rendered evidence text", () => {
    const rendered = renderEvidencePdfText(sampleData);
    expect(rendered).toMatchSnapshot();
  });
});
