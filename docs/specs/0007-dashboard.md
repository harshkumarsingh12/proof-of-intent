# 0007: Dashboard and AG Studio

| | |
|---|---|
| **Status** | Proposed |
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
| Agent orders | grid (order, platform, mandate status, verdict, reason codes, amount, captured at); KPI tiles | `/orders` |
| Verification queue | STEP_UP carts with time left; row opens the mandate diff; approve / reject | `/verifications` |
| Disputes | sorted by due date; class + action chips; SLA countdown; evidence preview; Submit / Accept / Offer | `/disputes` |
| Analytics | disputes by class per week; overreach rate by platform; defended vs conceded; median response time | `/analytics/*` |

**Custom widgets** (`apps/dashboard/src/widgets.ts`), each with an AI description:
1. `mandate-diff`: intent left, cart right, failed constraints highlighted with codes; "only violations" toggle;
   selecting a code cross-filters the orders grid.
2. `evidence-preview`: attestation PDF + cover note; Submit disabled until opened.
3. `agent-platform`: card per platform with orders, overreach rate, conceded amount.

**Theme:** brand color, dense rows, monospace reason codes, light and dark; locked operator layout plus an
"explore" mode.

**Studio agent** (owner @sumedhag28): custom harness on the example OpenAI-style adapter pointed at
`POST /ai/studio`; keep the five built-in agents and add `DisputeExplainer` with `explain_dispute(id)` and
`draft_buyer_message(id)`, plus Agent Toolkit read-only `list_disputes`, `get_dispute`. **Read-only only.**

**Demo polish:** 300 seeded orders across four platforms and 24 disputes; the two scripted disputes pinned on top.

## Acceptance criteria

1. `mandate-diff` registered with an AI description. *(ledger M2 @hoursgotviral-dev)*
2. DisputeExplainer exposes read-only tools only. *(ledger M3 @sumedhag28)*
3. Without a license key, behaviour is documented in SETUP.md. *(M0)*
4. Every number on the analytics page traces to seed data or a sandbox order.

## Out of scope

Per-merchant policy editing (stretch); PayPal MCP server in the harness (D4, stretch).
