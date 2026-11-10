# Roadmap

GitHub milestones M0–M4 mirror the sections below; every issue carries one. Status here is updated by the owner
in the PR that finishes the deliverable. The live burndown of unbuilt acceptance criteria is in the job summary
of every `ci` run.

## M0 Foundations (Oct 31)

| Deliverable                                                | Owner           | Status                                                                                                                                                                                                               |
| ---------------------------------------------------------- | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Specs 0001–0009 reviewed and Accepted                      | each spec owner | ✅ Built against since Oct 31; 0001–0005, 0007, 0008 In Progress, 0006 and 0009 Accepted (Nov 6)                                                                                                                     |
| Team server: Docker, Compose, Postgres up                  | Harsh           | ✅ Done (Dokploy, Nov 5)                                                                                                                                                                                             |
| Public HTTPS and webhook endpoint (D6, D7)                 | Harsh           | ✅ HTTPS live on `poi-*.iotkiit.in`; sandbox webhook points at `https://poi-api.iotkiit.in/webhooks/paypal` (Nov 5)                                                                                                  |
| PayPal sandbox app and accounts (incl. judge accounts)     | Harsh           | ✅ US merchant app with Disputes and Vault enabled, 4 US shopper accounts (2 for judges), webhook with 8 events (Nov 5)                                                                                              |
| `PAYPAL_MODE=mock`                                         | Harsh           | ✅ Done                                                                                                                                                                                                              |
| All four registered on Devpost; Representative named       | Sumedha         | All four registered and the team is created (Nov 7); Representative still to be named |
| AG Studio trial key and watermark check                    | Sikruti         | ✅ Key in use (the license expires Dec 21, after judging ends Dec 15, so no renewal is needed for judging; #51). With no key or an invalid one Studio still renders and the console logs "Invalid License Key"; the page needs a key to be offered at all (SETUP.md) |
| LLM provider chosen (D1)                                   | Sumedha         | ✅ NVIDIA `nemotron-3.5-lightning-30b-a3b`, thinking off (spec 0006)                                                                                                                                                 |
| Repo, CI/CD, contracts, mandate crypto, policy engine core | Harsh, Sristee  | ✅ Done                                                                                                                                                                                                              |
| Server in sandbox mode (PayPal keys, merchant signing key) | Harsh           | ✅ Done; `/readyz` reports `paypalMode: sandbox` (Nov 5)                                                                                                                                                             |

**Done when:** specs Accepted, fixtures committed, server answers `/healthz` over public HTTPS.

## M1 Slice on sandbox (Nov 3)

| Deliverable                                                         | Owner           | Status                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------- | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Orders create/authorize/capture/void in sandbox                     | Harsh           | ✅ Done (authorize after a real approval: integration day)                                                                                                                                                                                                            |
| Vault v3 spike                                                      | Harsh           | ✅ Built (#17): setup token, payment token, shopper-signed save routes. PayPal accepts the setup token on the sandbox (Nov 7); after a real approval the payment token charged a $1.00 vaulted `CAPTURE` with no shopper present (Nov 7, `pnpm sandbox:vault-wallet`) |
| DB schema, migrations, nonce table                                  | Harsh           | ✅ Done                                                                                                                                                                                                                                                               |
| Checkout route end to end                                           | Harsh + Sristee | ✅ Done (stage 2 live run on integration day)                                                                                                                                                                                                                         |
| Webhook receiver with verification                                  | Harsh           | ✅ Verified on the sandbox (Nov 7): `pnpm sandbox:webhook-check` (#19)                                                                                                                                                                                                |
| Remaining hard rules (budget, recurrence, address, attributes, SKU) | Sristee         | ✅ Done (#21); the red $95 jacket now gives `AMOUNT_EXCEEDS_MAX` + `ATTRIBUTE_MISMATCH`                                                                                                                                                                               |
| Key registry with retirement                                        | Sristee         | ✅ `createKeyRegistry`, `/keys/shopper` (public), `/keys/agent` and retire (operator); hosted orders via `pnpm sandbox:hosted-order`                                                                                                                                  |
| Buyer app: intent form, browser key, signing, PayPal button         | Sristee         | ✅ `/shop`: browser key, signed intent, agent cart, PayPal button (mock + sandbox) (#23); Playwright smoke ✅ (`pnpm smoke:shop`)                                                                                                                                     |
| J1 semantic fit + replay mode                                       | Sumedha         | ✅ J1 (prompt `j1-v1`), replay for the fixture carts, `pnpm ai:record`; full eval set is #43                                                                                                                                                                          |
| Worker skeleton on fixtures                                         | Sikruti         | ✅ Intake, classification and evidence (#54–#57); runs as an inbox poller over `webhook_events` instead of pg-boss (#82), with a `list_disputes` catch-up (#59)                                                                                                       |
| Dashboard shell: orders grid, verification queue, theme             | Sikruti         | Shell, theme, home ✅ (#75, #76); orders grid ✅, verification queue as a read-only "Checkout verdicts" tab ✅ (approve and reject wait on step-up)                                                                                                                   |

**Done when:** a signed mandate is verified, a sandbox order is authorized and captured with the pointer in
`custom_id`, and the dashboard grid shows it.

## M2 Dispute cycle (Nov 6)

| Deliverable                                                     | Owner           | Status                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --------------------------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sandbox dispute recipe script                                   | Harsh           | ✅ Done (live run Nov 5: dispute `PP-R-NSZ-10196423`)                                                                                                                                                                                                                                                                                                                                                                                                               |
| require-evidence, provide-evidence, send-message                | Harsh           | provide-evidence + send-message ✅; require-evidence lives in the recipe script (sandbox-only)                                                                                                                                                                                                                                                                                                                                                                      |
| Agent Toolkit dispute tools in the worker                       | Sikruti         | ✅ `get_dispute`, `list_disputes`, `accept_dispute_claim`, `create_shipment_tracking` through `@paypal/agent-toolkit` (#59)                                                                                                                                                                                                                                                                                                                                         |
| Evidence package (PDF + JSON)                                   | Sikruti         | ✅ Built by the worker for MANDATE_COMPLIANT disputes, served at `/disputes/:id/evidence.pdf` (#82)                                                                                                                                                                                                                                                                                                                                                                 |
| Recommendation endpoint + operator actions                      | Sikruti + Harsh | ✅ `/disputes*` routes, operator actions behind `OPERATOR_TOKEN` and the dashboard login (#82, #83); override to accept with a note (this PR)                                                                                                                                                                                                                                                                                                                       |
| Dispute workspace, mandate diff widget, evidence preview widget | Sikruti         | ✅ Live data from the API; the preview shows the exact PDF that is submitted (#83)                                                                                                                                                                                                                                                                                                                                                                                  |
| J2 classification, J3 drafting                                  | Sumedha         | Built (spec 0006 as built); the replay answers are hand-authored, not recorded live; the live J1/J2 runner exists (#104) but no dated report is committed (#43)                                                                                                                                                                                                                                                                                                     |
| Step-up links; agent-alone flow with vault; buyer agent         | Sristee         | Step-up links ✅ (#35); buyer agent with its three tools ✅ (#37, replay chooser + live model); agent-alone flow ✅ in the shop (save a wallet, the agent pays alone; mock stack and browser smoke test) proven on the hosted sandbox shop (Nov 7): a real wallet approval, then the agent paid $74.00 alone, capture `7UK80073R2712115B` (#36). Not yet run on the hosted shop: the held-cart approval and wallet removal (mock stack and browser smoke test only) |
| Uptime monitor, backups, rate limits                            | Harsh           | Rate limits ✅; backups ✅ on Dokploy (named volume, restored by hand Nov 8, daily schedule confirmed Nov 10, #175; no off-server copy); in-repo uptime monitor ✅ (`uptime.yml`, #38); a dedicated external monitor is not set up                                                                                                                                                                                                                                                                                                                              |

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

| Deliverable                                                              | Owner                    | Status                                                                                                           |
| ------------------------------------------------------------------------ | ------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| Studio agent harness + DisputeExplainer                                  | Sumedha + Sikruti        | Harness ✅ (#105); custom widgets, theme and the opening report ✅; needs a license key on the server (#15, #51) |
| Analytics page + agent platform widget                                   | Sikruti (Harsh backup)   | ✅ Analytics page with platform breakdown (#73), polished in #78                                                 |
| Seed data: 300 orders, 24 disputes, two scripted disputes                | Sumedha                  | ✅ `pnpm demo:seed` (mock stack only: `PP-D-1001` compliant with its PDF, `PP-D-1002` overreach)                 |
| Security checklist                                                       | Sristee                  | ✅ Swept Nov 8 (#42); server checks Nov 10 (#202): 10 of 10 boxes ticked in SECURITY.md. The step-up token is out of every URL path (#261) and a closed step-up shows nothing (#265); still to confirm: port 8080 (#202). The nightly demo reset was dropped (#203) |
| Full evals and report                                                    | Sumedha                  | ✅ Nov 7: J1 20/20, J2 12/12, schema 31/31 ([report](evals/2026-11-07.md)); J2 prompt is now `j2-v2` (#43) |
| Integration day: journeys A–D twice on sandbox                           | everyone (Harsh runs it) | ✅ Nov 7, see the status below                                                                                   |
| Dashboard and buyer polish: phone layout, no fake controls, landing page | Harsh                    | ✅ Done (#78, #79)                                                                                               |

**Done when:** journeys A–D pass on sandbox twice in a row; only fixes and docs after this.

**Status (Nov 7, #44):** on the hosted sandbox. A (human-present purchase through the shop and PayPal's popup, 4 runs,
all `CAPTURED` with the mandate pointer in `custom_id`), B (`pnpm sandbox:checkout-smoke`, 2 runs: red $95 refused with no
order, grey $74 ordered), C twice, each time one dispute defended (`PP-R-IFB-10196898`, `PP-R-LSI-10196902`: escalated,
claim opened about 3 minutes later, evidence submitted, `UNDER_REVIEW`) and one conceded by override
(`PP-R-VZL-10196900`, `PP-R-FZE-10196903`: `RESOLVED`). D twice on a fresh local seeded stack (`PP-D-1002` is
`AGENT_OVERREACH` with `AMOUNT_EXCEEDS_MAX` and `ATTRIBUTE_MISMATCH`, `PP-D-1001` is `MANDATE_COMPLIANT` with its PDF), since the
hosted sandbox has no overreaching capture. Disputes reached the API 3 to 4.5 minutes after filing, but that delay is
PayPal's: the sandbox emitted each `CUSTOMER.DISPUTE.CREATED` 4 to 5 minutes after the shopper filed, and the dispute
was in our API 10 to 30 seconds after its own event every time (VZL, LSI, FZE), which a 5-minute catch-up could not do
three times running. Proven directly with `pnpm sandbox:webhook-check` once `/readyz` reported delivery counts: a never-seen
`PAYMENT.AUTHORIZATION.CREATED` resent by PayPal raised the held count 100 to 101, and resending it again left it at 101
(#19). Still open: the operator-row-before-PayPal-call order was checked in tests,
not on the hosted server (no audit route, #74).

**Status (Nov 7, evening):** Studio shipped (#117 to #119): four KPI tiles, a class donut that cross-filters everything, the
agent platform cards, an AG Grid of disputes (filter, CSV export, a row click drives the mandate diff and the PDF), the
mandate diff and evidence preview, a Studio theme from the dashboard palette, a sidebar entry and an Ask the AI chat that
opens on DisputeExplainer (checked in Chrome with the real key and the live model). Real webhook delivery is verified
(#114, #115). A redeploy left the hosted API without a route to Postgres for a while; Stop then Deploy fixed it, and the
cause and a permanent fix are tracked in #120 and #121. Still open before submission: the hosted check of the new Studio and
the AI variables (#123), judge disputes that expire before Dec 15 (#122), the chat in replay mode (#124), Studio follow-ups
(#125), dark mode as a stretch (#127), and the older M4 items below.

**Status (Nov 7, night):** the AI upgrades are merged behind switches, all default off or degrading to plain answers:
voice ordering (`BUYER_VOICE=1`: speak and the agent fills in the limits; #140; the read-back card and spoken "confirm" were removed Nov 8 at the owner's request, so signing is now the shopper's own click), the shop assistant
(`BUYER_CHAT=1`, answers from the store's data, can't sign or buy; #143), provider hardening with a Groq backup
(`AI_FALLBACK_*`, `pnpm ai:check`; #141, #142), a deterministic planner for the Studio chat so common questions are right,
read-only and fast with no recordings in replay mode (`pnpm smoke:studio`; #144, so #124 is resolved for them), and near-miss
suggestions after a refusal (what would have fit, one button that refills the limits and still needs a new signature; #145). The
switches and the Groq lines are now set in Dokploy, and the NVIDIA and AG Studio keys are confirmed safe, so #126 needs no
rotation. Still to do on your side: run the hosted checks (#36, and voice and chat in Chrome and Safari over HTTPS; #123 is done). Not started: a clarifying question in intent
drafting and a `platform_summary` Studio tool.

## M4 Submission (Nov 11)

| Deliverable                                  | Owner    | Status  |
| -------------------------------------------- | -------- | ------- |
| README final, DEMO.md click path             | Sumedha  | Updated Nov 10 (proof package, Studio filters, Nov 10 evals); the independent walkthrough is pending |
| SETUP.md verified on a clean machine         | Sristee  | ✅ Nov 9 on a fresh GitHub Codespace (2 cores, 8 GB, nothing cached): §1 to a running stack in 8 min 40 s, the demo seed in 3 s, §2 in under 3 min; snags fixed in SETUP.md (#212 and this PR) |
| Video recorded, edited, public on YouTube    | Sumedha  | Rough cut Nov 10: 2:44.5, 1080p, every scene captioned, no voiceover yet. Voiceover, review and upload pending |
| Tag `v0.1.0-hackathon`, deployed, monitored  | Harsh    | ✅ Nov 10: tag at `5d25fca`, release workflow green (four images on GHCR, public checks passed), GitHub Release published; monitored by `uptime.yml` (#48) |
| Devpost submission with testing instructions | Sumedha  | Pending |
| Prize split agreed                           | everyone | Pending |
| AG Studio license covers judging             | Sikruti  | ✅ Expires Dec 21, after judging ends Dec 15; no renewal needed |

**Done when:** submitted on Devpost with a public video, public repo with license, and a live hosted demo.
