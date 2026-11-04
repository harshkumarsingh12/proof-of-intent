# @poi/paypal

**Path:** `packages/paypal/` | **Owner:** @harshkumarsingh12 | **Backup:** @srshriv | **Spec:** [0004-paypal-integration.md](../../docs/specs/0004-paypal-integration.md) | **Milestones:** M0, M1, M2

Typed PayPal client with `mock` and `sandbox` modes behind one interface.

```ts
import { createPayPalClient, parseMode } from "@poi/paypal";

const paypal = createPayPalClient(parseMode(process.env.PAYPAL_MODE)); // mock unless PAYPAL_MODE=sandbox
const order = await paypal.createOrder({ intent: "AUTHORIZE", ourOrderId, customId, total, items });
```

| Method                                                        | Sandbox                                                                                              | Mock                                                          |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `createOrder`                                                 | Orders v2; `PayPal-Request-Id` = our order id, so retries never duplicate                            | idempotent on our order id; vaulted CAPTURE completes at once |
| `authorizeOrder`, `captureAuthorization`, `voidAuthorization` | Orders v2 / Payments v2, deterministic request ids                                                   | same state rules and error names as PayPal                    |
| `verifyWebhook`                                               | `verify-webhook-signature` with the raw body spliced in verbatim; `false` for 4xx, throws on outages | accepts `transmissionSig === MOCK_WEBHOOK_SIGNATURE`          |
| `provideEvidence`, `sendMessage`                              | M2 (`NotImplementedError` until then)                                                                | recorded in `disputeActions`                                  |

- Money in and out is integer minor units (`Money`); `toPayPalAmount` converts with the currency's own exponent.
- Errors from PayPal are `PayPalError { status, issue, debugId }`. Quote the `debugId` to PayPal support.
- The mock treats every order as approved by the shopper (there's nobody to click).

## Fixtures

`fixtures/sandbox/*.json` are real sandbox responses (account ids redacted). Regenerate with
`pnpm sandbox:record-orders` (needs the sandbox credentials in `.env`). The unit tests replay them through the
sandbox client, so CI checks our parsing against what PayPal actually sends.

## Test

```bash
pnpm vitest run packages/paypal          # offline
# with PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_WEBHOOK_ID set, a live-sandbox test runs too
```

Unbuilt acceptance criteria are `ledger()` entries in this folder's `*.test.ts`. Turn each into a plain `test()` as you finish it.
