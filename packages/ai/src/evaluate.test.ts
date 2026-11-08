import { expect, test } from "vitest";
import { J1_EVAL_CASES, J2_EVAL_CASES } from "./eval-cases";
import { evaluateJobs } from "./evaluate";
import { evaluationReport } from "./eval-report";
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

test("reports actual backup attribution, logical retries and physical requests independently", async () => {
  let first = true;
  const model: Generate = async <T>(req: GenerateRequest<T>) => {
    req.onAttempt?.({
      provider: "nvidia",
      model: "configured-primary",
      role: "primary",
      outcome: "error",
      elapsedMs: 20,
      httpRequests: 1,
      failure: "http_429",
    });
    if (first) {
      first = false;
      req.onAttempt?.({
        provider: "groq",
        model: "backup",
        role: "fallback",
        outcome: "error",
        elapsedMs: 30,
        httpRequests: 1,
        fallbackReason: "http_429",
        failure: "http_503",
      });
      throw new Error("unavailable");
    }
    req.onAttempt?.({
      provider: "groq",
      model: "backup",
      role: "fallback",
      outcome: "success",
      elapsedMs: 40,
      httpRequests: 1,
      fallbackReason: "http_429",
    });
    return req.schema.parse(
      req.prompt.startsWith("<decision>")
        ? {
            class: J2_EVAL_CASES[0]!.input.decision.class,
            recommended_action: J2_EVAL_CASES[0]!.input.decision.action,
            confidence: 0.9,
            reasons: [{ text: "Policy finding", cites: ["policy_evaluation"] }],
            evidence_plan: [],
          }
        : {
            fit: "partial",
            confidence: 0.9,
            reasons: [],
            matched_attributes: [],
            conflicting_attributes: [],
          },
    );
  };
  const result = await evaluateJobs(model);
  expect(result.cases[0]).toMatchObject({ attempts: 2 });
  expect(result.cases[0]!.providerAttempts).toHaveLength(4);
  expect(result.cases.find((c) => c.guarded)!.providerAttempts).toEqual([]);
  const report = evaluationReport(result, {
    runId: "test",
    sourceCommit: "abc",
    profile: "primary",
    endpoint: { provider: "nvidia", model: "configured-primary" },
    prompts: ["j1-v1", "j2-v2"],
  });
  expect(report).toContain("| 2 | 4 | groq/backup |");
  expect(report).toContain("fallback: http_429");
  expect(report).toContain("local guard");
  expect(report).not.toContain("| nvidia/configured-primary |");
});
