# 0003: Checkout API and verification flow

| | |
|---|---|
| **Status** | In Progress |
| **Owner** | @harshkumarsingh12 |
| **Reviewers** | @srshriv, @sumedhag28 |
| **Milestone** | M1 |
| **Code** | `apps/api`, `packages/db` |

## Context

The merchant endpoint every buyer agent talks to. Its core promise: **no PayPal order exists for a cart that
fails verification.** Project document §5 journeys A and B.

## Design

### Stage 1, at cart issuance (before any PayPal call)

Checks run in this order and stop at the first stage that fails (built in `apps/api/src/checkout.ts`).

1. Cryptographic: Intent JWS from a registered shopper key; Payment Mandate from a registered agent key →
   `SIGNATURE_INVALID` / `UNKNOWN_KEY`. A retired key only verifies mandates created before `retired_at`.
2. Structural: zod parse of the signed payloads and the proposed cart; supported `schema_version`; cart total equals
   its lines → else `SCHEMA_INVALID`.
3. Bindings → `MANDATE_MISMATCH`: the Payment Mandate's `intent_mandate_hash` and `cart_mandate_hash` match the
   intent and the proposed cart; its `agent_key_id` is the signing key and its `agent_platform` the key's registered
   platform; the cart points at the intent; the cart's `merchant_id` is ours (`MERCHANT_ID`).
4. Replay: the **Payment Mandate id** is claimed in a unique-indexed table → `NONCE_REPLAYED`. Not the intent's
   nonce: one intent legitimately backs several attempts (journey B's retry after a rejection).
5. Hard rules: `evaluate()` (spec 0002) with the intent's capture ledger.
6. Semantic: J1 (spec 0006) only if every hard rule passed. If J1 is unavailable (unbuilt, error, budget kill
   switch), the outcome is `STEP_UP` with `SEMANTIC_UNCERTAIN`: a person confirms instead of the model.
7. Decision:

| Outcome | Condition | Action |
|---|---|---|
| `APPROVE` | hard rules pass; J1 `match` with confidence ≥ 0.8 | sign Cart Mandate; human present: create order `AUTHORIZE`; agent alone: create order `CAPTURE` against the vault id |
| `STEP_UP` | hard rules pass; J1 `partial`, or confidence 0.5–0.8, or `user_cart_confirmation_required` | human present: show warnings before the PayPal button; agent alone: email link (24 h), **no order until approved** |
| `REJECT` | any hard failure, or confidence < 0.5 | no order; reason codes returned |

Agent alone with an `APPROVE` but no vaulted wallet on the shopper: HTTP 409 `no_vaulted_wallet`, nothing charged.
If PayPal fails to create the order: HTTP 502 `paypal_unavailable`, the order row is marked `PAYPAL_FAILED`.
The order row (status `PENDING`) and its verdict are written before the PayPal call, so a crash never leaves a
PayPal order we have no record of.

### Stage 2, before capture (human present only)

`POST /checkout/:id/approve { approval_jws }`, called by the buyer app from PayPal's `onApprove`. Built in
`apps/api/src/approve.ts`.

1. Authorize the PayPal order (PayPal refuses with `ORDER_NOT_APPROVED` → 409 `shopper_has_not_approved`).
2. Re-check: the countersignature (`CartApproval { order_id, cart_mandate_hash, approved_at }`, see spec 0001)
   verifies with **the key that signed the Intent Mandate** (else `UNKNOWN_KEY` / `SIGNATURE_INVALID`); it names
   this order and the exact Cart Mandate we signed (else `MANDATE_MISMATCH`); the cart hasn't expired (else
   `CART_EXPIRED`).
3. All good → capture → `{ status: "CAPTURED", capture_id }`. Otherwise void → `{ status: "VOIDED", reasons }`.

Authorizing before re-checking means a failed check releases the hold instead of leaving the shopper's money
held. A retry after completion returns the same outcome; a PayPal failure answers 502 and leaves the order at its
last state (`AUTHORIZED`), so a retry finishes the job with the same idempotent capture request.

### Jobs (pg-boss)

`dispute.received`, `dispute.classify`, `dispute.evidence.build`, `ledger.update`, each with a zod payload in
`packages/contracts` (to add in M1).

### Tables (`packages/db`)

`shoppers`, `shopper_keys`, `agent_keys`, `mandates` (canonical bytes + JWS), `nonces` (UNIQUE), `orders`,
`verdicts`, `webhook_events` (UNIQUE event id), `disputes`, `audit_log` (append-only).

## Interfaces

| Method | Path | Owner | Request → Response |
|---|---|---|---|
| POST | `/checkout` | Harsh | `{ intent_jws, payment_mandate_jws, cart }` → `{ verdict, cart_mandate_jws?, paypal_order_id?, approval_url? }` |
| POST | `/checkout/:id/approve` | Harsh | PayPal `onApprove` → authorize, stage 2, capture or void → `{ status }` |
| POST | `/stepup/:token/approve` | Sristee | shopper approval → create (and capture) the order |
| GET | `/orders`, `/verifications` | Harsh | paginated grids for the dashboard |
| GET | `/disputes`, `/disputes/:id/recommendation` | Sikruti | spec 0005 |
| POST | `/disputes/:id/actions/:action` | Sikruti | operator action; `action ∈ provide-evidence, accept-claim, make-offer, send-message` |
| GET | `/analytics/:report` | Sikruti | spec 0007 |
| POST | `/webhooks/paypal` | Harsh | spec 0004 |
| POST | `/ai/studio` | Sumedha | Studio harness proxy, spec 0007 |

A REJECT is HTTP 200 with `verdict.outcome = "REJECT"`. Errors follow docs/CONVENTIONS.md.

## Acceptance criteria

1. `/checkout` rejects the red $95 fixture with no PayPal order created. *(done; `pnpm sandbox:checkout-smoke`)*
2. A replayed nonce is rejected with `NONCE_REPLAYED`. *(done)*
3. An approved human-present cart is authorized, re-checked and captured; a modified cart is voided. *(done with the
   mock; live on integration day, needs a sandbox shopper to approve)*
4. Step-up: no order exists until the shopper approves; an expired link creates nothing. *(ledger M2 @srshriv)*
5. Every verdict and PayPal call is in `audit_log` with the request body. *(done for stage 1)*

## Out of scope

Multi-merchant tenancy and API keys (stretch).
