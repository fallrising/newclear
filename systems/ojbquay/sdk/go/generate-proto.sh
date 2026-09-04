#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cache_root="${OJBQUAY_PROTO_CACHE:-/tmp/ojbquay-proto-cache-$(id -u)}"
go_cache="$cache_root/go"

mkdir -p "$go_cache/build" "$go_cache/mod"

docker run --rm \
  -e HOST_UID="$(id -u)" \
  -e HOST_GID="$(id -g)" \
  -e DEBIAN_FRONTEND=noninteractive \
  -e GOCACHE=/go-cache/build \
  -e GOMODCACHE=/go-cache/mod \
  -v "$go_cache:/go-cache" \
  -v "$root:/workspace" \
  -w /workspace \
  golang:1.25.1 sh -eu -c '
    apt-get update >/dev/null
    apt-get install --no-install-recommends -y \
      libprotobuf-dev=3.21.12-11+deb13u1 \
      protobuf-compiler=3.21.12-11+deb13u1 >/dev/null
    GOBIN=/usr/local/bin \
    go install google.golang.org/protobuf/cmd/protoc-gen-go@v1.36.10
    GOBIN=/usr/local/bin \
    go install google.golang.org/grpc/cmd/protoc-gen-go-grpc@v1.6.0
    protoc \
      -I proto \
      --go_out=sdk/go \
      --go_opt=module=github.com/fallrising/newclear/systems/ojbquay/sdk/go \
      --go-grpc_out=sdk/go \
      --go-grpc_opt=module=github.com/fallrising/newclear/systems/ojbquay/sdk/go \
      proto/ojbk/v1/common.proto \
      proto/ojbk/v1/config.proto \
      proto/ojbk/v1/consumer.proto \
      proto/ojbk/v1/producer.proto
    chown -R "$HOST_UID:$HOST_GID" sdk/go/gen/ojbk/v1
  '

echo "generated Go Protobuf sources"
