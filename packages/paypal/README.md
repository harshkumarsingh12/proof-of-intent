# @poi/paypal

**Path:** `packages/paypal/` | **Owner:** @harshkumarsingh12 | **Backup:** @srshriv | **Spec:** [0004-paypal-integration.md](../../docs/specs/0004-paypal-integration.md) | **Milestones:** M0, M1, M2

Typed PayPal client with `mock` and `sandbox` modes behind one interface.

```ts
import { createPayPalClient, parseMode } from "@poi/paypal";

const paypal = createPayPalClient(parseMode(process.env.PAYPAL_MODE)); // mock unless PAYPAL_MODE=sandbox
const order = await paypal.createOrder({ intent: "AUTHORIZE", ourOrderId, customId, total, items });
```

| Method                                                        | Sandbox                                                                                                                                                                                          | Mock                                                                                             |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| `createOrder`                                                 | Orders v2; `PayPal-Request-Id` = our order id, so retries never duplicate                                                                                                                        | idempotent on our order id; vaulted CAPTURE completes at once                                    |
| `createVaultSetupToken`, `createVaultPaymentToken`            | Vault v3: `POST /v3/vault/setup-tokens` (`usage_type: MERCHANT`) and `POST /v3/vault/payment-tokens`; the payment token's id is the `vaultId` an agent-alone `CAPTURE` order charges             | "approval" sends the shopper straight back with `approval_token_id`; a setup token converts once |
| `authorizeOrder`, `captureAuthorization`, `voidAuthorization` | Orders v2 / Payments v2, deterministic request ids                                                                                                                                               | same state rules and error names as PayPal                                                       |
| `verifyWebhook`                                               | `verify-webhook-signature` with the raw body spliced in verbatim; `false` for 4xx, throws on outages                                                                                             | accepts `transmissionSig === MOCK_WEBHOOK_SIGNATURE`                                             |
| `provideEvidence`                                             | multipart `provide-evidence`: an `input` JSON part (`evidence_type`, notes, document names) plus each PDF as `fileN`; refuses non-PDFs, files over 10 MB and empty uploads before calling PayPal | same validation; recorded in `disputeActions`                                                    |
| `sendMessage`                                                 | multipart `send-message` with the message as the `input` part                                                                                                                                    | recorded in `disputeActions`                                                                     |
| `escalate`                                                    | `POST /v1/customer/disputes/{id}/escalate` (inquiry → claim)                                                                                                                                     | recorded in `disputeActions`                                                                     |
| `acceptClaim`, `getDispute`, `listDisputes`, `addTracking`    | PayPal Agent Toolkit (`@paypal/agent-toolkit`, `src/agent-toolkit.ts`): its tools called directly; JSON errors become `PayPalError`; a tracker refused inside a 200 batch is an error            | seedable disputes (`seedDispute`); actions recorded                                              |

- Money in and out is integer minor units (`Money`); `toPayPalAmount` converts with the currency's own exponent.
- Errors from PayPal are `PayPalError { status, issue, debugId }`. Quote the `debugId` to PayPal support.
- The mock treats every order as approved by the shopper (there's nobody to click).
- `evidenceTypeFor(reason)` maps a PayPal dispute reason to the evidence type spec 0004 prescribes.
- The worker only reads (`getDispute`, `listDisputes`); actions run in the API after an operator click (spec 0005).
- A call that failed before reaching PayPal (token fetch, DNS) is retried up to 3 times; one that reached PayPal
  never is.

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
