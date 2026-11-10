// The browser's half of revoking an intent and reading its receipt (docs/specs/0013, #176).
import { describe, expect, test } from "vitest";
import { IntentReceiptProof, IntentRevocation, ShopperProof, type IntentReceipt } from "@poi/contracts";
import { intentReceiptProof, intentRevocation, receiptRows } from "./intent-controls";

const ID = "0192f3a0-0000-7000-8000-000000000001";
const HASH = "a".repeat(64);
const NOW = new Date("2026-11-10T12:00:00.000Z");

describe("what the browser signs", () => {
  test("a revocation names this intent by id and hash, and is a shopper proof the merchant parses", () => {
    const r = intentRevocation(ID, HASH, NOW);
    expect(IntentRevocation.parse(r)).toEqual({
      purpose: "intent.revoke",
      mandate_id: ID,
      intent_mandate_hash: HASH,
      issued_at: NOW.toISOString(),
    });
    expect(ShopperProof.parse(r)).toEqual(r);
  });

  test("a receipt request names the intent's hash", () => {
    expect(IntentReceiptProof.parse(intentReceiptProof(HASH, NOW))).toMatchObject({
      purpose: "intent.receipt",
      intent_mandate_hash: HASH,
    });
  });
});

describe("the receipt as the shopper reads it", () => {
  const receipt = (over: Partial<IntentReceipt>): IntentReceipt => ({
    mandate_id: ID,
    intent_mandate_hash: HASH,
    state: "ACTIVE",
    expires_at: "2026-11-11T12:00:00.000Z",
    spent: { value: 0, currency: "USD" },
    held: { value: 0, currency: "USD" },
    remaining: { per_purchase: { value: 8000, currency: "USD" }, total: null, purchases: 1 },
    purchases: [],
    ...over,
  });

  test("before anything is bought: one purchase of up to the cap", () => {
    expect(receiptRows(receipt({}))).toEqual([
      { label: "Status", value: "Active: your agent can still buy within these limits" },
      { label: "Spent", value: "$0" },
      { label: "Next purchase", value: "up to $80" },
      { label: "Purchases left", value: "One" },
    ]);
  });

  test("a budget with an order waiting shows what is set aside and what is left", () => {
    const rows = receiptRows(
      receipt({
        spent: { value: 7400, currency: "USD" },
        held: { value: 2500, currency: "USD" },
        remaining: {
          per_purchase: { value: 5100, currency: "USD" },
          total: { value: 5100, currency: "USD" },
          purchases: null,
        },
      }),
    );
    expect(rows).toContainEqual({ label: "Set aside", value: "$25, waiting to be paid or released" });
    expect(rows).toContainEqual({ label: "Budget left", value: "$51" });
    expect(rows.find((r) => r.label === "Purchases left")).toBeUndefined(); // a budget alone limits no count
  });

  test("used up only by an order still waiting: says it is in use, not gone", () => {
    const rows = receiptRows(
      receipt({
        state: "USED_UP",
        held: { value: 7400, currency: "USD" },
        remaining: { per_purchase: null, total: null, purchases: 0 },
      }),
    );
    expect(rows[0]!.value).toMatch(/^In use: an order is waiting/);
  });

  test("revoked: says so, and nothing is left", () => {
    const rows = receiptRows(
      receipt({
        state: "REVOKED",
        remaining: { per_purchase: { value: 0, currency: "USD" }, total: null, purchases: 0 },
      }),
    );
    expect(rows[0]).toEqual({ label: "Status", value: "Revoked: nothing more can be bought under it" });
    expect(rows).toContainEqual({ label: "Purchases left", value: "None" });
    expect(rows.find((r) => r.label === "Next purchase")).toBeUndefined();
  });
});
