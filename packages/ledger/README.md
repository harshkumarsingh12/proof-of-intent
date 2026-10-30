# @poi/ledger

**Path:** `packages/ledger/` | **Owner:** @harshkumarsingh12 | **Backup:** @srshriv | **Spec:** [CONTRIBUTING](../../CONTRIBUTING.md#the-ledger-acceptance-criteria-as-tests) | **Milestones:** all

`ledger(milestone, owner, title, fn)`: an acceptance criterion that is not built yet, run as `test.fails`. Owners and milestones are typed. `scripts/ledger.mjs` turns these into the CI burndown.

## Test

```bash
pnpm vitest run packages/ledger
```

Unbuilt acceptance criteria are `ledger()` entries in this folder's `*.test.ts`. Turn each into a plain `test()` as you finish it.
