# 0001: Mandate model and signatures

| | |
|---|---|
| **Status** | Proposed |
| **Owner** | @srshriv |
| **Reviewers** | @harshkumarsingh12 |
| **Milestone** | M0 (model), M1 (browser signing, key registry) |
| **Code** | `packages/contracts`, `packages/mandates`, `apps/buyer/src/signing.ts` |

## Context

Everything in Proof of Intent rests on a signed record of what the shopper asked for. It has to be verifiable by
anyone, reproducible byte for byte, and close enough to AP2 that an AP2-speaking agent can send it unchanged.
Project document §1, §5.

## Design

Three mandates, AP2 v0.1 field names for the core, a `constraints` extension modeled on Mastercard Verifiable
Intent, compact JWS signatures (ES256).

| Mandate | Signed by | Key |
|---|---|---|
| Intent | shopper | ECDSA P-256, generated in the browser with WebCrypto, non-extractable, kept in IndexedDB |
| Cart | merchant | `MERCHANT_SIGNING_KEY` from `pnpm keys:gen`; issued only after hard rules pass |
| Payment | buyer agent | registered agent key (KYA-lite: key, platform, owner) |

- **Canonicalization:** RFC 8785 (JCS). `mandate_hash = SHA-256(JCS(payload))`, lowercase hex.
- **Signature:** the JWS payload is the canonical bytes; header `{ alg: "ES256", kid }`.
- **Verification output** includes the exact canonical string, which is what the audit log stores.
- **Key registry:** public keys by `kid`, with `retired_at`. A retired key still verifies mandates created before
  it was retired; new mandates with it are rejected.
- **On PayPal:** `custom_id = poi:<mandate_id>:<first 16 hex of mandate_hash>` (57 characters; cap is 127).
- Human-present approval adds a shopper countersignature over the cart hash.

## Interfaces

Types (in `packages/contracts/src/index.ts`, already merged): `IntentMandate`, `Constraints`, `CartMandate`,
`CartLine`, `PaymentMandate`, `Money`, `SCHEMA_VERSION = "poi/0.1"`.

Functions (`packages/mandates`, already merged): `canonicalJson`, `mandateHash`, `customId`, `signMandate`,
`verifyMandate(jws, resolveKey) → { ok, kid, payload, canonical } | { ok: false, reason: "UNKNOWN_KEY" | "SIGNATURE_INVALID" }`,
`generateSigningKeyPair`.

To add: `createKeyRegistry()` with `register(kid, jwk, owner)`, `retire(kid, at)`, `resolve(kid, mandateCreatedAt)`.

## Acceptance criteria

1. Key order does not change canonical bytes or the hash. *(test, done)*
2. `customId` is 57 characters for a UUID mandate id. *(test, done)*
3. Sign/verify round trip returns the exact canonical payload. *(test, done)*
4. A tampered payload, a wrong key and an unknown `kid` are each rejected with the right reason. *(tests, done)*
5. A retired key verifies mandates created before `retired_at` and rejects newer ones. *(ledger M1 @srshriv)*
6. The browser key is ECDSA P-256 and non-extractable. *(ledger M1 @srshriv)*
7. A mandate signed in the browser verifies on the server. *(M1, Playwright smoke)*

## Out of scope

Passkeys/WebAuthn (the signing interface is isolated so it can be swapped later); network trust registries;
AP2 or Verifiable Intent certification.

## Open questions

- Store the shopper's public key bound to the vault id or the shopper id? Default: shopper id, with the vault id
  linked on the shopper row. @srshriv, Oct 31.
