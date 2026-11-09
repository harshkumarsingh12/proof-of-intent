# 0012: Independently verifiable proof package

|               |                                         |
| ------------- | --------------------------------------- |
| **Status**    | Proposed                                |
| **Owner**     | @srshriv                                |
| **Reviewers** | @harshkumarsingh12, @hoursgotviral-dev  |
| **Milestone** | after submission (Nov 11)               |
| **Issues**    | #177                                    |

## Context

The promise of Proof of Intent is that a signed record backs every purchase. Today only we can check that record: the
evidence PDF (spec 0005) is a rendering, and the JSON bundle the worker builds next to it (`bundleJson` in
`apps/worker/src/evidence.ts`, stored as `disputes.evidence_bundle`) holds the intent's JWS but only the decoded cart, no
Payment Mandate, no public keys and no integrity manifest. Nobody outside can re-run the checks. A package someone else can
verify with their own tools makes the promise tangible to merchants, card networks and judges.

## Design

One JSON file per order, `poi-proof-<order_id>.json`, built from data we already store and verify. Nothing in it is
re-serialized: every signed object travels as the exact canonical bytes and JWS that were verified (SECURITY.md, Audit
integrity).

| Section | Contents | From |
| --- | --- | --- |
| `format` | `"poi-proof/1"` | constant |
| `order` | `order_id`, `paypal_order_id`, `capture_id`, `amount` (Money), `custom_id`, `captured_at` | `orders` |
| `mandates.intent`, `.cart`, `.payment` | `{ jws, canonical, hash }` each | `mandates` (`canonical`, `jws`, `hash`) |
| `mandates.cart_approval` | `{ jws, canonical }`, when the shopper countersigned (human present or a step-up) | human present: the `paypal.capture` audit row (`approvalJws`); step-up: not stored today (see Open questions) |
| `keys` | `{ kid, role: "shopper" \| "agent" \| "merchant", public_jwk, first_seen_at, retired_at?, platform? }` | `shopper_keys`, `agent_keys`, the merchant key |
| `policy` | `engine` and `version`, `evaluated_at`, the `ledger` it was given, `outcome`, `reasons` | the stage-1 verdict |
| `manifest` | `{ canonicalization: "RFC 8785", algorithm: "sha256", entries: [{ path, sha256 }] }`, one entry per section above | computed |
| `manifest_jws` | the merchant's ES256 signature over the manifest's canonical bytes | merchant signing key |

- **Built by the API, used by the worker.** `GET /orders/:id/proof` assembles the package (operator token, like other
  merchant reads). The worker's evidence bundle embeds the same package for a dispute instead of its own partial copy, so
  the PDF, the bundle and the export can't disagree.
- **Private data stays out:** the address only as its hash, as signed; no vault id, email or buyer note. That's the same
  rule as the LLM input (SECURITY.md).
- **The verifier** is a pure function in `packages/mandates`, `verifyProofPackage(pkg, { trustedMerchantKeys? })`, plus a
  small CLI that prints its result. It needs no database and no network.

**What the verifier checks**, in order. Each check is reported, and a failed check doesn't stop the later ones:

| Id | Check | Passes when |
| --- | --- | --- |
| `manifest` | integrity | every section's SHA-256 over RFC 8785 matches its manifest entry, and `manifest_jws` verifies with the merchant key |
| `merchant_key` | the merchant key is the merchant's | it equals one of `trustedMerchantKeys` (pinned by the person verifying); without a pin it reports "not pinned" rather than passing |
| `key_ids` | keys weren't swapped | each shopper and agent `kid` is `shp_` / `agt_` plus the RFC 7638 thumbprint of its `public_jwk` (spec 0001) |
| `signatures` | every mandate is genuine | each JWS verifies with the key its header names, its payload is exactly `canonical`, and `hash` = SHA-256(`canonical`) |
| `key_validity` | keys were good at the time | `keyValidAt` (spec 0001) for each key at the time we recorded, not a date the signer wrote |
| `bindings` | the three mandates belong together | the Payment Mandate's `intent_mandate_hash` and `cart_mandate_hash`, the cart's `intent_mandate_id`, `custom_id` = `poi:<mandate_id>:<first 16 hex>`, and `order.amount` = the cart total |
| `cart_approval` | the shopper approved this cart (when present) | the countersignature verifies with the intent's key and names this order and cart hash |
| `policy` | the decision replays | `evaluate()` on the packaged intent, cart, `ledger` and `evaluated_at` gives the same `outcome` and `reasons`; a different engine version is reported with the result |
| `payment` | the money moved | **not checkable offline**: reported as "claimed by the merchant; confirm `capture_id` with PayPal" |

**Output:** `{ format: "poi-proof-verification/1", ok, checks: [{ id, passed: true | false | "not_checked", explanation }] }`.
`ok` is true only when every check passed, except `payment`, which is never `true` offline. Each explanation is a
sentence a person can read (for example "The intent was signed by shp_3f… and its bytes are unchanged.").

## Interfaces

- `packages/contracts`: `ProofPackage` and `ProofVerification` (zod). **Contracts change:** spec plus Sristee and Harsh,
  announced in the team chat.
- `GET /orders/:id/proof` → `ProofPackage`, `content-type: application/json`, `content-disposition: attachment`. Operator
  token; 404 `order_not_found`; 409 `proof_not_available` for an order with no stage-1 verdict.
- `packages/mandates`: `verifyProofPackage(pkg: unknown, opts?: { trustedMerchantKeys?: JWK[]; now?: string }): ProofVerification`.
- CLI: `pnpm proof:verify <file> [--merchant-key <jwk file>]`, exit 0 only when `ok`.

## Acceptance criteria

Each starts as a `ledger()` entry.

1. A package exported for a captured fixture order verifies with every check passed (and `payment` "not_checked").
2. Changing one byte in any section fails `manifest`; changing a mandate's `canonical` fails `signatures` too.
3. Replacing a shopper key with another valid P-256 key fails `key_ids`.
4. A key retired before the time we recorded fails `key_validity`.
5. A Payment Mandate from another order fails `bindings`.
6. A package whose `policy.reasons` disagree with the replay fails `policy`.
7. Without a pinned merchant key, `merchant_key` is "not_checked" and `ok` is false.
8. The package contains no vault id, email, buyer note or plaintext address.
9. The worker's evidence bundle for a dispute embeds the package for that order unchanged.

## Out of scope

A public, unauthenticated download link for shoppers; PayPal-side verification of the capture; signing packages with
anything other than the merchant key; changes to the PDF's layout.

## Open questions

- How does a verifier get the merchant's key without trusting the package? Proposed: publish it at
  `GET /.well-known/poi-merchant-keys` (JWKS, current and retired) and document pinning. Owner @harshkumarsingh12,
  answer by Nov 18.
- `@poi/policy-engine` is version `0.0.0`. The policy check needs a real version, or a hash of the engine's rule table,
  to say what replayed. Owner @srshriv, by Nov 18.
- Should the CLI live in `packages/mandates` (a `bin`) or in `scripts/`? Default: `packages/mandates`, so it ships with the
  verifier. Owner @srshriv with @harshkumarsingh12, by Nov 18.
- A step-up approval's `CartApproval` JWS isn't stored: the `stepup.approved` audit row keeps only the order id and the
  cart hash (`apps/api/src/stepup.ts`). Proposed: store the JWS there too, as stage 2 already does, so a step-up order's
  package can prove the shopper's approval. Owner @harshkumarsingh12 with @srshriv, by Nov 18.
- Should the evidence PDF print the package's manifest hash, so a reader can match the PDF to the file? Owner
  @hoursgotviral-dev, by Nov 18.
