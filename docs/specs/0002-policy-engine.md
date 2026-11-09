# 0002: Policy engine and reason codes

|               |                                                                |
| ------------- | -------------------------------------------------------------- |
| **Status**    | Done                                                           |
| **Owner**     | @srshriv                                                       |
| **Reviewers** | @harshkumarsingh12, @hoursgotviral-dev                         |
| **Milestone** | M0 (core), M1 (remaining rules)                                |
| **Code**      | `packages/policy-engine`, `ReasonCode` in `packages/contracts` |

## Context

Merchants and judges must be able to predict outcomes. Hard limits are decided by code, never by a model, and
the dispute copilot must be able to replay the exact same decision later. Project document §1, §5.

## Design

`evaluate({ intent, cart, now, ledger }) → { pass, reasons[] }`. Pure: no I/O, no clock, no randomness. Rules are
a table; every failing rule adds its reason code; `pass` is true only with zero reasons.

| Constraint                                        | Reason code             | Status |
| ------------------------------------------------- | ----------------------- | ------ |
| cart points at this intent                        | `MANDATE_MISMATCH`      | built  |
| `valid_from <= now`                               | `MANDATE_NOT_YET_VALID` | built  |
| `now < intent_expiry`                             | `MANDATE_EXPIRED`       | built  |
| `now < cart_expiry`                               | `CART_EXPIRED`          | built  |
| all currencies equal `amount_max.currency`        | `CURRENCY_MISMATCH`     | built  |
| `total <= amount_max`                             | `AMOUNT_EXCEEDS_MAX`    | built  |
| merchant in `merchant_allowlist`                  | `MERCHANT_NOT_ALLOWED`  | built  |
| `quantity_max.per_line`, `.per_order`             | `QUANTITY_EXCEEDS_MAX`  | built  |
| exact `attributes` (category, color, size)        | `ATTRIBUTE_MISMATCH`    | built  |
| `sku_allowlist`                                   | `SKU_NOT_ALLOWED`       | built  |
| `shipping_address_hash`                           | `ADDRESS_MISMATCH`      | built  |
| `budget_cap` vs ledger captured total + this cart | `BUDGET_EXCEEDED`       | built  |
| `recurrence` (max orders per window) vs ledger    | `RECURRENCE_EXCEEDED`   | built  |
| no `budget_cap` and no `recurrence`: one purchase | `INTENT_ALREADY_USED`   | built  |

Signature, key and nonce failures (`SIGNATURE_INVALID`, `UNKNOWN_KEY`, `NONCE_REPLAYED`, `SCHEMA_INVALID`) are
produced by the verification pipeline before the engine runs (spec 0003). `CATALOG_MISMATCH` (a cart line the merchant's
catalog doesn't back) is also the pipeline's, not the engine's: the engine stays free of merchant data. Semantic codes (`SEMANTIC_UNCERTAIN`,
`SEMANTIC_MISMATCH`) come from J1 (spec 0006).

**Attributes:** exact, case-insensitive comparison of keys present in `constraints.attributes` against each cart
line's `attributes`. Free-text nuance ("running jacket" vs "rain shell") is J1's job, not this engine's.
A line that lacks a constrained attribute fails, since it can't show the shopper's attribute.

**Address:** a cart without `shipping_address_hash` fails when the mandate has one.

**Freshness:** the three time rules (`MANDATE_NOT_YET_VALID`, `MANDATE_EXPIRED`, `CART_EXPIRED`) are also exported on their
own as `freshness({ intent, cart, now })`. `evaluate` runs them with everything else, in the same order; stage-two
approval (spec 0003) re-runs just these right before capture, so checkout and capture can't disagree about what "still
current" means.

**One purchase by default (#156):** an intent that signs neither a `budget_cap` nor a `recurrence` authorizes exactly one
successful purchase: once the ledger holds a prior order, a further cart is `INTENT_ALREADY_USED`. Several purchases need
that permission signed, as a budget (spend up to a total) or an order count (`recurrence.max_orders` in `window_days`).
Rejected attempts create no order, so the retry after a refusal still works; only a purchase that was made counts.

**Ledger rules:** a missing ledger means no prior captures. `budget_cap` fails when captured total + this cart is
over the cap, and its currency joins `amount_max` in the currency check. `recurrence` counts captures in
`(now - window_days, now]` plus this order; captures after `now` are ignored, so a replay at capture time sees
what checkout saw.

What the ledger holds depends on the caller. A **dispute replay** passes captures that existed when the order was
created (`mandateLedger(intent, asOfOrderId)`). **Checkout, step-up approval and stage-two approval** pass what the
intent has spent _or set aside_ (`activeLedger`, spec 0003 §Reservation): captured orders, orders with an unknown
PayPal result, and pending orders whose cart has not expired. The engine does not know the difference.

## Interfaces

```ts
interface MandateLedger { capturedTotal: number; capturedOrderTimes: string[] }
evaluate(input: { intent: IntentMandate; cart: CartMandate; now: string; ledger?: MandateLedger }): { pass: boolean; reasons: ReasonCode[] }
```

## Acceptance criteria

1. Compliant fixture passes with no reasons; the red $95 fixture fails with `AMOUNT_EXCEEDS_MAX`. _(done)_
2. Boundaries: exactly the max passes, one cent over fails. _(done)_
3. Currency, merchant, quantity and freshness rules each produce their code. _(done)_
4. Same input, same output. _(done)_
5. Red fixture also yields `ATTRIBUTE_MISMATCH`. _(done)_
6. Budget, recurrence, address and SKU rules. _(done)_
7. Every rule in the design table has a passing test for its reason code. Each limit the spec states has a test at
   exactly the limit: `valid_from <= now`, `now < intent_expiry`, `now < cart_expiry` and `total <= amount_max` from the
   table, and the `budget_cap` and `recurrence` limits from §Ledger rules (`max_orders`, and both ends of the
   `(now - window_days, now]` window). _(done)_
8. An intent that signs neither a `budget_cap` nor a `recurrence` authorizes one successful purchase: a further cart
   is `INTENT_ALREADY_USED` (#156). _(done)_
9. `freshness({ intent, cart, now })` reports exactly the time reasons `evaluate` reports, in the same order (#161). _(done)_

## Out of scope

Fraud scoring, risk models, per-merchant policy configuration (stretch).
