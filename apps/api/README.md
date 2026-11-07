# Merchant API

**Path:** `apps/api/` | **Owner:** @harshkumarsingh12 | **Backup:** @srshriv | **Spec:** [0003-checkout-and-verification.md](../../docs/specs/0003-checkout-and-verification.md) | **Milestones:** M1, M2

Fastify service on port 3000 (`pnpm dev:api`).

**Built:** `/healthz`, `/readyz`, checkout (`POST /checkout`, `POST /checkout/:id/approve`), `POST /webhooks/paypal`,
keys (`POST /keys/shopper`, `POST /keys/agent`, `POST /keys/:kind/:kid/retire`), wallet saving with Vault v3
(`POST /vault/setup`, `POST /vault/save`, `POST /vault/remove`, `GET /vault/:kid`), disputes (`GET /disputes`,
`/disputes/:id/recommendation`, `/disputes/:id/evidence.pdf`, `/disputes/:id/paypal-actions`,
`POST /disputes/:id/actions/:action`), `GET /orders`, `GET /verifications`, `POST /orders/:id/tracking`, step-up links
(`GET /stepup/:token`, `POST /stepup/:token/approve`, and for the shop's own list `POST /stepups/pending`, `POST /stepups/:id/approve`) and `POST /ai/studio` (operator token, 60 requests a minute; `list_disputes` reads our own
table: counts, then what needs a response soonest-first, capped at 12). Still 501 with its owner:
`GET /analytics/:report` (the dashboard's analytics page computes from the disputes and orders it already reads).

`buildApp(deps)` takes `{ paypal, db?, merchant?, aiMode?, operatorToken?, semanticFit?, now? }`; `await depsFromEnv()`
builds them from `PAYPAL_MODE` (mock by default), `DATABASE_URL`, `AI_MODE`, `OPERATOR_TOKEN` and the `MERCHANT_*`
variables. Tests pass a mock
client and the in-memory `Db` from `src/test-helpers.ts`.

## POST /checkout

`{ intent_jws, payment_mandate_jws, cart }` → `{ verdict, order_id?, cart_mandate_jws?, paypal_order_id?, approval_url?, capture_id? }`
(`CheckoutRequest` / `CheckoutResponse` in `packages/contracts`). The order of checks and the decision table are in
spec 0003 §Stage 1. A REJECT is HTTP 200; 400 is a malformed request, 409 an agent-alone order with no saved wallet,
502 PayPal down, 503 missing configuration.

Against the sandbox: `DATABASE_URL=… pnpm sandbox:checkout-smoke` runs journey B and reads the order back from PayPal.

## POST /checkout/:id/approve

Human present, from PayPal's `onApprove`: `{ approval_jws }` (the shopper's `CartApproval` countersignature) →
check the signature (403 `approval_invalid` with reason codes, nothing sent to PayPal), then authorize and
`{ status: "CAPTURED", capture_id }`, or `{ status: "VOIDED", reasons }` when a genuine approval arrives too late. 409 if
the shopper hasn't approved on PayPal yet; 502 if PayPal fails (retry is safe). Details in spec 0003 §Stage 2.

## POST /webhooks/paypal

Verify with PayPal, store once, answer fast (spec 0004 §Webhooks). `GET /readyz` reports `webhooks`: how many verified
deliveries the API holds and when the last arrived (`pnpm sandbox:webhook-check` uses it to prove real delivery).

| Delivery                                                  | Answer                                                   | Stored    |
| --------------------------------------------------------- | -------------------------------------------------------- | --------- |
| verified, new event id                                    | 200 `{"status":"stored"}` + `webhook.received` audit row | yes       |
| verified, event id already stored                         | 200 `{"status":"duplicate"}`                             | no change |
| missing transmission headers, junk body, forged signature | 400 `webhook_unverified`                                 | no        |
| PayPal unreachable for verification, or no database       | 503 (PayPal redelivers)                                  | no        |

The body is kept as the exact string PayPal signed (a raw parser scoped to this route only). Stored rows with
`processed_at` null are the worker's inbox. In mock mode a delivery verifies when `paypal-transmission-sig` is
`mock-signature`.

## Keys (`src/routes/keys.ts`, spec 0001)

| Route                                         | Who               | Answer                                                                                  |
| --------------------------------------------- | ----------------- | --------------------------------------------------------------------------------------- |
| `POST /keys/shopper` `{ public_jwk }`         | public, 10/min/IP | 201 new / 200 same key again → `{ kid, shopper_id }`; 400 for private or non-P-256 keys |
| `POST /keys/agent` `{ public_jwk, platform }` | operator token    | 201 / 200 → `{ kid, platform }`; 409 if the key belongs to another platform             |
| `POST /keys/:kind/:kid/retire` `{ at? }`      | operator token    | `{ kid, retired_at }`; the first date wins                                              |

`kid` is `shp_` / `agt_` plus the key's RFC 7638 thumbprint. Every registration and retirement is audited.

## Wallet saving: Vault v3 (`src/vault.ts`, `src/routes/vault.ts`, spec 0004 §Vault)

What agent-alone checkout charges. Public routes, but every write carries a proof signed by the shopper's key.

| Route                                              | Answer                                                                                                                                                                                     |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `POST /vault/setup` `{ proof_jws }`                | `{ setup_token_id, approval_url }`: send the shopper to PayPal; PayPal returns them to `BUYER_PUBLIC_URL/shop/wallet?approval_token_id=…`                                                  |
| `POST /vault/save` `{ setup_token_id, proof_jws }` | `{ wallet: true }`; 403 `proof_invalid` / `proof_expired`; 409 `setup_not_available` (not yours, or used); 409 `paypal_refused` (not approved yet: the setup token is released, try again) |
| `POST /vault/remove` `{ proof_jws }`               | `{ wallet: false }`: the saved wallet is cleared at once (the agent can no longer charge it), then revoked at PayPal; a revoke failure is audited, not surfaced                            |
| `GET /vault/:kid`                                  | `{ wallet: boolean }`; 404 for an unknown key                                                                                                                                              |

Proofs are `VaultProof` (`packages/contracts`) signed by the shopper's key, valid 5 minutes. 10/min/IP like `/keys/shopper`.

## Disputes and operator actions (`src/routes/disputes.ts`, spec 0005)

Reads (no auth): `GET /disputes` and `GET /disputes/:id/recommendation` in the dashboard's `DisputeItem` /
`DisputeDetail` shape, built from the row the worker stored; `GET /disputes/:id/evidence.pdf`;
`GET /disputes/:id/paypal-actions` → `{ stage, status, allowed }` asked live from PayPal.

Actions: `POST /disputes/:id/actions/{provide-evidence,accept-claim,send-message,escalate}` and
`POST /orders/:id/tracking` need `Authorization: Bearer $OPERATOR_TOKEN` (unset → 503, wrong → 401). Each writes
`operator.<action>` to `audit_log` before the PayPal call, then `paypal.<action>` or `paypal.<action>.failed`.
PayPal refusing → 409 `paypal_refused` with PayPal's issue; PayPal unreachable → 503 with `retry-after`.
`make-offer` → 501 (out of scope).

## Test

```bash
pnpm vitest run apps/api
```

Unbuilt acceptance criteria are `ledger()` entries in this folder's `*.test.ts`. Turn each into a plain `test()` as you finish it.
