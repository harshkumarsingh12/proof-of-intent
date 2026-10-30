# Merchant API

**Path:** `apps/api/` | **Owner:** @harshkumarsingh12 | **Backup:** @srshriv | **Spec:** [0003-checkout-and-verification.md](../../docs/specs/0003-checkout-and-verification.md) | **Milestones:** M1, M2

Fastify service. **Built:** `/healthz`, `/readyz`, and every agreed route returning 501 with its owner. Run: `pnpm dev:api` (port 3000).

## Test

```bash
pnpm vitest run apps/api
```

Unbuilt acceptance criteria are `ledger()` entries in this folder's `*.test.ts`. Turn each into a plain `test()` as you finish it.
