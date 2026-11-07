// Does the configured model (and the backup, if there is one) do what the app needs? One structured answer and one
// tool call per endpoint, each on its own, so a working primary can't hide a broken backup. Keys are never printed.
//
//   pnpm ai:check          reads AI_PROVIDER / AI_MODEL / AI_API_KEY and the optional AI_FALLBACK_* from .env
import { checkEndpoint, type CheckResult } from "../../packages/ai/src/check";
import { liveConfigFromEnv } from "../../packages/ai/src/runtime";

const cfg = liveConfigFromEnv(process.env);
if ("missing" in cfg) {
  console.error(`Not configured: ${cfg.missing} is not set.`);
  process.exit(1);
}

const show = (label: string, r: CheckResult) => {
  console.log(`\n${label}: ${r.provider} / ${r.model}`);
  for (const [name, step] of [
    ["structured answer", r.structured],
    ["tool call (forced)", r.tools],
  ] as const)
    console.log(`  ${step.ok ? "ok  " : "FAIL"} ${name} (${step.ms} ms): ${step.detail}`);
  // Informational: it doesn't fail the check, but a "no" means the model guesses facts instead of looking them up.
  console.log(
    `  ${r.autoTools.ok ? "yes " : "no  "} calls a tool on its own (${r.autoTools.ms} ms): ${r.autoTools.detail}`,
  );
};

const { fallback, ...primary } = cfg;
const results = [await checkEndpoint(primary)];
show("primary", results[0]!);
if (fallback) {
  const backup = await checkEndpoint(fallback);
  results.push(backup);
  show("backup", backup);
} else {
  console.log(
    "\nNo backup configured (set AI_FALLBACK_MODEL, and AI_FALLBACK_PROVIDER + AI_FALLBACK_API_KEY for another provider).",
  );
}
// Only what the endpoint cannot do fails the check; whether the model chooses tools on its own is just reported.
const failed = results.some((r) => !r.structured.ok || !r.tools.ok);
console.log(
  failed ? "\nSomething failed." : "\nEverything the app needs works on every configured endpoint.",
);
process.exitCode = failed ? 1 : 0;
