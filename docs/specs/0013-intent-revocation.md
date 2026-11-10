# 0013: Revoking a signed intent

|               |                                |
| ------------- | ------------------------------ |
| **Status**    | Done (as built below)          |
| **Owner**     | @srshriv                       |
| **Reviewers** | @harshkumarsingh12             |
| **Milestone** | M4 (built Nov 10)              |
| **Issues**    | #176                           |

## Context

A shopper could see what they authorized (#176's card, #242) but couldn't stop it: a signed intent stayed good until it
expired. #176 asks for a revoke control and a receipt of what authority remains. After a revocation the merchant must refuse
anything new under that intent, which needs a new signed type, a reason code, an API route, stored state and a check on every
path that spends an intent. Built Nov 10 (§As built). It extends spec 0001 (mandates and keys) and spec 0003 (checkout and
verification).

## Design

### The signed revocation (spec 0001)

- **Who can revoke:** only the holder of the key that signed the intent. The shopper signs an
  `IntentRevocation { purpose: "intent.revoke", mandate_id, intent_mandate_hash, issued_at }` as a compact JWS (ES256,
  header `kid`) with that key, in the same form as `VaultProof` and `StepUpListProof`. It names the intent by id **and**
  hash, so a revocation can't be replayed against another intent, or against a different payload under the same id.
- **Fresh:** `issued_at` must be within 5 minutes of the merchant's clock (60 s of skew), like the vault proofs. A leaked
  revocation can't be kept and used later, although using one only ever removes authority.
- **Retired keys can still revoke:** revoking only takes authority away, so a stolen key gains nothing by it, and a
  shopper whose key was retired can still stop their intents. This is the one place a retired key's new signature is
  accepted.
- **Final:** there is no un-revoke. To buy again, the shopper signs a new intent.
- **What it doesn't touch:** purchases made before `revoked_at` stay valid, and so do the evidence (spec 0005) and the
  proof package (spec 0001 §Proof package) for them. Revoking an intent doesn't retire the key or remove the saved wallet;
  those are separate controls.

### The route

`POST /intents/:mandate_id/revoke { revocation_jws }` → `{ mandate_id, revoked_at }`. Public and rate-limited like `/vault/*`
(`keys`, 10 per minute per IP), with a 4 KB body limit. In order:

1. Find the intent the revocation names: the `mandates` row whose `hash` is its `intent_mandate_hash`, with
   `kind = 'intent'` and this `mandate_id` (a `mandate_id` alone isn't unique; the hash is the key). None →
   404 `intent_not_found`.
2. Verify the JWS with that row's `kid`, the key that signed the intent, retired or not. The header `kid` must be that
   key, and `issued_at` must be fresh. Any failure (`SIGNATURE_INVALID`, `UNKNOWN_KEY`, `SCHEMA_INVALID`,
   `MANDATE_MISMATCH`) → 403 `revocation_invalid` with the reason codes, and nothing changes.
3. Set `revoked_at` (the merchant's clock now) if it is unset; first revocation wins, like key retirement. A repeat
   answers 200 with the first `revoked_at`.

### Storage (`packages/db`)

A nullable `revoked_at` on that intent's `mandates` row, written once. An `audit_log` row `intent.revoked` holds the exact
canonical bytes and signature that were verified (SECURITY.md, Audit integrity), written before the response.

### Enforcement (spec 0003)

Every path that spends an intent checks `revoked_at` against the merchant's clock and adds `MANDATE_REVOKED`, reported with
any other reasons:

| Path | Revoked intent |
| --- | --- |
| Stage 1 `POST /checkout` (shopper present or agent alone) | `REJECT`; no order, no Cart Mandate, no PayPal call |
| Stage 2 `POST /checkout/:id/approve` | re-checked with `freshness` (#161) → `{ status: "VOIDED", reasons }`; a hold is voided, nothing captured |
| Step-ups (`/stepup/approve`, `/stepups/:id/approve`) | refused, nothing created or charged; `/stepups/pending` stops listing that intent's carts |
| Reservations (spec 0003 §Reservation) | pending orders under the intent release what they set aside |

Orders captured before `revoked_at` are unchanged, and disputes about them are judged as before.

## Interfaces

- `packages/contracts`: `IntentRevocation` (zod), added to `ShopperProof`; `ReasonCode` `MANDATE_REVOKED`, for the API,
  the dashboard chips and the evidence PDF. **Contracts change:** Sristee and Harsh, announced in the team chat before the
  implementing PR merges.
- `POST /intents/:mandate_id/revoke`: `{ revocation_jws }` → 200 `{ mandate_id, revoked_at }`; 404 `intent_not_found`;
  403 `revocation_invalid` with `reasons`; 429 `rate_limited`.
- `packages/db`: `mandates.revoked_at timestamptz null` (migration); `intent.revoked` audit rows.

Who would build what: the contracts and the buyer app's control, @srshriv; the route, @srshriv and @harshkumarsingh12
(`apps/api`); the migration and audit row, @harshkumarsingh12 (`packages/db`); `MANDATE_REVOKED` in the dashboard and the
evidence PDF, @hoursgotviral-dev.

## Receipt of remaining authority (#176)

`POST /intents/:mandate_id/receipt { proof_jws }` → `IntentReceipt` (`packages/contracts`). The proof is an
`IntentReceiptProof { purpose: "intent.receipt", intent_mandate_hash, issued_at }` signed by the key that signed the intent
(in good standing, fresh, like the vault proofs). Another shopper's key, or an intent the merchant never saw, answers 404
`intent_not_found`, so the route reveals nothing about intents that aren't the caller's. Rate-limited like `/checkout`.

Every figure is the merchant's own, by the rules checkout enforces (`receiptFor`, `apps/api/src/intents.ts`):

- `spent`: captured orders (`Db.mandateLedger`). `held`: what pending, unknown-outcome and pending-capture orders set aside
  (`Db.activeLedger` minus `spent`).
- `remaining.total`: what is left of a signed `budget_cap` against everything spent or held (`null`: no budget).
  `remaining.purchases`: a signed `recurrence` counted over its window ending now; one by default until a purchase is
  made or held (#156); `null` for a budget alone. `remaining.per_purchase`: `amount_max`, lowered by the budget left.
- `state`: `REVOKED`, `EXPIRED`, `USED_UP`, `NOT_YET_VALID` or `ACTIVE`, in that order of precedence. Revoked, expired and used
  up leave every remaining figure at zero. The shop says "in use" rather than "used up" when only a waiting order uses it.
- `purchases`: each order under the intent with its status, total and capture time.

## As built

- **Contracts:** `IntentRevocation` and `IntentReceiptProof` (both in `ShopperProof`), `IntentRevokeRequest` /
  `IntentRevokeResponse`, `IntentReceiptRequest` / `IntentReceipt`, and `ReasonCode` `MANDATE_REVOKED`.
- **Database:** migration `0008_intent_revocation.sql` adds `mandates.revoked_at` (intent rows only, by a check constraint).
  `Db.revokeIntent(hash, at)` sets it once under the same per-intent advisory lock `Db.reserveOrder` takes, and
  `reserveOrder` refuses with `MANDATE_REVOKED` once it is set: a reservation and a revocation can't cross. `Db.ordersForIntent`
  feeds the receipt. `listPendingStepUps` leaves out a revoked intent's carts.
- **API** (`apps/api/src/intents.ts`, `routes/intents.ts`): the revoke route as designed above (rate-limited like `/vault/*`),
  and the receipt route. Enforcement: checkout adds `MANDATE_REVOKED` to the hard-rule reasons; stage-two approval voids with it
  (`staleReasons`); step-up approval refuses with 409 `stepup_no_longer_valid` and marks the step-up `REJECTED`. Found while
  building this: a step-up whose reservation refused at the last moment (a budget spent, or now a revocation) was marked
  `APPROVED` with no order. It is now `REJECTED` with the reservation's reasons.
- **Shop** (`apps/buyer/app/shop/IntentControls.tsx`, `src/intent-controls.ts`): under the authorization card, **What's left**
  reads the receipt after signing and after every checkout, approval and held-cart payment (only the latest answer is shown), and
  **Revoke this intent** asks once ("You can't take this back"), signs the revocation and drops the intent from the page. An
  intent the merchant never received is simply dropped, since nobody else holds it. The shop's proxies are
  `POST /api/intents/:id/revoke` and `/receipt`.
- **Reason text:** the shop (`REASON_TEXT`) and the Studio planner name `MANDATE_REVOKED`. The dashboard and the evidence PDF
  show reason codes as they are, so no change was needed there.

## Acceptance criteria

1. A revocation signed by another key, or naming another intent or hash, changes nothing (403 `revocation_invalid`, or 404
   for a hash the merchant has no intent under). _(done: `apps/api/src/intents.test.ts`)_
2. A stale `issued_at` is refused. _(done)_
3. A repeat revocation answers 200 with the first `revoked_at`. _(done, also against Postgres: `packages/db/src/db.test.ts`)_
4. Each path in the enforcement table refuses a revoked intent with `MANDATE_REVOKED`, with nothing charged: checkout, stage-two
   approval, step-up listing and approval, and a revocation landing between checkout's check and the reservation. _(done)_
5. A purchase captured before the revocation is unaffected, and its proof package still verifies. _(done)_
6. A retired key can still revoke an intent it signed. _(done)_
7. The `intent.revoked` audit row holds the exact canonical bytes and signature that were verified. _(done)_
8. The receipt shows spent, held and remaining authority by the enforced rules, only to the intent's own key. _(done:
   `intents.test.ts`, `apps/buyer/src/intent-controls.test.ts`; in Chrome against a local stack: unseen, active after a refusal,
   $74 spent and none left after a purchase, $74 set aside with an order waiting, revoke and its confirmation)_

## Out of scope

Un-revoking; an operator revoking a shopper's intent.

## Decisions (were open questions; the proposed defaults were taken)

- A revocation that arrives while a capture is in flight: the check runs right before the PayPal capture call, so a capture
  already sent is not undone. Accepted; the order shows on the receipt.
- An operator revoking an intent (fraud): no. The operator retires the key as of an earlier date instead (spec 0001), which
  already voids every intent first seen after that date.
- A proof package for an order under a revoked intent: not changed yet. The order was captured before the revocation, so the
  package still verifies; a note saying the intent was later revoked is a follow-up.
