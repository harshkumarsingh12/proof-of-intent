# 0011: Shared server-side AI transport

|               |                                                  |
| ------------- | ------------------------------------------------ |
| **Status**    | Proposed                                         |
| **Owner**     | @sumedhag28                                      |
| **Reviewers** | @harshkumarsingh12, @srshriv, @hoursgotviral-dev |
| **Milestone** | M4                                               |
| **Issues**    | #174                                             |

## Context

Spec [0006](0006-ai-jobs.md) promises per-merchant daily limits. Today API, worker and buyer each count in
memory, reset on restart and count a fallback inside one logical call. The buyer duplicates provider selection,
NVIDIA options and failover rules. A two-second endpoint timeout also permits successive primary, fallback and
retry calls without one overall deadline. This proposal makes those controls consistent across processes.

## Design

Create a server-only `@poi/ai-transport` package with the existing AI SDK 4-compatible model adapter. It owns
environment parsing, endpoint construction, provider options, eligible failover, request telemetry and deadline
enforcement. It imports no prompt files, replay files or browser code. `@poi/ai` and buyer server routes use it;
browser code cannot import it. Existing error adapters preserve each caller's human-confirmation response.

Every physical provider invocation atomically consumes a persistent call reservation before network access.
Retries, tool-loop model steps and fallbacks each reserve separately. Failed calls consume their reservation:
the provider might have received the request. A process restart cannot restore spent capacity. No reservation
means no provider request. Replay and deterministic planners consume no capacity. SDK retries remain disabled.

One absolute deadline starts at job entry and covers reservations, primary, fallback and the job's one retry.
Each endpoint gets the lesser of its per-endpoint allowance and the remaining total. A caller's abort signal
also cancels the operation. An exhausted or aborted deadline prevents another provider invocation, including a
fallback. Database waits use the same remaining allowance. Late completions are ignored and cannot restart work.

| Job                          |        Per-endpoint allowance |                             Overall allowance |
| ---------------------------- | ----------------------------: | --------------------------------------------: |
| J1                           |                           2 s |                                           4 s |
| J2                           |                           5 s |                                          10 s |
| J3                           |                          10 s |                                          20 s |
| J4 model path                |                          10 s |                                          20 s |
| Buyer choose, draft and chat | remaining operation allowance | 20 s per operation, including tool-loop steps |

J1's unavailable result still requires shopper confirmation. Other unavailable jobs retain rule-only evidence
or a clear manual response. These deadlines bound waiting locally; an already accepted remote request may still
consume provider resources. Its reserved call remains charged.

## Interfaces

Shared schemas belong in `packages/contracts` and require the contract owners' review. Internal adapter types
remain in the transport package. The persistent storage interface is implemented by `@poi/db`:

```ts
type AiUsageReservation = { allowed: boolean; used: number; limit: number };
// The store derives UTC day from the database clock, not caller-supplied shopper text.
reserveAiCall(merchantId: string, limit: number): Promise<AiUsageReservation>;
```

Add the next available database migration at implementation time. Table `ai_daily_usage` has primary key
`(merchant_id, utc_day)`, nonnegative bigint `used` and `daily_limit`, and `updated_at`. Use an atomic capped transaction; concurrent
processes cannot both take the last slot. Do not implement read-then-write counting. UTC rollover creates a new
row. Retain counters for seven days; cleanup must never reset the current day. Expose count-only diagnostics to
authenticated operators through the existing health/operations surface if needed in a separate scoped change.

`MERCHANT_ID` comes from trusted server configuration for this single-merchant deployment, never a shopper
header or model argument. API, worker and buyer receive the same `DATABASE_URL` and `MERCHANT_ID`. Buyer gets a
server-only database connection, with a small pool. Deployment documentation must include this requirement.
Tests inject isolated stores and clocks; production live mode cannot fall back to an in-memory store.

`AI_DAILY_CALL_LIMIT` stays the deployment-wide per-merchant limit, default 500, zero disables live calls.
Parse it as a finite nonnegative integer; reject invalid configuration at startup. Different services must use
the same configured limit. Each reservation also applies the stored day's lowest observed limit, so a stale
process with a higher value cannot increase that day's cap. Persist a lower limit even when no call is allowed.
Raising a limit takes effect the next UTC day;
lowering it takes effect immediately and never erases prior usage.

Transport events carry request-local operation id, logical retry index, physical attempt index, job, provider,
model, primary/fallback role, bounded fallback/failure category, elapsed time and outcome. No prompts, signed
mandates, API keys, authorization headers, raw URLs or provider error bodies. Evaluation reports consume these
events and preserve actual model attribution introduced for #171. Observers cannot trigger another model call.

## Acceptance criteria

1. API, worker and buyer import one provider/failover implementation. Remove duplicate helpers and their
   source-identity test; behavior tests exercise the shared implementation instead.
2. A primary failure followed by backup success consumes two persisted calls and attributes the answer to
   the backup. Two retries across two endpoints consume four calls when budget and deadline permit.
3. Two independent database pools racing for the last call allow exactly one provider request. Restarting
   callers, fallback, retry and a buyer tool loop cannot exceed the cap. UTC rollover allows the next day's cap.
4. Zero budget, invalid configuration, database failure and reservation timeout make zero provider requests
   and produce each caller's documented unavailable response.
5. Fake-clock tests prove no primary, fallback, retry or tool-loop model call begins after the overall
   deadline. A hanging primary is aborted; a near-expiry primary cannot give the backup a fresh full budget.
6. Live mode requires the persistent store. Replay, deterministic Studio answers and offline tests work
   without database or provider credentials and consume no calls.
7. Build both Next.js apps to prove no transport, database or provider secret enters client bundles. Run lint,
   typecheck and the full suite against disposable PostgreSQL 16; request affected owners' review.

## Implementation handoff

After acceptance: first add the database reservation and concurrency tests; then transport plus budget/deadline
tests; then migrate AI jobs and buyer server callers; finally update environment/deployment docs and remove the
duplicates. Each implementation PR links this spec and has the affected owner's approval. Keep #174 open until
all acceptance criteria pass. This proposal does not claim persistent accounting is already implemented.

## Out of scope

Token-based billing, distributed tracing infrastructure, multi-tenant merchant onboarding, model changes,
payment authority changes and unrelated dashboard changes.

## Open questions

None required for implementation once the affected owners accept the package, database and deadline contracts.
