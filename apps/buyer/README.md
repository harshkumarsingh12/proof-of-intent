# Buyer app and agent

**Path:** `apps/buyer/` | **Owner:** @srshriv | **Backup:** @hoursgotviral-dev | **Spec:** [0001-mandate-model.md](../../docs/specs/0001-mandate-model.md) | **Milestones:** M1, M2

Next.js shopper app: intent form, browser signing key, PayPal button, and the buyer agent (our tools only, never PayPal credentials). Run: `pnpm dev:buyer` (port 3001).

## Test

```bash
pnpm vitest run apps/buyer
```

Unbuilt acceptance criteria are `ledger()` entries in this folder's `*.test.ts`. Turn each into a plain `test()` as you finish it.
