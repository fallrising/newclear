#!/usr/bin/env bash
set -euo pipefail
unset TYPESAFE_API_KEY PGPASSWORD PGSERVICE PGSERVICEFILE
python3 mock_api.py &
mock_pid=$!
docker-entrypoint.sh postgres -c listen_addresses=127.0.0.1 > /tmp/postgres.log 2>&1 &
pg_pid=$!
cleanup() {
  kill "$mock_pid" "$pg_pid" 2>/dev/null || true
  wait "$mock_pid" "$pg_pid" 2>/dev/null || true
}
trap cleanup EXIT
ready=0
for _ in {1..60}; do
  if pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1; then ready=1; break; fi
  sleep 0.5
done
if [[ "$ready" != 1 ]]; then cat /tmp/postgres.log; exit 1; fi
psql -X -h 127.0.0.1 -U postgres -v ON_ERROR_STOP=1 -f sql/bootstrap.sql
python3 -m unittest discover -s tests -v
python3 -m unittest discover -s tests -p 'integration_*.py' -v
python3 demo.py --postgres
