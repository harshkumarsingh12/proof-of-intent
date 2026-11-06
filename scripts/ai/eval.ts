import { writeFileSync } from "node:fs";
import { J2_PROMPT_VERSION, J2_REPLAY, type DisputeClassification } from "../../packages/ai/src/dispute-jobs";
import { evaluateJobs } from "../../packages/ai/src/evaluate";
import { J1_PROMPT_VERSION, J1_REPLAY, type SemanticFit } from "../../packages/ai/src/j1";
import {
  createGenerate,
  liveConfigFromEnv,
  readReplay,
  replayPath,
  type ReplayFile,
} from "../../packages/ai/src/runtime";

const config = liveConfigFromEnv();
if ("missing" in config)
  throw new Error(`Live evaluation requires ${config.missing}. See docs/evals/README.md.`);

const result = await evaluateJobs(createGenerate(config));
const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", dateStyle: "short" }).format(
  new Date(),
);
const report = [
  `# AI evaluation for ${date}`,
  "",
  `Live model: \`${config.provider}\` / \`${config.model}\`. Prompts: \`${J1_PROMPT_VERSION}\` and \`${J2_PROMPT_VERSION}\`.`,
  "",
  `- J1 accuracy: ${result.j1Correct}/20, measured after the local checks checkout also applies (injection guard, road-versus-trail ceiling). Mismatches labelled match: ${result.falseApprovals}.`,
  `- J2 policy agreement with a reason citing the policy finding: ${result.j2Correct}/12. J2 receives the deterministic policy decision.`,
  `- Schema validity after retries: ${result.schemaValid}/${result.schemaTotal} model cases. Local checkout guards are excluded.`,
  `- Gate: ${result.passed ? "passed" : "failed"}.`,
  "",
  "| Job | Case | Expected | Actual | Result | Attempts | Elapsed ms |",
  "| --- | --- | --- | --- | --- | ---: | ---: |",
  ...result.cases.map(
    (c) =>
      `| ${c.job} | ${c.label} | ${c.expected} | ${c.actual} | ${c.passed ? "pass" : "fail"} | ${c.attempts} | ${c.elapsedMs} |`,
  ),
  "",
].join("\n");

function saveReplay<T>(name: string, entries: ReplayFile<T>): void {
  writeFileSync(replayPath(name), `${JSON.stringify({ ...readReplay<T>(name), ...entries }, null, 2)}\n`);
}

if (result.passed) {
  saveReplay<SemanticFit>(J1_REPLAY, result.j1Replay);
  saveReplay<DisputeClassification>(J2_REPLAY, result.j2Replay);
}
writeFileSync(new URL(`../../docs/evals/${date}.md`, import.meta.url), report);
console.log(
  `J1 ${result.j1Correct}/20, J2 ${result.j2Correct}/12, schema ${result.schemaValid}/${result.schemaTotal}. Report in docs/evals/${date}.md.`,
);
if (!result.passed) {
  console.error("Evaluation targets missed. Existing replay fixtures were kept.");
  process.exitCode = 1;
}
