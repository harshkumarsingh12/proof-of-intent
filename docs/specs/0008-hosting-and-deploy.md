# 0008: Hosting and deploy

|               |                                                                                                                     |
| ------------- | ------------------------------------------------------------------------------------------------------------------- |
| **Status**    | In Progress                                                                                                         |
| **Owner**     | @harshkumarsingh12                                                                                                  |
| **Reviewers** | @srshriv                                                                                                            |
| **Milestone** | M0 (server up), M2 (monitoring), M4 (release)                                                                       |
| **Code**      | `docker-compose.yml`, `Dockerfile`, `Caddyfile`, `.github/workflows/deploy.yml`; Dokploy project on the team server |

## Context

The demo must stay up from submission through **Dec 15, 8:00 am PT** (end of judging), and PayPal must be able to
deliver webhooks to it. The team runs it on its own server; the same Compose file is the judges' local setup.

## Design

| Concern   | Plan                                                                                                                                                                                                                                                                                                                                                                                                 |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Services  | `postgres`, `api`, `worker`, `buyer`, `dashboard`, one-shot `migrate`, and `caddy` + `backup` (profile `server`); `restart: unless-stopped`; health checks on HTTP services. Host ports are `127.0.0.1`-only and configurable (`API_HOST_PORT`, `SHOP_HOST_PORT`, `OPS_HOST_PORT`, default 3000–3002)                                                                                                |
| HTTPS     | **Decided (D6):** Dokploy's proxy with Let's Encrypt, behind Cloudflare, on `poi-api.iotkiit.in`, `poi-buyer.iotkiit.in` and `poi-dashboard.iotkiit.in` (D7). Single-level names because Cloudflare's free certificate covers one level. Caddy (profile `server`) stays for servers without Dokploy                                                                                                  |
| Uptime    | Two monitors (docs/MONITORING.md): a dedicated external one you create (keyword checks on the API's `/readyz` and the shop's and dashboard's `/healthz`, alerting the team chat), and the in-repo `uptime.yml`, which checks the same URLs every 5 minutes from GitHub and messages the chat on down and on recovery; Compose starts on boot. `/healthz` is liveness only. `/readyz` runs `select 1` (2 s timeout) and answers 503 `database: unreachable` when Postgres can't be reached, and the API container's Docker healthcheck uses it (#120)                                                                                                                                                                                                                                                                                     |
| Isolation | Own Docker network; only the proxy publishes ports; Postgres unreachable from outside; non-root containers                                                                                                                                                                                                                                                                                           |
| Abuse     | Per-IP rate limits (built, `apps/api/src/rate-limits.ts`): `/checkout` 30/min, `/webhooks/paypal` 300/min, `/keys/shopper` and `/vault/setup`, `/vault/save` 10/min, `/ai/studio` 60/min (a chat question is several requests; the daily AI budget bounds spend), 429 `rate_limited`; `TRUST_PROXY=1` behind the proxy. AI budget kill switch. The dashboard is read-only without the operator login |
| Reads     | The API's reads of merchant data (`/orders`, `/verifications`, `/disputes*`, evidence PDFs) need `Bearer OPERATOR_TOKEN` whenever it is set (#163); unset, the API runs open for the zero-credential mock stack, and `/readyz` shows `reads: protected` or `open`. The dashboard's server components and `/api` proxy send the token, so the judge demo still shows its synthetic data to a viewer. `VIEWER_LOGIN_REQUIRED=1` (dashboard) asks for the operator login before any page or `/api` call, for a deployment with real merchant data; it needs `OPERATOR_PASSWORD`, or the dashboard refuses everything. `/healthz` and static assets stay open. |
| DNS       | Containers send outside lookups to `1.1.1.1` / `8.8.8.8` (`dns:` in compose, #88) after the host resolver dropped one (`EAI_AGAIN`, Nov 6)                                                                                                                                                                                                                                                           |
| Backups   | `backup` service (profiles `server` and `backup`): `pg_dump` at start and every 24 h, 7 days kept, atomic writes, a healthcheck that fails when no dump is under 26 h old; on Dokploy `COMPOSE_PROFILES=backup` and `BACKUP_DIR=backups` (a named volume that survives deploys); restore in docs/SETUP.md. No nightly demo reset (decided Nov 9, #203: the database holds the real sandbox disputes judges file, so a reset would delete their cases; the seeded demo rows are already read-only)                                                                                                                                                                                                                                                           |
| Secrets   | Server `.env` (mode 600) outside git; GitHub Actions secrets for CI/CD                                                                                                                                                                                                                                                                                                                               |
| Release   | Dokploy redeploys on every push to `main`. Tag `v*` → `deploy.yml` still builds the 4 images to GHCR and, where SSH secrets are set, runs `compose pull && up -d` with a health check inside the `api` container, then a GitHub Release                                                                                                                                                              |

Deploy never runs on pull requests, and no self-hosted runner is used on this public repo.

### Compose networks (#121)

Every service in `docker-compose.yml` writes `networks: [poi]` itself, and the shared `x-app` anchor carries no `networks`.
Dokploy rewrites the file on deploy to attach its own network and does not resolve `<<: *app` merge keys, so a network
inherited through the anchor looked missing to it and was replaced by Dokploy's. The recreated app containers then sat on a
different network from `postgres` and answered `getaddrinfo ENOTFOUND postgres` (Nov 6 and Nov 7). `apps/api/src/compose.test.ts`
fails if the anchor gets `networks` back or a service lacks its own. Checked locally by recreating the app containers while
`postgres` kept running: all of them still resolve it. **Confirmed on the team server** (Nov 8, #121 closed): after a redeploy that recreated the app containers, `/readyz`,
`/disputes` and the dashboard all worked.

### Uptime monitoring (#38)

There was no monitor at all. Two now exist (docs/MONITORING.md): a **dedicated** one you create at a monitoring service, and an
**in-repo** one, `.github/workflows/uptime.yml`, that runs `scripts/ops/uptime-check.sh` every 5 minutes from GitHub's network, so it
still works when the server does not. Both check the API through **`/readyz`** (database reachable, matched on the body text, not
just the status code) and the shop and dashboard through `/healthz`.

The in-repo monitor is **off until the repository variables `PUBLIC_API_URL`, `PUBLIC_SHOP_URL` and `PUBLIC_DASHBOARD_URL` are set**
(the job is skipped visibly rather than passing), and it messages a Slack or Discord webhook (`UPTIME_WEBHOOK_URL`) only when the
state changes: once on down, once on recovery, not every 5 minutes. GitHub runs schedules best effort (a run can start late, and
schedules stop after 60 days of repo inactivity), so it is the backup monitor, not the main one.

_Tested_: the check script against the real hosted site (all three up), and against a local server returning a 503 with the database
unreachable, a 200 with the wrong content, a flaky first request (retried, passes), and nothing listening; the alert script's
decision matrix, real delivery of the payload to a local webhook (valid JSON, special characters escaped, both `text` and `content`),
and an unreachable webhook (warns, never fails the job); and the two steps run back to back. `actionlint` and `shellcheck` pass. What
could not be tested here: GitHub actually running the schedule, and any real chat integration.

### Release verification (#175)

The tag-release workflow used to end with `sleep 15` and one `/healthz` call on the API, and it published the GitHub Release
even when nothing had been deployed. `/healthz` never touches Postgres, so it stays green while every route answers 500
(the Nov 6 and Nov 7 outages). Now:

- **`scripts/deploy/verify-release.sh`**, run on the server after `up -d`, checks in order and stops at the first failure,
  naming it: `migrate` exited 0; `postgres` healthy; the API's **`/readyz`** answers 200 **with the database reachable**; the
  shop and the dashboard answer `/healthz`; the **worker** is healthy; and, when the `backup` service runs, a dump less than 26
  hours old exists. A service that is still starting is waited for (`VERIFY_TIMEOUT`, default 120 s each).
- **The worker has no port**, so it leaves a heartbeat: after every *successful* poll of the dispute inbox it touches
  `/tmp/worker-heartbeat` (`apps/worker/src/heartbeat.ts`), and its compose healthcheck fails when that file is older than a
  minute. So "healthy" means it is polling and the database answers. A hung database query never beats, so a stuck worker
  turns unhealthy even though its process is alive and logs nothing. Docker only *shows* `unhealthy`; it does not restart the
  container (a restart policy acts on exit), so a stuck worker needs `docker compose restart worker`.
- **`verify-public`** (a second job in `deploy.yml`) checks what people actually reach, from the runner: the API's `/readyz`
  and the shop's and dashboard's `/healthz`, through the proxy and certificate. It is configured by the repository
  **variables** `PUBLIC_API_URL`, `PUBLIC_SHOP_URL` and `PUBLIC_DASHBOARD_URL`, and runs even when nothing was deployed over
  SSH (a Dokploy server deploys from `main`, not from the tag). When the variables are unset it passes with a loud warning
  that nothing was checked, and says so a second time when there was no SSH deploy either.
- **`release`** needs both jobs, so a failed check means no release is published.

Limits: neither job can tell *which commit* is live, only that the live stack is healthy. On Dokploy, read the commit off its
Deployments tab. The API image reports no version yet.

_Tested against a real stack_ (the four images built from this compose file, isolated settings): healthy gives `release
verified` in about 10 s; with the API cut off from Postgres's network the old `/healthz` check says `{"status":"ok"}` and the
script fails at "api ready (database reachable)"; a worker cut off from Postgres stays "healthy" until its heartbeat is a minute
old, then three failed probes mark it unhealthy and the script fails at the worker, and it recovers by itself after
reconnecting; with the backup service running, a fresh dump passes and an impossible age limit fails.

### Restore drill (#175)

A backup nobody has restored is a guess. `scripts/deploy/restore-drill.sh` restores a dump into a scratch database beside the
live one (never touching live data), compares table by table, and drops the scratch database. It uses `psql -v
ON_ERROR_STOP=1`: the restore command that SETUP.md used to give has no such flag, so a dump with a SQL error in it still
exits 0. It fails on a missing or corrupt file, any restore error, and a restored database with no tables or migrations; it
reports (without failing) a restored table that is behind live or missing.

_Run for real_ against a stack built from this compose file, after seeding the demo data (300 orders, 24 disputes, 600
mandates): the backup service's own 193 KB dump restored in under a second, 13 tables and 1,227 rows, every count equal to
live, five migrations, scratch database dropped, live data untouched. Refused as intended: a truncated file, a dump with one bad
statement (the old command exits 0 on it), an empty dump, and a scratch database left behind by an earlier drill. An older dump
taken before the data existed restores cleanly and the report shows `600 newer in live`.

**Not confirmed, and not something the repository can confirm:** that the *hosted* server takes backups on a schedule. The
repository now makes it a one-line change (see "Backups on Dokploy" below), but it only counts once someone has set the two
variables on the server, redeployed, and run the drill on a dump it produced: SETUP.md, "Setting up backups on Dokploy", has the
steps, and #38 tracks it.

### Backups on Dokploy (#38)

The `backup` service was in the `server` profile, which also starts caddy, so Dokploy (whose proxy holds 80 and 443) never started
it. And its dumps went to `./backups` inside the code directory, which Dokploy replaces on every deploy. So:

- The service now has its **own `backup` profile** (and is still in `server`): on Dokploy, `COMPOSE_PROFILES=backup` in the Environment
  tab starts the dumps and not caddy. Dokploy writes that tab to a `.env` file beside the compose file, and Docker Compose reads
  `COMPOSE_PROFILES` from it. A plain `docker compose up` is unchanged: no backup service for a judge's local run.
- **`BACKUP_DIR`** chooses where the dumps go: unset means `./backups`; `BACKUP_DIR=backups` is a **named volume**, which survives
  deploys and is what Dokploy's Volume Backups can copy off the server (they work on named volumes only).
- A **healthcheck** is healthy only while a dump less than 26 hours old exists, so a missing or stuck backup shows as `unhealthy`.
- `verify-release.sh` and `restore-drill.sh` read dumps *through* the service, so they work in either mode; `verify-release.sh`
  with `REQUIRE_BACKUP=1` (the SSH deploy sets it) fails instead of skipping when the service is not running.

Tested for real with the profile read from a `.env` file, then with a full stack in named-volume mode (see the PR for #38).

## Interfaces

Env: see `.env.example`. Repository secrets: `SERVER_HOST`, `SERVER_USER`, `SERVER_SSH_KEY`, optional
`SERVER_PORT`, `SERVER_DIR`. Images: `ghcr.io/<owner>/proof-of-intent-{api,worker,buyer,dashboard}:<tag>`.

## Acceptance criteria

1. `docker compose config` is valid and the API image builds in CI on every PR. _(done)_
2. `https://<api host>/healthz` returns 200 from outside the server. _(done: `https://poi-api.iotkiit.in/healthz`, Nov 5)_
3. A real sandbox webhook reaches the server and is verified. _(done Nov 7, #19: `pnpm sandbox:webhook-check` raised the delivery count 100 to 101 and a repeat left it at 101; `GET /readyz` reports the count)_
4. Uptime alert reaches the team chat within 5 minutes of stopping the API. _(M2)_ Built and tested: the in-repo monitor and its
   check and alert scripts (#38). **Not proven, and not something the repository can prove:** that the *dedicated* monitor is set up
   and that an alert actually arrives and how fast. docs/MONITORING.md has the setup and a way to test it without stopping the
   real API; write the measured time here.
   `/readyz` answers 503 when the database can't be reached. _(done, #120: `apps/api/src/api.test.ts`, and checked against a live and a dead database)_
5. Pushing `v0.1.0-hackathon` deploys, and the release is published only after `scripts/deploy/verify-release.sh` and (when
   configured) the public checks pass. _(M4; the script is tested against a real stack, see Release verification, #175)_

## Open questions

- ~~D6 Caddy vs Cloudflare Tunnel, D7 domain.~~ Decided Nov 5: Dokploy behind Cloudflare, `poi-*.iotkiit.in`.
- ~~The `backup` service is in the `server` profile, which Dokploy doesn't start.~~ It now has its own `backup` profile and a
  `BACKUP_DIR` for a named volume (#38). Still open: setting the two variables on the server and running the drill there.
  @harshkumarsingh12.
- A redeploy can leave `postgres` on a stale network so the API answers 500 (`ENOTFOUND postgres`) while `/healthz` and
  `/readyz` stay green (Nov 6 and Nov 7). Permanent fix: #121; `/readyz` now pings the database and answers 503 (#120, done). Recovery today:
  Stop then Deploy in Dokploy (SETUP.md, troubleshooting).
- If SSH from GitHub can't reach the server (NAT), deploy by running `docker compose pull && up -d` on the server
  manually after the images are pushed.
