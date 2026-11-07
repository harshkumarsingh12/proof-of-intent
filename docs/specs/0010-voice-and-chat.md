# 0010: Voice ordering and the buyer assistant

|               |                                                            |
| ------------- | ---------------------------------------------------------- |
| **Status**    | Proposed                                                   |
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
2. **Signing needs a separate confirmation.** After the agent drafts the limits, the shop shows a **read-back card** built
   from the structured form (never from model prose): price cap, item, color, validity, confirm-each-cart. The shopper
   confirms by tapping **Confirm and sign** or by saying "confirm" in a **new** recognition session started after the
   card is visible. Only then does the browser sign, exactly the form that was read back.
3. **Voice never changes how the order is paid.** "Agent pays alone" stays a deliberate checkbox. With it on and a wallet
   saved, an approved cart is paid with no PayPal step; otherwise the PayPal button still appears.
4. **The chat is read-only.** It has no tool that signs, buys, proposes a checkout, saves or removes a wallet. It never
   receives `intent_jws`, order ids, PayPal ids, wallet state, emails or addresses.
5. **Unavailable is not an answer.** No model, no key, a spent budget or a rate limit gives a plain message or a scripted
   reply, never an invented one.

## Voice design

State machine (`apps/buyer/src/voice.ts`, pure and unit-tested):
`idle → listening → drafting → readback → confirmed → signing → choosing → done`, with `failed` reachable from any
working state and **Cancel** from every state.

- Speech heard while `listening` is only ever text. It is never parsed as a command, so "buy a grey jacket and confirm"
  fills the box and shows the card; it does not sign.
- `parseConfirmation` accepts only a whole short utterance: `confirm`, `i confirm`, `confirm it`, `yes confirm`
  (cancel: `cancel`, `stop`, `no`, `never mind`). A bare "yes" is not a confirmation, and anything over four words is ignored.
- A confirmation arriving less than 700 ms after the card appears is ignored (a stray tap or echo); the read-back expires
  after 60 s; editing the form while the card is up discards it (what is signed must be what was read back).
- Text-to-speech read-back is optional (off by default). Recognition is stopped while the shop speaks, so it cannot hear
  itself say "confirm".
- Browser support: the Web Speech API (Chrome, Edge, Safari; HTTPS or localhost; not Firefox). The microphone is hidden
  where it is missing, and typing always works. The browser vendor processes the audio; the card says so.
- Switch: `BUYER_VOICE=1` on the buyer app (runtime, default off).

## Interfaces

No API or contract changes. Buyer app only: `src/voice.ts`, `app/shop/useVoice.ts`, `app/shop/ShopFlow.tsx`.

## Acceptance criteria

1. "buy X and confirm" in one utterance shows the read-back and signs nothing. _(unit + browser smoke)_
2. A confirmation outside the read-back, inside the first 700 ms, or after 60 s is ignored. _(unit)_
3. Editing the form during the read-back discards it; Cancel works from every state. _(unit)_
4. Voice code never touches the "agent pays alone" setting. _(unit + browser smoke)_
5. Without speech recognition the microphone is hidden and the shop still works. _(browser smoke)_

## Out of scope here

The buyer chat (next PR in this spec), streaming replies, on-device or server-side speech recognition.
