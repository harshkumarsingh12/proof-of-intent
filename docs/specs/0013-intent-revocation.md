# 0013: Revoking a signed intent

|               |                                |
| ------------- | ------------------------------ |
| **Status**    | Proposed                       |
| **Owner**     | @srshriv                       |
| **Reviewers** | @harshkumarsingh12             |
| **Milestone** | after submission (Nov 11)      |
| **Issues**    | #176                           |

## Context

A shopper can see what they authorized (#176's card, #242) but can't stop it: a signed intent stays good until it expires.
#176 asks for a revoke control. After it, the merchant must refuse anything new under that intent. That needs a new signed
type, a reason code, an API route, stored state and a check on every path that spends an intent, so it starts here. Nothing in
this spec is built. It extends spec 0001 (mandates and keys) and spec 0003 (checkout and verification).

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
| Step-ups (`/stepup/:token/approve`, `/stepups/:id/approve`) | refused, nothing created or charged; `/stepups/pending` stops listing that intent's carts |
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

## Acceptance criteria

Each starts as a `ledger()` entry.

1. A revocation signed by another key, or naming another intent or hash, changes nothing (403 `revocation_invalid`).
2. A stale `issued_at` is refused.
3. A repeat revocation answers 200 with the first `revoked_at`.
4. Each path in the enforcement table refuses a revoked intent with `MANDATE_REVOKED`, with nothing charged.
5. A purchase captured before the revocation is unaffected, and its proof package still verifies.
6. A retired key can still revoke an intent it signed.
7. The `intent.revoked` audit row holds the exact canonical bytes and signature that were verified.

## Out of scope

The receipt of remaining authority (#176's third part), which needs its own read route; un-revoking; an operator revoking a
shopper's intent.

## Open questions

- A revocation that arrives while a capture is in flight: the check runs right before the PayPal capture call, so a
  capture already sent is not undone. Default: accept that, and show the order on the receipt. Owner @srshriv with
  @harshkumarsingh12, by Nov 18.
- An operator revoking an intent (fraud): default no. The operator retires the key as of an earlier date instead
  (spec 0001), which already voids every intent first seen after that date. Owner @harshkumarsingh12, by Nov 18.
- Should a proof package (spec 0001 §Proof package) for an order under a revoked intent say so? Default: yes, as a note
  that doesn't fail any check, since the order was captured before the revocation. Owner @srshriv, by Nov 18.
