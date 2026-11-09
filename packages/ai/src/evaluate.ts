import { classifyDispute, j2ReplayKey, type DisputeClassification } from "./dispute-jobs";
import { J1_EVAL_CASES, J2_EVAL_CASES } from "./eval-cases";
import { j1ReplayKey, semanticFit, type SemanticFit } from "./j1";
import { isAiUnavailable, type Generate, type GenerateRequest, type ReplayFile } from "./runtime";

interface CaseResult {
  job: "J1" | "J2";
  label: string;
  expected: string;
  actual: string;
  passed: boolean;
  schemaValid: boolean;
  guarded: boolean;
  attempts: number;
  elapsedMs: number;
}

async function observe<T>(generate: Generate, run: (instrumented: Generate) => Promise<T>) {
  let attempts = 0;
  let schemaValid = false;
  const instrumented: Generate = async <V>(request: GenerateRequest<V>) => {
    attempts++;
    const result = await generate(request);
    schemaValid ||= request.schema.safeParse(result).success;
    return result;
  };
  const start = performance.now();
  const result = await run(instrumented).catch((error: unknown) => {
    if (!isAiUnavailable(error)) throw error;
    return undefined;
  });
  return { result, schemaValid, attempts, elapsedMs: Math.round(performance.now() - start) };
}

export async function evaluateJobs(generate: Generate) {
  const cases: CaseResult[] = [];
  const j1Replay: ReplayFile<SemanticFit> = {};
  const j2Replay: ReplayFile<DisputeClassification> = {};

  for (const c of J1_EVAL_CASES) {
    const { result, ...metrics } = await observe(generate, (g) =>
      semanticFit(c.description, c.cart, "live", { generate: g }),
    );
    const guarded = result?.source === "guard";
    const actual = result?.fit ?? "unavailable";
    cases.push({
      ...metrics,
      job: "J1",
      label: c.label,
      expected: c.expected,
      actual,
      passed: actual === c.expected,
      guarded,
    });
    if (result && !guarded) {
      const { source: _source, prompt_version: _promptVersion, ...output } = result;
      j1Replay[j1ReplayKey(c.description, c.cart)] = { label: c.label, output };
    }
  }

  for (const c of J2_EVAL_CASES) {
    const { result, ...metrics } = await observe(generate, (g) => classifyDispute(c.input, "live", g));
    const expected = `${c.input.decision.class} / ${c.input.decision.action}`;
    const actual = result ? `${result.class} / ${result.recommended_action}` : "unavailable";
    const passed =
      actual === expected && !!result?.reasons.some((reason) => reason.cites.includes("policy_evaluation"));
    cases.push({
      ...metrics,
      job: "J2",
      label: c.label,
      expected,
      actual: passed ? actual : result ? `${actual} (no grounded reason)` : actual,
      passed,
      guarded: false,
    });
    if (result) {
      // Everything the job adds to the model's answer is dropped, so a replay entry is exactly what DisputeClassification accepts.
      const { source: _source, prompt_version: _promptVersion, grounding_version: _grounding, ...output } = result;
      j2Replay[j2ReplayKey(c.input)] = { label: c.label, output };
    }
  }

  const j1Correct = cases.filter((c) => c.job === "J1" && c.passed).length;
  const j2Correct = cases.filter((c) => c.job === "J2" && c.passed).length;
  const falseApprovals = cases.filter(
    (c) => c.job === "J1" && c.expected === "mismatch" && c.actual === "match",
  ).length;
  const modelCases = cases.filter((c) => !c.guarded);
  const schemaValid = modelCases.filter((c) => c.schemaValid).length;
  const passed =
    j1Correct >= 18 && j2Correct >= 11 && falseApprovals === 0 && schemaValid === modelCases.length;
  return {
    cases,
    j1Correct,
    j2Correct,
    falseApprovals,
    schemaValid,
    schemaTotal: modelCases.length,
    passed,
    j1Replay,
    j2Replay,
  };
}
