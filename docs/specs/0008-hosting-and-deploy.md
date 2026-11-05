# 0008: Hosting and deploy

| | |
|---|---|
| **Status** | Proposed |
| **Owner** | @harshkumarsingh12 |
| **Reviewers** | @srshriv |
| **Milestone** | M0 (server up), M2 (monitoring), M4 (release) |
| **Code** | `docker-compose.yml`, `Dockerfile`, `Caddyfile`, `.github/workflows/deploy.yml`; Dokploy project on the team server |

## Context

The demo must stay up from submission through **Dec 15, 8:00 am PT** (end of judging), and PayPal must be able to
deliver webhooks to it. The team runs it on its own server; the same Compose file is the judges' local setup.

## Design

| Concern | Plan |
|---|---|
| Services | `postgres`, `api`, `worker`, `buyer`, `dashboard`, one-shot `migrate`, and `caddy` + `backup` (profile `server`); `restart: unless-stopped`; health checks on HTTP services. Host ports are `127.0.0.1`-only and configurable (`API_HOST_PORT`, `SHOP_HOST_PORT`, `OPS_HOST_PORT`, default 3000–3002) |
| HTTPS | **Decided (D6):** Dokploy's proxy with Let's Encrypt, behind Cloudflare, on `poi-api.iotkiit.in`, `poi-buyer.iotkiit.in` and `poi-dashboard.iotkiit.in` (D7). Single-level names because Cloudflare's free certificate covers one level. Caddy (profile `server`) stays for servers without Dokploy |
| Uptime | External monitor (e.g. UptimeRobot) on the three `/healthz` URLs, alerting the team chat; Compose starts on boot |
| Isolation | Own Docker network; only the proxy publishes ports; Postgres unreachable from outside; non-root containers |
| Abuse | Per-IP rate limits (built, `apps/api/src/rate-limits.ts`): `/checkout` 30/min, `/webhooks/paypal` 300/min, `/ai/studio` 10/min, 429 `rate_limited`; `TRUST_PROXY=1` behind the proxy. AI budget kill switch; viewer demo login |
| Backups | `backup` service (server profile): `pg_dump` every 24 h, 7 days kept, atomic writes; restore in docs/SETUP.md. Nightly demo reset Dec 1–15 |
| Secrets | Server `.env` (mode 600) outside git; GitHub Actions secrets for CI/CD |
| Release | Dokploy redeploys on every push to `main`. Tag `v*` → `deploy.yml` still builds the 4 images to GHCR and, where SSH secrets are set, runs `compose pull && up -d` with a health check inside the `api` container, then a GitHub Release |

Deploy never runs on pull requests, and no self-hosted runner is used on this public repo.

## Interfaces

Env: see `.env.example`. Repository secrets: `SERVER_HOST`, `SERVER_USER`, `SERVER_SSH_KEY`, optional
`SERVER_PORT`, `SERVER_DIR`. Images: `ghcr.io/<owner>/proof-of-intent-{api,worker,buyer,dashboard}:<tag>`.

## Acceptance criteria

1. `docker compose config` is valid and the API image builds in CI on every PR. *(done)*
2. `https://<api host>/healthz` returns 200 from outside the server. *(done: `https://poi-api.iotkiit.in/healthz`, Nov 5)*
3. A real sandbox webhook reaches the server and is verified. *(M1)*
4. Uptime alert fires within 5 minutes of stopping the API. *(M2)*
5. Pushing `v0.1.0-hackathon` deploys and passes the health check. *(M4)*

## Open questions

- ~~D6 Caddy vs Cloudflare Tunnel, D7 domain.~~ Decided Nov 5: Dokploy behind Cloudflare, `poi-*.iotkiit.in`.
- The `backup` service is in the `server` profile, which Dokploy doesn't start (its proxy holds 80 and 443).
  Split it out of that profile, or use Dokploy's scheduled backups. @harshkumarsingh12.
- If SSH from GitHub can't reach the server (NAT), deploy by running `docker compose pull && up -d` on the server
  manually after the images are pushed.
