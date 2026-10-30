# 0003: Checkout API and verification flow

| | |
|---|---|
| **Status** | Proposed |
| **Owner** | @harshkumarsingh12 |
| **Reviewers** | @srshriv, @sumedhag28 |
| **Milestone** | M1 |
| **Code** | `apps/api`, `packages/db` |

## Context

The merchant endpoint every buyer agent talks to. Its core promise: **no PayPal order exists for a cart that
fails verification.** Project document §5 journeys A and B.

## Design

### Stage 1, at cart issuance (before any PayPal call)

1. Structural: zod parse of all mandates; supported `schema_version` → else `SCHEMA_INVALID`.
2. Cryptographic: Intent JWS from a registered shopper key; Payment Mandate from a registered agent key →
   `SIGNATURE_INVALID` / `UNKNOWN_KEY`.
3. Freshness and replay: nonce claimed in a unique-indexed table → `NONCE_REPLAYED`.
4. Hard rules: `evaluate()` (spec 0002) with the mandate's ledger.
5. Semantic: J1 (spec 0006) only if every hard rule passed.
6. Decision:

| Outcome | Condition | Action |
|---|---|---|
| `APPROVE` | hard rules pass; J1 `match` with confidence ≥ 0.8 | sign Cart Mandate; human present: create order `AUTHORIZE`; agent alone: create order `CAPTURE` against the vault id |
| `STEP_UP` | hard rules pass; J1 `partial`, or confidence 0.5–0.8, or `user_cart_confirmation_required` | human present: show warnings before the PayPal button; agent alone: email link (24 h), **no order until approved** |
| `REJECT` | any hard failure, or confidence < 0.5 | no order; reason codes returned |

### Stage 2, before capture (human present only)

Cart hash unchanged, cart not expired (15 min), shopper countersignature valid → capture; otherwise void.

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

1. `/checkout` rejects the red $95 fixture with no PayPal order created. *(ledger M1 @harshkumarsingh12)*
2. A replayed nonce is rejected with `NONCE_REPLAYED`. *(ledger M1 @harshkumarsingh12, via packages/db)*
3. An approved human-present cart is authorized, re-checked and captured; a modified cart is voided.
4. Step-up: no order exists until the shopper approves; an expired link creates nothing. *(ledger M2 @srshriv)*
5. Every verdict and PayPal call is in `audit_log` with the request body.

## Out of scope

Multi-merchant tenancy and API keys (stretch).
