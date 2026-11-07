# Buyer app and agent

**Path:** `apps/buyer/` | **Owner:** @srshriv | **Backup:** @hoursgotviral-dev | **Spec:** [0001-mandate-model.md](../../docs/specs/0001-mandate-model.md) | **Milestones:** M1, M2

Next.js shopper app. Run: `pnpm dev:buyer` (port 3001; set `API_INTERNAL_URL` if the API isn't on
`http://localhost:3000`).

| Path                        | What                                                                                                                              |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `/`                         | Landing page                                                                                                                      |
| `/shop`                     | Journey A: browser key → signed Intent Mandate → agent proposes a cart → verdict → PayPal → capture                               |
| `/shop/wallet`              | Where PayPal sends the shopper after they approve a wallet: signs the save proof and finishes (Vault v3, #17)                     |
| `/api/vault/*`              | Proxies to `POST /vault/setup`, `/vault/save`, `/vault/remove` and `GET /vault/:kid` (wallet saving, signed by the browser's key) |
| `/api/keys/shopper`         | Proxy to the API's `POST /keys/shopper` (the browser registers its public key)                                                    |
| `/api/agent/checkout`       | The buyer agent: `{ intent_jws, sku }` → cart + Payment Mandate signed with the agent key → `POST /checkout`                      |
| `/api/agent/choose`         | The buyer agent picks the item itself: `{ intent_jws }` → up to three carts proposed, each with the merchant's verdict            |
| `/api/agent/draft-intent`   | The agent fills the intent form from the shopper's words: `{ text }` → an **unsigned** draft                                      |
| `/api/checkout/:id/approve` | Proxy for PayPal's `onApprove`: the shopper's CartApproval countersignature                                                       |

**Keys.** The shopper's key is made in the browser (`src/signing.ts`, WebCrypto, non-extractable) and kept in
IndexedDB (`src/key-store.ts`); it never reaches a server. The agent's key lives only in the shop's server
(`src/agent-server.ts`, `AGENT_SIGNING_KEY`, or a throwaway key per process); with `OPERATOR_TOKEN` set it registers
itself with `POST /keys/agent`. Nothing here holds PayPal credentials; `PAYPAL_CLIENT_ID` is public and only loads
PayPal's button.

**PayPal.** `PAYPAL_MODE=sandbox` with `PAYPAL_CLIENT_ID`: PayPal's JS SDK button (`intent=authorize`) for the order
the merchant already created, with a link to `approval_url` as a fallback. Otherwise a mock approve button.

**Wallet and paying alone** (`src/wallet.ts`, `/shop/wallet`, #17, #36). "Save a PayPal wallet" signs a short-lived proof with
the browser's key, asks the merchant for a Vault v3 setup token and sends the shopper to PayPal; PayPal returns them to
`/shop/wallet`, which signs the save proof and finishes. Once a wallet is saved, "Remove my wallet" forgets it again. "Let the agent pay alone" sends
`human_present: false`: an approved cart is charged to that wallet with no PayPal step, a step-up charges nothing and waits under "Waiting for your approval" (listed with a signed proof, approved with the shopper's signature, no link needed), and the
agent stops after the merchant accepts one cart. In `PAYPAL_MODE=mock` the approval returns to the shop at once.

**Voice ordering** (`src/voice.ts`, `app/shop/useVoice.ts`, spec 0010; off unless `BUYER_VOICE=1`). "Speak your request" fills the text
box from the browser's Web Speech API (Chrome, Edge, Safari over HTTPS or localhost; not Firefox, where the microphone is hidden
and typing still works; the browser vendor processes the audio). The agent then fills in the limits below (Enter in the box
does the same for typed words). There is no read-back card and no spoken confirmation: you can edit the limits or speak again to
replace them, and signing is your own click on "Sign my intent", so nothing is signed or bought from what was said. Voice never touches the
"agent pays alone" checkbox: with it on and a wallet saved the order is paid with no PayPal step, otherwise the PayPal button
still appears. The rules are a pure reducer (`voiceReducer`) with unit tests;
`VOICE=1 pnpm smoke:shop` runs the flow in Chrome with a fake recognizer.

**Near-miss suggestions** (`src/near-miss.ts`, spec 0010; always on, no model). When the merchant refuses a cart for price or kind, the
refusal panel says what would have fit (the closest product within the signed limits) and offers a button that refills the limits form.
It never signs or buys: the old signed intent is dropped and you review and sign again.

**Shop assistant** (`src/chat.ts`, `src/chat-server.ts`, `app/shop/ChatPanel.tsx`, spec 0010; off unless `BUYER_CHAT=1`). Ask about the
store, compare products, understand your limits, or find out why a cart was refused. It is read-only: its replies are text, product
information and limits for you to review, and its one button, "Use these limits", only fills the form. The server looks the facts up
by plain code and the model only phrases them (the free models don't reliably look things up themselves); a guard replaces an answer
that states a price or SKU the store doesn't have; a refusal is always explained in fixed text including "nothing was charged"; and
asked to buy, sign or pay it always says it can't. Limits: 10 questions a minute and 60 an hour per address, and
`BUYER_CHAT_DAILY_LIMIT` live model calls a day (past either, or with no model, it answers from the store's data and says so).
`pnpm chat:eval` checks the hard cases against the real model; `CHAT=1 pnpm smoke:shop` drives it in Chrome.

**Buyer agent** (`src/agent.ts`, #37). Three tools and nothing else: `create_intent_mandate` (a draft only: the
shopper's key never leaves their browser, so the shopper reviews and signs it), `search_catalog` and
`request_checkout` (one SKU under the signed intent; the model sees the outcome and reason codes, never signed
bytes). The merchant's verdict stays the authority, so a bad pick is refused with no PayPal order. At most three
carts per run and six model calls. `AI_MODE=replay` (default) uses a scripted chooser, no model and no key, and the
shop says so; `AI_MODE=live` uses `AI_PROVIDER`, `AI_MODEL`, `AI_API_KEY` through the Vercel AI SDK and counts
every call against `AI_DAILY_CALL_LIMIT`. A live failure answers 503 `agent_unavailable` and the shopper picks a
cart by hand, which is also how the red $95 demo cart is proposed.

The agent explains itself: the shop lists each search and proposal with the agent's own one-sentence reason and the
merchant's answer. Before asking the merchant, `request_checkout` checks the product against the signed price,
category and color and skips (and shows) any that break them, so a shopper's "forget grey, I want red" can't talk the
agent into a cart the merchant would refuse. The merchant still checks everything. The agent never sets "confirm
every cart"; that switch belongs to the shopper. `pnpm agent:eval` runs the live agent over eight cases, including a
budget-override request, and writes `docs/evals/agent-<date>.md`.

**Browser smoke test.** `pnpm smoke:shop` drives `/shop` in Chrome against a running mock stack: the browser key is
ECDSA P-256 and can't be exported, the red $95 cart is refused with no order, the grey $74 cart is approved and
captured through mock PayPal, and the agent's draft and choose buttons work (it never signs). `SHOP_URL=… pnpm smoke:shop`
points it at a hosted shop and stops before the PayPal step. It's a script you run, not a CI job.

## Test

```bash
pnpm vitest run apps/buyer
```

Unbuilt acceptance criteria are `ledger()` entries in this folder's `*.test.ts`. Turn each into a plain `test()` as you finish it.
