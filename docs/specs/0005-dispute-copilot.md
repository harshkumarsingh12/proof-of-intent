# 0005: Dispute copilot

| | |
|---|---|
| **Status** | In Progress |
| **Owner** | @hoursgotviral-dev |
| **Reviewers** | @sumedhag28, @harshkumarsingh12 |
| **Milestone** | M1 (skeleton), M2 (full cycle) |
| **Code** | `apps/worker` |

## Context

When a dispute arrives, the merchant needs the signed record turned into either evidence or a fair concession,
fast, with a person making the final call. Journeys C and D.

## Design

```
webhook → verify, persist, enqueue dispute.received
→ get_dispute (Agent Toolkit) → match seller transaction id to our order
→ no mandate?           → NO_MANDATE       → standard evidence by PayPal reason
→ custom_id ≠ mandate   → NO_MANDATE       → standard evidence, flagged MANDATE_MISMATCH
→ replay hard rules     → any failure      → AGENT_OVERREACH  → recommend accept
  (at capture time, with the ledger checkout saw)
→ checkout was STEP_UP  → shopper approved → MANDATE_COMPLIANT → build evidence package
→ replay J1             → not match        → INTENT_MISREAD   → recommend offer or accept
  (or confidence < 0.8) → match            → MANDATE_COMPLIANT → build evidence package
→ operator review (approve / edit / override with a note)
→ the one PayPal action the operator clicked; every step in audit_log
```

J2 (spec 0006) writes the explanation and evidence plan; the class itself follows the deterministic tree above,
so a dispute verdict can never contradict the checkout verdict.

**Evidence package (MANDATE_COMPLIANT):**
1. Attestation PDF (`@react-pdf/renderer`), generated from the audit log: intent in the shopper's words,
   constraints, signed cart, three mandate hashes, the `custom_id` on the PayPal order, signature results,
   verdict with timestamps.
2. JSON bundle: the three mandates, public keys, canonical hashes.
3. Fulfillment evidence by reason (tracking via Agent Toolkit `create_shipment_tracking` at fulfillment).
4. Cover note and buyer message from J3, edited by the operator.

**Operator rules:** reasons show reason codes and cited bundle ids; Submit disabled until the PDF preview was
opened; disputes with under 48 h to `seller_response_due_date` sort first; accept shows the refund amount and the
agent platform it's attributed to.

## Interfaces

`recommend(disputeId) → { class, action, reasons }`, `buildEvidencePackage(disputeId) → { pdf, bundleJson }` in
`apps/worker/src/pipeline.ts`. API surface in spec 0003 (`/disputes*`).

**As built (Nov 6).** The queue is the `webhook_events` table itself: the worker (`apps/worker/src/inbox.ts`) polls
verified `CUSTOMER.DISPUTE.*` rows with no `processed_at`, matches `invoice_number` to our order, runs the tree
above and stores the recommendation, the PDF and the bundle on the `disputes` row (migration 0002). Handling an
event twice yields the same row, so a crash before `processed_at` is set only repeats the work. The API serves
`GET /disputes`, `GET /disputes/:id/recommendation`, `GET /disputes/:id/evidence.pdf` and
`POST /disputes/:id/actions/{provide-evidence,accept-claim,send-message}`; actions need `Bearer OPERATOR_TOKEN`,
write the operator's audit row first, then call PayPal.

## Acceptance criteria

1. Overreach fixture → `AGENT_OVERREACH` → accept. *(ledger M2)*
2. Compliant fixture → `MANDATE_COMPLIANT` → evidence. *(ledger M2)*
3. PDF hashes equal the hash in `custom_id` and in the audit log (checked by a script). *(ledger M2)*
4. Killing the worker mid-dispute and restarting completes the job exactly once.
5. No PayPal call happens without an operator action row in `audit_log`.

## Out of scope

Make-offer flow (stretch); automatic submission without a human.
