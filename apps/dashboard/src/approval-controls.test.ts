import { describe, expect, it } from "vitest";
import {
  isDisputeActionable,
  recordApprovalAction,
  toApiActionEndpoint,
  validateActionInput,
} from "./approval-actions";
import { getDisputeDetail } from "./dispute-details";

describe("human approval controls & audit log (spec 0005 & 0007)", () => {
  it("determines dispute actionability and locks actions once resolved", () => {
    expect(isDisputeActionable({ status: "ACTION_REQUIRED" })).toBe(true);
    expect(isDisputeActionable({ status: "UNDER_REVIEW" })).toBe(true);
    expect(isDisputeActionable({ status: "WAITING_FOR_BUYER_RESPONSE" })).toBe(true);
    expect(isDisputeActionable({ status: "WAITING_FOR_SELLER_RESPONSE" })).toBe(true);
    expect(isDisputeActionable({ status: "RESOLVED" })).toBe(false);

    // Verify resolved disputes in seed data are locked
    const resolvedDispute = getDisputeDetail("PP-D-1012");
    expect(resolvedDispute).toBeDefined();
    expect(isDisputeActionable(resolvedDispute!)).toBe(false);

    // Active dispute PP-D-1001 is actionable
    const activeDispute = getDisputeDetail("PP-D-1001");
    expect(activeDispute).toBeDefined();
    expect(isDisputeActionable(activeDispute!)).toBe(true);
  });

  it("validates operator identity and written rationale notes in confirmation step", () => {
    // Missing operator
    const missingWho = validateActionInput({
      disputeId: "PP-D-1001",
      action: "SUBMIT_EVIDENCE",
      who: "",
      notes: "Approved evidence submission.",
    });
    expect(missingWho.valid).toBe(false);
    expect(missingWho.error).toContain("Operator identity");

    // Missing written notes
    const missingNotes = validateActionInput({
      disputeId: "PP-D-1001",
      action: "SUBMIT_EVIDENCE",
      who: "@hoursgotviral-dev",
      notes: "   ",
    });
    expect(missingNotes.valid).toBe(false);
    expect(missingNotes.error).toContain("Written rationale notes are required");

    // Valid confirmation
    const valid = validateActionInput({
      disputeId: "PP-D-1001",
      action: "SUBMIT_EVIDENCE",
      who: "@hoursgotviral-dev",
      notes: "Attestation PDF and mandate verified against carrier tracking.",
    });
    expect(valid.valid).toBe(true);
    expect(valid.error).toBeUndefined();
  });

  it("maps operator actions to REST API endpoints matching spec 0003", () => {
    expect(toApiActionEndpoint("SUBMIT_EVIDENCE")).toBe("provide-evidence");
    expect(toApiActionEndpoint("ACCEPT_CLAIM")).toBe("accept-claim");
    expect(toApiActionEndpoint("REJECT_RECOMMENDATION")).toBe("reject-recommendation");
  });

  it("records SUBMIT_EVIDENCE approval action and marks dispute RESOLVED", async () => {
    const fixedNow = "2026-11-02T12:00:00Z";
    const result = await recordApprovalAction({
      disputeId: "PP-D-1001",
      action: "SUBMIT_EVIDENCE",
      who: "operator:hoursgotviral-dev",
      notes: "Mandate hash and tracking confirmed; submitting evidence package to PayPal.",
      now: fixedNow,
      metadata: { attestationHash: "e3b0c44298fc1c14" },
    });

    expect(result.success).toBe(true);
    expect(result.updatedStatus).toBe("RESOLVED");
    expect(result.auditEntry.who).toBe("operator:hoursgotviral-dev");
    expect(result.auditEntry.what).toBe("SUBMIT_EVIDENCE");
    expect(result.auditEntry.when).toBe(fixedNow);
    expect(result.auditEntry.notes).toContain("Mandate hash and tracking confirmed");
    expect(result.auditEntry.metadata?.attestationHash).toBe("e3b0c44298fc1c14");
    expect(result.auditEntry.metadata?.newStatus).toBe("RESOLVED");
  });

  it("records ACCEPT_CLAIM concession action with refund amount and resolves dispute", async () => {
    const fixedNow = "2026-11-02T13:00:00Z";
    const refundAmount = { value: 9500, currency: "USD" };
    const result = await recordApprovalAction({
      disputeId: "PP-D-1002",
      action: "ACCEPT_CLAIM",
      who: "operator:hoursgotviral-dev",
      notes: "Confirmed agent broke budget limit of $80; issued full refund of $95.00.",
      now: fixedNow,
      metadata: { refundAmount, agentPlatform: "LangChain" },
    });

    expect(result.success).toBe(true);
    expect(result.updatedStatus).toBe("RESOLVED");
    expect(result.auditEntry.who).toBe("operator:hoursgotviral-dev");
    expect(result.auditEntry.what).toBe("ACCEPT_CLAIM");
    expect(result.auditEntry.metadata?.refundAmount).toEqual(refundAmount);
    expect(result.auditEntry.metadata?.agentPlatform).toBe("LangChain");
  });

  it("records REJECT_RECOMMENDATION override with new decision and operator notes", async () => {
    const fixedNow = "2026-11-02T14:00:00Z";
    const result = await recordApprovalAction({
      disputeId: "PP-D-1002",
      action: "REJECT_RECOMMENDATION",
      who: "operator:hoursgotviral-dev",
      notes: "Overriding copilot: buyer confirmed in chat they authorized the red jacket upgrade.",
      overrideDecision: "defend",
      now: fixedNow,
    });

    expect(result.success).toBe(true);
    expect(result.updatedDecision).toBe("defend");
    expect(result.auditEntry.what).toBe("REJECT_RECOMMENDATION");
    expect(result.auditEntry.metadata?.overrideDecision).toBe("defend");
  });

  it("submits action to HTTP API and falls back gracefully when server returns 501 or offline", async () => {
    let capturedUrl = "";
    let capturedBody = "";

    const mockFetchSuccess = (async (url: string, init?: RequestInit) => {
      capturedUrl = url;
      capturedBody = init?.body as string;
      return {
        ok: true,
        status: 200,
        json: async () => ({ status: "RESOLVED", message: "Dispute evidence submitted to PayPal." }),
      };
    }) as unknown as typeof fetch;

    const result = await recordApprovalAction(
      {
        disputeId: "PP-D-1001",
        action: "SUBMIT_EVIDENCE",
        who: "@hoursgotviral-dev",
        notes: "Evidence submitted via API.",
      },
      { apiBaseUrl: "http://example.test", fetchFn: mockFetchSuccess }
    );

    expect(result.success).toBe(true);
    expect(capturedUrl).toBe("http://example.test/disputes/PP-D-1001/actions/provide-evidence");
    expect(capturedBody).toContain("@hoursgotviral-dev");
    expect(capturedBody).toContain("SUBMIT_EVIDENCE");

    // Network error fallback
    const mockFetchError = (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;

    const fallbackResult = await recordApprovalAction(
      {
        disputeId: "PP-D-1001",
        action: "ACCEPT_CLAIM",
        who: "@hoursgotviral-dev",
        notes: "Offline fallback test.",
      },
      { apiBaseUrl: "http://example.test", fetchFn: mockFetchError }
    );

    expect(fallbackResult.success).toBe(true);
    expect(fallbackResult.updatedStatus).toBe("RESOLVED");
    expect(fallbackResult.auditEntry.notes).toBe("Offline fallback test.");
  });

  it("verifies initial audit trail entries for seed disputes", () => {
    const detail = getDisputeDetail("PP-D-1001");
    expect(detail).toBeDefined();
    expect(detail!.auditLog.length).toBeGreaterThanOrEqual(2);

    const webhookEvent = detail!.auditLog.find((e) => e.what === "DISPUTE_RECEIVED");
    expect(webhookEvent).toBeDefined();
    expect(webhookEvent?.who).toBe("system:webhook");

    const classifyEvent = detail!.auditLog.find((e) => e.what === "CLASSIFICATION_COMPLETED");
    expect(classifyEvent).toBeDefined();
    expect(classifyEvent?.who).toBe("copilot:pipeline");
  });
});
