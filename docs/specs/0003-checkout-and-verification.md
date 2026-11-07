# 0003: Checkout API and verification flow

|               |                           |
| ------------- | ------------------------- |
| **Status**    | In Progress               |
| **Owner**     | @harshkumarsingh12        |
| **Reviewers** | @srshriv, @sumedhag28     |
| **Milestone** | M1                        |
| **Code**      | `apps/api`, `packages/db` |

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

| Outcome   | Condition                                                                                  | Action                                                                                                               |
| --------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| `APPROVE` | hard rules pass; J1 `match` with confidence ≥ 0.8                                          | sign Cart Mandate; human present: create order `AUTHORIZE`; agent alone: create order `CAPTURE` against the vault id |
| `STEP_UP` | hard rules pass; J1 `partial`, or confidence 0.5–0.8, or `user_cart_confirmation_required` | human present: show warnings before the PayPal button; agent alone: email link (24 h), **no order until approved**   |
| `REJECT`  | any hard failure, or confidence < 0.5                                                      | no order; reason codes returned                                                                                      |

Agent alone with an `APPROVE` but no vaulted wallet on the shopper: HTTP 409 `no_vaulted_wallet`, nothing charged.
The shopper saves a wallet with Vault v3 (`/vault/*`, spec 0004 §Vault, #17) and the same checkout then charges it.
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

### Step-up links (agent alone), as built (#35)

`apps/api/src/stepup.ts`. When checkout steps up a cart with nobody present, it records the verdict, stores the
cart in `stepups` and sends the shopper a link to the buyer app's `/approve/<token>` page. Nothing goes to PayPal
and the agent's response carries no link.

- **The token only locates the step-up.** It is 32 random bytes, and only its SHA-256 is stored. Approving takes a
  `CartApproval` signed with **the key that signed the Intent Mandate**, naming the step-up id as `order_id` and
  the stored cart's hash. So the agent, or anyone else who sees the link, can't approve on the shopper's behalf.
  D3 called for a signed token. The shopper's signature is what carries the authority, so the link token is a
  plain random secret.
- **Expiry:** 24 h, or the cart's `cart_expiry` or the intent's `intent_expiry` if sooner. An expired link answers
  410 `stepup_expired` and creates nothing. An agent that wants the full day sets `cart_expiry` accordingly.
- **At approval:** check the signature (403 `approval_invalid` with reason codes, and the link stays usable). Then
  claim the row (`PENDING → APPROVING`, so exactly one request goes on) and run the hard rules again with the
  current capture ledger, because budget may have been spent since the link was sent (409
  `stepup_no_longer_valid`). Then require a vaulted wallet (409 `no_vaulted_wallet`, and the link stays usable).
  Finally, sign the Cart Mandate and create the order with intent `CAPTURE` against the vault id, through the same
  `placeOrder` as checkout. The order's verdict is `STEP_UP`. A retry after success returns the same answer.
- **PayPal failing at approval** marks the step-up `FAILED` and answers 502. The link doesn't retry blind,
  because PayPal may have charged before the error reached us. The agent starts a new checkout.
- **Delivery:** no email provider is wired. The API logs the link (`step-up approval link`), and
  `AppDeps.stepUp.send` is where an email sender plugs in. `BUYER_PUBLIC_URL` sets the link's origin (it must be the
  shop's public address on a hosted deploy, SETUP.md §4).
- **In the shop, no link needed:** the shop lists the carts waiting for the shopper with `POST /stepups/pending`, a
  fresh `StepUpListProof` (`stepup.list`, 5 minutes) signed by the key that signed the intent, and approves one with
  `POST /stepups/:id/approve` and the same `CartApproval` signature the link flow takes (`order_id` = the step-up id).
  The link token only ever located a step-up and the shopper's signature carried the authority, so this is the same
  security as the link: the agent, which never holds the shopper's key, can neither list nor approve. Only that
  shopper's own pending, unexpired step-ups are returned, and never a token.

### Buyer agent, as built (#37)

`apps/buyer/src/agent.ts`. The agent's tools are `create_intent_mandate`, `search_catalog` and `request_checkout`.
It holds no PayPal credentials and no shopper key: `create_intent_mandate` returns an unsigned draft that the
shopper reviews and signs in the browser (spec 0001), and `request_checkout` goes through the same signed
`POST /checkout` as a hand-picked cart, so nothing here changes the contract. The model sees the verdict outcome
and reason codes only. Limits per run: three carts, six model calls, the daily AI budget. With `AI_MODE=replay` a
scripted chooser (catalog filtered by the signed limits, best word match first) stands in for the model.

**Paying alone (#36).** The shop's "Let the agent pay alone from my saved wallet" switch (enabled once the shopper has a
Vault v3 wallet, spec 0004 §Vault) sends `human_present: false` to `/api/agent/checkout` and `/api/agent/choose`, which
puts it in the Payment Mandate the agent signs. The merchant's checks are the same. An `APPROVE` charges the wallet at
once and the response carries the `capture_id`; a `STEP_UP` charges nothing, creates no order and sends the step-up
link; a `REJECT` is as always. With nobody present an approved cart has already been charged, so `request_checkout`
refuses a second cart once the merchant has accepted one (`already_proposed`) in code, not only in the prompt.

The agent returns a trace (each search, each cart with its reason and the merchant's answer) that `/shop` shows.
`request_checkout` skips products that break the signed price, category or color (`OUT_OF_LIMITS`, shown, merchant not
asked) so the shopper's words can't talk the model past their own limits; the merchant still checks everything.
`create_intent_mandate` can't set `user_cart_confirmation_required`. It drafts only what the shopper stated: a color or item they didn't name is left open (`""`, shown as Anything / Any color) rather than guessed. The price cap is the exception, because one is always signed: with no price in the words the draft carries a proposed cap (the named item's usual cap, else $100) with `priceDefaulted: true`, and the shop says so next to the form. The live model's draft is checked against the shopper's words (`groundInWords`), because on the hosted shop (Nov 8) it invented a price for "a running jacket" and dropped the item in "white socks": a price is kept only if the words contain a number (digits or a number word), and an item or color the model left out is filled in when the words name one. Checked live, 18 of 18 runs across six phrases. `pnpm agent:eval` (docs/evals/README.md) measures it live.

### Jobs

Superseded (Nov 6): no job queue. The `webhook_events` rows the receiver stores are the worker's inbox, and the
worker also runs a `list_disputes` catch-up (spec 0005 §As built). Nothing was added to `packages/contracts`.

### Tables (`packages/db`)

`shoppers`, `shopper_keys`, `vault_setups`, `agent_keys`, `mandates` (canonical bytes + JWS), `nonces` (UNIQUE), `orders`,
`verdicts`, `webhook_events` (UNIQUE event id), `disputes`, `stepups` (UNIQUE token hash), `audit_log` (append-only).

## Interfaces

| Method | Path                                                         | Owner   | Request → Response                                                                                                                                                                                                             |
| ------ | ------------------------------------------------------------ | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| POST   | `/checkout`                                                  | Harsh   | `{ intent_jws, payment_mandate_jws, cart }` → `{ verdict, order_id?, cart_mandate_jws?, paypal_order_id?, approval_url?, capture_id? }` (`capture_id` only for an agent-alone order, charged at creation)                      |
| POST   | `/checkout/:id/approve`                                      | Harsh   | PayPal `onApprove` → authorize, stage 2, capture or void → `{ status }`                                                                                                                                                        |
| GET    | `/stepup/:token`                                             | Sristee | the waiting cart for the approval page → `StepUpView`; `cache-control: no-store`                                                                                                                                               |
| POST   | `/stepup/:token/approve`                                     | Sristee | `{ approval_jws }` (CartApproval, `order_id` = step-up id) → re-check, create and capture → `StepUpApproveResponse`                                                                                                            |
| POST   | `/stepups/pending`                                           | Sristee | `{ proof_jws }` (`StepUpListProof`, purpose `stepup.list`) → `{ stepups: StepUpView[] }`: this shopper's own pending, unexpired carts; `cache-control: no-store`                                                               |
| POST   | `/stepups/:id/approve`                                       | Sristee | `{ approval_jws }` (CartApproval, `order_id` = the step-up id) → as `/stepup/:token/approve`; found by id instead of link token                                                                                                |
| GET    | `/orders`, `/verifications`                                  | Harsh   | paginated grids for the dashboard                                                                                                                                                                                              |
| GET    | `/disputes`, `/disputes/:id/recommendation`                  | Sikruti | spec 0005                                                                                                                                                                                                                      |
| POST   | `/disputes/:id/actions/:action`                              | Sikruti | operator token; `action ∈ provide-evidence, accept-claim, send-message, escalate` (`make-offer` → 501, out of scope)                                                                                                           |
| GET    | `/disputes/:id/evidence.pdf`, `/disputes/:id/paypal-actions` | Harsh   | the stored attestation PDF; what PayPal allows right now (live `get_dispute`)                                                                                                                                                  |
| POST   | `/orders/:id/tracking`                                       | Harsh   | operator token; `{ trackingNumber, carrier, status? }` → shipment tracking on the capture                                                                                                                                      |
| GET    | `/analytics/:report`                                         | Sikruti | spec 0007                                                                                                                                                                                                                      |
| POST   | `/webhooks/paypal`                                           | Harsh   | spec 0004                                                                                                                                                                                                                      |
| POST   | `/keys/shopper`                                              | Sristee | `{ public_jwk }` (P-256) → `{ kid, shopper_id }`; public, rate-limited, `kid` = `shp_<RFC 7638 thumbprint>` (spec 0001)                                                                                                        |
| POST   | `/keys/agent`                                                | Sristee | `{ public_jwk, platform }` → `{ kid }`; operator token; `kid` = `agt_<thumbprint>`                                                                                                                                             |
| POST   | `/vault/setup`                                               | Harsh   | `{ proof_jws }` (`VaultProof` purpose `vault.setup`) → `{ setup_token_id, approval_url }`; public, rate-limited; spec 0004 §Vault                                                                                              |
| POST   | `/vault/save`                                                | Harsh   | `{ setup_token_id, proof_jws }` (purpose `vault.save`, naming that setup token) → `{ wallet: true }`; 409 `setup_not_available` if it isn't this shopper's or was used; 409 `paypal_refused` if PayPal hasn't got the approval |
| POST   | `/vault/remove`                                              | Harsh   | `{ proof_jws }` (purpose `vault.remove`) → `{ wallet: false }`; clears the saved wallet at once, then revokes it at PayPal; harmless if there is none                                                                          |
| GET    | `/vault/:kid`                                                | Harsh   | `{ wallet: boolean }` for a shopper key; never the vault id                                                                                                                                                                    |
| POST   | `/keys/:kind/:kid/retire`                                    | Sristee | `{ at? }` → `{ kid, retired_at }`; operator token; first retirement date wins                                                                                                                                                  |
| POST   | `/ai/studio`                                                 | Sumedha | Studio harness proxy, spec 0007                                                                                                                                                                                                |

A REJECT is HTTP 200 with `verdict.outcome = "REJECT"`. Errors follow docs/CONVENTIONS.md.

## Acceptance criteria

1. `/checkout` rejects the red $95 fixture with no PayPal order created. _(done; `pnpm sandbox:checkout-smoke`)_
2. A replayed nonce is rejected with `NONCE_REPLAYED`. _(done)_
3. An approved human-present cart is authorized, re-checked and captured; a modified cart is voided. _(done with the
   mock; live on integration day, needs a sandbox shopper to approve)_
4. Step-up: no order exists until the shopper approves; an expired link creates nothing. _(done, #35:
   `apps/api/src/stepup.test.ts`, with Postgres)_
5. Every verdict and PayPal call is in `audit_log` with the request body. _(done for stage 1)_

## Out of scope

Multi-merchant tenancy and API keys (stretch).
