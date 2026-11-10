# Judge testing instructions

Copy the testing steps below into Devpost's testing field. Add the designated sandbox shopper and operator
credentials in that private field. The public repository contains the steps and verification status.

## Hosted checkout and dispute tests

1. Open the [shop](https://poi-buyer.iotkiit.in/shop). Keep the grey running jacket and USD 80 defaults, then
   select **Sign my intent**. Check that the signed mandate and its hash appear.
2. Propose the red USD 95 jacket. Check for `AMOUNT_EXCEEDS_MAX` and `ATTRIBUTE_MISMATCH` and the confirmation
   that PayPal created no order or charge.
3. Propose the grey USD 74 jacket. Approve with the designated **judge-1 sandbox shopper** from the Devpost
   testing field. Note the **order id** and **PayPal order id** the shop shows under the verdict
   (`Order ord_… · PayPal …`), and when **Paid** appears the capture ID. Find the order in
   [Operations → Orders](https://poi-dashboard.iotkiit.in/orders).
4. Create a fresh dispute for that payment. Sign in to [PayPal Sandbox](https://www.sandbox.paypal.com/) with
   the same judge-1 shopper. Open **Activity**, select the payment and choose **Report a problem**. Select
   **Different or not as described**, a physical product, **Other**, **I got a different item**, then **Color**.
   Enter a test description of at least 120 characters, the delivery date and refund amount. Choose **No**
   for returning the item and provide a reason. Seller contact is optional. Add a short note and submit.
   A suitable fictional test description follows.

   > This is a hackathon sandbox test purchase. I am reporting a color difference so the merchant can review
   > the signed purchase instructions and demonstrate its dispute evidence workflow.

5. Allow about 4–5 minutes for PayPal Sandbox to emit the dispute event. Open
   [Operations → Disputes](https://poi-dashboard.iotkiit.in/disputes), find the new case with the top-bar search
   (press `/`) using the order id or PayPal order id from step 3, and record the dispute ID. The search matches
   dispute ids, order ids and PayPal order ids, not capture ids. Confirm that the recommendation describes the grey USD 74 cart.
   If it has not appeared after five minutes, refresh and keep the order, capture and dispute ids for
   the team to check webhook delivery.
6. Open the case and select **Preview evidence PDF**. Compare the signed mandate, cart, capture and policy
   finding. For the action test, sign in as the designated operator. If the case is still an inquiry,
   select **Escalate to a claim**. Wait for PayPal's allowed actions to update, then select
   **Submit evidence to PayPal** when available. Record the resulting status.

   To check the record without trusting us, select **Download proof package (JSON)** on the same page. It holds the
   three signed mandates, their public keys, the PayPal references and the policy version. In a clone of the repository
   (Node 20+, `corepack enable`, `pnpm install`), run `pnpm proof:verify <file>`. It lists each check (signatures, key
   thumbprints, the hashes that bind the three mandates, the order's `custom_id` pointer and the hard rules) and says
   what a valid package does not show. On November 10 the package for `PP-R-HKU-10197912` passed all 13 checks.
7. For the refund test, open a separate private browser session and make a second grey USD 74 purchase as
   **judge-2**, then file a separate dispute using
   steps 4–5. Open that second case as the operator. When PayPal allows it, choose
   **Override: accept the claim instead**, add a note identifying the sandbox test and verify the outcome.
   Keep each case's order, capture and dispute ids with its result. Evidence submission and claim
   acceptance are one-shot actions, so each test needs its own case.
8. Open [Analytics](https://poi-dashboard.iotkiit.in/analytics). Follow **Dispute Studio** to inspect the
   widgets and the **Ask the AI** chat (Studio and its chat panel were confirmed present on the hosted dashboard on
   November 8). Use the starter prompts, which are built from the deployment's actual dispute IDs. Picking a dispute
   drives the mandate diff and the evidence preview. The KPI tiles, the class donut and the agent platform cards follow
   filters instead: click a donut slice or use the **Filters** panel. The hosted data has no agent overreach, because the
   shop refuses those carts before PayPal, so the overreach rate reads 0% there.

The hosted cases `PP-R-OKC-10196871`, `PP-R-TZQ-10196879` and `PP-R-HKU-10197912` have response dates of November 17,
November 26 and November 30. `PP-R-HKU-10197912` was filed on November 10 for the video and has no operator action yet.
Judging continues through December 15, so create fresh cases for action tests. The team will prepare another
designated pair around December 1 as a backup and put those IDs in Devpost's testing field.

## Local historical overreach

Follow [zero-credential setup](SETUP.md#1-zero-credentials-judges-new-teammates), then run
`docker compose exec api pnpm demo:seed`. Open local Disputes at `http://localhost:3002/disputes`.
Inspect `PP-D-1001` and its evidence PDF, then `PP-D-1002` and its failed amount and color checks.
These historical seeded cases support read-only inspection. Use fresh sandbox cases for PayPal action tests.

## Team verification record

Complete this record from the tested release before copying access into Devpost. Add credentials only in
Devpost's testing field. Keep #122 open until both shopper checks and the December backup are confirmed.

| Check | Required evidence | Status (November 10) |
| --- | --- | --- |
| judge-1 access | Sign in, buy, report a problem, match capture and dispute IDs | Awaiting team verification |
| judge-2 access | Sign in, buy, report a problem, match capture and dispute IDs | Awaiting team verification |
| Evidence action | Separate fresh case, preview, allowed-action result and timestamp | Awaiting team verification |
| Refund action | Separate fresh case, operator note, allowed-action result and timestamp | Awaiting team verification |
| December backup | Two fresh cases around December 1 with response dates checked | Pending December 1 handoff |
| Independent walkthrough | Teammate, release commit, browser, date and result | Awaiting team verification |
| Proof package | Download from a hosted dispute, run `pnpm proof:verify` | Passed November 10 on `PP-R-HKU-10197912`, 13 of 13 checks (team account, not a judge account) |

Submission also needs the confirmed Representative, the public video (#47) and the release and deployment
confirmation (#48). #49 closes once the Representative submits and Devpost displays the submitted state.
