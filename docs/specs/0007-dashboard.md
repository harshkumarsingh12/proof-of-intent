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

**Custom widgets, as built** (`apps/dashboard/app/analytics/studio/studio-widgets.tsx`, shaping in `src/studio-data.ts`,
descriptions in `src/widgets.ts`). `/analytics/studio` registers all three through `createWidgets({ additionalTypes })`
and opens on a report with one of each, wired to two tables: `disputes` (one row per dispute, amount in dollars) and
`checks` (one row per signed limit per dispute, from each dispute's `constraintChecks`). `mandate-diff` shows one dispute
at a time with an "only violations" toggle; `evidence-preview` embeds the attestation PDF through the dashboard proxy for
MANDATE_COMPLIANT disputes and says why there is none for the others; `agent-platform` is a card per platform with the
overreach rate and conceded dollars. Every widget and every data-mapping slot carries an AI description, and
`dashboard.test.ts` checks the registration. Differences from the AG Studio docs that cost time, for the next person
(ag-studio 3.0.0): a data-mapping slot holds the hydrated field (`{ fieldId, key, name, ... }`), not `{ id }`, and
`getData` wants those objects back (aggregates are the same object with `type: "implicitMeasure"` and an
`aggregation`); `use(widgetApi.getData(...))` suspends forever because each render makes a new promise, so the widgets
load in an effect; `ag-studio-react` ships no overlay components; a custom widget draws its own title. Not done: a
`formatShape` for the widgets (the docs don't show how to build one outside Studio, and the AI harness works without it),
cross-filtering between widgets, and the dispute selector driving the other two.

**Studio chat, navigation and linked widgets, as built.** *Finding it:* "Dispute Studio" is a sidebar item under Analytics
(shown only where Studio is enabled; the longest-matching nav item is the active one, `src/nav.ts`), and the Analytics page
opens with a banner for it. *The two widgets follow each other:* the mandate diff and the evidence preview share one selected
dispute (`src/studio-selection.ts`); each used to keep its own dropdown, so changing one left the other (and its PDF) behind.
*The AI chat:* ag-studio has the chat panel only in edit mode, so a "Dashboard | Ask the AI" switch above Studio turns edit
mode on with only the chat and filters panels. The chat opens on DisputeExplainer, not the built-in orchestrator: that prompt
builds dashboards, starts by inspecting the page, and with the live model looped on `view_schema`/`view_report`/`view_page`
and sent `delegate_to` arguments that failed its nested schema. DisputeExplainer has flat `{ disputeId }` tools, a short
prompt, a glossary of the dispute classes, and starter prompts built from real dispute ids on the page. Nothing is saved
(the report lives in the tab) and the tools are read-only. The turn handler (`packages/ai/src/studio.ts`) now: accepts tool
arguments as an object, retries once when the model announces a step ("Let me...") or tells the user to run a tool, and ends a
repeated identical tool call by withdrawing that tool and then forcing an answer (falling back to the tool's own result).
`/ai/studio` allows 60 requests a minute because one question is several requests, and J4 gets the 10 s the spec gave it.
`redact` no longer cuts digits out of hashes and ids (it had corrupted a mandate hash the chat quoted).

**The opening report, as built.** Four KPI tiles (open disputes, due within 24 hours, dollars at stake, conceded dollars: built-in
`value` widgets, each a plain sum of a 0/1 or dollar column in the `disputes` table, so they follow filters), a donut of disputes
by class (a click cross-filters every widget), the agent platform cards, the disputes grid, and the mandate diff and evidence
preview for the selected dispute. The grid (`dispute-grid`, a custom widget around AG Grid Community on the same theme as the
Orders page, `src/grid-theme.ts`) has class chips, a "Respond in" column that sorts open disputes by deadline and reddens
anything due within a day, a quick filter, CSV export, and a row click that sets the shared selection the diff and the PDF
follow. The evidence preview shows the cover note beside the PDF; both it and the diff link to the full dispute page. Orders with
no agent platform read "No mandate (not an agent order)" instead of "none". More ag-studio 3.0.0 gotchas: a custom widget gets
no event for a cross filter (the donut filtered the tiles and left the grid on all 24), so the Studio view publishes a revision
from `onStateUpdated` when the page's filters change (`src/studio-filters.ts`) and the widgets reload on it; built-in widgets
need `title.enabled: true` for the title set in the report state to show; `currencyFormat` prints `1,143.00` unless the field
carries a `$` `Intl.NumberFormat` in `formatOptions`. The chat's `list_disputes` now reads our own table (class, action, amount,
deadline, whether a response is due), so "What needs my attention?" works in mock mode too; PayPal's list is the fallback when
there is no database.

**Theme, as built:** `src/studio-theme.ts` builds the Studio theme from `palette` (Studio wants literal colors, so it
reads the palette, not the CSS variables), and the filters panel starts collapsed so it doesn't sit over the widgets.

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
