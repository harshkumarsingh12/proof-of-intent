# @poi/ai

**Path:** `packages/ai/` | **Owner:** @sumedhag28 | **Backup:** @hoursgotviral-dev | **Spec:** [0006-ai-jobs.md](../../docs/specs/0006-ai-jobs.md) | **Milestones:** M1, M2, M3

| Job                                       | Status                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| J1 `semanticFit(description, cart, mode)` | Built: prompt `prompts/j1-semantic-fit.md`, replay `replay/j1-semantic-fit.json`                                                                                                                                                                                                                                                                                                                                                         |
| J2 `classifyDispute`                      | Cited reasons and evidence plan for the worker's deterministic class and action                                                                                                                                                                                                                                                                                                                                                          |
| J3 `draftEvidence`                        | Cited cover note, attestation sections and buyer message for a verified compliant order                                                                                                                                                                                                                                                                                                                                                  |
| J4 `runStudioTurn`                        | One turn of the Studio chat (`src/studio.ts`): `{ text, tool }` out. Retries once when the model announces a step ("Let me...") or tells the user to run a tool, accepts tool arguments as an object, withdraws an identical repeated tool call and then forces a text-only answer (falling back to the tool's own result), wraps codes like `AGENT_OVERREACH` in backticks for the chat's markdown, and gets the 10 s the spec gives J4 |

- `AI_MODE=replay` (default) answers from `replay/*.json`; `AI_MODE=live` calls `AI_PROVIDER` / `AI_MODEL` with
  `AI_API_KEY` through the Vercel AI SDK (thinking off for nemotron, temperature 0, one retry).
- No trustworthy answer throws `AiUnavailableError`; check with `isAiUnavailable(err)`, which also covers the
  stubs. Callers hand the decision to a person.
- `GenerateRequest.onAttempt` receives request-scoped physical provider/model attempts, outcomes, elapsed
  time and bounded failure/fallback categories. It excludes prompts and provider error bodies. Evaluations
  keep the requested `model` separate from the provider-reported `responseModel`. Missing response identities
  stay unobserved, including when the SDK would substitute the requested alias. Evaluations use only the
  reported identity for answer attribution; see [primary and backup evaluation steps](../../docs/evals/README.md).
- J4 first runs `planStudio` (`studio-plan.ts`), a pure planner that picks the lookup and writes the answer for
  common questions (named dispute, reply draft, counts, attention, glossary, refusing actions) with no model. Other
  turns use `j4-studio.json` (keyed by the versioned turn) or live AI. `pnpm smoke:studio` checks the chat in a browser;
  `pnpm studio:record` captures open-ended recordings. [Recording steps](../../docs/evals/README.md#studio-starter-recordings)
- After changing a prompt (bump its `version`), run `pnpm ai:record` from the repo root. Cases live in
  `src/j1-cases.ts`. This command currently records J1. The J2/J3 replay files contain hand-authored demo
  responses. The full live eval and recordings are tracked in #43.
- J2 and J3 take named evidence excerpts. The worker supplies product facts and policy findings and keeps
  raw signed mandates, PayPal payloads and audit rows out of the prompt. A replay miss preserves the rule-only
  recommendation and evidence draft.
- Citation membership does not establish entailment. J2/J3 use the model's valid citation selections to render
  the source excerpts locally, with buyer allegations labelled unverified. Free-form model prose and section
  headings cannot assert delivery, cardholder authorization or completed refunds. J3's buyer message is a
  neutral review template. This source rendering applies to live and replay responses without changing keys.

## Test

```bash
pnpm vitest run packages/ai
```

Unbuilt acceptance criteria are `ledger()` entries in this folder's `*.test.ts`. Turn each into a plain `test()` as you finish it.
