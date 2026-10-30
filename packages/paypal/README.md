# @poi/paypal

**Path:** `packages/paypal/` | **Owner:** @harshkumarsingh12 | **Backup:** @srshriv | **Spec:** [0004-paypal-integration.md](../../docs/specs/0004-paypal-integration.md) | **Milestones:** M0, M1, M2

Typed PayPal client with `mock` and `sandbox` modes behind one interface. Currently stubs that name their owner. Next: mock mode (M0), Orders/Vault/webhook verify (M1), Disputes REST (M2).

## Test

```bash
pnpm vitest run packages/paypal
```

Unbuilt acceptance criteria are `ledger()` entries in this folder's `*.test.ts`. Turn each into a plain `test()` as you finish it.
