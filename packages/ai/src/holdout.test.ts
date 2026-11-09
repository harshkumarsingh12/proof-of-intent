import { expect, test } from "vitest";
import { J1_EVAL_CASES } from "./eval-cases";
import { HOLDOUT_CASES, evaluateHoldout } from "./holdout";
import { j1ReplayKey } from "./j1";
import type { Generate } from "./runtime";

test("supplemental cases do not mutate or overlap the milestone set", () => {
  expect(J1_EVAL_CASES).toHaveLength(20);
  expect(HOLDOUT_CASES).toHaveLength(12);
  const golden = new Set(J1_EVAL_CASES.map((c) => j1ReplayKey(c.description, c.cart)));
  for (const c of HOLDOUT_CASES) expect(golden.has(j1ReplayKey(c.description, c.cart))).toBe(false);
});

test("raw model failures remain visible even when local guards make system accuracy look better", async () => {
  const model: Generate = async (req) =>
    req.schema.parse({
      fit: "match",
      confidence: 0.99,
      reasons: [],
      matched_attributes: [],
      conflicting_attributes: ["unverified suitability"],
    });
  const result = await evaluateHoldout(model);
  expect(result.rawFalseApprovals).toBe(4);
  expect(result.guardedFalseApprovals).toBe(0);
  expect(result.passed).toBe(false);
  expect(result.cases.find((c) => c.label === "holdout wrong equipment")).toMatchObject({
    rawPrediction: "match",
    guardedPrediction: "partial",
  });
  expect(result.cases.filter((c) => c.source === "guard")).toHaveLength(2);
  expect(result.rawTotal).toBe(10);
});
