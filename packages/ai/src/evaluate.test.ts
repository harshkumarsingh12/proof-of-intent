import { expect, test } from "vitest";
import { J1_EVAL_CASES, J2_EVAL_CASES } from "./eval-cases";
import { evaluateJobs } from "./evaluate";
import type { Generate, GenerateRequest } from "./runtime";

test("the golden sets have the milestone's labels and coverage", () => {
  expect(J1_EVAL_CASES.filter((c) => c.expected === "match")).toHaveLength(7);
  expect(J1_EVAL_CASES.filter((c) => c.expected === "partial")).toHaveLength(7);
  expect(J1_EVAL_CASES.filter((c) => c.expected === "mismatch")).toHaveLength(6);
  expect(J2_EVAL_CASES).toHaveLength(12);
  expect(new Set(J2_EVAL_CASES.map((c) => c.input.decision.class)).size).toBe(4);
});

test("the harness counts retries, skips the local guard and rejects false approvals and uncited J2 output", async () => {
  // The injection guard answers without the model; every other J1 case reaches it.
  const j1 = J1_EVAL_CASES.filter((c) => c.label !== "injected cart title");
  let j1Index = 0;
  let j2Index = 0;
  let first = true;
  const model: Generate = async <T>({ prompt, schema }: GenerateRequest<T>) => {
    if (prompt.startsWith("<decision>")) {
      const { decision } = J2_EVAL_CASES[j2Index++]!.input;
      return schema.parse({
        class: decision.class,
        recommended_action: decision.action,
        confidence: 0.9,
        reasons: [{ text: "Missing citation", cites: [] }],
        evidence_plan: [],
      });
    }
    if (first) {
      first = false;
      throw new Error("invalid model output");
    }
    const c = j1[j1Index++]!;
    return schema.parse({
      fit: c.expected === "mismatch" ? "match" : c.expected,
      confidence: 0.9,
      reasons: [],
      matched_attributes: [],
      conflicting_attributes: [],
    });
  };

  const result = await evaluateJobs(model);
  expect(result.cases[0]?.attempts).toBe(2);
  expect(result.cases.find((c) => c.guarded)).toMatchObject({ attempts: 0, passed: true });
  expect(result).toMatchObject({
    j1Correct: 15,
    j2Correct: 0,
    falseApprovals: 5,
    schemaValid: 31,
    schemaTotal: 31,
    passed: false,
  });
  expect(Object.keys(result.j1Replay)).toHaveLength(19);
  expect(Object.keys(result.j2Replay)).toHaveLength(12);
});
