# Dispute copilot worker

**Path:** `apps/worker/` | **Owner:** @hoursgotviral-dev | **Backup:** @sumedhag28 | **Spec:** [0005-dispute-copilot.md](../../docs/specs/0005-dispute-copilot.md) | **Milestones:** M1, M2

Turns PayPal disputes into a recommendation and, for compliant orders, an evidence package. It only reads from
PayPal; dispute actions happen in the API after an operator click.

`src/main.ts` polls every `WORKER_POLL_MS` (default 5 s):

1. **Inbox** (`src/inbox.ts`): verified `CUSTOMER.DISPUTE.*` rows in `webhook_events` with no `processed_at`. Each
   dispute is re-read with the Agent Toolkit's `get_dispute`, matched to our order by `invoice_number`, classified
   by the deterministic tree (`src/classifier.ts`). J2 adds cited reasons and an evidence plan when available.
   A verified MANDATE_COMPLIANT order gets a JSON bundle and an attestation PDF, with a J3 cover note when
   available (`src/evidence.ts`, `src/pdf.ts`). A replay miss or provider failure falls back to the existing
   rule-only explanation and draft. The result is stored on the `disputes` row. A failing event is retried after a backoff (30 s doubling to an hour), and after 5 attempts is quarantined
   with its error, so it cannot block newer disputes (#164); several workers can run (events are claimed with a lease). Handling one twice gives the same row; an older delivery can't overwrite a newer one.
2. **Catch-up**: every `DISPUTE_SYNC_MS` (default 5 min) `list_disputes` finds disputes we don't hold, or hold an
   older version of, so a missed webhook still reaches the dashboard.

Needs `DATABASE_URL`; `PAYPAL_MODE` and `AI_MODE` as for the API.

## Test

```bash
pnpm vitest run apps/worker      # the inbox tests need DATABASE_URL (real Postgres), like packages/db
```

Unbuilt acceptance criteria are `ledger()` entries in this folder's `*.test.ts`. Turn each into a plain `test()` as you finish it.
