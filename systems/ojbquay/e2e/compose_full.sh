#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
compose_file="$root/deploy/compose/docker-compose.yml"
project="${OJBQUAY_E2E_PROJECT:-ojbquay-e2e}"
cookie_jar="$(mktemp)"
response_file="$(mktemp)"
current_step="starting Compose services"

if [[ ! "$project" =~ ^[a-z0-9][a-z0-9_-]*$ ]]; then
  echo "OJBQUAY_E2E_PROJECT must contain lowercase letters, digits, _ or -" >&2
  exit 2
fi

export OJBQUAY_ADMIN_PASSWORD=local-admin-password
export OJBQUAY_HOST_KAFKA_PORT=29092
export OJBQUAY_HOST_POSTGRES_PORT=25432
export OJBQUAY_HOST_API_PORT=28080
export OJBQUAY_HOST_WEB_PORT=28088
export OJBQUAY_HOST_PRODUCER_GRPC_PORT=29100
export OJBQUAY_HOST_PRODUCER_METRICS_PORT=29200
export OJBQUAY_HOST_CONSUMER_GRPC_PORT=29101
export OJBQUAY_HOST_CONSUMER_METRICS_PORT=29202
export OJBQUAY_HOST_SCHEDULER_METRICS_PORT=29201
export OJBQUAY_HOST_PROMETHEUS_PORT=29090
export OJBQUAY_HOST_ALERTMANAGER_PORT=29094
export OJBQUAY_HOST_GRAFANA_PORT=23000
export OJBQUAY_HOST_PUSH_SINK_PORT=28081

cleanup() {
  status=$?
  if (( status != 0 )); then
    echo "Compose E2E failed while ${current_step}" >&2
    docker compose -p "$project" -f "$compose_file" ps
    docker compose -p "$project" -f "$compose_file" logs --tail=60 \
      console-api gateway-produce gateway-consume push-sink prometheus
  fi
  rm -f "$cookie_jar" "$response_file"
  if [[ "${KEEP_STACK:-0}" != "1" ]]; then
    docker compose -p "$project" -f "$compose_file" --profile e2e down --volumes
  fi
  exit "$status"
}
trap cleanup EXIT

docker compose -p "$project" -f "$compose_file" --profile e2e \
  up -d --build --wait

running_services="$(
  docker compose -p "$project" -f "$compose_file" --profile e2e \
    ps --services --status running | wc -l | tr -d ' '
)"
if [[ "$running_services" != "11" ]]; then
  echo "Expected 11 running Compose services, found $running_services" >&2
  exit 1
fi
echo "[PASS] 11 Compose services are running"

current_step="checking service readiness"
await_http() {
  endpoint="$1"
  for _ in $(seq 1 30); do
    if curl --fail --silent --show-error "$endpoint" >/dev/null 2>&1; then
      return
    fi
    sleep 1
  done
  echo "Health endpoint did not become ready: $endpoint" >&2
  return 1
}

for endpoint in \
  http://127.0.0.1:28080/actuator/health/readiness \
  http://127.0.0.1:29200/readyz \
  http://127.0.0.1:29201/readyz \
  http://127.0.0.1:29202/readyz \
  http://127.0.0.1:28088/healthz \
  http://127.0.0.1:29090/-/ready \
  http://127.0.0.1:23000/api/health; do
  await_http "$endpoint"
done
echo "[PASS] 7 public readiness and health endpoints responded"

current_step="bootstrapping CSRF protection"
csrf_response="$(curl --fail --silent --show-error \
  --cookie-jar "$cookie_jar" \
  http://127.0.0.1:28088/api/v1/auth/csrf)"
