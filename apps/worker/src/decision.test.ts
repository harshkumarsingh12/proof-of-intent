import { describe, expect, it } from "vitest";
import type { ReasonCode, Verdict } from "@poi/contracts";
import type { AuditEntry } from "@poi/db";
import {
  decideDispute,
  InMemoryDecisionStore,
  recordDisputeDecision,
  type DecisionInput,
} from "./decision";

describe("dispute decision step", () => {
  it("marks a compliant order as defend with provide-evidence action", () => {
    const input: DecisionInput = {
      disputeId: "d-compliant",
      classification: {
        class: "MANDATE_COMPLIANT",
        action: "PROVIDE_EVIDENCE",
        reasons: [],
      },
      checkoutVerdict: {
        outcome: "APPROVE",
        reasons: [],
      },
      order: {
        orderId: "ord-1",
        hasMandate: true,
        customId: "poi:0192f3a0-0000-7000-8000-000000000001:0000000000000000",
      },
    };

    const res = decideDispute(input);
    expect(res.decision).toBe("defend");
    expect(res.action).toBe("PROVIDE_EVIDENCE");
    expect(res.isBlocked).toBe(false);
    expect(res.reasons).toEqual([]);
  });

  it("marks an overreaching order as concede and attaches reason codes", () => {
    const checkoutVerdict: Verdict = {
      outcome: "REJECT",
      reasons: ["AMOUNT_EXCEEDS_MAX" as ReasonCode],
    };

    const input: DecisionInput = {
      disputeId: "d-overreach",
      classification: {
        class: "AGENT_OVERREACH",
        action: "ACCEPT_CLAIM",
        reasons: ["AMOUNT_EXCEEDS_MAX" as ReasonCode, "ATTRIBUTE_MISMATCH" as ReasonCode],
      },
      checkoutVerdict,
      order: {
        orderId: "ord-2",
        hasMandate: true,
        customId: "poi:0192f3a0-0000-7000-8000-000000000001:0000000000000000",
      },
    };

    const res = decideDispute(input);
    expect(res.decision).toBe("concede");
    expect(res.action).toBe("ACCEPT_CLAIM");
    expect(res.isBlocked).toBe(false);
    expect(res.reasons).toContain("AMOUNT_EXCEEDS_MAX");
    expect(res.reasons).toContain("ATTRIBUTE_MISMATCH");
    // Ensure reasons are deduplicated
    expect(res.reasons.filter((r) => r === "AMOUNT_EXCEEDS_MAX")).toHaveLength(1);
  });

  it("routes an order with no mandate to standard dispute path and never blocks", () => {
    const input: DecisionInput = {
      disputeId: "d-no-mandate",
      classification: {
        class: "NO_MANDATE",
        action: "STANDARD_EVIDENCE",
        reasons: [],
      },
      checkoutVerdict: null,
      order: {
        orderId: "ord-3",
        hasMandate: false,
      },
    };

    const res = decideDispute(input);
    expect(res.decision).toBe("standard");
    expect(res.class).toBe("NO_MANDATE");
    expect(res.action).toBe("STANDARD_EVIDENCE");
    expect(res.isBlocked).toBe(false);
  });

  it("marks intent misread as concede with semantic mismatch reason", () => {
    const input: DecisionInput = {
      disputeId: "d-misread",
      classification: {
        class: "INTENT_MISREAD",
        action: "ACCEPT_CLAIM",
        reasons: [],
      },
      checkoutVerdict: {
        outcome: "APPROVE",
        reasons: [],
      },
      order: {
        orderId: "ord-4",
        hasMandate: true,
        customId: "poi:0192f3a0-0000-7000-8000-000000000001:0000000000000000",
      },
    };

    const res = decideDispute(input);
    expect(res.decision).toBe("concede");
    expect(res.action).toBe("ACCEPT_CLAIM");
    expect(res.isBlocked).toBe(false);
    expect(res.reasons).toContain("SEMANTIC_MISMATCH");
  });

  it("stores decision and appends audit log entry", async () => {
    const store = new InMemoryDecisionStore();
    const auditLogs: AuditEntry[] = [];
    const db = {
      appendAudit: async (entry: AuditEntry) => {
        auditLogs.push(entry);
      },
    };

    const input: DecisionInput = {
      disputeId: "d-audit-test",
      classification: {
        class: "MANDATE_COMPLIANT",
        action: "PROVIDE_EVIDENCE",
      },
      checkoutVerdict: {
        outcome: "APPROVE",
        reasons: [],
      },
      order: {
        orderId: "ord-5",
        hasMandate: true,
        customId: "poi:0192f3a0-0000-7000-8000-000000000001:0000000000000000",
      },
    };

    const result = await recordDisputeDecision(input, { store, db });
    expect(result.decision).toBe("defend");

    const saved = await store.get("d-audit-test");
    expect(saved).toEqual(result);

    expect(auditLogs).toHaveLength(1);
    expect(auditLogs[0]?.action).toBe("dispute.decision");
    expect(auditLogs[0]?.subjectId).toBe("d-audit-test");
  });
});
