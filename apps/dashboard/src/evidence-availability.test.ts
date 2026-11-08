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

test("confidence is independent of record availability and is never described as calibrated certainty", () => {
  expect(confidenceDescription(0.83)).toContain("Uncalibrated model score: 0.83");
  expect(confidenceDescription(1)).toContain("not a probability of winning");
  for (const absent of [null, undefined, NaN, Infinity, -1, 2])
    expect(confidenceDescription(absent)).toContain("unavailable");
});
