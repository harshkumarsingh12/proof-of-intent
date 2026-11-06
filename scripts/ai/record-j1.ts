// Records live J1 answers for replay mode (docs/specs/0006). Owner: @sumedhag28.
//
//   pnpm ai:record      (needs AI_MODEL and AI_API_KEY in .env; AI_PROVIDER defaults to nvidia)
//
// Asks the live model about every case in packages/ai/src/j1-cases.ts and rewrites packages/ai/replay/j1-semantic-fit.json, keyed by
// SHA-256 of { job, prompt version, model input }. Changing the prompt's `version` changes every key, so
// re-record after editing a prompt. Prints where the model disagrees with the expected label; it still records
// what the model said, because replay must reproduce the live system, not the answer we hoped for.
import { writeFileSync } from "node:fs";
import { J1_PROMPT_VERSION, j1ReplayKey, semanticFit, type SemanticFit } from "../../packages/ai/src/j1";
import { J1_CASES } from "../../packages/ai/src/j1-cases";
import { replayPath, type ReplayFile } from "../../packages/ai/src/runtime";

const out: ReplayFile<SemanticFit> = {};
let disagreements = 0;

for (const c of J1_CASES) {
  const started = Date.now();
  const res = await semanticFit(c.description, c.cart, "live");
  const ms = Date.now() - started;
  if (res.source === "guard") {
    console.log(`skip  ${c.label}: caught by the injection guard, no model call to record`);
    continue;
  }
  const { prompt_version: _v, source: _s, ...fit } = res;
  out[j1ReplayKey(c.description, c.cart)] = { label: c.label, output: fit };
  const ok = fit.fit === c.expected;
  if (!ok) disagreements++;
  console.log(
    `${ok ? "ok   " : "DIFF "} ${c.label}: ${fit.fit} ${fit.confidence} (expected ${c.expected}, ${ms} ms)`,
  );
}

writeFileSync(replayPath("j1-semantic-fit"), `${JSON.stringify(out, null, 2)}\n`);
console.log(
  `\nwrote ${Object.keys(out).length} answers for prompt ${J1_PROMPT_VERSION}; ${disagreements} disagree`,
);
