import type { evaluateJobs } from "./evaluate";
import type { Endpoint } from "./runtime";

type Result = Awaited<ReturnType<typeof evaluateJobs>>;
const cell = (text: string) => text.replace(/\|/g, "\\|").replace(/[\r\n]/g, " ");

/** Model attribution comes from completed physical attempts, never from configured intent. */
export function evaluationReport(
  result: Result,
  context: {
    runId: string;
    sourceCommit: string;
    profile: string;
    endpoint: Pick<Endpoint, "provider" | "model">;
    prompts: string[];
  },
): string {
  return [
    `# AI evaluation ${context.runId}`,
    "",
    `Source commit: \`${context.sourceCommit}\`. Profile: \`${context.profile}\`.`,
    `Configured primary: ${cell(context.endpoint.provider)} / ${cell(context.endpoint.model)}. This is configuration, not answer attribution.`,
    `Prompts: ${context.prompts.map((p) => `\`${p}\``).join(", ")}.`,
    "",
    `- J1 accuracy: ${result.j1Correct}/20 after checkout guards; mismatches labelled match: ${result.falseApprovals}.`,
    `- J2 policy agreement with a cited policy finding: ${result.j2Correct}/12. J2 receives the deterministic decision; this measures explanation faithfulness.`,
    `- Schema validity after retries: ${result.schemaValid}/${result.schemaTotal} model cases. Local guards are excluded.`,
    `- Gate: ${result.passed ? "passed" : "failed"}.`,
    "",
    "Attempts counts logical job attempts; provider calls counts physical requests, including backups. Each path records provider/model, outcome, latency and the bounded fallback reason. No provider error bodies or credentials are recorded. A guard has no answering model. Unobserved instrumentation is labelled explicitly.",
    "",
    "| Job | Case | Expected | Actual | Result | Attempts | Provider calls | Answered by | Provider path | Elapsed ms |",
    "| --- | --- | --- | --- | --- | ---: | ---: | --- | --- | ---: |",
    ...result.cases.map((c) => {
      const successful = c.providerAttempts.filter((a) => a.outcome === "success").at(-1);
      const answeredBy = c.guarded
        ? "local guard"
        : successful
          ? `${successful.provider}/${successful.model}`
          : c.providerAttempts.length
            ? "none"
            : "unobserved";
      const path = c.providerAttempts
        .map(
          (a) =>
            `${a.provider}/${a.model} (${a.role}, ${a.outcome}${a.failure ? `: ${a.failure}` : ""}, ${a.elapsedMs}ms${a.fallbackReason ? `, fallback: ${a.fallbackReason}` : ""})`,
        )
        .join(" → ");
      return `| ${[c.job, c.label, c.expected, c.actual, c.passed ? "pass" : "fail", String(c.attempts), String(c.providerAttempts.length), answeredBy, path || "—", String(c.elapsedMs)].map(cell).join(" | ")} |`;
    }),
    "",
  ].join("\n");
}
