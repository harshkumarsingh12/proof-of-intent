# @poi/ai

**Path:** `packages/ai/` | **Owner:** @sumedhag28 | **Backup:** @hoursgotviral-dev | **Spec:** [0006-ai-jobs.md](../../docs/specs/0006-ai-jobs.md) | **Milestones:** M1, M2, M3

| Job                                       | Status                                                                           |
| ----------------------------------------- | -------------------------------------------------------------------------------- |
| J1 `semanticFit(description, cart, mode)` | Built: prompt `prompts/j1-semantic-fit.md`, replay `replay/j1-semantic-fit.json` |
| J2 `classifyDispute`, J3 `draftEvidence`  | Stubs (`NotImplementedError`)                                                    |

- `AI_MODE=replay` (default) answers from `replay/*.json`; `AI_MODE=live` calls `AI_PROVIDER` / `AI_MODEL` with
  `AI_API_KEY` through the Vercel AI SDK (thinking off for nemotron, temperature 0, one retry).
- No trustworthy answer throws `AiUnavailableError`; check with `isAiUnavailable(err)`, which also covers the
  stubs. Callers hand the decision to a person.
- After changing a prompt (bump its `version`), run `pnpm ai:record` from the repo root. Cases live in
  `src/j1-cases.ts`.

## Test

```bash
pnpm vitest run packages/ai
```

Unbuilt acceptance criteria are `ledger()` entries in this folder's `*.test.ts`. Turn each into a plain `test()` as you finish it.
