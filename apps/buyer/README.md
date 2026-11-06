# Buyer app and agent

**Path:** `apps/buyer/` | **Owner:** @srshriv | **Backup:** @hoursgotviral-dev | **Spec:** [0001-mandate-model.md](../../docs/specs/0001-mandate-model.md) | **Milestones:** M1, M2

Next.js shopper app. Run: `pnpm dev:buyer` (port 3001; set `API_INTERNAL_URL` if the API isn't on
`http://localhost:3000`).

| Path                        | What                                                                                                         |
| --------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `/`                         | Landing page                                                                                                 |
| `/shop`                     | Journey A: browser key → signed Intent Mandate → agent proposes a cart → verdict → PayPal → capture          |
| `/api/keys/shopper`         | Proxy to the API's `POST /keys/shopper` (the browser registers its public key)                               |
| `/api/agent/checkout`       | The buyer agent: `{ intent_jws, sku }` → cart + Payment Mandate signed with the agent key → `POST /checkout` |
| `/api/checkout/:id/approve` | Proxy for PayPal's `onApprove`: the shopper's CartApproval countersignature                                  |

**Keys.** The shopper's key is made in the browser (`src/signing.ts`, WebCrypto, non-extractable) and kept in
IndexedDB (`src/key-store.ts`); it never reaches a server. The agent's key lives only in the shop's server
(`src/agent-server.ts`, `AGENT_SIGNING_KEY`, or a throwaway key per process); with `OPERATOR_TOKEN` set it registers
itself with `POST /keys/agent`. Nothing here holds PayPal credentials; `PAYPAL_CLIENT_ID` is public and only loads
PayPal's button.

**PayPal.** `PAYPAL_MODE=sandbox` with `PAYPAL_CLIENT_ID`: PayPal's JS SDK button (`intent=authorize`) for the order
the merchant already created, with a link to `approval_url` as a fallback. Otherwise a mock approve button.

**Still to do:** the LLM buyer agent that chooses the item itself and its tools (#37; today the shopper picks the
agent's proposal), step-up links for agent-alone orders (#35), a Playwright smoke test of `/shop`.

## Test

```bash
pnpm vitest run apps/buyer
```

Unbuilt acceptance criteria are `ledger()` entries in this folder's `*.test.ts`. Turn each into a plain `test()` as you finish it.
