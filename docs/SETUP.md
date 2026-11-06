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

| Service | URL |
|---|---|
| Shop (buyer app) | http://localhost:3001 |
| Operations dashboard | http://localhost:3002 |
| API health | http://localhost:3000/healthz |

Ports already taken on your machine? Set `API_HOST_PORT`, `SHOP_HOST_PORT` or `OPS_HOST_PORT` in `.env` (they
default to 3000, 3001 and 3002), then open the matching `localhost` port. Host ports bind to `127.0.0.1` only.

`PAYPAL_MODE=mock` serves PayPal responses from fixtures and `AI_MODE=replay` serves recorded model responses,
so journeys A–D run end to end without any account. *(Journeys are wired in as the milestones land; see the
ledger in the latest CI run for what is open.)*

**AG Studio license.** The dashboard doesn't use AG Grid or AG Studio yet (no dependency in
`apps/dashboard/package.json`), so it runs without `AG_STUDIO_LICENSE_KEY`.
`TODO(@hoursgotviral-dev)`: when AG Studio lands, document here whether a missing key shows a watermark or
refuses to load.

**What's in the dashboard** (http://localhost:3002):

| Page | Path | Notes |
|---|---|---|
| Home | `/` | Disputes due in the next 24 hours, tabs (action required, defend, concede, resolved), quick links |
| Dispute queue | `/disputes` | Filters and sorting by deadline, age or amount |
| Dispute detail | `/disputes/<id>` | Mandate diff, constraint checks, copilot recommendation, evidence preview, operator actions |
| Analytics | `/analytics` | Defended vs. conceded, blocked carts, platform breakdown, disputes by class per week |

The top-bar search finds a dispute by dispute id, order id or PayPal order id (press `/` to focus it). The badge
and banner show the real `PAYPAL_MODE`. Until `GET /disputes` and the recommendation route are built, the pages
show seed data and say so in a banner. Operator actions report the API's answer honestly, so in mock mode today
they show an error rather than a fake success.

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
5. For live model calls: `AI_MODE=live` plus `AI_PROVIDER`, `AI_MODEL`, `AI_API_KEY`.
6. Merchant signing key: `pnpm keys:gen > merchant-key.pem`, then put it in `MERCHANT_SIGNING_KEY`.

## 4. Team server (owner: Harsh)

See [spec 0008](specs/0008-hosting-and-deploy.md) for the full plan. The team demo runs on **Dokploy** on the
team server, behind Cloudflare.

| App | Public URL | Compose service | Container port |
|---|---|---|---|
| Shop | https://poi-buyer.iotkiit.in | `buyer` | 3001 |
| API (and PayPal webhooks) | https://poi-api.iotkiit.in | `api` | 3000 |
| Operations dashboard | https://poi-dashboard.iotkiit.in | `dashboard` | 3002 |

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
   DAILY_AI_BUDGET_USD=5
   POSTGRES_PASSWORD=poi            # must match the password in DATABASE_URL
   DATABASE_URL=postgres://poi:poi@postgres:5432/poi
   MERCHANT_ID=merchant-trailhead
   MERCHANT_KEY_ID=merchant-1
   API_HOST=poi-api.iotkiit.in
   SHOP_HOST=poi-buyer.iotkiit.in
   OPS_HOST=poi-dashboard.iotkiit.in
   PUBLIC_BASE_URL=https://poi-api.iotkiit.in
   TRUST_PROXY=1
   # Dokploy and other apps hold 3000-3002 on this host. These are 127.0.0.1-only host ports,
   # for checks from the server itself; the public URLs go through Dokploy's proxy to the container ports.
   API_HOST_PORT=3100
   SHOP_HOST_PORT=3101
   OPS_HOST_PORT=3102
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

| Symptom in the deploy log | Cause | Fix |
|---|---|---|
| `Bind for 0.0.0.0:3001 failed: port is already allocated` | Another service holds that host port | Set `SHOP_HOST_PORT` (or the API/OPS one) to a free port; find the holder with `docker ps --filter publish=3001` |
| `service "migrate" didn't complete successfully: exit 1` | Usually `DATABASE_URL` missing from the Environment tab, or a password that doesn't match the existing `pgdata` volume | `docker logs <app>-migrate-1`; add the full env set above; Postgres keeps the password it was first created with |
| Plain-text `404 page not found` on a domain | Dokploy's proxy has no route: domain not redeployed, a typo, or the wrong service | Redeploy; check the host, service and container port in the Domains tab |
| `getaddrinfo EAI_AGAIN api.sandbox.paypal.com` in api or worker logs | The host's DNS resolver dropped a lookup | Compose sends outside names to `1.1.1.1` / `8.8.8.8` (`dns:` in `docker-compose.yml`); if the host firewall blocks outbound DNS to them, put the host's working resolver there instead. Calls that never reached PayPal are retried automatically |
| JSON `Route GET:/ not found` on the API domain | Working as intended | Use `/healthz` |

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
