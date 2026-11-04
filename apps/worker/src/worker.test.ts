import { describe, expect, test } from "vitest";
import { compliantCart, greyJacketIntent, NOW, overreachingCart, partialCart } from "@poi/contracts/fixtures";
import type { AuditEntry } from "@poi/db";
import { ledger } from "@poi/ledger";
import { customId, mandateHash } from "@poi/mandates";
import {
  buildEvidencePackage,
  InMemoryDisputeDataLoader,
  recommend,
  type DisputeDataLoader,
} from "./pipeline";

const pointer = customId(greyJacketIntent.mandate_id, mandateHash(greyJacketIntent));

const loader = new InMemoryDisputeDataLoader(
  [
    {
      disputeId: "fixture-overreach",
      orderId: "ord_overreach",
      status: "WAITING_FOR_SELLER_RESPONSE",
      reason: "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED",
    },
    {
      disputeId: "fixture-compliant",
      orderId: "ord_compliant",
      status: "WAITING_FOR_SELLER_RESPONSE",
      reason: "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED",
    },
    {
      disputeId: "fixture-no-mandate",
      orderId: "ord_no_mandate",
      status: "UNDER_REVIEW",
      reason: "UNAUTHORISED",
    },
    {
      disputeId: "fixture-partial",
      orderId: "ord_partial",
      status: "WAITING_FOR_SELLER_RESPONSE",
      reason: "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED",
    },
  ],
  [
    {
      orderId: "ord_overreach",
      customId: pointer,
      intent: greyJacketIntent,
      cart: overreachingCart,
      capturedAt: NOW,
    },
    {
      orderId: "ord_compliant",
      customId: pointer,
      intent: greyJacketIntent,
      cart: compliantCart,
      capturedAt: NOW,
    },
    {
      orderId: "ord_no_mandate",
    },
    {
      orderId: "ord_partial",
      customId: pointer,
      intent: greyJacketIntent,
      cart: partialCart,
      capturedAt: NOW,
      j1Outcome: {
        fit: "partial",
        reasons: ["SEMANTIC_MISMATCH"],
      },
    },
  ],
);

describe("dispute copilot classification", () => {
  test("a dispute on the overreaching fixture order is AGENT_OVERREACH → accept", async () => {
    const rec = await recommend("fixture-overreach", { loader });
    expect(rec.class).toBe("AGENT_OVERREACH");
    expect(rec.action).toBe("ACCEPT_CLAIM");
    expect(rec.reasons).toContain("AMOUNT_EXCEEDS_MAX");
  });

  test("a dispute on the compliant fixture order is MANDATE_COMPLIANT → evidence", async () => {
    const rec = await recommend("fixture-compliant", { loader });
    expect(rec.class).toBe("MANDATE_COMPLIANT");
    expect(rec.action).toBe("PROVIDE_EVIDENCE");
    expect(rec.reasons).toEqual([]);
  });

  test("a dispute on an order without a mandate is NO_MANDATE → standard evidence", async () => {
    const rec = await recommend("fixture-no-mandate", { loader });
    expect(rec.class).toBe("NO_MANDATE");
    expect(rec.action).toBe("STANDARD_EVIDENCE");
    expect(rec.reasons).toEqual([]);
  });

  test("a dispute with stored J1 mismatch is INTENT_MISREAD → accept", async () => {
    const rec = await recommend("fixture-partial", { loader });
    expect(rec.class).toBe("INTENT_MISREAD");
    expect(rec.action).toBe("ACCEPT_CLAIM");
    expect(rec.reasons).toContain("SEMANTIC_MISMATCH");
  });

  test("writes an audit log entry for the recommendation", async () => {
    const auditLog: AuditEntry[] = [];
    const db = {
      appendAudit: async (entry: AuditEntry) => {
        auditLog.push(entry);
      },
    };

    const rec = await recommend("fixture-overreach", { loader, db });
    expect(rec.disputeId).toBe("fixture-overreach");

    expect(auditLog).toHaveLength(1);
    expect(auditLog[0]?.action).toBe("dispute.classified");
    expect(auditLog[0]?.subjectId).toBe("fixture-overreach");
  });

  test("a custom_id that doesn't match our mandate takes the standard path, flagged MANDATE_MISMATCH", async () => {
    const corrupt: DisputeDataLoader = {
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

    const rec = await recommend("d-corrupt", { loader: corrupt });
    expect(rec.class).toBe("NO_MANDATE");
    expect(rec.action).toBe("STANDARD_EVIDENCE");
    expect(rec.reasons).toEqual(["MANDATE_MISMATCH"]);
  });

  test("resolves now from the order capture time for freshness evaluation", async () => {
    const expiredLoader: DisputeDataLoader = {
      loadDispute: async () => ({
        disputeId: "d-expired-capture",
        orderId: "ord-expired-capture",
      }),
      loadOrder: async () => ({
        orderId: "ord-expired-capture",
        customId: pointer,
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

  test("refuses to replay the rules without a capture time instead of using the wall clock", async () => {
    const noCapture = new InMemoryDisputeDataLoader(
      [{ disputeId: "d-no-capture", orderId: "ord-no-capture" }],
      [{ orderId: "ord-no-capture", customId: pointer, intent: greyJacketIntent, cart: compliantCart }],
    );
    await expect(recommend("d-no-capture", { loader: noCapture })).rejects.toThrow("no capture time");
  });

  test("a STEP_UP order the shopper approved is defended, not conceded", async () => {
    const stepUp = new InMemoryDisputeDataLoader(
      [{ disputeId: "d-stepup", orderId: "ord-stepup" }],
      [
        {
          orderId: "ord-stepup",
          customId: pointer,
          intent: greyJacketIntent,
          cart: partialCart,
          capturedAt: NOW,
          checkoutVerdict: { outcome: "STEP_UP", reasons: ["SEMANTIC_UNCERTAIN"] },
          j1Outcome: { fit: "partial" },
        },
      ],
    );
    const rec = await recommend("d-stepup", { loader: stepUp });
    expect(rec.class).toBe("MANDATE_COMPLIANT");
    expect(rec.action).toBe("PROVIDE_EVIDENCE");
  });
});

describe("dispute copilot (unbuilt)", () => {
  ledger(
    "M2",
    "hoursgotviral-dev",
    "evidence package PDF carries the same hash as the PayPal custom_id",
    async () => {
      const pkg = await buildEvidencePackage("fixture-compliant");
      expect(pkg.bundleJson).toContain("mandate_hash");
    },
  );
});
