# @poi/mandates

**Path:** `packages/mandates/` | **Owner:** @srshriv | **Backup:** @harshkumarsingh12 | **Spec:** [0001-mandate-model.md](../../docs/specs/0001-mandate-model.md) | **Milestones:** M0, M1

RFC 8785 canonicalization, `mandateHash`, `customId`, ES256 JWS `signMandate` / `verifyMandate`. **Built and tested.** Next: key registry with retirement (M1).

## Test

```bash
pnpm vitest run packages/mandates
```

Unbuilt acceptance criteria are `ledger()` entries in this folder's `*.test.ts`. Turn each into a plain `test()` as you finish it.
