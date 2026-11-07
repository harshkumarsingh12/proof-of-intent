# Setup

Three ways to run Proof of Intent, from least to most setup.

## 1. Zero credentials (judges, new teammates)

Needs Docker.

```bash
git clone https://github.com/harshkumarsingh12/proof-of-intent.git
cd proof-of-intent
cp .env.example .env
docker compose up --build
```

| Service              | URL                           |
| -------------------- | ----------------------------- |
| Shop (buyer app)     | http://localhost:3001         |
| Operations dashboard | http://localhost:3002         |
| API health           | http://localhost:3000/healthz |

Ports already taken on your machine? Set `API_HOST_PORT`, `SHOP_HOST_PORT` or `OPS_HOST_PORT` in `.env` (they
default to 3000, 3001 and 3002), then open the matching `localhost` port. Host ports bind to `127.0.0.1` only.

`PAYPAL_MODE=mock` serves PayPal responses from fixtures and `AI_MODE=replay` serves recorded model responses,
so journeys A–D run end to end without any account. _(Journeys are wired in as the milestones land; see the
ledger in the latest CI run for what is open.)_

**AG Studio license.** Analytics and Disputes work without a license. Dispute Studio (`/analytics/studio`, a sidebar
item under Analytics) needs all of: `AG_STUDIO_LICENSE_KEY` (an AI-enabled key; request a free 45-day trial for React at
`https://www.ag-grid.com/studio/react/enterprise-licence/#request-a-45-day-trial-licence`), `OPERATOR_PASSWORD` and
`OPERATOR_TOKEN` in the dashboard's environment, and an API the dashboard can reach (`API_INTERNAL_URL`). If any is missing
the page says "Studio is unavailable on this deployment". Put the key on one line in `.env` with no quotes; it is a secret
like the PayPal secret. With an invalid key Studio renders with an "Invalid License Key" console warning.
Use the team's valid AI-enabled key for the demo. For new questions, set `AI_MODE=live` on both the API and
dashboard, with `AI_PROVIDER`, `AI_MODEL` and `AI_API_KEY` in the API environment. The dashboard reads the mode
to explain chat availability. In replay mode the chat answers only recorded questions with
matching dispute facts and tools. An unrecorded turn gives a clear unavailable response. Capture all three
starters with `pnpm studio:record` on the live stack, review the answers, then repeat with both servers in replay
mode. [Recording steps and timings](evals/README.md#studio-starter-recordings). Studio's
report lives in the browser tab and nothing is saved; the chat's tools are read-only.

**The shop** (http://localhost:3001/shop) runs journey A: your browser makes a key and keeps it, you sign an
intent, the buyer agent proposes a product from the store (12 products in four categories: running jackets, road running shoes, base layers, socks), and the merchant approves, steps up or refuses it before any
PayPal order exists. In `PAYPAL_MODE=mock` an "Approve with PayPal (mock)" button stands in for PayPal; in sandbox
the real PayPal button appears (it needs `PAYPAL_CLIENT_ID`). The agent's key has to be registered with the API:
set `OPERATOR_TOKEN` in `.env` (any long random string) and the shop registers it on the first checkout. Without it,
proposing a cart answers "the merchant doesn't know this shop's agent key". Picking a category fills in its demo words, price and color; keep those words in replay mode, because
`AI_MODE=replay` has recorded J1 answers for exactly those (one per product in the category).
**Agent alone:** under "Your signing key", "Save a PayPal wallet" runs Vault v3 (mock PayPal returns to the shop at once; sandbox sends the shopper to PayPal to approve, and `BUYER_PUBLIC_URL` on the API must be the shop's public address so PayPal can send them back). Then "Let the agent pay alone" lets an approved cart be charged to that wallet with no PayPal step; a cart the merchant isn't sure about is held for the shopper instead, and nothing is charged. The store is
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
"operator actions are not configured" rather than faking success.

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
pnpm dev:dashboard       # :3002
```

Before you push, run what CI runs: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`. For the dashboard
alone: `pnpm vitest run apps/dashboard` and `pnpm --filter @poi/dashboard build`.

Postgres for local work: `docker compose up -d postgres` and set
`DATABASE_URL=postgres://poi:poi@localhost:5432/poi` (expose the port in a local override if needed).

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
   Nemotron thinking switch is sent to NVIDIA only. Optionally set `AI_FALLBACK_MODEL`: it is tried once, on the same
   provider, when `AI_MODEL` has been retired or renamed (the free model lineups change without notice). After editing a prompt in
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

| Command           | What it does                                                                                                                                                                                                                                |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm smoke:shop` | Drives `/shop` in Chrome against a running mock stack (key, signed intent, refusal, capture, the agent buttons). `SHOP_URL=… pnpm smoke:shop` points it at a hosted shop and stops before PayPal. Needs Chrome (`CHROME_PATH`, `HEADED=1`). |
| `pnpm agent:eval` | Runs the live buyer agent over eight cases with the real hard rules standing in for the merchant, and writes `docs/evals/agent-<date>.md`. Needs `AI_MODEL` and `AI_API_KEY`.                                                               |

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
   AI_MODE=replay
   AI_DAILY_CALL_LIMIT=500
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
| `getaddrinfo ENOTFOUND postgres` in api, worker or migrate logs; API routes answer 500 while `/healthz` is 200; the dashboard says "Sample data" | A redeploy put the recreated containers on a new compose network and left `postgres` on the old one (Nov 6 and Nov 7)                                                                              | In Dokploy: **Stop**, then **Deploy** (the data is in the `pgdata` volume, do not delete volumes). On the server instead: `docker network connect --alias postgres <api's network> <postgres container>`. Permanent fix: #121; `/readyz` should have caught it: #120 |
| After approving a wallet on PayPal the shopper lands on `localhost`, or a step-up link opens `localhost`                                         | `BUYER_PUBLIC_URL` is missing from the Environment tab, so the API uses its local default (the API logs `BUYER_PUBLIC_URL is not set` at start in sandbox mode)                                    | Set `BUYER_PUBLIC_URL=https://poi-buyer.iotkiit.in` and redeploy; wallets saved before the fix are unaffected                                                                                                                                                        |
| Studio says "Studio is unavailable on this deployment"                                                                                           | Any of: no `AG_STUDIO_LICENSE_KEY`, no `OPERATOR_PASSWORD` or `OPERATOR_TOKEN`, or the dashboard can't reach the API (check the "Sample data" banner on `/disputes`)                               | Set the three variables in the dashboard environment, fix the API connection, redeploy                                                                                                                                                                               |
| Ask the AI says the chat can't answer, or answers "Studio AI is unavailable"                                                                     | `AI_MODE` is not `live` on the dashboard or API, the `AI_*` variables are missing, the daily call budget is used up, or the model timed out (the API logs `Studio AI unavailable` with the reason) | Set the variables on both containers; raise `AI_DAILY_CALL_LIMIT`; retry                                                                                                                                                                                             |
| JSON `Route GET:/ not found` on the API domain                                                                                                   | Working as intended                                                                                                                                                                                | Use `/healthz`                                                                                                                                                                                                                                                       |

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
`SERVER_DIR`). Without them the workflow pushes images and skips the deploy step. Its health check runs inside the
`api` container, so it doesn't depend on the host port.

Server `.env` beyond the defaults: `PAYPAL_MODE=sandbox` with the PayPal variables, `MERCHANT_SIGNING_KEY`
(`pnpm keys:gen`; the API refuses to start in sandbox mode without it), and `TRUST_PROXY=1` because a proxy
(Dokploy's, Caddy or a Cloudflare Tunnel) sits in front, so rate limits key on the real client IP. Never set
`TRUST_PROXY` on a host the internet reaches directly: clients could pick their own IP with `X-Forwarded-For`.
Known gap: `TRUST_PROXY=1` trusts every hop, so behind Cloudflare plus a proxy a client can still send its own
`X-Forwarded-For`. Trusting exactly two hops, or keying on `CF-Connecting-IP`, would close it.

**Backups.** The `backup` service (server profile) dumps Postgres every 24 h to `./backups/poi-<UTC time>.sql.gz`
and keeps 7 days. A failed dump is logged as `backup FAILED` and never replaces a good file. Restore:

```bash
docker compose exec -T postgres psql -U poi -d postgres -c "create database poi_restore"
gunzip -c backups/poi-<time>.sql.gz | docker compose exec -T postgres psql -U poi -d poi_restore
# check it, then point DATABASE_URL at poi_restore (or rename the databases) and restart api and worker
```

`audit_log` is append-only by trigger, so a demo reset means dropping and recreating the database, not deleting rows.
