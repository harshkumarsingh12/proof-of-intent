# @poi/contracts

**Path:** `packages/contracts/` | **Owner:** @srshriv | **Backup:** @harshkumarsingh12 | **Spec:** [0001-mandate-model.md](../../docs/specs/0001-mandate-model.md) | **Milestones:** M0

The frozen contract: zod schemas for the three mandates, Money, ReasonCode, Verdict, DisputeClass, and the demo fixtures (`@poi/contracts/fixtures`). Every other package imports types from here. Changes need a spec and review from both owners.

## Test

```bash
pnpm vitest run packages/contracts
```

Unbuilt acceptance criteria are `ledger()` entries in this folder's `*.test.ts`. Turn each into a plain `test()` as you finish it.
