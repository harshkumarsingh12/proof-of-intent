#!/usr/bin/env bash
# Checks that a deployment is really up, not just that a container started (spec 0008, #175). Run it after
# `docker compose --profile server up -d`, on the machine that runs the stack:
#
#   scripts/deploy/verify-release.sh
#
# In this order, stopping at the first failure and saying which one:
#   migrate    finished successfully
#   postgres   healthy
#   api        /readyz answers 200 with the database reachable (/healthz never touches Postgres, so it can stay green
#              while every route answers 500: that is how the Nov 6 and Nov 7 outages looked)
#   buyer      /healthz
#   dashboard  /healthz
#   worker     healthy: it finished a poll of the dispute inbox within the last minute (apps/worker/src/heartbeat.ts)
#   backup     when the backup service is running, a dump less than 26 hours old exists in ./backups
#
# A service that is still starting is waited for, up to VERIFY_TIMEOUT seconds per check (default 120).
# COMPOSE overrides the compose command (default: docker compose --profile server).
set -u
cd "$(dirname "$0")/../.." || exit 1

COMPOSE=${COMPOSE:-docker compose --profile server}
TIMEOUT=${VERIFY_TIMEOUT:-120}
BACKUP_MAX_AGE_MIN=${BACKUP_MAX_AGE_MIN:-1560} # 26 h: the backup service dumps every 24 h

# step <name> <function>: retry until the function succeeds or the timeout passes. The function prints why it failed.
step() {
  local name=$1 check=$2 out deadline=$((SECONDS + TIMEOUT))
  until out=$("$check" 2>&1); do
    if [ "$SECONDS" -ge "$deadline" ]; then
      echo "FAIL  $name${out:+: $out}" >&2
      exit 1
    fi
    sleep 3
  done
  echo "ok    $name"
}

# shellcheck disable=SC2086 # $COMPOSE is a command with its own arguments
container() { $COMPOSE ps -a -q "$1" | head -n1; }
health() { docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$(container "$1")" 2>/dev/null; }
# shellcheck disable=SC2086
inside() { $COMPOSE exec -T "$1" wget -qO- "$2" 2>/dev/null; } # the callers say what a failure means

migrate_done() {
  local c state
  c=$(container migrate)
  [ -n "$c" ] || { echo "there is no migrate container"; return 1; }
  state=$(docker inspect -f '{{.State.Status}} {{.State.ExitCode}}' "$c")
  [ "$state" = "exited 0" ] || { echo "migrate is '$state' (want: exited 0); see 'docker logs $c'"; return 1; }
}

healthy() {
  local h
  h=$(health "$1")
  [ "$h" = healthy ] || { echo "$1 is '${h:-not running}' (want: healthy)"; return 1; }
}
postgres_healthy() { healthy postgres; }
worker_healthy() { healthy worker; }

api_ready() {
  local body
  body=$(inside api http://127.0.0.1:3000/readyz) || { echo "/readyz did not answer 200: the API or its database is down"; return 1; }
  case $body in
    *'"database":"configured"'*) ;;
    *) echo "/readyz answered, but not with a reachable database: $body"; return 1 ;;
  esac
}
buyer_up() { inside buyer http://127.0.0.1:3001/healthz >/dev/null || { echo "the shop's /healthz did not answer 200"; return 1; }; }
dashboard_up() { inside dashboard http://127.0.0.1:3002/healthz >/dev/null || { echo "the dashboard's /healthz did not answer 200"; return 1; }; }

fresh_backup() {
  [ -n "$(find backups -name 'poi-*.sql.gz' -mmin "-$BACKUP_MAX_AGE_MIN" 2>/dev/null | head -n1)" ] ||
    { echo "no dump newer than $((BACKUP_MAX_AGE_MIN / 60)) h in ./backups"; return 1; }
}

step "migrate finished" migrate_done
step "postgres healthy" postgres_healthy
step "api ready (database reachable)" api_ready
step "shop answers" buyer_up
step "dashboard answers" dashboard_up
step "worker polling the dispute inbox" worker_healthy
# shellcheck disable=SC2086
if [ -n "$($COMPOSE ps -q backup)" ]; then
  step "a fresh backup exists" fresh_backup
else
  echo "skip  backups: the backup service is not running here (on Dokploy, use its scheduled backups)"
fi
echo "release verified"
