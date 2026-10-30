# @poi/db

**Path:** `packages/db/` | **Owner:** @harshkumarsingh12 | **Backup:** @hoursgotviral-dev | **Spec:** [0003-checkout-and-verification.md](../../docs/specs/0003-checkout-and-verification.md) | **Milestones:** M1

Postgres schema, migrations, seed, append-only audit log. Currently an interface with stubs. Unique indexes (nonces, webhook event ids) carry replay protection and idempotency.

## Test

```bash
pnpm vitest run packages/db
```

Unbuilt acceptance criteria are `ledger()` entries in this folder's `*.test.ts`. Turn each into a plain `test()` as you finish it.
