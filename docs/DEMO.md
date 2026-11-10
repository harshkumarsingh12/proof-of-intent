# Demo

**Owner:** @sumedhag28. This file is the video script and the judges' click path. Update it in the same PR as
any change to the demo path.

## Video (target 2:45, hard limit 3:00)

**Length:** 2:45 target, 3:00 hard limit (Devpost). About 390 words of voiceover at a calm 145 words a minute, which leaves room for pauses on the key screens.
**Format:** 1080p, 30 fps, no music, voiceover recorded separately. Captions on key phrases so the video works muted. Agent platforms are named in speech only, with no third-party logos.
**Recording mode:** PayPal Sandbox, with recorded AI answers (`AI_MODE=replay`) so every take is identical. Keep **PayPal Sandbox** visible on every payment and action shot, and **AI replay** visible wherever recorded answers appear.
**Rule for every cut:** never present a seeded, historical or prepared case as a live continuation. Label it on screen.

| Time | Shot | Voiceover | On-screen caption |
|---|---|---|---|
| 0:00–0:12 | Black title card, then a shopping-agent chat proposing a $95 red jacket | "AI agents are starting to shop for people. When an agent buys the wrong thing, the shopper disputes it, and the merchant pays. Merchants have no record of what the agent was actually allowed to do." | **When an agent buys the wrong thing, the merchant pays** |
| 0:12–0:20 | Product title card: Proof of Intent, built on PayPal | "Proof of Intent gives them that record, on PayPal, before any money moves." | **Proof of Intent** · built on PayPal |
| 0:20–0:40 | Shop: keep "grey running jacket, under $80", click **Sign my intent**. Show the authorization summary and the mandate hash | "The shopper says what they want: a grey running jacket, under eighty dollars. Their browser signs it with a key that never leaves the device. That signed intent is the limit for everything the agent does next." | **Signed in the shopper's browser** · Mandate and hash |
| 0:40–0:58 | Red $95 jacket, **Propose this cart**. Hold on `AMOUNT_EXCEEDS_MAX` and `ATTRIBUTE_MISMATCH`, then "No PayPal order was created. Nothing was charged." | "The agent proposes a red jacket for ninety-five dollars. It breaks both limits, so the merchant refuses it before a PayPal order even exists. Fixed rules decide. The AI can only make a verdict stricter, never looser." | **Refused before PayPal** · no order, no charge |
| 0:58–1:18 | Grey $74 jacket, **Propose this cart** → PayPal Sandbox approval popup → **Paid**, with the order and capture IDs | "The grey jacket for seventy-four fits. The shopper approves it in PayPal, and only then is it captured. A pointer to the signed intent rides on the PayPal order itself." | **Approved in PayPal** · intent pointer in `custom_id` |
| 1:18–1:32 | Wallet saved; **Let the agent pay alone from my saved wallet** signed; agent pays → **Paid by your agent** | "With the shopper's signed permission and a saved PayPal wallet, the agent can even pay alone, but only for carts that pass the same checks." | **Vault v3** · agent pays alone, within signed limits |
| 1:32–1:42 | Caption card over a clock | (pause, no voiceover) | **Sandbox event delay omitted** |
| 1:42–2:08 | Operations dashboard → Disputes → the fresh dispute for the order paid at 1:18 (dispute ID visible) → mandate diff → **Preview evidence PDF** → **Download proof package (JSON)** → terminal: `pnpm proof:verify`, all PASS | "Later, the shopper disputes that order. The dispute copilot matches it to the signed record and drafts evidence from it: what was signed, what was bought, and the policy finding. Anyone can verify the proof package offline. No trust in us required." | **Same order, now disputed** · dispute ID · **Verifiable offline** |
| 2:08–2:25 | Cut labelled **Historical seeded case · read-only**: `PP-D-1002`, failed amount and color checks, recommendation **Accept the claim** | "And when an agent really did overreach, the same record says so. Here, the fair answer is to refund the shopper, and the copilot recommends exactly that. A person approves every dispute action." | **Historical seeded case · read-only** |
| 2:25–2:38 | Dispute Studio: class donut filters the AG Grid, select a dispute, operator tasks and lifecycle stages; one **Ask the AI** answer | "Dispute Studio, built on AG Grid and AG Studio, shows which agent platforms overreach, what is due, and what is still missing. The AI explains; it cannot act." | **Synthetic demo dataset** · AI replay |
| 2:38–2:50 | End card: the PayPal surfaces used, the public repository URL, team names | "Orders, Vault, Webhooks, Disputes and the Agent Toolkit. Prevention before capture, and a fair answer after. That's Proof of Intent." | Orders v2 · Vault v3 · Webhooks · Disputes API · Agent Toolkit · github.com/harshkumarsingh12/proof-of-intent |

**Running time:** 2:50 with the pause card. If a dry run goes over 2:45, cut the agent-pays-alone shot (1:18–1:32) first: it's the least essential to the core story.

