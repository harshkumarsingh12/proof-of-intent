# Proof of Intent

[![ci](https://github.com/harshkumarsingh12/proof-of-intent/actions/workflows/ci.yml/badge.svg)](https://github.com/harshkumarsingh12/proof-of-intent/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

**When an AI agent buys the wrong thing, the merchant pays. Proof of Intent fixes that on PayPal.**

Proof of Intent is a PayPal-native merchant service. It checks an AI agent's cart against the shopper's
**signed intent** before PayPal captures any money, and when a dispute arrives it turns that signed record
into evidence, or into a fair refund when the agent really did overreach. A human approves every dispute action.

Built for the [PayPal AI Hackathon](https://paypalaihackathon.devpost.com/) (submissions close Nov 12, 2026).

> **Who sends the mandates?** The demo shop signs the shopper's intent in the browser. Its buyer agent signs
> the payment mandate and proposes a cart. External agents can integrate through the documented checkout
> endpoint using our AP2-style schemas and a registered agent key; the cart lines must be the merchant's own products
> at its own prices (checked against its catalog). Disputes on orders without a mandate use
> the standard PayPal evidence path.

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
| Orders v2 | The shop authorizes then captures or voids an order after the shopper approves the exact cart |
| Vault v3 | The shopper saves a PayPal wallet (signed proof, setup token, payment token); the agent can then pay alone from it, only for carts that pass the checks |
| Webhooks | Signed dispute and capture events, verified, persisted, idempotent |
| Disputes API | Provide evidence, send message, escalate (operator clicks); sandbox test harness |
| Agent Toolkit | `get_dispute` and `list_disputes` feed the dispute copilot (fresh dispute, missed-webhook catch-up); `accept_dispute_claim` and `create_shipment_tracking` run on an audited operator click |

The checkout checks semantic fit through the Vercel AI SDK using NVIDIA Nemotron or versioned replay responses.
On Nov 7 the live model scored 20/20 on the semantic-fit set (none of the 6 mismatches approved; measured after checkout's local guards)
and 12/12 on dispute explanations that cite the policy finding, with every model answer schema-valid (31/31).
See the [eval report](docs/evals/2026-11-07.md).
The dispute worker replays the checkout rules to recommend a response. The operations dashboard uses AG Grid for
orders and checkout verdicts, and **Dispute Studio** (AG Studio) for the dispute workspace: KPI tiles, a class donut that
filters everything, an AG Grid of disputes, a mandate diff and evidence preview that follow the selected dispute, custom
widgets with AI descriptions, and an Ask the AI chat (DisputeExplainer) that reads disputes but cannot act. The shop also
has a buyer agent that chooses the cart itself and a merchant check that refuses what breaks the signed limits. See the
[AI spec](docs/specs/0006-ai-jobs.md) and the [dashboard spec](docs/specs/0007-dashboard.md).

## Try it

| Path | What you need |
|---|---|
| **Hosted demo** | [Shop](https://poi-buyer.iotkiit.in/shop) · [Operations dashboard](https://poi-dashboard.iotkiit.in). Follow the [judge click path](docs/DEMO.md#judge-click-path). Demo logins are shared through the Devpost testing instructions. |
| **Your own sandbox** | Judge sandbox shopper accounts are in the Devpost testing instructions. |
| **Run locally, zero credentials** | Docker. `PAYPAL_MODE=mock` and `AI_MODE=replay` are the defaults. Follow the [local mock walkthrough](docs/DEMO.md#local-mock-walkthrough) to inspect both scripted disputes. |

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
apps/api          merchant service: checkout, verification, key registry, webhooks, disputes, operator actions
apps/worker       dispute copilot: webhook inbox, list_disputes catch-up, classification, evidence PDF
apps/buyer        shopper app and buyer agent
apps/dashboard    operations dashboard: home, dispute queue and detail, analytics
packages/contracts  shared schemas and reason codes (the frozen contract)
packages/mandates   canonicalization, hashing, ES256 signatures, key registry
packages/policy-engine  deterministic hard rules
packages/paypal   typed PayPal client (Agent Toolkit for disputes) + mock
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
