# @poi/ai

**Path:** `packages/ai/` | **Owner:** @sumedhag28 | **Backup:** @hoursgotviral-dev | **Spec:** [0006-ai-jobs.md](../../docs/specs/0006-ai-jobs.md) | **Milestones:** M1, M2, M3

Output schemas for J1–J3 (built), mode parsing (built), job functions (stubs). Next: J1 + replay mode (M1), J2/J3 (M2), evals (M3).

## Test

```bash
pnpm vitest run packages/ai
```

Unbuilt acceptance criteria are `ledger()` entries in this folder's `*.test.ts`. Turn each into a plain `test()` as you finish it.
