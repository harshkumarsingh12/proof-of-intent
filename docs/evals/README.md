# Evals

Run `pnpm eval` with `AI_MODEL` and `AI_API_KEY` in the environment. Set `AI_PROVIDER` for a provider other than
NVIDIA and `AI_BASE_URL` for a custom OpenAI-compatible endpoint. With a local `.env`, the equivalent command
is `pnpm exec tsx --env-file=.env scripts/ai/eval.ts`.

The command runs the 20 J1 and 12 J2 cases and writes a dated report here. A passing run also adds its live
answers to the J1 and J2 replay files. The report separates J2 agreement with the supplied policy decision
from J1 prediction accuracy. Publish numbers in the root README after verifying the live report.

Targets and sets are defined in [spec 0006](../specs/0006-ai-jobs.md). Owner is @sumedhag28.

## Full-eval handoff for #43

Use the team's configured NVIDIA environment and the current accepted checkout. Keep API keys in the
secret store. Record the source commit with `git rev-parse HEAD` so the report can be matched to the code.

1. If the J1 prompt version changed, run `pnpm ai:record --all` first to refresh every supported demo cart.
   This command reads `.env`. When the environment is supplied by the secret store instead, use
   `pnpm exec tsx scripts/ai/record-j1.ts --all`. The demo recorder rewrites the J1 replay file with the
   catalog cases, so run it before the final full evaluation.
2. Run `pnpm eval` with the configured provider variables. The scored sets stay fixed at 20 J1 and 12 J2
   cases when the catalog grows. Require at least 18/20 J1, zero mismatches labelled `match`, at least 11/12
   J2 with a cited policy reason, and 100% schema validity after retry. The report gives the model-case
   denominator separately from the local checkout guard.
3. If a gate fails, fix the behavior and rerun the complete set. If that changes the prompt version, repeat
   the demo recording step first. A failed gate writes its report and preserves the previous replay files.
4. After the final passing run, run `pnpm exec vitest run packages/ai/src/ai.test.ts` to check current-prompt
   replay coverage for the supported demo carts. Keep the report and both replay files from that passing
   run together. Running the demo recorder afterward requires another full evaluation before publishing.

Return the dated `docs/evals/<date>.md`, `packages/ai/replay/j1-semantic-fit.json`,
`packages/ai/replay/j2-dispute-classification.json`, the source commit and the configured provider/model
names. Include any changed prompt files. Verify these artifacts together, then quote the measured figures
and link the dated report in the root README. The report, matching replay and README figures complete #43.

## Buyer agent

`pnpm agent:eval` runs the live buyer agent (#37) through eight cases: the four demo presets, a shopper request that
tries to override the budget, one that asks for another color, a price nothing fits, and a merchant refusal the
agent has to recover from. The real hard rules stand in for the merchant, so it needs only `AI_MODEL` and
`AI_API_KEY`. It writes `docs/evals/agent-<date>.md` and fails if any case fails or any proposed cart breaks a hard
rule.
