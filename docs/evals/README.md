# Evals

Run `pnpm eval` with `AI_MODEL` and `AI_API_KEY` in the environment. Set `AI_PROVIDER` for a provider other than
NVIDIA and `AI_BASE_URL` for a custom OpenAI-compatible endpoint. With a local `.env`, the equivalent command
is `pnpm exec tsx --env-file=.env scripts/ai/eval.ts`.

The command runs the 20 J1 and 12 J2 cases and writes a dated report here. A passing run also adds its live
answers to the J1 and J2 replay files. The report separates J2 agreement with the supplied policy decision
from J1 prediction accuracy. Publish numbers in the root README after verifying the live report.

Targets and sets are defined in [spec 0006](../specs/0006-ai-jobs.md). Owner is @sumedhag28.
