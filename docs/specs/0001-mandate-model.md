# 0001: Mandate model and signatures

|               |                                                                        |
| ------------- | ---------------------------------------------------------------------- |
| **Status**    | Done                                                                   |
| **Owner**     | @srshriv                                                               |
| **Reviewers** | @harshkumarsingh12                                                     |
| **Milestone** | M0 (model), M1 (browser signing, key registry)                         |
| **Code**      | `packages/contracts`, `packages/mandates`, `packages/proof`, `apps/buyer/src/signing.ts` |

## Context

Everything in Proof of Intent rests on a signed record of what the shopper asked for. It has to be verifiable by
anyone, reproducible byte for byte, and close enough to AP2 that an AP2-speaking agent can send it unchanged.
Project document §1, §5.

## Design

Three mandates, AP2 v0.1 field names for the core, a `constraints` extension modeled on Mastercard Verifiable
Intent, compact JWS signatures (ES256).

| Mandate | Signed by   | Key                                                                                      |
| ------- | ----------- | ---------------------------------------------------------------------------------------- |
| Intent  | shopper     | ECDSA P-256, generated in the browser with WebCrypto, non-extractable, kept in IndexedDB |
| Cart    | merchant    | `MERCHANT_SIGNING_KEY` from `pnpm keys:gen`; issued only after hard rules pass           |
| Payment | buyer agent | registered agent key (KYA-lite: key, platform, owner)                                    |

