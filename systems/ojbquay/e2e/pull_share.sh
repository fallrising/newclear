#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_ID="$(date +%s)-$$"
TOPIC="pull-interop-${RUN_ID}"
GROUP="pull-interop-${RUN_ID}"
SERVER_LOG="$(mktemp)"
GRADLE_CACHE="${OJBQUAY_GRADLE_CACHE:-/tmp/ojbquay-gradle-cache}"
GO_CACHE="${OJBQUAY_GO_CACHE:-/tmp/ojbquay-go-cache-$(id -u)}"
INTEROP_BINARY="/go-cache/bin/interop"
SERVER_PID=""

mkdir -p "${GRADLE_CACHE}" "${GO_CACHE}/bin"

cleanup() {
  status=$?
  if [[ -n "${SERVER_PID}" ]] && kill -0 "${SERVER_PID}" 2>/dev/null; then
    kill "${SERVER_PID}" 2>/dev/null || true
  fi
  if [[ "${status}" -ne 0 ]] && [[ -s "${SERVER_LOG}" ]]; then
    echo "Java interoperability server log:"
    cat "${SERVER_LOG}"
  fi
  trap - EXIT
  exit "${status}"
}
trap cleanup EXIT

docker compose -f "${ROOT_DIR}/deploy/compose/docker-compose.yml" \
  up -d --wait kafka

docker run --rm \
  --user "$(id -u):$(id -g)" \
  -e GOCACHE=/go-cache/build \
  -e GOMODCACHE=/go-cache/mod \
  -e GOPATH=/go-cache/path \
  -v "${GO_CACHE}:/go-cache" \
  -v "${ROOT_DIR}:/workspace" \
  -w /workspace/sdk/go \
  golang:1.25.1 \
  go build -o /go-cache/bin/interop ./cmd/interop

docker run --rm --network host \
  --user "$(id -u):$(id -g)" \
  -e GRADLE_USER_HOME=/gradle-cache \
  -e OJBQUAY_INTEROP_TOPIC="${TOPIC}" \
  -e OJBQUAY_INTEROP_GROUP="${GROUP}" \
  -v "${GRADLE_CACHE}:/gradle-cache" \
  -v "${ROOT_DIR}:/workspace" \
  -w /workspace \
  gradle:9.6.1-jdk25 \
  ./gradlew :modules:gateway-consume:pullInteropServer --no-daemon \
  >"${SERVER_LOG}" 2>&1 &
SERVER_PID=$!

for _ in $(seq 1 180); do
  if grep -q "^READY ${TOPIC}$" "${SERVER_LOG}"; then
    break
  fi
  if ! kill -0 "${SERVER_PID}" 2>/dev/null; then
    cat "${SERVER_LOG}"
    exit 1
  fi
  sleep 1
done
if ! grep -q "^READY ${TOPIC}$" "${SERVER_LOG}"; then
  cat "${SERVER_LOG}"
  exit 1
fi

docker run --rm --network host \
  --user "$(id -u):$(id -g)" \
  -e GOCACHE=/go-cache/build \
  -e GOMODCACHE=/go-cache/mod \
  -e GOPATH=/go-cache/path \
  -e OJBQUAY_INTEROP_TOPIC="${TOPIC}" \
  -e OJBQUAY_INTEROP_GROUP="${GROUP}" \
  -v "${GO_CACHE}:/go-cache" \
  -v "${ROOT_DIR}:/workspace" \
  -w /workspace/sdk/go \
  golang:1.25.1 \
  "${INTEROP_BINARY}"

wait "${SERVER_PID}"
SERVER_PID=""
grep -q "^INTEROP_OK$" "${SERVER_LOG}"
cat "${SERVER_LOG}"
