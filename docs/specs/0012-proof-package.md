# 0012: Proof package, next revision

|               |                                         |
| ------------- | --------------------------------------- |
| **Status**    | Proposed                                |
| **Owner**     | @srshriv                                |
| **Reviewers** | @harshkumarsingh12, @hoursgotviral-dev  |
| **Milestone** | after submission (Nov 11)               |
| **Issues**    | #177 (first version built, #243)        |

## Context

The first version of the proof package is built (#243, schema `poi-proof/0.1`; spec 0001 §Proof package). `GET /orders/:id/proof`
exports one JSON file per order, and `pnpm proof:verify <file>` checks it offline: the three signed mandates, the keys that verify
them, the PayPal references, the policy version and an integrity manifest, with a pass or fail for each check.

This spec proposes the next revision, `poi-proof/0.2`. It exists because the first version has limits that the verifier's own
notes admit to:

- **Nobody vouches for the file.** The manifest is an unkeyed SHA-256, so it detects an edit, but a forger who rewrites the file
  recomputes it. Only the three mandate signatures carry the proof, and nothing says the merchant made the package.
- **The policy replay assumes no earlier purchase.** The package has no ledger, so the budget, recurrence and one-purchase rules
  (spec 0002) can't be checked for an order that was not the first under its intent.
- **Key retirement is a note, not a check.** The package carries `retired_at` but not when the merchant first saw the mandate,
  which is what spec 0001 judges a retired key by.
- **The shopper's approval is missing.** A human-present order carries a `CartApproval` countersignature; the package doesn't.
- **The worker's evidence bundle is still a partial copy** (`bundleJson`, `apps/worker/src/evidence.ts`): the intent's JWS and the
  decoded cart, with no Payment Mandate, keys or manifest, so the PDF, the bundle and the export can disagree.

## What stays as built

- The route `GET /orders/:id/proof` (operator token; 404 `order_not_found`; 409 `proof_unavailable`; 503
  `merchant_not_configured`), the package and verifier in `packages/proof`, and the command `pnpm proof:verify` in
  `scripts/proof`. The types stay in `@poi/proof`; nothing here needs a change to `packages/contracts`.
- **Mandates travel as the JWS that was signed.** Its payload already is the exact canonical bytes (`signMandate` signs the RFC 8785
  text), and the verifier recomputes the hash from it, so a separate `canonical` copy would add nothing a reader can't derive.
- The checks that exist today keep their ids: `package.schema`, `manifest.integrity`, `keys.kid_binding`, `sig.*`,
  `schema.mandates`, `bind.*`, `paypal.pointer`, `policy.replay`, `policy.unattended`.
- Private data stays out: no shopper id, vault id, wallet, email, buyer note or plaintext address (the address only as the hash that
  was signed). That is the same rule as the LLM input (SECURITY.md).

## Design

Additions for `poi-proof/0.2`. The verifier keeps reading `0.1` files, and reports each check that needs a `0.2` field as
`not_checked`, never as passed.

| Addition | Section | From | New or changed check |
| --- | --- | --- | --- |
| Merchant-signed manifest | `manifest_jws`: the merchant's ES256 signature over the manifest's canonical bytes | merchant signing key | `manifest.integrity` also verifies `manifest_jws`; new `merchant_key` |
| Recorded decision | `policy`: `evaluated_at`, the `ledger` it was given, `outcome`, `reasons` | the stage-1 verdict | `policy.replay` replays with the recorded ledger and must give the recorded outcome and reasons |
| Key history | `keys[].first_seen_at` | `mandates.created_at` | new `key_validity`: `keyValidAt` (spec 0001) for each key at the time we recorded, not a date the signer wrote |
| Shopper approval | `mandates.cart_approval`: `{ jws }`, when the shopper countersigned | human present: the `paypal.capture` audit row (`approvalJws`); step-up: not stored today (see Open questions) | new `cart_approval`: verifies with the intent's key and names this order and cart hash |
| Order amount | `references.amount` (Money) | `orders` | `bind.cart_intent` also checks it equals the cart total |

- **`merchant_key` is a pin, not a pass.** The verifier takes `trustedMerchantKeys` (the person verifying brings the key). A
  `manifest_jws` that verifies against the file's own key shows only that the file is self-consistent. Without a pin the check
  reports `not_checked`, with the reason.
- **One package everywhere.** The worker's evidence bundle embeds the same package for a dispute's order instead of its own copy,
  so the PDF, the bundle and the export can't disagree.
- **The verifier's output** keeps `{ ok, checks, notes }` and adds `not_checked` as a third result alongside passed and failed. `ok`
  is true only when no check failed; a `not_checked` check is shown and does not hide a failure.
- **Distribution of the merchant's key:** `GET /.well-known/poi-merchant-keys` (a JWKS with the current and retired keys), so a
  verifier can pin it from a second source. See Open questions.

## Interfaces

- `@poi/proof`: `buildProofPackage` takes `ledger`, `outcome`, `first_seen_at` and the merchant's manifest signature;
  `verifyProofPackage(file, { trustedMerchantKeys? })` returns the report above.
- `GET /orders/:id/proof`: unchanged route and errors; the package gains the sections in the table.
- `pnpm proof:verify <file> [--merchant-key <jwk file>]`: exit 0 when no check failed, 1 when one did, 2 for an unreadable file.
- `packages/db`: nothing new for the sections above except reading the stage-1 verdict's ledger; a step-up approval needs its JWS
  stored (Open questions).

## Acceptance criteria

Each starts as a `ledger()` entry unless marked done.

1. A package exported for a captured order verifies with no check failed. _(done in 0.1, #243)_
2. Changing one byte in any section fails `manifest.integrity`; changing a signed payload fails its signature check too, including
   when the file is re-sealed. _(done in 0.1, #243)_
3. Replacing a shopper key with another valid P-256 key fails `keys.kid_binding`. _(done in 0.1, #243)_
4. A Payment Mandate that commits to another cart or intent fails `bind.*`. _(done in 0.1, #243)_
5. A forger who rewrites the file and re-seals the manifest still fails, now also on `manifest_jws` (the forger has no merchant key).
6. A package whose recorded `outcome` or `reasons` disagree with the replay fails `policy.replay`; an order that was the second
   purchase under a one-purchase intent fails with `INTENT_ALREADY_USED` instead of passing for want of a ledger.
7. A key retired before the time we recorded fails `key_validity`.
8. Without a pinned merchant key, `merchant_key` is `not_checked` and the report says why; with the wrong key it fails.
9. A human-present order's package carries a `cart_approval` that verifies, and a tampered one fails.
10. The worker's evidence bundle for a dispute embeds the package for that order unchanged.
11. The package still holds no vault id, email, buyer note, shopper id or plaintext address. _(partly done in 0.1: the API test checks
    for the shopper id and any vault text)_

## Out of scope

A public, unauthenticated download link for shoppers; PayPal-side verification of the capture; signing a package with anything
other than the merchant key; changes to the PDF's layout.

## Open questions

- How does a verifier get the merchant's key without trusting the package? Proposed: `GET /.well-known/poi-merchant-keys` and a
  documented pin. Owner @harshkumarsingh12, answer by Nov 18.
- Should `ok` be false when no merchant key is pinned? The original proposal said yes. As built, `ok` means no check failed, and
  a missing pin is a note. Default: keep that, and have the CLI exit 3 (all clear, unpinned) so a script can tell the cases
  apart; `--merchant-key` makes the pin required. Owner @srshriv, by Nov 18.
- A step-up approval's `CartApproval` JWS isn't stored: the `stepup.approved` audit row keeps only the order id and the cart hash
  (`apps/api/src/stepup.ts`). Proposed: store the JWS there too, as stage 2 already does. Owner @harshkumarsingh12 with
  @srshriv, by Nov 18.
- Should the evidence PDF print the package's manifest hash, so a reader can match the PDF to the file? Owner @hoursgotviral-dev,
  by Nov 18.

_Answered since the first proposal:_ the policy version is `POLICY_VERSION` in `packages/policy-engine` (`poi-policy/0.1`); the
command lives in `scripts/proof` and the verifier in `packages/proof`.
