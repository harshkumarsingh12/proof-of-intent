# Operations dashboard

**Path:** `apps/dashboard/` | **Owner:** @hoursgotviral-dev | **Backup:** @harshkumarsingh12 | **Spec:** [0007-dashboard.md](../../docs/specs/0007-dashboard.md) | **Milestones:** M1, M2, M3

Next.js + AG Studio: orders, verification queue, disputes workspace, analytics, custom widgets, Studio agent. Run: `pnpm dev:dashboard` (port 3002).

## Test

```bash
pnpm vitest run apps/dashboard
```

Unbuilt acceptance criteria are `ledger()` entries in this folder's `*.test.ts`. Turn each into a plain `test()` as you finish it.
