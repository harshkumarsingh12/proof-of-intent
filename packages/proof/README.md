# @poi/proof

**Path:** `packages/proof/` | **Owner:** @srshriv | **Spec:** [0001-mandate-model.md](../../docs/specs/0001-mandate-model.md) §Proof package | **Issue:** #177

One JSON file per order that backs a purchase with its signed record, and a verifier that checks it with no server and no database.

- `buildProofPackage(input)`: packs the three signed mandates (the Intent, Payment and Cart compact JWS, as signed), the public
  keys, the PayPal references and the policy version, and seals them with an integrity manifest. It verifies nothing.
- `verifyProofPackage(file)`: returns `{ ok, checks, notes }`. Each check has an `id`, a `label`, `passed` and a `detail` saying
  what it found. A check whose prerequisite failed says "not checked" and fails. `notes` always say what a pass does not show.

## Use

The merchant's API serves it: `GET /orders/:id/proof` (the dashboard has a "Download proof package" link on a live dispute).
Anyone can check the file they downloaded:

```bash
pnpm proof:verify path/to/poi-proof-ord_....json     # exit 0: every check passed, 1: a check failed, 2: unreadable file
```

## What a pass means

The signatures are valid for the keys in the file, the three mandates point at one another, the order's PayPal pointer names this
intent, and the hard rules held at the time of payment. It does **not** show who holds each key (compare the key ids with the
merchant's registry) or that PayPal moved the money (look the capture up in PayPal). The manifest detects a changed file; it is not
a signature, and the signatures are what carry the proof.

## Test

```bash
pnpm vitest run packages/proof apps/api/src/proof.test.ts
```
