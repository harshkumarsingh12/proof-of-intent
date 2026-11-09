import { writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { J2_PROMPT_VERSION, J2_REPLAY, type DisputeClassification } from "../../packages/ai/src/dispute-jobs";
import { evaluateJobs } from "../../packages/ai/src/evaluate";
import { evaluationReport } from "../../packages/ai/src/eval-report";
import { J1_PROMPT_VERSION, J1_REPLAY, type SemanticFit } from "../../packages/ai/src/j1";
import {
  createGenerate,
  liveConfigFromEnv,
  readReplay,
  replayPath,
  type Generate,
  type ReplayFile,
} from "../../packages/ai/src/runtime";

const configured = liveConfigFromEnv();
if ("missing" in configured)
  throw new Error(`Live evaluation requires ${configured.missing}. See docs/evals/README.md.`);
const args = process.argv.slice(2);
// --pace-ms=N waits N ms before each model call. A free-tier endpoint (Groq's) answers HTTP 429 after about a dozen
// back-to-back cases, which measures its rate limit, not its answers. Pacing is recorded in the report's profile.
const paceArg = args.find((arg) => arg.startsWith("--pace-ms="));
const paceMs = paceArg ? Number(paceArg.slice("--pace-ms=".length)) : 0;
if (
  args.some((arg) => arg !== "--backup" && arg !== paceArg) ||
  !Number.isInteger(paceMs) ||
  paceMs < 0 ||
  paceMs > 60_000
)
  throw new Error("Usage: pnpm eval [--backup] [--pace-ms=0..60000]");
const backup = args.includes("--backup");
if (backup && !configured.fallback)
  throw new Error("--backup requires a fully configured AI_FALLBACK_* endpoint.");
// Isolate the backup: do not let a successful primary mask an untested fallback.
const config = backup ? configured.fallback! : configured;
const profile =
  (backup ? "backup-only" : "primary-with-configured-fallback") + (paceMs ? `, paced ${paceMs} ms per call` : "");
const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();

const live = createGenerate(config);
const paced: Generate = async (req) => {
  await new Promise((resolve) => setTimeout(resolve, paceMs));
  return live(req);
};
const result = await evaluateJobs(paceMs ? paced : live);
const runId = `${new Date().toISOString().replace(/[:.]/g, "-")}-${backup ? "backup" : "primary"}`;
const report = evaluationReport(result, {
  runId,
  sourceCommit,
  profile,
  endpoint: config,
  prompts: [J1_PROMPT_VERSION, J2_PROMPT_VERSION],
});

function saveReplay<T>(name: string, entries: ReplayFile<T>): void {
  writeFileSync(replayPath(name), `${JSON.stringify({ ...readReplay<T>(name), ...entries }, null, 2)}\n`);
}

if (result.passed && !backup) {
  saveReplay<SemanticFit>(J1_REPLAY, result.j1Replay);
  saveReplay<DisputeClassification>(J2_REPLAY, result.j2Replay);
}
writeFileSync(new URL(`../../docs/evals/${runId}.md`, import.meta.url), report);
writeFileSync(
  new URL(`../../docs/evals/${runId}.json`, import.meta.url),
  `${JSON.stringify({ runId, sourceCommit, profile, cases: result.cases, passed: result.passed }, null, 2)}\n`,
);
console.log(
  `J1 ${result.j1Correct}/20, J2 ${result.j2Correct}/12, schema ${result.schemaValid}/${result.schemaTotal}. Report in docs/evals/${runId}.md.`,
);
if (!result.passed) {
  console.error("Evaluation targets missed. Existing replay fixtures were kept.");
  process.exitCode = 1;
}
