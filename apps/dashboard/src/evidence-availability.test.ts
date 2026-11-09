import { expect, test } from "vitest";
import { getDisputeDetail } from "./dispute-details";
import { confidenceDescription, evidenceAvailability } from "./evidence-availability";

test("missing records and an unprepared preview are visible even for a compliant class", () => {
  const full = getDisputeDetail("PP-D-1001")!;
  const incomplete = {
    ...full,
    mandateId: undefined,
    cartLines: [],
    checkoutVerdict: "NONE",
    evidenceDraftInfo: undefined,
    evidenceDrafted: false,
  };
  expect(incomplete.disputeClass).toBe("MANDATE_COMPLIANT");
  expect(evidenceAvailability(incomplete)).toMatchObject({ available: 0, total: 4 });
  expect(evidenceAvailability(full).checks.find((c) => c.label === "Intent record")?.available).toBe(true);
});

test("an evidence preview is only counted where one is ever built: a concede or a no-mandate dispute has none to miss", () => {
  const preview = (id: string) => {
    const a = evidenceAvailability(getDisputeDetail(id)!);
    return {
      total: a.total,
      hasPreview: a.checks.some((c) => c.label === "Evidence preview"),
      all: a.checks.map((c) => c.available),
    };
  };
  expect(preview("PP-D-1001")).toMatchObject({ total: 4, hasPreview: true }); // compliant: the defend package
  expect(preview("PP-D-1002")).toEqual({ total: 3, hasPreview: false, all: [true, true, true] }); // the demo's overreach: 3/3, not 3/4
  expect(preview("PP-D-1015")).toMatchObject({ total: 3, hasPreview: false }); // no mandate: the standard path, no PDF
  // Real gaps are still reported where they are real.
  expect(preview("PP-D-1015").all).toContain(false);
});

test("confidence is independent of record availability and is never described as calibrated certainty", () => {
  expect(confidenceDescription(0.83)).toContain("Uncalibrated model score: 0.83");
  expect(confidenceDescription(1)).toContain("not a probability of winning");
  for (const absent of [null, undefined, NaN, Infinity, -1, 2])
    expect(confidenceDescription(absent)).toContain("unavailable");
});

// #170: nothing the dashboard shows as evidence, a buyer reply or a shopper note may assert delivery, cardholder
// authorization or a completed refund that the records don't establish.
test("no sample dispute asserts delivery, authorization or a refund the records don't establish (#170)", async () => {
  const { SEED_DISPUTES } = await import("./seed-disputes");
  const unsupported = [
    /deliver(y|ed)\s+(was\s+)?confirmed/i,
    /confirms?\s+delivery/i,
    /authori[sz]ed\s+by\s+the\s+cardholder/i,
    /refund\s+(was\s+)?(issued|completed)/i,
  ];
  for (const { id } of SEED_DISPUTES) {
    const d = getDisputeDetail(id)!;
    const shown = [
      d.shopperNotes ?? "",
      d.evidenceDraftInfo?.coverNote ?? "",
      d.evidenceDraftInfo?.buyerMessage ?? "",
      ...(d.evidenceDraftInfo?.attestationSections ?? []).map((s) => s.body),
      ...d.classificationInfo.reasons.map((r) => r.text),
      ...d.classificationInfo.evidencePlan,
    ].join("\n");
    for (const re of unsupported) {
      if (re.source.includes("deliver") && d.deliveryEvidence === "CONFIRMED") continue;
      expect(shown, `${id}: ${re}`).not.toMatch(re);
    }
  }
});
