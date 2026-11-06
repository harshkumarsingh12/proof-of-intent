# Buyer app and agent

**Path:** `apps/buyer/` | **Owner:** @srshriv | **Backup:** @hoursgotviral-dev | **Spec:** [0001-mandate-model.md](../../docs/specs/0001-mandate-model.md) | **Milestones:** M1, M2

Next.js shopper app: intent form, browser signing key, PayPal button, and the buyer agent (our tools only, never PayPal credentials). Run: `pnpm dev:buyer` (port 3001).

Built: the landing page (#78). Ready on the API side for the rest (#23): register the browser's public key with
`POST /keys/shopper` (its `kid` is the Intent Mandate's `issuer`), then `POST /checkout` and
`POST /checkout/:id/approve`. `scripts/sandbox/hosted-order.ts` does the same calls from Node and is a working
reference.

## Test

```bash
pnpm vitest run apps/buyer
```

Unbuilt acceptance criteria are `ledger()` entries in this folder's `*.test.ts`. Turn each into a plain `test()` as you finish it.
