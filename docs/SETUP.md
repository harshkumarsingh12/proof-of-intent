# Setup

Three ways to run Proof of Intent, from least to most setup.

## 1. Zero credentials (judges, new teammates)

Needs Docker.

```bash
git clone https://github.com/harshkumarsingh12/proof-of-intent.git
cd proof-of-intent
cp .env.example .env
openssl rand -hex 32     # run it twice; paste one value after OPERATOR_TOKEN= and the other after OPERATOR_PASSWORD= in .env
docker compose up --build
```

Set both operator values before the first start. The shop needs `OPERATOR_TOKEN` to register its agent key (journey A),
and the dashboard's operator actions need both (log in as user `operator` with the `OPERATOR_PASSWORD` value).

The first `docker compose up --build` builds four images, which takes several minutes (about 8.5 minutes on a fresh
2-core machine, about 4.5 with the base images already pulled). It stays in the foreground: run the later
`docker compose exec` commands in a second terminal, or start the stack with `docker compose up --build -d`.

| Service              | URL                           |
| -------------------- | ----------------------------- |
| Shop (buyer app)     | http://localhost:3001         |
| Operations dashboard | http://localhost:3002         |
| API health           | http://localhost:3000/healthz |

Ports already taken on your machine? Set `API_HOST_PORT`, `SHOP_HOST_PORT` or `OPS_HOST_PORT` in `.env` (they
default to 3000, 3001 and 3002), then open the matching `localhost` port. Host ports bind to `127.0.0.1` only.

`PAYPAL_MODE=mock` serves PayPal responses from fixtures and `AI_MODE=replay` serves recorded model responses,
so journeys A–D run end to end without any account.

