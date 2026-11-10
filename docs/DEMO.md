# Demo

**Owner:** @sumedhag28. This file is the video script and the judges' click path. Update it in the same PR as
any change to the demo path.

## Video (target 2:30, hard limit 3:00)

Recorded against the PayPal sandbox, with the read-only seeded scenes and the Studio answer in `AI_MODE=replay` so those
takes are identical. 1080p, 30 fps; the dashboard in its light theme; voiceover recorded separately; captions on key
phrases so it works muted; no music; agent platforms named in speech only, **no third-party logos**. The rough cut of
November 10 follows this table exactly (2:44.5, captions burned in, no voiceover yet).

| Time      | Shot                                                                                                         | Line |
| --------- | ------------------------------------------------------------------------------------------------------------ | ---- |
| 0:00–0:12 | Title cards: "When an agent buys the wrong thing, the merchant pays."                                       | "AI agents are starting to shop for people. When an agent buys the wrong thing, the shopper disputes it, and the merchant pays. Merchants have no record of what the agent was actually allowed to do." |
| 0:12–0:18 | Title card: Proof of Intent, built on PayPal                                                                 | "Proof of Intent gives them that record, on PayPal, before any money moves." |
| 0:18–0:33 | Hosted shop: shopper signs grey running jacket, USD 80 maximum; mandate id and hash shown                    | "The shopper says what they want: a grey running jacket, under eighty dollars. Their browser signs it with a key that never leaves the device." |
| 0:33–0:47 | Red USD 95 proposal; `AMOUNT_EXCEEDS_MAX`, `ATTRIBUTE_MISMATCH`; "No PayPal order was created. Nothing was charged." | "The agent proposes a red jacket for ninety-five dollars. It breaks both limits, so the merchant refuses it before a PayPal order even exists." |
| 0:47–1:08 | Grey USD 74 proposal; PayPal Sandbox approval popup; **Paid** with the capture ID                            | "The grey jacket for seventy-four fits. The shopper approves it in PayPal, and only then is it captured. A pointer to the signed intent rides on the PayPal order." |
| 1:08–1:25 | Wallet saved at PayPal; **Let the agent pay alone** signed; **Paid by your agent** (waits shown at 2x)        | "With the shopper's signed permission and a saved wallet, the agent can pay alone, but only for carts that pass the same checks." |
| 1:25–1:31 | Card: **Sandbox event delay omitted**                                                                        | (pause) |
| 1:31–1:56 | Hosted dispute for that same order (`PP-R-HKU-10197912`): signed intent, mandate diff, **Preview evidence PDF**, **Download proof package (JSON)** | "Later, the shopper disputes that order. The copilot matches it to the signed record and drafts evidence from it." |
| 1:56–2:05 | `pnpm proof:verify` on that package: every check PASS (labels from the real run)                             | "Anyone can verify the proof package offline. No trust in us required." |
| 2:05–2:20 | Cut labelled **Historical seeded case · read-only**; local `PP-D-1002`; failed checks, **Accept the claim** recommended, no action clicked | "When an agent really did overreach, the same record says so, and the copilot recommends the fair answer: refund the shopper. A person approves every dispute action." |
| 2:20–2:34 | Dispute Studio on the seeded set, captioned **Synthetic demo dataset · AI replay**: a grid row drives the diff and preview; one **Ask the AI** answer | "Dispute Studio, built on AG Grid and AG Studio, shows which agent platforms overreach and what is due. The AI explains; it cannot act." |
| 2:34–2:44 | End card: the PayPal surfaces used and the public repository                                                 | "Orders, Vault, Webhooks, Disputes and the Agent Toolkit. Prevention before capture, and a fair answer after." |

The core story is one signed intent → invalid proposal blocked → valid payment completed → evidence inspected.
The historical case is a clearly labelled comparison. Keep the hosted refund test in the separate judge path;
do not splice a refund from another order into this story. If the final cut includes that test, display
**Separate sandbox action test · operator override**, show its own dispute ID and the confirmed outcome, and
stay under three minutes.

Keep **PayPal Sandbox** visible on all hosted payment/action shots and **AI replay** visible when recorded
answers are used. Show the order/capture/dispute IDs where the story changes screens, so their relationship can
be checked. Prepare a fresh dispute for the filmed paid order before recording the evidence shot; caption
**Sandbox event delay omitted** across any time cut. An older prepared case must instead be labelled
**Separate prepared sandbox case**. Never present a historical or prepared case as a live continuation.

