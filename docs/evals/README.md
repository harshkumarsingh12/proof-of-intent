# Evals

Run `pnpm eval` with `AI_MODEL` and `AI_API_KEY` in the environment. Set `AI_PROVIDER` for a provider other than
NVIDIA and `AI_BASE_URL` for a custom OpenAI-compatible endpoint. With a local `.env`, the equivalent command
is `pnpm exec tsx --env-file=.env scripts/ai/eval.ts`.

The command runs the 20 J1 and 12 J2 cases and writes a dated report here. A passing run also adds its live
answers to the J1 and J2 replay files. The report separates J2 agreement with the supplied policy decision
from J1 prediction accuracy. Publish numbers in the root README after verifying the live report.

Each run writes a unique UTC-timestamped Markdown report and matching JSON case metrics, including the
source commit. The configured primary is labelled as configuration. Each case instead attributes the
answer to its actual successful provider/model and records every physical provider request, outcome,
latency and bounded fallback reason. Logical retries and physical provider calls are separate counts.
Local guards have no model attribution. Telemetry excludes prompts, credentials and provider error bodies.
Physical request counts are measured at the HTTP fetch boundary; a local preflight failure records an endpoint
attempt with zero HTTP requests.

Before relying on the configured Groq backup, run `pnpm eval --backup` in the same secure environment.
This runs the identical 20/12 acceptance set directly against `AI_FALLBACK_*`, with no primary and no
further fallback. It requires a fully configured backup and writes a separate `*-backup.md`/`.json` pair.
Backup-only runs never rewrite canonical replay files. Return both primary and backup reports, their
JSON metrics and the primary run's replay files together. A failed or missing backup run means the
backup is unverified; a passing primary does not validate it.

Targets and sets are defined in [spec 0006](../specs/0006-ai-jobs.md). Owner is @sumedhag28.

## Studio starter recordings

Common Studio questions no longer need recordings (a local planner answers them); `pnpm smoke:studio` checks them in
a browser. Record only for open-ended questions.

Start the API and dashboard with `AI_MODE=live`, the team's configured provider, and an AI-enabled Studio
license. Set `OPERATOR_PASSWORD` in the command environment to the dashboard password, then run
`pnpm studio:record`. The command uses system Chrome, opens a fresh chat for each of the three starters,
and saves the actual adapter replies to `packages/ai/replay/j4-studio.json` after all three finish.
`CHROME_PATH` selects another Chrome binary. `STUDIO_URL` selects a dashboard's `/analytics/studio` URL.
Keep credentials in the team's secret store.

The dated `studio-<date>.md` report measures each starter's elapsed time and adapter-turn count. Review the
captured text against the dispute findings. Set both servers to `AI_MODE=replay`, then run
`pnpm studio:record --verify-replay` to repeat all three starters without rewriting the recordings. It can
be the team's database or a freshly seeded one (`pnpm demo:seed`): see "Recordings across databases" below. The command checks the API's mode and prompt version, so a mixed-mode deployment fails the
check. Questions, instructions, offered tools and tool results are
part of the recording key. Changed facts or an unrecorded question produce a clear unavailable response.
Only the captured answers and hashes are saved. Credentials and HTTP headers are excluded.

**Recordings across databases.** Every `pnpm demo:seed` makes a new shopper key (so every mandate hash differs) and
dates deadlines from when it ran, so two seeded databases hold the same disputes with different hashes and
deadlines. The replay key therefore ignores 64-hex hashes and ISO timestamps in tool results (masking them in order
of appearance), and a recorded answer stores placeholders for them, including a hash the model shortened (8 or more
leading characters). On replay the placeholders are filled with the current database's own values, so a recording made
on the team's database answers on a judge's freshly seeded one and never shows the other database's hash. Everything
else in the tool results (ids, classes, reasons, check names, amounts) is still part of the key, so a changed fact misses.
Review the captured answers for dates or hashes written in another form (for example "Nov 17"): those cannot be
restored and would show the capture database's values. The explain and reply starters' tool results carry no dates.

The attention starter ("What needs my attention?") is formatted locally from the list tool's counts and response
deadlines, in live and in replay mode, with no model call and no recording: it always shows the current database's own
deadlines. This removes the summarizing model call and its possible loop. Measure the complete live starter with the
capture command to compare against #124's observed 15–25 seconds.

The three live captures, their reviewed answers and the replay repeat are required evidence for #124.
The repository has no J4 recordings until that configured run is supplied.

## Buyer agent

`pnpm agent:eval` runs the live buyer agent (#37) through eight cases: the four demo presets, a shopper request that
tries to override the budget, one that asks for another color, a price nothing fits, and a merchant refusal the
agent has to recover from. The real hard rules stand in for the merchant, so it needs only `AI_MODEL` and
`AI_API_KEY`. It writes `docs/evals/agent-<date>.md` and fails if any case fails or any proposed cart breaks a hard
rule.

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