### Claims to keep accurate

- **What PayPal reads:** don't say PayPal reads or enforces our mandates. Say "a pointer rides on the PayPal order".
- **Standards and certification:** don't say "AP2 certified" or "any AP2 agent works". If standards come up, say "AP2-style mandates".
- **The demo dataset:** the Analytics and Studio figures describe synthetic cases, not a measured reduction in real disputes.
- **Model names:** don't name the AI model or provider. The script says "the AI" throughout.
- **Refunds:** an accepted claim is a refund PayPal still has to confirm. Don't show "refund issued" unless PayPal's outcome is on screen.

### Before recording

1. **The filmed order:** make a fresh sandbox dispute for the order you'll film, so the 1:42 shot shows the same order. If you use an older prepared case instead, caption it **Separate prepared sandbox case**.
2. **The proof package:** download it from the filmed dispute, and run `pnpm proof:verify <file>` in a terminal with a large font.
3. **Missing label:** add the "Synthetic demo dataset" label to Analytics and Studio, or keep it as a caption only. `docs/DEMO.md` promises the label, but the dashboard doesn't have it.
4. **Browser:** use a clean profile at 1080p, with the dashboard in its light theme and nothing personal in the bookmarks bar.
5. **Timing:** time two dry runs; both must come in at or under 2:45. Upload unlisted, test the link, then make it public.

## Judge click path

Use the judge sandbox shopper and operator credentials from the Devpost testing instructions. The hosted
shop demonstrates checkout and sandbox dispute actions. The local mock stack supplies the historical
overreach case for inspection. [Local setup](SETUP.md#1-zero-credentials-judges-new-teammates)

1. Open the [shop](https://poi-buyer.iotkiit.in/shop), keep the grey running jacket and USD 80 defaults, and
   click **Sign my intent**. The page shows the signed mandate and its hash, and a card of what it authorizes (item,
   spending, purchases, agent, payment mode and expiry). **What's left** below it says what has been spent and what
   remains once the merchant has seen the intent.
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
   jacket: there is no PayPal step, and **Paid by your agent** shows the capture (or **Payment pending at PayPal** until
   PayPal completes it; an order counts as paid only then). The red USD 95 jacket is still refused with
   nothing charged, and, under a freshly signed intent (one intent covers one purchase), a cart the merchant isn't sure about (the grey USD 79 rain shell) is held under **Waiting for your approval** instead of charged: click **Approve and pay from my wallet** to sign it and pay. (Checked on the mock stack
   and in the browser smoke test, and on the hosted sandbox shop for the wallet and the agent-alone payment; the held-cart approval and the wallet removal are mock-stack only so far.)
9. **Revoke (optional).** Under a signed intent the merchant has seen (propose any cart first), **What's left** reads, for
   the defaults, "Active", "Spent $0", "Next purchase up to $80", "Purchases left: One". Click **Revoke this intent**,
   then **Yes, revoke it**: **Intent revoked** says the merchant will refuse anything new under it, including carts
   waiting for your approval, and purchases already made stay as they are. Sign a new intent to shop again.
10. Open **Dispute Studio** from the sidebar (or the banner on Analytics). Click a row in the disputes grid and watch the
    mandate diff and the evidence PDF follow; click a slice of the donut to filter everything; switch to **Ask the AI**
    and try the starter prompts. Picking a dispute does not change the KPI tiles, the donut or the platform cards; they
    follow filters. The hosted data has no agent overreach, so the overreach rate reads 0% there.
11. **The limits form (optional).** In the shop, the **Quick start** buttons load a whole example (price, item, color and
    words). **Category** and **Color** can be left on **Anything** / **Any color**, but the price cap is always set. Type a
    request such as "a grey running jacket" and press **Enter** (or click **Fill in the limits from my words**): the agent
    fills in the limits, proposing a price cap and saying so if you named none, and you can edit anything before you
    sign. Where the browser supports speech (Chrome, Edge, Safari), **Speak your request** does the same from your voice.
    Nothing is signed or bought until you click **Sign my intent**.
12. The pre-prepared disputes expire before judging ends. Use your fresh cases for actions. The designated
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
- Record the 2:08 historical overreach shot on the local seeded stack (`pnpm demo:seed`); the hosted sandbox has no
  overreaching capture to dispute.
- Copy the [judge testing steps](JUDGE_TESTING.md) into Devpost and add verified access and fresh dispute IDs
  in its testing field. Confirm both judge shopper accounts can sign in, buy and report a problem.
- The dated eval reports and their measured numbers are in the README ([Nov 10 report](evals/2026-11-09T23-45-49-348Z-primary.md)).
  Don't name a model in the video.
- Use the Studio shot at 2:25. Studio is built, checked locally with the real key and live on the hosted dashboard (#123, closed);
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