Rough cut Nov 10 (2:44.5). Record the voiceover against these times, then the final cut Nov 11 IST. Upload unlisted,
test the link, then public.

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
   claim, then click **Submit evidence to PayPal** when PayPal allows it. On the same page, **Download proof package
   (JSON)** gives the record to check offline with `pnpm proof:verify <file>`
   ([how](JUDGE_TESTING.md#hosted-checkout-and-dispute-tests)).
5. **Hosted sandbox refund.** Buy as judge-2 and file a second fresh dispute using the same instructions.
   When PayPal allows
   the action, the operator selects **Override: accept the claim instead**, adds a note, and verifies the
   outcome. Reserve the evidence-submission dispute for step 4.
6. Open [Analytics](https://poi-dashboard.iotkiit.in/analytics) and inspect disputes and outcomes by platform.
7. Back in the shop, sign an intent and click **Let the agent choose**. The agent searches the store, proposes a cart,
   and the page lists what it did and the merchant's answer. It never proposes a product that breaks the signed limits.
8. **Agent alone.** Open **Your signing key & PayPal wallet** (below the limits form) and click **Save a PayPal wallet**, approve as the judge sandbox shopper on PayPal, and
   come back to the shop. Tick **Let the agent pay alone from my saved wallet** (it is signed into the intent), sign, and propose the grey USD 74
   jacket: there is no PayPal step, and **Paid by your agent** shows the capture. The red USD 95 jacket is still refused with
   nothing charged, and, under a freshly signed intent (one intent covers one purchase), a cart the merchant isn't sure about (the grey USD 79 rain shell) is held under **Waiting for your approval** instead of charged: click **Approve and pay from my wallet** to sign it and pay. (Checked on the mock stack
   and in the browser smoke test, and on the hosted sandbox shop for the wallet and the agent-alone payment; the held-cart approval and the wallet removal are mock-stack only so far.)
9. Open **Dispute Studio** from the sidebar (or the banner on Analytics). Click a row in the disputes grid and watch the
   mandate diff and the evidence PDF follow; click a slice of the donut to filter everything; switch to **Ask the AI**
   and try the starter prompts. Picking a dispute does not change the KPI tiles, the donut or the platform cards; they
   follow filters. The hosted data has no agent overreach, so the overreach rate reads 0% there.
10. **The limits form (optional).** In the shop, the **Quick start** buttons load a whole example (price, item, color and
    words). **Category** and **Color** can be left on **Anything** / **Any color**, but the price cap is always set. Type a
    request such as "a grey running jacket" and press **Enter** (or click **Fill in the limits from my words**): the agent
    fills in the limits, proposing a price cap and saying so if you named none, and you can edit anything before you
    sign. Where the browser supports speech (Chrome, Edge, Safari), **Speak your request** does the same from your voice.
    Nothing is signed or bought until you click **Sign my intent**.
11. The pre-prepared disputes expire before judging ends. Use your fresh cases for actions. The designated
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
- Record the 2:05 historical overreach shot on the local seeded stack (`pnpm demo:seed`); the hosted sandbox has no
  overreaching capture to dispute.
- Copy the [judge testing steps](JUDGE_TESTING.md) into Devpost and add verified access and fresh dispute IDs
  in its testing field. Confirm both judge shopper accounts can sign in, buy and report a problem.
- The dated eval reports and their measured numbers are in the README ([Nov 10 report](evals/2026-11-09T23-45-49-348Z-primary.md)).
  Don't name a model in the video.
- Use the Studio shot at 2:20. Studio is built, checked locally with the real key and live on the hosted dashboard (#123, closed);
  time the Studio shot (a grid row click, a donut click, one Ask the AI prompt: a live answer takes about 15 to 25
  seconds) against the same slot, or record it separately. Common questions (a named dispute, counts, what needs
  attention, a buyer reply) are answered by a local planner, so those takes are repeatable and about a second each; only
  open-ended questions use the live model, so record more than one take of those (#124). `pnpm smoke:studio` checks the
  chat before you record.
- Keep optional voice, wallet and agent-choice flows in the judge click path unless the core story has already
  passed a timed dry run. Do not remove the payment completion or evidence inspection to fit another feature.
- Judge disputes expire before Dec 15 (#122): the Devpost testing instructions must say judges file their own.
- Have a teammate run the click path from a clean browser and time both dry runs.
- Before publishing, check each scene's data label, its matching IDs and every claimed outcome. Record the
  tested release commit, reviewer, elapsed runtime and public video URL in [the submission handoff](SUBMISSION.md).

## What we will not claim

- That we are the first mandate product.
- That PayPal's production systems read our mandates.
- AP2, Verifiable Intent or PayPal certification.
- Any number on screen that doesn't trace to seed data or a real sandbox order.
