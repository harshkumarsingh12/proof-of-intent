import { describe, expect, it } from "vitest";
import type { DisputeDetail } from "./dispute-types";
import {
  cells,
  checkRows,
  diffView,
  disputeRows,
  evidencePdfPath,
  hasEvidence,
  platformCards,
  type StudioCheckRow,
} from "./studio-data";

const check = (name: string, status: "PASS" | "FAIL", reasonCode?: string) => ({
  id: name,
  name,
  mandateRule: `rule ${name}`,
  cartActual: `actual ${name}`,
  status,
  explanation: "",
  ...(reasonCode ? { reasonCode } : {}),
});

const detail = (id: string, checks: ReturnType<typeof check>[]) =>
  ({
    id,
    disputeClass: "AGENT_OVERREACH",
    agentPlatform: "Northstar",
    status: "WAITING_FOR_SELLER_RESPONSE",
    buyerDisputeReason: "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED",
    amount: { value: 9550, currency: "USD" },
    constraintChecks: checks,
  }) as unknown as DisputeDetail;

describe("studio tables", () => {
  it("turns a dispute's amount into dollars so Studio can sum it", () => {
    expect(disputeRows([detail("PP-1", [])])).toEqual([
      expect.objectContaining({ id: "PP-1", agentPlatform: "Northstar", amount: 95.5 }),
    ]);
  });

  it("has one limits row per check per dispute, with an empty reason code when none", () => {
    const rows = checkRows([
      detail("PP-1", [check("amount_max", "FAIL", "AMOUNT_EXCEEDS_MAX"), check("quantity_max", "PASS")]),
      detail("PP-2", [check("amount_max", "PASS")]),
    ]);
    expect(rows.map((r) => [r.dispute, r.check, r.status, r.reasonCode])).toEqual([
      ["PP-1", "amount_max", "FAIL", "AMOUNT_EXCEEDS_MAX"],
      ["PP-1", "quantity_max", "PASS", ""],
      ["PP-2", "amount_max", "PASS", ""],
    ]);
  });

  it("copes with a dispute that has no checks", () => {
    expect(checkRows([{ id: "PP-3" } as never])).toEqual([]);
  });
});

describe("cells", () => {
  it("reads a row keyed by field id, in the order asked", () => {
    expect(cells({ b: 2, a: 1 }, ["a", "b"])).toEqual([1, 2]);
  });
  it("reads a row keyed by position when the ids are not the keys", () => {
    expect(cells({ "0": "x", "1": "y" }, ["disputes.a", "disputes.b"])).toEqual(["x", "y"]);
  });
});

describe("mandate diff view", () => {
  const rows: StudioCheckRow[] = [
    {
      dispute: "PP-1",
      check: "merchant_allowlist",
      mandateRule: "m",
      cartActual: "m",
      status: "PASS",
      reasonCode: "",
    },
    {
      dispute: "PP-1",
      check: "amount_max",
      mandateRule: "USD 80.00",
      cartActual: "USD 95.00",
      status: "FAIL",
      reasonCode: "AMOUNT_EXCEEDS_MAX",
    },
    {
      dispute: "PP-2",
      check: "amount_max",
      mandateRule: "USD 80.00",
      cartActual: "USD 74.00",
      status: "PASS",
      reasonCode: "",
    },
  ];

  it("shows the first dispute, broken limits first, and counts them", () => {
    const view = diffView(rows, undefined, false);
    expect(view.disputes).toEqual(["PP-1", "PP-2"]);
    expect(view.selected).toBe("PP-1");
    expect(view.lines.map((l) => l.check)).toEqual(["amount_max", "merchant_allowlist"]);
    expect([view.failed, view.total]).toEqual([1, 2]);
  });

  it("'only violations' hides the limits that were met but still counts them", () => {
    const view = diffView(rows, "PP-1", true);
    expect(view.lines.map((l) => l.check)).toEqual(["amount_max"]);
    expect(view.total).toBe(2);
  });

  it("falls back to the first dispute when the picked one is filtered away, and handles no rows", () => {
    expect(diffView(rows, "PP-GONE", false).selected).toBe("PP-1");
    expect(diffView([], undefined, false)).toMatchObject({
      disputes: [],
      selected: undefined,
      lines: [],
      total: 0,
    });
  });

  it("switches dispute", () => {
    const view = diffView(rows, "PP-2", false);
    expect(view.lines).toHaveLength(1);
    expect(view.failed).toBe(0);
  });
});

describe("agent platform cards", () => {
  const groups = [
    { platform: "Wayfinder", disputeClass: "MANDATE_COMPLIANT", disputes: 4, amount: 400 },
    { platform: "Wayfinder", disputeClass: "AGENT_OVERREACH", disputes: 2, amount: 190.005 },
    { platform: "Tote", disputeClass: "MANDATE_COMPLIANT", disputes: 5, amount: 200 },
    { platform: "Errandly", disputeClass: "AGENT_OVERREACH", disputes: 1, amount: 120 },
  ];

  it("sums per platform: overreach rate and the dollars the copilot recommends conceding", () => {
    const cards = platformCards(groups);
    const wayfinder = cards.find((c) => c.platform === "Wayfinder")!;
    expect(wayfinder).toMatchObject({ disputes: 6, overreach: 2, concededAmount: 190.01 });
    expect(wayfinder.overreachRate).toBeCloseTo(1 / 3);
    expect(cards.find((c) => c.platform === "Tote")).toMatchObject({
      overreach: 0,
      overreachRate: 0,
      concededAmount: 0,
    });
  });

  it("puts the worst platform first, then the busiest, then by name", () => {
    expect(platformCards(groups).map((c) => c.platform)).toEqual(["Errandly", "Wayfinder", "Tote"]);
  });

  it("handles no groups", () => {
    expect(platformCards([])).toEqual([]);
  });
});

describe("evidence preview", () => {
  it("only compliant orders have a PDF", () => {
    expect(hasEvidence("MANDATE_COMPLIANT")).toBe(true);
    for (const c of ["AGENT_OVERREACH", "NO_MANDATE", "INTENT_MISREAD", undefined])
      expect(hasEvidence(c)).toBe(false);
  });
  it("points at the dashboard proxy and escapes the id", () => {
    expect(evidencePdfPath("PP-R-1")).toBe("/api/disputes/PP-R-1/evidence.pdf");
    expect(evidencePdfPath("a/b c")).toBe("/api/disputes/a%2Fb%20c/evidence.pdf");
  });
});
