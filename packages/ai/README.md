# @poi/ai

**Path:** `packages/ai/` | **Owner:** @sumedhag28 | **Backup:** @hoursgotviral-dev | **Spec:** [0006-ai-jobs.md](../../docs/specs/0006-ai-jobs.md) | **Milestones:** M1, M2, M3

| Job                                       | Status                                                                           |
| ----------------------------------------- | -------------------------------------------------------------------------------- |
| J1 `semanticFit(description, cart, mode)` | Built: prompt `prompts/j1-semantic-fit.md`, replay `replay/j1-semantic-fit.json` |
| J2 `classifyDispute` | Cited reasons and evidence plan for the worker's deterministic class and action |
| J3 `draftEvidence` | Cited cover note, attestation sections and buyer message for a verified compliant order |

- `AI_MODE=replay` (default) answers from `replay/*.json`; `AI_MODE=live` calls `AI_PROVIDER` / `AI_MODEL` with
  `AI_API_KEY` through the Vercel AI SDK (thinking off for nemotron, temperature 0, one retry).
- No trustworthy answer throws `AiUnavailableError`; check with `isAiUnavailable(err)`, which also covers the
  stubs. Callers hand the decision to a person.
- After changing a prompt (bump its `version`), run `pnpm ai:record` from the repo root. Cases live in
  `src/j1-cases.ts`. This command currently records J1. The J2/J3 replay files contain hand-authored demo
  responses. The full live eval and recordings are tracked in #43.
- J2 and J3 take named evidence excerpts. The worker supplies product facts and policy findings and keeps
  raw signed mandates, PayPal payloads and audit rows out of the prompt. A replay miss preserves the rule-only
  recommendation and evidence draft.

## Test

```bash
pnpm vitest run packages/ai
```

Unbuilt acceptance criteria are `ledger()` entries in this folder's `*.test.ts`. Turn each into a plain `test()` as you finish it.
