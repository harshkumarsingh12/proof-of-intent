import { describe, expect, it } from "vitest";
import { fetchDisputeDetail, getDisputeDetail } from "./api";
import type { DisputeDetail } from "./dispute-types";
import { widgets } from "./widgets";

describe("dispute detail & mandate diff (spec 0007)", () => {
  it("registers mandate-diff and evidence-preview widgets with AI descriptions", () => {
    const mandateDiff = widgets.find((w) => w.id === "mandate-diff");
    expect(mandateDiff).toBeDefined();
    expect(mandateDiff?.name).toBe("Mandate Diff");
    expect(mandateDiff?.aiDescription.length).toBeGreaterThan(20);

    const evidencePreview = widgets.find((w) => w.id === "evidence-preview");
    expect(evidencePreview).toBeDefined();
    expect(evidencePreview?.name).toBe("Evidence Preview");
    expect(evidencePreview?.aiDescription.length).toBeGreaterThan(20);
  });

  it("loads compliant dispute PP-D-1001 with mandate text and passing constraint checks", () => {
    const detail = getDisputeDetail("PP-D-1001");
    expect(detail).toBeDefined();
    expect(detail!.id).toBe("PP-D-1001");
    expect(detail!.decision).toBe("defend");

    // Mandate text
    expect(detail!.shopperIntentText).toContain("grey running jacket under $80");
    expect(detail!.mandateId).toBe("0192f3a0-0000-7000-8000-000000000001");

    // Cart details
    expect(detail!.cartTotal.value).toBe(7400);
    expect(detail!.cartLines[0]?.color).toBe("grey");

    // All constraint checks pass
    expect(detail!.constraintChecks.length).toBeGreaterThan(0);
    expect(detail!.constraintChecks.every((c) => c.status === "PASS")).toBe(true);

    // Classification & recommendation
    expect(detail!.classificationInfo.disputeClass).toBe("MANDATE_COMPLIANT");
    expect(detail!.classificationInfo.recommendedAction).toBe("PROVIDE_EVIDENCE");

    // Evidence package draft
    expect(detail!.evidenceDraftInfo).toBeDefined();
    expect(detail!.evidenceDraftInfo?.coverNote.length).toBeGreaterThan(20);
    expect(detail!.evidenceDraftInfo?.attestationSections.length).toBeGreaterThan(2);
    expect(detail!.evidenceDraftInfo?.customId).toContain("poi:0192f3a0-0000-7000-8000-000000000001");
    expect(detail!.evidenceDraftInfo?.pdfFilename).toBe("evidence-PP-D-1001.pdf");
  });

  it("loads overreaching dispute PP-D-1002 with failing rules highlighted", () => {
    const detail = getDisputeDetail("PP-D-1002");
    expect(detail).toBeDefined();
    expect(detail!.id).toBe("PP-D-1002");
    expect(detail!.decision).toBe("concede");

    // Mandate text vs Cart actuals
    expect(detail!.shopperIntentText).toContain("grey running jacket under $80");
    expect(detail!.cartTotal.value).toBe(9500); // Exceeds $80 max
    expect(detail!.cartLines[0]?.color).toBe("red"); // Mismatch from grey

    // Failing constraints identified with reason codes
    const failingRules = detail!.constraintChecks.filter((c) => c.status === "FAIL");
    expect(failingRules).toHaveLength(2);

    const amountRule = failingRules.find((r) => r.id === "rule-amount");
    expect(amountRule).toBeDefined();
    expect(amountRule?.reasonCode).toBe("AMOUNT_EXCEEDS_MAX");
    expect(amountRule?.cartActual).toBe("$95.00");

    const colorRule = failingRules.find((r) => r.id === "rule-color");
    expect(colorRule).toBeDefined();
    expect(colorRule?.reasonCode).toBe("ATTRIBUTE_MISMATCH");
    expect(colorRule?.cartActual).toBe("red");

    // Classification recommends concession
    expect(detail!.classificationInfo.disputeClass).toBe("AGENT_OVERREACH");
    expect(detail!.classificationInfo.recommendedAction).toBe("ACCEPT_CLAIM");
    expect(detail!.evidenceDraftInfo).toBeUndefined();
  });

  it("fetches dispute detail from API and falls back gracefully", async () => {
    const mockDetail: DisputeDetail = {
      id: "PP-D-API-1",
      orderId: "ord_1",
      paypalOrderId: "PP_1",
      status: "ACTION_REQUIRED",
      decision: "defend",
      disputeClass: "MANDATE_COMPLIANT",
      amount: { value: 6000, currency: "USD" },
      createdAt: "2026-11-01T00:00:00Z",
      sellerResponseDueDate: "2026-11-05T00:00:00Z",
      reasons: [],
      agentPlatform: "TestBot",
      buyerDisputeReason: "TEST",
      shopperIntentText: "Test intent",
      mandateId: "0192f3a0-0000-7000-8000-000000000099",
      mandateNonce: "n-test",
      mandateIssuer: "key-1",
      mandateCreatedAt: "2026-11-01T00:00:00Z",
      mandateExpiry: "2026-11-08T00:00:00Z",
      cartLines: [],
      cartTotal: { value: 6000, currency: "USD" },
      cartMerchantName: "Test Merchant",
      constraints: {
        amountMax: { value: 6000, currency: "USD" },
        merchantAllowlist: [],
        attributes: {},
        quantityMax: { perLine: 1, perOrder: 1 },
      },
      constraintChecks: [],
      classificationInfo: {
        disputeClass: "MANDATE_COMPLIANT",
        confidence: 0.9,
        recommendedAction: "PROVIDE_EVIDENCE",
        reasons: [],
        evidencePlan: [],
      },
      auditLog: [],
    };

    // Successful API fetch
    const mockSuccessFetch = (async () => ({
      ok: true,
      status: 200,
      json: async () => mockDetail,
    })) as unknown as typeof fetch;

    const apiResult = await fetchDisputeDetail("PP-D-API-1", { apiBaseUrl: "http://example.test", fetchFn: mockSuccessFetch });
    expect(apiResult?.id).toBe("PP-D-API-1");
    expect(apiResult?.agentPlatform).toBe("TestBot");

    // API error (501 or network failure) -> falls back to local fixture
    const mockErrorFetch = (async () => {
      throw new Error("connection failed");
    }) as unknown as typeof fetch;

    const fallbackResult = await fetchDisputeDetail("PP-D-1001", { apiBaseUrl: "http://example.test", fetchFn: mockErrorFetch });
    expect(fallbackResult?.id).toBe("PP-D-1001");
    expect(fallbackResult?.decision).toBe("defend");

    // Unknown dispute ID returns undefined
    const notFoundResult = await fetchDisputeDetail("UNKNOWN-ID", { apiBaseUrl: "http://example.test", fetchFn: mockErrorFetch });
    expect(notFoundResult).toBeUndefined();
  });
});
