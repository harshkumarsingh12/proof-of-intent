# Demo

**Owner:** @sumedhag28. This file is the video script and the judges' click path. Update it in the same PR as
any change to the demo path.

## Video (target 2:30, hard limit 3:00)

Recorded in `AI_MODE=replay` against the PayPal sandbox so every take is identical. 1080p, 30 fps; buyer and
merchant browsers side by side; dashboard in its light theme; voiceover recorded separately; captions on key
phrases so it works muted; no music; agent platforms named in speech only, **no third-party logos**.

| Time | Shot | Line |
|---|---|---|
| 0:00 | Title card | "When an AI agent buys the wrong thing, the merchant pays. We fix that on PayPal." |
| 0:12 | Buyer app: intent typed and signed; cart badge; PayPal button; capture | "The shopper signs what they want, and the merchant checks the cart against it before taking the money." |
| 0:47 | Agent proposes the red $95 jacket; rejected with reason codes | "A red jacket at $95 does not pass a grey-under-$80 mandate. No order, no charge." |
| 1:02 | Dispute on the compliant order; workspace; evidence PDF; Submit | "The buyer disputes anyway. The copilot assembles the proof and the operator approves it." |
| 1:42 | Second dispute; mandate diff widget; Accept | "When the agent really did overreach, we refund without a fight." |
| 2:02 | Analytics; disputes by agent platform | "Operators can see which agent platforms produce the most overreach in the demo data." |
| 2:17 | Integration note; end card with repo link | "The shop and buyer agent send signed mandates to our merchant API. We attach a reference to that record to the PayPal order." |

Dry runs Nov 9 and Nov 10 with a timer. Final cut Nov 11 morning IST. Upload unlisted, test the link, then public.

## Judge click path

Use the judge sandbox shopper and operator credentials from the Devpost testing instructions. For the
zero-credential local path, follow [SETUP.md](SETUP.md#1-zero-credentials-judges-new-teammates).

1. Open the [shop](https://poi-buyer.iotkiit.in/shop), keep the grey running jacket and USD 80 defaults, and
   click **Sign my intent**. The page shows the signed mandate and its hash.
2. Under the red USD 95 jacket, click **Propose this cart**. Look for `AMOUNT_EXCEEDS_MAX` and
   `ATTRIBUTE_MISMATCH`. The shop confirms that PayPal created no order or charge.
3. Under the grey USD 74 jacket, click **Propose this cart** and approve in PayPal with the sandbox shopper.
   When **Paid** appears, copy the capture ID. In [Operations → Orders](https://poi-dashboard.iotkiit.in/orders),
   compare the captured order with the red cart's rejection in **Checkout verdicts**.
4. In [Operations → Disputes](https://poi-dashboard.iotkiit.in/disputes), open the compliant-order dispute ID
   supplied with the testing instructions and click **Preview evidence PDF**. An operator testing the action
   on a designated sandbox dispute can click **Escalate to a claim** at inquiry, wait for PayPal to open the
   claim, then click **Submit evidence to PayPal** when PayPal allows it.
5. **Overreach (concede).** Checkout refuses an overreaching cart before PayPal (step 2), so the hosted sandbox
   never holds an overreaching capture to dispute. See this path on the zero-credential local stack:
   `pnpm demo:seed` ([SETUP.md](SETUP.md)) puts the scripted overreach dispute (the red USD 95 jacket against
   grey under USD 80, captured "before Proof of Intent was installed") second in the queue. Open it, compare the
   mandate and cart in the diff (`AMOUNT_EXCEEDS_MAX`, `ATTRIBUTE_MISMATCH`) and see **Accept Claim & Refund**
   recommended; seeded disputes are read-only. On the hosted sandbox an operator can still run the refund
   itself on a designated compliant dispute through **Override: accept the claim instead**, with a note. The
   dashboard shows the reason whenever an action is disabled.
6. Open [Analytics](https://poi-dashboard.iotkiit.in/analytics) and inspect disputes and outcomes by platform.

### Before recording and submission

- Verify the complete hosted checkout and two designated sandbox disputes (one to defend, one for the override
  refund) with the supplied test accounts.
- Record the 1:42 overreach shot on the local seeded stack (`pnpm demo:seed`); the hosted sandbox has no
  overreaching capture to dispute.
- Put the verified dispute IDs and the appropriate sandbox access in the Devpost testing instructions.
- Add the dated full eval report and its measured numbers to the README when #43 is complete.
- Use the analytics view at 2:02. If #39 lands and is verified on the hosted demo, time the Studio prompt
  against the same slot during the dry run.
- Have a teammate run the click path from a clean browser and time both dry runs.

## What we will not claim

- That we are the first mandate product.
- That PayPal's production systems read our mandates.
- AP2, Verifiable Intent or PayPal certification.
- Any number on screen that doesn't trace to seed data or a real sandbox order.
