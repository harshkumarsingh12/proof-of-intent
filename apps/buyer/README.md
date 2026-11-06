# Buyer app and agent

**Path:** `apps/buyer/` | **Owner:** @srshriv | **Backup:** @hoursgotviral-dev | **Spec:** [0001-mandate-model.md](../../docs/specs/0001-mandate-model.md) | **Milestones:** M1, M2

Next.js shopper app. Run: `pnpm dev:buyer` (port 3001; set `API_INTERNAL_URL` if the API isn't on
`http://localhost:3000`).

| Path                        | What                                                                                                                   |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `/`                         | Landing page                                                                                                           |
| `/shop`                     | Journey A: browser key → signed Intent Mandate → agent proposes a cart → verdict → PayPal → capture                    |
| `/api/keys/shopper`         | Proxy to the API's `POST /keys/shopper` (the browser registers its public key)                                         |
| `/api/agent/checkout`       | The buyer agent: `{ intent_jws, sku }` → cart + Payment Mandate signed with the agent key → `POST /checkout`           |
| `/api/agent/choose`         | The buyer agent picks the item itself: `{ intent_jws }` → up to three carts proposed, each with the merchant's verdict |
| `/api/agent/draft-intent`   | The agent fills the intent form from the shopper's words: `{ text }` → an **unsigned** draft                           |
| `/api/checkout/:id/approve` | Proxy for PayPal's `onApprove`: the shopper's CartApproval countersignature                                            |

**Keys.** The shopper's key is made in the browser (`src/signing.ts`, WebCrypto, non-extractable) and kept in
IndexedDB (`src/key-store.ts`); it never reaches a server. The agent's key lives only in the shop's server
(`src/agent-server.ts`, `AGENT_SIGNING_KEY`, or a throwaway key per process); with `OPERATOR_TOKEN` set it registers
itself with `POST /keys/agent`. Nothing here holds PayPal credentials; `PAYPAL_CLIENT_ID` is public and only loads
PayPal's button.

**PayPal.** `PAYPAL_MODE=sandbox` with `PAYPAL_CLIENT_ID`: PayPal's JS SDK button (`intent=authorize`) for the order
the merchant already created, with a link to `approval_url` as a fallback. Otherwise a mock approve button.

**Buyer agent** (`src/agent.ts`, #37). Three tools and nothing else: `create_intent_mandate` (a draft only: the
shopper's key never leaves their browser, so the shopper reviews and signs it), `search_catalog` and
`request_checkout` (one SKU under the signed intent; the model sees the outcome and reason codes, never signed
bytes). The merchant's verdict stays the authority, so a bad pick is refused with no PayPal order. At most three
carts per run and six model calls. `AI_MODE=replay` (default) uses a scripted chooser, no model and no key, and the
shop says so; `AI_MODE=live` uses `AI_PROVIDER`, `AI_MODEL`, `AI_API_KEY` through the Vercel AI SDK and counts
every call against `AI_DAILY_CALL_LIMIT`. A live failure answers 503 `agent_unavailable` and the shopper picks a
cart by hand, which is also how the red $95 demo cart is proposed.

**Still to do:** a Playwright smoke test of `/shop`, a recorded live run of the agent for the eval report.

## Test

```bash
pnpm vitest run apps/buyer
```

Unbuilt acceptance criteria are `ledger()` entries in this folder's `*.test.ts`. Turn each into a plain `test()` as you finish it.
