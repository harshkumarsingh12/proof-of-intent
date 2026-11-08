# @poi/db

**Path:** `packages/db/` | **Owner:** @harshkumarsingh12 | **Backup:** @hoursgotviral-dev | **Spec:** [0003-checkout-and-verification.md](../../docs/specs/0003-checkout-and-verification.md) | **Milestones:** M1

Postgres schema, migrations and the append-only audit log. Driver: `pg`.

```ts
import { createDb } from "@poi/db";

const db = createDb(process.env.DATABASE_URL!);
if (!(await db.claimNonce(intent.nonce))) reasons.push("NONCE_REPLAYED");
await db.appendAudit({ actor: "api", action: "verdict", subjectId: orderId, requestBody: verdict });
const timeline = await db.auditTrail(orderId); // oldest first, each row has `at`
```

## Schema

`migrations/0001_init.sql`: `shoppers`, `shopper_keys` and `agent_keys` (with `retired_at`), `mandates` (canonical
bytes + JWS), `nonces`, `orders`, `verdicts`, `webhook_events`, `disputes`, `audit_log`.
`migrations/0002_dispute_copilot.sql`: on `disputes`, the PayPal object and its `update_time`, the recommendation,
the evidence PDF and the JSON bundle.

`migrations/0003_stepups.sql`: step-up links. `migrations/0004_vault_setups.sql`: which shopper a Vault v3 setup token
was made for, claimed once (`createVaultSetup`, `claimVaultSetup`, `releaseVaultSetup`, `saveVaultId`). `migrations/0005_shared_vault_id.sql`: `shoppers.vault_id` is no longer unique, because PayPal gives the same payment token to the same PayPal account and a new browser key is a new shopper row (`countVaultHolders` says whether anyone else still holds a token).

Beyond checkout's methods, `Db` has the worker's inbox (`claimDisputeEvents`, `markEventProcessed`, `failDisputeEvent`, #164), disputes
(`saveDispute` refuses an older PayPal version, `getDispute`, `listDisputes` deadline first), the dashboard grids
(`listOrders`, `listVerdicts`, `orderVerdict`), `activeLedger(intent, now)` and `reserveOrder` (spending reserved atomically per intent, #155), `mandateLedger(intent, asOfOrderId)` for what an order's checkout
saw, and keys (`registerShopperKey`, `registerAgentKey`, `retireKey`).

- Replay protection and idempotency are unique indexes (`nonces`, `webhook_events.event_id`, `mandates.hash`,
  PayPal ids on `orders`), never "check then insert".
- `audit_log` is append-only: a trigger refuses `UPDATE`, `DELETE` and `TRUNCATE`. To reset demo data, drop and
  recreate the database.
- Money columns are integer minor units plus `currency`.

## Migrations

New change → new file `migrations/NNNN_name.sql`; never edit one that has shipped. `migrate()` applies pending
files in name order, each in its own transaction, under an advisory lock so the api and worker can start together.

```bash
pnpm --filter @poi/db migrate          # uses DATABASE_URL
```

In Compose, the one-shot `migrate` service runs this before `api` and `worker` start.

## Test

The tests use a real Postgres and create a throwaway database per run. CI provides one; locally:

```bash
docker run -d -p 127.0.0.1:5432:5432 -e POSTGRES_USER=poi -e POSTGRES_PASSWORD=poi -e POSTGRES_DB=poi postgres:16-alpine
DATABASE_URL=postgres://poi:poi@localhost:5432/poi pnpm vitest run packages/db
```

Without `DATABASE_URL` the db tests are skipped, so `pnpm test` still works with no setup.
