# Merchant API

**Path:** `apps/api/` | **Owner:** @harshkumarsingh12 | **Backup:** @srshriv | **Spec:** [0003-checkout-and-verification.md](../../docs/specs/0003-checkout-and-verification.md) | **Milestones:** M1, M2

Fastify service on port 3000 (`pnpm dev:api`).

**Built:** `/healthz`, `/readyz`, `POST /webhooks/paypal`. Every other agreed route returns 501 with its owner.

`buildApp(deps?)` takes `{ paypal, db? }`; without arguments it reads `PAYPAL_MODE` (mock by default) and
`DATABASE_URL`. Tests pass a mock client and an in-memory `Db`.

## POST /webhooks/paypal

Verify with PayPal, store once, answer fast (spec 0004 §Webhooks).

| Delivery | Answer | Stored |
|---|---|---|
| verified, new event id | 200 `{"status":"stored"}` + `webhook.received` audit row | yes |
| verified, event id already stored | 200 `{"status":"duplicate"}` | no change |
| missing transmission headers, junk body, forged signature | 400 `webhook_unverified` | no |
| PayPal unreachable for verification, or no database | 503 (PayPal redelivers) | no |

The body is kept as the exact string PayPal signed (a raw parser scoped to this route only). Stored rows with
`processed_at` null are the worker's inbox. In mock mode a delivery verifies when `paypal-transmission-sig` is
`mock-signature`.

## Test

```bash
pnpm vitest run apps/api
```

Unbuilt acceptance criteria are `ledger()` entries in this folder's `*.test.ts`. Turn each into a plain `test()` as you finish it.
