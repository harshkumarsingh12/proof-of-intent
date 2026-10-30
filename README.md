# Proof of Intent

[![ci](https://github.com/harshkumarsingh12/proof-of-intent/actions/workflows/ci.yml/badge.svg)](https://github.com/harshkumarsingh12/proof-of-intent/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

**When an AI agent buys the wrong thing, the merchant pays. Proof of Intent fixes that on PayPal.**

Proof of Intent is a PayPal-native merchant service. It checks an AI agent's cart against the shopper's
**signed intent** before PayPal captures any money, and when a dispute arrives it turns that signed record
into evidence, or into a fair refund when the agent really did overreach. A human approves every dispute action.

Built for the [PayPal AI Hackathon](https://paypalaihackathon.devpost.com/) (submissions close Nov 12, 2026).

> **Who sends the mandates?** We accept the AP2 mandate format, so any agent that already speaks AP2 works
> with no custom integration. Orders that arrive without a mandate still go through the standard dispute
> path, so installing Proof of Intent never leaves a merchant worse off.

## How it works

1. **The shopper signs what they want.** "Grey running jacket under $80" becomes an Intent Mandate signed
   with a key that never leaves their browser.
2. **The merchant checks the cart before any PayPal order exists.** Deterministic rules (amount, currency,
   merchant, attributes, quantity, address, expiry, replay) decide first; an LLM check of the shopper's own
   words can only make the verdict stricter, never looser.
3. **The proof rides on the PayPal order.** A pointer to the signed mandate is written into `custom_id`.
4. **Disputes get answered with the record.** Compliant order: the copilot drafts an evidence package from
   the signed mandates. Overreaching order: it recommends accepting the claim. The operator decides.

| PayPal surface | How we use it |
|---|---|
| Orders v2 | Authorize then capture or void (human present); create and capture against a vaulted wallet (agent alone) |
| Vault v3 | One-time wallet save so an agent can buy later without the shopper online |
| Webhooks | Signed dispute and capture events, verified, persisted, idempotent |
| Disputes API | Provide evidence, send message, sandbox test harness |
| Agent Toolkit | Dispute copilot and operator agent: `get_dispute`, `list_disputes`, `accept_dispute_claim`, shipment tracking |

AI: a configurable LLM through the Vercel AI SDK for four typed jobs (semantic fit, dispute classification,
evidence drafting, operator questions), plus the AG Studio Agent Framework in the dashboard.

## Try it

| Path | What you need |
|---|---|
| **Hosted demo** | Links and demo logins are in the Devpost testing instructions. |
| **Your own sandbox** | Judge sandbox shopper accounts are in the Devpost testing instructions. |
| **Run locally, zero credentials** | Docker. `PAYPAL_MODE=mock` and `AI_MODE=replay` are the defaults. |

```bash
git clone https://github.com/harshkumarsingh12/proof-of-intent.git
cd proof-of-intent
cp .env.example .env
docker compose up --build
# shop:       http://localhost:3001
# operations: http://localhost:3002
# api:        http://localhost:3000/healthz
```

Developing without Docker: Node 20+, `corepack enable`, then `pnpm install && pnpm test`. Full guide: [docs/SETUP.md](docs/SETUP.md).

## Repository map

```
apps/api          merchant service: checkout, verification, webhooks, disputes, analytics
apps/worker       dispute copilot pipeline, evidence PDF, Agent Toolkit
apps/buyer        shopper app and buyer agent
apps/dashboard    operations dashboard on AG Studio
packages/contracts  shared schemas and reason codes (the frozen contract)
packages/mandates   canonicalization, hashing, ES256 signatures
packages/policy-engine  deterministic hard rules
packages/paypal   typed PayPal client + mock
packages/ai       LLM jobs, schemas, replay mode, evals
packages/db       schema, migrations, audit log
docs/             project document, specs, architecture, roadmap, demo
```

## Documentation

- [Project document](docs/PROJECT.md): problem, research, scope, journeys, plan, risks
- [Specs](docs/specs/): one per subsystem, written before the code
- [Architecture](docs/ARCHITECTURE.md) · [Roadmap](docs/ROADMAP.md) · [Conventions](docs/CONVENTIONS.md) · [Demo](docs/DEMO.md)
- [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md)

## What this is not

- Not certified by AP2, Mastercard Verifiable Intent or PayPal. We implement the AP2 v0.1 mandate shape ourselves.
- PayPal's production systems do not read our mandates today.
- Not a fraud or bot-detection product, and it does not change PayPal Seller Protection eligibility.

## Team

| | GitHub | Area |
|---|---|---|
| Harsh Kumar Singh | [@harshkumarsingh12](https://github.com/harshkumarsingh12) | PayPal integration, API, data, server, CI/CD |
| Sristee Shrivastava | [@srshriv](https://github.com/srshriv) | Mandates and cryptography, policy engine, buyer app, security |
| Sikruti Mahapatra | [@hoursgotviral-dev](https://github.com/hoursgotviral-dev) | Dispute copilot, operations dashboard |
| Sumedha | [@sumedhag28](https://github.com/sumedhag28) | AI jobs and evals, operator agent, demo and pitch |

Who owns which paths: [CONTRIBUTING.md](CONTRIBUTING.md#who-owns-what).

## License

[Apache-2.0](LICENSE)
