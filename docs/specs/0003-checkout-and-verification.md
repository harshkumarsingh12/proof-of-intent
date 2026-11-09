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
   Several attempts, but by default one purchase (#156): an intent that signs neither a `budget_cap` nor a `recurrence`
   authorizes one successful order, and a later cart is `INTENT_ALREADY_USED` (spec 0002). The shop shows what the
   signed intent allows right after signing.
5. Hard rules: `evaluate()` (spec 0002) with the intent's active ledger (captured **and reserved**, see §Reservation), **and the merchant's own facts** (#158): every
   cart line's SKU, title, attributes and unit price (value and currency) must equal what the merchant's catalog says for
   that SKU, exactly (no extra attributes; quantity is the shopper's and isn't compared) → `CATALOG_MISMATCH`. The agent
   proposes the cart and the merchant signs it, so without this the price was whatever the agent wrote: a real SKU at one
   cent was approved and captured. The two checks run together, so an agent that gets a fact wrong _and_ breaks a limit
   hears both (`CATALOG_MISMATCH` first). The agent only hears the code; the audit log gets a
   `checkout.catalog_mismatch` row naming each differing fact. The catalog is `CheckoutDeps.catalog` (an `AppDeps`
   option); by default it is the demo store (`packages/contracts/src/catalog.ts`, the same list the shop and the buyer
   agent use, and `catalogMismatches()` lives next to it so a test can guarantee every cart the shop proposes passes).
   A merchant with its own products supplies its own catalog. A REJECT here creates no order and no Cart Mandate.
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
If PayPal refuses to create the order (a 4xx), or the order is human present (`AUTHORIZE` charges nothing when it is
created): HTTP 502 `paypal_unavailable`, the order row is marked `PAYPAL_FAILED`, and nothing was charged.

An agent-alone `CAPTURE` charges the wallet when PayPal creates the order, so a lost answer (timeout, dropped
connection, 5xx) can follow a completed charge (#159). That order is marked `UNKNOWN_OUTCOME`, the answer is HTTP 502
`paypal_outcome_unknown`, and the message never says nothing was charged. The order id is the payment attempt's stable
identifier and PayPal's `PayPal-Request-Id`:

- A retry of the **same cart** (with a fresh Payment Mandate) reuses that order id, so PayPal returns the first result
  instead of charging again. The order then finishes as normal.
- Any **other** cart under the same intent is refused with HTTP 409 `payment_outcome_unknown` until the unknown order
  is settled, so a possible double charge is never stacked on a second purchase.
- A verified `PAYMENT.CAPTURE.COMPLETED` webhook whose `invoice_id` is that order also settles it.
- A step-up link whose charge ended unknown stays usable; opening it again confirms the same order.
  The order row (status `PENDING`) and its verdict are written before the PayPal call, so a crash never leaves a
  PayPal order we have no record of.

### Reservation (#155)

A signed `budget_cap` or `recurrence` is an aggregate limit, so it has to hold for orders that are **pending at the same
time**, not only for captured ones. Spending authority is reserved when the order is created, before PayPal is contacted:

- `Db.reserveOrder` creates the order and checks the aggregate rules in one step, under a per-intent lock
  (`pg_advisory_xact_lock` on the intent id). The check sees the ledger as it is inside that step, so two carts created
  together cannot both fit under a cap that only one fits. A refusal creates no order and no PayPal call: a `REJECT`
  verdict with `BUDGET_EXCEEDED` / `RECURRENCE_EXCEEDED`. The earlier check in step 5 only turns away the obvious case
  sooner.
- A reservation is the order itself (`orders.reserved_until` = the cart's expiry). `Db.activeLedger` counts, for an intent:
  captured orders (committed, they never stop counting), `UNKNOWN_OUTCOME` orders (they may have charged), and
  `PENDING` / `CREATED` / `APPROVED` / `AUTHORIZED` orders until `reserved_until`. A `VOIDED` or `PAYPAL_FAILED` order is
  released at once, and a pending one is released when its cart expires.
- Stage-two approval re-checks it (below), and step-up approval runs the rules with the same active ledger and then
  reserves through the same `placeOrder`.
- Dispute replays still use `mandateLedger(intent, asOfOrderId)`: captures that existed when the order was created.

### Unattended payment (#157)

`human_present` lives in the **agent-signed** Payment Mandate, so it is the agent's declaration. A payment with nobody
present moves money without the shopper's click, so it needs the **shopper's** signed permission: the optional
`constraints.unattended_payment` in the Intent Mandate (`packages/contracts`). It is absent unless the shopper ticked
"Let the agent pay alone" before signing.

- `unattended_payment: {}` allows any registered agent platform. `{ allowed_agent_platforms: [...] }` allows only those
  (the shop signs the buyer agent's platform), compared with the `agent_platform` in the Payment Mandate, which is
  already checked against the agent's registered platform (step 3).
- `human_present: false` without it, or from a platform it does not list, is a `REJECT` with
  `UNATTENDED_NOT_PERMITTED`, reported together with any other reasons. No order is created and the wallet is not
  charged. A shopper who is present needs nothing.
- A step-up link exists only for an intent that passed this check, so approving it needs nothing more.
- Not signed in: _which wallet_. The wallet is the one saved for the shopper's key (never shown to the browser), so
  the permission covers whatever wallet that key holds when the agent pays. Removing the wallet still stops it.

### Stage 2, before capture (human present only)

`POST /checkout/:id/approve { approval_jws }`, called by the buyer app from PayPal's `onApprove`. Built in
`apps/api/src/approve.ts`.

PayPal is not contacted until the approval has been checked (#160), so a caller who has no valid signature changes
nothing there and cannot void anyone's order. In order:

1. The countersignature (`CartApproval { order_id, cart_mandate_hash, approved_at }`, see spec 0001) verifies with
   **the key that signed the Intent Mandate** (and that key has not been retired as of the server's clock now: the
   approval is a new signature, so it is not judged by the `approved_at` the signer wrote) and names this order and the
   exact Cart Mandate we signed. Any failure
   (`SIGNATURE_INVALID`, `UNKNOWN_KEY`, `SCHEMA_INVALID`, `MANDATE_MISMATCH`) is **403 `approval_invalid`** with the
   reason codes, and nothing changes: no PayPal call, the order stays as it was and can still be approved properly.
   This includes a _genuine_ signature that names a different order or cart, so a shopper's real approval of one order
   cannot be replayed to void another.
2. The shopper's authority is still current (#161): the **intent** has started and hasn't expired and the cart hasn't
   expired, by the same `freshness` rules checkout ran (else `MANDATE_NOT_YET_VALID`, `MANDATE_EXPIRED`,
   `CART_EXPIRED`). The cart's expiry is the agent's choice, so before this check a cart could outlive the intent and a
   capture could succeed after the shopper's authority had expired. A genuine approval that arrives too late answers
   `{ status: "VOIDED", reasons }`: a hold we already took (an earlier capture failed) is voided so the shopper's
   money isn't left held; with no hold, nothing was held and PayPal is not called.
3. Authorize the PayPal order (PayPal refuses with `ORDER_NOT_APPROVED` → 409 `shopper_has_not_approved`), then
   capture → `{ status: "CAPTURED", capture_id }`.

_Changed from the first design, which authorized first and voided on a failed check ("so a failed check releases the
hold"). That let anyone who knew an order id void an approved order with a bad signature. Checking first means there
is no hold to release in the common failure._ A retry after completion returns the same outcome; a PayPal failure
answers 502 and leaves the order at its last state (`AUTHORIZED`), so a retry finishes the job with the same
idempotent capture request.

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
  current active ledger (captured and reserved), because budget may have been spent since the link was sent (409
  `stepup_no_longer_valid`). Then require a vaulted wallet (409 `no_vaulted_wallet`, and the link stays usable).
  Finally, sign the Cart Mandate and create the order with intent `CAPTURE` against the vault id, through the same
  `placeOrder` as checkout. The order's verdict is `STEP_UP`. A retry after success returns the same answer.
- **PayPal failing at approval** marks the step-up `FAILED` and answers 502. The link doesn't retry blind,
  because PayPal may have charged before the error reached us. The agent starts a new checkout.
- **Delivery:** no email provider is wired, and the link carries a secret token, so by default the API logs only the
  step-up's id, shopper and expiry, not the link. `LOG_STEPUP_LINKS=1` logs the full link (`step-up approval link`) for
  local development. The request log also redacts the token in `/stepup/<token>` paths (`apps/api/src/logging.ts`), which
  used to put it in the access log on every view and approval. `AppDeps.stepUp.send` is where an email sender plugs in. `BUYER_PUBLIC_URL` sets the link's origin (it must be the
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

**Paying alone (#36, #157).** The shop's "Let the agent pay alone from my saved wallet" checkbox (enabled once the shopper
has a Vault v3 wallet, spec 0004 §Vault) is in the intent form: ticked, the shopper signs `constraints.unattended_payment`
(limited to the buyer agent's platform) into the Intent Mandate. When the intent carries it, the shop sends
`human_present: false` to `/api/agent/checkout` and `/api/agent/choose`, which puts it in the Payment Mandate the agent
signs. `human_present` is the agent's own claim, so the merchant never acts on it alone (see "Unattended payment"
below). The merchant's checks are otherwise the same. An `APPROVE` charges the wallet at
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
| GET    | `/orders/:id/proof`                                          | Harsh   | the order's proof package (spec 0001 §Proof package, #177): the three signed mandates, their public keys, the PayPal references, the policy version and an integrity manifest, as a JSON download; operator token; 404 `order_not_found`, 409 `proof_unavailable`, 503 `merchant_not_configured` |
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