csrf_token="$(sed -n 's/.*"token":"\([^"]*\)".*/\1/p' <<<"$csrf_response")"
if [[ -z "$csrf_token" ]]; then
  echo "CSRF bootstrap did not return a token" >&2
  exit 1
fi

current_step="authenticating the console administrator"
curl --fail --silent --show-error \
  --cookie "$cookie_jar" \
  --cookie-jar "$cookie_jar" \
  --header "Content-Type: application/json" \
  --header "X-XSRF-TOKEN: $csrf_token" \
  --data '{"username":"admin","password":"local-admin-password"}' \
  http://127.0.0.1:28088/api/v1/auth/login >"$response_file"
grep -q '"code":"OK"' "$response_file"
echo "[PASS] Session and CSRF-protected administrator login succeeded"

suffix="$(date +%s)-$$"
topic="e2e.orders.$suffix"
group="e2e-fulfilment-$suffix"

current_step="creating the E2E topic"
curl --fail --silent --show-error \
  --cookie "$cookie_jar" \
  --header "Content-Type: application/json" \
  --header "X-XSRF-TOKEN: $csrf_token" \
  --data "{\"name\":\"$topic\",\"clusterId\":1,\"partitions\":1,\"replication\":1,\"delayTopic\":false,\"maxMessageBytes\":1048576,\"retentionMs\":86400000,\"produceQuotaTps\":1000,\"compression\":\"zstd\",\"remark\":\"compose e2e\"}" \
  http://127.0.0.1:28088/api/v1/topics >"$response_file"
grep -q '"code":"OK"' "$response_file"
topic_id="$(sed -n 's/.*"id":\([0-9][0-9]*\).*/\1/p' "$response_file")"
topic_token="$(sed -n 's/.*"token":"\([^"]*\)".*/\1/p' "$response_file")"

current_step="creating the E2E consumer group"
curl --fail --silent --show-error \
  --cookie "$cookie_jar" \
  --header "Content-Type: application/json" \
  --header "X-XSRF-TOKEN: $csrf_token" \
  --data "{\"name\":\"$group\",\"remark\":\"compose e2e\"}" \
  http://127.0.0.1:28088/api/v1/groups >"$response_file"
grep -q '"code":"OK"' "$response_file"
group_id="$(sed -n 's/.*"id":\([0-9][0-9]*\).*/\1/p' "$response_file")"

if [[ -z "$topic_id" || -z "$topic_token" || -z "$group_id" ]]; then
  echo "Resource creation response was incomplete" >&2
  exit 1
fi

current_step="creating the PUSH subscription"
curl --fail --silent --show-error \
  --cookie "$cookie_jar" \
  --header "Content-Type: application/json" \
  --header "X-XSRF-TOKEN: $csrf_token" \
  --data "{\"groupId\":$group_id,\"topicId\":$topic_id,\"spec\":{\"mode\":\"PUSH\",\"concurrency\":4,\"maxTps\":1000,\"filterCel\":\"\",\"tags\":[],\"transit\":{},\"ordered\":false,\"dlqEnabled\":true,\"shadowTraffic\":false,\"push\":{\"urls\":[\"http://push-sink:8080/events\"],\"method\":\"POST\",\"timeoutMs\":2000,\"retryIntervalsMs\":[150,300],\"headers\":{}}}}" \
  http://127.0.0.1:28088/api/v1/subscriptions >"$response_file"
grep -q '"code":"OK"' "$response_file"
subscription_id="$(sed -n 's/.*"id":\([0-9][0-9]*\).*/\1/p' "$response_file")"
if [[ -z "$subscription_id" ]]; then
  echo "Subscription creation response was incomplete" >&2
  exit 1
fi
echo "[PASS] Topic, group, and PUSH subscription were provisioned"

current_step="producing through the gRPC gateway"
produced=0
for _ in $(seq 1 30); do
  if docker run --rm --network "${project}_default" \
      -v "$root/proto:/proto:ro" \
      fullstorydev/grpcurl:v1.9.3 \
      -plaintext \
      -emit-defaults \
      -import-path /proto \
      -proto ojbk/v1/producer.proto \
      -H "x-ojbk-token: $topic_token" \
      -d "{\"msg\":{\"topic\":\"$topic\",\"key\":\"e2e-key\",\"value\":\"eyJldmVudCI6ImNvbXBvc2UtZTJlIn0=\"}}" \
      gateway-produce:9100 ojbk.v1.ProducerService/Produce \
      >"$response_file" 2>/dev/null \
      && grep -q '"ack"' "$response_file" \
      && grep -q '"partition"' "$response_file" \
      && grep -q '"offset"' "$response_file"; then
    produced=1
    break
  fi
  sleep 1
done
if (( produced == 0 )); then
  echo "Producer gateway did not accept the E2E message" >&2
  exit 1
fi
ack_partition="$(
  sed -n 's/.*"partition":[[:space:]]*\([0-9][0-9]*\).*/\1/p' \
    "$response_file"
)"
ack_offset="$(
  sed -n 's/.*"offset":[[:space:]]*"\{0,1\}\([0-9][0-9]*\)"\{0,1\}.*/\1/p' \
    "$response_file"
)"
echo "[PASS] gRPC producer returned partition=$ack_partition offset=$ack_offset"

current_step="waiting for PUSH delivery"
delivered=0
for _ in $(seq 1 60); do
  count="$(curl --fail --silent --show-error http://127.0.0.1:28081/count)"
  if (( count >= 1 )); then
    delivered=1
    break
  fi
  sleep 1
done
if (( delivered == 0 )); then
  echo "Push delivery was not observed" >&2
  exit 1
fi
delivered_body="$(
  curl --fail --silent --show-error http://127.0.0.1:28081/last
)"
if [[ "$delivered_body" != '{"event":"compose-e2e"}' ]]; then
  echo "Push sink received an unexpected payload" >&2
  exit 1
fi
echo "[PASS] HTTP PUSH sink received the exact expected payload"

current_step="checking consumer delivery metrics"
consume_metrics="$(curl --fail --silent --show-error http://127.0.0.1:29202/metrics)"
metric_line="$(
  grep 'ojbk_push_total.*code="success"' <<<"$consume_metrics" | head -1
)"
if ! grep -Eq ' [1-9][0-9]*(\.[0-9]+)?$' <<<"$metric_line"; then
  echo "Consumer success metric was absent or zero" >&2
  exit 1
fi
echo "[PASS] Consumer success metric is non-zero"

current_step="checking Prometheus scrape targets"
targets_healthy=0
for _ in $(seq 1 60); do
  targets="$(
    curl --fail --silent --show-error \
      http://127.0.0.1:29090/api/v1/targets
  )"
  targets_healthy=1
  for job in console-api gateway-produce gateway-consume scheduler lag-exporter; do
    if ! grep -Eq "\"job\":\"$job\".*\"health\":\"up\"" <<<"$targets"; then
      targets_healthy=0
      break
    fi
  done
  if (( targets_healthy == 1 )); then
    break
  fi
  sleep 1
done
if (( targets_healthy == 0 )); then
  echo "Prometheus targets did not become healthy" >&2
  exit 1
fi
echo "[PASS] 5 expected Prometheus jobs are healthy"

current_step="complete"
echo "COMPOSE_E2E_OK topic=$topic group=$group subscription=$subscription_id partition=$ack_partition offset=$ack_offset"
