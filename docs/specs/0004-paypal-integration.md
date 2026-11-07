# 0004: PayPal integration

|               |                                                        |
| ------------- | ------------------------------------------------------ |
| **Status**    | In Progress                                            |
| **Owner**     | @harshkumarsingh12                                     |
| **Reviewers** | @hoursgotviral-dev                                     |
| **Milestone** | M0 (mock), M1 (orders, vault, webhooks), M2 (disputes) |
| **Code**      | `packages/paypal`, `scripts/sandbox/`                  |

## Context

Five PayPal surfaces, all on the sandbox: Orders v2, Vault v3, Webhooks, Disputes API, Agent Toolkit. The rest of
the team must be able to work before the sandbox is wired, hence a mock with the same interface.

## Design

- Base URL `https://api-m.sandbox.paypal.com`; client-credentials OAuth2, token cached in memory until expiry.
- `PAYPAL_MODE=mock` returns fixture payloads with realistic ids and statuses; `sandbox` makes real calls.
- **Orders:** human present uses `intent: AUTHORIZE` → authorize → capture or void. Agent alone uses
  `intent: CAPTURE` with `payment_source.paypal.vault_id`. `custom_id` = mandate pointer, `invoice_id` = our order
  id, item-level `items[]`. `PayPal-Request-Id` = our order id for idempotency.
- **Vault v3 (as built, #17):** `createVaultSetupToken` (`POST /v3/vault/setup-tokens`, `usage_type: MERCHANT`,
  return and cancel URLs) → the shopper approves on PayPal, which sends them back with `approval_token_id` →
  `createVaultPaymentToken` (`POST /v3/vault/payment-tokens` from that setup token, one use) → the payment token's id is
  stored as `shoppers.vault_id`. The merchant API drives it (`apps/api/src/vault.ts`, routes below) and every write
  carries a **shopper proof**: a compact JWS by the key that signs the shopper's Intent Mandates over
  `VaultProof { purpose: "vault.setup" | "vault.save" | "vault.remove", setup_token_id?, issued_at }`, good for 5 minutes. Without it
  anyone who knew a shopper key id could point that shopper at a wallet of their choosing. Setup tokens are stored in
  `vault_setups` for the shopper they were made for and claimed once, so a token can't be saved onto another shopper
  or twice; a PayPal refusal (typically "not approved yet", which the sandbox answers as `422 PAYER_ACTION_REQUIRED`, seen
  Nov 7) gives the claim back so the shopper can retry. A shopper
  can remove the wallet (`POST /vault/remove`, a `vault.remove` proof): our `vault_id` is cleared first, so the agent
  can't charge it from that moment, then PayPal is asked to revoke the payment token (`deletePaymentToken`; a failure
  there is audited with the id for a later revoke and doesn't undo the removal). The vault id never leaves the server:
  `GET /vault/:kid` answers only `{ wallet: boolean }`. Verified against the sandbox (Nov 7,
  `pnpm sandbox:vault-wallet`): PayPal accepts the setup token request; after a real approval as a sandbox shopper
  the setup token became a payment token, and a $1.00 `CAPTURE` order against that vault id completed at creation
  with a capture and no shopper present. That is the call agent-alone checkout makes.
- **Webhooks:** verify every delivery with `POST /v1/notifications/verify-webhook-signature` (transmission headers,
  raw body, our webhook id); persist first (unique event id), enqueue, answer 200 fast; unverified → 400.
- **Disputes:** the sandbox client calls the PayPal Agent Toolkit (`@paypal/agent-toolkit`,
  `src/agent-toolkit.ts`) for `get_dispute`, `list_disputes`, `accept_dispute_claim` and
  `create_shipment_tracking`, invoking its tools directly (no model picks them). The worker reads with
  `get_dispute` / `list_disputes`; the API runs accept-claim and tracking only after an operator click, audit row
  first (spec 0005). REST in this package covers what the toolkit doesn't: `provide-evidence` (multipart),
  `send-message`, `escalate`, and sandbox-only `require-evidence` and `adjudicate`.
