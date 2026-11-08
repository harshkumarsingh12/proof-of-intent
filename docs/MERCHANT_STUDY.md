# Merchant evidence-preparation study

Prepared November 9, 2026 IST for #180. **Status: not run.** No merchant interviews or human timing results have
been collected. This protocol is ready for the team to use with consenting merchants or dispute operators.
Owner: @sumedhag28. Do not replace missing observations with estimates, model simulations or developer timings.

## Question and participants

Does the signed purchase record help an operator prepare a correct, complete response faster, and which
mistakes does it help them catch? Recruit 3–5 people with merchant support/dispute experience through the team's
own contacts. Record anonymous participant IDs, role and approximate experience. Obtain consent to take notes;
record audio only with separate permission. Use fictional case data and no real customer or payment access.

Ask before the task: How do you collect evidence today? Which missing facts slow you down? What makes you
concede rather than defend? What would make you distrust an AI-written dispute explanation? Do not demonstrate
the intended correct answer before the timed tasks.

## Standardized case pack

Use the same release, fictional source facts and task wording in both conditions. The baseline gets the raw
intent/cart/capture/policy excerpts in a plain document. The assisted condition gets those same facts in the
application and its preview. Both have the same factual information and a blank response form. No tool gets
delivery, cardholder or refund proof absent from the raw pack. Export the baseline pack from the seeded release
and verify it against the UI before starting; record the commit and pack version.

| Case                      | Source facts                                                                                                                                    | Expected decision and boundaries                                                                                                       |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| A: compliant purchase     | Grey running jacket requested, USD 80 cap; grey Stride jacket USD 74; verified mandate/pointer, passing checks and capture record (`PP-D-1001`) | Prepare purchase-intent evidence for operator review. Do not assert delivery, cardholder authorization or a refund from capture alone. |
| B: historical overreach   | Same grey/USD 80 mandate; red Stride jacket USD 95; historical captured order and failed amount/color checks (`PP-D-1002`)                      | Identify both failures and recommend concession. Explicitly historical and read-only; current checkout would reject it before capture. |
| C: ambiguous substitution | Running jacket requested; grey USD 79 hooded rain shell; hard limits pass; semantic result partial                                              | Identify the semantic gap. Require shopper confirmation before capture; do not treat a proposal or a held cart as a completed payment. |
| D: missing mandate        | Fictional disputed payment with no signed intent or matching pointer                                                                            | Use the standard dispute-evidence path; state which proof is missing. Do not invent signed authorization.                              |

Create a second matched version of each case with changed fictional IDs and amounts that preserve the same
decision and difficulty. Give each participant two baseline and two assisted cases, using different versions.
Alternate baseline-first and assisted-first between participants, rotate case order, and counterbalance which
case class gets assistance. Keep the assignment table before collecting outcomes. This small exploratory study
cannot eliminate learning effects; report that limitation.

Task wording: **“Prepare the response you would hand to an authorized operator for review. State your
recommendation, supporting facts, missing evidence and any mistake you caught. Do not perform a payment or
dispute action.”** Give the same two-minute navigation orientation to both conditions, outside the task timer.

## Measurement and scoring

Start timing when the participant opens the case. Stop when they say the response is ready for review.
Include navigation, evidence collection and editing. Log interruptions separately. Cap each case at ten minutes;
record a timeout as censored rather than treating it as a successful ten-minute completion. Record technical
failures and retry time. Do not remove a failed assisted session from the results.

Score the final response against these eight items. One point per correct applicable item; record explicit
N/A for inapplicable items and show the applicable denominator. A second teammate scores without seeing timing
or condition, then resolves disagreements with a short note.

1. Correctly identifies the order/dispute and links the relevant records.
2. Accurately describes the shopper's signed intent, or explicitly says it is unavailable.
3. Accurately describes the proposed/purchased product and amount.
4. Identifies relevant passed/failed rules, including both amount and color in case B.
5. Distinguishes proposal, shopper approval and confirmed capture.
6. Gives the correct defend/concede/confirmation/standard-path recommendation for this case.
7. States missing facts and avoids unsupported delivery, cardholder-authorization or completed-refund claims.
8. Identifies the required human review and makes no claim that a read-only inspection performed an action.

Record critical mistakes separately: unsupported factual assertion, defending known overreach, capturing an
unconfirmed ambiguous cart, invented authority, wrong case linkage or claiming an unperformed action. Record
which mistakes the participant noticed and corrected, with the supporting quote or screen reference.

## Observation form

| Participant   | Experience | Case/version | Condition/order | Start/end | Elapsed seconds or timeout | Score/applicable | Critical mistakes remaining | Mistakes caught | Interruptions |
| ------------- | ---------- | ------------ | --------------- | --------- | -------------------------- | ---------------- | --------------------------- | --------------- | ------------- |
| Not collected |            |              |                 |           |                            |                  |                             |                 |               |

After the tasks ask: What changed your decision? Which evidence mattered? What was still missing? What did you
double-check? Would this fit your existing workflow, and what would prevent adoption? Capture disagreements and
negative feedback alongside positive comments. Ask permission before quoting an anonymous comment publicly.

## Results and closure

Publish the tested commit, dates, participant count/experience, assignments, raw anonymized observations and
scoring notes. Show individual times, successful completion counts, timeouts, median time by condition, score
denominators and critical-error counts. If reporting a paired time change, show each participant's comparable
pair and the calculation; explain that case versions and learning can affect the comparison. Do not claim
statistical significance, reduced real chargebacks or a population-wide saving from this small study.

| Required result                                | Current status              |
| ---------------------------------------------- | --------------------------- |
| Merchant/operator interviews                   | Not collected               |
| Timed baseline and assisted cases              | Not collected               |
| Independently scored completeness and mistakes | Not collected               |
| Anonymized findings and limitations            | Pending actual observations |

Keep #180 open until the interviews, timings, completeness scores and mistakes-caught findings exist and have
been reviewed. The submission may currently say the project has a technical demonstration; it cannot claim
validated merchant time savings. Do not contact participants or publish their comments without team approval
and their consent.
