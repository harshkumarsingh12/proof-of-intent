# 0002: Policy engine and reason codes

| | |
|---|---|
| **Status** | Proposed |
| **Owner** | @srshriv |
| **Reviewers** | @harshkumarsingh12, @hoursgotviral-dev |
| **Milestone** | M0 (core), M1 (remaining rules) |
| **Code** | `packages/policy-engine`, `ReasonCode` in `packages/contracts` |

## Context

Merchants and judges must be able to predict outcomes. Hard limits are decided by code, never by a model, and
the dispute copilot must be able to replay the exact same decision later. Project document §1, §5.

## Design

`evaluate({ intent, cart, now, ledger }) → { pass, reasons[] }`. Pure: no I/O, no clock, no randomness. Rules are
a table; every failing rule adds its reason code; `pass` is true only with zero reasons.

| Constraint | Reason code | Status |
|---|---|---|
| cart points at this intent | `MANDATE_MISMATCH` | built |
| `valid_from <= now` | `MANDATE_NOT_YET_VALID` | built |
| `now < intent_expiry` | `MANDATE_EXPIRED` | built |
| `now < cart_expiry` | `CART_EXPIRED` | built |
| all currencies equal `amount_max.currency` | `CURRENCY_MISMATCH` | built |
| `total <= amount_max` | `AMOUNT_EXCEEDS_MAX` | built |
| merchant in `merchant_allowlist` | `MERCHANT_NOT_ALLOWED` | built |
| `quantity_max.per_line`, `.per_order` | `QUANTITY_EXCEEDS_MAX` | built |
| exact `attributes` (category, color, size) | `ATTRIBUTE_MISMATCH` | M1 |
| `sku_allowlist` | `SKU_NOT_ALLOWED` | M1 |
| `shipping_address_hash` | `ADDRESS_MISMATCH` | M1 |
| `budget_cap` vs ledger captured total + this cart | `BUDGET_EXCEEDED` | M1 |
| `recurrence` (max orders per window) vs ledger | `RECURRENCE_EXCEEDED` | M1 |

Signature, key and nonce failures (`SIGNATURE_INVALID`, `UNKNOWN_KEY`, `NONCE_REPLAYED`, `SCHEMA_INVALID`) are
produced by the verification pipeline before the engine runs (spec 0003). Semantic codes (`SEMANTIC_UNCERTAIN`,
`SEMANTIC_MISMATCH`) come from J1 (spec 0006).

**Attributes:** exact, case-insensitive comparison of keys present in `constraints.attributes` against each cart
line's `attributes`. Free-text nuance ("running jacket" vs "rain shell") is J1's job, not this engine's.

## Interfaces

```ts
interface MandateLedger { capturedTotal: number; capturedOrderTimes: string[] }
evaluate(input: { intent: IntentMandate; cart: CartMandate; now: string; ledger?: MandateLedger }): { pass: boolean; reasons: ReasonCode[] }
```

## Acceptance criteria

1. Compliant fixture passes with no reasons; the red $95 fixture fails with `AMOUNT_EXCEEDS_MAX`. *(done)*
2. Boundaries: exactly the max passes, one cent over fails. *(done)*
3. Currency, merchant, quantity and freshness rules each produce their code. *(done)*
4. Same input, same output. *(done)*
5. Red fixture also yields `ATTRIBUTE_MISMATCH`. *(ledger M1 @srshriv)*
6. Budget, recurrence, address and SKU rules. *(ledger M1 @srshriv)*
7. Full line coverage of `packages/policy-engine` before M3.

## Out of scope

Fraud scoring, risk models, per-merchant policy configuration (stretch).
