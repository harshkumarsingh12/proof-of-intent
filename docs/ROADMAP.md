# Roadmap

GitHub milestones M0–M4 mirror the sections below; every issue carries one. Status here is updated by the owner
in the PR that finishes the deliverable. The live burndown of unbuilt acceptance criteria is in the job summary
of every `ci` run.

## M0 Foundations (Oct 31)

| Deliverable                                                | Owner           | Status                                                                                                                  |
| ---------------------------------------------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Specs 0001–0009 reviewed and Accepted                      | each spec owner | ✅ Built against since Oct 31; 0001–0005, 0007, 0008 In Progress, 0006 and 0009 Accepted (Nov 6)                        |
| Team server: Docker, Compose, Postgres up                  | Harsh           | ✅ Done (Dokploy, Nov 5)                                                                                                |
| Public HTTPS and webhook endpoint (D6, D7)                 | Harsh           | ✅ HTTPS live on `poi-*.iotkiit.in`; sandbox webhook points at `https://poi-api.iotkiit.in/webhooks/paypal` (Nov 5)     |
| PayPal sandbox app and accounts (incl. judge accounts)     | Harsh           | ✅ US merchant app with Disputes and Vault enabled, 4 US shopper accounts (2 for judges), webhook with 8 events (Nov 5) |
| `PAYPAL_MODE=mock`                                         | Harsh           | ✅ Done                                                                                                                 |
| All four registered on Devpost; Representative named       | Sumedha         | Pending                                                                                                                 |
| AG Studio trial key and watermark check                    | Sikruti         | Pending                                                                                                                 |
| LLM provider chosen (D1)                                   | Sumedha         | ✅ NVIDIA `nemotron-3.5-lightning-30b-a3b`, thinking off (spec 0006)                                                    |
| Repo, CI/CD, contracts, mandate crypto, policy engine core | Harsh, Sristee  | ✅ Done                                                                                                                 |
| Server in sandbox mode (PayPal keys, merchant signing key) | Harsh           | ✅ Done; `/readyz` reports `paypalMode: sandbox` (Nov 5)                                                                |

**Done when:** specs Accepted, fixtures committed, server answers `/healthz` over public HTTPS.

## M1 Slice on sandbox (Nov 3)

