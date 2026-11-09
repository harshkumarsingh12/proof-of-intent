import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateHoldout } from "../../packages/ai/src/holdout";
import { createGenerate, liveConfigFromEnv } from "../../packages/ai/src/runtime";

const args = process.argv.slice(2);
if (
  args.some((a) => !["--backup", "--system-only"].includes(a)) ||
  (args.includes("--backup") && args.includes("--system-only"))
)
  throw new Error("Usage: tsx scripts/ai/eval-holdout.ts [--backup | --system-only]");
if (!process.env.DATABASE_URL)
  throw new Error(
    "DATABASE_URL is required: use disposable PostgreSQL 16 with database-creation permission, never production.",
  );
const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const dirty = execFileSync("git", ["status", "--porcelain", "--untracked-files=no"], {
  encoding: "utf8",
}).trim();
if (dirty)
  throw new Error("Commit tracked changes first so the report identifies the exact evaluated source.");
const backup = args.includes("--backup");
const systemOnly = args.includes("--system-only");
const runId = `${new Date().toISOString().replace(/[:.]/g, "-")}-holdout-${systemOnly ? "system" : backup ? "backup" : "primary"}`;
const metricsPath = join(mkdtempSync(join(tmpdir(), "poi-holdout-")), "system.json");
const vitest = fileURLToPath(new URL("../../node_modules/vitest/vitest.mjs", import.meta.url));
const systemRun = spawnSync(
  process.execPath,
  [vitest, "run", "apps/api/src/eval-scenarios.test.ts", "--reporter=json", `--outputFile=${metricsPath}`],
  { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 },
);
if (systemRun.error) throw systemRun.error;
const system = JSON.parse(readFileSync(metricsPath, "utf8")) as {
  numTotalTests: number;
  numPassedTests: number;
  numPendingTests: number;
  testResults: { assertionResults: { title: string; status: string; duration?: number }[] }[];
};
const systemPassed =
  systemRun.status === 0 &&
  system.numTotalTests === 10 &&
  system.numPassedTests === 10 &&
  system.numPendingTests === 0;
let semantic: Awaited<ReturnType<typeof evaluateHoldout>> | undefined;
if (!systemOnly) {
  const configured = liveConfigFromEnv();
  if ("missing" in configured) throw new Error(`Live holdout requires ${configured.missing}.`);
  if (backup && !configured.fallback)
    throw new Error("--backup requires a fully configured fallback endpoint.");
  semantic = await evaluateHoldout(createGenerate(backup ? configured.fallback! : configured));
}
const systemCases = system.testResults.flatMap((f) =>
  f.assertionResults.map((c) => ({ label: c.title, status: c.status, elapsedMs: c.duration })),
);
const passed = systemPassed && (systemOnly || !!semantic?.passed);
const artifact = {
  runId,
  sourceCommit,
  system: {
    passed: systemPassed,
    cases: systemCases,
    paymentProvider: "mock",
    storage: "disposable PostgreSQL",
  },
  semantic: semantic ?? null,
  passed,
  liveSemanticVerified: !systemOnly,
};
writeFileSync(
  new URL(`../../docs/evals/${runId}.json`, import.meta.url),
  `${JSON.stringify(artifact, null, 2)}\n`,
);
const cell = (value: string) => value.replace(/\|/g, "\\|").replace(/[\r\n]/g, " ");
writeFileSync(
  new URL(`../../docs/evals/${runId}.md`, import.meta.url),
  [
    `# Supplemental evaluation ${runId}`,
    "",
    `Source commit: \`${sourceCommit}\`.`,
    "",
    `- System safety and payment outcomes: ${system.numPassedTests}/${system.numTotalTests}; skipped ${system.numPendingTests}. Mock PayPal, real disposable PostgreSQL. This is not hosted PayPal verification.`,
    semantic
      ? `- Raw semantic accuracy: ${semantic.rawCorrect}/${semantic.rawTotal}; raw mismatches labelled match: ${semantic.rawFalseApprovals}.`
      : "- Live semantic evaluation: not run. This system-only report does not validate a model.",
    ...(semantic
      ? [
          `- Guarded semantic accuracy: ${semantic.guardedCorrect}/${semantic.guardedTotal}; mismatches labelled match: ${semantic.guardedFalseApprovals}.`,
          `- Schema validity after retry: ${semantic.schemaValid}/${semantic.schemaTotal}. Local guards excluded.`,
        ]
      : []),
    `- Gate: ${passed ? "passed" : "failed"}.`,
    "- Known separate payment-state gap: #225. These mock-payment scenarios do not validate PENDING/COMPLETED settlement handling in the sandbox adapter.",
    "",
    "Raw validated model outputs, errors and any available provider-attempt telemetry are in the matching JSON. Missing telemetry is unobserved, never attributed to the configured primary. No canonical replay file is rewritten. J2's golden score remains policy explanation faithfulness, not independent classification accuracy.",
    "",
    "| System scenario | Result |",
    "| --- | --- |",
    ...systemCases.map((c) => `| ${cell(c.label)} | ${c.status} |`),
    "",
    ...(semantic
      ? [
          "| Semantic case | Expected | Raw model | Guarded system | Result |",
          "| --- | --- | --- | --- | --- |",
          ...semantic.cases.map(
            (c) =>
              `| ${cell(c.label)} | ${c.expected} | ${c.rawPrediction} | ${c.guardedPrediction} | ${c.passed ? "pass" : "fail"} |`,
          ),
          "",
        ]
      : []),
  ].join("\n"),
);
console.log(`Supplemental gate ${passed ? "passed" : "failed"}. docs/evals/${runId}.md`);
if (!passed) process.exitCode = 1;
