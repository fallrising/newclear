#!/usr/bin/env bash
# Extra AC-01 / AC-07 checks against a kept ojbquay-e2e stack.
set -euo pipefail
root="$1"; topic="$2"; sub="$3"; project=ojbquay-e2e
jar="$(mktemp)"; out="$(mktemp)"; trap 'rm -f "$jar" "$out"' EXIT
csrf="$(curl -fsS -c "$jar" http://127.0.0.1:28088/api/v1/auth/csrf | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')"
curl -fsS -b "$jar" -c "$jar" -H 'Content-Type: application/json' -H "X-XSRF-TOKEN: $csrf" \
  -d '{"username":"admin","password":"local-admin-password"}' http://127.0.0.1:28088/api/v1/auth/login >/dev/null
api() { curl -fsS -b "$jar" -H 'Content-Type: application/json' -H "X-XSRF-TOKEN: $csrf" "$@"; }
loaded() { curl -fsS http://127.0.0.1:29202/metrics | sed -n "s/^ojbk_sub_config_version{sub=\"$sub\"} \([0-9]*\)$/\1/p"; }

echo "loaded version before update: $(loaded)"
spec='{"spec":{"mode":"PUSH","concurrency":2,"maxTps":1000,"filterCel":"","tags":[],"transit":{},"ordered":false,"dlqEnabled":true,"shadowTraffic":false,"push":{"urls":["http://push-sink:8080/events"],"method":"POST","timeoutMs":2000,"retryIntervalsMs":[150,300],"headers":{}}}}'
start=$(date +%s%N)
api -X PUT -d "$spec" "http://127.0.0.1:28088/api/v1/subscriptions/$sub" >"$out"
desired="$(sed -n 's/.*"version":\([0-9]*\).*/\1/p' "$out")"
ok=0
for _ in $(seq 1 100); do
  [[ "$(loaded)" == "$desired" ]] && { ok=1; break; }
  sleep 0.1
done
ms=$(( ($(date +%s%N) - start) / 1000000 ))
(( ok == 1 )) || { echo "[FAIL] AC-01 desired=$desired loaded=$(loaded) after ${ms}ms"; exit 1; }
(( ms < 5000 )) || { echo "[FAIL] AC-01 converged in ${ms}ms (>5s)"; exit 1; }
echo "[PASS] AC-01 runtime loaded version $desired ${ms}ms after update"

token="$(api "http://127.0.0.1:28088/api/v1/topics" | grep -o "\"name\":\"$topic\"[^}]*" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')"
if [[ -z "$token" ]]; then
  token="$(docker compose -p $project -f "$root/deploy/compose/docker-compose.yml" exec -T postgres \
    psql -U ojbk -d ojbk -At -c "SELECT token FROM topic WHERE name='$topic'" 2>/dev/null || true)"
fi
before="$(curl -fsS http://127.0.0.1:28081/count)"
console="$(docker compose -p $project -f "$root/deploy/compose/docker-compose.yml" ps -q console-api)"
docker stop "$console" >/dev/null
echo "console-api stopped: $(docker inspect -f '{{.State.Status}}' "$console")"
docker run --rm --network ${project}_default -v "$root/proto:/proto:ro" fullstorydev/grpcurl:v1.9.3 \
  -plaintext -emit-defaults -import-path /proto -proto ojbk/v1/producer.proto -H "x-ojbk-token: $token" \
  -d "{\"msg\":{\"topic\":\"$topic\",\"key\":\"ac07\",\"value\":\"eyJldmVudCI6ImFjMDcifQ==\"}}" \
  gateway-produce:9100 ojbk.v1.ProducerService/Produce >"$out"
grep -q '"offset"' "$out" || { cat "$out"; echo "[FAIL] AC-07 produce without control plane"; docker start "$console" >/dev/null; exit 1; }
got=0
for _ in $(seq 1 30); do
  (( $(curl -fsS http://127.0.0.1:28081/count) > before )) && { got=1; break; }
  sleep 1
done
last="$(curl -fsS http://127.0.0.1:28081/last)"
docker start "$console" >/dev/null
(( got == 1 )) && [[ "$last" == '{"event":"ac07"}' ]] || { echo "[FAIL] AC-07 sink got=$got last=$last"; exit 1; }
echo "[PASS] AC-07 with console-api stopped: gRPC ACK and exact sink payload $last"
