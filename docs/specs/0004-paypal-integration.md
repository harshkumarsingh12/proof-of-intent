# 0004: PayPal integration

| | |
|---|---|
| **Status** | Proposed |
| **Owner** | @harshkumarsingh12 |
| **Reviewers** | @hoursgotviral-dev |
| **Milestone** | M0 (mock), M1 (orders, vault, webhooks), M2 (disputes) |
| **Code** | `packages/paypal`, `scripts/sandbox/` |

## Context

Five PayPal surfaces, all on the sandbox: Orders v2, Vault v3, Webhooks, Disputes API, Agent Toolkit. The rest of
the team must be able to work before the sandbox is wired, hence a mock with the same interface.

## Design

- Base URL `https://api-m.sandbox.paypal.com`; client-credentials OAuth2, token cached in memory until expiry.
- `PAYPAL_MODE=mock` returns fixture payloads with realistic ids and statuses; `sandbox` makes real calls.
- **Orders:** human present uses `intent: AUTHORIZE` → authorize → capture or void. Agent alone uses
  `intent: CAPTURE` with `payment_source.paypal.vault_id`. `custom_id` = mandate pointer, `invoice_id` = our order
  id, item-level `items[]`. `PayPal-Request-Id` = our order id for idempotency.
- **Vault v3:** setup token with `usage_type: MERCHANT` → buyer approves in vault mode → payment token → store
  `vault_id` on the shopper.
- **Webhooks:** verify every delivery with `POST /v1/notifications/verify-webhook-signature` (transmission headers,
  raw body, our webhook id); persist first (unique event id), enqueue, answer 200 fast; unverified → 400.
- **Disputes:** Agent Toolkit (`get_dispute`, `list_disputes`, `accept_dispute_claim`) is used by the worker
  (spec 0005). REST in this package covers what the toolkit doesn't: `provide-evidence` (multipart),
  `send-message`, and sandbox-only `require-evidence` and `adjudicate`.
- Evidence by reason: `MERCHANDISE_OR_SERVICE_NOT_RECEIVED` → `PROOF_OF_FULFILLMENT` with tracking;
  `MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED`, `UNAUTHORISED` → `OTHER` with the attestation PDF;
  `CREDIT_NOT_PROCESSED` → `PROOF_OF_REFUND`. Always follow the dispute's HATEOAS links.

### Sandbox setup

REST app with **Disputes** and **Vault** enabled; sandbox accounts: merchant, `shopper-compliant`,
`shopper-dispute`, and two **judge** shoppers. Webhook at `https://<api host>/webhooks/paypal` (events in
docs/SETUP.md) plus a dev tunnel webhook.

### Sandbox dispute recipe (`scripts/sandbox/dispute-cycle.ts`)

Capture for `shopper-dispute` → shopper reports a problem in Resolution Center → `require-evidence` →
copilot acts → `adjudicate` → `CUSTOMER.DISPUTE.RESOLVED`.

## Interfaces

`PayPalClient` in `packages/paypal/src/index.ts`: `createOrder`, `authorizeOrder`, `captureAuthorization`,
`voidAuthorization`, `verifyWebhook`, `provideEvidence`, `sendMessage`. `parseMode(env)`.

## Acceptance criteria

1. Mock `createOrder` returns `CREATED`; authorize + capture return ids. *(ledger M0)*
2. Sandbox: create, authorize, capture and void recorded as fixtures for CI. *(M1)*
3. A forged webhook signature is rejected. *(ledger M1)*
4. `provide-evidence` sends multipart with the attestation PDF. *(ledger M2)*
5. The dispute recipe script regenerates a dispute in under 5 minutes with one manual click. *(M2)*

## Open questions

- Vault v3 permissions on the sandbox app: spike Nov 1; drop F6 at the Nov 3 gate if blocked. @harshkumarsingh12.
