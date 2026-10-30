# Demo

**Owner:** @sumedhag28. This file is the video script and the judges' click path. Update it in the same PR as
any change to the demo path.

## Video (target 2:30, hard limit 3:00)

Recorded in `AI_MODE=replay` against the PayPal sandbox so every take is identical. 1080p, 30 fps; buyer and
merchant browsers side by side; dashboard in the dark theme; voiceover recorded separately; captions on key
phrases so it works muted; no music; agent platforms named in speech only, **no third-party logos**.

| Time | Shot | Line |
|---|---|---|
| 0:00 | Title card | "When an AI agent buys the wrong thing, the merchant pays. We fix that on PayPal." |
| 0:12 | Buyer app: intent typed and signed; cart badge; PayPal button; capture | "The shopper signs what they want, and the merchant checks the cart against it before taking the money." |
| 0:47 | Agent proposes the red $95 jacket; rejected with reason codes | "A red jacket at $95 does not pass a grey-under-$80 mandate. No order, no charge." |
| 1:02 | Dispute on the compliant order; workspace; evidence PDF; Submit | "The buyer disputes anyway. The copilot assembles the proof and the operator approves it." |
| 1:42 | Second dispute; mandate diff widget; Accept | "When the agent really did overreach, we refund without a fight." |
| 2:02 | Dashboard; Studio agent answers a question | "Which agent platforms cause the most wrong-item disputes?" |
| 2:17 | Honesty line; end card with repo link | "Any AP2 agent works today. We implement the mandate shape ourselves; PayPal's production systems do not yet read it." |

Dry runs Nov 9 and Nov 10 with a timer. Final cut Nov 11 morning IST. Upload unlisted, test the link, then public.

## Judge click path

*To be filled in once M3 lands.* Hosted URLs, demo logins (viewer, operator) and the judge sandbox accounts go in
the Devpost testing instructions, not here.

1. Shop → sign the example intent → let the agent build a cart → pay with the judge sandbox account.
2. Watch the agent try the red jacket → see the rejection and its reason codes.
3. Operations → Disputes → open the compliant-order dispute → preview evidence → (operator login) Submit.
4. Open the overreach dispute → mandate diff → Accept.
5. Ask the Studio agent: "Which agent platforms cause the most wrong-item disputes this month?"

## What we will not claim

- That we are the first mandate product.
- That PayPal's production systems read our mandates.
- AP2, Verifiable Intent or PayPal certification.
- Any number on screen that doesn't trace to seed data or a real sandbox order.
