import { describe, expect, test } from "vitest";
import type { AuditEntry } from "@poi/db";
import { ledger } from "@poi/ledger";
import {
  buildEvidencePackage,
  recommend,
  recommendationStore,
  type DisputeDataLoader,
} from "./pipeline";

describe("dispute copilot classification", () => {
  test("a dispute on the overreaching fixture order is AGENT_OVERREACH → accept", async () => {
    const rec = await recommend("fixture-overreach");
    expect(rec.class).toBe("AGENT_OVERREACH");
    expect(rec.action).toBe("ACCEPT_CLAIM");
    expect(rec.reasons).toContain("AMOUNT_EXCEEDS_MAX");
  });

  test("a dispute on the compliant fixture order is MANDATE_COMPLIANT → evidence", async () => {
    const rec = await recommend("fixture-compliant");
    expect(rec.class).toBe("MANDATE_COMPLIANT");
    expect(rec.action).toBe("PROVIDE_EVIDENCE");
    expect(rec.reasons).toEqual([]);
  });

  test("a dispute on an order without a mandate is NO_MANDATE → standard evidence", async () => {
    const rec = await recommend("fixture-no-mandate");
    expect(rec.class).toBe("NO_MANDATE");
    expect(rec.action).toBe("STANDARD_EVIDENCE");
    expect(rec.reasons).toEqual([]);
  });

  test("stores recommendations and writes audit log entries", async () => {
    const auditLog: AuditEntry[] = [];
    const db = {
      appendAudit: async (entry: AuditEntry) => {
        auditLog.push(entry);
      },
    };

    const rec = await recommend("fixture-overreach", { db });
    expect(rec.disputeId).toBe("fixture-overreach");

    const saved = await recommendationStore.get("fixture-overreach");
    expect(saved).toEqual(rec);

    expect(auditLog).toHaveLength(1);
    expect(auditLog[0]?.action).toBe("dispute.classified");
    expect(auditLog[0]?.subjectId).toBe("fixture-overreach");
  });

  test("detects corrupted custom_id pointer as MANDATE_MISMATCH", async () => {
    const loader: DisputeDataLoader = {
      loadDispute: async () => ({
        disputeId: "d-corrupt",
        orderId: "ord-corrupt",
        status: "WAITING_FOR_SELLER_RESPONSE",
      }),
      loadOrder: async () => {
        const { greyJacketIntent, compliantCart } = await import("@poi/contracts/fixtures");
        return {
          orderId: "ord-corrupt",
          customId: `poi:${greyJacketIntent.mandate_id}:deadbeef00000000`,
          intent: greyJacketIntent,
          cart: compliantCart,
        };
      },
    };

    const rec = await recommend("d-corrupt", { loader });
    expect(rec.class).toBe("AGENT_OVERREACH");
    expect(rec.action).toBe("ACCEPT_CLAIM");
    expect(rec.reasons).toContain("MANDATE_MISMATCH");
  });
});

describe("dispute copilot (unbuilt)", () => {
  ledger("M2", "hoursgotviral-dev", "evidence package PDF carries the same hash as the PayPal custom_id", async () => {
    const pkg = await buildEvidencePackage("fixture-compliant");
    expect(pkg.bundleJson).toContain("mandate_hash");
  });
});
