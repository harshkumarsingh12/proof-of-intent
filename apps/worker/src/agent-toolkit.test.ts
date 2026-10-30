import { describe, expect, it } from "vitest";
import type { AuditEntry } from "@poi/db";
import {
  AgentToolkitDisputeService,
  HumanApprovalRequiredError,
  type HumanApprovalRecord,
} from "./agent-toolkit";

describe("PayPal Agent Toolkit dispute service in worker", () => {
  it("reads disputes and lists disputes in mock mode", async () => {
    const toolkit = new AgentToolkitDisputeService({ mode: "mock" });

    const dispute = await toolkit.get_dispute("fixture-compliant");
    expect(dispute.dispute_id).toBe("fixture-compliant");
    expect(dispute.status).toBe("WAITING_FOR_SELLER_RESPONSE");
    expect(dispute.disputed_transactions[0]?.seller_transaction_id).toBe("ord_compliant");

    const allDisputes = await toolkit.list_disputes();
    expect(allDisputes.length).toBeGreaterThanOrEqual(2);

    const filtered = await toolkit.list_disputes({ disputeState: "WAITING_FOR_SELLER_RESPONSE" });
    expect(filtered.every((d) => d.status === "WAITING_FOR_SELLER_RESPONSE")).toBe(true);
  });

  it("adds shipment tracking and records an audit log entry", async () => {
    const auditLogs: AuditEntry[] = [];
    const db = {
      appendAudit: async (entry: AuditEntry) => {
        auditLogs.push(entry);
      },
    };

    const toolkit = new AgentToolkitDisputeService({ db, mode: "mock" });
    const tracking = await toolkit.create_shipment_tracking({
      orderId: "ord_compliant",
      carrier: "USPS",
      trackingNumber: "9400100000000000000000",
      status: "SHIPPED",
    });

    expect(tracking.orderId).toBe("ord_compliant");
    expect(tracking.carrier).toBe("USPS");
    expect(tracking.status).toBe("SHIPPED");

    expect(auditLogs).toHaveLength(1);
    expect(auditLogs[0]?.action).toBe("tracking.created");
    expect(auditLogs[0]?.subjectId).toBe("ord_compliant");
  });

  it("blocks accept_dispute_claim without recorded operator approval", async () => {
    const toolkit = new AgentToolkitDisputeService({ mode: "mock" });

    await expect(toolkit.accept_dispute_claim("fixture-overreach")).rejects.toThrow(
      HumanApprovalRequiredError,
    );
  });

  it("blocks provide_evidence without recorded operator approval", async () => {
    const toolkit = new AgentToolkitDisputeService({ mode: "mock" });

    await expect(
      toolkit.provide_evidence("fixture-compliant", { notes: "Attestation PDF attached" }),
    ).rejects.toThrow(HumanApprovalRequiredError);
  });

  it("accepts dispute claim only after recorded operator approval", async () => {
    const auditLogs: AuditEntry[] = [];
    const db = {
      appendAudit: async (entry: AuditEntry) => {
        auditLogs.push(entry);
      },
    };

    const toolkit = new AgentToolkitDisputeService({ db, mode: "mock" });
    const approval: HumanApprovalRecord = {
      operatorId: "operator_jane",
      action: "accept-claim",
      disputeId: "fixture-overreach",
      approvedAt: "2026-11-05T14:00:00Z",
      note: "Agent overreach confirmed against intent budget.",
    };

    const result = await toolkit.accept_dispute_claim("fixture-overreach", approval);
    expect(result.status).toBe("RESOLVED");
    expect(result.outcome).toBe("ACCEPTED");

    // Must record operator approval first, then PayPal action completion
    expect(auditLogs).toHaveLength(2);
    expect(auditLogs[0]?.action).toBe("operator.dispute.action.approved");
    expect(auditLogs[0]?.actor).toBe("operator_jane");
    expect(auditLogs[1]?.action).toBe("paypal.accept_dispute_claim.completed");
    expect(auditLogs[1]?.actor).toBe("worker:toolkit");
  });

  it("submits evidence only after recorded operator approval", async () => {
    const auditLogs: AuditEntry[] = [];
    const db = {
      appendAudit: async (entry: AuditEntry) => {
        auditLogs.push(entry);
      },
    };

    const toolkit = new AgentToolkitDisputeService({ db, mode: "mock" });
    const approval: HumanApprovalRecord = {
      operatorId: "operator_bob",
      action: "provide-evidence",
      disputeId: "fixture-compliant",
      approvedAt: "2026-11-05T15:00:00Z",
      note: "Evidence package reviewed and approved.",
    };

    const result = await toolkit.provide_evidence(
      "fixture-compliant",
      {
        notes: "Evidence attestation attached.",
        files: [{ name: "attestation.pdf", data: new Uint8Array([1, 2, 3]) }],
      },
      approval,
    );

    expect(result.status).toBe("UNDER_REVIEW");

    expect(auditLogs).toHaveLength(2);
    expect(auditLogs[0]?.action).toBe("operator.dispute.action.approved");
    expect(auditLogs[0]?.actor).toBe("operator_bob");
    expect(auditLogs[1]?.action).toBe("paypal.provide_evidence.completed");
  });

  it("rejects mismatched approval action or dispute ID", async () => {
    const toolkit = new AgentToolkitDisputeService({ mode: "mock" });

    const mismatchedDispute: HumanApprovalRecord = {
      operatorId: "operator_jane",
      action: "accept-claim",
      disputeId: "different-dispute-id",
      approvedAt: "2026-11-05T14:00:00Z",
    };

    await expect(
      toolkit.accept_dispute_claim("fixture-overreach", mismatchedDispute),
    ).rejects.toThrow(HumanApprovalRequiredError);

    const mismatchedAction: HumanApprovalRecord = {
      operatorId: "operator_jane",
      action: "provide-evidence",
      disputeId: "fixture-overreach",
      approvedAt: "2026-11-05T14:00:00Z",
    };

    await expect(
      toolkit.accept_dispute_claim("fixture-overreach", mismatchedAction),
    ).rejects.toThrow(HumanApprovalRequiredError);
  });
});
