# Operations dashboard

**Path:** `apps/dashboard/` | **Owner:** @hoursgotviral-dev | **Backup:** @harshkumarsingh12 | **Spec:** [0007-dashboard.md](../../docs/specs/0007-dashboard.md) | **Milestones:** M1, M2, M3

Next.js app for the merchant's operations team. Run: `pnpm dev:dashboard` (port 3002). Live: https://poi-dashboard.iotkiit.in.

## Pages

| Page           | Route            | Files                                                            |
| -------------- | ---------------- | ---------------------------------------------------------------- |
| Home           | `/`              | `app/(home)/page.tsx`, `app/HomeView.tsx`                        |
| Dispute queue  | `/disputes`      | `app/disputes/(queue)/page.tsx`, `app/disputes/DisputeQueue.tsx` |
| Dispute detail | `/disputes/<id>` | `app/disputes/[id]/page.tsx`, `DisputeDetailView.tsx`            |
| Analytics      | `/analytics`     | `app/analytics/page.tsx`, `AnalyticsView.tsx`                    |

Dispute Studio is in the sidebar under Analytics and has a banner on the Analytics page. It opens on four KPI tiles, a donut
of disputes by class (click a slice to filter everything), the agent platform cards, an AG Grid of disputes (click a row, filter,
export CSV), and the mandate diff and evidence preview for the selected dispute. Its "Ask the AI" switch opens the chat (needs
`AI_MODE=live`).

Studio (`/analytics/studio`, needs a license key, `OPERATOR_PASSWORD` and `OPERATOR_TOKEN`): three AG Studio custom widgets
(mandate diff, evidence preview, agent platform breakdown) over two tables built from the disputes API, the Studio theme in
`src/studio-theme.ts`, and the DisputeExplainer chat. Layout, data and gotchas: spec 0007. Without a key the page says Studio
is unavailable; analytics and disputes work either way.

Also built: `/orders` (AG Grid: agent orders, plus a read-only "Checkout verdicts" tab that stands in for the
verification queue; approve and reject there wait on the step-up flow) and the AG Studio view under
`/analytics/studio` (`app/analytics/studio/`, `src/studio-agent.ts`), which needs `AG_STUDIO_LICENSE_KEY` and live AI.

## Layout

- **Shell** (`app/AppShell.tsx`): sidebar, top bar with the merchant name and dispute search
  (`app/DisputeSearch.tsx`), and a mode badge and banner from `PAYPAL_MODE`. There's no account menu until
  operator login exists (#74).
- **Rendering:** `app/layout.tsx` uses `force-dynamic`, so `PAYPAL_MODE` comes from the runtime `.env` and seed
  data is relative to the request time.
- **Skeletons:** `loading.tsx` lives in the `(home)` and `disputes/(queue)` route groups and in `analytics/`. Don't
  add one at the app root or in `disputes/`: it would wrap `/disputes/[id]` and turn its 404 into a 200.

## Theme

`src/theme.ts` holds the palette (a light, PayPal-inspired navy and blue) and writes it to `:root` as
`--poi-*` variables. Use `v("token")` or `var(--poi-…)` in inline styles, never raw hex. Shared shapes: `card`,
`kpiLabel`, `pillButton`, `pageTitle`, `pageSubtitle`. Every text/background pair passes WCAG AA; recheck new
pairs.

Brand rules: our own wordmark, icons (`app/icons.tsx`) and color bands. No PayPal logo, PayPal Sans or PayPal
illustrations.

## Data

Pages call the API through the same-origin proxy `app/api/[...path]/route.ts`. It forwards GETs, and one POST:
`/disputes/:id/actions/:action`, only after an HTTP Basic login as `operator` (`OPERATOR_PASSWORD`), adding
`Bearer OPERATOR_TOKEN` itself (`src/operator.ts`). If the API can't be reached or errors, pages fall back to seed data
(`src/seed-disputes.ts`, `src/seed-orders.ts`) and show a demo-data banner.

The dispute detail page asks `GET /disputes/:id/paypal-actions` what PayPal allows right now and disables, with the
reason, any action PayPal would refuse; at the inquiry stage it offers **Escalate to a claim**. Live disputes
preview the exact PDF that Submit sends. Logic lives in plain `.ts` under
`src/` (`api.ts`, `home.ts`, `analytics-data.ts`, `dispute-details.ts`); JSX lives under `app/`.

## Test

```bash
pnpm vitest run apps/dashboard
pnpm --filter @poi/dashboard build
```

Unbuilt acceptance criteria are `ledger()` entries in this folder's `*.test.ts`. Turn each into a plain `test()` as you finish it.
