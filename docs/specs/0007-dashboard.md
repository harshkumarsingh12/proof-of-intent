# 0007: Dashboard and AG Studio

| | |
|---|---|
| **Status** | In Progress |
| **Owner** | @hoursgotviral-dev |
| **Reviewers** | @sumedhag28, @harshkumarsingh12 |
| **Milestone** | M1 (shell), M2 (workspace + widgets), M3 (agent, analytics) |
| **Code** | `apps/dashboard` |

## Context

The dashboard is the merchant's product, not a report, and it is the sponsor-prize core (Best Use of AG Grid).
The AG Grid judges reward custom widgets, theming and layout, and the Studio Agent Framework with a custom agent
or harness.

## Design

Setup: `ag-studio`, `ag-studio-react` with the 45-day trial key (renewal key requested **Nov 25**, judging ends
Dec 15). Start from `paypaldev/hackathon-paypal-ag-grid-boilerplate`.

| Page | Content | Data |
|---|---|---|
| Home *(built, #76)* | disputes due in 24 h; tabs: action required, defend, concede, resolved; quick links | seed until `/disputes` |
| Agent orders *(built: `/orders` page, AG Grid Community)* | grid (order, platform, shopper present, verdict, reason codes, amount, PayPal status, captured at); KPI tiles | `/orders` + `/verifications` |
| Verification queue *(read-only "Checkout verdicts" tab on `/orders`; approve / reject waits for step-up links, #35)* | STEP_UP carts with time left; row opens the mandate diff; approve / reject | `/verifications` |
| Disputes *(built: queue #60, detail #61; live data #82, actions #83 #84 #87)* | sorted by due date; class + action chips; SLA countdown; evidence preview (the exact PDF sent); Submit / Escalate / Accept / override | `/disputes`, `/disputes/:id/paypal-actions` |
| Analytics *(built, #73)* | disputes by class per week; overreach rate by platform; defended vs conceded; median response window | `/analytics/*` |

**Custom widgets** (`apps/dashboard/src/widgets.ts`), each with an AI description:
1. `mandate-diff`: intent left, cart right, failed constraints highlighted with codes; "only violations" toggle;
   selecting a code cross-filters the orders grid.
2. `evidence-preview`: attestation PDF + cover note; Submit disabled until opened.
3. `agent-platform`: card per platform with orders, overreach rate, conceded amount.

**Theme** *(built, #75 and #76)*: light, PayPal-inspired palette in `apps/dashboard/src/theme.ts`, written to
`:root` as CSS variables; sidebar shell with the merchant name, dispute search and a `PAYPAL_MODE` badge; monospace
reason codes; WCAG AA contrast. Our own wordmark and icons, no PayPal logo or assets. Dark mode and the locked
operator layout with an "explore" mode are not built yet. AG Studio isn't integrated yet; when it is, its theme
should read the same tokens.

**Operator actions** *(built, #83)*: the same-origin proxy forwards GETs and only one POST,
`/disputes/:id/actions/:action`, after an HTTP Basic login as `operator` (`OPERATOR_PASSWORD`); it adds
`Bearer OPERATOR_TOKEN` server-side. Buttons follow PayPal's live allowed actions (#87).

**Studio agent** (owner @sumedhag28): custom harness on the example OpenAI-style adapter pointed at
`POST /ai/studio`; keep the five built-in agents and add `DisputeExplainer` with `explain_dispute(id)` and
`draft_buyer_message(id)`, plus Agent Toolkit read-only `list_disputes`, `get_dispute`. **Read-only only.**

The dashboard sends validated turn or lookup requests to the operator-authenticated endpoint. The server runs
live turns through the configured AI provider. The browser executes only the tools registered with its Studio
runner, and dispute tools return a limited policy finding, draft, or status. With no AI-enabled license the
dashboard offers the standard Analytics and Disputes views.

**Demo polish:** 300 seeded orders across four platforms and 24 disputes; the two scripted disputes pinned on top.

## Acceptance criteria

1. `mandate-diff` registered with an AI description. *(ledger M2 @hoursgotviral-dev)*
2. DisputeExplainer exposes read-only tools only. *(Tool registration and API tests)*
3. Without a license key, behaviour is documented in SETUP.md.
4. Every number on the analytics page traces to seed data or a sandbox order. *(done, #73: tests check against
   `SEED_DISPUTES` and `SEED_ORDERS`)*

## Out of scope

Per-merchant policy editing (stretch); PayPal MCP server in the harness (D4, stretch).