- **What the shopper signs about who pays (#157):** `constraints.unattended_payment` (optional) is the shopper's
  permission for the agent to pay with their saved wallet while they are not present, optionally limited to
  `allowed_agent_platforms`. The Payment Mandate's `human_present` is only the agent's declaration and is never enough on
  its own (spec 0003 §Unattended payment).
- **Canonicalization:** RFC 8785 (JCS). `mandate_hash = SHA-256(JCS(payload))`, lowercase hex.
- **Signature:** the JWS payload is the canonical bytes; header `{ alg: "ES256", kid }`.
- **Verification output** includes the exact canonical string, which is what the audit log stores.
- **Key registry:** public keys by `kid`, with `retired_at`. A retired key still verifies mandates created before
  it was retired; new mandates with it are rejected. **"Created" is never the date the signer wrote** (`created_at`,
  `timestamp`): a retired or stolen key can sign any date it likes, so a fresh mandate dated before the retirement used
  to pass (#162). It is judged by the merchant's own clock:
  - a **Payment Mandate** is per attempt, so its agent key must be in good standing **now**;
  - an **Intent Mandate** counts from when the merchant **first saw** it (`mandates.created_at`, set on first save and
    never changed). One seen before the key was retired stays usable (it was authorized while the key was good);
    one never seen before counts from now, so a retired key cannot introduce a new intent, whatever date it carries;
  - retiring a key **as of an earlier date** voids every intent first seen after that date, which is how an operator
    reacts to a key stolen some time ago;
  - the shopper's approval countersignature and vault and step-up proofs use now (specs 0003 and 0004).
  Verifying an *old* mandate for evidence, long afterwards, still uses the date it was accepted: that is the one place
  the rule is applied to a past time.
- **On PayPal:** `custom_id = poi:<mandate_id>:<first 16 hex of mandate_hash>` (57 characters; cap is 127).
- Human-present approval adds a shopper countersignature over the cart hash: a compact JWS by the **same key as the
  Intent Mandate** over `CartApproval { order_id, cart_mandate_hash, approved_at }` (`packages/contracts`). The buyer
  app signs it in PayPal's `onApprove` and posts it to `/checkout/:id/approve` (spec 0003 stage 2).

## Interfaces

Types (in `packages/contracts/src/index.ts`, already merged): `IntentMandate`, `Constraints`, `CartMandate`,
`CartLine`, `PaymentMandate`, `Money`, `SCHEMA_VERSION = "poi/0.1"`.

Functions (`packages/mandates`, already merged): `canonicalJson`, `mandateHash`, `customId`, `signMandate`,
`verifyMandate(jws, resolveKey) → { ok, kid, payload, canonical } | { ok: false, reason: "UNKNOWN_KEY" | "SIGNATURE_INVALID" }`,
`generateSigningKeyPair`.

Key registry (`packages/mandates`): `createKeyRegistry()` with `register(kid, jwk, owner)`, `retire(kid, at)`,
`resolve(kid, mandateCreatedAt)`; `keyValidAt(key, createdAt)` is the one retirement rule (checkout uses it too, with a time *we* observed, never one the
signer wrote);
`publicEs256Jwk(input)` accepts P-256 public keys only; `keyIdFor("shp" | "agt", jwk)` derives the `kid` from the
key's RFC 7638 thumbprint, so the same key always has the same id. Over HTTP: `/keys/*` in spec 0003, stored in
`shopper_keys` / `agent_keys`.

## Proof package (#177)

The core promise is that a signed record backs each purchase. The proof package makes that inspectable by someone with no access
to the merchant's server: one JSON file per order, and a verifier that says which checks passed. `packages/proof`
(`buildProofPackage`, `verifyProofPackage`), served by `GET /orders/:id/proof` (spec 0003) and checked with
`pnpm proof:verify <file>` (`scripts/proof/verify.ts`).

- **What it holds** (schema `poi-proof/0.1`): the three signed mandates as the compact JWS that was signed (the shopper's Intent,
  the buyer agent's Payment, the merchant's Cart) with each one's hash and `kid`; the public keys that verify them (role,
  `kid`, P-256 public JWK, `platform` for an agent key, `retired_at` if retired); the references (order id, merchant id, the
  `custom_id` pointer, and the PayPal order, authorization and capture ids the order has); the policy version
  (`POLICY_VERSION`, `packages/policy-engine`); and an integrity manifest (a SHA-256 over each section and over those hashes).
  Nothing in it is secret, and it carries no shopper id, wallet or private key.
- **What the verifier checks**, offline, from the file alone: the file is a package; the manifest matches; each shopper and agent
  `kid` is the thumbprint of its key; each of the three signatures verifies with a key *of the right role*, and the package's
  declared hash and `kid` for it are right; the payloads are well-formed mandates; the Payment commits to this Intent and this
  Cart, the Cart points at this Intent for this merchant, and the Payment names the key that signed it; the PayPal pointer
  (`poi:<intent id>:<16 hex>`) names this intent; the hard rules held at the payment's own timestamp (spec 0002); and, when the
  payment says nobody was present, the intent carried the shopper's signed permission to pay alone (#157). A check whose
  prerequisite failed says "not checked" and fails: a pass is never claimed for something not looked at.
- **What a pass does not show**, and the report says so every time: the keys are the file's own, so a valid signature shows the holder
  of that key signed and not who holds it (compare each `kid` with the merchant's registry); the PayPal references are the
  merchant's record (look the capture up in PayPal); the manifest detects a changed file but is not a signature, since a forger
  can recompute it, so the signatures are what carry the proof; the policy replay assumes no earlier purchase under the intent
  (the package has no ledger), and a package made under another `POLICY_VERSION` is flagged; a retired key is flagged, because
  whether the mandate predates the retirement depends on when the merchant first saw it, which the package does not carry.
- **The route** is merchant data, so it needs the operator token like every other read (#163). It is read-only. It answers 404 for an
  unknown order, and 409 `proof_unavailable` naming what is missing when an order has no stored mandate, when the cart was signed
  by a merchant key the server no longer holds, or when a registered key is gone, rather than building a partial package. The
  Payment Mandate is found by the cart it committed to (`findPaymentMandateForCart`), the earliest one when the same cart was
  paid for again (#159). The dashboard offers the download on a live dispute's mandate card.
- **Not in the package:** the shopper's approval countersignature (`CartApproval`), the audit log and the PayPal webhook events.

## Acceptance criteria

1. Key order does not change canonical bytes or the hash. _(test, done)_
2. `customId` is 57 characters for a UUID mandate id. _(test, done)_
3. Sign/verify round trip returns the exact canonical payload. _(test, done)_
4. A tampered payload, a wrong key and an unknown `kid` are each rejected with the right reason. _(tests, done)_
5. A retired key verifies mandates created before `retired_at` and rejects newer ones. _(test, done)_
5a. A retired key cannot authorize anything new by dating it earlier: a payment from a retired agent key is refused
    whatever its timestamp; a new intent from a retired shopper key is refused whatever its `created_at`; an intent seen
    before the retirement stays usable; retiring as of an earlier date voids what was first seen after it. _(tests, done,
    #162: `apps/api/src/checkout.test.ts`, `packages/db/src/db.test.ts`)_
6. The browser key is ECDSA P-256 and non-extractable. _(done)_
7. A mandate signed in the browser verifies on the server. _(done: `apps/buyer/src/buyer.test.ts` runs the page's
   WebCrypto code against `verifyMandate`; `pnpm smoke:shop` drives the page itself and checks the stored key is non-extractable)_

8. A proof package for a captured order verifies on its own, with every check passed, and an edit to any part of it, or a
   signature, key, binding or pointer that does not hold, fails the check that covers it, including when the forger re-seals
   the manifest. _(done, #177: `packages/proof/src/proof.test.ts`, `apps/api/src/proof.test.ts`)_
9. `pnpm proof:verify` exits 0 for a genuine package, 1 for one that fails a check and 2 for a file it cannot read, and prints what
   a pass does not show. _(done, #177: `apps/api/src/proof.test.ts`)_

## As built (apps/buyer)

- `src/signing.ts`: WebCrypto only. `generateKey` with `extractable: false`; the compact JWS is built by hand
  (ES256's raw r‖s signature is what WebCrypto returns), payload = `canonicalize` bytes.
- `src/key-store.ts`: the `CryptoKey` objects themselves in IndexedDB, with the `kid` and shopper id from
  `POST /keys/shopper`. "Use a new key" deletes it; mandates it already signed stay valid.
- **The limits form.** The price cap is always set (a blank or invalid price is refused at signing). Item and color can be left
  open: the dropdowns' first choices, **Anything** and **Any color**, sign no `attributes.category` or `attributes.color`, and the
  policy engine then checks only the limits that were signed. Picking a category changes only the category; the four demo presets
  load, whole, from the **Quick start** buttons, so their wording (which the merchant's recorded checks are keyed on) is unchanged.
- Intents start 5 minutes in the past (`valid_from`, `created_at`) so a browser clock a little ahead of the server
  doesn't produce `MANDATE_NOT_YET_VALID`.
- The countersignature hashes the payload of the `cart_mandate_jws` the merchant returned, so the shopper approves
  the exact bytes the merchant signed.

## Out of scope

Passkeys/WebAuthn (the signing interface is isolated so it can be swapped later); network trust registries;
AP2 or Verifiable Intent certification.
Revoking an intent before it expires, and the receipt of what authority is left: spec 0013 (#176).

## Open questions

- Store the shopper's public key bound to the vault id or the shopper id? Default: shopper id, with the vault id
  linked on the shopper row. @srshriv, Oct 31.
