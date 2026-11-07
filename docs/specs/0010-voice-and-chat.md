# 0010: Voice ordering and the buyer assistant

|               |                                                            |
| ------------- | ---------------------------------------------------------- |
| **Status**    | In Progress                                                |
| **Owner**     | @srshriv                                                   |
| **Reviewers** | @harshkumarsingh12, @sumedhag28                            |
| **Milestone** | M3 (behind switches, default off)                          |
| **Code**      | `apps/buyer` (voice, chat), `packages/ai` (provider rules) |

## Context

Shoppers should be able to say what they want, and ask the shop questions, instead of filling in a form. Both are new
ways to produce the same signed Intent Mandate and the same merchant checks; neither may weaken them. The signature on
the intent is what the merchant checks every cart against and what the evidence is built from, so it has to stay a
deliberate act by the shopper.

## Rules that do not bend

1. **Voice is an input method only.** A transcript fills the text box. It is untrusted text, like typing: it goes through
   `/api/agent/draft-intent` (redaction, delimited data block, 500-character cap) and nothing else.
2. **A request only fills in the limits; signing is the shopper's own click.** Whether typed or spoken, the request is drafted
   into the limits form and nothing more happens: there is no read-back card and no spoken confirmation step. The shopper can
   edit any limit, or speak or type again to replace them all, and signs by clicking **Sign my intent**. Nothing is signed,
   proposed or bought from a sentence. _(Changed Nov 8 at the owner's request: this used to be a read-back card plus a separate
   "confirm". The signature is still a deliberate act, and the form the shopper sees is exactly what the browser signs.)_
3. **Voice never changes how the order is paid.** "Agent pays alone" stays a deliberate checkbox, and it is part of what the shopper signs (#157). With it on and a wallet
   saved, an approved cart is paid with no PayPal step; otherwise the PayPal button still appears.
4. **The chat is read-only.** It has no tool that signs, buys, proposes a checkout, saves or removes a wallet. It never
   receives `intent_jws`, order ids, PayPal ids, wallet state, emails or addresses.
5. **Unavailable is not an answer.** No model, no key, a spent budget or a rate limit gives a plain message or a scripted
   reply, never an invented one.

## Voice design

State machine (`apps/buyer/src/voice.ts`, pure and unit-tested): `idle → listening → drafting → idle`, with `failed`
reachable from `listening` and `drafting`, and **Cancel** from every state. Speaking again from `idle` or `failed` starts over.

- Speech heard while `listening` is only ever text. It is never parsed as a command, so "buy a grey jacket and confirm"
  fills the box and the limits like any other request; it does not sign. In every other phase speech is not looked at.
- The same drafting happens when the shopper presses **Enter** in the request box (Shift+Enter is a new line) or clicks
  **Fill in the limits from my words**. Drafting never turns "ask me before every purchase" on or off: that is the shopper's switch.
- There is no text-to-speech read-back any more (it existed only to support the confirmation step), and no
  `parseConfirmation`, read-back card, timeout or "edited" rule.
- Browser support: the Web Speech API (Chrome, Edge, Safari; HTTPS or localhost; not Firefox). The microphone is hidden
  where it is missing, and typing always works. The browser vendor processes the audio; the form says so.
- Switch: `BUYER_VOICE=1` on the buyer app (runtime, default off).

## Interfaces

No API or contract changes. Buyer app only: `src/voice.ts`, `app/shop/useVoice.ts`, `app/shop/ShopFlow.tsx`.

## Acceptance criteria

1. "buy X and confirm" in one utterance fills the box and the limits and signs nothing. _(unit + browser smoke)_
2. A spoken or typed request fills the limits with no confirmation step; speaking or typing again replaces them, and the
   shopper can edit them before signing with one click. _(unit + browser smoke)_
3. Cancel works from every state; speech outside `listening` is ignored. _(unit)_
4. Voice code never touches the "agent pays alone" setting. _(unit + browser smoke)_
5. Without speech recognition the microphone is hidden and the shop still works. _(browser smoke)_

## Chat design (`apps/buyer/src/chat.ts`, `chat-server.ts`, `app/shop/ChatPanel.tsx`)

`POST /api/agent/chat` with `{ messages, context? }` answers `{ source, text, products, suggestion?, note? }`. One JSON reply (no
streaming). Off unless `BUYER_CHAT=1` (runtime, default off).

- **Retrieval first.** The free models don't reliably decide to look something up themselves (Nemotron answered "black" for a
  product's color without calling the lookup tool; spec 0006), so the server gathers every fact by plain code (`gatherFacts`:
  catalog search by the words of the last few messages, a comparison, the limits, the last verdict) and the model only phrases
  them (`factsForModel`: prices as `$74.00`, never cents). No tools are offered to the model at all.
