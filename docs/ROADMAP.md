# Roadmap

GitHub milestones M0–M4 mirror the sections below; every issue carries one. Status here is updated by the owner
in the PR that finishes the deliverable. The live burndown of unbuilt acceptance criteria is in the job summary
of every `ci` run.

## M0 Foundations (Oct 31)

| Deliverable | Owner | Status |
|---|---|---|
| Specs 0001–0009 reviewed and Accepted | each spec owner | Proposed |
| Team server: Docker, Compose, Postgres up | Harsh | ✅ Done (Dokploy, Nov 5) |
| Public HTTPS and webhook endpoint (D6, D7) | Harsh | ✅ HTTPS live on `poi-*.iotkiit.in`; register the sandbox webhook at `https://poi-api.iotkiit.in/webhooks/paypal` |
| PayPal sandbox app and accounts (incl. judge accounts) | Harsh | Pending |
| `PAYPAL_MODE=mock` | Harsh | ✅ Done |
| All four registered on Devpost; Representative named | Sumedha | Pending |
| AG Studio trial key and watermark check | Sikruti | Pending |
| LLM provider chosen (D1) | Sumedha | Pending |
| Repo, CI/CD, contracts, mandate crypto, policy engine core | Harsh, Sristee | ✅ Done |

**Done when:** specs Accepted, fixtures committed, server answers `/healthz` over public HTTPS.

## M1 Slice on sandbox (Nov 3)

| Deliverable | Owner | Status |
|---|---|---|
| Orders create/authorize/capture/void in sandbox | Harsh | ✅ Done (authorize after a real approval: integration day) |
| Vault v3 spike | Harsh | Pending |
| DB schema, migrations, nonce table | Harsh | ✅ Done |
| Checkout route end to end | Harsh + Sristee | ✅ Done (stage 2 live run on integration day) |
| Webhook receiver with verification | Harsh | Built; public URL live, real sandbox delivery check pending |
| Remaining hard rules (budget, recurrence, address, attributes, SKU) | Sristee | Pending |
| Key registry with retirement | Sristee | Pending |
| Buyer app: intent form, browser key, signing, PayPal button | Sristee | Pending |
| J1 semantic fit + replay mode | Sumedha | Pending |
| Worker skeleton on fixtures | Sikruti | Intake, classification, decision and evidence drafting merged (#54–#57); pg-boss wiring pending |
| Dashboard shell: orders grid, verification queue, theme | Sikruti | Shell, theme and home ✅ (#75, #76); orders grid and verification queue pending |

**Done when:** a signed mandate is verified, a sandbox order is authorized and captured with the pointer in
`custom_id`, and the dashboard grid shows it.

## M2 Dispute cycle (Nov 6)

| Deliverable | Owner | Status |
|---|---|---|
| Sandbox dispute recipe script | Harsh | ✅ Done (live run Nov 5: dispute `PP-R-NSZ-10196423`) |
| require-evidence, provide-evidence, send-message | Harsh | provide-evidence + send-message ✅; require-evidence lives in the recipe script (sandbox-only) |
| Agent Toolkit dispute tools in the worker | Sikruti | Pending |
| Evidence package (PDF + JSON) | Sikruti | Pending |
| Recommendation endpoint + operator actions | Sikruti + Harsh | Pending; dashboard side calls the API and reports its real answer (#61); audit panel and override in #74 |
| Dispute workspace, mandate diff widget, evidence preview widget | Sikruti | Queue and detail with mandate diff and evidence preview ✅ (#60, #61); live data pending the API routes |
| J2 classification, J3 drafting | Sumedha | Pending |
| Step-up links; agent-alone flow with vault; buyer agent | Sristee | Pending |
| Uptime monitor, backups, rate limits | Harsh | Rate limits + backups ✅; external monitor pending (public URLs now live); backups need a Dokploy setup (`server` profile not started) |

**Done when:** a real `CUSTOMER.DISPUTE.CREATED` is classified, evidence is submitted and a claim is accepted in
sandbox through the UI.

## M3 Feature freeze (Nov 8)

| Deliverable | Owner | Status |
|---|---|---|
| Studio agent harness + DisputeExplainer | Sumedha + Sikruti | Pending |
| Analytics page + agent platform widget | Sikruti (Harsh backup) | ✅ Analytics page with platform breakdown (#73) |
| Seed data: 300 orders, 24 disputes, two scripted disputes | Sumedha | Pending |
| Security checklist | Sristee | Pending |
| Full evals and report | Sumedha | Pending |
| Integration day: journeys A–D twice on sandbox | everyone (Harsh runs it) | Pending |

**Done when:** journeys A–D pass on sandbox twice in a row; only fixes and docs after this.

## M4 Submission (Nov 11)

| Deliverable | Owner | Status |
|---|---|---|
| README final, DEMO.md click path | Sumedha | Pending |
| SETUP.md verified on a clean machine | Sristee | Pending |
| Video recorded, edited, public on YouTube | Sumedha | Pending |
| Tag `v0.1.0-hackathon`, deployed, monitored | Harsh | Pending |
| Devpost submission with testing instructions | Sumedha | Pending |
| Prize split agreed | everyone | Pending |
| AG Studio renewal key installed (Nov 25) | Sikruti | Pending |

**Done when:** submitted on Devpost with a public video, public repo with license, and a live hosted demo.
