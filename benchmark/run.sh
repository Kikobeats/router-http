#!/usr/bin/env bash
# Loads every server in this directory with the same wrk run and reports the
# best round for each, so one noisy round cannot decide the ranking.
#
#   ./benchmark/run.sh [duration] [rounds]
#
# Rounds are interleaved rather than run back to back: a server that happens to
# share the machine with something else does not get to keep that handicap for
# its whole sample. Check the load average first — anything above ~1 per core
# and the numbers describe the machine, not the router.
set -uo pipefail

cd "$(dirname "$0")/.."

DURATION="${1:-30s}"
ROUNDS="${2:-3}"
TARGET="http://127.0.0.1:3000/user/123"
SERVERS=(express polka http-router)

wait_for_port () {
  local want=$1 i=0 open
  while [ $i -lt 100 ]; do
    open=$(lsof -ti:3000 2>/dev/null | wc -l | tr -d ' ')
    [ "$want" = open ] && [ "$open" != 0 ] && return 0
    [ "$want" = free ] && [ "$open" = 0 ] && return 0
    sleep 0.1
    i=$((i + 1))
  done
  echo "timed out waiting for port 3000 to be $want" >&2
  return 1
}

measure () {
  wait_for_port free || return 1
  node "benchmark/$1.js" >/dev/null 2>&1 &
  local pid=$! out
  wait_for_port open || return 1

  wrk -t8 -c100 -d5s "$TARGET" >/dev/null 2>&1
  out=$(wrk -t8 -c100 -d"$DURATION" "$TARGET")

  kill "$pid" 2>/dev/null
  wait "$pid" 2>/dev/null
  echo "$out"
}

echo "node $(node -v) · $(wrk --version 2>&1 | head -1 | cut -d' ' -f1-2) -t8 -c100 -d$DURATION · $ROUNDS rounds · load $(uptime | sed 's/.*averages: //')"
echo

declare -A best
for round in $(seq 1 "$ROUNDS"); do
  for server in "${SERVERS[@]}"; do
    rps=$(measure "$server" | awk '/Requests\/sec/ {print $2}')
    [ -z "$rps" ] && continue
    printf 'round %s  %-12s %10.0f req/s\n' "$round" "$server" "$rps"
    current=${best[$server]:-0}
    awk -v a="$rps" -v b="$current" 'BEGIN { exit !(a > b) }' && best[$server]=$rps
  done
done

echo
echo "best of $ROUNDS:"
for server in "${SERVERS[@]}"; do
  printf '  %-12s %10.0f req/s\n' "$server" "${best[$server]:-0}"
done