- **Two things are never left to a model.** What the merchant decided about the shopper's money (a refusal, a hold, an approval)
  is fixed text, because it has exact wording ("no PayPal order was created and nothing was charged") that both free models
  paraphrased away or blurred in testing. And when the shopper asks the assistant to buy, sign or pay, the answer always starts by
  saying plainly that it can't, whatever the model wrote.
- **A guard** (`answerIsGrounded`) rejects an answer that states a price or SKU that isn't in the facts, or talks in cents; the plain
  answer (`scriptedChat`, composed from the same facts) is used instead, and also when there is no model, the model fails or says
  nothing. So what the shopper reads is never worse than the store's own data. The guard catches hallucination, not a determined
  shopper: the assistant can't buy or change anything either way.
- **What the client may send** (strict, unknown keys refused): up to 8 messages of at most 500 characters (3,000 in total), the last
  from the shopper; as context only the limits (price, item, color, days, confirm-each-cart) and the last verdict's outcome and reason
  codes. Never the signed intent, ids, wallet state or an address. Text that looks like a key, a token, a signed record or one of our
  ids is refused with a 400, not answered. Emails are removed before any model sees the words.
- **Cost and abuse:** a per-IP limit (10 a minute, 60 an hour; `cf-connecting-ip`, else `x-forwarded-for`; in memory, one process),
  and `BUYER_CHAT_DAILY_LIMIT` (default 150 live model calls a day per process; 0 answers everything from the store's data) separate
  from the shop's overall `AI_DAILY_CALL_LIMIT`, so chat can't use up the calls checkout needs. Past the cap, or in replay mode, the
  answer is the plain one and says so.
- **The only action** the chat offers is "Use these limits", which fills the limits form (the shopper's own "ask me before every
  purchase" switch is kept) for them to review and sign. The suggested wording is the demo preset's when the request is exactly a
  preset (the merchant's recorded checks are keyed on it), the shopper's own words when they phrased a purchase, and a clean statement
  ("Grey running jackets under $70.") for a question like "show me…".
- `pnpm chat:eval` runs the hard cases against the real model (an invented product, a prompt injection, "buy it for me", a refusal,
  a comparison); `--backup` runs them on the backup. Result on Nov 7: 6 of 6 on NVIDIA Nemotron 3.5 Lightning and on Groq
  `gpt-oss-120b`, after fixing what the first run found (prices read as cents, "nothing was charged" paraphrased away, markdown).

## Chat acceptance criteria

6. The chat only ever returns text, product information and unsigned limits; it has no way to sign, buy or propose a checkout. _(unit + browser smoke)_
7. A price or SKU the store doesn't have never reaches the shopper; an invented one is replaced by the plain answer. _(unit)_
8. A refusal is always explained with "nothing was charged", in fixed text. _(unit + browser smoke + live eval)_
9. Asked to buy, sign or pay, the answer says plainly that it can't. _(unit + live eval)_
10. A pasted key, token or signed record is refused; context outside the allowed shape is refused; the per-IP limit and the daily cap hold. _(unit)_

## Near-miss suggestions (`apps/buyer/src/near-miss.ts`)

After the merchant **refuses** a cart for the shopper's own limits (`AMOUNT_EXCEEDS_MAX`, `ATTRIBUTE_MISMATCH`), the refusal panel says
what would have fit: the cart's price against the signed cap, the closest product in the store that already fits the signed limits,
and one button that fills the limits form (a higher cap, or limits for that item). It is plain code over the catalog and the signed
intent's constraints: no model, no network, and every figure in the text is the catalog's or the signed limits'.

Rules: it never signs, buys or changes the signed intent; the button replaces the form values, drops the old signed intent and the
verdict, and the shopper reviews and signs again. A cap is never lowered, and a raise is named in the text. Other refusals (expired
intent, bad signature, replay, step-up) get no hint. Voice never applies it. An item or color the shopper left open ("Anything")
stays open in the suggestion: the hint raises the price and never adds a limit they didn't choose.

11. A refusal for price or kind shows what would have fit, from catalog data only; other refusals show nothing. _(unit)_
12. Applying a suggestion only fills the form: nothing is signed or ordered until the shopper signs again, and the patch always builds a valid intent. _(unit)_

## Out of scope here

Streaming replies, on-device or server-side speech recognition, voice input for the chat, and a
chat on the merchant dashboard (the Studio chat, spec 0007).
