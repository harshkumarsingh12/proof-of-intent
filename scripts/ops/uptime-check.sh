#!/usr/bin/env bash
# Checks the public endpoints from outside, the way an uptime monitor would (spec 0008, #38). Exits 1 if any check fails.
#
#   API_URL=https://poi-api.iotkiit.in SHOP_URL=https://poi-buyer.iotkiit.in DASHBOARD_URL=https://poi-dashboard.iotkiit.in \
#     scripts/ops/uptime-check.sh
#
# What counts as up:
#   api        /readyz answers 200 AND says the database is reachable (/healthz never touches Postgres, so it stays green
#              while every route answers 500: that is how the Nov 6 and Nov 7 outages looked)
#   shop       /healthz answers 200
#   dashboard  /healthz answers 200
# A URL that is not set is skipped with a note. Each check is tried ATTEMPTS times (default 3, DELAY seconds apart, default 5)
# so one dropped packet is not an outage. A failing check prints "FAIL  name: reason". When REPORT is set, the failures
# are also written there, one per line, for an alert message.
set -u

ATTEMPTS=${ATTEMPTS:-3}
DELAY=${DELAY:-5}
TIMEOUT=${TIMEOUT:-15}
REPORT=${REPORT:-}
[ -z "$REPORT" ] || : >"$REPORT"
failed=0

# check <name> <url> <text the answer must contain>
check() {
  local name=$1 url=$2 must=$3 body="" code="" why="" n
  if [ -z "$url" ]; then echo "skip  $name: no URL set"; return; fi
  for ((n = 1; n <= ATTEMPTS; n++)); do
    # -w prints the status after the body, so one request tells us both.
    if out=$(curl -sS --max-time "$TIMEOUT" -w $'\n%{http_code}' "$url" 2>&1); then
      code=${out##*$'\n'}
      body=${out%$'\n'*}
      if [ "$code" != 200 ]; then why="$url answered HTTP $code"
      elif [[ ${body//[[:space:]]/} != *"$must"* ]]; then why="$url answered 200 but without $must" # JSON spacing must not matter
      else echo "ok    $name ($url)"; return
      fi
    else
      why="$url did not answer: $(head -n1 <<<"$out")"
    fi
    [ "$n" -lt "$ATTEMPTS" ] && sleep "$DELAY"
  done
  echo "FAIL  $name: $why" >&2
  [ -z "$REPORT" ] || echo "$name: $why" >>"$REPORT"
  failed=1
}

check "api ready (database reachable)" "${API_URL:+${API_URL%/}/readyz}" '"database":"configured"'
check "shop" "${SHOP_URL:+${SHOP_URL%/}/healthz}" '"status":"ok"'
check "dashboard" "${DASHBOARD_URL:+${DASHBOARD_URL%/}/healthz}" '"status":"ok"'
if [ -z "${API_URL:-}${SHOP_URL:-}${DASHBOARD_URL:-}" ]; then
  echo "FAIL  no URLs were given, so nothing was checked" >&2
  failed=1
fi
exit "$failed"
