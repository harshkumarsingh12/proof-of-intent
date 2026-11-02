import { beforeEach, describe, expect, test } from "vitest";
import { compliantCart, greyJacketIntent, NOW, overreachingCart, partialCart } from "@poi/contracts/fixtures";
import type { AuditEntry } from "@poi/db";
import { ledger } from "@poi/ledger";
import { customId, mandateHash } from "@poi/mandates";
import {
  buildEvidencePackage,
  recommend,
  recommendationStore,
  setDefaultDisputeLoader,
  type DisputeDataLoader,
} from "./pipeline";
import type { DisputeRecord, OrderRecord } from "./classifier";

class DefaultFixtureLoader implements DisputeDataLoader {
  private readonly disputes = new Map<string, DisputeRecord>([
    [
      "fixture-overreach",
      {
        disputeId: "fixture-overreach",
        orderId: "ord_overreach",
        status: "WAITING_FOR_SELLER_RESPONSE",
        reason: "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED",
      },
    ],
    [
      "fixture-compliant",
      {
        disputeId: "fixture-compliant",
        orderId: "ord_compliant",
        status: "WAITING_FOR_SELLER_RESPONSE",
        reason: "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED",
      },
    ],
    [
      "fixture-no-mandate",
      {
        disputeId: "fixture-no-mandate",
        orderId: "ord_no_mandate",
        status: "UNDER_REVIEW",
        reason: "UNAUTHORISED",
      },
    ],
    [
      "fixture-partial",
      {
        disputeId: "fixture-partial",
        orderId: "ord_partial",
        status: "WAITING_FOR_SELLER_RESPONSE",
        reason: "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED",
      },
    ],
  ]);

  private readonly orders = new Map<string, OrderRecord>([
    [
      "ord_overreach",
      {
        orderId: "ord_overreach",
        customId: customId(greyJacketIntent.mandate_id, mandateHash(greyJacketIntent)),
        intent: greyJacketIntent,
        cart: overreachingCart,
        capturedAt: NOW,
      },
    ],
    [
      "ord_compliant",
      {
        orderId: "ord_compliant",
        customId: customId(greyJacketIntent.mandate_id, mandateHash(greyJacketIntent)),
        intent: greyJacketIntent,
        cart: compliantCart,
        capturedAt: NOW,
      },
    ],
    [
      "ord_no_mandate",
      {
        orderId: "ord_no_mandate",
      },
    ],
    [
      "ord_partial",
      {
        orderId: "ord_partial",
        customId: customId(greyJacketIntent.mandate_id, mandateHash(greyJacketIntent)),
        intent: greyJacketIntent,
        cart: partialCart,
        capturedAt: NOW,
        j1Outcome: {
          fit: "partial",
          reasons: ["SEMANTIC_MISMATCH"],
        },
      },
    ],
  ]);

  async loadDispute(disputeId: string): Promise<DisputeRecord | null> {
    return this.disputes.get(disputeId) ?? null;
  }

  async loadOrder(orderId: string): Promise<OrderRecord | null> {
    return this.orders.get(orderId) ?? null;
  }
}

describe("dispute copilot classification", () => {
  beforeEach(() => {
    setDefaultDisputeLoader(new DefaultFixtureLoader());
  });
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

  test("a dispute with stored J1 mismatch is INTENT_MISREAD → accept", async () => {
    const rec = await recommend("fixture-partial");
    expect(rec.class).toBe("INTENT_MISREAD");
    expect(rec.action).toBe("ACCEPT_CLAIM");
    expect(rec.reasons).toContain("SEMANTIC_MISMATCH");
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

  test("resolves now from the order capture time for freshness evaluation", async () => {
    const expiredLoader: DisputeDataLoader = {
      loadDispute: async () => ({
        disputeId: "d-expired-capture",
        orderId: "ord-expired-capture",
      }),
      loadOrder: async () => ({
        orderId: "ord-expired-capture",
        customId: customId(greyJacketIntent.mandate_id, mandateHash(greyJacketIntent)),
        intent: greyJacketIntent,
        cart: compliantCart,
        capturedAt: "2099-01-01T00:00:00Z",
      }),
    };

    const rec = await recommend("d-expired-capture", { loader: expiredLoader });
    expect(rec.class).toBe("AGENT_OVERREACH");
    expect(rec.action).toBe("ACCEPT_CLAIM");
    expect(rec.reasons).toContain("MANDATE_EXPIRED");
  });
});

describe("dispute copilot (unbuilt)", () => {
  ledger("M2", "hoursgotviral-dev", "evidence package PDF carries the same hash as the PayPal custom_id", async () => {
    const pkg = await buildEvidencePackage("fixture-compliant");
    expect(pkg.bundleJson).toContain("mandate_hash");
  });
});
