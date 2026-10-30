# 0008: Hosting and deploy

| | |
|---|---|
| **Status** | Proposed |
| **Owner** | @harshkumarsingh12 |
| **Reviewers** | @srshriv |
| **Milestone** | M0 (server up), M2 (monitoring), M4 (release) |
| **Code** | `docker-compose.yml`, `Dockerfile`, `Caddyfile`, `.github/workflows/deploy.yml` |

## Context

The demo must stay up from submission through **Dec 15, 8:00 am PT** (end of judging), and PayPal must be able to
deliver webhooks to it. The team runs it on its own server; the same Compose file is the judges' local setup.

## Design

| Concern | Plan |
|---|---|
| Services | `postgres`, `api`, `worker`, `buyer`, `dashboard`, and `caddy` (profile `server`); `restart: unless-stopped`; health checks on HTTP services |
| HTTPS | Public IP: Caddy with automatic Let's Encrypt on `API_HOST`, `SHOP_HOST`, `OPS_HOST`. Behind NAT: Cloudflare Tunnel to ports 3000–3002 instead (D6) |
| Uptime | External monitor (e.g. UptimeRobot) on the three `/healthz` URLs, alerting the team chat; Compose starts on boot |
| Isolation | Own Docker network; only the proxy publishes ports; Postgres unreachable from outside; non-root containers |
| Abuse | Rate limits on `/checkout`, `/webhooks/paypal`, `/ai/studio`; AI budget kill switch; viewer demo login |
| Backups | Nightly `pg_dump`, 7 days kept; nightly demo reset Dec 1–15 |
| Secrets | Server `.env` (mode 600) outside git; GitHub Actions secrets for CI/CD |
| Release | Tag `v*` → `deploy.yml`: build 4 images to GHCR → SSH to server → `compose pull && up -d` → health check → GitHub Release |

Deploy never runs on pull requests, and no self-hosted runner is used on this public repo.

## Interfaces

Env: see `.env.example`. Repository secrets: `SERVER_HOST`, `SERVER_USER`, `SERVER_SSH_KEY`, optional
`SERVER_PORT`, `SERVER_DIR`. Images: `ghcr.io/<owner>/proof-of-intent-{api,worker,buyer,dashboard}:<tag>`.

## Acceptance criteria

1. `docker compose config` is valid and the API image builds in CI on every PR. *(done)*
2. `https://<api host>/healthz` returns 200 from outside the server. *(M0)*
3. A real sandbox webhook reaches the server and is verified. *(M1)*
4. Uptime alert fires within 5 minutes of stopping the API. *(M2)*
5. Pushing `v0.1.0-hackathon` deploys and passes the health check. *(M4)*

## Open questions

- D6 Caddy vs Cloudflare Tunnel, D7 domain. @harshkumarsingh12, Oct 31.
- If SSH from GitHub can't reach the server (NAT), deploy by running `docker compose pull && up -d` on the server
  manually after the images are pushed.
