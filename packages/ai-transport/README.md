# @poi/ai-transport

Server-only provider selection, eligible failover, physical-request reservations, deadlines and telemetry.
Owner: @sumedhag28. Design: [spec 0011](../../docs/specs/0011-shared-ai-transport.md), proposal #221.

Create one `Operation` at job entry and reuse it across retries or tool steps. Its absolute deadline includes
database reservations and both endpoints; a fallback cannot get a fresh overall budget. Each actual HTTP fetch
awaits a persisted reservation. Denied/failed usage storage produces no provider request; late completions are
ignored. Production live mode needs `DATABASE_URL`, trusted `MERCHANT_ID` (default merchant-trailhead), and the
existing AI provider variables. The default database pool has two connections and does not keep CLI jobs alive.

`AI_DAILY_CALL_LIMIT` defaults to 500, accepts only nonnegative safe integers, and zero disables provider calls.
Retries, fallbacks and model steps consume separately. Counters survive process restarts and use the database's
UTC day. Explicit `UsageStore`/fetch injection is for tests or trusted server composition, never model arguments.

Events identify the operation/job/retry, endpoint role and provider/model, HTTP request count, elapsed time and
bounded failure category. Prompts, URLs, headers, keys and provider error bodies are excluded. Observer failures
cannot cause another call. Current consumers use non-streaming generation; streaming is rejected before access.
Browser imports resolve to a guard module; provider/database code stays on the server.
