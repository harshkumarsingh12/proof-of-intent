#!/usr/bin/env bash
# Proves a backup can actually be restored, without touching the live database (spec 0008, #175). A backup nobody has
# restored is a guess: this restores one into a scratch database beside the live one, compares the two, and drops it.
#
#   scripts/deploy/restore-drill.sh                          # the newest dump the backup service holds
#   scripts/deploy/restore-drill.sh /path/to/poi-<time>.sql.gz   # a dump you copied somewhere
#   scripts/deploy/restore-drill.sh poi-<time>.sql.gz            # or one by name in the service's /backups
#
# It stops, saying why, when: the file is missing or not valid gzip; the restore hits any SQL error (ON_ERROR_STOP: a
# half-restored database must not look like a success); or the restored database has no tables or no migrations.
# It reports, without failing, when the restored database differs from the live one: a dump is up to 24 hours old, so some
# tables will have fewer rows, and one that predates a migration lacks a table (restore, then run `migrate`).
#
# The dumps are read through the backup service, so this works whether they are in ./backups or in the named volume (see
# BACKUP_DIR in docker-compose.yml). COMPOSE overrides the compose command (default: docker compose --profile server).
# KEEP_DRILL_DB=1 leaves the scratch database for inspection. A dump holds everything the database holds: treat it as a secret.
set -u
set -o pipefail
cd "$(dirname "$0")/../.." || exit 1

COMPOSE=${COMPOSE:-docker compose --profile server}
LIVE_DB=${LIVE_DB:-poi}
SCRATCH_DB=${SCRATCH_DB:-poi_restore_drill}
DB_USER=${DB_USER:-poi}
# shellcheck disable=SC2086 # $COMPOSE is a command with its own arguments
psql_() { $COMPOSE exec -T postgres psql -U "$DB_USER" "$@"; }
# shellcheck disable=SC2086
in_backup() { $COMPOSE exec -T backup "$@"; }
fail() { echo "FAIL  $*" >&2; exit 1; }
errlog=$(mktemp)
cleanup() {
  rm -f "$errlog"
  [ "${KEEP_DRILL_DB:-}" = 1 ] || psql_ -d postgres -q -c "drop database if exists \"$SCRATCH_DB\" with (force)" >/dev/null 2>&1
}

# Where the dump is: a file on this machine (given by path), or inside the backup service's /backups.
if [ -n "${1:-}" ] && [ -f "$1" ]; then
  WHERE=here
  FILE=$1
else
  WHERE=service
  FILE=${1:-}
  if [ -z "$FILE" ]; then
    FILE=$(in_backup sh -c 'ls -t /backups/poi-*.sql.gz 2>/dev/null | head -n1' 2>/dev/null | tr -d '\r')
    [ -n "$FILE" ] || fail "no backup to restore: the backup service holds none (or is not running here); give a file path"
  fi
  case $FILE in */*) ;; *) FILE=/backups/$FILE ;; esac
fi
dump() { if [ "$WHERE" = here ]; then cat "$FILE"; else in_backup cat "$FILE"; fi; }

dump 2>/dev/null | gzip -t 2>/dev/null || fail "$FILE is missing, or not a valid gzip file (truncated or corrupt)"
if [ "$WHERE" = here ]; then
  info="$(stat -c '%Y %s' "$FILE" 2>/dev/null || stat -f '%m %z' "$FILE")"
else
  info=$(in_backup stat -c '%Y %s' "$FILE" | tr -d '\r')
fi
age_min=$(( ($(date +%s) - ${info% *}) / 60 ))
echo "ok    $FILE is valid gzip (${info#* } bytes, $((age_min / 60)) h $((age_min % 60)) min old)"

exists=$(psql_ -d postgres -tAc "select 1 from pg_database where datname = '$SCRATCH_DB'") || fail "cannot reach Postgres (is the stack up?)"
[ -z "$exists" ] || fail "$SCRATCH_DB already exists (a drill left behind?): drop it, or set SCRATCH_DB"
trap cleanup EXIT
psql_ -d postgres -q -c "create database \"$SCRATCH_DB\"" || fail "could not create the scratch database"

started=$SECONDS
dump | gunzip | psql_ -d "$SCRATCH_DB" -v ON_ERROR_STOP=1 -q >/dev/null 2>"$errlog" ||
  fail "the restore hit an error: $(grep -m1 -i 'error' "$errlog" || tail -n1 "$errlog")"
echo "ok    restored into $SCRATCH_DB in $((SECONDS - started)) s with no errors"

# One line per table: name and row count, for a database.
COUNTS="select table_name, (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', table_schema, table_name), false, true, '')))[1]::text::int from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by 1"
restored=$(psql_ -d "$SCRATCH_DB" -At -F ' ' -c "$COUNTS")
live=$(psql_ -d "$LIVE_DB" -At -F ' ' -c "$COUNTS") || fail "cannot read the live database $LIVE_DB"

[ -n "$restored" ] || fail "the restored database has no tables: this is not a dump of this database"
migrations=$(echo "$restored" | awk '$1 == "schema_migrations" { print $2 }')
[ "${migrations:-0}" -gt 0 ] || fail "the restored database has no applied migrations"

echo "      table                 restored      live"
join -a 1 -a 2 -e - -o 0,1.2,2.2 <(echo "$restored" | sort) <(echo "$live" | sort) | while read -r table r l; do
  note=""
  if [ "$r" = - ]; then note="   <- not in the backup (it predates a migration: restore, then run migrate)"
  elif [ "$l" = - ]; then note="   <- not in the live database"
  elif [ "$r" -lt "$l" ]; then note="   <- $((l - r)) newer in live (written since the dump)"
  elif [ "$r" -gt "$l" ]; then note="   <- MORE than live: is this dump of a different database?"
  fi
  printf '      %-20s %9s %9s%s\n' "$table" "$r" "$l" "$note"
done
rows=$(echo "$restored" | awk '{ n += $2 } END { print n + 0 }')
echo "restore drill passed: $FILE restores cleanly ($(echo "$restored" | wc -l | tr -d ' ') tables, $rows rows, $migrations migrations)"