| Deliverable                                                         | Owner           | Status                                                                                                                                                          |
| ------------------------------------------------------------------- | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Orders create/authorize/capture/void in sandbox                     | Harsh           | ✅ Done (authorize after a real approval: integration day)                                                                                                      |
| Vault v3 spike                                                      | Harsh           | ⚠️ Overdue (D2 gate was Nov 3). The app's token already has the vault scope; decide at the M2 check-in whether to build it or drop F6                           |
| DB schema, migrations, nonce table                                  | Harsh           | ✅ Done                                                                                                                                                         |
| Checkout route end to end                                           | Harsh + Sristee | ✅ Done (stage 2 live run on integration day)                                                                                                                   |
| Webhook receiver with verification                                  | Harsh           | Built; public URL live, real sandbox delivery check pending                                                                                                     |
| Remaining hard rules (budget, recurrence, address, attributes, SKU) | Sristee         | ✅ Done (#21); the red $95 jacket now gives `AMOUNT_EXCEEDS_MAX` + `ATTRIBUTE_MISMATCH`                                                                         |
| Key registry with retirement                                        | Sristee         | ✅ `createKeyRegistry`, `/keys/shopper` (public), `/keys/agent` and retire (operator); hosted orders via `pnpm sandbox:hosted-order`                            |
| Buyer app: intent form, browser key, signing, PayPal button         | Sristee         | ✅ `/shop`: browser key, signed intent, agent cart, PayPal button (mock + sandbox) (#23); Playwright smoke pending                                              |
| J1 semantic fit + replay mode                                       | Sumedha         | ✅ J1 (prompt `j1-v1`), replay for the fixture carts, `pnpm ai:record`; full eval set is #43                                                                    |
| Worker skeleton on fixtures                                         | Sikruti         | ✅ Intake, classification and evidence (#54–#57); runs as an inbox poller over `webhook_events` instead of pg-boss (#82), with a `list_disputes` catch-up (#59) |
| Dashboard shell: orders grid, verification queue, theme             | Sikruti         | Shell, theme and home ✅ (#75, #76); orders grid and verification queue pending                                                                                 |

**Done when:** a signed mandate is verified, a sandbox order is authorized and captured with the pointer in
`custom_id`, and the dashboard grid shows it.

## M2 Dispute cycle (Nov 6)

| Deliverable                                                     | Owner           | Status                                                                                                                                        |
| --------------------------------------------------------------- | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Sandbox dispute recipe script                                   | Harsh           | ✅ Done (live run Nov 5: dispute `PP-R-NSZ-10196423`)                                                                                         |
| require-evidence, provide-evidence, send-message                | Harsh           | provide-evidence + send-message ✅; require-evidence lives in the recipe script (sandbox-only)                                                |
| Agent Toolkit dispute tools in the worker                       | Sikruti         | ✅ `get_dispute`, `list_disputes`, `accept_dispute_claim`, `create_shipment_tracking` through `@paypal/agent-toolkit` (#59)                   |
| Evidence package (PDF + JSON)                                   | Sikruti         | ✅ Built by the worker for MANDATE_COMPLIANT disputes, served at `/disputes/:id/evidence.pdf` (#82)                                           |
| Recommendation endpoint + operator actions                      | Sikruti + Harsh | ✅ `/disputes*` routes, operator actions behind `OPERATOR_TOKEN` and the dashboard login (#82, #83); override to accept with a note (this PR) |
| Dispute workspace, mandate diff widget, evidence preview widget | Sikruti         | ✅ Live data from the API; the preview shows the exact PDF that is submitted (#83)                                                            |
| J2 classification, J3 drafting                                  | Sumedha         | Pending                                                                                                                                       |
| Step-up links; agent-alone flow with vault; buyer agent         | Sristee         | Step-up links ✅ (#35); buyer agent with its three tools ✅ (#37, replay chooser + live model); agent-alone flow with vault pending           |
| Uptime monitor, backups, rate limits                            | Harsh           | Rate limits + backups ✅; external monitor pending (public URLs now live); backups need a Dokploy setup (`server` profile not started)        |

**Done when:** a real `CUSTOMER.DISPUTE.CREATED` is classified, evidence is submitted and a claim is accepted in
sandbox through the UI.

**Status (Nov 6):** passed on the PayPal sandbox, with the API, worker and dashboard run locally against a local
database (the team server's database has no shopper-key registration yet, #22). Dispute `PP-R-TRI-10196690`:
classified MANDATE_COMPLIANT, escalated, evidence submitted from the dashboard → PayPal UNDER_REVIEW. Dispute
`PP-R-MMK-10196694`: classified MANDATE_COMPLIANT, operator override → accept claim from the dashboard →
RESOLVED_BUYER_FAVOUR. In both, the operator's audit row precedes the PayPal call. Still open: real webhook delivery
check (#19; the `list_disputes` catch-up already covers missed webhooks), J2/J3 (Sumedha), step-up and buyer flows
(Sristee).

## M3 Feature freeze (Nov 8)

| Deliverable                                                              | Owner                    | Status                                                           |
| ------------------------------------------------------------------------ | ------------------------ | ---------------------------------------------------------------- |
| Studio agent harness + DisputeExplainer                                  | Sumedha + Sikruti        | Pending                                                          |
| Analytics page + agent platform widget                                   | Sikruti (Harsh backup)   | ✅ Analytics page with platform breakdown (#73), polished in #78 |
| Seed data: 300 orders, 24 disputes, two scripted disputes                | Sumedha                  | Pending                                                          |
| Security checklist                                                       | Sristee                  | Pending                                                          |
| Full evals and report                                                    | Sumedha                  | Pending                                                          |
| Integration day: journeys A–D twice on sandbox                           | everyone (Harsh runs it) | Pending                                                          |
| Dashboard and buyer polish: phone layout, no fake controls, landing page | Harsh                    | ✅ Done (#78, #79)                                               |

**Done when:** journeys A–D pass on sandbox twice in a row; only fixes and docs after this.

## M4 Submission (Nov 11)

| Deliverable                                  | Owner    | Status  |
| -------------------------------------------- | -------- | ------- |
| README final, DEMO.md click path             | Sumedha  | Pending |
| SETUP.md verified on a clean machine         | Sristee  | Pending |
| Video recorded, edited, public on YouTube    | Sumedha  | Pending |
| Tag `v0.1.0-hackathon`, deployed, monitored  | Harsh    | Pending |
| Devpost submission with testing instructions | Sumedha  | Pending |
| Prize split agreed                           | everyone | Pending |
| AG Studio renewal key installed (Nov 25)     | Sikruti  | Pending |

**Done when:** submitted on Devpost with a public video, public repo with license, and a live hosted demo.
