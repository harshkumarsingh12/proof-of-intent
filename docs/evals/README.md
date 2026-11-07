# Evals

Run `pnpm eval` with `AI_MODEL` and `AI_API_KEY` in the environment. Set `AI_PROVIDER` for a provider other than
NVIDIA and `AI_BASE_URL` for a custom OpenAI-compatible endpoint. With a local `.env`, the equivalent command
is `pnpm exec tsx --env-file=.env scripts/ai/eval.ts`.

The command runs the 20 J1 and 12 J2 cases and writes a dated report here. A passing run also adds its live
answers to the J1 and J2 replay files. The report separates J2 agreement with the supplied policy decision
from J1 prediction accuracy. Publish numbers in the root README after verifying the live report.

Targets and sets are defined in [spec 0006](../specs/0006-ai-jobs.md). Owner is @sumedhag28.

## Studio starter recordings

Start the API and dashboard with `AI_MODE=live`, the team's configured provider, and an AI-enabled Studio
license. Set `OPERATOR_PASSWORD` in the command environment to the dashboard password, then run
`pnpm studio:record`. The command uses system Chrome, opens a fresh chat for each of the three starters,
and saves the actual adapter replies to `packages/ai/replay/j4-studio.json` after all three finish.
`CHROME_PATH` selects another Chrome binary. `STUDIO_URL` selects a dashboard's `/analytics/studio` URL.
Keep credentials in the team's secret store.

The dated `studio-<date>.md` report measures each starter's elapsed time and adapter-turn count. Review the
captured text against the dispute findings. Set both servers to `AI_MODE=replay`, then run
`pnpm studio:record --verify-replay` against the same database to repeat all three starters without rewriting
the recordings. The command checks the API's mode and prompt version, so a mixed-mode deployment fails the
check. Questions, instructions, offered tools and tool results are
part of the recording key. Changed facts or an unrecorded question produce a clear unavailable response.
Only the captured answers and hashes are saved. Credentials and HTTP headers are excluded.

The attention starter formats the list tool's counts and response deadlines locally after the first model
tool selection. This removes the summarizing model call and its possible loop. Measure the complete live
starter with the capture command to compare against #124's observed 15–25 seconds.

The three live captures, their reviewed answers and the replay repeat are required evidence for #124.
The repository has no J4 recordings until that configured run is supplied.

## Buyer agent

`pnpm agent:eval` runs the live buyer agent (#37) through eight cases: the four demo presets, a shopper request that
tries to override the budget, one that asks for another color, a price nothing fits, and a merchant refusal the
agent has to recover from. The real hard rules stand in for the merchant, so it needs only `AI_MODEL` and
`AI_API_KEY`. It writes `docs/evals/agent-<date>.md` and fails if any case fails or any proposed cart breaks a hard
rule.
