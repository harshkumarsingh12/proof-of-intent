import { describe, expect, it } from "vitest";
import {
  executeDisputeAction,
  fetchPaypalActions,
  fetchDisputeDetail,
  fetchDisputeDetailDetailed,
  getDisputeDetail,
} from "./api";
import type { DisputeDetail } from "./dispute-types";
import { widgets } from "./widgets";

describe("dispute detail & mandate diff (spec 0007)", () => {
  it("preserves the historical seed label when a case is served by the real API", async () => {
    const data = { ...getDisputeDetail("PP-D-1002")!, isDemoData: true };
    const fetchFn = (async () => Response.json(data)) as typeof fetch;
    const loaded = await fetchDisputeDetailDetailed("PP-D-1002", { apiBaseUrl: "http://api.test", fetchFn });
    expect(loaded.isFallback).toBe(false);
    expect(loaded.dispute?.isDemoData).toBe(true);
    expect(loaded.dispute?.id).toBe("PP-D-1002");
  });

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
    expect(detail!.checkoutVerdict).toBe("APPROVE");
    expect(detail!.evidenceDraftInfo).toBeDefined();
    expect(detail!.evidenceDraftInfo?.coverNote.length).toBeGreaterThan(20);
    expect(detail!.evidenceDraftInfo?.attestationSections.length).toBeGreaterThan(2);
    expect(detail!.evidenceDraftInfo?.attestationHash).toBe(
      "82db739af70408317d95f4eefeb744a7c47267451a0a3e9a1ad679e1e9e9956d",
    );
    expect(detail!.evidenceDraftInfo?.customId).toBe(
      "poi:0192f3a0-0000-7000-8000-000000000001:82db739af7040831",
    );
    expect(detail!.evidenceDraftInfo?.pdfFilename).toBe("evidence-PP-D-1001.pdf");
    const cryptoSection = detail!.evidenceDraftInfo?.attestationSections.find((s) =>
      s.heading.includes("Cryptographic"),
    );
    expect(cryptoSection?.body).toContain("ES256");
    expect(cryptoSection?.body).not.toContain("Ed25519");
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

  it("handles NO_MANDATE dispute PP-D-1015 honestly with no mandate, no passing checks, and STANDARD_EVIDENCE", () => {
    const detail = getDisputeDetail("PP-D-1015");
    expect(detail).toBeDefined();
    expect(detail!.id).toBe("PP-D-1015");
    expect(detail!.disputeClass).toBe("NO_MANDATE");
    expect(detail!.mandateId).toBeUndefined();
    expect(detail!.shopperIntentText).toBeUndefined();
    expect(detail!.constraintChecks).toHaveLength(0); // No passing checks
    expect(detail!.classificationInfo.recommendedAction).toBe("STANDARD_EVIDENCE");
    expect(detail!.evidenceDraftInfo).toBeUndefined();
  });

  it("does not fabricate Maximum Budget FAIL on INTENT_MISREAD disputes", () => {
    const detail = getDisputeDetail("PP-D-1009");
    expect(detail).toBeDefined();
    expect(detail!.disputeClass).toBe("INTENT_MISREAD");

    const budgetRule = detail!.constraintChecks.find((c) => c.id === "rule-amount");
    expect(budgetRule).toBeDefined();
    expect(budgetRule?.status).toBe("PASS"); // Budget check PASSES

    const intentRule = detail!.constraintChecks.find((c) => c.id === "rule-intent-interpretation");
    expect(intentRule).toBeDefined();
    expect(intentRule?.status).toBe("FAIL");
    expect(intentRule?.reasonCode).toBe("SEMANTIC_MISMATCH");
  });

  it("assigns distinct mandate IDs to different disputes rather than a shared id", () => {
    const d3 = getDisputeDetail("PP-D-1003");
    const d4 = getDisputeDetail("PP-D-1004");
    expect(d3?.mandateId).toBeDefined();
    expect(d4?.mandateId).toBeDefined();
    expect(d3?.mandateId).not.toBe(d4?.mandateId);
    expect(d3?.mandateId).not.toContain("000000000099");
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
    };

    // Successful API fetch with encoded ID and /recommendation endpoint
    let calledUrl = "";
    const mockSuccessFetch = (async (url: string) => {
      calledUrl = url;
      return {
        ok: true,
        status: 200,
        json: async () => mockDetail,
      };
    }) as unknown as typeof fetch;

    const detailedApiResult = await fetchDisputeDetailDetailed("PP-D-API/1", {
      apiBaseUrl: "http://example.test",
      fetchFn: mockSuccessFetch,
    });
    expect(calledUrl).toBe("http://example.test/disputes/PP-D-API%2F1/recommendation");
    expect(detailedApiResult.isFallback).toBe(false);
    expect(detailedApiResult.dispute?.isDemoData).toBe(false);
    expect(detailedApiResult.dispute?.id).toBe("PP-D-API-1");
    expect(detailedApiResult.dispute?.agentPlatform).toBe("TestBot");

    const directResult = await fetchDisputeDetail("PP-D-API/1", {
      apiBaseUrl: "http://example.test",
      fetchFn: mockSuccessFetch,
    });
    expect(directResult?.id).toBe("PP-D-API-1");

    // API error (501 or network failure) -> falls back to local fixture with isFallback=true and isDemoData=true
    const mockErrorFetch = (async () => {
      throw new Error("connection failed");
    }) as unknown as typeof fetch;

    const fallbackDetailed = await fetchDisputeDetailDetailed("PP-D-1001", {
      apiBaseUrl: "http://example.test",
      fetchFn: mockErrorFetch,
    });
    expect(fallbackDetailed.isFallback).toBe(true);
    expect(fallbackDetailed.dispute?.isDemoData).toBe(true);
    expect(fallbackDetailed.dispute?.id).toBe("PP-D-1001");
    expect(fallbackDetailed.dispute?.decision).toBe("defend");

    // Unknown dispute ID returns undefined
    const notFoundResult = await fetchDisputeDetailDetailed("UNKNOWN-ID", {
      apiBaseUrl: "http://example.test",
      fetchFn: mockErrorFetch,
    });
    expect(notFoundResult.dispute).toBeUndefined();
    expect(notFoundResult.isFallback).toBe(true);
  });

  it("calls API action endpoint and never reports success on failure or 501", async () => {
    // 1. Successful action
    let calledUrl = "";
    let calledOptions: RequestInit | undefined;
    const mockSuccessFetch = (async (url: string, init?: RequestInit) => {
      calledUrl = url;
      calledOptions = init;
      return {
        ok: true,
        status: 200,
        json: async () => ({ status: "RESOLVED" }),
      };
    }) as unknown as typeof fetch;

    const successResult = await executeDisputeAction(
      "PP-D-1001",
      "provide-evidence",
      { note: "evidence submitted" },
      { apiBaseUrl: "http://example.test", fetchFn: mockSuccessFetch },
    );

    expect(calledUrl).toBe("http://example.test/disputes/PP-D-1001/actions/provide-evidence");
    expect(calledOptions?.method).toBe("POST");
    expect(JSON.parse(String(calledOptions?.body))).toEqual({ note: "evidence submitted" });
    expect(successResult.success).toBe(true);

    // 2. Unimplemented 501 API route returns failure, never success
    const mock501Fetch = (async () => ({
      ok: false,
      status: 501,
      statusText: "Not Implemented",
      json: async () => ({ error: "not_implemented" }),
    })) as unknown as typeof fetch;

    const failureResult = await executeDisputeAction(
      "PP-D-1001",
      "accept-claim",
      {},
      { apiBaseUrl: "http://example.test", fetchFn: mock501Fetch },
    );

    expect(failureResult.success).toBe(false);
    expect(failureResult.status).toBe(501);
    expect(failureResult.error).toBe("not_implemented");

    // What PayPal allows: the parsed answer, or null (unknown) on any failure so nothing is blocked by mistake.
    const actions = {
      stage: "INQUIRY",
      status: "WAITING_FOR_SELLER_RESPONSE",
      allowed: ["accept-claim", "escalate"],
    };
    const okFetch = (async () => ({ ok: true, json: async () => actions })) as unknown as typeof fetch;
    expect(
      await fetchPaypalActions("PP-D-1001", { apiBaseUrl: "http://example.test", fetchFn: okFetch }),
    ).toEqual(actions);
    const downFetch = (async () => ({
      ok: false,
      status: 503,
      json: async () => ({}),
    })) as unknown as typeof fetch;
    expect(
      await fetchPaypalActions("PP-D-1001", { apiBaseUrl: "http://example.test", fetchFn: downFetch }),
    ).toBeNull();

    // The API's human message is what the operator sees, not the bare status.
    const unavailable = (async () => ({
      ok: false,
      status: 503,
      statusText: "Service Unavailable",
      json: async () => ({ error: "paypal_unavailable", message: "PayPal accept-claim failed; try again" }),
    })) as unknown as typeof fetch;
    const retry = await executeDisputeAction(
      "PP-D-1001",
      "accept-claim",
      {},
      { apiBaseUrl: "http://example.test", fetchFn: unavailable },
    );
    expect(retry.error).toBe("PayPal accept-claim failed; try again");

    // 3. Network error returns failure, never success
    const mockNetworkErrorFetch = (async () => {
      throw new Error("network timeout");
    }) as unknown as typeof fetch;

    const netResult = await executeDisputeAction(
      "PP-D-1001",
      "provide-evidence",
      {},
      { apiBaseUrl: "http://example.test", fetchFn: mockNetworkErrorFetch },
    );

    expect(netResult.success).toBe(false);
    expect(netResult.error).toContain("network timeout");
  });
});
