# Submission copy and verification handoff

Prepared November 9, 2026 IST. This is reusable submission copy followed by the evidence still needed from the
team. It does not confirm that Devpost has been submitted. Owners: @sumedhag28 and the confirmed Representative.

## Project description

Proof of Intent gives a merchant a signed record of what a shopper authorized an AI agent to buy. The shopper
reviews and signs the item and spending limits. The buyer agent can propose a cart; the merchant verifies the
signatures, authority, catalog facts and purchase limits before creating or capturing a PayPal order. Ambiguous
semantic matches ask the shopper to confirm. A refused proposal creates no order or charge.

When a completed purchase is disputed, the operator can inspect the signed intent, the checked cart, the PayPal
capture and the policy finding. The copilot drafts an evidence preview or recommends conceding an overreach.
The operator reviews the record and initiates supported dispute actions. An operator can override a defend
recommendation with a recorded note. Studio answers read-only questions and drafts text for review.

Our buyer and merchant exchange the signed mandates through our merchant API. The PayPal order carries a
`custom_id` reference to that record. We do not claim PayPal validates the mandate or that intent compliance
alone proves delivery, legal authorization of every aspect of a transaction, or entitlement to Seller Protection.

## PayPal APIs and tools used

- Orders v2: create an order bound to the signed record, then authorize and capture after shopper approval.
  The explicitly authorized saved-wallet path uses a vaulted capture; uncertain carts wait for confirmation.
- Payment Method Tokens v3: shopper-approved setup and saved payment tokens for the unattended path.
- Webhooks: verify PayPal events and process them through the persistent inbox to update orders and disputes.
- Customer Disputes v1: retrieve case details and permitted actions, preview/submit evidence, accept a claim,
  message or escalate when PayPal allows it and the operator chooses the action.
- PayPal Agent Toolkit: sandbox dispute/tracking integration where used by the configured server. The
  application keeps credentials server-side and does not grant a model authority to move money.

## AI tools and their limits

The Vercel AI SDK connects the configured NVIDIA model to structured semantic-fit checking and cited
explanations/drafts. The buyer assistant proposes products and unsigned intent fields for review. Prompts and
replay keys are versioned. Common Studio questions use a deterministic read-only planner; open-ended questions
can use the configured model. Replay mode supports repeatable demonstrations without a provider call.

The [November 7 report](evals/2026-11-07.md) measured J1 20/20 after checkout guards, no mismatch labelled match,
J2 policy agreement with a policy citation 12/12, and schema validity after retry 31/31 model cases. J2 receives
the deterministic policy decision, so that result measures explanation faithfulness. These are fixed-set
historical results, not claims of general accuracy, a validated backup model or business impact. Include new
review-derived eval results only after the actual run is checked.

## Public links for the entry

| Field                                 | Value/status                                                          |
| ------------------------------------- | --------------------------------------------------------------------- |
| Hosted shop                           | https://poi-buyer.iotkiit.in/shop                                     |
| Hosted dashboard                      | https://poi-dashboard.iotkiit.in/                                     |
| Public repository                     | https://github.com/harshkumarsingh12/proof-of-intent                  |
| Setup                                 | [SETUP.md](SETUP.md)                                                  |
| Judge walkthrough                     | [DEMO.md](DEMO.md#judge-click-path)                                   |
| Testing instructions                  | [JUDGE_TESTING.md](JUDGE_TESTING.md)                                  |
| Release tag and deployed commit       | Awaiting release/deployment confirmation from #48; do not guess a tag |
| Public YouTube URL and final duration | Awaiting team recording, review and upload (#47)                      |
| Devpost project and Representative    | Awaiting team confirmation; reconcile with PROJECT.md section 6       |

## Private testing field

Copy the [judge testing instructions](JUDGE_TESTING.md) into Devpost's testing field. Add only the designated
judge sandbox shopper logins and operator access there. Keep passwords, access tokens and private keys out of
this repository, the public description, the video and screenshots. Use a fresh paid order and dispute for each
one-shot action. Keep evidence submission and the sandbox override refund on separate cases.

## Independent verification record

An unfilled row is pending, not passed. The reviewer must not be the walkthrough author. Record the release
commit and date with each result and keep credentials in the team's secret store.

| Issue | Required evidence                                                                                                                                                         | Reviewer/date/result |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| #45   | Clean browser follows README/DEMO; complete hosted payment, fresh compliant evidence preview, and separate sandbox override refund; local `PP-D-1002` inspected read-only | Pending              |
| #47   | Public YouTube opens signed out, duration under 3:00, no third-party logos/music, every scene labelled, outcomes match case IDs                                           | Pending              |
| #49   | Every public link checked signed out; release tag matches deployed build; testing field checked privately; confirmed Representative sees Devpost entry as submitted       | Pending              |
| #122  | Both judge shoppers sign in, buy and report a problem; fresh December backup pair recorded privately around Dec 1                                                         | Pending              |

Record video dry-run times for Nov 9 and Nov 10 and the final runtime here when the team supplies them. Keep
#45, #47, #49 and #122 open until their specific evidence exists. A prepared description or a successful PR
does not prove an external submission, account test or video upload happened.
