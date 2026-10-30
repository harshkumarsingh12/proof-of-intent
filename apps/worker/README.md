# Dispute copilot worker

**Path:** `apps/worker/` | **Owner:** @hoursgotviral-dev | **Backup:** @sumedhag28 | **Spec:** [0005-dispute-copilot.md](../../docs/specs/0005-dispute-copilot.md) | **Milestones:** M1, M2

pg-boss jobs for the dispute pipeline, Agent Toolkit dispute tools, evidence PDF. Currently a placeholder process plus typed stubs in `src/pipeline.ts`.

## Test

```bash
pnpm vitest run apps/worker
```

Unbuilt acceptance criteria are `ledger()` entries in this folder's `*.test.ts`. Turn each into a plain `test()` as you finish it.
