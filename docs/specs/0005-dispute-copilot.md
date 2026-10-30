# 0005: Dispute copilot

| | |
|---|---|
| **Status** | Proposed |
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
→ replay hard rules     → any failure      → AGENT_OVERREACH  → recommend accept
→ replay J1             → not match        → INTENT_MISREAD   → recommend offer or accept
                        → match            → MANDATE_COMPLIANT → build evidence package
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

## Acceptance criteria

1. Overreach fixture → `AGENT_OVERREACH` → accept. *(ledger M2)*
2. Compliant fixture → `MANDATE_COMPLIANT` → evidence. *(ledger M2)*
3. PDF hashes equal the hash in `custom_id` and in the audit log (checked by a script). *(ledger M2)*
4. Killing the worker mid-dispute and restarting completes the job exactly once.
5. No PayPal call happens without an operator action row in `audit_log`.

## Out of scope

Make-offer flow (stretch); automatic submission without a human.
