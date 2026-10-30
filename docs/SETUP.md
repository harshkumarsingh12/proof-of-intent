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

`PAYPAL_MODE=mock` serves PayPal responses from fixtures and `AI_MODE=replay` serves recorded model responses,
so journeys A–D run end to end without any account. *(Journeys are wired in as the milestones land; see the
ledger in the latest CI run for what is open.)*

**AG Studio license.** Without `AG_STUDIO_LICENSE_KEY` the dashboard `TODO(@hoursgotviral-dev, M0)`: document
here whether it shows a watermark or refuses to load. If it refuses, use the hosted dashboard instead.

## 2. Development without Docker

Needs Node 20+.

```bash
corepack enable          # once; provides the pinned pnpm
pnpm install
pnpm test                # unit tests + ledger entries
pnpm dev:api             # :3000
pnpm dev:buyer           # :3001
pnpm dev:dashboard       # :3002
```

Postgres for local work: `docker compose up -d postgres` and set
`DATABASE_URL=postgres://poi:poi@localhost:5432/poi` (expose the port in a local override if needed).

## 3. Your own PayPal sandbox

1. Create a REST app at [developer.paypal.com](https://developer.paypal.com/) under a sandbox business account.
   In the app's features, enable **Disputes** and **Vault**.
2. Create two sandbox personal accounts with funded balances and fictional details.
3. Set in `.env`: `PAYPAL_MODE=sandbox`, `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`.
4. Expose the API publicly (a Cloudflare Tunnel or ngrok to port 3000) and register a webhook at
   `https://<your-host>/webhooks/paypal` with these events:
   `CHECKOUT.ORDER.APPROVED`, `PAYMENT.AUTHORIZATION.CREATED`, `PAYMENT.CAPTURE.COMPLETED`,
   `PAYMENT.CAPTURE.DENIED`, `CUSTOMER.DISPUTE.CREATED`, `CUSTOMER.DISPUTE.UPDATED`,
   `CUSTOMER.DISPUTE.RESOLVED`, `VAULT.PAYMENT-TOKEN.CREATED`. Put its id in `PAYPAL_WEBHOOK_ID`.
5. For live model calls: `AI_MODE=live` plus `AI_PROVIDER`, `AI_MODEL`, `AI_API_KEY`.
6. Merchant signing key: `pnpm keys:gen > merchant-key.pem`, then put it in `MERCHANT_SIGNING_KEY`.

## 4. Team server (owner: Harsh)

See [spec 0008](specs/0008-hosting-and-deploy.md) for the full plan.

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
