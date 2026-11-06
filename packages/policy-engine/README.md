# @poi/policy-engine

**Path:** `packages/policy-engine/` | **Owner:** @srshriv | **Backup:** @harshkumarsingh12 | **Spec:** [0002-policy-engine.md](../../docs/specs/0002-policy-engine.md) | **Milestones:** M0, M1

Pure `evaluate({ intent, cart, now, ledger })`. **Built:** mandate match, freshness, currency, amount, merchant, quantity, attributes, SKU allowlist, address hash,
budget cap and recurrence (every rule in the spec's table).

## Test

```bash
pnpm vitest run packages/policy-engine
```

Unbuilt acceptance criteria are `ledger()` entries in this folder's `*.test.ts`. Turn each into a plain `test()` as you finish it.
