import { describe, expect, it } from "vitest";
import type { DisputeDetail } from "./dispute-types";
import {
  actionLabel,
  cells,
  checkRows,
  diffView,
  disputePath,
  disputeRows,
  dueLabel,
  evidencePdfPath,
  hasEvidence,
  isUrgent,
  lifecycleStages,
  nextPermittedAction,
  NO_MANDATE_LABEL,
  platformCards,
  statusLabel,
  urgency,
  type StudioCheckRow,
  STUDIO_DETAIL_LIMIT,
  studioCoverageNote,
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

const detail = (id: string, checks: ReturnType<typeof check>[], over: Record<string, unknown> = {}) =>
  ({
    id,
    disputeClass: "AGENT_OVERREACH",
    agentPlatform: "Northstar",
    status: "WAITING_FOR_SELLER_RESPONSE",
    buyerDisputeReason: "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED",
    amount: { value: 9550, currency: "USD" },
    decision: "concede",
    sellerResponseDueDate: "2026-11-08T12:00:00.000Z",
    classificationInfo: { recommendedAction: "ACCEPT_CLAIM" },
    constraintChecks: checks,
    ...over,
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

describe("the disputes table the grid, tiles and charts read", () => {
  const now = new Date("2026-11-07T12:00:00.000Z");

  it("carries the action, the deadline in hours, and 0/1 and dollar columns for the tiles", () => {
    const [row] = disputeRows([detail("PP-1", [])], now);
    expect(row).toMatchObject({
      decision: "concede",
      action: "ACCEPT_CLAIM",
      dueAt: "2026-11-08T12:00:00.000Z",
      hoursToDue: 24,
      open: 1,
      overreach: 1,
      dueSoon: 1,
      overdue: 0,
      atStake: 95.5,
      conceded: 95.5,
    });
  });

  it("counts a resolved dispute as closed: nothing at stake, never due soon, still conceded if it was an overreach", () => {
    const [row] = disputeRows([detail("PP-2", [], { status: "RESOLVED" })], now);
    expect(row).toMatchObject({ open: 0, dueSoon: 0, overdue: 0, atStake: 0, conceded: 95.5 });
  });

  it("is not due soon when the deadline is more than a day away; a late one is overdue, counted apart from due soon (#165)", () => {
    const far = disputeRows(
      [detail("PP-3", [], { sellerResponseDueDate: "2026-11-20T00:00:00.000Z" })],
      now,
    )[0]!;
    expect([far.dueSoon, far.overdue, far.hoursToDue > 24]).toEqual([0, 0, true]);
    const late = disputeRows(
      [detail("PP-4", [], { sellerResponseDueDate: "2026-11-06T00:00:00.000Z" })],
      now,
    )[0]!;
    expect([late.dueSoon, late.overdue, late.hoursToDue < 0]).toEqual([0, 1, true]);
    // The edges: exactly now and exactly 24 hours are still "due soon"; one minute past now is overdue; a resolved one is neither.
    const at = (due: string, status = "WAITING_FOR_SELLER_RESPONSE") =>
      disputeRows([detail("PP-E", [], { sellerResponseDueDate: due, status })], now)[0]!;
    expect([at("2026-11-07T12:00:00.000Z").dueSoon, at("2026-11-07T12:00:00.000Z").overdue]).toEqual([1, 0]);
    expect([at("2026-11-08T12:00:00.000Z").dueSoon, at("2026-11-08T12:00:00.000Z").overdue]).toEqual([1, 0]);
    expect([at("2026-11-07T11:59:00.000Z").dueSoon, at("2026-11-07T11:59:00.000Z").overdue]).toEqual([0, 1]);
    expect([
      at("2026-11-06T00:00:00.000Z", "RESOLVED").dueSoon,
      at("2026-11-06T00:00:00.000Z", "RESOLVED").overdue,
    ]).toEqual([0, 0]);
  });

  it("copes with a missing deadline, a compliant dispute (no conceded dollars) and a missing analysis", () => {
    const [row] = disputeRows(
      [
        detail("PP-5", [], {
          sellerResponseDueDate: "",
          disputeClass: "MANDATE_COMPLIANT",
          classificationInfo: undefined,
        }),
      ],
      now,
    );
    expect(row).toMatchObject({
      dueAt: "",
      hoursToDue: 99_999,
      dueSoon: 0,
      overdue: 0,
      conceded: 0,
      overreach: 0,
      action: "",
    });
  });

  it("labels orders with no agent platform instead of showing 'none'", () => {
    const rows = disputeRows(
      [detail("PP-6", [], { agentPlatform: "none" }), detail("PP-7", [], { agentPlatform: "" })],
      now,
    );
    expect(rows.map((r) => r.agentPlatform)).toEqual([NO_MANDATE_LABEL, NO_MANDATE_LABEL]);
  });

  it("passes the cover note through for the evidence preview", () => {
    const [row] = disputeRows(
      [detail("PP-8", [], { evidenceDraftInfo: { coverNote: "Signed record attached." } })],
      now,
    );
    expect(row?.coverNote).toBe("Signed record attached.");
  });
});

describe("grid labels", () => {
  it("sorts open disputes by deadline and resolved ones after all of them", () => {
    const rows = [
      { status: "RESOLVED", hoursToDue: -500 },
      { status: "WAITING_FOR_SELLER_RESPONSE", hoursToDue: 200 },
      { status: "WAITING_FOR_SELLER_RESPONSE", hoursToDue: 5 },
    ];
    expect([...rows].sort((a, b) => urgency(a) - urgency(b)).map((r) => r.hoursToDue)).toEqual([
      5, 200, -500,
    ]);
  });

  it("says how long is left in plain terms", () => {
    const open = (hoursToDue: number) => ({ status: "WAITING_FOR_SELLER_RESPONSE", hoursToDue });
    expect(dueLabel(open(-2))).toBe("Overdue");
    expect(dueLabel(open(0.2))).toBe("1h");
    expect(dueLabel(open(30))).toBe("30h");
    expect(dueLabel(open(96))).toBe("4d");
    expect(dueLabel(open(99_999))).toBe("No deadline");
    expect(dueLabel({ status: "RESOLVED", hoursToDue: -1 })).toBe("Closed");
  });

  it("flags only open disputes due within a day or already late", () => {
    const open = (hoursToDue: number) => ({ status: "ACTION_REQUIRED", hoursToDue });
    expect([isUrgent(open(-3)), isUrgent(open(24)), isUrgent(open(25)), isUrgent(open(99_999))]).toEqual([
      true,
      true,
      false,
      false,
    ]);
    expect(isUrgent({ status: "RESOLVED", hoursToDue: -3 })).toBe(false);
  });

  it("words the actions and statuses for people", () => {
    expect(actionLabel("PROVIDE_EVIDENCE")).toBe("Defend with evidence");
    expect(actionLabel("ACCEPT_CLAIM")).toBe("Accept the claim");
    expect(actionLabel("")).toBe("Not analysed yet");
    expect(actionLabel("SOMETHING_NEW")).toBe("SOMETHING_NEW");
    expect(statusLabel("WAITING_FOR_SELLER_RESPONSE")).toBe("Waiting for seller response");
  });

  it("links to the full dispute page and escapes the id", () => {
    expect(disputePath("PP-R-1")).toBe("/disputes/PP-R-1");
    expect(disputePath("a/b c")).toBe("/disputes/a%2Fb%20c");
  });
});

describe("Studio says when it is not showing every dispute (#173, #234)", () => {
  it("is silent when Studio has them all, and says how many of how many when it does not", () => {
    expect(studioCoverageNote(24, 24)).toBeUndefined();
    expect(studioCoverageNote(0, 0)).toBeUndefined();
    expect(studioCoverageNote(24, 30)).toBeUndefined(); // more than the total is not "partial"
    expect(studioCoverageNote(150, 60)).toContain("Studio shows 60 of 150 disputes");
  });

  it("loads the details of the 60 most urgent disputes", () => {
    expect(STUDIO_DETAIL_LIMIT).toBe(60);
  });
});

describe("Studio operator tasks & workflow lifecycle (#181)", () => {
  it("carries missing evidence and outcome in dispute rows", () => {
    const rows = disputeRows([
      detail("PP-INR", [], {
        buyerDisputeReason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
        missingEvidence: ["Proof of Fulfillment (carrier tracking)"],
      }),
      detail("PP-RESOLVED", [], {
        status: "RESOLVED",
        outcome: { result: "SELLER_FAVOUR", code: "RESOLVED_SELLER_FAVOUR" },
      }),
    ]);

    expect(rows[0]!.missingEvidence).toBe("Proof of Fulfillment (carrier tracking)");
    expect(rows[0]!.outcome).toBe("");

    expect(rows[1]!.outcome).toBe("SELLER_FAVOUR");
  });

  it("identifies next permitted action, blocking closed disputes", () => {
    expect(nextPermittedAction("PROVIDE_EVIDENCE", "WAITING_FOR_SELLER_RESPONSE")).toBe("Defend with evidence");
    expect(nextPermittedAction("ACCEPT_CLAIM", "WAITING_FOR_SELLER_RESPONSE")).toBe("Accept the claim");
    expect(nextPermittedAction("PROVIDE_EVIDENCE", "RESOLVED")).toBe("None (dispute resolved)");
  });

  it("distinguishes recommendation, action submitted, and outcome confirmed", () => {
    // Open dispute, awaiting operator
    const initialStages = lifecycleStages({
      action: "PROVIDE_EVIDENCE",
      status: "WAITING_FOR_SELLER_RESPONSE",
    });
    expect(initialStages).toEqual([
      { stage: "recommendation", label: "Recommendation", detail: "Defend with evidence", confirmed: true },
      { stage: "action_submitted", label: "Action submitted", detail: "Awaiting operator submission", confirmed: false },
      { stage: "outcome_confirmed", label: "Outcome confirmed", detail: "Pending PayPal confirmation", confirmed: false },
    ]);

    // Operator submitted evidence
    const submittedStages = lifecycleStages(
      { action: "PROVIDE_EVIDENCE", status: "UNDER_REVIEW" },
      "Operator submitted the evidence package",
    );
    expect(submittedStages[1]).toEqual({
      stage: "action_submitted",
      label: "Action submitted",
      detail: "Operator submitted the evidence package",
      confirmed: true,
    });
    expect(submittedStages[2]!.confirmed).toBe(false);

    // Resolved in seller favour
    const resolvedStages = lifecycleStages(
      { action: "PROVIDE_EVIDENCE", status: "RESOLVED", outcome: "SELLER_FAVOUR" },
      "Operator submitted the evidence package",
    );
    expect(resolvedStages[2]).toEqual({
      stage: "outcome_confirmed",
      label: "Outcome confirmed",
      detail: "Resolved in seller's favour",
      confirmed: true,
    });
  });
});
