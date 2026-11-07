# Monitoring

How we find out the demo is down, before a judge does (spec 0008, #38). There are two monitors, because each fails in a way the
other does not:

| | Dedicated monitor (you create it) | The in-repo monitor (`uptime.yml`) |
|---|---|---|
| Runs from | the monitoring service's own network | GitHub's network |
| Needs | an account at a monitoring service | two repository variables, and optionally one secret |
| Interval | whatever your plan allows (often 1 to 5 minutes) | every 5 minutes, **best effort**: GitHub can start a run several minutes late, and stops scheduled runs in a repo with no activity for 60 days |
| Tells the team chat | through the service's own integrations | when the site goes down and when it is back, through a Slack or Discord webhook |

Use the dedicated monitor as the main alarm and the in-repo one as a backup that costs nothing.

## What is checked, and why `/readyz`

| What | URL | Up means |
|---|---|---|
| API readiness | `https://poi-api.iotkiit.in/readyz` | HTTP 200 **and** the body contains `"database":"configured"` |
| Shop | `https://poi-buyer.iotkiit.in/healthz` | HTTP 200 and `"status":"ok"` |
| Dashboard | `https://poi-dashboard.iotkiit.in/healthz` | HTTP 200 and `"status":"ok"` |

Monitor the API through `/readyz`, **not** `/healthz`. `/healthz` never touches Postgres, so it stays green while every route
answers 500, which is exactly how the Nov 6 and Nov 7 outages looked. `/readyz` pings the database and answers 503 when it cannot
be reached (#120). Match on the **body text** too, not only the status code: that also catches a proxy serving a 200 error page.

What these cannot see: the worker and the backup service have no public URL. Their health shows in `docker compose ps` and in
Dokploy (`unhealthy` when the worker has stopped polling, or no dump is under 26 hours old).

## The in-repo monitor

`.github/workflows/uptime.yml` runs `scripts/ops/uptime-check.sh` every 5 minutes. It is **off until you set the variables**
(the job is skipped, visibly, instead of quietly checking nothing).

1. Repository **Settings, Secrets and variables, Actions, Variables**: add `PUBLIC_API_URL`, `PUBLIC_SHOP_URL` and
   `PUBLIC_DASHBOARD_URL` (for example `https://poi-api.iotkiit.in`, without a trailing path). The release workflow uses the same ones.
2. For chat messages, add the **secret** `UPTIME_WEBHOOK_URL`: a Slack or Discord incoming-webhook URL (the message carries both the
   `text` and `content` fields). Without it a failed run still turns red and GitHub emails whoever last edited the schedule.
3. Run it once by hand: **Actions, uptime, Run workflow**. It should be green.

It sends a chat message **only when the state changes**: one message when it first fails (with what failed and a link to the run),
one when it recovers. It does not repeat every 5 minutes while the site is down. Each check is tried 3 times, 5 seconds apart, so a
single dropped packet is not an outage.

## The dedicated monitor

Any service that can do keyword checks works (UptimeRobot, Better Stack, and others). Create three monitors:

1. **HTTP(S) keyword** on the API's `/readyz` URL, alert when the keyword `"database":"configured"` is **missing**.
2. **HTTP(S) keyword** on the shop's `/healthz` URL, keyword `"status":"ok"`.
3. **HTTP(S) keyword** on the dashboard's `/healthz` URL, keyword `"status":"ok"`.

Then connect an **alert contact** that reaches the team chat (the service's Slack, Discord, Telegram or email integration; pick
whatever the team actually reads) and set the **check interval** as short as your plan allows. Turn on certificate-expiry alerts
if it offers them. Do not put the operator password or any token in a monitored URL.

## Proving an alert reaches the chat, without taking production down

Done when an alert reaches the team chat within 5 minutes of the API stopping. Do not stop the real API to prove it. Instead:

- **Dedicated monitor:** create a fourth, temporary monitor on the shop's `/healthz` that expects a keyword that is not there (for
  example `this-text-is-not-in-the-answer`). It must alert within one interval. Write down how long it took, then delete it.
- **In-repo monitor:** change the repository variable `PUBLIC_SHOP_URL` to a wrong host, run the workflow by hand, and expect the
  DOWN message; put the right value back, run it again, and expect the UP message.

The 5-minute figure holds only if the dedicated monitor's interval is short enough: the worst case is the interval plus the time the
service takes to confirm and send. With a 5-minute interval it can exceed 5 minutes, so choose the shortest interval your plan
allows, and write down what you measured.

## When it fires

1. Open the three URLs above to see which one failed, and read the failure text in the alert or in the run log.
2. `/readyz` answering 503 with `"database":"unreachable"` means the API cannot reach Postgres: see the `ENOTFOUND postgres` row in
   `docs/SETUP.md`, "Troubleshooting".
3. A worker or backup that is `unhealthy` does not alert from outside: look at `docker compose ps` or Dokploy.