**AG Studio license.** Analytics and Disputes work without a license. Dispute Studio (`/analytics/studio`, a sidebar
item under Analytics) needs all of: `AG_STUDIO_LICENSE_KEY` (an AI-enabled key; request a free 45-day trial for React at
`https://www.ag-grid.com/studio/react/enterprise-licence/#request-a-45-day-trial-licence`), `OPERATOR_PASSWORD` and
`OPERATOR_TOKEN` in the dashboard's environment, and an API the dashboard can reach (`API_INTERNAL_URL`). If any is missing
the page says "Studio is unavailable on this deployment". Put the key on one line in `.env` with no quotes; it is a secret
like the PayPal secret. With an invalid key Studio renders with an "Invalid License Key" console warning.
Use the team's valid AI-enabled key for the demo. For new questions, set `AI_MODE=live` on both the API and
dashboard, with `AI_PROVIDER`, `AI_MODEL` and `AI_API_KEY` in the API environment. The dashboard reads the mode
to explain chat availability. In replay mode the chat still answers the common questions
without a model or recordings: a named dispute, a reply draft, counts, what needs attention, and what a term means.
Open-ended questions need live AI and get a clear unavailable response. Check the chat end to end with
`pnpm smoke:studio`. `pnpm studio:record` is only needed for open-ended recordings. [Recording steps and timings](evals/README.md#studio-starter-recordings). Studio's
report lives in the browser tab and nothing is saved; the chat's tools are read-only.

**The shop** (http://localhost:3001/shop) runs journey A: your browser makes a key and keeps it, you sign an
intent, the buyer agent proposes a product from the store (12 products in four categories: running jackets, road running shoes, base layers, socks), and the merchant approves, steps up or refuses it before any
PayPal order exists. In `PAYPAL_MODE=mock` an "Approve with PayPal (mock)" button stands in for PayPal; in sandbox
the real PayPal button appears (it needs `PAYPAL_CLIENT_ID`). The agent's key has to be registered with the API:
set `OPERATOR_TOKEN` in `.env` (any long random string) and the shop registers it on the first checkout. Without it,
proposing a cart answers "the merchant doesn't know this shop's agent key". Picking a category fills in its demo words, price and color; keep those words in replay mode, because
`AI_MODE=replay` has recorded J1 answers for exactly those (one per product in the category).
**Agent alone:** in the "Your signing key & PayPal wallet" panel (below the limits form, closed until you open it), "Save a PayPal wallet" runs Vault v3 (mock PayPal returns to the shop at once; sandbox sends the shopper to PayPal to approve, and `BUYER_PUBLIC_URL` on the API must be the shop's public address so PayPal can send them back). Then "Let the agent pay alone" lets an approved cart be charged to that wallet with no PayPal step; a cart the merchant isn't sure about is held for the shopper instead, and nothing is charged. The store is
`packages/contracts/src/catalog.ts`; after adding a product, add its label to `packages/ai/src/j1-cases.ts` and run
`pnpm ai:record` (it asks the live model only about the cases without an answer; `--all` re-asks every one).

**What's in the dashboard** (http://localhost:3002):

| Page           | Path                | Notes                                                                                                                           |
| -------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Home           | `/`                 | Disputes due in the next 24 hours, tabs (action required, defend, concede, resolved), quick links                               |
| Dispute queue  | `/disputes`         | Filters and sorting by deadline, age or amount                                                                                  |
| Dispute detail | `/disputes/<id>`    | Mandate diff, constraint checks, copilot recommendation, evidence preview, operator actions                                     |
| Analytics      | `/analytics`        | Defended vs. conceded, blocked carts, platform breakdown, disputes by class per week                                            |
| Orders         | `/orders`           | AG Grid of agent orders, plus a read-only "Checkout verdicts" tab                                                               |
| Dispute Studio | `/analytics/studio` | KPI tiles, class donut, platform cards, disputes grid, mandate diff, evidence preview, Ask the AI (needs the license key above) |

The top-bar search finds a dispute by dispute id, order id or PayPal order id (press `/` to focus it). The badge
and banner show the dashboard's `PAYPAL_MODE` (keep it the same as the API's). Pages show the API's disputes; if the
API can't be reached they fall back to seed data and say so in a banner. Operator actions need `OPERATOR_TOKEN` and
`OPERATOR_PASSWORD` in `.env` (user `operator` at the browser's login prompt); without them they answer
"operator actions are not configured" rather than faking success. With `OPERATOR_TOKEN` set the API also refuses to
answer reads of orders, disputes and evidence without it (the dashboard sends it for you; `curl` against the API needs
`-H "authorization: Bearer $OPERATOR_TOKEN"`). The dashboard shows its synthetic data to anyone with the link; set
`VIEWER_LOGIN_REQUIRED=1` to ask for the operator login first (it needs `OPERATOR_PASSWORD`).

### Load the mock demo dataset

With the local Compose stack running in mock mode against a fresh database, run:

```bash
docker compose exec api pnpm demo:seed
```

The command writes 300 fictional orders across four agent platforms and 24 disputes. In the dashboard's
dispute queue, `PP-D-1001` shows the compliant order and its PDF preview. `PP-D-1002` shows the historical
overreach and its failed amount and color checks. The seeded records are for read-only inspection.

For a local Postgres outside Docker, set `DATABASE_URL` and `PAYPAL_MODE=mock`, then run `pnpm demo:seed`
from the repository root. Seeding refuses remote databases, sandbox mode and databases with existing data.
A successful run can be repeated safely. The original records and deadlines are kept.

## 2. Development without Docker

Needs Node 20+ (the repo pins pnpm 9.12.3 in `package.json`).

```bash
corepack enable          # once; provides the pinned pnpm
pnpm install
pnpm test                # unit tests + ledger entries; db tests run when DATABASE_URL is set (packages/db/README.md)
pnpm dev:api             # :3000
pnpm dev:buyer           # :3001
API_INTERNAL_URL=http://localhost:3000 pnpm dev:dashboard   # :3002
```

The dev servers use the same ports as the Docker stack in §1: stop that first (`docker compose stop`).

Before you push, run what CI runs: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`. For the dashboard
alone: `pnpm vitest run apps/dashboard` and `pnpm --filter @poi/dashboard build`.

The dev servers don't read `.env`, so export what you need in the shell you start them from. With nothing set they run
with `PAYPAL_MODE=mock`, `AI_MODE=replay` and no database. The dashboard finds the API through `API_INTERNAL_URL`:
without it, its pages show the built-in sample data under a "Sample data." notice. Port 3000 taken? Give the API another
one with `PORT` and point the shop and dashboard at it:

```bash
PORT=3010 pnpm dev:api
API_INTERNAL_URL=http://localhost:3010 pnpm dev:buyer
API_INTERNAL_URL=http://localhost:3010 pnpm dev:dashboard
```

Postgres for local work: Compose doesn't publish Postgres's port, so create a `docker-compose.override.yml` next to
`docker-compose.yml`. Compose reads it automatically, including for the full stack. It is a local file: don't commit it.

```yaml
services:
  postgres:
    ports: ["127.0.0.1:5432:5432"]
```

Then run `docker compose up -d postgres` and `export DATABASE_URL=postgres://poi:poi@localhost:5432/poi` in the
shell where you run `pnpm test` and `pnpm dev:api`. If 5432 is taken, use another host port (for example
`127.0.0.1:5433:5432` and `localhost:5433`).

## 3. Your own PayPal sandbox

1. Create a REST app at [developer.paypal.com](https://developer.paypal.com/) under a sandbox business account.
   In the app's features, enable **Disputes** and **Vault**.
2. Create two sandbox personal accounts with funded balances and fictional details.
3. Set in `.env`: `PAYPAL_MODE=sandbox`, `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`.
4. Expose the API publicly (a Cloudflare Tunnel or ngrok to port 3000) and register a webhook at
   `https://<your-host>/webhooks/paypal` (the team's is `https://poi-api.iotkiit.in/webhooks/paypal`) with these events:
   `CHECKOUT.ORDER.APPROVED`, `PAYMENT.AUTHORIZATION.CREATED`, `PAYMENT.CAPTURE.COMPLETED`,
   `PAYMENT.CAPTURE.DENIED`, `CUSTOMER.DISPUTE.CREATED`, `CUSTOMER.DISPUTE.UPDATED`,
   `CUSTOMER.DISPUTE.RESOLVED`, `VAULT.PAYMENT-TOKEN.CREATED`. Put its id in `PAYPAL_WEBHOOK_ID`.
5. For live model calls: `AI_MODE=live` plus `AI_PROVIDER`, `AI_MODEL`, `AI_API_KEY`. NVIDIA is the default; `gemini`,
   `groq` and `openrouter` have their endpoints built in (any other OpenAI-compatible host needs `AI_BASE_URL`), and the
   Nemotron thinking switch is sent to NVIDIA only. Optionally set a backup: `AI_FALLBACK_MODEL` alone is another
   model on the same provider; with `AI_FALLBACK_PROVIDER=groq` and its own `AI_FALLBACK_API_KEY` it is a different provider
   (Groq's endpoint is built in). It is tried once when the primary model is gone, rate limited (429), erroring (5xx) or
   timing out; a bad key or a rejected request is never hidden by it. `pnpm ai:check` tests the primary and the backup
   separately (a structured answer and a tool call each). After editing a prompt in
   `packages/ai/prompts/`, run `pnpm ai:record` to re-record the replay answers (it uses the live model).
6. Merchant signing key: `pnpm keys:gen > merchant-key.pem`, then put it in `MERCHANT_SIGNING_KEY`.
7. Operator actions: `OPERATOR_TOKEN` (e.g. `openssl rand -hex 32`) and `OPERATOR_PASSWORD`.
8. Buyer agent key: `pnpm keys:gen > agent-key.pem`, then put it in `AGENT_SIGNING_KEY` (and `AGENT_PLATFORM`).
   Without it the shop makes a new agent key every time it starts, and registers each one.

Sandbox scripts (all need the PayPal variables in `.env`):

| Command                                                                  | What it does                                                                                                                                                                                                        |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm sandbox:checkout-smoke`                                            | Journey B against the sandbox: the red $95 cart is rejected, no PayPal order                                                                                                                                        |
| `pnpm sandbox:dispute-cycle start`                                       | A compliant order through a local API and database, then waits for you to file a dispute                                                                                                                            |
| `pnpm sandbox:dispute-cycle escalate\|evidence\|adjudicate\|status <id>` | Sandbox dispute steps (spec 0004 §Sandbox dispute recipe)                                                                                                                                                           |
| `pnpm sandbox:vault-wallet [--setup-only]`                               | Vault v3: a MERCHANT setup token, then (without `--setup-only`) you approve it on PayPal as a sandbox shopper, it becomes a vault id, and a $1.00 `CAPTURE` order charges it with nobody present (spec 0004 §Vault) |
| `POI_API_URL=… pnpm sandbox:webhook-check`                               | Asks PayPal to resend an old capture event to the registered webhook and reads `GET /readyz` `webhooks` (verified deliveries held): a new event raises the count by one, the same event again must not              |
| `POI_API_URL=… OPERATOR_TOKEN=… pnpm sandbox:hosted-order`               | A compliant order through a **deployed** API over HTTP only: registers keys, checks out, waits for your PayPal approval, captures                                                                                   |

Other checks you can run:

| Command                     | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm smoke:shop`           | Drives `/shop` in Chrome against a running mock stack (key, signed intent, refusal, capture, the agent buttons, and the refusal's near-miss hint and its button). `SHOP_URL=… pnpm smoke:shop` points it at a hosted shop and stops before PayPal. Needs Chrome (`CHROME_PATH`, `HEADED=1`). With the shop started with `BUYER_VOICE=1`, `VOICE=1 pnpm smoke:shop` also drives voice ordering through a fake speech recognizer (a spoken request, even one that contains "confirm", fills the limits and signs nothing; speaking again replaces them and the shopper edits and signs with a click). With `BUYER_CHAT=1` on the shop, `CHAT=1 pnpm smoke:shop` also drives the assistant (answers from the store's data, "Use these limits" fills the form without signing, a refusal is explained, a pasted token is refused). |
| `pnpm agent:eval`           | Runs the live buyer agent over eight cases with the real hard rules standing in for the merchant, and writes `docs/evals/agent-<date>.md`. Needs `AI_MODEL` and `AI_API_KEY`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `pnpm chat:eval [--backup]` | Runs the shop assistant against the real model (`--backup` for the backup): an invented product, a prompt injection, "buy it for me", a refusal, a comparison. Needs `AI_MODEL` and `AI_API_KEY`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

Filing the dispute is a manual step as the sandbox shopper: Activity → the payment → **Report a problem** →
"different or not as described" → item (Physical product, Other) → "I got a different item" → Color, a
description of 120+ characters, delivery date, refund amount, return **No** with a reason → seller contact
optional → a short note → Submit. PayPal shows it to the API a few minutes later.

## 4. Team server (owner: Harsh)

See [spec 0008](specs/0008-hosting-and-deploy.md) for the full plan. The team demo runs on **Dokploy** on the
team server, behind Cloudflare.

| App                       | Public URL                       | Compose service | Container port |
| ------------------------- | -------------------------------- | --------------- | -------------- |
| Shop                      | https://poi-buyer.iotkiit.in     | `buyer`         | 3001           |
| API (and PayPal webhooks) | https://poi-api.iotkiit.in       | `api`           | 3000           |
| Operations dashboard      | https://poi-dashboard.iotkiit.in | `dashboard`     | 3002           |

Single-level names under `iotkiit.in` on purpose: Cloudflare's free certificate covers only one level, so names
like `api.poi.iotkiit.in` would fail HTTPS. `https://poi-api.iotkiit.in/` returns a JSON 404 by design; check
`/healthz` instead.

**Dokploy setup** (the compose project `proof-of-intent`, deploying `main`):

1. **Source:** this repo's `docker-compose.yml`. Dokploy runs
   `docker compose -p <app> --env-file .env -f ./docker-compose.yml up -d --build` and redeploys on every push to
   `main`. Don't use an edited raw compose file in Dokploy, or repo changes won't reach the server.
2. **Domains tab:** add the three hosts above, each with its service and **container** port, path `/`, strip path
   off, HTTPS with Let's Encrypt. Redeploy after changing domains: Dokploy only applies them at deploy time.
3. **Environment tab:** Dokploy writes this tab to `.env`, and the repo ships no `.env`, so it must hold the full
   set, not just overrides. Start from:

   ```bash
   PAYPAL_MODE=mock                 # sandbox once the PayPal variables below are filled in
   AI_MODE=replay                   # live for real model calls; then also AI_PROVIDER, AI_MODEL, AI_API_KEY
   AI_DAILY_CALL_LIMIT=500
   # Optional backup model (Groq): AI_FALLBACK_PROVIDER=groq, AI_FALLBACK_MODEL=openai/gpt-oss-120b, AI_FALLBACK_API_KEY=<groq key>
   POSTGRES_PASSWORD=poi            # must match the password in DATABASE_URL
   DATABASE_URL=postgres://poi:poi@postgres:5432/poi
   MERCHANT_ID=merchant-trailhead
   MERCHANT_KEY_ID=merchant-1
   API_HOST=poi-api.iotkiit.in
   SHOP_HOST=poi-buyer.iotkiit.in
   OPS_HOST=poi-dashboard.iotkiit.in
   PUBLIC_BASE_URL=https://poi-api.iotkiit.in
   BUYER_PUBLIC_URL=https://poi-buyer.iotkiit.in   # where PayPal sends a shopper after approving a wallet, and step-up links open
   TRUST_PROXY=1
   # Dokploy and other apps hold 3000-3002 on this host. These are 127.0.0.1-only host ports,
   # for checks from the server itself; the public URLs go through Dokploy's proxy to the container ports.
   API_HOST_PORT=3100
   SHOP_HOST_PORT=3101
   OPS_HOST_PORT=3102
   OPERATOR_TOKEN=<openssl rand -hex 32>   # same value reaches api and dashboard; never shown to browsers
   OPERATOR_PASSWORD=<a password>          # dashboard login, user "operator"; share it only via Devpost
   AGENT_SIGNING_KEY=<pnpm keys:gen, \n escaped>   # the shop's buyer agent; registered on first checkout
   ```

   For sandbox, add `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID` and `MERCHANT_SIGNING_KEY`
   (see section 3), plus the AI and AG Studio variables from `.env.example` when you need them.

4. **Don't start the `server` profile** (Caddy) on Dokploy: Dokploy's proxy already holds ports 80 and 443. The
   `backup` service is in the same profile, so on Dokploy run backups from Dokploy's own scheduled backups or a
   separate job until that's split out.
5. **Expose only** `buyer`, `api` and `dashboard`. Never `postgres`, `worker`, `migrate` or `backup`. Only 80 and
   443 need to be open in the firewall.

**Check a deploy** from your machine:

```bash
curl -fsS https://poi-api.iotkiit.in/healthz         # {"status":"ok"}
curl -fsS https://poi-buyer.iotkiit.in/healthz
curl -fsS https://poi-dashboard.iotkiit.in/healthz
```

On the server: `curl -fsS http://127.0.0.1:3100/healthz` (the API's host port from the Environment tab).

**Troubleshooting**

| Symptom in the deploy log                                                                                                                        | Cause                                                                                                                                                                                              | Fix                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Bind for 0.0.0.0:3001 failed: port is already allocated`                                                                                        | Another service holds that host port                                                                                                                                                               | Set `SHOP_HOST_PORT` (or the API/OPS one) to a free port; find the holder with `docker ps --filter publish=3001`                                                                                                                                                     |
| `service "migrate" didn't complete successfully: exit 1`                                                                                         | Usually `DATABASE_URL` missing from the Environment tab, or a password that doesn't match the existing `pgdata` volume                                                                             | `docker logs <app>-migrate-1`; add the full env set above; Postgres keeps the password it was first created with                                                                                                                                                     |
| Plain-text `404 page not found` on a domain                                                                                                      | Dokploy's proxy has no route: domain not redeployed, a typo, or the wrong service                                                                                                                  | Redeploy; check the host, service and container port in the Domains tab                                                                                                                                                                                              |
| `getaddrinfo EAI_AGAIN api.sandbox.paypal.com` in api or worker logs                                                                             | The host's DNS resolver dropped a lookup                                                                                                                                                           | Compose sends outside names to `1.1.1.1` / `8.8.8.8` (`dns:` in `docker-compose.yml`); if the host firewall blocks outbound DNS to them, put the host's working resolver there instead. Calls that never reached PayPal are retried automatically                    |
| `getaddrinfo ENOTFOUND postgres` in api, worker or migrate logs; API routes answer 500 while `/healthz` is 200 (and, before #120, `/readyz` too); the dashboard says "Sample data" | A redeploy put the recreated containers on a new compose network and left `postgres` on the old one (Nov 6 and Nov 7)                                                                              | In Dokploy: **Stop**, then **Deploy** (the data is in the `pgdata` volume, do not delete volumes). On the server instead: `docker network connect --alias postgres <api's network> <postgres container>`. `/readyz` now answers 503 `database: unreachable` for this (#120), so a monitor on it catches it. Permanent fix: #121 |
| After approving a wallet on PayPal the shopper lands on `localhost`, or a step-up link opens `localhost`                                         | `BUYER_PUBLIC_URL` is missing from the Environment tab, so the API uses its local default (the API logs `BUYER_PUBLIC_URL is not set` at start in sandbox mode)                                    | Set `BUYER_PUBLIC_URL=https://poi-buyer.iotkiit.in` and redeploy; wallets saved before the fix are unaffected                                                                                                                                                        |
| Studio says "Studio is unavailable on this deployment"                                                                                           | Any of: no `AG_STUDIO_LICENSE_KEY`, no `OPERATOR_PASSWORD` or `OPERATOR_TOKEN`, or the dashboard can't reach the API (check the "Sample data" banner on `/disputes`)                               | Set the three variables in the dashboard environment, fix the API connection, redeploy                                                                                                                                                                               |
| Ask the AI says the chat can't answer, or answers "Studio AI is unavailable"                                                                     | `AI_MODE` is not `live` on the dashboard or API, the `AI_*` variables are missing, the daily call budget is used up, or the model timed out (the API logs `Studio AI unavailable` with the reason) | Set the variables on both containers; raise `AI_DAILY_CALL_LIMIT`; retry                                                                                                                                                                                             |
| `docker compose ps` shows the `worker` as `unhealthy` | It has not completed a poll of the dispute inbox for over a minute: Postgres is unreachable or a query is hung, or the process is stuck. It logs nothing when a query hangs. | `docker compose logs worker`; fix the link to Postgres, then `docker compose restart worker` (Docker marks it unhealthy but does not restart it by itself). It recovers on its own when the connection comes back, which can take a couple of minutes |
| JSON `Route GET:/ not found` on the API domain                                                                                                   | Working as intended                                                                                                                                                                                | Use `/healthz`                                                                                                                                                                                                                                                       |

**Why `ENOTFOUND postgres` happened, and what changed (#121).** Dokploy rewrites `docker-compose.yml` on every deploy to attach
its own network, and it does not resolve YAML merge keys (`<<: *app`). `api`, `worker`, `buyer`, `dashboard` and `migrate` used to
inherit `networks: [poi]` from the shared `x-app` block, so Dokploy saw them as having no network and gave them only its own,
while `postgres` (which listed `poi` itself) stayed on `poi`: the apps could no longer resolve the name `postgres`. Every service
now lists `networks: [poi]` directly and the anchor carries none, and `apps/api/src/compose.test.ts` fails if that is undone.
Keep it that way when you add a service. If you ever see the symptom again, Stop then Deploy still recovers it, and `/readyz`
(which now answers 503) is the signal to watch.

**Uptime monitoring (#38).** Nothing watched the demo from outside until now. `docs/MONITORING.md` sets up a dedicated monitor
(keyword checks on `/readyz` for the API and `/healthz` for the shop and dashboard) and turns on the free in-repo one
(`.github/workflows/uptime.yml`, which needs the repository variables `PUBLIC_API_URL`, `PUBLIC_SHOP_URL` and
`PUBLIC_DASHBOARD_URL`, and optionally the secret `UPTIME_WEBHOOK_URL` for chat messages). It also says how to prove an alert reaches
the team chat without stopping the real API.

**Without Dokploy** (plain Compose and Caddy on a server you manage):

```bash
# on the server, once
git clone https://github.com/harshkumarsingh12/proof-of-intent.git ~/proof-of-intent
cd ~/proof-of-intent && cp .env.example .env && chmod 600 .env   # fill in real values
docker compose --profile server up -d --build

# releases after that
git tag v0.1.0-hackathon && git push origin v0.1.0-hackathon   # deploy.yml pulls and restarts
```

Repository secrets for `deploy.yml`: `SERVER_HOST`, `SERVER_USER`, `SERVER_SSH_KEY` (optional `SERVER_PORT`,
`SERVER_DIR`). Without them the workflow pushes images and skips the deploy step.

**Verifying a release (#175).** After `up -d` the workflow runs `scripts/deploy/verify-release.sh` on the server, and you can
run it yourself any time from the compose directory: it checks that `migrate` finished, Postgres is healthy, the API's
`/readyz` answers with the database reachable (not just `/healthz`), the shop and the dashboard answer, the worker is
polling the dispute inbox, and, if the `backup` service is running, that a dump less than 26 hours old exists. It stops at the
first failure and says which one. A second job, `verify-public`, checks the public URLs from outside with the uptime monitor's
own script (`scripts/ops/uptime-check.sh`): `/readyz` with the database reachable **and** the dispute worker keeping up
(`"inbox":"ok"`), the shop and the dashboard. On Dokploy there is no SSH deploy, so this is the release's only check of the
worker. Set the repository **variables** `PUBLIC_API_URL`, `PUBLIC_SHOP_URL` and `PUBLIC_DASHBOARD_URL` (for example `https://poi-api.iotkiit.in`) to
turn it on. Until you do, it passes with a warning that nothing public was checked, and the GitHub Release is only
published when both jobs pass. On Dokploy, which deploys from `main`, set the variables and tag after the deploy finishes, and
read the commit off Dokploy's Deployments tab: these checks prove the stack is healthy, not which commit it runs.

Server `.env` beyond the defaults: `PAYPAL_MODE=sandbox` with the PayPal variables, `MERCHANT_SIGNING_KEY`
(`pnpm keys:gen`; the API refuses to start in sandbox mode without it), and `TRUST_PROXY=1` because a proxy
(Dokploy's, Caddy or a Cloudflare Tunnel) sits in front, so rate limits key on the real client IP. Never set
`TRUST_PROXY` on a host the internet reaches directly: clients could pick their own IP with `X-Forwarded-For`.
Known gap: `TRUST_PROXY=1` trusts every hop, so behind Cloudflare plus a proxy a client can still send its own
`X-Forwarded-For`. Trusting exactly two hops, or keying on `CF-Connecting-IP`, would close it.

**Backups.** The `backup` service dumps Postgres when it starts and then every 24 h to `poi-<UTC time>.sql.gz` in its `/backups`,
keeping 7 days. A failed dump is logged as `backup FAILED` and never replaces a good file. Its healthcheck is healthy only
while a dump less than 26 hours old exists, so `docker compose ps` and Dokploy show a missing or stuck backup instead of nobody
noticing. Where `/backups` lives, and what starts the service, depends on where you run it:

| Where | Start it with | Dumps live in |
|---|---|---|
| Plain Compose on your own server | `docker compose --profile server up -d` (also starts caddy) | the `./backups` folder beside `docker-compose.yml` (`BACKUP_DIR` unset) |
| **Dokploy** | Environment tab: `COMPOSE_PROFILES=backup` (starts the backup service and not caddy, which Dokploy's proxy makes pointless) | the named volume `backups`: Environment tab `BACKUP_DIR=backups` |

On Dokploy use the named volume. A `./backups` folder sits inside the code directory, which Dokploy replaces on every deploy, so
dumps there are not safe. A named volume survives deploys, and Dokploy's **Volume Backups** (named volumes only) can copy it off
the server. Restore, whichever mode (the dump is read through the service, so the same command works for both):

```bash
docker compose exec -T postgres psql -U poi -d postgres -c "create database poi_restore"
docker compose exec -T backup cat /backups/poi-<time>.sql.gz | gunzip |
  docker compose exec -T postgres psql -U poi -d poi_restore -v ON_ERROR_STOP=1 -q
# check it, then point DATABASE_URL at poi_restore (or rename the databases) and restart api and worker
```

`-v ON_ERROR_STOP=1` matters: without it `psql` swallows a SQL error and still exits 0, so a damaged dump looks like a success.

**Prove a backup restores (a drill, #175).** A backup nobody has restored is a guess. `scripts/deploy/restore-drill.sh` (the
newest dump the backup service holds, or a file you give it) restores into a scratch database beside the live one, never
touching live data, prints each table's restored and live row count, and drops the scratch database again. It stops, saying
why, on a missing or corrupt file, any SQL error during the restore, or a restored database with no tables or migrations; it
only *reports* that a restored table is behind live (a dump is up to 24 hours old) or missing (the dump predates a migration).
Run it after setting up backups, and again whenever you change them. A dump holds everything the database holds: treat it as a
secret. It reads a plain `pg_dump | gzip` file; a custom-format dump needs `pg_restore` instead.

**Setting up backups on Dokploy (#38).** Nothing in this repository can see the server, so do these on it and confirm each one:

1. Environment tab: add `COMPOSE_PROFILES=backup` and `BACKUP_DIR=backups`, then deploy. (Dokploy writes the Environment tab to a
   `.env` file beside `docker-compose.yml`, and Docker Compose reads `COMPOSE_PROFILES` from that file.)
2. On the server: `docker ps --filter name=backup` shows the container, and within a minute
   `docker compose exec backup ls -l /backups` lists a `poi-<time>.sql.gz`. After 5 minutes the container reads `healthy`.
3. Run the drill on it: `scripts/deploy/restore-drill.sh` from the compose directory (set `COMPOSE="docker compose -p <project>"`
   if Dokploy named the project). It should print `restore drill passed`.
4. **Copy the dumps off the server** (recommended before Dec 15): in Dokploy, add a **Volume Backup** for the `backups` volume to
   an S3 destination, or copy the newest dump by hand now and then. Dumps beside the database protect you from a bad
   migration or a deleted database, not from losing the server.
5. After a redeploy, check the dumps are still there (that is what the named volume is for) and that the container is `healthy`.

**On the team server (Nov 8).** Steps 1 and 2 are done: `COMPOSE_PROFILES=backup` and `BACKUP_DIR=backups` are set, the
service writes to the named volume `proofofintent-proofofintent-hrpvnt_backups`, and its log shows
`backup ok /backups/poi-20261107T222438Z.sql.gz`. The drill (step 3) was run by hand by the server's administrator with the
restore commands above: that 144,645-byte dump restored into a scratch database `poi_drill` with `ON_ERROR_STOP=1` and no
errors, `orders` held 29 rows in both the restore and the live `poi`, and `poi_drill` was dropped. Only `orders` was compared;
`restore-drill.sh` compares every table.

**The schedule (Nov 10).** The `backup` service's log in Dokploy shows `backup ok` for `poi-20261107T222438Z.sql.gz`,
`poi-20261108T222438Z.sql.gz` and `poi-20261109T222438Z.sql.gz`: one dump every 24 hours, to the second, so the loop runs and the
container was not restarted in between. To check it again, open the compose app's **Logs** in Dokploy, pick `backup`, and look for
one `backup ok` line a day and no `backup FAILED`.

Not done for the hackathon: step 4 (the dumps live on the same disk as the database, so losing the server loses them too) and
step 5 (the three dumps above came from one container, so surviving a redeploy that recreates it is not yet shown).

`audit_log` is append-only by trigger, so a demo reset means dropping and recreating the database, not deleting rows.
