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

Use the judge sandbox shopper and operator credentials from the Devpost testing instructions. The hosted
shop demonstrates checkout and sandbox dispute actions. The local mock stack supplies the historical
overreach case for inspection. [Local setup](SETUP.md#1-zero-credentials-judges-new-teammates)

1. Open the [shop](https://poi-buyer.iotkiit.in/shop), keep the grey running jacket and USD 80 defaults, and
   click **Sign my intent**. The page shows the signed mandate and its hash.
2. Under the red USD 95 jacket, click **Propose this cart**. Look for `AMOUNT_EXCEEDS_MAX` and
   `ATTRIBUTE_MISMATCH`. The shop confirms that PayPal created no order or charge.
3. Under the grey USD 74 jacket, click **Propose this cart** and approve in PayPal with the sandbox shopper.
   When **Paid** appears, note the order id and PayPal order id shown under the verdict and the capture ID. In [Operations → Orders](https://poi-dashboard.iotkiit.in/orders),
   compare the captured order with the red cart's rejection in **Checkout verdicts**.
4. Create a fresh dispute for the paid order as the same judge sandbox shopper. Follow the
   [judge testing instructions](JUDGE_TESTING.md#hosted-checkout-and-dispute-tests), including the report form
   and the 4–5 minute sandbox-event delay. In
   [Operations → Disputes](https://poi-dashboard.iotkiit.in/disputes), locate that fresh case and click
   **Preview evidence PDF**. An operator testing the action
   on that fresh case can click **Escalate to a claim** at inquiry, wait for PayPal to open the
   claim, then click **Submit evidence to PayPal** when PayPal allows it.
5. **Hosted sandbox refund.** Buy as judge-2 and file a second fresh dispute using the same instructions.
   When PayPal allows
   the action, the operator selects **Override: accept the claim instead**, adds a note, and verifies the
   outcome. Reserve the evidence-submission dispute for step 4.
6. Open [Analytics](https://poi-dashboard.iotkiit.in/analytics) and inspect disputes and outcomes by platform.
7. Back in the shop, sign an intent and click **Let the agent choose**. The agent searches the store, proposes a cart,
   and the page lists what it did and the merchant's answer. It never proposes a product that breaks the signed limits.
8. **Agent alone.** Under "Your signing key" click **Save a PayPal wallet**, approve as the judge sandbox shopper on PayPal, and
   come back to the shop. Sign an intent, tick **Let the agent pay alone from my saved wallet** and propose the grey USD 74
   jacket: there is no PayPal step, and **Paid by your agent** shows the capture. The red USD 95 jacket is still refused with
   nothing charged, and a cart the merchant isn't sure about (the grey USD 79 rain shell) is held under **Waiting for your approval** instead of charged: click **Approve and pay from my wallet** to sign it and pay. (Checked on the mock stack
   and in the browser smoke test, and on the hosted sandbox shop for the wallet and the agent-alone payment; the held-cart approval and the wallet removal are mock-stack only so far.)
9. Open **Dispute Studio** from the sidebar (or the banner on Analytics). Click a row in the disputes grid and watch the
   mandate diff and the evidence PDF follow; click a slice of the donut to filter everything; switch to **Ask the AI**
   and try the starter prompts. The hosted data has no agent overreach, so the overreach rate reads 0% there.
10. The pre-prepared disputes expire before judging ends. Use your fresh cases for actions. The designated
    December backup IDs and access will be in Devpost's testing field. The
    [team verification record](JUDGE_TESTING.md#team-verification-record) tracks the account checks and backup handoff.

### Local mock walkthrough

1. Start a fresh local mock stack in replay mode. From the repository directory, run
   `docker compose exec api pnpm demo:seed`. [Seed setup](SETUP.md#load-the-mock-demo-dataset)
2. Open [local Disputes](http://localhost:3002/disputes). In `PP-D-1001`, choose **Preview evidence PDF** to
   inspect the signed record for the compliant order.
3. Open `PP-D-1002`. The historical mock capture pairs a red USD 95 jacket with a signed grey-under-USD 80
   mandate. Compare `AMOUNT_EXCEEDS_MAX` and `ATTRIBUTE_MISMATCH` in the mandate diff and read the recommended
   **Accept Claim & Refund** response. Seeded disputes are read-only.

### Before recording and submission

- Verify the complete hosted checkout and two designated sandbox disputes (one to defend, one for the override
  refund) with the supplied test accounts.
- Record the 1:42 overreach shot on the local seeded stack (`pnpm demo:seed`); the hosted sandbox has no
  overreaching capture to dispute.
- Copy the [judge testing steps](JUDGE_TESTING.md) into Devpost and add verified access and fresh dispute IDs
  in its testing field. Confirm both judge shopper accounts can sign in, buy and report a problem.
- Add the dated full eval report and its measured numbers to the README when #43 is complete.
- Use the analytics view at 2:02. Studio is built and checked locally with the real key (the hosted check is #123);
  time the Studio shot (a grid row click, a donut click, one Ask the AI prompt: a live answer takes about 15 to 25
  seconds) against the same slot, or record it separately. Common questions (a named dispute, counts, what needs
  attention, a buyer reply) are answered by a local planner, so those takes are repeatable and about a second each; only
  open-ended questions use the live model, so record more than one take of those (#124). `pnpm smoke:studio` checks the
  chat before you record.
- The buyer agent ("Let the agent choose") is not in the 2:30 script yet. Add a short shot after the signed intent if
  there is room, or keep it in the click path only.
- Judge disputes expire before Dec 15 (#122): the Devpost testing instructions must say judges file their own.
- Have a teammate run the click path from a clean browser and time both dry runs.

## What we will not claim

- That we are the first mandate product.
- That PayPal's production systems read our mandates.
- AP2, Verifiable Intent or PayPal certification.
- Any number on screen that doesn't trace to seed data or a real sandbox order.
