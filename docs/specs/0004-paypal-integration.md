# 0004: PayPal integration

| | |
|---|---|
| **Status** | In Progress |
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
- **Disputes:** the sandbox client calls the PayPal Agent Toolkit (`@paypal/agent-toolkit`,
  `src/agent-toolkit.ts`) for `get_dispute`, `list_disputes`, `accept_dispute_claim` and
  `create_shipment_tracking`, invoking its tools directly (no model picks them). The worker reads with
  `get_dispute` / `list_disputes`; the API runs accept-claim and tracking only after an operator click, audit row
  first (spec 0005). REST in this package covers what the toolkit doesn't: `provide-evidence` (multipart),
  `send-message`, and sandbox-only `require-evidence` and `adjudicate`.
- Evidence by reason: `MERCHANDISE_OR_SERVICE_NOT_RECEIVED` → `PROOF_OF_FULFILLMENT` with tracking;
  `MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED`, `UNAUTHORISED` → `OTHER` with the attestation PDF;
  `CREDIT_NOT_PROCESSED` → `PROOF_OF_REFUND`. Always follow the dispute's HATEOAS links.
- **Stages, as observed on the sandbox (Nov 5, dispute `PP-R-NSZ-10196423`).** A buyer's report opens at the
  `INQUIRY` stage, where PayPal offers the seller only `send_message`, `make_offer`, `accept_claim` and `escalate`.
  `provide-evidence` and `require-evidence` are refused there (`ACTION_NOT_ALLOWED_IN_CURRENT_DISPUTE_STATE`).
  After the seller escalates, PayPal moves it to `CHARGEBACK` within about a minute and offers `provide_evidence`.
  So the copilot's **defend** path is: at inquiry, send the buyer a message summarizing the signed mandate (and
  escalate if they don't withdraw); at claim, submit the attestation PDF. **Concede** is `accept_claim` at either
  stage. The worker (spec 0005) must read the allowed actions from the links, not assume them.

### Sandbox setup

REST app with **Disputes** and **Vault** enabled; sandbox accounts: merchant, `shopper-compliant`,
`shopper-dispute`, and two **judge** shoppers. Webhook at `https://<api host>/webhooks/paypal` (events in
docs/SETUP.md) plus a dev tunnel webhook.

### Sandbox dispute recipe (`scripts/sandbox/dispute-cycle.ts`)

Built. `pnpm sandbox:dispute-cycle start` runs a compliant order through our own API (`/checkout` → the shopper
approves on PayPal → stage 2 capture), waits while the shopper reports a problem in the Resolution Center (the
one manual click), then calls `require-evidence` when the dispute is `UNDER_REVIEW`. After the copilot acts:
`evidence <id>`, `message <id> "<text>"`, `adjudicate <id> seller|buyer` → `CUSTOMER.DISPUTE.RESOLVED`; `status <id>`
at any point. Sandbox-only calls live in `scripts/sandbox/paypal-raw.ts`, never in the production client.

## Interfaces

`PayPalClient` in `packages/paypal/src/index.ts`: `createOrder`, `authorizeOrder`, `captureAuthorization`,
`voidAuthorization`, `verifyWebhook`, `provideEvidence`, `sendMessage`. `parseMode(env)`.

## Acceptance criteria

1. Mock `createOrder` returns `CREATED`; authorize + capture return ids. *(done)*
2. Sandbox: create, authorize, capture and void recorded as fixtures for CI. *(done: `pnpm sandbox:record-orders`; authorize after a real shopper approval is exercised on integration day)*
3. A forged webhook signature is rejected. *(done, also against the live sandbox)*
4. `provide-evidence` sends multipart with the attestation PDF. *(done: `attestation.pdf` submitted by seller on sandbox dispute `PP-R-NSZ-10196423`)*
5. The dispute recipe script regenerates a dispute in under 5 minutes with one manual click. *(done; the click is the Resolution Center form, about 8 short pages)*

## Open questions

- Vault v3 permissions on the sandbox app: spike Nov 1; drop F6 at the Nov 3 gate if blocked. @harshkumarsingh12.
