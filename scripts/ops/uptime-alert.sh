#!/usr/bin/env bash
# Tells the team chat when the site goes down or comes back, not after every failed check (spec 0008, #38). The monitor runs
# every 5 minutes, so alerting on each failure would send a message every 5 minutes for as long as an outage lasts.
#
#   scripts/ops/uptime-alert.sh <this run: success|failure> <the previous completed run> [file listing what failed]
#
#   this run  previous   message
#   failure   not failure  DOWN, with what failed
#   success   failure      back UP
#   anything else          none (still down, or still up: stay quiet)
#
# WEBHOOK is a Slack or Discord incoming-webhook URL (the payload carries both `text` and `content`). RUN_URL links the run.
# DRY_RUN=1 prints what would be sent. A webhook that cannot be reached warns and never fails the job: the failed check already
# has, and GitHub emails about it.
set -u

result=${1:?this run: success or failure}
previous=${2:-success}
report=${3:-}

if [ "$result" = failure ] && [ "$previous" != failure ]; then
  what=$(cat "$report" 2>/dev/null)
  message="Proof of Intent looks DOWN, checked from outside (GitHub): ${what:-no detail}${RUN_URL:+ | $RUN_URL}"
elif [ "$result" = success ] && [ "$previous" = failure ]; then
  message="Proof of Intent is back UP${RUN_URL:+ | $RUN_URL}"
else
  echo "no change (this run: $result, the one before: $previous), so no message"
  exit 0
fi

# One line of JSON with the message escaped properly, in the fields Slack and Discord each read.
payload=$(python3 -c 'import json,sys; m=sys.argv[1]; print(json.dumps({"text": m, "content": m}))' "$message")
if [ "${DRY_RUN:-}" = 1 ]; then
  echo "would send: $payload"
  exit 0
fi
if [ -z "${WEBHOOK:-}" ]; then
  echo "::notice::UPTIME_WEBHOOK_URL is not set, so no chat message was sent (GitHub's own failure email still goes out)"
  exit 0
fi
curl -fsS --max-time 15 -H 'content-type: application/json' -d "$payload" "$WEBHOOK" >/dev/null ||
  echo "::warning::could not deliver the alert to the webhook"
exit 0