- **Transient failures:** a call that failed before reaching PayPal (token fetch, DNS: `EAI_AGAIN` seen live on
  Nov 6) is retried up to 3 times; one that reached PayPal is never retried, so no action runs twice. Callers
  answer 503 with `retry-after`.
- Evidence by reason: `MERCHANDISE_OR_SERVICE_NOT_RECEIVED` → `PROOF_OF_FULFILLMENT` with tracking;
  `MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED`, `UNAUTHORISED` → `OTHER` with the attestation PDF;
  `CREDIT_NOT_PROCESSED` → `PROOF_OF_REFUND`. Always follow the dispute's HATEOAS links.
- **Stages, as observed on the sandbox (Nov 5, dispute `PP-R-NSZ-10196423`).** A buyer's report opens at the
  `INQUIRY` stage, where PayPal offers the seller only `send_message`, `make_offer`, `accept_claim` and `escalate`.
  `provide-evidence` and `require-evidence` are refused there (`ACTION_NOT_ALLOWED_IN_CURRENT_DISPUTE_STATE`).
  After the seller escalates, PayPal moves it to `CHARGEBACK` and offers `provide_evidence`: about a minute on Nov 5, about three minutes on the
  hosted runs of Nov 7, so poll `GET /disputes/:id/paypal-actions` instead of waiting a fixed time.
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

`PayPalClient` in `packages/paypal/src/index.ts`: `createOrder`, `createVaultSetupToken`, `createVaultPaymentToken`, `authorizeOrder`, `captureAuthorization`,
`voidAuthorization`, `verifyWebhook`, `provideEvidence`, `sendMessage`, `escalate`, and through the Agent Toolkit
`acceptClaim`, `getDispute`, `listDisputes`, `addTracking`. `parseMode(env)`, `toPayPalAmount`, `fromPayPalAmount`,
`evidenceTypeFor(reason)`.

## Acceptance criteria

1. Mock `createOrder` returns `CREATED`; authorize + capture return ids. _(done)_
2. Sandbox: create, authorize, capture and void recorded as fixtures for CI. _(done: `pnpm sandbox:record-orders`; authorize after a real shopper approval is exercised on integration day)_
3. A forged webhook signature is rejected. _(done, also against the live sandbox)_
   A real sandbox event is verified and stored once even when delivered twice. _(`pnpm sandbox:webhook-check` resends
   an old event and reads the `webhooks` count on `GET /readyz`; done on Nov 7: a new event raised the count 100 to 101,
   the same event again left it at 101)_
4. `provide-evidence` sends multipart with the attestation PDF. _(done: `attestation.pdf` submitted by seller on sandbox dispute `PP-R-NSZ-10196423`)_
5. The dispute recipe script regenerates a dispute in under 5 minutes with one manual click. _(done; the click is the Resolution Center form, about 8 short pages)_
6. Accept-claim through the Agent Toolkit resolves a sandbox dispute. _(done: `PP-R-MMK-10196694` RESOLVED_BUYER_FAVOUR, Nov 6; hosted: `PP-R-IWL-10196768`)_

7. A shopper saves a PayPal wallet through the setup and save routes; only the signed shopper can, a setup token works
   once, and the saved wallet is what an agent-alone checkout charges. _(done, mock: `apps/api/src/vault.test.ts`)_
8. PayPal's sandbox accepts the Vault v3 setup token request. _(done Nov 7: `pnpm sandbox:vault-wallet --setup-only`)_
   A real approval turns into a vault id that a CAPTURE order charges with no shopper present. _(done Nov 7: vault id
   `6x4815154r7192528`, order `84B88568BU8741939` COMPLETED with capture `01T21005RJ936303S`; run by script, so the
   hosted shop's own save-and-pay run is still to do, #36)_

## Open questions

- ~~Vault v3 permissions on the sandbox app~~ The app can create setup tokens (Nov 7). Whether the approved token
  charges is the manual check in criterion 8. @harshkumarsingh12.
